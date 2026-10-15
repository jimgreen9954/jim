import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { copy } from "@/lib/copy";
import { BSC, FEE_TO, connectBsc, poolMark, pretty, tokenCap, units, type Balances } from "@/lib/bsc";
import { getCandles, getCoinCandles, getXCandles, type Candle, type CandleFrame } from "@/lib/candles";
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
  pokeXBem,
  pxText,
  readChainPurse,
  readPerp,
  readBoard,
  rememberXBem,
  savedDesk,
  savedXBemPerp,
  selectDesk,
  activeBook,
  takePerp,
  usdtText,
  type BookQuote,
  type Desk,
  type PerpView,
} from "@/lib/perp";
import { connectXLayer, XLAYER } from "@/lib/xlayer";
import { TAPE_BEM } from "@/lib/tape-pool";
import { xCap } from "@/lib/okb";
import { SideRail } from "@/components/exchange/side-rail";
import { SymbolMenu } from "@/components/exchange/symbol-menu";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function named(addr: string): string {
  const nick = nickOf(addr, readNicks());
  return nick ? `${nick} · ${short(addr)}` : short(addr);
}

const zero = "0x0000000000000000000000000000000000000000";

function coinBook(px: number): PerpView {
  const mark = parseUnits(px.toFixed(8), 18);
  return {
    book: true,
    priced: true,
    mark,
    min: 10n ** 18n,
    quotes: [],
    liveDeals: [],
    pendingUser: zero,
    pendingLong: false,
    pendingMargin: 0n,
    pendingLev: 0,
    kind: 0,
    long: true,
    margin: 0n,
    base: 0n,
    entry: 0n,
    equity: 0n,
    underwater: false,
    other: zero,
    dealOpen: false,
    longAddr: zero,
    shortAddr: zero,
    marginL: 0n,
    marginS: 0n,
    dealBase: 0n,
    dealEntry: 0n,
    myDeal: 0n,
  };
}

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
  unit,
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
  unit: string;
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
            {row.margin.toFixed(2)} USDT · {row.quote.lev}× · {row.size.toFixed(2)} {unit}
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
  const [coin, setCoin] = useState<"bem" | "btc" | "eth" | "zec">("bem");
  const [perp, setPerp] = useState(() => bookOf(savedDesk()));
  const [xbem, setXbem] = useState("");
  const [pasted, setPasted] = useState("");
  const [deployNote, setDeployNote] = useState<string | null>(null);
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
  const [coinPx, setCoinPx] = useState(0);
  const [supply, setSupply] = useState<number | null>(null);
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
    const saved = savedXBemPerp();
    if (!saved) return;
    setXbem(saved);
    if (savedDesk() === "xlayer") setPerp(saved);
  }, []);

  useEffect(() => {
    let dead = false;
    const job = chain === "xlayer" ? xCap(TAPE_BEM) : tokenCap(BSC.bem);
    job.then((n) => { if (!dead) setSupply(n || null); }).catch(() => { if (!dead) setSupply(null); });
    return () => { dead = true; };
  }, [chain]);

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
    const px = chain === "xlayer"
      ? (view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0)
      : (live && live > 0 ? live : view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0);
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
    if (!(chain === "bsc" && coin !== "bem")) return;
    let dead = false;
    setView(null);
    setBoard([]);
    setPrices([]);
    const load = () => {
      getCoinCandles({ data: { coin, frame } })
        .then((next) => { if (!dead && next.length) setPrices(next); })
        .catch(() => undefined);
      poolMark(coin)
        .then((text) => {
          const n = Number(String(text).replace(/,/g, ""));
          if (dead || !(n > 0)) return;
          setCoinPx(n);
          setView(coinBook(n));
        })
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 12000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [chain, coin, frame]);

  useEffect(() => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) return;
    if (chain === "bsc" && coin !== "bem") return;
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
      const candles = chain === "xlayer" ? getXCandles({ data: frame }) : getCandles({ data: frame });
      candles
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
  }, [perp, account, hash, frame, chain, coin]);

  useEffect(() => {
    if (chain !== "xlayer" || !account) return;
    const id = window.setInterval(() => {
      pokeXBem(account).catch(() => undefined);
    }, 35000);
    return () => window.clearInterval(id);
  }, [chain, account, xbem]);

  const fail = (err: unknown) => {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (message === "nowallet") setNote(c.walletNo);
    else if (message === "usdt") setNote(chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt);
    else if (message === "nochain") setNote(c.perpNoChain);
    else if (message === "oracle") setNote(lang === "zh" ? "只有收费地址能写标记价。" : "Only the fee address can post the mark.");
    else if (chain === "xlayer" && /revert|execution|Bad/i.test(message)) setNote(lang === "zh" ? "没开成。结算价已经作废。用收费地址部署修好的一份，并写入一次。" : "It did not open. The settlement price has expired. The fee address deploys the fixed book and posts once.");
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
  const alt = chain === "bsc" && coin !== "bem";
  const base = chain === "xlayer" || coin === "bem" ? "BEM" : coin.toUpperCase();
  const markN = alt
    ? coinPx
    : chain === "xlayer"
    ? (view && view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0)
    : (live && live > 0 ? live : view && view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0);
  const priceOk = alt ? markN > 0 || Boolean(limit.trim()) : ticketPx >= 10n ** 16n && ticketPx <= 100_000n * 10n ** 18n;
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
  const entryN = view && view.dealEntry > 0n ? Number(formatUnits(view.dealEntry, 18)) : 0;
  const pick = (nextMargin: string, nextLev: number) => {
    setMargin(nextMargin);
    setLev(nextLev);
    setLevText(String(nextLev));
  };

  return (
    <SideRail items={[
      { key: "bsc", label: "BSC · USDT", on: chain === "bsc", run: () => { selectDesk("bsc"); setChain("bsc"); setPerp(bookOf("bsc")); connectBsc().catch(() => undefined); } },
      { key: "xlayer", label: "X Layer · USDT", on: chain === "xlayer", run: () => { selectDesk("xlayer"); setChain("xlayer"); setPerp(bookOf("xlayer")); connectXLayer().catch(() => undefined); } },
    ]}>
    {chain === "bsc" ? (
      <div className="mb-3">
        <SymbolMenu
          zh={lang === "zh"}
          label={`${base} / USDT`}
          note="BSC"
          items={(["bem", "btc", "eth", "zec"] as const).map((id) => ({
            id,
            title: `${id.toUpperCase()} / USDT`,
            note: lang === "zh" ? "BSC · 永续" : "BSC · Perp",
            on: coin === id,
            run: () => setCoin(id),
          }))}
        />
      </div>
    ) : null}
    <section className="border border-gold bg-card shadow-plate">
      <div className="flex flex-col gap-3 p-3">
        {chain === "xlayer" && !/^0x[a-fA-F0-9]{40}$/.test(KNOWN_XPERP) ? (
          <p className="text-sm leading-relaxed xl:col-span-12">{c.xOpen}</p>
        ) : null}
        {chain === "xlayer" && !/^0x[a-fA-F0-9]{40}$/.test(KNOWN_XPERP) && !xbem ? (
          <div className="grid gap-2">
            <button
              type="button"
              className="min-h-12 bg-ink px-3 text-sm text-paper disabled:opacity-40"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setBad(false);
                const steps = [c.deployX1, c.deployX2, c.deployX3];
                setDeployNote(lang === "zh" ? "正在连接 X Layer 钱包。请在钱包中确认，确认窗不在本页。" : "Connecting the X Layer wallet. Confirm the request in the wallet. It does not appear on this page.");
                setNote(steps[0]);
                void (async () => {
                  try {
                    selectDesk("xlayer");
                    const from = account ?? (await connectXLayer());
                    setAccount(from);
                    if (from.toLowerCase() !== FEE_TO.toLowerCase()) {
                      setBad(true);
                      setDeployNote(lang === "zh" ? `当前钱包为 ${from.slice(0, 6)}…${from.slice(-4)}。部署须使用收费地址 ${FEE_TO.slice(0, 6)}…${FEE_TO.slice(-4)}。` : `Connected ${from.slice(0, 6)}…${from.slice(-4)}. Deployment requires the fee address.`);
                      return;
                    }
                    const addr = await deployXLayer(from, (step) => {
                      setNote(steps[step - 1]);
                      setDeployNote(steps[step - 1]);
                    });
                    setPerp(addr);
                    setXbem(addr);
                    setDeployNote(addr);
                    setNote(addr);
                  } catch (err) {
                    fail(err);
                    const message = err instanceof Error ? err.message : "";
                    setDeployNote(message === "oracle"
                      ? (lang === "zh" ? "只有收费地址可以部署本合约。" : "Only the fee address can deploy this contract.")
                      : (lang === "zh" ? `部署未完成。${message.slice(0, 80) || "若钱包未弹出，请切换至 X Layer 后重试。"}` : `Deployment did not finish. ${message.slice(0, 80)}`));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? (lang === "zh" ? "等待钱包确认" : "Waiting for the wallet") : (lang === "zh" ? "部署读 X Layer 池子的新永续" : "Deploy the book that reads the X Layer pools")}
            </button>
            {deployNote ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{deployNote}</p> : <p className="text-sm leading-6 text-ink/70">{lang === "zh" ? "若已经部署过，把永续地址贴在下面。本机记得之后，部署按钮会收起。" : "If it is already deployed, paste the perpetual address. Once this device remembers it, the deploy button goes away."}</p>}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="0x" className="min-h-12 border border-gold bg-transparent px-2 font-mono text-sm" />
              <button
                type="button"
                className="min-h-12 border border-gold px-4 text-sm disabled:opacity-40"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setBad(false);
                  setDeployNote(lang === "zh" ? "正在核对链上合约。" : "Checking the contract.");
                  rememberXBem(pasted)
                    .then((addr) => {
                      setXbem(addr);
                      setPerp(addr);
                      setChain("xlayer");
                      selectDesk("xlayer");
                      setBad(false);
                      setDeployNote(addr);
                    })
                    .catch(() => {
                      setBad(true);
                      setDeployNote(lang === "zh" ? "这个地址不是可用的永续合约。" : "That address is not a usable perpetual.");
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {lang === "zh" ? "使用已部署的地址" : "Use the deployed address"}
              </button>
            </div>
          </div>
        ) : null}
        <details className="text-sm text-ink/70">
          <summary className="min-h-9 cursor-pointer">{lang === "zh" ? "风险" : "Risk"}</summary>
          <p className="mt-1 leading-6">{chain === "xlayer" ? c.perpWarnX : c.perpWarn}</p>
        </details>
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center bg-ink px-3 text-paper xl:col-span-12">
            {c.signOkx}
          </a>
        ) : null}
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
        <div className="order-1 min-w-0 border border-gold bg-card lg:order-1">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/30 px-3 py-3">
            <div>
              <p className="font-display text-2xl italic">{chain === "xlayer" ? "BEM / USDT0 · X Layer" : `${base} / USDT · BSC`}</p>
              <p className="mt-1 font-mono text-xs text-ink/70">{chain === "xlayer" ? (lang === "zh" ? "币 BEM · 链 X Layer · 保证金 USDT0 · 永续" : "Coin BEM · chain X Layer · margin USDT0 · perp") : (lang === "zh" ? `币 ${base} · 链 BSC · 保证金 USDT · 永续` : `Coin ${base} · chain BSC · margin USDT · perp`)}</p>
              <p className="mt-1 text-xs leading-5 text-ink/55">
                {chain === "xlayer"
                  ? (lang === "zh" ? "标记是约 10 分钟均价。K 线是池子成交，不跟 BSC 同步。" : "The mark is about a 10-minute average. Candles are pool prints and do not follow BSC.")
                  : alt
                    ? (lang === "zh" ? "和 BEM 同一套 K 线，周期从 15 秒到一年。标记读这口 Pancake 池大约 10 分钟均价，不是最后一笔。" : "The same chart as BEM, from 15 seconds to a year. The mark is about a 10-minute average of this Pancake pool, not the last print.")
                    : (lang === "zh" ? "标记和现货是同一口 Pancake 池的现价，不是另一套价。" : "The mark is the same Pancake pool price as spot, not a second price.")}
                {!alt && /^0x[a-fA-F0-9]{40}$/.test(perp) ? (
                  <>
                    {" "}
                    <a className="underline decoration-gold underline-offset-4" href={`${scan}/address/${perp}`} target="_blank" rel="noreferrer">{lang === "zh" ? "合约" : "Contract"}</a>
                  </>
                ) : null}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs tracking-widest text-gold">{c.mark}</p>
              <p className="font-mono text-2xl tabular-nums">{markN > 0 ? markN.toFixed(4) : "—"}</p>
              {prices.at(-1)?.c ? <p className="font-mono text-xs text-ink/50">{lang === "zh" ? "K 线最后一笔" : "Last candle"} {prices.at(-1)!.c.toFixed(4)}</p> : null}
            </div>
          </div>
          <div className="flex flex-col gap-2 px-3 pt-2">
            <div className="flex w-full overflow-x-auto border border-gold">
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
            supply={supply}
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
            unit={base}
            onTake={(book, quote) => {
              void run((from) => takePerp(from, book, quote.id, formatUnits(quote.margin, dec), quote.lev, quote.price > 0n));
            }}
            onCancel={(book, quote) => run((from) => cancelPerp(from, book, quote.id), "cancel")}
          />
          {!view ? <p className="px-3 py-2 text-sm text-ink/60">{lang === "zh" ? "正在读合约，读完才能开仓。" : "Reading the contract. Open waits until that finishes."}</p> : null}
          {lock.status === "bad" ? <p className="px-3 pb-2 text-sm text-sell">{lang === "zh" ? "收费地址对不上，开仓停了。" : "The fee address does not match. Opening is stopped."}</p> : null}
        </div>
        <div className="order-2 flex min-w-0 flex-col gap-3 lg:sticky lg:top-3 lg:order-2 lg:max-h-[calc(100dvh-1.5rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-6 lg:pr-1">
        {view?.liveDeals.length ? (
        <div className="border border-gold/40 p-3">
          <p className="text-xs tracking-widest text-gold">{c.pkTitle}</p>
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
        </div>
        ) : null}
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
                <details className="text-sm text-ink/70">
                  <summary className="min-h-9 cursor-pointer">{lang === "zh" ? "开仓前" : "Before you open"}</summary>
                  <ul className="mt-1 flex flex-col gap-1 leading-6">
                    <li>{lang === "zh" ? "保证金锁进本链这一份合约，平台不经手。" : "Margin stays in this chain's contract. The desk does not hold it."}</li>
                    <li>{lang === "zh" ? "亏到保证金大约一半即可强平。没有保险基金，也没有自动减仓。" : "About half the margin lost can liquidate. There is no insurance fund and no auto-deleveraging."}</li>
                    <li>{chain === "xlayer" ? (lang === "zh" ? "标记读取 X Layer 的 OKB/BEM 与 USDT0/WOKB，约 10 分钟均价，不用最后一笔。" : "The mark reads the X Layer OKB/BEM and USDT0/WOKB pools, about a 10-minute average, not the last trade.") : (lang === "zh" ? "标记价是池子约 10 分钟均价，不用最后一笔。" : "The mark is about a 10-minute pool average, not the last trade.")}</li>
                    <li>{lang === "zh" ? "BSC 的 USDT 和 X Layer 的 USDT0 不能合成一笔。" : "BSC USDT and X Layer USDT0 do not net."}</li>
                  </ul>
                </details>
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
                {mode === "easy" ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setLimit("")} className={`min-h-11 border border-gold text-sm ${limit.trim() ? "" : "bg-ink text-paper"}`}>
                        {lang === "zh" ? "标记价" : "Mark"} {markN > 0 ? markN.toFixed(4) : ""}
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (!limit.trim() && markN > 0) setLimit(markN.toFixed(4)); }}
                        className={`min-h-11 border border-gold text-sm ${limit.trim() ? "bg-ink text-paper" : ""}`}
                      >
                        {lang === "zh" ? "自己定价" : "My price"}
                      </button>
                    </div>
                    {limit.trim() ? (
                      <label className="border border-gold/40 px-3 py-2">
                        <span className="block text-xs tracking-widest text-gold">{c.limitPrice}</span>
                        <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-3xl outline-none" />
                      </label>
                    ) : <p className="text-xs leading-5 text-ink/60">{lang === "zh" ? "按标记价成交。标记为约 10 分钟均价，不是最后一根 K 线。" : "Fills at the mark. The mark is about a 10-minute average, not the last candle."}</p>}
                  </>
                ) : null}
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
                {mode === "pro" ? <p className="text-xs leading-relaxed text-ink/60">{lang === "zh" ? "挂单无价差与深度下限。撤单未确认前，订单仍在合约中。做市激励尚未开始。" : "No minimum spread or depth. An unconfirmed cancel remains on the contract. Maker rewards have not started."}</p> : null}
                <p className="text-sm leading-relaxed text-ink/70">{mode === "pro" ? c.priceNote : lang === "zh" ? "新手档杠杆不超过 20 倍。20 倍以上在高级，并需再次确认。" : "Simple mode caps leverage at 20×. Higher leverage is in Advanced and asks for a second confirmation."}</p>
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
                  {ticket ? `${ticket.size.toFixed(4)} ${base}` : "—"}
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
                      alt
                        ? lang === "zh"
                          ? "本交易对与 BEM 使用同一张下单卡。结算合约未接入，确认不会签名，也不会扣除 USDT。"
                          : "This ticket matches BEM. Settlement is not attached, so confirm does not sign and does not take USDT."
                        : board.length === 0
                        ? lang === "zh"
                          ? "订单簿暂无对手方。签名仅将保证金挂入合约，不会立即成交。"
                          : "The book has no counterparty. Signing only posts margin. It does not fill."
                        : lang === "zh"
                          ? "BSC 与 X Layer 不能合并仓位。钱包不在当前链时，签名前会切换。"
                          : "BSC and X Layer do not net. The wallet switches to this chain before the signature."
                    }
                    onNo={() => setCard(null)}
                    onYes={() => {
                      const long = card === "long";
                      setCard(null);
                      if (alt) {
                        setBad(false);
                        setNote(lang === "zh" ? `${base} 和 BEM 是同一张合约单。结算本还没接上，没有签名，USDT 没动。` : `${base} uses the same ticket as BEM. The settlement book is not attached, so nothing was signed and no USDT moved.`);
                        return;
                      }
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
                      { k: lang === "zh" ? "合约" : "Contract", v: alt ? (lang === "zh" ? "与 BEM 同一类永续，结算本未接入" : "Same perpetual as BEM. Settlement book not attached.") : perp, href: alt ? undefined : `${scan}/address/${perp}` },
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
                              ? "标记读取 X Layer 的 OKB/BEM 与 USDT0/WOKB。连续更新单次不超过 0.5%，间隔不少于 30 秒。不引用 BSC 价格。没有资金费。没有保险基金。没有自动减仓。"
                              : "The mark reads the X Layer OKB/BEM and USDT0/WOKB pools. A consecutive update is at most 0.5% and at least 30 seconds apart. It does not reference BSC. No funding. No insurance fund. No auto-deleveraging."
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
    </SideRail>
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
