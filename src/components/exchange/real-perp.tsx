import { useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { copy } from "@/lib/copy";
import { BSC, FEE_TO, connectBsc, pretty, units, type Balances } from "@/lib/bsc";
import { getCandles, type Candle, type CandleFrame } from "@/lib/candles";
import { currentAccount, onAccount, onOpenLink } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";
import { SignCard } from "@/components/exchange/sign-card";
import { useFeeLock } from "@/lib/fee-lock";
import { Kline } from "@/components/exchange/kline";
import { nickOf, readNicks } from "@/lib/nicks";
import { clearArm, easyBand, readArm, writeArm, type Arm } from "@/lib/stops";
import {
  cancelPerp,
  closePerp,
  deployXLayer,
  bookOf,
  KNOWN_XPERP,
  liquidatePerp,
  openPerp,
  pushMark,
  pxText,
  readChainPurse,
  readPerp,
  readBoard,
  savedDesk,
  selectDesk,
  activeBook,
  takePerp,
  usdtText,
  type BookQuote,
  type Desk,
  type PerpView,
} from "@/lib/perp";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function named(addr: string): string {
  const nick = nickOf(addr, readNicks());
  return nick ? `${nick} · ${short(addr)}` : short(addr);
}

const zero = "0x0000000000000000000000000000000000000000";

const presets = [
  { id: "try", margin: "10", lev: 1 },
  { id: "daily", margin: "25", lev: 2 },
  { id: "push", margin: "50", lev: 3 },
] as const;

function plan(margin: string, lev: number, mark: bigint) {
  const m = Number(margin);
  if (!Number.isFinite(m) || m <= 0 || mark <= 0n) return null;
  const px = Number(formatUnits(mark, 18));
  if (!Number.isFinite(px) || px <= 0) return null;
  return { notional: m * lev, size: (m * lev) / px, adverse: Math.max(1, Math.round(90 / lev)) };
}

function DeskLadder({
  rows,
  mark,
  account,
  busy,
  dec,
  scan,
  named,
  lang,
  onTake,
  onCancel,
}: {
  rows: { perp: string; quote: BookQuote }[];
  mark: number;
  account: string | null;
  busy: boolean;
  dec: number;
  scan: string;
  named: (addr: string) => string;
  lang: "zh" | "en";
  onTake: (book: string, quote: BookQuote) => void;
  onCancel: (book: string, quote: BookQuote) => void;
}) {
  const drawn = rows.map(({ perp, quote }) => {
    const limit = quote.price > 0n ? Number(formatUnits(quote.price, 18)) : 0;
    const px = limit > 0 ? limit : mark;
    const margin = Number(formatUnits(quote.margin, dec));
    const size = px > 0 ? (margin * quote.lev) / px : 0;
    return { perp, quote, px, limit, margin, size };
  });
  const away = (row: (typeof drawn)[number]) => mark > 0 && row.px > 0 && Math.abs(row.px - mark) / mark > 0.15;
  const asks = drawn.filter((row) => !row.quote.long).sort((a, b) => b.px - a.px);
  const bids = drawn.filter((row) => row.quote.long).sort((a, b) => b.px - a.px);
  const nearAsks = asks.filter((row) => !away(row));
  const nearBids = bids.filter((row) => !away(row));
  const farCount = asks.length - nearAsks.length + (bids.length - nearBids.length);
  const [showFar, setShowFar] = useState(false);
  const [more, setMore] = useState(false);
  const bookAsks = nearAsks.length + nearBids.length > 0 && !showFar ? nearAsks : asks;
  const bookBids = nearAsks.length + nearBids.length > 0 && !showFar ? nearBids : bids;
  const askRows = more ? bookAsks : bookAsks.slice(-6);
  const bidRows = more ? bookBids : bookBids.slice(0, 6);
  const hidden = bookAsks.length + bookBids.length - askRows.length - bidRows.length;
  const bestAsk = (nearAsks.length ? nearAsks : asks).at(-1)?.px ?? 0;
  const bestBid = (nearBids.length ? nearBids : bids).at(0)?.px ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const zh = lang === "zh";
  const line = (row: (typeof drawn)[number], takeLong: boolean) => {
    const mine = Boolean(account && row.quote.user.toLowerCase() === account.toLowerCase());
    const pct = mark > 0 && row.px > 0 ? ((row.px - mark) / mark) * 100 : null;
    return (
      <div key={`${row.perp}-${row.quote.id}`} className="grid grid-cols-[2.2rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-gold/20 px-2 py-2 text-sm">
        <span className={takeLong ? "text-sell" : "text-[#1b6b45]"}>{takeLong ? (zh ? "空" : "S") : zh ? "多" : "L"}</span>
        <span className="min-w-0 font-mono tabular-nums">
          <span className={takeLong ? "text-sell" : "text-[#1b6b45]"}>{row.limit > 0 ? row.px.toFixed(4) : zh ? "随标记" : "At mark"}</span>
          {pct != null ? <span className="ml-2 text-xs text-ink/45">{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span> : null}
          <span className="mt-0.5 block truncate text-xs text-ink/60">
            {row.margin.toFixed(2)} USDT · {row.quote.lev}× · {row.size.toFixed(2)} BEM
            {away(row) ? (zh ? " · 偏离" : " · far") : ""}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          {mine ? (
            <button type="button" disabled={busy} onClick={() => onCancel(row.perp, row.quote)} className="min-h-8 border border-gold px-2 text-xs">
              {zh ? "撤单" : "Cancel"}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => onTake(row.perp, row.quote)} className="min-h-8 border border-gold px-2 text-xs">
              {takeLong ? (zh ? "吃单开多" : "Take long") : zh ? "吃单开空" : "Take short"}
            </button>
          )}
          <a className="text-xs text-ink/50 underline" href={`${scan}/address/${row.quote.user}`} target="_blank" rel="noreferrer">
            {named(row.quote.user).slice(0, 6)}
          </a>
        </span>
      </div>
    );
  };
  return (
    <div className="border-t border-gold/30">
      <p className="px-2 pt-2 font-mono text-xs text-ink/60">
        {zh ? "卖一" : "Ask"} {bestAsk > 0 ? bestAsk.toFixed(4) : "—"}
        {" · "}
        {zh ? "买一" : "Bid"} {bestBid > 0 ? bestBid.toFixed(4) : "—"}
        {spread > 0 ? ` · ${zh ? "价差" : "Spread"} ${((spread / Math.max(mark, bestBid)) * 100).toFixed(2)}%` : ""}
      </p>
      <div className="grid grid-cols-[2.2rem_minmax(0,1fr)_auto] gap-2 px-2 py-1 text-xs text-ink/50">
        <span>{zh ? "方向" : "Side"}</span>
        <span>{zh ? "价格 · 保证金 · 倍数" : "Price · margin · leverage"}</span>
        <span className="text-right">{zh ? "对手" : "Who"}</span>
      </div>
      {asks.length === 0 && bids.length === 0 ? <p className="px-2 py-3 text-sm text-ink/60">{zh ? "还没有人挂单。" : "Nobody has a quote yet."}</p> : null}
      {asks.length === 0 && bids.length > 0 ? <p className="px-2 py-1 text-xs text-ink/40">{zh ? "卖盘空" : "No asks"}</p> : null}
      {askRows.map((row) => line(row, true))}
      <p className="my-1 flex items-center gap-3 px-2 font-mono text-sm">
        <span className="h-px flex-1 bg-gold/40" />
        <span>{mark > 0 ? mark.toFixed(4) : "—"}</span>
        <span className="h-px flex-1 bg-gold/40" />
      </p>
      {bidRows.map((row) => line(row, false))}
      {bids.length === 0 && asks.length > 0 ? <p className="px-2 py-1 text-xs text-ink/40">{zh ? "买盘空" : "No bids"}</p> : null}
      {nearAsks.length + nearBids.length === 0 && farCount > 0 ? (
        <p className="px-2 pb-1 text-xs text-ink/50">{zh ? "这些价离标记超过 15%，成交价按挂单价，不按标记价。" : "These prices are more than 15% from the mark. A fill uses the quote, not the mark."}</p>
      ) : null}
      {farCount > 0 && nearAsks.length + nearBids.length > 0 ? (
        <button type="button" className="min-h-9 w-full text-xs text-ink/60" onClick={() => setShowFar((value) => !value)}>
          {showFar ? (zh ? "收起偏离的单" : "Hide far quotes") : zh ? `偏离标记价 ${farCount} 张` : `${farCount} far from the mark`}
        </button>
      ) : null}
      {hidden > 0 || more ? (
        <button type="button" className="min-h-9 w-full border-t border-gold/30 text-xs" onClick={() => setMore((value) => !value)}>
          {more ? (zh ? "收起" : "Fold") : zh ? `再看 ${hidden} 张` : `${hidden} more`}
        </button>
      ) : null}
    </div>
  );
}

export function RealPerp() {
  const lang = useExchange((s) => s.lang);
  const live = useExchange((s) => s.chainBem);
  const c = copy[lang];
  const [chain, setChain] = useState<Desk>(savedDesk());
  const [perp, setPerp] = useState(() => bookOf(savedDesk()));
  const [redeploy, setRedeploy] = useState(false);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [view, setView] = useState<PerpView | null>(null);
  const [margin, setMargin] = useState("1");
  const [lev, setLev] = useState(3);
  const [mode, setMode] = useState<"easy" | "pro">("easy");
  const [hot, setHot] = useState(false);
  const [sheet, setSheet] = useState<"book" | "mine">("book");
  const [levText, setLevText] = useState("3");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [bal, setBal] = useState<Balances | null>(null);
  const [prices, setPrices] = useState<Candle[]>([]);
  const [frame, setFrame] = useState<CandleFrame>("1m");
  const [limit, setLimit] = useState("");
  const [board, setBoard] = useState<{ perp: string; quote: BookQuote }[]>([]);
  const [guard, setGuard] = useState<"easy" | "pro" | "off">("easy");
  const [tpText, setTpText] = useState("");
  const [slText, setSlText] = useState("");
  const [arm, setArm] = useState<Arm | null>(null);
  const [card, setCard] = useState<"long" | "short" | null>(null);
  const lock = useFeeLock();
  const firing = useRef(false);

  useEffect(() => {
    if (!account) return;
    setArm(readArm(account, perp));
  }, [account, perp, hash]);

  useEffect(() => {
    if (!account || !view || view.myDeal <= 0n || firing.current) return;
    const row = readArm(account, perp);
    if (!row || row.spent || row.hold) return;
    const id = view.myDeal.toString();
    if (row.deal && row.deal !== id) return;
    if (!row.deal && row.before != null && row.before === id) return;
    const px = live && live > 0 ? live : view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0;
    if (!(px > 0)) return;
    const hit = row.long ? px >= row.tp || px <= row.sl : px <= row.tp || px >= row.sl;
    if (!hit) return;
    firing.current = true;
    const bound = { ...row, deal: id, spent: false, hold: false };
    writeArm(bound);
    setArm(bound);
    const from = account;
    closePerp(from, perp, view.myDeal)
      .then(() => {
        const done = { ...bound, spent: true, hold: false };
        writeArm(done);
        setArm(done);
        setNote(lang === "zh" ? "止盈或止损已平仓。" : "The stop closed the position.");
        setBad(false);
      })
      .catch(() => {
        const held = { ...bound, spent: false, hold: true };
        writeArm(held);
        setArm(held);
        setNote(lang === "zh" ? "平仓没有完成。保护还在，但不会自动再弹钱包。点再试一次。" : "The close did not finish. The stop is still there, but the wallet will not pop again until you tap retry.");
        setBad(true);
      })
      .finally(() => {
        firing.current = false;
      });
  }, [account, perp, view?.myDeal, view?.mark, live, hash, lang]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const ref = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("ref") || new URLSearchParams(window.location.search).get("ref");
      if (ref) {
        selectDesk("xlayer");
        setChain("xlayer");
        setPerp(bookOf("xlayer"));
      } else {
        activeBook()
          .then(setPerp)
          .catch(() => setPerp(bookOf()));
      }
    }
    const stopAccount = onAccount(setAccount);
    const stopLink = onOpenLink(setLink);
    return () => {
      stopAccount();
      stopLink();
    };
  }, []);

  useEffect(() => {
    if (!account) return;
    let dead = false;
    readChainPurse(chain, account)
      .then((next) => {
        if (!dead) setBal({ bnb: next.gas, usdt: next.usdt, bem: 0n });
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [account, hash, chain]);

  useEffect(() => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) return;
    let dead = false;
    const load = () => {
      selectDesk(chain);
      readPerp(perp, account)
        .then((next) => {
          if (!dead) setView(next);
        })
        .catch((err: unknown) => {
          if (dead) return;
          setView(null);
          const message = err instanceof Error ? err.message : "";
          if (message === "nochain") setNote(c.perpNoChain);
        });
      readBoard()
        .then((rows) => {
          if (!dead) setBoard(rows);
        })
        .catch(() => undefined);
      getCandles({ data: frame })
        .then((next) => {
          if (!dead) setPrices(next);
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 12000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [perp, account, hash, frame, chain]);

  const fail = (err: unknown) => {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (message === "nowallet") setNote(c.walletNo);
    else if (message === "usdt") setNote(chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt);
    else if (message === "nochain") setNote(c.perpNoChain);
    else if (message === "oracle") setNote(lang === "zh" ? "只有收费地址能写标记价。" : "Only the fee address can post the mark.");
    else if (chain === "xlayer" && /revert|execution|Bad/i.test(message)) setNote(lang === "zh" ? "没开成。十分钟均价还是空的。用收费地址隔 30 秒点一次「推进」，连续大约 10 分钟之后才能开仓。" : "It did not open. The ten-minute average is empty. The fee address posts every 30 seconds for about 10 minutes before an open can succeed.");
    else if (code === 4001) setNote(c.walletReject);
    else if (/RPC|publicnode|Archive|Invalid param/i.test(message)) setNote(c.rpcWait);
    else if (message === "amount") setNote(lang === "zh" ? "数量不对。先看保证金和价格有没有填上。" : "That amount is not valid. Check the margin and the price.");
    else if (message === "price") setNote(c.badPrice);
    else if (message === "lev") setNote(c.levCap);
    else if (message === "code") setNote(lang === "zh" ? "推荐码用 1 到 16 个英文字，汉字最多 5 个。" : "Use 1 to 16 English characters, or up to 5 Chinese characters.");
    else if (message === "taken") setNote(c.rebateTaken);
    else if (message === "have") setNote(c.rebateHave);
    else setNote(message || c.walletReject);
    setBad(true);
  };

  const run = async (task: (from: string) => Promise<unknown>, kind?: "cancel") => {
    setBusy(true);
    setBad(false);
    setNote(c.walletBusy);
    try {
      selectDesk(chain);
      const from = account ?? (chain === "xlayer" ? await connectXLayer() : await connectBsc());
      setAccount(from);
      const result = await task(from);
      if (typeof result === "string" && result.length === 66) setHash(result);
      setNote(null);
    } catch (err) {
      if (kind === "cancel") {
        setNote(lang === "zh" ? "撤单未确认，单仍在合约里。可再试一次。" : "Cancel was not confirmed. The order is still in the contract. Try again.");
        setBad(true);
      } else fail(err);
    } finally {
      setBusy(false);
    }
  };

  const waiting = view && view.pendingUser !== zero;
  const mine = Boolean(account && waiting && view?.pendingUser.toLowerCase() === account.toLowerCase());
  const inDeal = view?.kind === 2;
  const dec = chain === "xlayer" ? 6 : 18;
  const scan = chain === "xlayer" ? XLAYER.explorer : BSC.explorer;
  const floor = view && view.min > 0n ? Number(view.min / 10n ** BigInt(dec)) : 1;
  const levCap = mode === "easy" ? 20 : 1000;
  const levOk = lev >= 1 && lev <= levCap;
  const marginOk = (() => {
    const n = Number(margin);
    return Number.isFinite(n) && n >= floor && n <= 500;
  })();
  const ticketPx = (() => {
    try {
      return limit.trim() ? units(limit, 18) : (view?.mark ?? 0n);
    } catch {
      return view?.mark ?? 0n;
    }
  })();
  const priceOk = ticketPx >= 10n ** 16n && ticketPx <= 100_000n * 10n ** 18n;
  const ticket = plan(margin, levOk ? lev : 1, ticketPx);
  const liqMove = levOk ? (Math.max(0.05, Math.round(5000 / lev) / 100)).toFixed(2) : null;
  let need = 0n;
  try {
    need = units(margin, dec);
  } catch {
    need = 0n;
  }
  const easy = floor <= 1
    ? [
        { id: "try", margin: "1", lev: 3 },
        { id: "daily", margin: "5", lev: 5 },
        { id: "push", margin: "10", lev: 10 },
      ]
    : presets;
  const markN = live && live > 0 ? live : view && view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0;
  const entryN = view && view.dealEntry > 0n ? Number(formatUnits(view.dealEntry, 18)) : 0;
  const pick = (nextMargin: string, nextLev: number) => {
    setMargin(nextMargin);
    setLev(nextLev);
    setLevText(String(nextLev));
  };

  return (
    <section className="border border-gold bg-card shadow-plate">
      <div className="flex flex-col gap-3 p-3">
        <p className="text-sm leading-relaxed text-ink/80 xl:col-span-12">{chain === "xlayer" ? c.perpWarnX : c.perpWarn}</p>
        {chain === "xlayer" ? (
          <p className="border border-sell px-3 py-2 text-sm text-sell xl:col-span-12">
            {lang === "zh"
              ? "X Layer 这一本。标记只许收费地址写，结算用 10 分钟均价。均价现在还是空的，开仓会失败。收费地址每隔 30 秒点一次「推进」，写满约 10 分钟。"
              : "This is the X Layer book. Only the fee address can post the mark, and settlement uses a 10-minute average. The average is empty, so an open fails. That address posts about every 30 seconds for 10 minutes."}
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 xl:col-span-12">
          <button
            type="button"
            className={`min-h-12 border border-gold ${chain === "bsc" ? "bg-ink text-paper" : ""}`}
            onClick={() => {
              selectDesk("bsc");
              setChain("bsc");
              setPerp(bookOf("bsc"));
              connectBsc().catch(() => undefined);
            }}
          >
            BSC · USDT
          </button>
          <button
            type="button"
            className={`min-h-12 border border-gold ${chain === "xlayer" ? "bg-ink text-paper" : ""}`}
            onClick={() => {
              selectDesk("xlayer");
              setChain("xlayer");
              setPerp(bookOf("xlayer"));
              connectXLayer().catch(() => undefined);
            }}
          >
            X Layer · USDT
          </button>
        </div>
        {chain === "xlayer" && !/^0x[a-fA-F0-9]{40}$/.test(KNOWN_XPERP) ? (
          <p className="text-sm leading-relaxed xl:col-span-12">{c.xOpen}</p>
        ) : null}
        {chain === "xlayer" && !/^0x[a-fA-F0-9]{40}$/.test(perp) ? (
          <button
            type="button"
            className="min-h-12 bg-ink text-paper xl:col-span-12"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setBad(false);
              const steps = [c.deployX1, c.deployX2, c.deployX3];
              setNote(steps[0]);
              void (async () => {
                try {
                  selectDesk("xlayer");
                  const from = account ?? (await connectXLayer());
                  setAccount(from);
                  const addr = await deployXLayer(from, (step) => setNote(steps[step - 1]));
                  setPerp(addr);
                  setNote(addr);
                } catch (err) {
                  fail(err);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {c.deployX}
          </button>
        ) : null}
        {chain === "xlayer" && /^0x[a-fA-F0-9]{40}$/.test(perp) ? (
          <button type="button" className="min-h-11 border border-gold xl:col-span-12" disabled={busy} onClick={() => run(async (from) => {
            if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("oracle");
            await pushMark(from);
            return "ok";
          })}>
            {c.pushMark}
          </button>
        ) : null}
        {link ? (
          <a href={link} className="inline-flex min-h-12 items-center justify-center bg-ink px-3 text-paper xl:col-span-12">
            {c.signOkx}
          </a>
        ) : null}
        <p className="border border-gold/40 px-3 py-2">
          <span className="block text-xs tracking-widest text-gold">{c.yourEq}</span>
          <span className="font-mono text-2xl tabular-nums">{view && account ? usdtText(view.equity) : "—"}</span>
        </p>
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
        <div className="min-w-0 border border-gold bg-card">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/30 px-3 py-3">
            <div>
              <p className="font-display text-2xl italic">BEM / USDT</p>
              <p className="mt-1 break-all font-mono text-xs text-ink/60">
                {perp || "—"}
                {/^0x[a-fA-F0-9]{40}$/.test(perp) ? (
                  <>
                    {" "}
                    <a className="underline decoration-gold underline-offset-4" href={`${scan}/address/${perp}`} target="_blank" rel="noreferrer">
                      {chain === "xlayer" ? "OKLink" : "BscScan"}
                    </a>
                  </>
                ) : null}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs tracking-widest text-gold">{c.mark}</p>
              <p className="font-mono text-2xl tabular-nums">{markN > 0 ? markN.toFixed(4) : "—"}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 px-3 pt-2">
            <div className="flex w-full flex-wrap border border-gold">
              {(
                [
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
                ] as const
              ).map(([item, zhLabel, enLabel]) => (
                <button key={item} type="button" onClick={() => setFrame(item)} className={`min-h-9 shrink-0 px-2 font-mono text-xs sm:px-3 ${frame === item ? "bg-ink text-paper" : ""}`}>
                  {lang === "zh" ? zhLabel : enLabel}
                </button>
              ))}
            </div>
          </div>
          <Kline
            bars={
              prices.length
                ? prices
                : markN > 0
                  ? [{ o: entryN || markN, h: Math.max(entryN || markN, markN), l: Math.min(entryN || markN, markN), c: markN }]
                  : []
            }
            entry={entryN}
            mark={markN}
            lang={lang}
            desk="perp"
          />
          <DeskLadder
            rows={board}
            mark={markN}
            account={account}
            busy={busy}
            dec={dec}
            scan={scan}
            named={named}
            lang={lang}
            onTake={(book, quote) => {
              void run((from) => takePerp(from, book, quote.id, formatUnits(quote.margin, dec), quote.lev, quote.price > 0n));
            }}
            onCancel={(book, quote) => run((from) => cancelPerp(from, book, quote.id), "cancel")}
          />
          {!view ? <p className="px-3 py-2 text-sm text-ink/60">{lang === "zh" ? "正在读合约，读完才能开仓。" : "Reading the contract. Open waits until that finishes."}</p> : null}
          {lock.status === "bad" ? <p className="px-3 pb-2 text-sm text-sell">{lang === "zh" ? "收费地址对不上，开仓停了。" : "The fee address does not match. Opening is stopped."}</p> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-3 lg:max-h-[calc(100vh-1.5rem)] lg:overflow-y-auto">
        <div className="border border-gold/40 p-3">
          <p className="text-xs tracking-widest text-gold">{c.pkTitle}</p>
          {!view?.liveDeals.length ? (
            <p className="mt-2 text-sm text-ink/60">{lang === "zh" ? "还没有成交。上面是未成交的挂单，开仓在下面。" : "No matched deal yet. Resting quotes are above. Open further down."}</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              {view.liveDeals.map((deal) => {
                const mineLong = Boolean(account && deal.long.toLowerCase() === account.toLowerCase());
                const mineShort = Boolean(account && deal.short.toLowerCase() === account.toLowerCase());
                const mineDeal = mineLong || mineShort;
                const pnl = mineLong ? deal.eqL - deal.marginL : deal.eqS - deal.marginS;
                const ahead = deal.eqL === deal.eqS ? c.pkFlat : deal.eqL > deal.eqS ? `${c.pkLong}${c.pkLead}` : `${c.pkShort}${c.pkLead}`;
                return (
                  <div key={String(deal.id)} className="border border-gold/30 px-2 py-2 text-sm">
                    <p className="break-all font-mono text-xs text-[#1b6b45]">{c.pkLong} {named(deal.long)}{mineLong ? (lang === "zh" ? " · 我的" : " · mine") : ""} · {usdtText(deal.eqL)}</p>
                    <p className="break-all font-mono text-xs text-sell">{c.pkShort} {named(deal.short)}{mineShort ? (lang === "zh" ? " · 我的" : " · mine") : ""} · {usdtText(deal.eqS)}</p>
                    <p className="mt-1">{ahead} · {pxText(deal.entry)} → {markN > 0 ? markN.toFixed(4) : "—"}</p>
                    {mineDeal ? <p className={`mt-1 font-mono ${pnl >= 0n ? "text-gold" : "text-sell"}`}>{c.pnl} {pnl >= 0n ? "+" : ""}{pretty(pnl, dec, 4)} USDT</p> : null}
                    {mineDeal ? (
                      <button type="button" className="mt-2 min-h-11 bg-ink px-3 text-paper" disabled={busy} onClick={() => run((from) => closePerp(from, perp, deal.id))}>{c.closeDeal}</button>
                    ) : null}
                    {deal.weakL || deal.weakS ? (
                      <button type="button" className="mt-2 min-h-11 border border-sell px-3 text-sell" disabled={busy} onClick={() => run((from) => liquidatePerp(from, perp, deal.id))}>{c.liqNow}</button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {/^0x[a-fA-F0-9]{40}$/.test(perp) && (
          <div className="flex flex-col gap-3 border border-gold/40 p-3">
            {waiting ? (
              <p className="text-sm leading-relaxed">
                {mine ? c.perpOther : `${c.waitQuote} · ${view?.pendingLong ? c.postLong : c.postShort} · ${usdtText(view?.pendingMargin ?? 0n)} USDT · ${view?.pendingLev}×`}
                {" "}
                {c.pkMiss}
              </p>
            ) : null}
            {inDeal && !view?.book ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <p className="border border-gold/40 px-2 py-2">
                  <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "方向和倍数" : "Side and leverage"}</span>
                  <span className="font-mono">{view?.long ? (lang === "zh" ? "多" : "Long") : lang === "zh" ? "空" : "Short"}{(() => {
                    const notional = view ? Number(formatUnits(view.base, 18)) * Number(formatUnits(view.entry, 18)) : 0;
                    const marginN = view ? Number(formatUnits(view.margin, dec)) : 0;
                    const times = marginN > 0 && notional > 0 ? Math.max(1, Math.round(notional / marginN)) : 0;
                    return times ? ` · ${times}×` : "";
                  })()}</span>
                </p>
                <p className="border border-gold/40 px-2 py-2">
                  <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "保证金" : "Margin"}</span>
                  <span className="font-mono">{usdtText(view?.margin ?? view?.equity ?? 0n)} USDT</span>
                </p>
                <p className="border border-gold/40 px-2 py-2">
                  <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "强平价" : "Liquidation"}</span>
                  <span className="font-mono">{(() => {
                    const notional = view ? Number(formatUnits(view.base, 18)) * Number(formatUnits(view.entry, 18)) : 0;
                    const marginN = view ? Number(formatUnits(view.margin, dec)) : 0;
                    const times = marginN > 0 && notional > 0 ? Math.max(1, Math.round(notional / marginN)) : 0;
                    if (!(entryN > 0) || !times) return "—";
                    const px = view?.long ? entryN * (1 - 0.5 / times) : entryN * (1 + 0.5 / times);
                    return px.toFixed(4);
                  })()}</span>
                </p>
                <p className="border border-gold/40 px-2 py-2">
                  <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "开仓价" : "Entry"}</span>
                  <span className="font-mono">{pxText(view?.entry ?? 0n)}</span>
                </p>
              </div>
            ) : !waiting && !(view?.liveDeals.some((deal) => account && (deal.long.toLowerCase() === account.toLowerCase() || deal.short.toLowerCase() === account.toLowerCase()))) ? (
              <p className="text-sm text-ink/70">{lang === "zh" ? "本地址在这条链上没有未平仓。" : "This address has no open position on this chain."}</p>
            ) : null}
            {view?.book ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setSheet("book")} className={`min-h-11 border border-gold ${sheet === "book" ? "bg-ink text-paper" : ""}`}>
                    {c.bookMarket}
                  </button>
                  <button type="button" onClick={() => setSheet("mine")} className={`min-h-11 border border-gold ${sheet === "mine" ? "bg-ink text-paper" : ""}`}>
                    {c.myOrders}
                  </button>
                </div>
                {sheet === "mine" ? (
                  <>
                    {view.quotes.filter((quote) => account && quote.user.toLowerCase() === account.toLowerCase()).length === 0 ? (
                      <p className="text-sm text-ink/60">{lang === "zh" ? "你还没有未成交的挂单。" : "You have no resting quote."}</p>
                    ) : null}
                    {view.quotes
                      .filter((quote) => account && quote.user.toLowerCase() === account.toLowerCase())
                      .map((quote) => (
                          <div key={String(quote.id)} className="border border-gold/40 px-2 py-2">
                            <p className="font-mono text-sm">
                              #{quote.id.toString()} · {quote.long ? c.postLong : c.postShort} · {usdtText(quote.margin)} USDT · {quote.lev}×{quote.price > 0n ? ` · $${pxText(quote.price)}` : ""}
                            </p>
                            <p className="mt-1 font-mono text-xs text-ink/70">{c.openPnl}</p>
                            <button type="button" className="mt-2 min-h-11 border border-gold px-3" disabled={busy} onClick={() => run((from) => cancelPerp(from, perp, quote.id), "cancel")}>
                              {c.cancelPost}
                            </button>
                          </div>
                        ))}
                  </>
                ) : null}
              </>
            ) : null}
            {(view?.book ? sheet === "book" : !inDeal && !mine) ? (
              <>
                <ul className="flex flex-col gap-1 text-sm leading-6 text-ink/80">
                  <li>{lang === "zh" ? "保证金锁进本链这一份合约，平台不经手。" : "Margin stays in this chain's contract. The desk does not hold it."}</li>
                  <li>{lang === "zh" ? "亏到保证金大约一半即可强平。没有保险基金，也没有自动减仓。" : "About half the margin lost can liquidate. There is no insurance fund and no auto-deleveraging."}</li>
                  <li>{lang === "zh" ? "标记价是池子约 10 分钟均价，不用最后一笔。" : "The mark is about a 10-minute pool average, not the last trade."}</li>
                  <li>{lang === "zh" ? "BSC 的 USDT 和 X Layer 的 USDT0 不能合成一笔。" : "BSC USDT and X Layer USDT0 do not net."}</li>
                </ul>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => { setMode("easy"); if (lev > 20) { setLev(3); setLevText("3"); } }} className={`min-h-11 border border-gold ${mode === "easy" ? "bg-ink text-paper" : ""}`}>
                    {c.beginner}
                  </button>
                  <button type="button" onClick={() => setMode("pro")} className={`min-h-11 border border-gold ${mode === "pro" ? "bg-ink text-paper" : ""}`}>
                    {c.advanced}
                  </button>
                </div>
                {mode === "easy" ? (
                  <div className="grid grid-cols-3 gap-2">
                    {easy.map((item) => {
                      const name = item.id === "try" ? c.presetTry : item.id === "daily" ? c.presetDaily : c.presetPush;
                      const on = margin === item.margin && lev === item.lev;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => pick(item.margin, item.lev)}
                          className={`min-h-16 border border-gold px-2 text-left ${on ? "bg-ink text-paper" : ""}`}
                        >
                          <span className="block text-sm">{name}</span>
                          <span className="font-mono text-xs">{item.margin} USDT · {item.lev}×</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <>
                    <label className="border border-gold/40 px-3 py-2">
                      <span className="block text-xs tracking-widest text-gold">{c.pay} USDT · {floor}–500</span>
                      <input
                        value={margin}
                        onChange={(event) => setMargin(event.target.value)}
                        inputMode="decimal"
                        className="w-full bg-transparent font-mono text-3xl outline-none"
                      />
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(floor <= 1 ? ["1", "5", "10", "25", "100", "500"] : ["10", "25", "50", "100", "250", "500"]).map((item) => (
                        <button key={item} type="button" onClick={() => setMargin(item)} className={`min-h-11 border border-gold font-mono text-xs ${margin === item ? "bg-ink text-paper" : ""}`}>
                          {item}
                        </button>
                      ))}
                    </div>
                    <label className="border border-gold/40 px-3 py-2">
                      <span className="block text-xs tracking-widest text-gold">{c.levCap}</span>
                      <input
                        value={levText}
                        onChange={(event) => {
                          const next = event.target.value.replace(/[^\d]/g, "").slice(0, 4);
                          setLevText(next);
                          const n = Number(next);
                          setLev(n >= 1 && n <= 1000 ? n : 0);
                        }}
                        inputMode="numeric"
                        className="w-full bg-transparent font-mono text-3xl outline-none"
                      />
                    </label>
                  </>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {(mode === "easy" ? [3, 5, 10, 20] : [10, 20, 30, 50, 100, 200, 500, 1000]).map((item) => (
                    <button key={item} type="button" onClick={() => pick(margin, item)} className={`min-h-11 border border-gold font-mono text-xs ${lev === item ? "bg-ink text-paper" : ""}`}>
                      {item}×
                    </button>
                  ))}
                </div>
                {mode === "pro" ? (
                <label className="border border-gold/40 px-3 py-2">
                  <span className="block text-xs tracking-widest text-gold">{c.limitPrice}</span>
                  <input
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                    inputMode="decimal"
                    className="w-full bg-transparent font-mono text-3xl outline-none"
                  />
                </label>
                ) : null}
                {mode === "pro" ? (
                <button
                  type="button"
                  className="min-h-11 border border-gold"
                  onClick={() => {
                    if (view?.mark) setLimit(formatUnits(view.mark, 18).slice(0, 8));
                  }}
                >
                  {c.useMark}{view?.mark ? ` $${pxText(view.mark)}` : ""}
                </button>
                ) : null}
                {mode === "pro" ? <p className="text-xs leading-relaxed text-ink/60">{lang === "zh" ? "谁都可以挂单。价差和深度没有平台下限。撤单未确认时，单仍在合约里。做市激励和积分尚未开始。" : "Anyone can quote. There is no platform minimum for spread or depth. If a cancel is not confirmed, the order stays in the contract. Maker rewards and points have not started."}</p> : null}
                <p className="text-sm leading-relaxed text-ink/70">{mode === "pro" ? c.priceNote : lang === "zh" ? "新手最高 20 倍。更高倍数在高级里，超过 20 倍要再确认一次。" : "Beginner stops at 20x. Higher multiples are in Advanced, and anything over 20x asks again."}</p>
                <div className="border border-gold/40 p-3">
                  <div className="grid grid-cols-3 gap-2">
                    {(["easy", "pro", "off"] as const).map((item) => (
                      <button key={item} type="button" onClick={() => setGuard(item)} className={`min-h-11 border border-gold text-sm ${guard === item ? "bg-ink text-paper" : ""}`}>
                        {item === "easy" ? c.stopEasy : item === "pro" ? c.stopPro : c.stopClear}
                      </button>
                    ))}
                  </div>
                  {guard === "pro" ? (
                    <>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="border border-gold/40 px-2 py-2">
                          <span className="block text-xs tracking-widest text-gold">{c.stopTp}</span>
                          <input value={tpText} onChange={(event) => setTpText(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-xl outline-none" />
                        </label>
                        <label className="border border-gold/40 px-2 py-2">
                          <span className="block text-xs tracking-widest text-gold">{c.stopSl}</span>
                          <input value={slText} onChange={(event) => setSlText(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-xl outline-none" />
                        </label>
                      </div>
                      <StopReadout
                        lang={lang}
                        entry={Number(limit) || markN}
                        usedMark={!(Number(limit) > 0)}
                        tp={Number(tpText)}
                        sl={Number(slText)}
                        margin={Number(margin)}
                        lev={lev}
                        unit={chain === "xlayer" ? "USDT0" : "USDT"}
                      />
                    </>
                  ) : null}
                  {guard === "easy" && markN > 0 ? (
                    <p className="mt-2 font-mono text-sm tabular-nums">
                      {c.stopTp} ${easyBand(Number(limit) || markN, lev || 1, true).tp.toFixed(2)} · {c.stopSl} ${easyBand(Number(limit) || markN, lev || 1, true).sl.toFixed(2)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs leading-relaxed text-ink/60">{c.stopNote}</p>
                  {arm && !arm.spent ? (
                    <p className="mt-2 font-mono text-sm">
                      {arm.hold ? (lang === "zh" ? "上次没平掉。保护还在，不会自动再弹钱包。" : "The last close did not finish. The stop stays, and the wallet will not pop by itself.") : c.stopArmed} · {c.stopTp} ${arm.tp.toFixed(2)} · {c.stopSl} ${arm.sl.toFixed(2)}
                      {arm.hold ? (
                        <button type="button" className="ml-2 underline" onClick={() => {
                          const next = { ...arm, hold: false, spent: false };
                          writeArm(next);
                          setArm(next);
                        }}>{lang === "zh" ? "再试一次" : "Try again"}</button>
                      ) : null}
                      <button type="button" className="ml-2 underline" onClick={() => { if (account) { clearArm(account, perp); setArm(null); } }}>{c.stopClear}</button>
                    </p>
                  ) : null}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <p className="border border-gold/40 px-2 py-2">
                    <span className="block text-xs tracking-widest text-gold">{c.notional}</span>
                    <span className="font-mono tabular-nums">{ticket ? `$${ticket.notional.toFixed(0)}` : "—"}</span>
                  </p>
                  <p className="border border-gold/40 px-2 py-2">
                    <span className="block text-xs tracking-widest text-gold">{c.sizeEst}</span>
                    <span className="font-mono tabular-nums">{ticket ? `${ticket.size.toFixed(4)}` : "—"}</span>
                  </p>
                  <p className="border border-gold/40 px-2 py-2">
                    <span className="block text-xs tracking-widest text-gold">{c.liqRough}</span>
                    <span className="font-mono tabular-nums">{liqMove ? `${liqMove}%` : "—"}</span>
                  </p>
                </div>
                <p className="font-mono text-xs tabular-nums text-ink/70">
                  {lang === "zh" ? "可用" : "Available"} {bal ? pretty(bal.usdt, dec, 2) : "—"} USDT
                  {" · "}
                  {lang === "zh" ? "本单手续费" : "Fee"} {marginOk ? (Number(margin) * 0.002).toFixed(4) : "—"} USDT
                  {" · "}
                  {ticket ? `${ticket.size.toFixed(4)} BEM` : "—"}
                </p>
                {levOk && lev >= 100 && liqMove ? (
                  <p className="text-sm text-sell">
                    {lang === "zh"
                      ? `${lev} 倍。标记价反向大约 ${liqMove}%，保证金大约亏掉一半，仓可以被强平。`
                      : `${lev}×. A mark move of about ${liqMove}% can take half the margin and liquidate.`}
                  </p>
                ) : null}
                {!levOk || !marginOk ? <p className="text-sm text-sell">{!levOk ? c.levCap : `${floor}–500 USDT`}</p> : null}
                {!priceOk ? <p className="text-sm text-sell">{c.badPrice}</p> : null}
                {bal && marginOk && bal.usdt < need ? (
                  <p className="text-sm text-sell">
                    {chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt} {pretty(bal.usdt, dec, 2)} / {margin} USDT
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className="min-h-12 bg-ink text-paper disabled:opacity-40"
                    disabled={busy || lock.status === "bad" || !levOk || !marginOk || !priceOk || !view?.priced || Boolean(!view?.book && waiting && view?.pendingLong)}
                    onClick={() => {
                      if (lev > 20 && !hot) { setHot(true); return; }
                      setCard("long");
                    }}
                  >
                    {lev > 20 && !hot ? (lang === "zh" ? "超过 20 倍，再点一次" : "Over 20x. Tap again") : waiting && view && !view.pendingLong ? c.pullQuote : `${c.postLong} · ${margin || "1"} USDT`}
                  </button>
                  <button
                    type="button"
                    className="min-h-12 border border-sell bg-sell text-[#f7f5f0] disabled:opacity-40"
                    disabled={busy || lock.status === "bad" || !levOk || !marginOk || !priceOk || !view?.priced || Boolean(!view?.book && waiting && !view?.pendingLong)}
                    onClick={() => {
                      if (lev > 20 && !hot) { setHot(true); return; }
                      setCard("short");
                    }}
                  >
                    {lev > 20 && !hot ? (lang === "zh" ? "超过 20 倍，再点一次" : "Over 20x. Tap again") : waiting && view?.pendingLong ? c.pullQuote : `${c.postShort} · ${margin || "1"} USDT`}
                  </button>
                </div>
                {card ? (
                  <SignCard
                    title={lang === "zh" ? "签名前看一眼" : "Before you sign"}
                    yes={lang === "zh" ? "确认并签名" : "Confirm and sign"}
                    no={lang === "zh" ? "取消" : "Cancel"}
                    warn={
                      board.length === 0
                        ? lang === "zh"
                          ? "簿上没有别人的单。签下去只是把保证金挂进合约，不会马上成交。想先看盈亏，去模拟。"
                          : "Nobody else is on the book. Signing only posts margin into the contract. It does not fill. Use the paper book if you want to see PnL first."
                        : lang === "zh"
                          ? "两链不能合成一笔。钱包不在这条链时，签名前会切过去。"
                          : "The two chains do not net. If the wallet is on the other chain, it switches before the signature."
                    }
                    onNo={() => setCard(null)}
                    onYes={() => {
                      const long = card === "long";
                      setCard(null);
                      void run(async (from) => {
                        const before = view?.myDeal && view.myDeal > 0n ? view.myDeal.toString() : "0";
                        const tx = await openPerp(from, perp, long, margin, lev, limit.trim() || (markN > 0 ? markN.toFixed(4) : ""));
                        if (guard !== "off") {
                          const entry = Number(limit) || markN;
                          const band = guard === "easy" ? easyBand(entry, lev || 1, long) : { tp: Number(tpText), sl: Number(slText) };
                          if (entry > 0 && band.tp > 0 && band.sl > 0) {
                            const next = { account: from, perp, long, tp: band.tp, sl: band.sl, spent: false, hold: false, before, deal: "" };
                            writeArm(next);
                            setArm(next);
                          }
                        }
                        return tx;
                      });
                    }}
                    lines={[
                      { k: lang === "zh" ? "链" : "Chain", v: chain === "xlayer" ? "X Layer · 196" : "BNB Smart Chain · 56" },
                      { k: lang === "zh" ? "合约" : "Contract", v: perp, href: `${scan}/address/${perp}` },
                      {
                        k: lang === "zh" ? "钱去哪" : "Where funds go",
                        v:
                          chain === "xlayer"
                            ? lang === "zh"
                              ? "保证金是 USDT0，锁进这份 X Layer 合约。千分之二进收费地址。"
                              : "Margin is USDT0, locked in this X Layer contract. 0.2% goes to the fee address."
                            : lang === "zh"
                              ? "保证金是 BSC 的 USDT，锁进这份合约。千分之二进收费地址。"
                              : "Margin is BSC USDT, locked in this contract. 0.2% goes to the fee address.",
                      },
                      { k: lang === "zh" ? "保证金" : "Margin", v: `${margin || "—"} ${chain === "xlayer" ? "USDT0" : "USDT"} · ${lev || "—"}×` },
                      { k: lang === "zh" ? "本单手续费" : "Fee", v: `${marginOk ? (Number(margin) * 0.002).toFixed(4) : "—"} ${chain === "xlayer" ? "USDT0" : "USDT"}` },
                      {
                        k: lang === "zh" ? "标记价" : "Mark",
                        v:
                          chain === "xlayer"
                            ? lang === "zh"
                              ? "由 BSC 池子推进，每 30 秒最多挪一点。没有资金费。没有保险基金，没有自动减仓。"
                              : "Pushed from the BSC pool, a small step every 30 seconds. No funding. No insurance fund. No auto-deleveraging."
                            : lang === "zh"
                              ? "Pancake 池大约 10 分钟均价。没有资金费。没有保险基金，没有自动减仓。"
                              : "About a 10-minute Pancake average. No funding. No insurance fund. No auto-deleveraging.",
                      },
                      {
                        k: lang === "zh" ? "强平" : "Liquidation",
                        v: liqMove
                          ? lang === "zh"
                            ? `反向大约 ${liqMove}%，保证金亏一半就可以被强平`
                            : `About ${liqMove}% the wrong way and half the margin can be liquidated`
                          : "—",
                      },
                    ]}
                  />
                ) : null}
              </>
            ) : null}
            {mine ? (
              <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => run((from) => cancelPerp(from, perp), "cancel")}>
                {c.cancelPost}
              </button>
            ) : null}
            {inDeal ? (
              <button type="button" className="min-h-12 bg-ink text-paper" disabled={busy} onClick={() => run((from) => closePerp(from, perp, view && view.myDeal > 0n ? view.myDeal : undefined))}>
                {c.closeDeal}
              </button>
            ) : null}
            {view?.underwater && account ? (
              <button
                type="button"
                className="min-h-12 border border-sell text-sell"
                disabled={busy}
                onClick={() => run((from) => liquidatePerp(from, perp, account))}
              >
                {c.liqNow}
              </button>
            ) : null}
          </div>
        )}
        </div>
        </div>
        {account ? (
          <p className="font-mono text-xs xl:col-span-12">
            {short(account)} · {chain === "xlayer" ? "X Layer" : "BSC"}
            {bal
              ? ` · ${chain === "xlayer" ? "USDT0" : "USDT"} ${pretty(bal.usdt, dec, 2)} · ${chain === "xlayer" ? "OKB" : "BNB"} ${pretty(bal.bnb, 18, 4)}`
              : ""}
          </p>
        ) : null}
        {perp && bal && view && bal.usdt < view.min ? (
          <p className="text-sm text-sell xl:col-span-12">{chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt}</p>
        ) : null}
        {note ? <p className={`text-sm xl:col-span-12 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        {hash ? (
          <a className="text-sm underline decoration-gold underline-offset-4 xl:col-span-12" href={`${scan}/tx/${hash}`} target="_blank" rel="noreferrer">
            {c.walletTx}
          </a>
        ) : null}
      </div>
    </section>
  );
}

function signed(n: number): string {
  const abs = Math.abs(n);
  const text = abs >= 1 ? abs.toFixed(2) : abs.toFixed(4);
  if (n > 0) return `+${text}`;
  if (n < 0) return `−${text}`;
  return "0";
}

function StopReadout({
  lang,
  entry,
  usedMark,
  tp,
  sl,
  margin,
  lev,
  unit,
}: {
  lang: "zh" | "en";
  entry: number;
  usedMark: boolean;
  tp: number;
  sl: number;
  margin: number;
  lev: number;
  unit: string;
}) {
  if (!(entry > 0) || !(margin > 0) || !(lev > 0)) return null;
  const zh = lang === "zh";
  const px = entry >= 100 ? entry.toFixed(2) : entry.toFixed(4);
  const row = (label: string, exit: number) => {
    if (!(exit > 0)) return null;
    const long = (margin * lev * (exit - entry)) / entry;
    const short = -long;
    return (
      <p key={label} className="font-mono text-xs tabular-nums">
        {label} {exit >= 100 ? exit.toFixed(2) : exit.toFixed(4)}
        {" · "}
        {zh ? "开多" : "Long"} <span className={long >= 0 ? "text-gold" : "text-sell"}>{signed(long)} {unit}</span>
        {" · "}
        {zh ? "开空" : "Short"} <span className={short >= 0 ? "text-gold" : "text-sell"}>{signed(short)} {unit}</span>
      </p>
    );
  };
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="text-xs text-ink/60">{usedMark ? (zh ? `按标记价 ${px}` : `At the mark ${px}`) : zh ? `按开单价 ${px}` : `At your price ${px}`}</p>
      {row(zh ? "止盈" : "Take profit", tp)}
      {row(zh ? "止损" : "Stop", sl)}
    </div>
  );
}
