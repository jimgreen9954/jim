import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { formatUnits, type Hex } from "viem";
import { Kline, type Bar } from "@/components/exchange/kline";
import { PairChevron } from "@/components/exchange/desk-chrome";
import { CoinMark } from "@/components/exchange/coin-mark";
import { announceFill, freshEnough, readPrefs, useDeskPrefs } from "@/lib/desk-prefs";
import { tapePoolCandles, readOpenBook, type OpenBook } from "@/lib/tape-open-candles";
import type { CandleFrame } from "@/lib/bem-ohlcv";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectXLayer } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";
import { poolAmount, poolBalances, poolText, previewPool, swapPool, type PoolQuote } from "@/lib/tape-open-swap";

const FRAMES: [CandleFrame, string, string][] = [
  ["15s", "15秒", "15s"], ["1m", "1分", "1m"], ["5m", "5分", "5m"], ["15m", "15分", "15m"],
  ["1h", "1时", "1h"], ["4h", "4时", "4h"], ["1d", "1日", "1d"], ["1w", "一周", "1w"],
  ["1M", "一月", "1M"], ["3M", "三月", "3M"], ["1y", "一年", "1y"],
];
const KEY = "tapeliquid-pool-orders";
const POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484";

type Mode = "market" | "limit" | "chase" | "scale" | "twap";
type Side = "buy" | "sell";
type Order = {
  id: string;
  kind: "limit" | "chase" | "twap";
  side: Side;
  quote: PoolQuote;
  left: string;
  price: number;
  maxPct: number;
  startMid: number;
  slice: string;
  every: number;
  nextAt: number;
  jitter: boolean;
};
type Tip = { x: number; y: number; away: number; avg: number; tape: number; usd: number };

function loadOrders(): Order[] {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || "[]") as Order[];
    return Array.isArray(rows) ? rows.filter((row) => row && typeof row.id === "string" && typeof row.left === "string") : [];
  } catch {
    return [];
  }
}

function saveOrders(rows: Order[]) {
  localStorage.setItem(KEY, JSON.stringify(rows));
}

function money(n: number): string {
  if (!(n > 0) || !Number.isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(4);
}

function clock(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function quoteInForTape(tape: bigint, quote: bigint, want: bigint): bigint {
  if (want <= 0n || want >= tape) throw new Error("amount");
  const net = (want * quote) / (tape - want);
  return (net * 10_000n + 9_979n) / 9_980n;
}

function maxBuy(tape: bigint, quote: bigint, bal: bigint): bigint {
  if (bal <= 0n || tape <= 1n || quote <= 0n) return 0n;
  const net = (bal * 9_980n) / 10_000n;
  const out = (tape * net) / (quote + net);
  return out > 0n && out < tape ? out : 0n;
}

function slices(total: bigint, n: number, skew: number): bigint[] {
  const weights = Array.from({ length: n }, (_, i) => (n === 1 ? 1 : skew ** (i / (n - 1))));
  const sum = weights.reduce((a, b) => a + b, 0);
  const out: bigint[] = [];
  let used = 0n;
  for (let i = 0; i < n; i++) {
    const part = i === n - 1 ? total - used : (total * BigInt(Math.round(weights[i] / sum * 10_000))) / 10_000n;
    if (part > 0n) out.push(part);
    used += part;
  }
  return out;
}

type Level = { px: number; size: number; quote: number };

function walk(tapeRaw: bigint, quoteRaw: bigint, quoteUsd: number, buy: boolean): Level[] {
  const tape0 = Number(formatUnits(tapeRaw, 8));
  const quoteDec = quoteRaw > 10n ** 12n ? 18 : 8;
  const quote0 = Number(formatUnits(quoteRaw, quoteDec));
  if (!(tape0 > 0 && quote0 > 0 && quoteUsd > 0)) return [];
  const rows: Level[] = [];
  let t = tape0;
  let q = quote0;
  for (let i = 0; i < 12; i++) {
    const size = tape0 * 0.004 * (1 + i * 0.18);
    if (!(size > 0) || size >= t * 0.25) break;
    if (buy) {
      const net = (size * q) / (t - size);
      const paid = net / 0.998;
      rows.push({ px: (paid * quoteUsd) / size, size, quote: paid * quoteUsd });
      t -= size;
      q += net;
    } else {
      const net = size * 0.998;
      const out = (q * net) / (t + net);
      rows.push({ px: (out * quoteUsd) / size, size, quote: out * quoteUsd });
      t += net;
      q -= out;
    }
  }
  return rows;
}

export function PoolSpot({ onMarkets, onOtc }: { onMarkets: () => void; onOtc: () => void }) {
  const zh = useExchange((s) => s.lang) !== "en";
  const prefs = useDeskPrefs();
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [book, setBook] = useState<OpenBook | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [frame, setFrame] = useState<CandleFrame>("1h");
  const [mode, setMode] = useState<Mode>("market");
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState<Side>("buy");
  const [quote, setQuote] = useState<PoolQuote>(0);
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [chase, setChase] = useState("");
  const [maxPct, setMaxPct] = useState("1");
  const [scaleA, setScaleA] = useState("");
  const [scaleB, setScaleB] = useState("");
  const [scaleN, setScaleN] = useState(5);
  const [skew, setSkew] = useState("1.00");
  const [hours, setHours] = useState("0");
  const [mins, setMins] = useState("30");
  const [jitter, setJitter] = useState(false);
  const [pct, setPct] = useState(0);
  const [tab, setTab] = useState<"book" | "tape">("book");
  const [dock, setDock] = useState<"bal" | "rest" | "fills">("rest");
  const [orders, setOrders] = useState<Order[]>(() => loadOrders());
  const [bal, setBal] = useState<{ bem: bigint; okb: bigint; tape: bigint } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [armed, setArmed] = useState(false);
  const ordersRef = useRef(orders);
  const bookRef = useRef(book);
  const lock = useRef(false);
  ordersRef.current = orders;
  bookRef.current = book;

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readOpenBook().then((row) => { if (!dead) setBook(row); }).catch(() => undefined);
      tapePoolCandles(frame).then((rows) => { if (!dead) setBars(rows); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 12_000);
    return () => { dead = true; window.clearInterval(id); };
  }, [frame]);

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      if (!account) { setBal(null); return; }
      try {
        const row = await poolBalances(account as Hex);
        if (!dead) setBal(row);
      } catch {
        if (!dead) setBal(null);
      }
    };
    void pull();
    const id = window.setInterval(pull, 12_000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

  const put = (rows: Order[]) => {
    ordersRef.current = rows;
    setOrders(rows);
    saveOrders(rows);
  };

  const tapeReserve = quote === 0 ? book?.bemTape ?? 0n : book?.okbTape ?? 0n;
  const quoteReserve = quote === 0 ? book?.bemQuote ?? 0n : book?.okbQuote ?? 0n;
  const quoteUsd = quote === 0 ? book?.bemUsd ?? 0 : book?.okbUsd ?? 0;
  const held = !bal ? 0n : side === "sell" ? bal.tape : quote === 0 ? bal.bem : bal.okb > 2_000_000_000_000_000n ? bal.okb - 2_000_000_000_000_000n : 0n;
  const cap = side === "sell" ? held : maxBuy(tapeReserve, quoteReserve, held);

  const fillPct = (next: number) => {
    setPct(next);
    if (cap <= 0n) return;
    setAmount(poolText((cap * BigInt(next)) / 100n, 8));
  };

  const asks = useMemo(() => walk(tapeReserve, quoteReserve, quoteUsd, true), [tapeReserve, quoteReserve, quoteUsd]);
  const bids = useMemo(() => walk(tapeReserve, quoteReserve, quoteUsd, false), [tapeReserve, quoteReserve, quoteUsd]);
  const askView = useMemo(() => [...asks].reverse(), [asks]);
  const bestAsk = asks[0]?.px ?? 0;
  const bestBid = bids[0]?.px ?? 0;
  const mid = book?.price ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const maxAskSz = Math.max(0.0001, ...askView.map((level) => level.size));
  const maxBidSz = Math.max(0.0001, ...bids.map((level) => level.size));
  const dustTape = bal ? Number(formatUnits(bal.tape, 8)) : 0;
  const dustUsd = dustTape * (mid || 0);
  const bookCol = prefs.bookRem >= 24 ? "xl:grid-cols-[minmax(0,1fr)_24rem_20rem]" : prefs.bookRem <= 16 ? "xl:grid-cols-[minmax(0,1fr)_16rem_20rem]" : "xl:grid-cols-[minmax(0,1fr)_18rem_20rem]";

  const sweepDust = async () => {
    if (!bal || bal.tape <= 0n) return;
    setBusy(true);
    setBad(false);
    try {
      const from = account ?? await connectXLayer();
      setAccount(from);
      await swapPool(from, quote, true, bal.tape);
      announceFill(zh ? "零钱已卖出" : "Dust sold", "TAPE");
      setBal(await poolBalances(from as Hex));
      setNote("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : "";
    setBad(true);
    if (message === "fee") setNote(zh ? "收费地址不对，没有签名。" : "Fee address mismatch. Not signed.");
    else if (message === "gas") setNote(zh ? "OKB 要留下手续费。" : "Keep OKB for gas.");
    else if (message === "amount") setNote(zh ? "数量不对。" : "Size is not valid.");
    else setNote(readPrefs().verboseErrors && message ? message : (zh ? "没有成交。" : "No fill."));
  };

  const swapTape = async (from: string, nextSide: Side, nextQuote: PoolQuote, want: bigint) => {
    const live = bookRef.current;
    const tape = nextQuote === 0 ? live?.bemTape ?? 0n : live?.okbTape ?? 0n;
    const quoteSide = nextQuote === 0 ? live?.bemQuote ?? 0n : live?.okbQuote ?? 0n;
    if (nextSide === "sell") {
      await swapPool(from, nextQuote, true, want);
      return;
    }
    let amountIn = quoteInForTape(tape, quoteSide, want);
    const out = await previewPool(nextQuote, false, amountIn);
    if (out > 0n && out < want) amountIn = (amountIn * want) / out + 1n;
    await swapPool(from, nextQuote, false, amountIn);
  };

  useEffect(() => {
    const id = window.setInterval(() => { void run(); }, 4_000);
    return () => window.clearInterval(id);
    async function run() {
      if (lock.current) return;
      const from = currentAccount();
      const live = bookRef.current;
      const midNow = live?.price ?? 0;
      if (!from || !(midNow > 0)) return;
      let list = ordersRef.current;
      const dead = list.find((order) => order.kind === "chase" && order.startMid > 0 && Math.abs(midNow - order.startMid) / order.startMid > order.maxPct / 100);
      if (dead) list = list.filter((order) => order.id !== dead.id);
      const hit = list.find((order) => ready(order, midNow));
      if (!hit) {
        if (dead) put(list);
        return;
      }
      lock.current = true;
      setBusy(true);
      try {
        const current = list.find((order) => order.id === hit.id) ?? hit;
        let size = BigInt(current.kind === "twap" ? current.slice : current.left);
        if (current.kind === "twap" && current.jitter) {
          const wobble = 80n + BigInt(Math.floor(Math.random() * 41));
          size = size * wobble / 100n;
        }
        const left = BigInt(current.left);
        if (size > left) size = left;
        if (size <= 0n) {
          put(list.filter((order) => order.id !== current.id));
          return;
        }
        await swapTape(from, current.side, current.quote, size);
        announceFill(document.documentElement.lang === "zh" ? "现货成交" : "Spot fill", "TAPE");
        const rest = left - size;
        const fresh = ordersRef.current.filter((order) => order.id !== dead?.id);
        const still = fresh.find((order) => order.id === current.id);
        if (!still) return;
        if (current.kind === "twap" && rest > 0n) {
          put(fresh.map((order) => order.id === current.id ? { ...order, left: rest.toString(), nextAt: Date.now() + order.every } : order));
        } else {
          put(fresh.filter((order) => order.id !== current.id));
        }
        setBal(await poolBalances(from as Hex));
        setBad(false);
        setNote("");
      } catch (err) {
        fail(err);
      } finally {
        lock.current = false;
        setBusy(false);
      }
    }
  }, []);

  const ready = (order: Order, midNow: number) => {
    if (order.kind === "twap") return Date.now() >= order.nextAt;
    if (order.kind === "chase") {
      if (order.startMid > 0 && Math.abs(midNow - order.startMid) / order.startMid > order.maxPct / 100) return false;
      return order.side === "buy" ? midNow <= order.price : midNow >= order.price;
    }
    return order.side === "buy" ? midNow <= order.price : midNow >= order.price;
  };

  const submit = async () => {
    setBad(false);
    if (!freshEnough()) {
      setNote(zh ? "刚回到前台。再点一次。" : "Just came back. Tap again.");
      return;
    }
    if (readPrefs().orderConfirm && !armed) {
      setArmed(true);
      setNote(zh ? "再点一次确认下单" : "Tap again to send");
      return;
    }
    setArmed(false);
    setNote("");
    let want = 0n;
    try { want = poolAmount(amount, 8); } catch { fail(new Error("amount")); return; }
    if (want <= 0n) { fail(new Error("amount")); return; }
    if (mode === "market") {
      setBusy(true);
      try {
        const from = account ?? await connectXLayer();
        setAccount(from);
        await swapTape(from, side, quote, want);
        announceFill(zh ? "现货成交" : "Spot fill", "TAPE");
        setAmount("");
        setBal(await poolBalances(from as Hex));
      } catch (err) {
        fail(err);
      } finally {
        setBusy(false);
      }
      return;
    }
    const from = account ?? await connectXLayer();
    setAccount(from);
    const id = `${Date.now()}`;
    if (mode === "scale") {
      const a = Number(scaleA);
      const b = Number(scaleB);
      const n = Math.min(10, Math.max(2, scaleN));
      if (!(a > 0) || !(b > 0)) { fail(new Error("amount")); return; }
      const parts = slices(want, n, Number(skew) > 0 ? Number(skew) : 1);
      const next = parts.map((part, i) => ({
        id: `${id}-${i}`,
        kind: "limit" as const,
        side,
        quote,
        left: part.toString(),
        price: a + ((b - a) * i) / Math.max(1, n - 1),
        maxPct: 0,
        startMid: mid,
        slice: "0",
        every: 0,
        nextAt: 0,
        jitter: false,
      }));
      put([...ordersRef.current, ...next]);
      return;
    }
    if (mode === "twap") {
      const runtime = (Math.max(0, Number(hours) || 0) * 60 + Math.max(0, Number(mins) || 0)) * 60_000;
      const span = Math.min(7 * 86_400_000, Math.max(5 * 60_000, runtime));
      const every = span >= 30 * 60_000 ? 5 * 60_000 : 60_000;
      const n = Math.max(2, Math.round(span / every));
      const slice = want / BigInt(n);
      if (slice <= 0n) { fail(new Error("amount")); return; }
      put([...ordersRef.current, {
        id, kind: "twap", side, quote, left: want.toString(), price: mid, maxPct: 0, startMid: mid,
        slice: slice.toString(), every, nextAt: Date.now(), jitter,
      }]);
      return;
    }
    const px = Number(mode === "chase" ? chase : price);
    if (!(px > 0)) { fail(new Error("amount")); return; }
    put([...ordersRef.current, {
      id,
      kind: mode === "chase" ? "chase" : "limit",
      side,
      quote,
      left: want.toString(),
      price: px,
      maxPct: Number(maxPct) > 0 ? Number(maxPct) : 1,
      startMid: mid,
      slice: "0",
      every: 0,
      nextAt: 0,
      jitter: false,
    }]);
  };

  const show = (event: MouseEvent, away: number, tape: number, usd: number) => {
    setTip({ x: event.clientX, y: event.clientY, away, avg: tape > 0 ? usd / tape : 0, tape, usd });
  };

  const cumFrom = (rows: Level[], index: number, fromEnd: boolean) => {
    let tape = 0;
    let usd = 0;
    if (fromEnd) {
      for (let i = rows.length - 1; i >= index; i--) { tape += rows[i].size; usd += rows[i].quote; }
    } else {
      for (let i = 0; i <= index; i++) { tape += rows[i].size; usd += rows[i].quote; }
    }
    return { tape, usd };
  };

  const proLabel = mode === "chase" ? (zh ? "追价" : "Chase") : mode === "scale" ? (zh ? "分段" : "Scale") : mode === "twap" ? "TWAP" : (zh ? "专业" : "Pro");

  return (
    <section className="overflow-hidden border border-gold bg-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gold px-3 py-2">
        <button type="button" onClick={onMarkets} className="flex items-center gap-2">
          <CoinMark id="tape" />
          <span className="text-lg font-medium tracking-tight">TAPE/USDT0</span>
          <PairChevron />
          <span className="lev-chip rounded px-1.5 py-0.5 text-[11px]">{zh ? "现货" : "Spot"}</span>
        </button>
        <p className="font-mono text-sm">{money(mid)}</p>
        <p className={`font-mono text-sm ${((book?.change ?? 0) < 0) ? "text-sell" : "text-up"}`}>
          {book ? `${book.change >= 0 ? "+" : ""}${(book.change * 100).toFixed(2)}%` : "—"}
        </p>
        <p className="font-mono text-sm text-ink/70">{book ? money(book.volume) : "—"}</p>
        <button type="button" onClick={onOtc} className="ml-auto h-7 border border-gold/40 px-2 text-xs text-ink/70">OTC</button>
        <a className="font-mono text-[11px] text-ink/40 underline" href={`https://www.oklink.com/xlayer/address/${POOL}`} target="_blank" rel="noreferrer">0x58ea…8484</a>
      </div>
      <div className={`grid items-start ${bookCol}`}>
        <div className="order-1 min-w-0">
          <Kline
            bars={bars}
            mark={mid}
            lang={zh ? "zh" : "en"}
            desk="spot"
            frame={frame}
            frames={FRAMES.map(([id, zhLabel, enLabel]) => ({ id, label: zh ? zhLabel : enLabel }))}
            onFrame={(id) => setFrame(id as CandleFrame)}
            onPrice={(px) => { setMode("limit"); setPrice(px >= 1 ? px.toFixed(4) : px.toFixed(6)); }}
          />
          {prefs.chartPrints && book?.prints.length ? (
            <div className="flex h-5 items-center gap-px overflow-hidden px-2" aria-hidden>
              {book.prints.slice(0, 48).map((row) => (
                <span key={`${row.tx}-${row.t}`} className={row.tapeIn ? "text-sell" : "text-up"} style={{ fontSize: 11, lineHeight: 1 }}>▲</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="order-3 min-w-0 border-t border-gold xl:order-2 xl:border-t-0 xl:border-l" onMouseLeave={() => setTip(null)}>
          <div className="flex h-9 items-center gap-3 border-b border-gold px-3 text-xs">
            <button type="button" onClick={() => setTab("book")} className={tab === "book" ? "tab-on" : "text-ink/45"}>{zh ? "订单簿" : "Book"}</button>
            <button type="button" onClick={() => setTab("tape")} className={tab === "tape" ? "tab-on" : "text-ink/45"}>{zh ? "最新成交" : "Trades"}</button>
          </div>
          {tab === "book" ? (
            <>
              <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-ink/40">
                <span>{zh ? "价格" : "Price"}</span>
                <span className="text-right">{zh ? "数量" : "Size"}</span>
                <span className="text-right">{zh ? "合计" : "Total"}</span>
              </div>
              <div className="max-h-[28rem] overflow-auto">
                {askView.map((level, index) => {
                  const cum = cumFrom(askView, index, true);
                  return (
                    <button key={`a-${index}`} type="button" onClick={() => { setMode("limit"); setSide("buy"); setPrice(level.px.toPrecision(6)); if (readPrefs().bookSetsSize) setAmount(level.size.toFixed(4)); setArmed(false); }} onMouseMove={(event) => show(event, mid > 0 ? (level.px - mid) / mid : 0, cum.tape, cum.usd)} className="relative grid w-full grid-cols-3 overflow-hidden px-2 py-[3px] text-left font-mono text-[12px] hover:bg-white/5">
                      <span aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 bg-sell/15 ${prefs.bookAnimate ? "transition-[width] duration-500" : ""}`} style={{ width: `${Math.min(100, (level.size / maxAskSz) * 100)}%` }} />
                      <span className="relative text-sell">{money(level.px)}</span>
                      <span className="relative text-right text-ink/80">{level.size.toFixed(2)}</span>
                      <span className="relative text-right text-ink/45">{money(cum.usd)}</span>
                    </button>
                  );
                })}
                <p className="border-y border-gold/30 px-2 py-1 font-mono text-sm">
                  {money(mid)}
                  <span className="ml-2 text-[11px] text-ink/40">{spread > 0 ? `${money(spread)} · ${mid > 0 ? ((spread / mid) * 100).toFixed(3) : "0"}%` : ""}</span>
                </p>
                {bids.map((level, index) => {
                  const cum = cumFrom(bids, index, false);
                  return (
                    <button key={`b-${index}`} type="button" onClick={() => { setMode("limit"); setSide("sell"); setPrice(level.px.toPrecision(6)); if (readPrefs().bookSetsSize) setAmount(level.size.toFixed(4)); setArmed(false); }} onMouseMove={(event) => show(event, mid > 0 ? (level.px - mid) / mid : 0, cum.tape, cum.usd)} className="relative grid w-full grid-cols-3 overflow-hidden px-2 py-[3px] text-left font-mono text-[12px] hover:bg-white/5">
                      <span aria-hidden className={`pointer-events-none absolute inset-y-0 right-0 bg-up/15 ${prefs.bookAnimate ? "transition-[width] duration-500" : ""}`} style={{ width: `${Math.min(100, (level.size / maxBidSz) * 100)}%` }} />
                      <span className="relative text-up">{money(level.px)}</span>
                      <span className="relative text-right text-ink/80">{level.size.toFixed(2)}</span>
                      <span className="relative text-right text-ink/45">{money(cum.usd)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="max-h-[28rem] overflow-auto">
              <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-ink/40">
                <span>{zh ? "价格" : "Price"}</span>
                <span className="text-right">TAPE</span>
                <span className="text-right">{zh ? "时间" : "Time"}</span>
              </div>
              {book?.prints.map((row, index) => (
                <p key={`${row.tx}-${index}`} className="grid grid-cols-3 px-2 py-[3px] font-mono text-[12px]">
                  <span className={row.tapeIn ? "text-sell" : "text-up"}>{money(row.usd)}</span>
                  <span className="text-right text-ink/80">{row.tape.toFixed(2)}</span>
                  <span className="text-right text-ink/45">{clock(row.t)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="relative order-2 border-t border-gold p-3 xl:order-3 xl:border-t-0 xl:border-l">
          <div className="grid grid-cols-3 gap-1">
            <button type="button" onClick={() => { setMode("market"); setMenu(false); }} className={`h-10 text-sm ${mode === "market" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zh ? "市价" : "Market"}</button>
            <button type="button" onClick={() => { setMode("limit"); setMenu(false); }} className={`h-10 text-sm ${mode === "limit" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zh ? "限价" : "Limit"}</button>
            <button type="button" onClick={() => setMenu((on) => !on)} className={`inline-flex h-10 items-center justify-center gap-1 text-sm ${mode === "chase" || mode === "scale" || mode === "twap" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{proLabel}<PairChevron up={menu} /></button>
          </div>
          {menu ? (
            <div className="absolute right-3 z-20 mt-1 w-36 border border-gold bg-card">
              {([
                ["chase", zh ? "追价" : "Chase"],
                ["scale", zh ? "分段订单" : "Scale"],
                ["twap", "TWAP"],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => { setMode(id); setMenu(false); }} className="block h-9 w-full px-3 text-left text-sm hover:bg-white/5">{label}</button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setSide("buy")} className={`h-10 text-sm ${side === "buy" ? "bg-ink" : "quiet-buy"}`}>{zh ? "买入" : "Buy"}</button>
            <button type="button" onClick={() => setSide("sell")} className={`h-10 text-sm ${side === "sell" ? "bg-sell text-[#fff7f8]" : "quiet-sell"}`}>{zh ? "卖出" : "Sell"}</button>
          </div>
          <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-ink/55">
            <span>{zh ? "可用" : "Available"}</span>
            <span>{bal ? (side === "sell" ? `${poolText(held, 8)} TAPE` : `${poolText(held, quote === 0 ? 8 : 18)} ${quote === 0 ? "BEM" : "OKB"}`) : "—"}</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setQuote(0)} className={`h-8 text-xs ${quote === 0 ? "bg-ink" : "border border-gold/40 text-ink/60"}`}>BEM</button>
            <button type="button" onClick={() => setQuote(1)} className={`h-8 text-xs ${quote === 1 ? "bg-ink" : "border border-gold/40 text-ink/60"}`}>OKB</button>
          </div>
          {mode === "market" ? (
            <p className="mt-2 flex items-center justify-between border border-gold/40 px-2 py-2 font-mono">
              <span className="text-[11px] text-ink/45">{zh ? "价格" : "Price"}</span>
              <span>{money(mid)} <span className="text-[11px] text-ink/40">Mid</span></span>
            </p>
          ) : null}
          {mode === "limit" ? (
            <label className="mt-2 block border border-gold/40 px-2 py-2">
              <span className="text-[11px] text-ink/45">USDT</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-lg outline-none" />
            </label>
          ) : null}
          {mode === "chase" ? (
            <div className="mt-2 grid gap-1">
              <label className="block border border-gold/40 px-2 py-2">
                <span className="text-[11px] text-ink/45">{zh ? "追价" : "Chase"}</span>
                <input value={chase} onChange={(event) => setChase(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-lg outline-none" />
              </label>
              <label className="block border border-gold/40 px-2 py-2">
                <span className="text-[11px] text-ink/45">{zh ? "最大追价距离 %" : "Max chase %"}</span>
                <input value={maxPct} onChange={(event) => setMaxPct(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono outline-none" />
              </label>
            </div>
          ) : null}
          {mode === "scale" ? (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <input value={scaleA} onChange={(event) => setScaleA(event.target.value)} inputMode="decimal" placeholder={zh ? "开始" : "Start"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={scaleB} onChange={(event) => setScaleB(event.target.value)} inputMode="decimal" placeholder={zh ? "结束" : "End"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={String(scaleN)} onChange={(event) => setScaleN(Math.min(10, Math.max(2, Number(event.target.value) || 2)))} inputMode="numeric" className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={skew} onChange={(event) => setSkew(event.target.value)} inputMode="decimal" placeholder={zh ? "数量偏差" : "Skew"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
            </div>
          ) : null}
          {mode === "twap" ? (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <input value={hours} onChange={(event) => setHours(event.target.value)} inputMode="numeric" placeholder={zh ? "小时" : "Hours"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={mins} onChange={(event) => setMins(event.target.value)} inputMode="numeric" placeholder={zh ? "分钟" : "Minutes"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <button type="button" onClick={() => setJitter((on) => !on)} className={`col-span-2 h-8 text-xs ${jitter ? "bg-ink" : "border border-gold/40 text-ink/60"}`}>{zh ? "随机化" : "Randomize"}</button>
            </div>
          ) : null}
          <label className="mt-2 block border border-gold/40 px-2 py-2">
            <span className="text-[11px] text-ink/45">TAPE</span>
            <input value={amount} onChange={(event) => { setAmount(event.target.value); setPct(0); setArmed(false); }} inputMode="decimal" suppressHydrationWarning className="w-full bg-transparent font-mono text-lg outline-none" />
          </label>
          <input type="range" min={0} max={100} value={pct} onChange={(event) => fillPct(Number(event.target.value))} suppressHydrationWarning className="mt-2 w-full" />
          <div className="mt-1 grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((item) => (
              <button key={item} type="button" onClick={() => fillPct(item)} className="h-7 border border-gold/30 font-mono text-[11px] text-ink/60">{item}%</button>
            ))}
          </div>
          {mode === "limit" || mode === "scale" ? <p className="mt-2 text-right font-mono text-[11px] text-ink/40">GTC</p> : null}
          {prefs.dustSweep && dustTape > 0 && dustUsd > 0 && dustUsd < 1 ? (
            <button type="button" disabled={busy} onClick={() => { void sweepDust(); }} className="mt-2 h-8 w-full border border-gold/40 text-xs disabled:opacity-40">
              {zh ? `清理 ${dustTape.toPrecision(3)} TAPE` : `Sweep ${dustTape.toPrecision(3)} TAPE`}
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => { void submit(); }} className={`mt-3 h-11 w-full text-sm disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell text-[#fff7f8]"}`}>
            {busy ? (zh ? "等待钱包" : "Waiting") : armed ? (zh ? "再点确认" : "Tap to confirm") : mode === "twap" ? (zh ? "启用" : "Start") : side === "buy" ? (zh ? "买入 TAPE" : "Buy TAPE") : zh ? "卖出 TAPE" : "Sell TAPE"}
          </button>
          {note ? <p className={`mt-2 text-xs leading-5 ${bad ? "text-sell" : "text-ink/80"}`}>{note}</p> : null}
        </div>
      </div>
      <div className="border-t border-gold">
        <div className="flex gap-1 overflow-x-auto px-2 pt-1">
          {([
            ["bal", zh ? "余额" : "Balances"],
            ["rest", zh ? `当前委托 (${orders.length})` : `Orders (${orders.length})`],
            ["fills", zh ? "成交" : "Trades"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setDock(id)} className={`h-8 shrink-0 px-2 text-xs ${dock === id ? "tab-on" : "text-ink/45"}`}>{label}</button>
          ))}
        </div>
        <div className="min-h-14 px-3 py-2 text-xs">
          {dock === "bal" ? <p className="font-mono text-ink/70">{bal ? `${poolText(bal.bem, 8)} BEM · ${poolText(bal.okb, 18)} OKB · ${poolText(bal.tape, 8)} TAPE` : "—"}</p> : null}
          {dock === "rest" ? (
            <div className="flex flex-col gap-1 font-mono">
              {orders.map((order) => (
                <p key={order.id} className="flex flex-wrap items-center gap-3">
                  <span>{order.kind === "limit" ? (zh ? "限价" : "Limit") : order.kind === "chase" ? (zh ? "追价" : "Chase") : "TWAP"}</span>
                  <span>{order.side === "buy" ? (zh ? "买" : "Buy") : zh ? "卖" : "Sell"}</span>
                  <span>{money(order.price)}</span>
                  <span>{poolText(BigInt(order.left), 8)} TAPE</span>
                  <button type="button" className="underline" onClick={() => put(ordersRef.current.filter((row) => row.id !== order.id))}>{zh ? "取消" : "Cancel"}</button>
                </p>
              ))}
            </div>
          ) : null}
          {dock === "fills" ? (
            <div className="flex flex-col gap-1 font-mono">
              {book?.prints.filter((row) => account && row.sender.toLowerCase() === account.toLowerCase()).map((row, index) => (
                <p key={`${row.tx}-${index}`}>{clock(row.t)} · {row.tapeIn ? (zh ? "卖" : "Sell") : zh ? "买" : "Buy"} · {money(row.usd)} · {row.tape.toFixed(4)}</p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {tip ? (
        <div className="pointer-events-none fixed z-30 border border-gold bg-card px-3 py-2 font-mono text-[11px] text-ink" style={{ left: Math.min(tip.x + 12, window.innerWidth - 180), top: tip.y + 12 }}>
          <p>{zh ? "距中间价" : "From mid"} <span className="float-right ml-4">{(tip.away * 100).toFixed(3)}%</span></p>
          <p>{zh ? "平均价格" : "Average"} <span className="float-right ml-4">{money(tip.avg)}</span></p>
          <p>{zh ? "合计 TAPE" : "Total TAPE"} <span className="float-right ml-4">{tip.tape.toFixed(2)}</span></p>
          <p>{zh ? "合计 USDT" : "Total USDT"} <span className="float-right ml-4">{money(tip.usd)}</span></p>
        </div>
      ) : null}
    </section>
  );
}
