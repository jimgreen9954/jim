import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { formatUnits, type Hex } from "viem";
import { Kline, type Bar } from "@/components/exchange/kline";
import { PairChevron } from "@/components/exchange/pair-chevron";
import type { DeskView, TapePair } from "@/components/exchange/desk-chrome";
import { PhoneChrome, wantedPane, type PhonePane } from "@/components/exchange/phone-desk";
import { CoinMark } from "@/components/exchange/coin-mark";
import { announceFill, readPrefs, useDeskPrefs } from "@/lib/desk-prefs";
import { markDeskFill } from "@/lib/red-packet";
import { tapePoolCandles, readOpenBook, type OpenBook } from "@/lib/tape-open-candles";
import type { CandleFrame } from "@/lib/bem-ohlcv";
import { currentAccount, onAccount } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";
import { fmt } from "@/lib/format";
import { TradeLog } from "@/components/exchange/trade-foot";
import { poolAmount, poolBalances, poolText, previewPool, swapPool, buyOkbWithUsdt0, quoteUsdt0Okb, sellTapeForUsdt0, type PoolQuote } from "@/lib/tape-open-swap";

const FRAMES: [CandleFrame, string, string][] = [
  ["15s", "15秒", "15s"], ["1m", "1分", "1m"], ["5m", "5分", "5m"], ["15m", "15分", "15m"],
  ["1h", "1时", "1h"], ["4h", "4时", "4h"], ["1d", "1日", "1d"], ["1w", "一周", "1w"],
  ["1M", "一月", "1M"], ["3M", "三月", "3M"], ["1y", "一年", "1y"],
];
const KEY = "tapeliquid-pool-orders";
const POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484";

function connectHere() {
  return import("@/lib/xlayer").then((mod) => mod.connectXLayer());
}

function seedBars(): Bar[] {
  try {
    const n = Number(sessionStorage.getItem("tl-tape-px") || "");
    if (!(n > 0)) return [];
    const t = Math.floor(Date.now() / 1000 / 3600) * 3600;
    return [{ t, o: n, h: n, l: n, c: n, v: 0 }];
  } catch {
    return [];
  }
}

type Mode = "market" | "limit" | "chase" | "scale" | "twap";
type Side = "buy" | "sell";
type Order = {
  id: string;
  kind: "limit" | "chase" | "twap";
  side: Side;
  quote: PoolQuote;
  pair?: TapePair;
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
  if (n >= 1000) return fmt(n, 2);
  if (n >= 1) return fmt(n, 4);
  return n.toPrecision(4);
}

function clock(t: number): string {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function heldText(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: digits });
}

function usdText(n: number): string {
  if (!(n > 0) || !Number.isFinite(n)) return "$0.00";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function balRows(
  bal: { bem: bigint; okb: bigint; tape: bigint; usdt: bigint },
  book: OpenBook | null,
  hideDust: boolean,
  active: TapePair,
) {
  const tape = Number(formatUnits(bal.tape, 8));
  const usdt = Number(formatUnits(bal.usdt, 6));
  const bem = Number(formatUnits(bal.bem, 8));
  const okb = Number(formatUnits(bal.okb, 18));
  const okbFree = bal.okb > 2_000_000_000_000_000n ? Number(formatUnits(bal.okb - 2_000_000_000_000_000n, 18)) : 0;
  const tapePx = book?.price ?? 0;
  const rows = [
    { sym: "TAPE", total: heldText(tape, 8), avail: heldText(tape, 8), value: tapePx > 0 ? usdText(tape * tapePx) : "—", usd: tape * tapePx, keep: true },
    { sym: "USDT0", total: heldText(usdt, 4), avail: heldText(usdt, 4), value: usdText(usdt), usd: usdt, keep: active === "usdt" },
    { sym: "BEM", total: heldText(bem, 4), avail: heldText(bem, 4), value: book?.bemUsd ? usdText(bem * book.bemUsd) : "—", usd: (book?.bemUsd ?? 0) * bem, keep: active === "bem" },
    { sym: "OKB", total: heldText(okb, 4), avail: heldText(okbFree, 4), value: book?.okbUsd ? usdText(okb * book.okbUsd) : "—", usd: (book?.okbUsd ?? 0) * okb, keep: active === "okb" },
  ];
  return hideDust ? rows.filter((row) => row.keep || row.usd >= 1) : rows;
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

function walk(tapeRaw: bigint, quoteRaw: bigint, quoteDec: number, buy: boolean): Level[] {
  const tape0 = Number(formatUnits(tapeRaw, 8));
  const quote0 = Number(formatUnits(quoteRaw, quoteDec));
  if (!(tape0 > 0 && quote0 > 0)) return [];
  const rows: Level[] = [];
  let t = tape0;
  let q = quote0;
  for (let i = 0; i < 12; i++) {
    const size = tape0 * 0.004 * (1 + i * 0.18);
    if (!(size > 0) || size >= t * 0.25) break;
    if (buy) {
      const net = (size * q) / (t - size);
      const paid = net / 0.998;
      rows.push({ px: paid / size, size, quote: paid });
      t -= size;
      q += net;
    } else {
      const net = size * 0.998;
      const out = (q * net) / (t + net);
      rows.push({ px: out / size, size, quote: out });
      t += net;
      q -= out;
    }
  }
  return rows;
}

function scaleLevel(level: Level, unit: number): Level {
  if (!(unit > 0)) return { px: 0, size: level.size, quote: 0 };
  return { px: level.px * unit, size: level.size, quote: level.quote * unit };
}

export function PoolSpot({ onMarkets, onOtc, onJump, pair = "usdt", onPair }: { onMarkets: () => void; onOtc: () => void; onJump?: (view: DeskView) => void; pair?: TapePair; onPair?: (next: TapePair) => void }) {
  const zh = useExchange((s) => s.lang) !== "en";
  const prefs = useDeskPrefs();
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [book, setBook] = useState<OpenBook | null>(null);
  const [bars, setBars] = useState<Bar[]>(seedBars);
  const [frame, setFrame] = useState<CandleFrame>("1h");
  const [mode, setMode] = useState<Mode>("market");
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState<Side>("buy");
  const [phone, setPhone] = useState<PhonePane>(wantedPane());
  useEffect(() => {
    const chart = () => setPhone("chart");
    const trade = () => setPhone("ticket");
    window.addEventListener("tape-chart", chart);
    window.addEventListener("tape-trade", trade);
    return () => {
      window.removeEventListener("tape-chart", chart);
      window.removeEventListener("tape-trade", trade);
    };
  }, []);
  const [pairMenu, setPairMenu] = useState(false);
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
  const [dock, setDock] = useState<"bal" | "rest" | "twap" | "chase" | "fills">("bal");
  const [hideDust, setHideDust] = useState(false);
  const [orders, setOrders] = useState<Order[]>(() => loadOrders());
  const [bal, setBal] = useState<{ bem: bigint; okb: bigint; tape: bigint; usdt: bigint } | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [armed, setArmed] = useState(false);
  const ordersRef = useRef(orders);
  const bookRef = useRef(book);
  const pairRef = useRef<TapePair>(pair);
  const midRef = useRef(0);
  const lock = useRef(false);
  ordersRef.current = orders;
  bookRef.current = book;

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readOpenBook().then((row) => {
        if (dead) return;
        setBook(row);
        if (row.price > 0) {
          try { sessionStorage.setItem("tl-tape-px", String(row.price)); } catch { /* ignore */ }
        }
      }).catch(() => undefined);
      window.setTimeout(() => {
        if (dead) return;
        tapePoolCandles(frame, pair).then((rows) => { if (!dead) setBars(rows); }).catch(() => undefined);
      }, 700);
    };
    pull();
    const id = window.setInterval(pull, 12_000);
    return () => { dead = true; window.clearInterval(id); };
  }, [frame, pair]);

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

  const active: TapePair = pair;
  const quoteSym = active === "usdt" ? "USDT0" : active === "bem" ? "BEM" : "OKB";
  const quoteDec = active === "usdt" ? 6 : active === "bem" ? 8 : 18;
  const openQuote: PoolQuote = active === "okb" ? 1 : 0;
  const tapeReserve = active === "bem" ? book?.bemTape ?? 0n : active === "okb" ? book?.okbTape ?? 0n : 0n;
  const quoteReserve = active === "bem" ? book?.bemQuote ?? 0n : active === "okb" ? book?.okbQuote ?? 0n : 0n;
  const buyHeld = !bal ? 0n : active === "usdt" ? bal.usdt : active === "bem" ? bal.bem : bal.okb > 2_000_000_000_000_000n ? bal.okb - 2_000_000_000_000_000n : 0n;

  const fillPct = (next: number) => {
    setPct(next);
    if (side === "sell") {
      if (!bal || bal.tape <= 0n) return;
      setAmount(poolText((bal.tape * BigInt(next)) / 100n, 8));
      return;
    }
    if (active === "usdt") {
      const px = midRef.current;
      if (!(px > 0) || buyHeld <= 0n) return;
      const tape = BigInt(Math.floor(Number(formatUnits(buyHeld, 6)) / px * 1e8 * next / 100));
      if (tape > 0n) setAmount(poolText(tape, 8));
      return;
    }
    const room = maxBuy(tapeReserve, quoteReserve, buyHeld);
    if (room <= 0n) return;
    setAmount(poolText((room * BigInt(next)) / 100n, 8));
  };

  const asks = useMemo(() => {
    if (active !== "usdt") return walk(tapeReserve, quoteReserve, quoteDec, true);
    const bem = walk(book?.bemTape ?? 0n, book?.bemQuote ?? 0n, 8, true).map((level) => scaleLevel(level, book?.bemUsd ?? 0));
    const okb = walk(book?.okbTape ?? 0n, book?.okbQuote ?? 0n, 18, true).map((level) => scaleLevel(level, book?.okbUsd ?? 0));
    return [...bem, ...okb].filter((level) => level.px > 0).sort((a, b) => a.px - b.px);
  }, [active, tapeReserve, quoteReserve, quoteDec, book]);
  const bids = useMemo(() => {
    if (active !== "usdt") return walk(tapeReserve, quoteReserve, quoteDec, false);
    const bem = walk(book?.bemTape ?? 0n, book?.bemQuote ?? 0n, 8, false).map((level) => scaleLevel(level, book?.bemUsd ?? 0));
    const okb = walk(book?.okbTape ?? 0n, book?.okbQuote ?? 0n, 18, false).map((level) => scaleLevel(level, book?.okbUsd ?? 0));
    return [...bem, ...okb].filter((level) => level.px > 0).sort((a, b) => b.px - a.px);
  }, [active, tapeReserve, quoteReserve, quoteDec, book]);
  const askView = useMemo(() => [...asks].reverse().slice(-10), [asks]);
  const bidView = useMemo(() => bids.slice(0, 10), [bids]);
  const bestAsk = asks[0]?.px ?? 0;
  const bestBid = bids[0]?.px ?? 0;
  const mid = active === "usdt"
    ? book?.price ?? 0
    : (() => {
        const tape0 = Number(formatUnits(tapeReserve, 8));
        const quote0 = Number(formatUnits(quoteReserve, quoteDec));
        return tape0 > 0 && quote0 > 0 ? quote0 / tape0 : 0;
      })();
  pairRef.current = active;
  midRef.current = mid;
  const sizeN = Number(amount);
  const pxN = (mode === "limit" || mode === "scale") && Number(price) > 0 ? Number(price) : mid;
  const notional = sizeN > 0 && pxN > 0 ? sizeN * pxN : 0;
  const buyTapeN = active === "usdt"
    ? (mid > 0 ? Number(formatUnits(buyHeld, 6)) / mid : 0)
    : Number(formatUnits(maxBuy(tapeReserve, quoteReserve, buyHeld), 8));
  const buyTapeLabel = buyTapeN > 0 ? buyTapeN.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const maxAskSz = Math.max(0.0001, ...askView.map((level) => level.size));
  const maxBidSz = Math.max(0.0001, ...bidView.map((level) => level.size));
  const dustTape = bal ? Number(formatUnits(bal.tape, 8)) : 0;
  const dustUsd = dustTape * (mid || 0);
  const bookCol = prefs.bookRem >= 24 ? "xl:grid-cols-[minmax(0,1fr)_24rem_20rem]" : prefs.bookRem <= 16 ? "xl:grid-cols-[minmax(0,1fr)_16rem_20rem]" : "xl:grid-cols-[minmax(0,1fr)_18rem_20rem]";

  const sweepDust = async () => {
    if (!bal || bal.tape <= 0n) return;
    setBusy(true);
    setBad(false);
    try {
      const from = account ?? await connectHere();
      setAccount(from);
      await swapTape(from, "sell", pairRef.current, bal.tape);
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
    const code = (err as { code?: number }).code;
    setBad(true);
    if (code === 4001 || /reject|denied|cancel/i.test(message)) setNote(zh ? "钱包拒绝了签名。" : "The wallet rejected the signature.");
    else if (message === "chain" || /chain/i.test(message)) setNote(zh ? "钱包要停在 X Layer。切过去再点一次。" : "The wallet has to be on X Layer. Switch, then tap again.");
    else if (message === "nowallet" || message === "binanceapp") setNote(zh ? "先连接钱包。现货只走 X Layer。" : "Connect a wallet. Spot is on X Layer.");
    else if (message === "leg") setNote(zh ? "OKB 还在钱包里。再点一次卖出，下一笔签名换成 USDT0。" : "The OKB is still in the wallet. Tap sell again. The next signature pays USDT0.");
    else if (message === "fee") setNote(zh ? "收费地址不对，没有签名。" : "Fee address mismatch. Not signed.");
    else if (message === "gas") setNote(zh ? "OKB 要留下手续费。" : "Keep OKB for gas.");
    else if (message === "amount") setNote(zh ? "数量不对。" : "Size is not valid.");
    else if (message === "empty") setNote(zh ? "池子接不住这一笔。" : "The pool cannot fill this size.");
    else setNote(message ? message.slice(0, 80) : (zh ? "没有成交。" : "No fill."));
  };

  const swapTape = async (from: string, nextSide: Side, which: TapePair, want: bigint) => {
    if (which === "usdt") {
      let live = bookRef.current;
      if (!live || live.okbTape <= 0n) {
        live = await readOpenBook();
        bookRef.current = live;
      }
      const tape = live.okbTape;
      const quoteSide = live.okbQuote;
      if (nextSide === "sell") {
        setNote(zh ? "第一笔是池子付 OKB。签完后下一笔才换成 USDT0。" : "The first signature pays OKB. The next one turns it into USDT0.");
        await sellTapeForUsdt0(from, want);
        markDeskFill("xlayer", from, "spot", Number(formatUnits(want, 8)) * (midRef.current || 0), "tape");
        setNote("");
        return;
      }
      let okbIn = quoteInForTape(tape, quoteSide, want);
      const seen = await previewPool(1, false, okbIn);
      if (seen > 0n && seen < want) okbIn = (okbIn * want) / seen + 1n;
      const need = okbIn + 2_000_000_000_000_000n;
      const one = await quoteUsdt0Okb("sell", 10n ** 18n);
      if (one <= 0n || need <= 0n) throw new Error("empty");
      let usdt = (need * one * 1000n) / (10n ** 18n * 998n);
      if (usdt <= 0n) usdt = 1n;
      for (let i = 0; i < 4; i++) {
        const got = await quoteUsdt0Okb("buy", (usdt * 998n) / 1000n);
        if (got >= need) break;
        usdt = got > 0n ? (usdt * (need + got / 20n)) / got : usdt * 2n;
      }
      const bought = await buyOkbWithUsdt0(from, usdt);
      try {
        const spend = bought > okbIn ? okbIn : bought;
        if (spend <= 0n) throw new Error("empty");
        await swapPool(from, 1, false, spend);
      } catch {
        throw new Error("leg");
      }
      markDeskFill("xlayer", from, "spot", Number(formatUnits(usdt, 6)), "tape");
      return;
    }
    const nextQuote: PoolQuote = which === "okb" ? 1 : 0;
    const live = bookRef.current;
    const tape = nextQuote === 0 ? live?.bemTape ?? 0n : live?.okbTape ?? 0n;
    const quoteSide = nextQuote === 0 ? live?.bemQuote ?? 0n : live?.okbQuote ?? 0n;
    if (nextSide === "sell") {
      await swapPool(from, nextQuote, true, want);
      markDeskFill("xlayer", from, "spot", Number(formatUnits(want, 8)) * (midRef.current || 0), "tape");
      return;
    }
    let amountIn = quoteInForTape(tape, quoteSide, want);
    const out = await previewPool(nextQuote, false, amountIn);
    if (out > 0n && out < want) amountIn = (amountIn * want) / out + 1n;
    await swapPool(from, nextQuote, false, amountIn);
    markDeskFill("xlayer", from, "spot", Number(formatUnits(want, 8)) * (midRef.current || 0), "tape");
  };

  useEffect(() => {
    const id = window.setInterval(() => { void run(); }, 4_000);
    return () => window.clearInterval(id);
    async function run() {
      if (lock.current) return;
      const from = currentAccount();
      const midNow = midRef.current;
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
        await swapTape(from, current.side, current.pair ?? (current.quote === 1 ? "okb" : "bem"), size);
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
    setArmed(false);
    setNote("");
    let want = 0n;
    try { want = poolAmount(amount, 8); } catch { fail(new Error("amount")); return; }
    if (want <= 0n) { fail(new Error("amount")); return; }
    if (side === "sell") {
      if (bal && want > bal.tape) { setBad(true); setNote(zh ? "TAPE 不够。" : "Not enough TAPE."); return; }
    } else if (active !== "usdt") {
      if (bal) {
        try {
          const live = bookRef.current;
          const tape = openQuote === 0 ? live?.bemTape ?? 0n : live?.okbTape ?? 0n;
          const quoteSide = openQuote === 0 ? live?.bemQuote ?? 0n : live?.okbQuote ?? 0n;
          const need = quoteInForTape(tape, quoteSide, want);
          if (need > buyHeld) { setBad(true); setNote(zh ? `${quoteSym} 不够。` : `Not enough ${quoteSym}.`); return; }
        } catch {
          fail(new Error("amount"));
          return;
        }
      }
    } else if (bal && buyHeld <= 0n) {
      setBad(true);
      setNote(zh ? "这张 USDT0 不够。别的 USDT 不能付。" : "Not enough of this USDT0. Another USDT cannot pay.");
      return;
    }
    if (mode === "market") {
      setBusy(true);
      try {
        const from = account ?? await connectHere();
        setAccount(from);
        await swapTape(from, side, pairRef.current, want);
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
    try {
      const from = account ?? await connectHere();
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
        quote: openQuote,
        pair: active,
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
        id, kind: "twap", side, quote: openQuote, pair: active, left: want.toString(), price: mid, maxPct: 0, startMid: mid,
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
      quote: openQuote,
      pair: active,
      left: want.toString(),
      price: px,
      maxPct: Number(maxPct) > 0 ? Number(maxPct) : 1,
      startMid: mid,
      slice: "0",
      every: 0,
      nextAt: 0,
      jitter: false,
    }]);
    } catch (err) {
      fail(err);
    }
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
    <section className="phone-desk spot-split min-w-0 overflow-hidden border border-gold bg-card" data-phone={phone}>
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold px-3 py-2">
        <button type="button" onClick={() => setPairMenu((on) => !on)} className="flex min-w-0 items-center gap-2">
          <CoinMark id="tape" />
          <span className="truncate text-lg font-medium tracking-tight">TAPE/{quoteSym}</span>
          <PairChevron up={pairMenu} />
          <span className="lev-chip shrink-0 rounded px-1.5 py-0.5 text-[11px]">{zh ? "现货" : "Spot"}</span>
        </button>
        {pairMenu ? (
          <div className="absolute left-2 top-12 z-30 w-52 border border-gold bg-card shadow-plate">
            <p className="px-3 pt-2 text-[10px] text-ink/40">{zh ? "热门" : "Hot"}</p>
            {([
              ["bem", "BEM/USDT"],
              ["btc", "BTC/USDT"],
              ["eth", "ETH/USDT"],
              ["bnb", "BNB/USDT"],
              ["okb", "OKB/USDT0"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => { setPairMenu(false); onJump?.({ kind: "pancake", pair: id }); }} className="block h-10 w-full px-3 text-left text-sm hover:bg-foil/70">{label}</button>
            ))}
            <p className="border-t border-gold/40 px-3 pt-2 text-[10px] text-ink/40">TAPE</p>
            {([
              ["usdt", "TAPE/USDT0"],
              ["bem", "TAPE/BEM"],
              ["okb", "TAPE/OKB"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => { onPair?.(id); setPairMenu(false); }} className={`block h-10 w-full px-3 text-left text-sm ${active === id ? "bg-foil" : "hover:bg-foil/70"}`}>{label}</button>
            ))}
            <button type="button" onClick={() => { setPairMenu(false); onMarkets(); }} className="block h-10 w-full border-t border-gold/40 px-3 text-left text-sm text-ink/60">{zh ? "全部市场" : "All markets"}</button>
          </div>
        ) : null}
        <p className="font-mono text-sm">{money(mid)} <span className="text-[11px] text-ink/40">{quoteSym}</span></p>
        <p className={`font-mono text-sm ${((book?.change ?? 0) < 0) ? "text-sell" : "text-up"}`}>
          {book ? `${book.change >= 0 ? "+" : ""}${(book.change * 100).toFixed(2)}%` : "—"}
        </p>
        <p className="font-mono text-sm text-ink/70">{book ? money(book.volume) : "—"}</p>
        <button type="button" onClick={onOtc} className="ml-auto h-7 shrink-0 border border-gold/40 px-2 text-xs text-ink/70">OTC</button>
        <a className="hidden max-w-[8rem] truncate font-mono text-[11px] text-ink/40 underline sm:inline" href={`https://www.oklink.com/xlayer/address/${POOL}`} target="_blank" rel="noreferrer">0x58ea…8484</a>
      </div>
      <PhoneChrome zh={zh} pane={phone} setPane={setPhone} sheet={false} onBuy={() => { setSide("buy"); setPhone("ticket"); }} onSell={() => { setSide("sell"); setPhone("ticket"); }} />
      <div className={`spot-grid grid min-w-0 items-start ${bookCol}`} data-phone={phone}>
        <div className="ph-chart order-1 min-w-0">
          <Kline
            bars={bars}
            mark={mid}
            lang={zh ? "zh" : "en"}
            desk="spot"
            frame={frame}
            frames={FRAMES.map(([id, zhLabel, enLabel]) => ({ id, label: zh ? zhLabel : enLabel }))}
            onFrame={(id) => setFrame(id as CandleFrame)}
            onPrice={(px) => { setMode("limit"); setPrice(px >= 1 ? px.toFixed(4) : px.toFixed(6)); setPhone("ticket"); }}
          />
          {prefs.chartPrints && book?.prints.length ? (
            <div className="print-tape flex h-5 items-end gap-px overflow-hidden px-2 opacity-70" aria-hidden>
              {book.prints.slice(0, 48).map((row) => (
                <span key={`${row.tx}-${row.t}`} className={row.tapeIn ? "text-sell" : "text-up"} style={{ fontSize: 8, lineHeight: 1 }}>▲</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="ph-book order-3 min-w-0 border-t border-gold xl:order-2 xl:border-t-0 xl:border-l" onMouseLeave={() => setTip(null)}>
          <div className="flex h-9 items-center gap-3 border-b border-gold px-3 text-xs">
            <button type="button" onClick={() => setTab("book")} className={tab === "book" ? "tab-on" : "text-ink/45"}>{zh ? "深度" : "Depth"}</button>
            <button type="button" onClick={() => setTab("tape")} className={tab === "tape" ? "tab-on" : "text-ink/45"}>{zh ? "最新成交" : "Trades"}</button>
          </div>
          {tab === "book" ? (
            <>
              <div className="spot-book px-2 py-1 text-[10px] text-ink/40">
                <span>{zh ? "价格" : "Price"}</span>
                <span className="text-right">{zh ? "数量" : "Size"}</span>
                <span className="text-right">{zh ? "合计" : "Total"}</span>
              </div>
              <div className="book-scroll max-h-[28rem] overflow-auto">
                {askView.map((level, index) => {
                  const cum = cumFrom(askView, index, true);
                  return (
                    <button key={`a-${index}`} type="button" onClick={() => { setMode("limit"); setSide("buy"); setPrice(level.px.toPrecision(6)); if (readPrefs().bookSetsSize) setAmount(level.size.toFixed(4)); setArmed(false); setPhone("ticket"); }} onMouseMove={(event) => show(event, mid > 0 ? (level.px - mid) / mid : 0, cum.tape, cum.usd)} className="spot-book relative overflow-hidden px-2 py-[3px] text-left font-mono text-[12px] hover:bg-white/5">
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
                {bidView.map((level, index) => {
                  const cum = cumFrom(bidView, index, false);
                  return (
                    <button key={`b-${index}`} type="button" onClick={() => { setMode("limit"); setSide("sell"); setPrice(level.px.toPrecision(6)); if (readPrefs().bookSetsSize) setAmount(level.size.toFixed(4)); setArmed(false); setPhone("ticket"); }} onMouseMove={(event) => show(event, mid > 0 ? (level.px - mid) / mid : 0, cum.tape, cum.usd)} className="spot-book relative overflow-hidden px-2 py-[3px] text-left font-mono text-[12px] hover:bg-white/5">
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
            <div className="book-scroll max-h-[28rem] overflow-auto">
              <div className="spot-book px-2 py-1 text-[10px] text-ink/40">
                <span>{zh ? "价格" : "Price"}</span>
                <span className="text-right">TAPE</span>
                <span className="text-right">{zh ? "时间" : "Time"}</span>
              </div>
              {book?.prints.map((row, index) => (
                <p key={`${row.tx}-${index}`} className="spot-book px-2 py-[3px] font-mono text-[12px]">
                  <span className={row.tapeIn ? "text-sell" : "text-up"}>{money(row.usd)}</span>
                  <span className="text-right text-ink/80">{row.tape.toFixed(2)}</span>
                  <span className="text-right text-ink/45">{clock(row.t)}</span>
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="ph-ticket relative order-2 border-t border-gold p-3 xl:order-3 xl:border-t-0 xl:border-l">
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
          <p className="mt-3 font-mono text-lg tabular-nums">{mid > 0 ? money(mid) : "—"} <span className="text-xs text-ink/45">{quoteSym}</span></p>
          <div className="mt-2 grid grid-cols-2 border border-gold/40 font-mono text-sm">
            <p className="px-2 py-2">
              <span className="block text-[10px] text-ink/45">{zh ? "可用" : "Available"} {quoteSym}</span>
              {bal ? poolText(buyHeld, quoteDec) : "—"}
              <span className="block text-[10px] text-ink/40">{zh ? "可买" : "Buys"} {buyTapeLabel} TAPE</span>
            </p>
            <p className="border-l border-gold/40 px-2 py-2">
              <span className="block text-[10px] text-ink/45">{zh ? "可用" : "Available"} TAPE</span>
              {bal ? poolText(bal.tape, 8) : "—"}
            </p>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {([
              ["usdt", "USDT"],
              ["bem", "BEM"],
              ["okb", "OKB"],
            ] as const).map(([id, label]) => (
              <button key={id} type="button" onClick={() => onPair?.(id)} className={`h-8 text-xs ${active === id ? "bg-ink" : "border border-gold/40 text-ink/60"}`}>{label}</button>
            ))}
          </div>
          {mode === "market" ? (
            <p className="mt-2 flex items-center justify-between border border-gold/40 px-2 py-2 font-mono">
              <span className="text-[11px] text-ink/45">{zh ? "价格" : "Price"}</span>
              <span>{money(mid)} <span className="text-[11px] text-ink/40">Mid</span></span>
            </p>
          ) : null}
          {mode === "limit" ? (
            <label className="relative mt-2 block border border-gold/40 px-2 py-2">
              <span className="text-[11px] text-ink/45">{zh ? "限价" : "Limit"}</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-lg outline-none" />
              {!price.trim() ? <span className="pointer-events-none absolute bottom-2 right-2 max-w-[75%] truncate font-mono text-[11px] text-ink/40">{zh ? "输入限价" : "Limit"}{mid > 0 ? ` ${money(mid)}` : ""}</span> : null}
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
            <span className="text-[11px] text-ink/45">{zh ? "数量 TAPE" : "Size TAPE"}</span>
            <input value={amount} onChange={(event) => { setAmount(event.target.value); setPct(0); setArmed(false); }} inputMode="decimal" placeholder={zh ? "输入数量" : "Size"} suppressHydrationWarning className="w-full bg-transparent font-mono text-lg outline-none placeholder:text-ink/35" />
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
          <div className="mt-2 space-y-1 font-mono text-[11px] text-ink/55">
            <p className="flex justify-between"><span>{zh ? "订单价值" : "Order value"}</span><span>{notional > 0 ? `${money(notional)} ${quoteSym}` : "—"}</span></p>
            <p className="flex justify-between"><span>{zh ? "费用" : "Fee"}</span><span>0.20%</span></p>
          </div>
          <button type="button" disabled={busy || !amount.trim()} onClick={() => { void submit(); }} className={`mt-3 h-11 w-full text-sm disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell text-[#fff7f8]"}`}>
            {busy ? (zh ? "等待钱包" : "Waiting") : !amount.trim() ? (zh ? "输入数量" : "Enter size") : armed ? (zh ? "再点确认" : "Tap to confirm") : mode === "twap" ? (zh ? "启用" : "Start") : side === "buy" ? (zh ? `买入 TAPE · 付 ${quoteSym}` : `Buy TAPE · pay ${quoteSym}`) : zh ? `卖出 TAPE · 收 ${quoteSym}` : `Sell TAPE · receive ${quoteSym}`}
          </button>
          {note ? <p className={`mt-2 text-xs leading-5 ${bad ? "text-sell" : "text-ink/80"}`}>{note}</p> : null}
          <TradeLog zh={zh} />
        </div>
      </div>
      <div className="border-t border-gold">
        <div className="flex items-center gap-1 overflow-x-auto px-2 pt-1">
          {([
            ["bal", zh ? "余额" : "Balances"],
            ["rest", zh ? `当前委托 (${orders.filter((row) => row.kind === "limit").length})` : `Orders (${orders.filter((row) => row.kind === "limit").length})`],
            ["twap", "TWAP"],
            ["chase", zh ? "追价" : "Chase"],
            ["fills", zh ? "成交" : "Trades"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setDock(id)} className={`h-8 shrink-0 px-2 text-xs ${dock === id ? "tab-on" : "text-ink/45"}`}>{label}</button>
          ))}
          {dock === "bal" ? (
            <label className="ml-auto flex shrink-0 items-center gap-1 px-2 text-[11px] text-ink/45">
              <input type="checkbox" checked={hideDust} onChange={(event) => setHideDust(event.target.checked)} />
              {zh ? "隐藏小额" : "Hide small"}
            </label>
          ) : null}
        </div>
        <div className="min-h-28 overflow-x-auto px-3 py-2 text-xs">
          {dock === "bal" ? (
            <table className="w-full min-w-[32rem] text-left font-mono">
              <thead className="text-[11px] text-ink/40">
                <tr>
                  <th className="py-1 font-normal">{zh ? "资产" : "Asset"}</th>
                  <th className="py-1 font-normal">{zh ? "总余额" : "Total"}</th>
                  <th className="py-1 font-normal">{zh ? "可用余额" : "Available"}</th>
                  <th className="py-1 text-right font-normal">{zh ? "价值" : "Value"}</th>
                </tr>
              </thead>
              <tbody>
                {!account ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-ink/55">
                      <button type="button" className="underline" onClick={() => { void connectHere(); }}>{zh ? "连接后显示余额" : "Connect to see balances"}</button>
                    </td>
                  </tr>
                ) : !bal ? (
                  <tr><td colSpan={4} className="py-3 text-ink/45">{zh ? "正在读余额" : "Reading balances"}</td></tr>
                ) : balRows(bal, book, hideDust, active).map((row) => (
                  <tr key={row.sym} className="border-t border-gold/20">
                    <td className="py-1.5">{row.sym}</td>
                    <td className="py-1.5">{row.total} {row.sym}</td>
                    <td className="py-1.5">{row.avail} {row.sym}</td>
                    <td className="py-1.5 text-right">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {dock === "rest" || dock === "twap" || dock === "chase" ? (
            <table className="w-full min-w-[28rem] text-left font-mono">
              <thead className="text-[11px] text-ink/40">
                <tr>
                  <th className="py-1 font-normal">{zh ? "类型" : "Type"}</th>
                  <th className="py-1 font-normal">{zh ? "方向" : "Side"}</th>
                  <th className="py-1 font-normal">{zh ? "价格" : "Price"}</th>
                  <th className="py-1 font-normal">{zh ? "剩余" : "Left"}</th>
                  <th className="py-1 text-right font-normal" />
                </tr>
              </thead>
              <tbody>
                {orders.filter((row) => row.kind === (dock === "rest" ? "limit" : dock)).length === 0 ? (
                  <tr><td colSpan={5} className="py-3 text-ink/45">{dock === "twap" ? (zh ? "还没有 TWAP" : "No TWAPs") : dock === "chase" ? (zh ? "还没有追价" : "No chase") : zh ? "没有未成交的委托" : "No open orders"}</td></tr>
                ) : orders.filter((row) => row.kind === (dock === "rest" ? "limit" : dock)).map((order) => (
                  <tr key={order.id} className="border-t border-gold/20">
                    <td className="py-1.5">{order.kind === "limit" ? (zh ? "限价" : "Limit") : order.kind === "chase" ? (zh ? "追价" : "Chase") : "TWAP"}</td>
                    <td className="py-1.5">{order.side === "buy" ? (zh ? "买" : "Buy") : zh ? "卖" : "Sell"}</td>
                    <td className="py-1.5">{money(order.price)}</td>
                    <td className="py-1.5">{poolText(BigInt(order.left), 8)} TAPE</td>
                    <td className="py-1.5 text-right"><button type="button" className="underline" onClick={() => put(ordersRef.current.filter((row) => row.id !== order.id))}>{zh ? "取消" : "Cancel"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {dock === "fills" ? (
            <table className="w-full min-w-[28rem] text-left font-mono">
              <thead className="text-[11px] text-ink/40">
                <tr>
                  <th className="py-1 font-normal">{zh ? "时间" : "Time"}</th>
                  <th className="py-1 font-normal">{zh ? "方向" : "Side"}</th>
                  <th className="py-1 font-normal">{zh ? "价格" : "Price"}</th>
                  <th className="py-1 text-right font-normal">{zh ? "数量" : "Size"}</th>
                </tr>
              </thead>
              <tbody>
                {(book?.prints.filter((row) => account && row.sender.toLowerCase() === account.toLowerCase()) ?? []).length === 0 ? (
                  <tr><td colSpan={4} className="py-3 text-ink/45">{zh ? "尚无成交" : "No trades"}</td></tr>
                ) : book?.prints.filter((row) => account && row.sender.toLowerCase() === account.toLowerCase()).map((row, index) => (
                  <tr key={`${row.tx}-${index}`} className="border-t border-gold/20">
                    <td className="py-1.5">{clock(row.t)}</td>
                    <td className="py-1.5">{row.tapeIn ? (zh ? "卖" : "Sell") : zh ? "买" : "Buy"}</td>
                    <td className="py-1.5">{money(row.usd)}</td>
                    <td className="py-1.5 text-right">{row.tape.toFixed(4)} TAPE</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
