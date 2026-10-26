import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { Kline, type Bar } from "@/components/exchange/kline";
import { PairChevron } from "@/components/exchange/desk-chrome";
import { CoinMark } from "@/components/exchange/coin-mark";
import { readPrefs } from "@/lib/desk-prefs";
import { PoolFill } from "@/components/exchange/pool-fill";
import { getTapeCandles, type CandleFrame } from "@/lib/candles";
import { previewFrame, readCandleBook, stampBars, writeCandleBook } from "@/lib/bem-ohlcv";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectXLayer } from "@/lib/xlayer";
import { readTapePool, showQuote } from "@/lib/tape-pool";
import {
  baseText,
  cancelSpot,
  placeSpot,
  readMyOrders,
  readSpotBook,
  readSpotPurse,
  peekSpotPrints,
  spotBase,
  spotPrice,
  usdtText,
  type Level,
  type OpenOrder,
  type SpotMarket,
  type SpotPrint,
  type SpotPurse,
} from "@/lib/tape-spot";

const NAMES = ["TAPE", "NAND", "LATCH"] as const;

function pxInput(price: bigint): string {
  const text = formatUnits(price, 6);
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function amtInput(market: number, amount: bigint): string {
  if (market !== 0) return amount.toString();
  return formatUnits(amount, 8).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

const FRAMES: [CandleFrame, string, string][] = [
  ["15s", "15秒", "15s"],
  ["1m", "1分", "1m"],
  ["5m", "5分", "5m"],
  ["15m", "15分", "15m"],
  ["1h", "1时", "1h"],
  ["4h", "4时", "4h"],
  ["1d", "1日", "1d"],
  ["1w", "一周", "1w"],
  ["1M", "一月", "1M"],
  ["3M", "三月", "3M"],
  ["1y", "一年", "1y"],
];

function foldBars(rows: Bar[], n: number): Bar[] {
  if (n <= 1 || rows.length < 2) return rows;
  const out: Bar[] = [];
  for (let i = 0; i < rows.length; i += n) {
    const slice = rows.slice(i, i + n);
    const last = slice[slice.length - 1];
    out.push({
      o: slice[0].o,
      c: last.c,
      h: Math.max(...slice.map((bar) => bar.h)),
      l: Math.min(...slice.map((bar) => bar.l)),
      v: slice.reduce((sum, bar) => sum + (bar.v ?? 0), 0),
    });
  }
  return out;
}

function barsOf(rows: SpotPrint[]): Bar[] {
  const ordered = [...rows].reverse();
  const bars: Bar[] = [];
  for (const row of ordered) {
    const px = Number(formatUnits(row.price, 6));
    if (!(px > 0)) continue;
    const vol = row.market === 0 ? Number(formatUnits(row.base, 8)) : Number(row.base);
    const prev = bars.at(-1)?.c ?? px;
    bars.push({ o: prev, h: Math.max(prev, px), l: Math.min(prev, px), c: px, v: vol });
  }
  return bars;
}

export function TapeTerminal({
  market,
  otc = false,
  onMarkets,
}: {
  market: SpotMarket;
  otc?: boolean;
  onMarkets: () => void;
}) {
  const [langZh, setLangZh] = useState(true);
  const zhUi = langZh;
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);
  const [prints, setPrints] = useState<SpotPrint[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [purse, setPurse] = useState<SpotPurse | null>(null);
  const [poolMid, setPoolMid] = useState(0);
  const [poolQuote, setPoolQuote] = useState("");
  const [miss, setMiss] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [style, setStyle] = useState<"limit" | "market" | "post" | "scale">("market");
  const [scaleA, setScaleA] = useState("");
  const [scaleB, setScaleB] = useState("");
  const [scaleN, setScaleN] = useState(3);
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [pct, setPct] = useState(0);
  const [tab, setTab] = useState<"bal" | "rest" | "prints">("rest");
  const [frame, setFrame] = useState<CandleFrame>("1h");
  const [poolBars, setPoolBars] = useState<Bar[]>([]);
  const candleCache = useRef<Map<string, Bar[]> | null>(null);
  if (candleCache.current == null) candleCache.current = typeof window === "undefined" ? new Map() : readCandleBook("spot:0");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    const read = () => setLangZh(document.documentElement.lang !== "en");
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, []);
  const name = NAMES[market];

  useEffect(() => {
    setBids([]);
    setAsks([]);
    setPrints([]);
    setPrice("");
    setAmount("");
  }, [market]);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      readSpotBook(market)
        .then((book) => {
          if (dead) return;
          setMiss(false);
          setBids(book?.bids ?? []);
          setAsks(book?.asks ?? []);
        })
        .catch(() => {
          if (!dead) setMiss(true);
        });
      readSpotPurse(account).then((held) => { if (!dead) setPurse(held); }).catch(() => undefined);
      if (account) {
        readMyOrders(account)
          .then((mine) => { if (!dead) setOrders(mine.filter((row) => row.market === market && row.left > 0n)); })
          .catch(() => undefined);
      }
      if (market === 0) {
        readTapePool(null)
          .then((row) => {
            const tape = Number(row.usdt.tape) / 1e8;
            const quote = Number(row.usdt.quote) / 1e6;
            if (dead || !(tape > 0)) return;
            setPoolMid(quote / tape);
            setPoolQuote(showQuote(0, row.usdt.quote));
          })
          .catch(() => undefined);
      }
    };
    pull();
    const id = window.setInterval(pull, 12000);
    return () => { dead = true; window.clearInterval(id); };
  }, [market, account]);

  useEffect(() => {
    let dead = false;
    const look = () => {
      const snap = peekSpotPrints(market);
      if (!dead) setPrints(snap.rows);
    };
    look();
    const id = window.setInterval(look, 4000);
    return () => { dead = true; window.clearInterval(id); };
  }, [market]);

  useEffect(() => {
    if (market !== 0) {
      setPoolBars([]);
      return;
    }
    let dead = false;
    const book = candleCache.current ?? new Map<string, Bar[]>();
    candleCache.current = book;
    if (book.size === 0) {
      readCandleBook("spot:0").forEach((rows, key) => book.set(key, rows));
      const seeded = previewFrame(book, frame);
      if (seeded.length) setPoolBars(seeded);
    }
    const pull = () => {
      getTapeCandles({ data: frame })
        .then((rows) => {
          if (dead) return;
          if (rows.length > 1) {
            book.set(frame, rows);
            writeCandleBook("spot:0", book);
            setPoolBars(rows);
            return;
          }
          const next = previewFrame(book, frame);
          setPoolBars(next);
        })
        .catch(() => {
          if (!dead) setPoolBars(previewFrame(book, frame));
        });
    };
    pull();
    const id = window.setInterval(pull, 12000);
    return () => { dead = true; window.clearInterval(id); };
  }, [market, frame]);

  const bestAsk = asks[0]?.price ?? 0n;
  const bestBid = bids[0]?.price ?? 0n;
  const mid = bestAsk > 0n && bestBid > 0n ? Number(formatUnits((bestAsk + bestBid) / 2n, 6)) : poolMid;
  const lastPrint = prints[0] ? Number(formatUnits(prints[0].price, 6)) : 0;
  const last = lastPrint || mid;
  const span = frame === "15s" || frame === "1m" ? 1 : frame === "5m" ? 3 : frame === "15m" ? 6 : frame === "1h" ? 12 : frame === "4h" ? 24 : frame === "1d" ? 48 : frame === "1w" ? 80 : frame === "1M" ? 120 : frame === "3M" ? 180 : 240;
  const bars = useMemo(() => stampBars(market === 0 && poolBars.length ? poolBars : foldBars(barsOf(prints), span), frame), [market, poolBars, prints, span, frame]);
  const pickFrame = (id: string) => {
    const next = id as CandleFrame;
    setFrame(next);
    const preview = previewFrame(candleCache.current ?? new Map(), next);
    setPoolBars(preview);
  };
  const spread = bestAsk > bestBid && bestBid > 0n ? bestAsk - bestBid : 0n;
  const maxAsk = asks.reduce((m, row) => (row.size > m ? row.size : m), 1n);
  const maxBid = bids.reduce((m, row) => (row.size > m ? row.size : m), 1n);
  const askView = useMemo(() => [...asks].reverse(), [asks]);
  const traded = prints.reduce((sum, row) => sum + row.quote, 0n);

  const run = (task: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setBad(false);
    setNote(zhUi ? "正在连接 X Layer。请在钱包里确认。" : "Connecting X Layer. Confirm in the wallet.");
    task()
      .then(() => { setBad(false); setNote(ok); })
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : "";
        setBad(true);
        if ((err as { code?: number }).code === 4001) setNote(zhUi ? "签名取消了。" : "Cancelled.");
        else if (/self/i.test(text)) setNote(zhUi ? "会碰到你自己的挂单。先撤掉，或把价格放在碰不到的一侧。" : "This would trade against your own order. Cancel it, or use a price that misses it.");
        else if (text === "fee") setNote(zhUi ? "这一笔太小，千分之二舍成 0。" : "Too small. The 0.2% rounds to zero.");
        else if (text === "amount" || text === "price") setNote(zhUi ? "价格和数量都要填。NAND 和 LATCH 只收整数。" : "Enter a price and a size. NAND and LATCH are whole numbers.");
        else setNote(zhUi ? "没有挂上。先看余额和授权。" : "It did not rest. Check the balance and the approval.");
      })
      .finally(() => setBusy(false));
  };

  const fillPct = (next: number) => {
    setPct(next);
    if (!purse) return;
    let px = 0n;
    try { px = price.trim() ? spotPrice(price) : bestAsk || bestBid; } catch { return; }
    if (side === "sell") {
      const bal = market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch;
      setAmount(amtInput(market, bal * BigInt(next) / 100n));
      return;
    }
    if (px <= 0n) return;
    const scale = market === 0 ? 100_000_000n : 1n;
    setAmount(amtInput(market, purse.usdt * scale / px * BigInt(next) / 100n));
  };

  const submit = (nextSide: "buy" | "sell" = side) => {
    if (style === "scale") {
      let a = 0n;
      let b = 0n;
      let qty = 0n;
      try {
        a = spotPrice(scaleA);
        b = spotPrice(scaleB);
        qty = spotBase(market, amount);
      } catch {
        setBad(true);
        setNote(zhUi ? "价格或数量不对。" : "Price or size is not valid.");
        return;
      }
      const n = Math.min(5, Math.max(2, scaleN));
      const each = qty / BigInt(n);
      if (each <= 0n || a <= 0n || b <= 0n) {
        setBad(true);
        setNote(zhUi ? "分批的每一笔都要有数量。" : "Each slice needs a size.");
        return;
      }
      run(async () => {
        const from = account ?? await connectXLayer();
        setAccount(from);
        let last: `0x${string}` = "0x";
        for (let i = 0; i < n; i++) {
          const px = a + ((b - a) * BigInt(i)) / BigInt(n - 1);
          last = await placeSpot(from, market, nextSide === "buy", px, each);
        }
        return last;
      }, zhUi ? "分批已挂上。" : "The scale is on the book.");
      return;
    }
    let px = 0n;
    if (style === "market") {
      px = nextSide === "buy" ? bestAsk : bestBid;
      if (px <= 0n) {
        setBad(true);
        setNote(zhUi ? "对面没有挂单，市价无处可吃。改限价，单会挂在簿上。" : "The other side is empty, so a market order has nothing to take. Use a limit and it will rest.");
        return;
      }
      if (mid > 0) {
        const away = Math.abs(Number(formatUnits(px, 6)) - mid) / mid;
        if (away > 0.01) {
          setBad(true);
          setNote(zhUi ? "对手价离中间价超过 1%，市价没有发出。" : "The other side is more than 1% from the mid. The market order was not sent.");
          return;
        }
      }
    } else {
      try { px = spotPrice(price); } catch {
        setBad(true);
        setNote(zhUi ? "价格不对。" : "That price is not valid.");
        return;
      }
      if (style === "post" && ((nextSide === "buy" && bestAsk > 0n && px >= bestAsk) || (nextSide === "sell" && bestBid > 0n && px <= bestBid))) {
        setBad(true);
        setNote(zhUi ? "这个价会吃到对手单。只挂没有发出。" : "That price would take. The post-only order was not sent.");
        return;
      }
    }
    let qty = 0n;
    try { qty = spotBase(market, amount); } catch {
      setBad(true);
      setNote(zhUi ? "数量不对。" : "That size is not valid.");
      return;
    }
    run(
      async () => {
        const from = account ?? await connectXLayer();
        setAccount(from);
        return placeSpot(from, market, nextSide === "buy", px, qty);
      },
      zhUi ? "已进订单簿。能碰上的马上成交，剩下的继续挂着。" : "It is on the book. What can cross fills now. The rest stays.",
    );
  };

  const pickLevel = (level: Level, bookBid: boolean) => {
    setStyle("limit");
    setSide(bookBid ? "sell" : "buy");
    setPrice(pxInput(level.price));
    if (readPrefs().bookSetsSize) setAmount(amtInput(market, level.size));
  };

  const walletBase = purse ? (market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch) : 0n;

  return (
    <section className="overflow-hidden border border-gold bg-card">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gold px-3 py-2">
        <button type="button" onClick={onMarkets} className="flex items-center gap-2">
          <CoinMark id={name.toLowerCase()} />
          <span className="text-lg font-medium tracking-tight">{name}-USDT0</span>
          <PairChevron />
          <span className="lev-chip rounded px-1.5 py-0.5 text-[11px]">{otc ? "OTC" : zhUi ? "现货" : "Spot"}</span>
        </button>
        <p className="font-mono text-sm">{last > 0 ? last.toLocaleString("en-US", { maximumFractionDigits: last >= 1 ? 4 : 6 }) : "—"}</p>
        <p className="font-mono text-sm text-ink/70">{bestBid > 0n ? usdtText(bestBid, 4) : "—"}<span className="px-1 text-ink/30">/</span>{bestAsk > 0n ? usdtText(bestAsk, 4) : "—"}</p>
      </div>
      <div className="grid items-start xl:grid-cols-[minmax(0,1fr)_17.5rem_22rem]">
        <div className="order-1 min-w-0">
          <Kline
              bars={bars}
              mark={mid}
              entry={0}
              supply={null}
              lang={zhUi ? "zh" : "en"}
              desk="spot"
              frame={frame}
              frames={FRAMES.map(([id, zhLabel, enLabel]) => ({ id, label: zhUi ? zhLabel : enLabel }))}
              onFrame={pickFrame}
              onPrice={(px) => {
                setStyle("limit");
                setPrice(px >= 1 ? px.toFixed(4) : px.toFixed(6));
              }}
            />
        </div>
        <div className="order-3 min-w-0 border-t border-gold xl:order-2 xl:border-t-0 xl:border-l">
          <div className="flex h-9 items-center border-b border-gold px-3 text-xs text-ink/70">
            <span>{zhUi ? "订单簿" : "Book"}</span>
            <span className="ml-auto font-mono text-[11px] text-ink/40">{zhUi ? "价差" : "Spread"} {spread > 0n ? usdtText(spread, 4) : "—"}</span>
          </div>
          <div className="grid grid-cols-3 px-2 py-1 text-[10px] text-ink/40">
            <span>{zhUi ? "价格" : "Price"}</span>
            <span className="text-right">{zhUi ? "数量" : "Size"} {name}</span>
            <span className="text-right">{zhUi ? "合计" : "Total"}</span>
          </div>
          <div className="max-h-[28rem] overflow-auto">
            {askView.map((level, index) => {
              let cum = 0n;
              for (let i = askView.length - 1; i >= index; i--) cum += quoteOf(market, askView[i]);
              return <BookLine key={`a-${level.price}`} market={market} level={level} bid={false} depth={Number((level.size * 100n) / maxAsk)} cum={cum} onPick={() => pickLevel(level, false)} />;
            })}
            <p className="border-y border-gold/30 px-2 py-1 font-mono text-sm">{last > 0 ? last.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"}</p>
            {bids.map((level, index) => {
              let cum = 0n;
              for (let i = 0; i <= index; i++) cum += quoteOf(market, bids[i]);
              return <BookLine key={`b-${level.price}`} market={market} level={level} bid depth={Number((level.size * 100n) / maxBid)} cum={cum} onPick={() => pickLevel(level, true)} />;
            })}
          </div>
        </div>
        <div className="order-2 border-t border-gold p-3 xl:order-3 xl:border-t-0 xl:border-l">
          <div className="grid grid-cols-5 gap-1">
            <button type="button" onClick={() => setStyle("limit")} className={`h-10 text-sm ${style === "limit" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zhUi ? "限价" : "Limit"}</button>
            <button type="button" onClick={() => setStyle("market")} className={`h-10 text-sm ${style === "market" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zhUi ? "市价" : "Market"}</button>
            <button type="button" onClick={() => setStyle("post")} className={`h-10 text-sm ${style === "post" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zhUi ? "只挂" : "Post"}</button>
            <button type="button" onClick={() => setStyle("scale")} className={`h-10 text-sm ${style === "scale" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zhUi ? "分批" : "Scale"}</button>
            <button type="button" onClick={() => {
              setStyle("post");
              if (side === "buy" && bestBid > 0n) setPrice(pxInput(bestBid));
              else if (side === "sell" && bestAsk > 0n) setPrice(pxInput(bestAsk));
            }} className="h-10 border border-gold/40 text-sm text-ink/70">{zhUi ? "追价" : "Chase"}</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSide("buy")} className={`h-10 text-sm ${side === "buy" ? "bg-ink" : "quiet-buy"}`}>{zhUi ? "买入" : "Buy"}</button>
            <button type="button" onClick={() => setSide("sell")} className={`h-10 text-sm ${side === "sell" ? "bg-sell text-[#fff7f8]" : "quiet-sell"}`}>{zhUi ? "卖出" : "Sell"}</button>
          </div>
          <p className="mt-3 font-mono text-[11px] text-ink/45">{purse ? `${usdtText(purse.usdt, 2)} USDT0 · ${baseText(market, walletBase)} ${name}` : "—"}</p>
          {market === 0 && style === "market" ? <PoolFill zh={zhUi} side={side} /> : (
          <>
          {style === "scale" ? (
            <div className="mt-2 grid grid-cols-3 gap-1">
              <input value={scaleA} onChange={(event) => setScaleA(event.target.value)} inputMode="decimal" placeholder={zhUi ? "起" : "From"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={scaleB} onChange={(event) => setScaleB(event.target.value)} inputMode="decimal" placeholder={zhUi ? "止" : "To"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={String(scaleN)} onChange={(event) => setScaleN(Math.min(5, Math.max(2, Number(event.target.value) || 2)))} inputMode="numeric" className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
            </div>
          ) : null}
          {style !== "market" && style !== "scale" ? (
            <label className="mt-2 block border border-gold/40 px-2 py-2">
              <span className="text-[11px] text-ink/45">{zhUi ? "价格 USDT0" : "Price USDT0"}</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-xl outline-none" />
            </label>
          ) : null}
          <label className="mt-2 block border border-gold/40 px-2 py-2">
            <span className="text-[11px] text-ink/45">{zhUi ? "数量" : "Size"} {name}</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-xl outline-none" />
          </label>
          <label className="mt-3 block text-[11px] text-ink/45">
            {pct}%
            <input type="range" min={0} max={100} value={pct} onChange={(event) => fillPct(Number(event.target.value))} className="mt-1 w-full" />
          </label>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((item) => (
              <button key={item} type="button" onClick={() => fillPct(item)} className="h-7 border border-gold/30 font-mono text-[11px] text-ink/60">{item}%</button>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => submit()} className={`mt-3 h-11 w-full text-sm disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell text-[#fff7f8]"}`}>
            {busy ? (zhUi ? "等待钱包" : "Waiting") : side === "buy" ? (zhUi ? `买入 ${name}` : `Buy ${name}`) : zhUi ? `卖出 ${name}` : `Sell ${name}`}
          </button>
          {note ? <p className={`mt-2 text-xs leading-5 ${bad ? "text-sell" : "text-ink/80"}`}>{note}</p> : null}
          </>
          )}
        </div>
      </div>
      <div className="border-t border-gold">
        <div className="flex gap-1 overflow-x-auto px-2 pt-1">
          {([
            ["bal", zhUi ? "余额" : "Balances"],
            ["rest", zhUi ? `当前委托 (${orders.length})` : `Orders (${orders.length})`],
            ["prints", zhUi ? "成交" : "Trades"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`h-8 shrink-0 px-2 text-xs ${tab === id ? "tab-on" : "text-ink/45"}`}>{label}</button>
          ))}
        </div>
        <div className="min-h-16 px-3 py-2 text-xs">
          {tab === "bal" ? (
            <p className="font-mono text-ink/70">{purse ? `${usdtText(purse.usdt, 2)} USDT0 · ${baseText(0, purse.tape)} TAPE · ${purse.nand.toString()} NAND · ${purse.latch.toString()} LATCH` : "—"}</p>
          ) : null}
          {tab === "rest" ? (
            orders.length === 0 ? null : (
              <div className="flex flex-col gap-1">
                <button type="button" className="w-fit underline" disabled={busy} onClick={() => run(async () => {
                  const from = account ?? await connectXLayer();
                  setAccount(from);
                  let last: `0x${string}` = "0x";
                  for (const row of orders) last = await cancelSpot(from, row.id);
                  return last;
                }, zhUi ? "已全撤。" : "Cancelled.")}>{zhUi ? "全撤" : "Cancel all"}</button>
                {orders.map((row) => (
                  <div key={row.id.toString()} className="flex flex-wrap items-center gap-3 font-mono">
                    <span>{row.bid ? (zhUi ? "买" : "Bid") : zhUi ? "卖" : "Ask"}</span>
                    <span>{usdtText(row.price, 4)}</span>
                    <span>{baseText(market, row.left)}</span>
                    <button type="button" className="text-ink underline" disabled={busy} onClick={() => run(async () => {
                      const from = account ?? await connectXLayer();
                      setAccount(from);
                      return cancelSpot(from, row.id);
                    }, zhUi ? "已撤。" : "Cancelled.")}>{zhUi ? "撤销" : "Cancel"}</button>
                  </div>
                ))}
              </div>
            )
          ) : null}
          {tab === "prints" ? (
            prints.length === 0 ? null : (
              <div className="flex flex-col gap-1 font-mono">
                {prints.slice(0, 8).map((row) => (
                  <p key={row.tx}>{usdtText(row.price, 4)} · {baseText(market, row.base)} · {usdtText(row.quote, 2)}</p>
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>
    </section>
  );
}

function quoteOf(market: number, level: Level): bigint {
  return market === 0 ? level.price * level.size / 100_000_000n : level.price * level.size;
}

function BookLine({ market, level, bid, depth, cum, onPick }: { market: number; level: Level; bid: boolean; depth: number; cum: bigint; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className="relative grid w-full grid-cols-3 px-2 py-[3px] text-left font-mono text-[12px] hover:bg-white/5">
      <span className="pointer-events-none absolute inset-y-0 right-0" style={{ width: `${Math.max(6, Math.min(100, depth))}%`, background: bid ? "rgba(8,153,129,0.16)" : "rgba(242,54,69,0.16)" }} />
      <span className={`relative ${bid ? "text-up" : "text-sell"}`}>{usdtText(level.price, 4)}</span>
      <span className="relative text-right text-ink/80">{baseText(market, level.size)}</span>
      <span className="relative text-right text-ink/45">{usdtText(cum, 2)}</span>
    </button>
  );
}
