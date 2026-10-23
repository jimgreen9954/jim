import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { Kline } from "@/components/exchange/kline";
import { SignCard } from "@/components/exchange/sign-card";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { pretty, type PoolPrint } from "@/lib/bsc";
import type { Candle } from "@/lib/bem-ohlcv";
import { bookOkbRate, quoteXBem, xCap } from "@/lib/okb";
import {
  addOpenPool,
  openPoolAddress,
  openQuoteUnits,
  previewOpenSwap,
  readOpenPool,
  readPoolLocks,
  removeOpenPool,
  showOpenQuote,
  showTape,
  swapOpenPool,
  TAPE_FEE,
  TAPE_POOL,
  TAPE_POOL_V2,
  TAPE_TERMS,
  TAPE_TOKEN,
  tapeUnits,
  type PoolLock,
  type TapePosition,
} from "@/lib/tape-pool";
import { pullTapeBoard, type TapeFrame } from "@/lib/tape-spot-market";
import { OfficialBridge } from "@/components/exchange/tape-desk";
import { quoteGasSwap, readGasBalances, sendGasSwap, showGas, type GasQuote } from "@/lib/gas-swap";
import { deskParts } from "@/lib/invite-cut";
import { connectKind, currentAccount, onAccount, onOpenLink } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

const GAS = 2_000_000_000_000_000n;

function when(ts: number): string {
  if (!Number.isFinite(ts) || ts < 1_000_000_000 || ts > 10_000_000_000) return "—";
  try {
    return new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Singapore", hour12: false });
  } catch {
    return "—";
  }
}

function pxText(n: number | null): string | null {
  if (n == null || !(n > 0)) return null;
  return n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

function sidePx(quoteAmt: bigint, quoteDec: number, tapeAmt: bigint, usd: number | null): number | null {
  if (usd == null || !(usd > 0) || tapeAmt <= 0n || quoteAmt <= 0n) return null;
  const quote = Number(formatUnits(quoteAmt, quoteDec));
  const tape = Number(formatUnits(tapeAmt, 8));
  return tape > 0 && quote > 0 ? (quote * usd) / tape : null;
}

function sized(raw: bigint, decimals: number, pct: number, cap?: bigint): string {
  let cut = (raw * BigInt(pct)) / 100n;
  if (cap != null && cut > cap) cut = cap;
  const [whole, frac = ""] = formatUnits(cut, decimals).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function TapePoolDesk() {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [quote, setQuote] = useState<0 | 1>(0);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [frame, setFrame] = useState<TapeFrame>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [prints, setPrints] = useState<PoolPrint[]>([]);
  const [price, setPrice] = useState<number | null>(null);
  const [bemPx, setBemPx] = useState<number | null>(null);
  const [okbPx, setOkbPx] = useState<number | null>(null);
  const [supply, setSupply] = useState<number | null>(null);
  const [live, setLive] = useState(false);
  const [balTape, setBalTape] = useState(0n);
  const [balBem, setBalBem] = useState(0n);
  const [balOkb, setBalOkb] = useState(0n);
  const [bemReserve, setBemReserve] = useState(0n);
  const [okbReserve, setOkbReserve] = useState(0n);
  const [tapeBem, setTapeBem] = useState(0n);
  const [tapeOkb, setTapeOkb] = useState(0n);
  const [positions, setPositions] = useState<TapePosition[]>([]);
  const [locks, setLocks] = useState<PoolLock[]>([]);
  const [out, setOut] = useState<string | null>(null);
  const [minOut, setMinOut] = useState<string | null>(null);
  const [floor, setFloor] = useState<bigint | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
  const [miss, setMiss] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [card, setCard] = useState(false);
  const [openLink, setOpenLink] = useState<string | null>(null);
  const [term, setTerm] = useState(4);
  const [addTape, setAddTape] = useState("");
  const [addQuote, setAddQuote] = useState("");
  const [ack, setAck] = useState(false);
  const unit = quote === 0 ? "BEM" : "OKB";
  const payDecimals = side === "buy" ? (quote === 0 ? 8 : 18) : 8;
  const pool = TAPE_POOL_V2 || openPoolAddress();

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => onOpenLink(setOpenLink), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      pullTapeBoard(frame)
        .then((board) => {
          if (dead) return;
          setPrice(board.price);
          if (board.bars.length > 0) setBars(board.bars);
          setPrints(board.prints);
        })
        .catch(() => undefined);
      Promise.all([quoteXBem("sell", 10n ** 8n), bookOkbRate(), xCap(TAPE_TOKEN)])
        .then(([bem, okb, cap]) => {
          if (dead) return;
          setBemPx(Number(formatUnits(bem, 6)));
          setOkbPx(Number(formatUnits(okb, 6)));
          setSupply(cap > 0 ? cap : null);
        })
        .catch(() => undefined);
      readOpenPool(account)
        .then((row) => {
          if (dead) return;
          setLive(row.live);
          setBalTape(row.tape);
          setBalBem(row.bemBal);
          setBalOkb(row.okbBal);
          setBemReserve(row.bem.quote);
          setOkbReserve(row.okb.quote);
          setTapeBem(row.bem.tape);
          setTapeOkb(row.okb.tape);
          setPositions(row.positions);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 12_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [account, frame, hash]);
  useEffect(() => {
    let dead = false;
    readPoolLocks().then((rows) => { if (!dead) setLocks(rows); }).catch(() => { if (!dead) setLocks([]); });
    return () => { dead = true; };
  }, [hash]);

  useEffect(() => {
    const raw = side === "sell" ? tapeUnits(amount) : openQuoteUnits(quote, amount);
    if (raw <= 0n || !live) {
      setOut(null);
      setMinOut(null);
      setFloor(null);
      setMiss(false);
      return;
    }
    let dead = false;
    previewOpenSwap(quote, side === "sell", raw)
      .then((row) => {
        if (dead) return;
        const min = (row.out * 99n) / 100n;
        setOut(side === "sell" ? showOpenQuote(quote, row.out) : showTape(row.out));
        setMinOut(side === "sell" ? showOpenQuote(quote, min) : showTape(min));
        setFloor(min);
        setQuotedAt(Date.now());
        setMiss(false);
      })
      .catch(() => {
        if (dead) return;
        setOut(null);
        setMinOut(null);
        setFloor(null);
        setMiss(true);
      });
    return () => {
      dead = true;
    };
  }, [amount, side, quote, live, price]);

  const payRaw = side === "buy" ? (quote === 0 ? balBem : balOkb) : balTape;
  const spendCap = side === "buy" && quote === 1 ? (payRaw > GAS ? payRaw - GAS : 0n) : undefined;
  const spendable = spendCap ?? payRaw;
  let typed = 0n;
  try {
    typed = amount.trim() ? (side === "sell" ? tapeUnits(amount) : openQuoteUnits(quote, amount)) : 0n;
  } catch {
    typed = 0n;
  }
  const fee = typed > 0n ? (typed * 20n) / 10_000n : 0n;
  const over = typed > spendable;
  const bemTapePx = sidePx(bemReserve, 8, tapeBem, bemPx);
  const okbTapePx = sidePx(okbReserve, 18, tapeOkb, okbPx);
  const livePx = (quote === 0 ? bemTapePx : okbTapePx) ?? (price != null && price > 0 ? price : null);
  const shown = pxText(livePx);
  const chartBars = bars.map((bar, i) => {
    if (i !== bars.length - 1 || !(livePx && livePx > 0)) return bar;
    return { ...bar, c: livePx, h: Math.max(bar.h, livePx), l: Math.min(bar.l, livePx) };
  });
  const quoteReserve = quote === 0 ? bemReserve : okbReserve;
  const tapeReserve = quote === 0 ? tapeBem : tapeOkb;
  const poolRate = quoteReserve > 0n && tapeReserve > 0n
    ? Number(formatUnits(quoteReserve, quote === 0 ? 8 : 18)) / Number(formatUnits(tapeReserve, 8))
    : 0;
  const rateText = poolRate > 0 ? poolRate.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—";

  const say = (text: string, failed = false) => {
    setBad(failed);
    setNote(text);
  };

  const connectHere = async (which: "okx" | "binance") => {
    setBusy(true);
    setBad(false);
    try {
      const from = await connectKind(which);
      await connectXLayer();
      setAccount(from);
      setNote(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "binanceapp") return;
      say(zh ? "钱包没有连上。" : "The wallet did not connect.", true);
    } finally {
      setBusy(false);
    }
  };

  const trade = async (min: bigint) => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "等待钱包签名。" : "Waiting for the wallet.");
    try {
      const from = account ?? (await connectXLayer());
      setAccount(from);
      const raw = side === "sell" ? tapeUnits(amount) : openQuoteUnits(quote, amount);
      if (raw <= 0n) throw new Error("amt");
      const tx = await swapOpenPool(from, quote, side === "sell", raw, min);
      setHash(tx);
      setNote(null);
      setAmount("");
    } catch (error) {
      const parts: string[] = [];
      let cur: unknown = error;
      for (let i = 0; cur && i < 4; i += 1) {
        if (!(cur instanceof Error)) break;
        parts.push(cur.message);
        const extra = cur as { shortMessage?: string; cause?: unknown };
        if (extra.shortMessage) parts.push(extra.shortMessage);
        cur = extra.cause;
      }
      const message = parts.join(" ");
      say(
        message === "quote-moved"
          ? zh ? "价格变了，现在的最少到账低于刚才确认的数。看新报价再签。" : "The price moved. The new minimum is below the one you confirmed. Look again, then sign."
          : message === "closed"
            ? zh ? "池子还没打开买卖。" : "Trading is not open."
            : message === "chain"
              ? zh ? "钱包还在别的链。要切到 X Layer 再签。" : "The wallet is on another chain. Switch to X Layer, then sign."
              : /allow/i.test(message)
                ? zh ? "授权还没被池子读到。再签一次，这一次只成交，不再授权。" : "The allowance was not visible yet. Sign once more. This time it only trades."
                : /rejected|denied|4001/i.test(message)
                  ? zh ? "你取消了。" : "You cancelled."
                  : /insufficient|exceeds balance/i.test(message)
                    ? zh ? "余额不够。币还在钱包里。" : "Not enough balance. Nothing left the wallet."
                    : zh ? `没有成交。${message ? message.slice(0, 80) : "币还在原处。"}` : `It did not fill. ${message ? message.slice(0, 80) : "The tokens stayed put."}`,
        true,
      );
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    setBusy(true);
    setBad(false);
    try {
      const from = account ?? (await connectXLayer());
      setAccount(from);
      const tapeIn = tapeUnits(addTape);
      const quoteIn = openQuoteUnits(quote, addQuote);
      if (tapeIn <= 0n || quoteIn <= 0n) throw new Error("amt");
      const tx = await addOpenPool(from, quote, term, tapeIn, quoteIn);
      setHash(tx);
      say(zh ? `已质押。到期前不能撤。${tx}` : `Staked. It cannot be removed early. ${tx}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      say(
        message === "onlyfee" || message === "seed"
          ? zh ? "开盘前只有收费地址能加。" : "Before the open, only the fee address can add."
          : /rejected|denied/i.test(message)
            ? zh ? "你取消了。" : "You cancelled."
            : zh ? "没有加上。币还在原处。" : "It was not added. The tokens stayed put.",
        true,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-0 lg:grid-cols-12">
      <div className="border-b border-gold/40 p-3 lg:col-span-7 lg:border-r lg:border-b-0">
        <p className="text-xs tracking-widest text-gold">TAPE</p>
        <p className="mt-3 flex items-baseline gap-2 leading-none">
          <span className="font-mono text-4xl tabular-nums tracking-tight sm:text-5xl">{shown ?? "—"}</span>
          {shown ? <span className="font-mono text-xs tracking-widest text-gold">USDT</span> : null}
        </p>
        <p className="mt-1 font-mono text-xs text-ink/50">{zh ? `1 TAPE · ${unit} · X Layer` : `1 TAPE · ${unit} · X Layer`}</p>
        <div className="mt-3 flex flex-wrap border border-gold">
          {(["1m", "5m", "15m", "1h", "1d"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setFrame(item)} className={`min-h-9 flex-1 font-mono text-xs ${frame === item ? "bg-ink text-paper" : ""}`}>
              {item === "1d" ? (zh ? "1日" : "1d") : item}
            </button>
          ))}
        </div>
        <Kline bars={chartBars} lang={lang} desk="spot" supply={supply} mark={livePx ?? 0} />
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs tracking-widest text-gold">{zh ? "账本" : "Ledger"}</summary>
          <div className="mt-2">
        <details className="text-sm">
          <summary className="cursor-pointer text-xs tracking-widest text-gold">{zh ? "成交" : "Fills"}</summary>
          <p className="mt-2 text-xs text-ink/45">{zh ? "还没有成交时，K 线按当前池价铺平。有成交之后按这一笔的价格画。" : "Before the first trade the chart is flat at the pool price. A trade draws that print."}</p>
          <div className="mt-2 overflow-x-auto">
            <div className="grid min-w-[22rem] grid-cols-[3rem_1fr_5rem_7.5rem] gap-2 font-mono text-xs text-ink/45">
              <span>{zh ? "买卖" : "Side"}</span>
              <span>TAPE</span>
              <span>USDT</span>
              <span>{zh ? "地址" : "Address"}</span>
            </div>
            <ul className="mt-2 min-w-[22rem] divide-y divide-gold/30">
              {prints.length === 0 ? <li className="py-3 text-sm text-ink/60">{zh ? "还没有成交。" : "No trades yet."}</li> : null}
              {prints.map((row) => (
                <li key={row.id} className="grid grid-cols-[3rem_1fr_5rem_7.5rem] items-baseline gap-2 py-2 font-mono text-sm tabular-nums">
                  <a className={row.side === "buy" ? "text-gold" : "text-sell"} href={`${XLAYER.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{row.side === "buy" ? c.buy : c.sell}</a>
                  <span className="min-w-0 truncate">{row.bem} TAPE</span>
                  <span className="text-ink/70">{row.usdt}</span>
                  <a className="truncate text-xs underline decoration-gold underline-offset-4" href={`${XLAYER.explorer}/address/${row.who}`} target="_blank" rel="noreferrer">{row.who.slice(0, 6)}…{row.who.slice(-4)}</a>
                </li>
              ))}
            </ul>
          </div>
        </details>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs tracking-widest text-gold">{zh ? "储备" : "Reserves"}</summary>
          <p className="mt-2 font-mono text-xs text-ink/55">
            BEM {showOpenQuote(0, bemReserve)} / {showTape(tapeBem)} TAPE
            {" · "}
            OKB {showOpenQuote(1, okbReserve)} / {showTape(tapeOkb)} TAPE
          </p>
          <p className="mt-2 break-all text-xs text-ink/45">
            <a className="underline" href={`${XLAYER.explorer}/address/${pool}`} target="_blank" rel="noreferrer">{pool}</a>
            {" · "}
            {zh ? "旧池只留到期撤回" : "The old pool only withdraws"}{" "}
            <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_POOL}`} target="_blank" rel="noreferrer">{TAPE_POOL.slice(0, 6)}…{TAPE_POOL.slice(-4)}</a>
          </p>
          <ul className="mt-2 max-h-56 overflow-auto border border-gold/40">
            {positions.map((row) => {
              const due = row.unlock * 1000 <= Date.now();
              return (
                <li key={row.id} className="flex flex-col gap-2 border-t border-gold/30 px-2 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0 break-all">
                    #{row.id} · TAPE/{row.quote === 0 ? "BEM" : "OKB"} · {zh ? TAPE_TERMS[row.term]?.zh : TAPE_TERMS[row.term]?.en}
                    <span className="mt-1 block font-mono text-ink/50">{zh ? "到期" : "Unlocks"} {when(row.unlock)}</span>
                  </span>
                  <button
                    type="button"
                    disabled={busy || !due || !account}
                    className="min-h-8 border border-gold px-2 disabled:opacity-40"
                    onClick={() => {
                      if (!account) return;
                      setBusy(true);
                      removeOpenPool(account, BigInt(row.id))
                        .then((tx) => say(zh ? `已撤回。${tx}` : `Removed. ${tx}`))
                        .catch((error) => say(error instanceof Error && /rejected|denied/i.test(error.message) ? (zh ? "你取消了。" : "You cancelled.") : (zh ? "撤回没有完成。" : "Remove did not finish."), true))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {due ? (zh ? "撤回" : "Remove") : (zh ? "未到期" : "Locked")}
                  </button>
                </li>
              );
            })}
            {account && positions.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "这个地址还没有质押。" : "This address has no stake."}</li> : null}
          </ul>
        </details>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs tracking-widest text-gold">{zh ? "解押" : "Unlock"}</summary>
          <ul className="mt-2 divide-y divide-gold/30">
            {locks.length === 0 ? <li className="py-2 text-sm text-ink/60">{zh ? "还没读到池子的解押时间。" : "The pool unlock time has not loaded."}</li> : null}
            {locks.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3 py-2 font-mono text-xs">
                <span>#{row.id} · TAPE/{row.quote === 0 ? "BEM" : "OKB"} · {zh ? TAPE_TERMS[row.term]?.zh : TAPE_TERMS[row.term]?.en}</span>
                <span className="shrink-0 text-ink/70">{zh ? "解押" : "Unlocks"} {when(row.unlock)}</span>
              </li>
            ))}
          </ul>
        </details>
          </div>
        </details>
      </div>
      <form
        className="flex flex-col gap-3 border border-gold/50 bg-card p-3 shadow-plate lg:sticky lg:top-28 lg:col-span-5 lg:self-start"
        onSubmit={(event) => {
          event.preventDefault();
          if (!account || over || !amount.trim() || !out || !minOut || !live) return;
          setCard(true);
        }}
      >
        <label className="border border-gold px-3 py-3">
              <span className="flex items-center justify-between text-xs text-ink/55">
                <span>{zh ? "你支付" : "You pay"}</span>
                <span className="max-w-[12rem] truncate font-mono">{zh ? "余额" : "Balance"} {account ? pretty(payRaw, payDecimals, 4) : "—"} {side === "buy" ? unit : "TAPE"}</span>
              </span>
              <span className="mt-2 flex items-center gap-2">
                <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0" className="w-full bg-transparent font-mono text-3xl outline-none" aria-label={zh ? "你支付" : "You pay"} />
                {side === "buy" ? (
                  <span className="flex shrink-0 border border-gold">
                    {([0, 1] as const).map((id) => (
                      <button key={id} type="button" onClick={() => { setQuote(id); setAmount(""); setOut(null); setMinOut(null); }} className={`min-h-9 px-2 font-mono text-sm ${quote === id ? "bg-ink text-paper" : ""}`}>{id === 0 ? "BEM" : "OKB"}</button>
                    ))}
                  </span>
                ) : <span className="shrink-0 font-mono text-sm">TAPE</span>}
              </span>
            </label>
            <button type="button" className="mx-auto flex h-9 w-9 items-center justify-center border border-gold bg-paper text-lg leading-none" aria-label={zh ? "对调" : "Flip"} onClick={() => { setSide(side === "buy" ? "sell" : "buy"); setAmount(""); setOut(null); setMinOut(null); }}>↓</button>
            <div className="border border-gold px-3 py-3">
              <span className="flex items-center justify-between text-xs text-ink/55">
                <span>{zh ? "你收到" : "You receive"}</span>
                <span className="font-mono">{zh ? "余额" : "Balance"} {account ? (side === "buy" ? pretty(balTape, 8, 4) : pretty(quote === 0 ? balBem : balOkb, quote === 0 ? 8 : 18, 4)) : "—"} {side === "buy" ? "TAPE" : unit}</span>
              </span>
              <span className="mt-2 flex items-center justify-between gap-2">
                <span className="font-mono text-3xl tabular-nums">{out ?? "0"}</span>
                {side === "sell" ? (
                  <span className="flex shrink-0 border border-gold">
                    {([0, 1] as const).map((id) => (
                      <button key={id} type="button" onClick={() => { setQuote(id); setAmount(""); setOut(null); setMinOut(null); }} className={`min-h-9 px-2 font-mono text-sm ${quote === id ? "bg-ink text-paper" : ""}`}>{id === 0 ? "BEM" : "OKB"}</button>
                    ))}
                  </span>
                ) : <span className="shrink-0 font-mono text-sm">TAPE</span>}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} type="button" onClick={() => setAmount(sized(payRaw, payDecimals, pct, spendCap))} className="min-h-9 border border-gold font-mono text-xs">
                  {pct === 100 ? (zh ? "全部" : "Max") : `${pct}%`}
                </button>
              ))}
            </div>
            <details className="text-xs text-ink/60">
              <summary className="cursor-pointer">{zh ? "价格和台费" : "Price and fee"}</summary>
              <div className="mt-2 grid gap-1 font-mono">
                <p className="flex justify-between gap-3"><span>{zh ? "价格" : "Price"}</span><span className="text-right">1 TAPE = {rateText} {unit}{shown ? ` · ${shown} USDT` : ""}</span></p>
                <p className="flex justify-between gap-3"><span>{zh ? "台费 0.20%" : "Fee 0.20%"}</span><span>{typed > 0n ? pretty(fee, payDecimals, 4) : "—"} {side === "buy" ? unit : "TAPE"}</span></p>
                <p className="flex justify-between gap-3"><span>{zh ? "最少到账" : "Minimum"}</span><span>{minOut ?? "—"} {side === "buy" ? "TAPE" : unit}</span></p>
                <p className="flex justify-between gap-3"><span>{zh ? "滑点" : "Slippage"}</span><span>1%</span></p>
              </div>
            </details>
            {account && over ? <p className="text-sm text-sell">{zh ? `余额不够。支付的是 X Layer 的 ${side === "buy" ? unit : "TAPE"}。BSC 的 BEM 用顶上的跨链转过来。` : `Not enough balance. This pays X Layer ${side === "buy" ? unit : "TAPE"}. Bridge BSC BEM from the tab above.`}</p> : null}
            {account && miss && amount.trim() && !over ? <p className="text-sm text-sell">{zh ? "报价没读到。稍等，或把数量改一下再试。" : "The quote did not come back. Wait, or change the size."}</p> : null}
            {!live ? <p className="text-sm text-sell">{zh ? "池子还没打开买卖。" : "Trading is not open."}</p> : null}
            {side === "buy" && quote === 1 ? <p className="text-xs text-ink/55">{zh ? "OKB 从钱包支付，gas 另留 0.002。" : "OKB is paid from the wallet. 0.002 stays for gas."}</p> : null}
            {!account ? (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => void connectHere("okx")}>{zh ? "用 OKX 连接" : "Connect OKX"}</button>
                <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => void connectHere("binance")}>{zh ? "用币安连接" : "Connect Binance"}</button>
              </div>
            ) : (
              <button type="submit" className="min-h-12 bg-ink text-paper disabled:opacity-40" disabled={busy || over || !live || !amount.trim() || !out || !minOut}>
                {zh ? "兑换" : "Swap"}
              </button>
            )}
        {openLink ? <a className="inline-flex min-h-11 items-center justify-center border border-gold bg-ink px-3 text-paper" href={openLink} target="_blank" rel="noreferrer">{zh ? "没弹出的话，点这里打开 OKX" : "If nothing opened, open OKX"}</a> : null}
        {note ? <p className={`break-all text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        {hash ? <a className="break-all text-sm underline decoration-gold underline-offset-4" href={`${XLAYER.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">{c.walletTx}</a> : null}
        <details className="text-xs leading-5 text-ink/60">
          <summary className="cursor-pointer">{zh ? "加池质押" : "Add a stake"}</summary>
          <div className="mt-2 flex flex-col gap-2">
            <input value={addTape} onChange={(event) => setAddTape(event.target.value)} inputMode="decimal" placeholder="TAPE" className="min-h-10 border border-gold bg-transparent px-2 font-mono outline-none" />
            <input value={addQuote} onChange={(event) => setAddQuote(event.target.value)} inputMode="decimal" placeholder={unit} className="min-h-10 border border-gold bg-transparent px-2 font-mono outline-none" />
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
              {TAPE_TERMS.map((row) => (
                <button key={row.id} type="button" onClick={() => { setTerm(row.id); setAck(false); }} className={`min-h-9 border px-1 ${term === row.id ? "border-ink bg-ink text-paper" : "border-gold"}`}>{zh ? row.zh : row.en}</button>
              ))}
            </div>
            <label className="flex gap-2"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{zh ? "我知道到期前取不出来" : "I know this cannot be removed early"}</label>
            <button type="button" disabled={busy || !ack} className="min-h-10 border border-gold disabled:opacity-40" onClick={() => void add()}>{zh ? "签名并质押" : "Sign and stake"}</button>
          </div>
        </details>
        {card ? (
          <SignCard
            title={zh ? "签名前看一眼" : "Before you sign"}
            yes={zh ? `签名并${side === "buy" ? "买入" : "卖出"}` : `Sign and ${side === "buy" ? "buy" : "sell"}`}
            no={zh ? "取消" : "Cancel"}
            warn={zh ? "这是 X Layer 的 TAPE 现货。钱包会切到 X Layer。台费在这一笔成交里扣，整笔进收费地址，没有邀请人。不是先另付。滑点超过 1% 就整笔取消。" : "This is X Layer TAPE spot. The wallet switches to X Layer. The 0.20% fee is inside this trade and goes entirely to the fee address. There is no referrer and no separate fee first. Over 1% slippage cancels the whole trade."}
            onNo={() => setCard(false)}
            onYes={() => {
              if (!floor || Date.now() - quotedAt > 30_000) {
                setCard(false);
                say(zh ? "报价超过 30 秒，已经作废。看新的最少到账再签。" : "The quote is older than 30 seconds. Read the new minimum, then sign.", true);
                return;
              }
              const min = floor;
              setCard(false);
              void trade(min);
            }}
            lines={[
              { k: zh ? "这一笔" : "This order", v: `${side === "buy" ? (zh ? "买入" : "Buy") : zh ? "卖出" : "Sell"} ${amount} ${side === "buy" ? unit : "TAPE"}` },
              { k: zh ? "池子约得" : "Pool estimate", v: `${out ?? "—"} ${side === "buy" ? "TAPE" : unit}` },
              { k: zh ? "台费，在成交里扣" : "Fee, inside the trade", v: `${typed > 0n ? pretty(fee, payDecimals, 4) : "—"} ${side === "buy" ? unit : "TAPE"}` },
              { k: zh ? "滑点 1% 内最少到账" : "Minimum within 1% slippage", v: `${minOut ?? "—"} ${side === "buy" ? "TAPE" : unit}` },
              { k: zh ? "收费地址" : "Fee address", v: TAPE_FEE, href: `${XLAYER.explorer}/address/${TAPE_FEE}` },
            ]}
          />
        ) : null}
      </form>
    </div>
  );
}

function GasSwap({ account, zh }: { account: string | null; zh: boolean }) {
  const [toOkb, setToOkb] = useState(true);
  const [amt, setAmt] = useState("");
  const [bnb, setBnb] = useState<bigint | null>(null);
  const [okb, setOkb] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<GasQuote | null>(null);
  const [cut, setCut] = useState<bigint | null>(null);
  const [net, setNet] = useState<bigint | null>(null);
  const [badQuote, setBadQuote] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const keep = 2_000_000_000_000_000n;
  const pay = toOkb ? bnb : okb;
  const typed = (() => { try { return parseUnits(amt.trim() || "0", 18); } catch { return 0n; } })();
  const over = pay != null && typed > 0n && typed + keep > pay;
  useEffect(() => {
    if (!account) { setBnb(null); setOkb(null); return; }
    let dead = false;
    readGasBalances(account).then((row) => { if (!dead) { setBnb(row.bnb); setOkb(row.okb); } }).catch(() => { if (!dead) { setBnb(null); setOkb(null); } });
    return () => { dead = true; };
  }, [account, busy]);
  useEffect(() => {
    if (typed <= 0n) { setCut(null); setNet(null); setQuote(null); return; }
    let dead = false;
    const plain = (typed * 20n) / 10_000n;
    const ready = account
      ? deskParts(toOkb ? "bsc" : "xlayer", account, typed).then((parts) => ({ charge: parts.reward + parts.desk, swapIn: parts.swapIn }))
      : Promise.resolve({ charge: plain, swapIn: typed - plain });
    ready.then((row) => { if (!dead) { setCut(row.charge); setNet(row.swapIn); } }).catch(() => { if (!dead) { setCut(plain); setNet(typed - plain); } });
    return () => { dead = true; };
  }, [account, toOkb, typed]);
  useEffect(() => {
    if (!account || !net || net <= 0n) { setQuote(null); setBadQuote(false); return; }
    let dead = false;
    const id = window.setTimeout(() => {
      quoteGasSwap(toOkb, account, net)
        .then((row) => { if (!dead) { setQuote({ out: row.out, min: row.min, seconds: row.seconds }); setBadQuote(false); } })
        .catch(() => { if (!dead) { setQuote(null); setBadQuote(true); } });
    }, 400);
    return () => { dead = true; window.clearTimeout(id); };
  }, [account, toOkb, net]);
  const unit = toOkb ? "BNB" : "OKB";
  const got = toOkb ? "OKB" : "BNB";
  return (
    <div className="grid gap-2 border-t border-gold/40 pt-4">
      <p className="text-xs tracking-widest text-gold">{zh ? "BNB 和 OKB" : "BNB and OKB"}</p>
      <p className="text-xs leading-5 text-ink/60">{zh ? "这是兑换，不是 1:1。BSC 的 BNB 换成 X Layer 的 OKB，回来也按当时的价。台费 0.20%，先付。扣过之后再报价。gas 另留 0.002。台费不退。" : "This is a swap, not 1:1. BSC BNB becomes X Layer OKB at the quote, and the way back is priced too. The site fee is 0.20%, paid first. The quote is on what remains. 0.002 stays for gas. The fee is not returned."}</p>
      <div className="grid grid-cols-2 border border-gold text-sm">
        <button type="button" className={`min-h-11 ${toOkb ? "bg-ink text-paper" : ""}`} onClick={() => { setToOkb(true); setAmt(""); setQuote(null); }}>BNB → OKB</button>
        <button type="button" className={`min-h-11 ${!toOkb ? "bg-ink text-paper" : ""}`} onClick={() => { setToOkb(false); setAmt(""); setQuote(null); }}>OKB → BNB</button>
      </div>
      <label className="border border-gold px-3 py-2">
        <span className="flex items-center justify-between text-xs text-ink/55">
          <span>{zh ? "你支付" : "You pay"}</span>
          <button type="button" className="font-mono" onClick={() => { if (pay && pay > keep) setAmt(formatUnits(pay - keep, 18)); }}>{zh ? "余额" : "Balance"} {pay == null ? "—" : showGas(pay)} {unit}</button>
        </span>
        <span className="mt-1 flex items-baseline gap-2">
          <input value={amt} onChange={(event) => setAmt(event.target.value)} inputMode="decimal" placeholder="0" className="w-full bg-transparent font-mono text-3xl outline-none" />
          <span className="font-mono text-sm">{unit}</span>
        </span>
      </label>
      <p className="border border-gold/40 px-3 py-2">
        <span className="block text-xs text-ink/55">{zh ? "你大约收到" : "You receive about"}</span>
        <span className="font-mono text-2xl tabular-nums">{quote ? showGas(quote.out) : "—"} {got}</span>
        <span className="mt-1 block font-mono text-xs text-ink/55">{zh ? "最少" : "Minimum"} {quote ? showGas(quote.min) : "—"} {got} · {zh ? "台费" : "Site fee"} {cut == null ? "—" : showGas(cut)} {unit}</span>
      </p>
      {over ? <p className="text-sm text-sell">{zh ? `余额不够。${unit} 还要留 0.002 当 gas。` : `Not enough ${unit}. 0.002 stays for gas.`}</p> : null}
      {badQuote && typed > 0n && !over ? <p className="text-sm text-sell">{zh ? "这条兑换现在没有报价。数量改一下，或稍后再试。" : "There is no quote for this swap right now. Change the amount, or try again."}</p> : null}
      <button
        type="button"
        disabled={busy || !account || over || typed <= 0n || !quote}
        className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40"
        onClick={() => {
          if (!account) return;
          setBusy(true);
          sendGasSwap(toOkb, account, typed)
            .then((tx) => { setBad(false); setNote(zh ? `已提交。到账要等，不是这一笔里立刻到。${tx}` : `Submitted. It arrives later, not inside this transaction. ${tx}`); })
            .catch((error: unknown) => {
              setBad(true);
              const text = error instanceof Error ? error.message : "";
              setNote(/fee-kept/.test(text) ? (zh ? "台费已付，兑换没有完成。这一笔不退。其余还在原来的链上。" : "The site fee was paid and the swap did not finish. That fee is not returned. The rest stayed on the original chain.") : /rejected|denied|4001/i.test(text) ? (zh ? "你取消了。" : "You cancelled.") : /insufficient funds/i.test(text) ? (zh ? `${unit} 不够。币还在原来的链上。` : `Not enough ${unit}. It stayed on the original chain.`) : (zh ? "没有换成。币还在原来的链上。" : "It did not swap. The coins stayed on the original chain."));
            })
            .finally(() => setBusy(false));
        }}
      >{zh ? "签名兑换" : "Sign the swap"}</button>
      {note ? <p className={`break-all text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );
}

export function TapeBridgePage() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [xBem, setXBem] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [openLink, setOpenLink] = useState<string | null>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => onOpenLink(setOpenLink), []);
  useEffect(() => {
    if (!account) {
      setXBem(null);
      return;
    }
    let dead = false;
    readOpenPool(account).then((row) => { if (!dead) setXBem(row.bemBal); }).catch(() => { if (!dead) setXBem(null); });
    return () => { dead = true; };
  }, [account]);
  const connectHere = async (which: "okx" | "binance") => {
    setBusy(true);
    try {
      const from = await connectKind(which);
      await connectXLayer();
      setAccount(from);
    } catch (error) {
      if (error instanceof Error && error.message === "binanceapp") return;
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3 py-2">
      {account ? <OfficialBridge account={account} zh={zh} xBem={xBem} bare /> : (
        <>
          <p className="text-xs leading-5 text-ink/60">{zh ? "这条桥只走 BEM。TAPE 没有 BSC 合约，不能跨过去。" : "This bridge only moves BEM. TAPE has no BSC contract, so it cannot cross."}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => void connectHere("okx")}>{zh ? "用 OKX 连接" : "Connect OKX"}</button>
            <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => void connectHere("binance")}>{zh ? "用币安连接" : "Connect Binance"}</button>
          </div>
        </>
      )}
      <GasSwap account={account} zh={zh} />
      {openLink ? <a className="inline-flex min-h-11 items-center justify-center border border-gold bg-ink px-3 text-paper" href={openLink} target="_blank" rel="noreferrer">{zh ? "没弹出的话，点这里打开 OKX" : "If nothing opened, open OKX"}</a> : null}
    </div>
  );
}
