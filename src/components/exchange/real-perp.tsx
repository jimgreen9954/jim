// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { formatUnits, parseUnits } from "viem";
import { copy } from "@/lib/copy";
import {
  BSC,
  FEE_TO,
  bemPrice,
  connectBsc,
  ercPrice,
  pretty,
  quoteUpUsd,
  readBalances,
  tokenCap,
  units,
  type Balances,
} from "@/lib/bsc";
import {
  getCandles,
  getCoinCandles,
  getTapeCandles,
  getXCandles,
  type Candle,
  type CandleFrame,
} from "@/lib/candles";
import { previewFrame, readCandleBook, writeCandleBook } from "@/lib/bem-ohlcv";
import { currentAccount, onAccount, onOpenLink } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";
import { SignCard } from "@/components/exchange/sign-card";
import { useFeeLock } from "@/lib/fee-lock";
import { Kline } from "@/components/exchange/kline";
import {
  AccountDialog,
  FundingBoard,
  LevDialog,
  MarginDialog,
  PairChevron,
} from "@/components/exchange/desk-chrome";
import { PhoneChrome, wantedPane } from "@/components/exchange/phone-desk";
import { CoinMark } from "@/components/exchange/coin-mark";
import { announceFill, readPrefs, useDeskPrefs } from "@/lib/desk-prefs";
import { markDeskFill } from "@/lib/red-packet";
import { TradeLog } from "@/components/exchange/trade-foot";
import { nickOf, readNicks } from "@/lib/nicks";
import { clearArm, easyBand, readArm, writeArm, type Arm } from "@/lib/stops";
import {
  cancelPerp,
  closePerp,
  deployXLayer,
  bookOf,
  pickBook,
  deployCoin,
  pokeBook,
  liquidatePerp,
  openPerp,
  openPostPerp,
  openScalePerp,
  openStopPerp,
  openTwapPerp,
  xPoolPrice,
  armTrailPerp,
  readStops,
  readTwaps,
  fireStopPerp,
  cancelStopPerp,
  pokeTwapPerp,
  cancelTwapPerp,
  pxText,
  readChainPurse,
  readPerp,
  readBoard,
  rememberXBem,
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
import { TAPE_BEM } from "@/lib/tape-pool";
import { readOpenBook } from "@/lib/tape-open-candles";
import { peekSpotPrints } from "@/lib/tape-spot";
import { modeLine, planMargin, readModes, saveModes } from "@/lib/margin-mode";
import { readXBem, xCap } from "@/lib/okb";
import { SideRail } from "@/components/exchange/side-rail";
import { fundingPreview, pct } from "@/lib/risk-rules";
import { fabUsd } from "@/lib/fab";

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

function withinSlip(px, refs, bps) {
  if (!(bps > 0) || !(px > 0)) return true;
  return refs.some((ref) => ref > 0 && Math.abs(px - ref) / ref <= bps / 10000);
}

function DeskLadder({
  rows,
  mark,
  bookMark,
  account,
  busy,
  dec,
  scan,
  named,
  lang,
  unit,
  onTake,
  onCancel,
  onPrice,
  onSize,
}: {
  rows: { perp: string; quote: BookQuote }[];
  mark: number;
  bookMark: number;
  account: string | null;
  busy: boolean;
  dec: number;
  scan: string;
  named: (addr: string) => string;
  lang: "zh" | "en";
  unit: string;
  onTake: (book: string, quote: BookQuote) => void;
  onCancel: (book: string, quote: BookQuote) => void;
  onPrice: (px: number) => void;
  onSize: (margin: number) => void;
}) {
  const drawn = rows.map(({ perp, quote }) => {
    const limit = quote.price > 0n ? Number(formatUnits(quote.price, 18)) : 0;
    const px = limit > 0 ? limit : mark;
    const margin = Number(formatUnits(quote.margin, dec));
    const size = px > 0 ? (margin * quote.lev) / px : 0;
    return { perp, quote, px, limit, margin, size };
  });
  const anchors = [mark, bookMark].filter((n) => n > 0);
  const away = (row: (typeof drawn)[number]) =>
    !(account && row.quote.user?.toLowerCase() === account.toLowerCase()) &&
    anchors.length > 0 &&
    row.px > 0 &&
    anchors.every((ref) => Math.abs(row.px - ref) / ref > 0.15);
  const asks = drawn.filter((row) => !row.quote.long).sort((a, b) => b.px - a.px);
  const bids = drawn.filter((row) => row.quote.long).sort((a, b) => b.px - a.px);
  const nearAsks = asks.filter((row) => !away(row));
  const nearBids = bids.filter((row) => !away(row));
  const farCount = asks.length - nearAsks.length + (bids.length - nearBids.length);
  const [showFar, setShowFar] = useState(false);
  const [tick, setTick] = useState(0);
  const group = (list: typeof drawn) => {
    if (!tick) return list;
    const buckets = new Map<number, (typeof drawn)[number]>();
    for (const row of list) {
      const key = Math.round(row.px / tick) * tick;
      const prev = buckets.get(key);
      if (!prev) buckets.set(key, { ...row, px: key });
      else prev.margin += row.margin;
    }
    return [...buckets.values()];
  };
  const bookAsks = nearAsks.length + nearBids.length > 0 && !showFar ? nearAsks : asks;
  const bookBids = nearAsks.length + nearBids.length > 0 && !showFar ? nearBids : bids;
  const askRows = group(bookAsks);
  const bidRows = group(bookBids);
  const bestAsk = (nearAsks.length ? nearAsks : asks).at(-1)?.px ?? 0;
  const bestBid = (nearBids.length ? nearBids : bids).at(0)?.px ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const zh = lang === "zh";
  const midPx = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : mark > 0 ? mark : bookMark;
  const stepOf = (px: number) => {
    if (!(px > 0)) return 0.01;
    if (px >= 1000) return 1;
    if (px >= 100) return 0.1;
    if (px >= 10) return 0.01;
    if (px >= 1) return 0.001;
    return px * 0.001;
  };
  const fillSide = (rows: typeof askRows, side: "ask" | "bid") => {
    const kept = side === "ask" ? rows.slice(-8) : rows.slice(0, 8);
    const need = 8 - kept.length;
    if (need <= 0 || !(midPx > 0)) return kept;
    const step = stepOf(midPx);
    const seen = new Set(kept.map((row) => row.px.toFixed(6)));
    const extra = [];
    const edge = side === "ask" ? (kept[0]?.px ?? midPx) : (kept.at(-1)?.px ?? midPx);
    for (let i = 1; extra.length < need && i < 80; i++) {
      const px = side === "ask" ? edge + step * i : edge - step * i;
      if (!(px > 0)) break;
      const key = px.toFixed(6);
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push({
        perp: "ghost",
        quote: { id: `${side}-${i}`, user: "", long: side === "bid", margin: 0n, lev: 0, price: 0n },
        px,
        limit: px,
        margin: 0,
        size: 0,
        ghost: true,
      });
    }
    if (side === "ask") return [...extra.sort((a, b) => b.px - a.px), ...kept].slice(-8);
    return [...kept, ...extra].slice(0, 8);
  };
  const showAsks = fillSide(askRows, "ask");
  const showBids = fillSide(bidRows, "bid");
  const isMine = (row: (typeof drawn)[number]) =>
    Boolean(account && row.quote?.user && row.quote.user.toLowerCase() === account.toLowerCase());
  const withMine = (shown: typeof showAsks, source: typeof asks) => {
    const extra = source.filter(
      (row) => isMine(row) && !shown.some((have) => String(have.quote.id) === String(row.quote.id)),
    );
    if (!extra.length) return shown;
    return [...shown, ...extra].sort((a, b) => b.px - a.px);
  };
  const liveAsks = withMine(showAsks, asks);
  const liveBids = withMine(showBids, bids);
  const depthOf = Math.max(...[...liveAsks, ...liveBids].map((row) => row.margin), 1);
  const cumOf = (rows: typeof askRows, fromBest: boolean) => {
    const totals = new Map<string, number>();
    let sum = 0;
    const seq = fromBest ? [...rows].reverse() : rows;
    for (const row of seq) {
      sum += row.margin;
      totals.set(`${row.perp}-${row.quote.id}`, sum);
    }
    return totals;
  };
  const askCum = cumOf(liveAsks, true);
  const bidCum = cumOf(liveBids, false);
  const line = (row: (typeof drawn)[number], takeLong: boolean) => {
    const pxText = row.px > 0 ? (row.px >= 100 ? row.px.toFixed(2) : row.px.toFixed(4)) : "—";
    if (row.ghost) {
      return (
        <button
          key={`g-${takeLong ? "a" : "b"}-${row.px}`}
          type="button"
          onClick={() => row.px > 0 && onPrice(row.px)}
          className="book-row grid w-full grid-cols-3 px-2 text-left font-mono text-[12px] hover:bg-black/5"
        >
          <span className={takeLong ? "text-sell/75" : "text-up/75"}>{pxText}</span>
          <span className="text-right text-ink/20">—</span>
          <span className="book-total text-right text-ink/15">—</span>
        </button>
      );
    }
    const mine = Boolean(account && row.quote.user?.toLowerCase() === account.toLowerCase());
    const depth = Math.max(6, Math.min(100, (row.margin / depthOf) * 100));
    const cum = (takeLong ? askCum : bidCum).get(`${row.perp}-${row.quote.id}`) ?? row.margin;
    return (
      <button
        key={`${row.perp}-${row.quote.id}`}
        type="button"
        onClick={() => {
          if (row.px > 0) onPrice(row.px);
          if (!mine && row.size > 0) onSize(row.margin);
        }}
        className={`book-row relative grid w-full grid-cols-3 overflow-hidden px-2 text-left font-mono text-[12px] hover:bg-black/5 ${mine ? "bg-[#17875a]/10" : ""}`}
      >
        <span
          className="pointer-events-none absolute inset-y-0 right-0"
          style={{
            width: `${depth}%`,
            background: takeLong ? "rgba(242,54,69,0.16)" : "rgba(8,153,129,0.16)",
          }}
        />
        <span className={`relative min-w-0 truncate ${takeLong ? "text-sell" : "text-up"}`}>
          {pxText}
          {mine ? <span className="ml-1 text-[10px] text-ink/55">{zh ? "我" : "Me"}</span> : null}
        </span>
        <span className="relative text-right text-ink/80">
          {row.size > 0 ? row.size.toFixed(4) : row.margin.toFixed(2)}
        </span>
        <span className="book-total relative text-right text-ink/45">{cum.toFixed(2)}</span>
      </button>
    );
  };
  const spreadPct = spread > 0 && midPx > 0 ? (spread / midPx) * 100 : 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-2 pt-1">
        <div className="grid flex-1 grid-cols-3 text-[10px] text-ink/40">
          <span>{zh ? "价格" : "Price"}</span>
          <span className="text-right">{unit}</span>
          <span className="book-total text-right">{zh ? "合计" : "Total"}</span>
        </div>
        <select
          aria-label={zh ? "价格档" : "Tick"}
          value={String(tick)}
          onChange={(event) => setTick(Number(event.target.value))}
          className="h-6 border border-gold/30 bg-transparent px-1 font-mono text-[10px] text-ink/55 outline-none"
        >
          <option value="0">{zh ? "逐笔" : "Tick"}</option>
          <option value="0.01">0.01</option>
          <option value="0.1">0.1</option>
          <option value="1">1</option>
        </select>
      </div>
      <div className="book-fill">
        {liveAsks.map((row) => line(row, true))}
        <button
          type="button"
          className="book-row flex w-full items-center justify-between border-y border-gold/30 px-2 font-mono text-sm"
          onClick={() => midPx > 0 && onPrice(midPx)}
        >
          <span className={spreadPct > 0.05 ? "text-sell" : "text-up"}>
            {midPx > 0 ? (midPx >= 100 ? midPx.toFixed(2) : midPx.toFixed(4)) : "—"}
          </span>
          <span className="text-[11px] text-ink/40">
            {spreadPct > 0 ? `${spreadPct.toFixed(3)}%` : zh ? "标记" : "Mark"}
          </span>
        </button>
        {liveBids.map((row) => line(row, false))}
      </div>
    </div>
  );
}

export function RealPerp({
  launch,
  onMarkets,
  onJump,
}: {
  launch?: { chain: Desk; coin: "bem" | "btc" | "eth" | "zec" | "up" | "tape" | "fab" };
  onMarkets?: () => void;
  onJump?: (view: { kind: "pancake"; pair: "fab" }) => void;
} = {}) {
  const lang = useExchange((s) => s.lang);
  const prefs = useDeskPrefs();
  const live = useExchange((s) => s.chainBem);
  const c = copy[lang];
  const [chain, setChain] = useState(launch?.chain ?? savedDesk());
  const [coin, setCoin] = useState(launch?.coin ?? "bem");
  const [markets, setMarkets] = useState(false);
  const [perp, setPerp] = useState(() =>
    pickBook(launch?.chain ?? savedDesk(), launch?.coin ?? "bem"),
  );
  const [xbem, setXbem] = useState("");
  const [pasted, setPasted] = useState("");
  const [deployNote, setDeployNote] = useState(null);
  const [account, setAccount] = useState(currentAccount());
  const [view, setView] = useState(null);
  const [margin, setMargin] = useState("1");
  const [lev, setLev] = useState(3);
  const [mode, setMode] = useState("easy");
  const [hot, setHot] = useState(false);
  const [sheet, setSheet] = useState("book");
  const [levText, setLevText] = useState("3");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [bad, setBad] = useState(false);
  const [hash, setHash] = useState(null);
  const [link, setLink] = useState(null);
  const [bal, setBal] = useState(null);
  const [prices, setPrices] = useState([]);
  const [coinPx, setCoinPx] = useState(0);
  const [mkt, setMkt] = useState(null);
  const [supply, setSupply] = useState(null);
  const [frame, setFrame] = useState("1h");
  const [chartTab, setChartTab] = useState("k");
  const [levOpen, setLevOpen] = useState(false);
  const [marginOpen, setMarginOpen] = useState(false);
  const [acctOpen, setAcctOpen] = useState(false);
  const [sizePct, setSizePct] = useState(0);
  const [orderStyle, setOrderStyle] = useState("market");
  const [intent, setIntent] = useState<"long" | "short">("long");
  const [marginMode, setMarginMode] = useState<"cross" | "iso">(() => readModes().margin);
  const [acctMode, setAcctMode] = useState<"unified" | "port" | "manual">(() => readModes().acct);
  const [bemPx, setBemPx] = useState(0);
  const [xSpot, setXSpot] = useState(0);
  const [phone, setPhone] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches
      ? "ticket"
      : wantedPane(),
  );
  const [proOpen, setProOpen] = useState(false);
  const [reduceOnly, setReduceOnly] = useState(false);
  const [stopPx, setStopPx] = useState("");
  const [scaleA, setScaleA] = useState("");
  const [scaleB, setScaleB] = useState("");
  const [scaleN, setScaleN] = useState(3);
  const [twapN, setTwapN] = useState(4);
  const [twapGap, setTwapGap] = useState(120);
  const [trailPct, setTrailPct] = useState("5");
  const [slipBps, setSlipBps] = useState(50);
  const [dock, setDock] = useState<
    "bal" | "pos" | "ord" | "twap" | "chase" | "fill" | "fund" | "hist"
  >("pos");
  const [bookTab, setBookTab] = useState<"book" | "tape">("book");
  const [fills, setFills] = useState<{ t: number; kind: string; hash: string }[]>(() =>
    readFills(),
  );
  const [stops, setStops] = useState<
    { id: bigint; user: string; long: boolean; margin: bigint; lev: number; trigger: bigint }[]
  >([]);
  const [twaps, setTwaps] = useState<
    { id: bigint; user: string; long: boolean; each: bigint; lev: number; left: number }[]
  >([]);
  const [ticketMore, setTicketMore] = useState(false);
  const [limit, setLimit] = useState("");
  const [board, setBoard] = useState([]);
  const [guard, setGuard] = useState("easy");
  const [tpText, setTpText] = useState("");
  const [slText, setSlText] = useState("");
  const [arm, setArm] = useState(null);
  const [card, setCard] = useState(null);
  const lock = useFeeLock();
  const firing = useRef(false);
  const closeArm = useRef("");
  const candleCache = useRef(new Map());
  useEffect(() => {
    if (coin === "tape" || coin === "fab") {
      setSupply(null);
      return;
    }
    let dead = false;
    (chain === "xlayer" ? xCap(TAPE_BEM) : tokenCap(BSC.bem))
      .then((n) => {
        if (!dead) setSupply(n || null);
      })
      .catch(() => {
        if (!dead) setSupply(null);
      });
    return () => {
      dead = true;
    };
  }, [chain, coin]);
  useEffect(() => {
    const book = readCandleBook(`${chain}:${coin}`);
    candleCache.current = book;
    const seeded = previewFrame(book, frame);
    if (seeded.length) setPrices(seeded);
  }, [chain, coin]);
  useEffect(() => {
    if (coin !== "tape") return;
    let dead = false;
    setBoard([]);
    const load = () => {
      readOpenBook()
        .then((row) => {
          if (dead || !(row.price > 0)) return;
          setCoinPx(row.price);
          if (!/^0x[a-fA-F0-9]{40}$/.test(pickBook("xlayer", "tape"))) setView(coinBook(row.price));
          setMkt({
            px: row.price,
            chg: Number.isFinite(row.change) ? row.change : null,
            vol: row.volume > 0 ? row.volume : 0,
          });
        })
        .catch(() => void 0);
      getTapeCandles({ data: frame })
        .then((next) => {
          if (dead) return;
          if (next.length) {
            candleCache.current.set(frame, next);
            writeCandleBook(`${chain}:${coin}`, candleCache.current);
          }
          setPrices(next.length ? next : previewFrame(candleCache.current, frame));
        })
        .catch(() => {
          if (!dead) setPrices(previewFrame(candleCache.current, frame));
        });
    };
    load();
    const timer = window.setInterval(load, 8000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [coin, frame]);
  useEffect(() => {
    if (coin !== "fab") return;
    let dead = false;
    const load = () => {
      fabUsd()
        .then((n) => {
          if (dead || !(n > 0)) return;
          setCoinPx(n);
          if (!/^0x[a-fA-F0-9]{40}$/.test(pickBook("xlayer", "fab"))) setView(coinBook(n));
        })
        .catch(() => void 0);
      getCoinCandles({ data: { coin: "fab", frame } })
        .then((next) => {
          if (dead) return;
          if (next.length) {
            candleCache.current.set(frame, next);
            writeCandleBook(`${chain}:${coin}`, candleCache.current);
          }
          setPrices(next.length ? next : previewFrame(candleCache.current, frame));
        })
        .catch(() => {
          if (!dead) setPrices(previewFrame(candleCache.current, frame));
        });
    };
    load();
    const timer = window.setInterval(load, 12_000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [coin, frame, chain]);
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
    const px =
      chain === "xlayer"
        ? view.mark > 0n
          ? Number(formatUnits(view.mark, 18))
          : 0
        : live && live > 0
          ? live
          : view.mark > 0n
            ? Number(formatUnits(view.mark, 18))
            : 0;
    if (!(px > 0)) return;
    if (row.trail && row.trail > 0) {
      const peak = row.long ? Math.max(row.peak || px, px) : Math.min(row.peak || px, px);
      if (!row.peak || Math.abs(peak - row.peak) / px > 0.0001) {
        const next = { ...row, peak };
        writeArm(next);
        setArm(next);
      }
      const line = row.long ? peak * (1 - row.trail) : peak * (1 + row.trail);
      if (!(row.long ? px <= line : px >= line)) return;
    } else if (!(row.long ? px >= row.tp || px <= row.sl : px <= row.tp || px >= row.sl)) return;
    firing.current = true;
    const bound = {
      ...row,
      deal: id,
      spent: false,
      hold: false,
    };
    writeArm(bound);
    setArm(bound);
    closePerp(account, perp, view.myDeal)
      .then(() => {
        const done = {
          ...bound,
          spent: true,
          hold: false,
        };
        writeArm(done);
        setArm(done);
        setNote(lang === "zh" ? "止盈或止损已平仓。" : "The stop closed the position.");
        setBad(false);
      })
      .catch(() => {
        const held = {
          ...bound,
          spent: false,
          hold: true,
        };
        writeArm(held);
        setArm(held);
        setNote(
          lang === "zh"
            ? "平仓没有完成。保护还在，但不会自动再弹钱包。点再试一次。"
            : "The close did not finish. The stop is still there, but the wallet will not pop again until you tap retry.",
        );
        setBad(true);
      })
      .finally(() => {
        firing.current = false;
      });
  }, [account, perp, view?.myDeal, view?.mark, live, hash, lang]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      if (launch) {
        selectDesk(launch.chain);
        setPerp(pickBook(launch.chain, launch.coin));
      } else if (
        new URLSearchParams(window.location.hash.replace(/^#/, "")).get("ref") ||
        new URLSearchParams(window.location.search).get("ref")
      ) {
        selectDesk("xlayer");
        setChain("xlayer");
        setPerp(pickBook("xlayer", "bem"));
      } else
        activeBook()
          .then(setPerp)
          .catch(() => setPerp(pickBook(savedDesk(), "bem")));
    }
    const onBook = (event: Event) => {
      const detail = (event as CustomEvent<{ coin?: string; book?: string }>).detail;
      if (!detail?.book || !detail.coin) return;
      if (launch?.coin === detail.coin) setPerp(detail.book);
    };
    window.addEventListener("tape-coin-book", onBook);
    const stopAccount = onAccount(setAccount);
    const stopLink = onOpenLink(setLink);
    return () => {
      window.removeEventListener("tape-coin-book", onBook);
      stopAccount();
      stopLink();
    };
  }, []);
  useEffect(() => {
    if (!account) return;
    let dead = false;
    const pull = () => {
      readChainPurse(chain, account)
        .then(async (next) => {
          let bem = 0n;
          try {
            bem = chain === "xlayer" ? await readXBem(account) : (await readBalances(account)).bem;
          } catch {
            bem = 0n;
          }
          if (!dead)
            setBal({
              bnb: next.gas,
              usdt: next.usdt,
              bem,
            });
          if (coin !== "bem") {
            bemPrice()
              .then((text) => {
                const n = Number(String(text).replace(/,/g, ""));
                if (!dead && n > 0) setBemPx(n);
              })
              .catch(() => void 0);
          }
        })
        .catch(() => void 0);
    };
    pull();
    const timer = window.setInterval(pull, 12_000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [account, hash, chain, coin]);
  useEffect(() => {
    if (chain !== "xlayer") return;
    let dead = false;
    xPoolPrice()
      .then((n) => {
        if (!dead && n > 0) setXSpot(n);
      })
      .catch(() => void 0);
    return () => {
      dead = true;
    };
  }, [chain, hash]);
  useEffect(() => {
    if (!(chain === "bsc" && coin !== "bem")) return;
    let dead = false;
    setBoard([]);
    const load = () => {
      getCoinCandles({
        data: {
          coin,
          frame,
        },
      })
        .then((next) => {
          if (dead) return;
          if (next.length) {
            candleCache.current.set(frame, next);
            writeCandleBook(`${chain}:${coin}`, candleCache.current);
          }
          setPrices(next.length ? next : previewFrame(candleCache.current, frame));
        })
        .catch(() => {
          if (!dead) setPrices(previewFrame(candleCache.current, frame));
        });
      const priceText = coin === "up" ? quoteUpUsd() : ercPrice(coin);
      priceText
        .then((text) => {
          const n = Number(String(text).replace(/,/g, ""));
          if (dead || !(n > 0)) return;
          setCoinPx(n);
          if (!/^0x[a-fA-F0-9]{40}$/.test(pickBook("bsc", coin))) setView(coinBook(n));
        })
        .catch(() => void 0);
    };
    load();
    const timer = window.setInterval(load, 12e3);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [chain, coin, frame]);
  useEffect(() => {
    if (coin === "tape" || coin === "fab") return;
    const pair =
      coin === "btc"
        ? "bsc/0x247f51881d1E3aE0f759afB801413a6C948Ef442"
        : coin === "eth"
          ? "bsc/0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5"
          : coin === "zec"
            ? "bsc/0x6701B287c8170D6c290C6f4Ef426782bD61Ae310"
            : coin === "up"
              ? "bsc/0x364d573106Ff27F3e394BA2377E9b915Cf56Ba6A"
              : "bsc/0x3098D7A051045000d68eC0360753A40C8cABEa31";
    let dead = false;
    const load = () => {
      fetch(`https://api.dexscreener.com/latest/dex/pairs/${pair}`)
        .then((res) => res.json())
        .then((body) => {
          const row = body?.pair || body?.pairs?.[0];
          const px = Number(row?.priceUsd);
          const chg = Number(row?.priceChange?.h24);
          const vol = Number(row?.volume?.h24);
          if (dead || !(px > 0)) return;
          setMkt({
            px,
            chg: Number.isFinite(chg) ? chg / 100 : null,
            vol: Number.isFinite(vol) && vol > 0 ? vol : 0,
          });
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 20_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [coin]);
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
  const sawOrder = useRef(false);
  useEffect(() => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) return;
    if ((coin === "btc" || coin === "eth" || coin === "zec" || coin === "up" || coin === "tape" || coin === "fab") && !/^0x[a-fA-F0-9]{40}$/.test(pickBook(coin === "tape" || coin === "fab" ? "xlayer" : chain, coin))) return;
    let dead = false;
    let busy = false;
    const load = () => {
      if (busy) return;
      busy = true;
      selectDesk(chain);
      const book = readPerp(perp, account)
        .then((next) => {
          if (dead || !next) return;
          setView(next);
          const who = account?.toLowerCase();
          if (who && !sawOrder.current && next.quotes?.some((quote) => quote.user?.toLowerCase() === who)) {
            sawOrder.current = true;
            setDock("ord");
          }
        })
        .catch((err) => {
          if (dead) return;
          if ((err instanceof Error ? err.message : "") === "nochain") setNote(c.perpNoChain);
        });
      const board = readBoard()
        .then((rows) => {
          if (!dead) setBoard(rows);
        })
        .catch(() => void 0);
      const bars = (
        coin === "tape"
          ? getTapeCandles({ data: frame })
          : coin === "btc" || coin === "eth" || coin === "zec" || coin === "up" || coin === "fab"
            ? getCoinCandles({ data: { coin, frame } })
            : chain === "xlayer"
              ? getXCandles({ data: frame })
              : getCandles({ data: frame })
      )
        .then((next) => {
          if (dead) return;
          if (next.length) {
            candleCache.current.set(frame, next);
            writeCandleBook(`${chain}:${coin}`, candleCache.current);
          }
          setPrices(next.length ? next : previewFrame(candleCache.current, frame));
        })
        .catch(() => {
          if (!dead) setPrices(previewFrame(candleCache.current, frame));
        });
      void Promise.allSettled([book, board, bars]).finally(() => {
        busy = false;
      });
    };
    load();
    const timer = window.setInterval(load, 12e3);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [perp, account, hash, frame, chain, coin]);
  useEffect(() => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) return;
    let dead = false;
    const pull = () => {
      Promise.all([readStops(perp), readTwaps(perp)])
        .then(([nextStops, nextTwaps]) => {
          if (dead) return;
          setStops(nextStops);
          setTwaps(nextTwaps);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 12_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [perp, hash]);
  const fail = (err) => {
    const code = err.code;
    const message = err instanceof Error ? err.message : "";
    if (message === "nowallet") setNote(c.walletNo);
    else if (message === "usdt")
      setNote(
        lang === "zh"
          ? `${chain === "xlayer" ? "USDT0" : "USDT"} 不够，没有打开钱包。`
          : `Not enough ${chain === "xlayer" ? "USDT0" : "USDT"}. The wallet was not opened.`,
      );
    else if (message === "revert")
      setNote(
        lang === "zh" ? "这笔合约过不了，没有打开钱包。" : "That call would fail. The wallet was not opened.",
      );
    else if (message === "nochain") setNote(c.perpNoChain);
    else if (message === "fee")
      setNote(lang === "zh" ? "只有收费地址能部署。" : "Only the fee address can deploy.");
    else if (message === "oracle")
      setNote(
        lang === "zh" ? "只有收费地址能写标记价。" : "Only the fee address can post the mark.",
      );
    else if (chain === "xlayer" && /revert|execution|Bad/i.test(message))
      setNote(lang === "zh" ? "没开成。" : "It did not open.");
    else if (code === 4001) setNote(c.walletReject);
    else if (/RPC|publicnode|Archive|Invalid param/i.test(message)) setNote(c.rpcWait);
    else if (message === "amount")
      setNote(
        lang === "zh"
          ? "数量不对。先看保证金和价格有没有填上。"
          : "That amount is not valid. Check the margin and the price.",
      );
    else if (message === "price") setNote(c.badPrice);
    else if (message === "slip")
      setNote(
        lang === "zh"
          ? "对手价超出滑点，市价没有发出。"
          : "The other side is outside the slippage. The market order was not sent.",
      );
    else if (message === "cross")
      setNote(
        lang === "zh"
          ? "这个价会马上碰到对手单。只挂单不会发出。"
          : "That price would hit a resting quote. The post-only order was not sent.",
      );
    else if (message === "flat")
      setNote(lang === "zh" ? "没有可减的仓。" : "There is no position to reduce.");
    else if (message === "net")
      setNote(
        lang === "zh"
          ? "组合保证金不能只减一截。数量要盖住现在的反向仓，或改回手动。"
          : "Portfolio margin cannot shrink part of a position. Cover the opposite side, or switch to manual.",
      );
    else if (message === "book")
      setNote(
        lang === "zh" ? "不是这一本合约，没有发出。" : "That is not this book. Nothing was sent.",
      );
    else if (message === "risk")
      setNote(lang === "zh" ? "这一笔没有发出。" : "That order was not sent.");
    else if (message === "local")
      setNote(lang === "zh" ? "这本合约没有链上止损。" : "This contract has no on-chain stop.");
    else if (message === "code")
      setNote(
        lang === "zh"
          ? "推荐码用 1 到 16 个英文字，汉字最多 5 个。"
          : "Use 1 to 16 English characters, or up to 5 Chinese characters.",
      );
    else if (message === "taken") setNote(c.rebateTaken);
    else if (message === "have") setNote(c.rebateHave);
    else setNote(readPrefs().verboseErrors && message ? message : c.walletReject);
    setBad(true);
  };
  const run = async (task, kind) => {
    if ((kind === "close" || kind === "close-all" || kind === "close-row") && readPrefs().closeConfirm) {
      if (closeArm.current !== kind) {
        closeArm.current = kind;
        setNote(lang === "zh" ? "再点一次确认平仓" : "Tap again to close");
        setBad(false);
        window.setTimeout(() => {
          if (closeArm.current === kind) closeArm.current = "";
        }, 4000);
        return;
      }
      closeArm.current = "";
    }
    let job = task;
    if (kind === "close" && readPrefs().closeAllHold && view?.liveDeals && account) {
      job = async (from) => {
        const mine = view.liveDeals.filter(
          (deal) =>
            deal.long.toLowerCase() === from.toLowerCase() ||
            deal.short.toLowerCase() === from.toLowerCase(),
        );
        let last;
        for (const deal of mine) last = await closePerp(from, perp, deal.id);
        return last;
      };
    }
    setBusy(true);
    setBad(false);
    setNote(c.walletBusy);
    try {
      selectDesk(chain);
      const from = account ?? (chain === "xlayer" ? await connectXLayer() : await connectBsc());
      setAccount(from);
      const result = await job(from);
      if (typeof result === "string" && result.length === 66) {
        setHash(result);
        setFills(pushFill(kind || "tx", result));
        announceFill(lang === "zh" ? "合约回执" : "Perp receipt", result.slice(0, 10));
        if (kind !== "cancel")
          markDeskFill(
            chain === "bsc" ? "bsc" : "xlayer",
            from,
            "perp",
            kind === "close" || kind === "close-all" ? 0 : Number(margin) * (Number(lev) || 1),
            coin,
          );
      }
        setNote(null);
        if (/^0x[a-fA-F0-9]{40}$/.test(perp)) {
          void readPerp(perp, from)
            .then((next) => {
              setView(next);
              const who = from.toLowerCase();
              const hasQuote = next.quotes?.some((quote) => quote.user?.toLowerCase() === who);
              const hasDeal = next.liveDeals?.some(
                (deal) =>
                  deal.long.toLowerCase() === who || deal.short.toLowerCase() === who,
              );
              if (kind === "cancel") setDock("ord");
              else if (kind === "close" || kind === "close-all") setDock(hasDeal ? "pos" : "bal");
              else if (kind !== "poke") setDock(hasDeal && !hasQuote ? "pos" : "ord");
            })
            .catch(() => undefined);
          void readBoard()
            .then((rows) => setBoard(rows))
            .catch(() => undefined);
        }
    } catch (err) {
      if (kind === "cancel") {
        setNote(
          lang === "zh"
            ? "撤单未确认，单仍在合约里。可再试一次。"
            : "Cancel was not confirmed. The order is still in the contract. Try again.",
        );
        setBad(true);
      } else fail(err);
    } finally {
      setBusy(false);
    }
  };
  const waiting = view && view.pendingUser !== zero;
  const mine = Boolean(
    account && waiting && view?.pendingUser.toLowerCase() === account.toLowerCase(),
  );
  const inDeal = view?.kind === 2;
  const dec = chain === "xlayer" ? 6 : 18;
  const scan = chain === "xlayer" ? XLAYER.explorer : BSC.explorer;
  const floor = view && view.min > 0n ? Number(view.min / 10n ** BigInt(dec)) : 1;
  const levOk = lev >= 1 && lev <= 1000;
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
  const lastClose = prices.at(-1)?.c ?? 0;
  const ownCoin = coin === "btc" || coin === "eth" || coin === "zec" || coin === "up" || coin === "tape" || coin === "fab";
  const ownBook = ownCoin ? pickBook(coin === "tape" || coin === "fab" ? "xlayer" : "bsc", coin) : "";
  const alt = ownCoin && !/^0x[a-fA-F0-9]{40}$/.test(ownBook);
  const canDeploy = alt && ownCoin;
  const riskLive =
    !alt &&
    /^0x[a-fA-F0-9]{40}$/.test(perp) &&
    (perp.toLowerCase() === bookOf(chain).toLowerCase() ||
      (ownBook && perp.toLowerCase() === ownBook.toLowerCase()));
  const base =
    coin === "tape" ? "TAPE" : coin === "fab" ? "FAB" : chain === "xlayer" || coin === "bem" ? "BEM" : coin.toUpperCase();
  const feeBlocked = lock.rows.some((row) => {
    if (!row.got || row.ok) return false;
    return chain === "xlayer" ? row.name.includes("X Layer") : row.name.includes("BSC 永续");
  });
  const settle = !alt && view && view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0;
  const poolPx =
    coin === "tape" || coin === "fab"
      ? coinPx > 0
        ? coinPx
        : lastClose
      : coin === "btc" || coin === "eth" || coin === "zec" || coin === "up"
        ? coinPx > 0
          ? coinPx
          : lastClose
        : chain === "xlayer" && xSpot > 0
          ? xSpot
          : lastClose > 0
            ? lastClose
            : coinPx;
  const markFar =
    !alt &&
    settle > 0 &&
    poolPx > 0 &&
    (coin === "btc" || coin === "eth" || coin === "zec" || coin === "up" || coin === "tape" || coin === "fab" || (chain === "xlayer" && coin === "bem")) &&
    Math.abs(settle - poolPx) / poolPx > 0.03;
  const ownMark =
    coin === "btc" || coin === "eth" || coin === "zec" || coin === "up" || coin === "tape" || coin === "fab" || chain === "xlayer";
  const markN = alt
    ? coinPx || lastClose
    : markFar
      ? poolPx
      : ownMark
        ? settle || poolPx
        : live && live > 0
          ? live
          : settle || poolPx;
  const priceOk =
    orderStyle === "scale"
      ? Number(scaleA) > 0 && Number(scaleB) > 0
      : orderStyle === "stop"
        ? Number(stopPx) > 0
        : orderStyle === "twap"
          ? twapN >= 2 && twapGap >= 30 && markN > 0
          : orderStyle === "chase"
            ? markN > 0
            : orderStyle === "trail"
              ? Number(trailPct) > 0 && Number(trailPct) < 50
              : (orderStyle === "limit" || orderStyle === "post") && !limit.trim()
                ? false
                : markN > 0 || (ticketPx >= 10n ** 16n && ticketPx <= 100000n * 10n ** 18n);
  const ticket = plan(margin, levOk ? lev : 1, ticketPx);
  const quotePx =
    (orderStyle === "limit" || orderStyle === "post") && Number(limit) > 0 ? Number(limit) : markN;
  const quoteLiq =
    quotePx > 0 && lev > 0
      ? intent === "long"
        ? quotePx * (1 - 0.5 / lev)
        : quotePx * (1 + 0.5 / lev)
      : 0;
  const liqMove = levOk ? Math.max(0.05, Math.round(5e3 / lev) / 100).toFixed(2) : null;
  let need = 0n;
  try {
    need = units(margin, dec);
  } catch {
    need = 0n;
  }
  const easy =
    floor <= 1
      ? [
          {
            id: "try",
            margin: "1",
            lev: 3,
          },
          {
            id: "daily",
            margin: "5",
            lev: 5,
          },
          {
            id: "push",
            margin: "10",
            lev: 10,
          },
        ]
      : presets;
  const pickFrame = (id) => {
    setFrame(id);
    setPrices(previewFrame(candleCache.current, id));
  };
  const fillMargin = (pct) => {
    setSizePct(pct);
    const usdtHeld = bal ? Number(formatUnits(bal.usdt, dec)) : 0;
    if (usdtHeld > 0) {
      const n = Math.min(500, (usdtHeld * pct) / 100);
      setMargin(n.toFixed(2));
      return;
    }
    setMargin(pct === 25 ? "1" : pct === 50 ? "5" : pct === 75 ? "10" : "25");
  };
  const entryN = view && view.dealEntry > 0n ? Number(formatUnits(view.dealEntry, 18)) : 0;
  const mineOpen = (view?.liveDeals ?? []).find(
    (deal) =>
      account &&
      (deal.long.toLowerCase() === account.toLowerCase() ||
        deal.short.toLowerCase() === account.toLowerCase()) &&
      deal.id === view.myDeal,
  );
  const mineLev = mineOpen
    ? account && mineOpen.long.toLowerCase() === account.toLowerCase()
      ? mineOpen.levL
      : mineOpen.levS
    : 0;
  const bemNow = coin === "bem" && markN > 0 ? markN : bemPx;
  const freeN = bal ? Number(formatUnits(bal.usdt, dec)) : 0;
  const spotN =
    bal && bemNow > 0 ? Number(formatUnits(bal.bem, chain === "xlayer" ? 8 : BSC.bemDecimals)) * bemNow : 0;
  const mineBook =
    mineOpen && account
      ? {
          long: mineOpen.long.toLowerCase() === account.toLowerCase(),
          notional: Math.max(
            0,
            Number(formatUnits(mineOpen.base, 18)) * Number(formatUnits(mineOpen.entry, 18)),
          ),
        }
      : null;
  const planned = planMargin({
    marginMode,
    acctMode,
    margin: Number(margin),
    lev: levOk ? lev : 1,
    price: quotePx,
    freeUsdt: freeN,
    spotQuote: 0,
    intentLong: intent === "long",
    mine: mineBook && mineBook.notional > 0 ? mineBook : null,
  });
  const modeWarn = modeLine(lang === "zh", planned, Number(margin) || 0, marginMode);
  const liqN =
    entryN > 0 && mineLev > 0
      ? account && mineOpen && mineOpen.long.toLowerCase() === account.toLowerCase()
        ? entryN * (1 - 0.5 / mineLev)
        : entryN * (1 + 0.5 / mineLev)
      : 0;
  const usedMargin = (() => {
    if (!account || !view) return 0;
    const me = account.toLowerCase();
    const quotes = (view.quotes ?? [])
      .filter((quote) => quote.user?.toLowerCase() === me)
      .reduce((sum, quote) => sum + Number(formatUnits(quote.margin, dec)), 0);
    const deals = (view.liveDeals ?? []).reduce(
      (sum, deal) =>
        sum +
        (deal.long.toLowerCase() === me ? Number(formatUnits(deal.marginL, dec)) : 0) +
        (deal.short.toLowerCase() === me ? Number(formatUnits(deal.marginS, dec)) : 0),
      0,
    );
    return quotes + deals;
  })();
  const openPnl = (() => {
    if (!account || !view) return 0;
    const me = account.toLowerCase();
    return (view.liveDeals ?? []).reduce((sum, deal) => {
      if (deal.long.toLowerCase() === me)
        return sum + Number(formatUnits(deal.eqL - deal.marginL, dec));
      if (deal.short.toLowerCase() === me)
        return sum + Number(formatUnits(deal.eqS - deal.marginS, dec));
      return sum;
    }, 0);
  })();
  const pick = (nextMargin, nextLev) => {
    setMargin(nextMargin);
    setLev(nextLev);
    setLevText(String(nextLev));
  };
  const lastBar = prices.at(-1);
  const fundNow = fundingPreview(markN, lastBar?.c || markN);
  const fundText = fundNow ? pct(fundNow.capped) : "—";
  const dayBars = prices.filter((bar) => {
    const t = bar?.t;
    if (!(t > 1e8)) return false;
    const sec = t > 1e12 ? t / 1000 : t;
    return sec >= Date.now() / 1000 - 86400;
  });
  const dayHigh = dayBars.length ? Math.max(...dayBars.map((bar) => bar.h)) : 0;
  const dayLow = dayBars.length ? Math.min(...dayBars.map((bar) => bar.l)) : 0;
  const dayChg =
    dayBars.length && dayBars[0].o > 0
      ? (dayBars[dayBars.length - 1].c - dayBars[0].o) / dayBars[0].o
      : null;
  const drift = mkt && mkt.chg != null ? mkt.chg : dayChg != null ? dayChg : 0;
  const driftKnown = (mkt && mkt.chg != null) || dayChg != null;
  const vol24 = mkt && mkt.vol > 0 ? mkt.vol : 0;
  const pxTextN = (n) => (n >= 100 ? n.toFixed(2) : n.toFixed(4));
  const choose = (nextChain, nextCoin) => {
    setMarkets(false);
    setCoin(nextCoin);
    const desk = nextCoin === "tape" || nextCoin === "fab" ? "xlayer" : nextCoin === "btc" || nextCoin === "eth" ? "bsc" : nextChain;
    if (desk !== chain) {
      selectDesk(desk);
      setChain(desk);
      (desk === "xlayer" ? connectXLayer() : connectBsc()).catch(() => void 0);
    }
    setPerp(pickBook(desk, nextCoin));
  };
  const proNames: Record<string, [string, string]> = {
    post: ["只挂", "Post"],
    chase: ["追价", "Chase"],
    scale: ["分段订单", "Scale"],
    stop: ["止损市价", "Stop"],
    trail: ["移动止损", "Trail"],
    twap: ["TWAP", "TWAP"],
  };
  const proOn = orderStyle in proNames;
  const proLabel = proOn
    ? proNames[orderStyle][lang === "zh" ? 0 : 1]
    : lang === "zh"
      ? "专业"
      : "Pro";
  const posSize =
    !account || !view
      ? 0
      : (view.liveDeals ?? []).reduce((sum, deal) => {
          const me = account.toLowerCase();
          if (deal.long.toLowerCase() !== me && deal.short.toLowerCase() !== me) return sum;
          return sum + Number(formatUnits(deal.base, 18));
        }, 0);
  const me = account?.toLowerCase() ?? "";
  const myDeals = (view?.liveDeals ?? []).filter(
    (deal) => me && (deal.long.toLowerCase() === me || deal.short.toLowerCase() === me),
  );
  const myQuotes = (view?.quotes ?? []).filter((quote) => me && quote.user?.toLowerCase() === me);
  const shownDeals =
    myDeals.length > 0
      ? myDeals
      : view && me && view.kind === 2 && (view.base > 0n || view.margin > 0n)
        ? [
            {
              id: view.myDeal || 0n,
              long: view.long ? account : view.other || zero,
              short: view.long ? view.other || zero : account,
              marginL: view.long ? view.margin : 0n,
              marginS: view.long ? 0n : view.margin,
              base: view.base,
              entry: view.entry,
              eqL: view.long ? view.equity : 0n,
              eqS: view.long ? 0n : view.equity,
              levL: 0,
              levS: 0,
            },
          ]
        : [];
  const powerN = acctMode === "unified" ? freeN + spotN : freeN;
  const room = powerN > 0 && markN > 0 ? (powerN * (lev || 1)) / markN : 0;
  const roomText = room > 0 ? room.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
  const needLock = planned.net === "close" ? 0 : planned.lock > 0 ? planned.lock : Number(margin) || 0;
  const opensMargin = !reduceOnly && planned.net !== "close" && orderStyle !== "trail";
  const usdtShort = Boolean(bal) && opensMargin && needLock > freeN + 0.009;
  const walletUsdt = bal ? freeN.toFixed(2) : "—";
  const shortLine =
    lang === "zh"
      ? `${chain === "xlayer" ? "USDT0" : "USDT"} 不够。这一笔要 ${needLock.toFixed(2)}，钱包里只有 ${walletUsdt}。没有打开钱包。`
      : `Not enough ${chain === "xlayer" ? "USDT0" : "USDT"}. This order needs ${needLock.toFixed(2)} and the wallet has ${walletUsdt}. The wallet was not opened.`;
  const place = (side) => {
    setIntent(side);
    if (busy) return;
    if (markFar) {
      run((from) => pokeBook(from, perp));
      return;
    }
    if (canDeploy || alt) return;
    if (feeBlocked) {
      setBad(true);
      setNote(lang === "zh" ? "开仓停了。" : "Opening is stopped.");
      return;
    }
    if (!levOk || !marginOk || !priceOk) {
      setBad(true);
      setNote(lang === "zh" ? "先看价格和保证金。" : "Check the price and margin.");
      return;
    }
    if (usdtShort) {
      setBad(true);
      setNote(shortLine);
      return;
    }
    if (planned.net === "reject") {
      setBad(true);
      setNote(
        lang === "zh"
          ? "数量要盖住反向仓，或改回手动。"
          : "Cover the opposite side, or switch to manual.",
      );
      return;
    }
    setCard(side);
  };
  return /* @__PURE__ */ jsxs("div", {
    children: [
      /* @__PURE__ */ jsx("section", {
        className: "phone-desk overflow-hidden border border-gold bg-card",
        "data-phone": phone,
        children: /* @__PURE__ */ jsxs("div", {
          className: "flex flex-col gap-3 p-0",
          children: [
            /* @__PURE__ */ jsxs("div", {
              className:
                "flex flex-nowrap items-center gap-x-4 border-b border-gold px-3 py-2",
              children: [
                /* @__PURE__ */ jsxs("div", {
                  className: "relative shrink-0",
                  children: [
                    /* @__PURE__ */ jsxs("button", {
                      type: "button",
                      onClick: () => (onMarkets ? onMarkets() : setMarkets((open) => !open)),
                      className: "flex items-center gap-2",
                      children: [
                        <CoinMark id={coin} />,
                        <span className="text-lg font-medium tracking-tight">
                          {coin === "tape"
                            ? "TAPE-USDT0"
                            : coin === "fab"
                              ? "FAB-USDT0"
                              : chain === "xlayer"
                                ? "BEM-USDT0"
                                : `${base}-USDT`}
                        </span>,
                        <PairChevron up={markets} />,
                        <span className="lev-chip rounded px-1.5 py-0.5 font-mono text-[11px]">
                          {lev}×
                        </span>,
                      ],
                    }),
                    markets && !onMarkets
                      ? /* @__PURE__ */ jsxs("div", {
                          className:
                            "pop-in absolute left-0 top-full z-40 mt-2 w-[min(28rem,calc(100vw-2rem))] border border-gold bg-card p-1 shadow-plate",
                          children: [
                            /* @__PURE__ */ jsx("p", {
                              className: "px-2 py-1 text-[11px] tracking-wide text-ink/45",
                              children: lang === "zh" ? "热门" : "Hot",
                            }),
                            [
                              ["bsc", "bem", "BEM-USDT", "BSC"],
                              ["xlayer", "bem", "BEM-USDT0", "X Layer"],
                              ["bsc", "up", "UP-USDT", "BSC"],
                              ["xlayer", "tape", "TAPE-USDT0", "X Layer"],
                              ["xlayer", "fab", "FAB-USDT0", "X Layer"],
                              ["bsc", "btc", "BTC-USDT", "BSC"],
                              ["bsc", "eth", "ETH-USDT", "BSC"],
                              ["bsc", "zec", "ZEC-USDT", "BSC"],
                            ].map(([nextChain, nextCoin, label, venue]) => {
                              return /* @__PURE__ */ jsxs(
                                "button",
                                {
                                  type: "button",
                                  onClick: () => choose(nextChain, nextCoin),
                                  className: `flex w-full items-center gap-2 px-2 py-2 text-left text-sm ${coin === nextCoin && (nextCoin === "tape" || nextCoin === "fab" || chain === nextChain) ? "bg-foil" : "hover:bg-foil/70"}`,
                                  children: [
                                    /* @__PURE__ */ jsx(CoinMark, {
                                      id: nextCoin,
                                      className: "size-5",
                                    }),
                                    /* @__PURE__ */ jsx("span", {
                                      className: "mr-auto",
                                      children: label,
                                    }),
                                    /* @__PURE__ */ jsxs("span", {
                                      className: "text-[11px] text-ink/50",
                                      children: [venue, " · ", lang === "zh" ? "永续" : "Perp"],
                                    }),
                                  ],
                                },
                                `${nextChain}-${nextCoin}`,
                              );
                            }),
                            /* @__PURE__ */ jsxs("button", {
                              type: "button",
                              onClick: () => {
                                setMarkets(false);
                                onJump?.({ kind: "pancake", pair: "fab" });
                              },
                              className: "flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-foil/70",
                              children: [
                                /* @__PURE__ */ jsx(CoinMark, { id: "fab", className: "size-5" }),
                                /* @__PURE__ */ jsx("span", { className: "mr-auto", children: "FAB/BEM" }),
                                /* @__PURE__ */ jsx("span", {
                                  className: "text-[11px] text-ink/50",
                                  children: lang === "zh" ? "X Layer · 现货" : "X Layer · Spot",
                                }),
                              ],
                            }),
                          ],
                        })
                      : null,
                  ],
                }),
                /* @__PURE__ */ jsx("div", {
                  className: "hl-stats",
                  children: [
                    {
                      k: c.mark,
                      v: markN > 0 ? pxTextN(markN) : mkt?.px > 0 ? pxTextN(mkt.px) : "—",
                      tone: "text-up",
                    },
                    { k: lang === "zh" ? "预言机" : "Oracle", v: lastBar ? pxTextN(lastBar.c) : "—" },
                    {
                      k: lang === "zh" ? "24小时变化" : "24h change",
                      v: driftKnown ? `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(2)}%` : "—",
                      tone: !driftKnown ? "" : drift < 0 ? "text-sell" : "text-up",
                    },
                    {
                      k: lang === "zh" ? "24小时成交量" : "24h volume",
                      v:
                        vol24 > 0
                          ? vol24.toLocaleString("en-US", { maximumFractionDigits: 0 })
                          : "—",
                    },
                    {
                      k: lang === "zh" ? "合约持仓量" : "Open interest",
                      v: view?.liveDeals?.length
                        ? view.liveDeals
                            .reduce(
                              (sum, deal) => sum + Number(formatUnits(deal.base, 18)) * (markN || 0),
                              0,
                            )
                            .toLocaleString("en-US", { maximumFractionDigits: 0 })
                        : "—",
                    },
                    {
                      k: lang === "zh" ? "资金费 / 倒计时" : "Funding",
                      v: `${fundText} · ${fundClock(lang === "zh")}`,
                    },
                  ].map((stat) =>
                    jsx(
                      "p",
                      {
                        className: "hl-stat",
                        children: [
                          jsx("span", { children: stat.k }),
                          jsx("b", { className: stat.tone || "", children: stat.v }),
                        ],
                      },
                      stat.k,
                    ),
                  ),
                }),
                /* @__PURE__ */ jsxs("div", {
                  className: "ml-auto text-right leading-tight xl:hidden",
                  children: [
                    /* @__PURE__ */ jsx("p", {
                      className: `font-mono text-lg tabular-nums ${!driftKnown || drift >= 0 ? "text-up" : "text-sell"}`,
                      children: markN > 0 ? pxTextN(markN) : mkt?.px > 0 ? pxTextN(mkt.px) : "—",
                    }),
                    /* @__PURE__ */ jsx("p", {
                      className: `font-mono text-[11px] tabular-nums ${!driftKnown ? "text-ink/45" : drift < 0 ? "text-sell" : "text-up"}`,
                      children: driftKnown
                        ? `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(2)}%`
                        : "—",
                    }),
                  ],
                }),
              ],
            }),
            link
              ? /* @__PURE__ */ jsx("a", {
                  href: link,
                  target: "_blank",
                  rel: "noreferrer",
                  className:
                    "mx-3 inline-flex min-h-10 items-center justify-center bg-ink px-3 text-sm text-paper",
                  children: c.signOkx,
                })
              : null,
            null,
            /* @__PURE__ */ jsxs("div", {
              className: "desk-grid grid items-stretch xl:grid-cols-[minmax(0,1fr)_18rem_22rem]",
              children: [
                /* @__PURE__ */ jsxs("div", {
                  className: "ph-chart order-1 min-w-0 xl:order-1",
                  children: [
                    /* @__PURE__ */ jsxs("div", {
                      className: "flex flex-col gap-2 px-2 pt-2",
                      children: [
                        /* @__PURE__ */ jsxs("div", {
                          className: "flex gap-3 px-1 text-sm",
                          children: [
                            /* @__PURE__ */ jsx("button", {
                              type: "button",
                              onClick: () => setChartTab("k"),
                              className: chartTab === "k" ? "tab-on" : "text-ink/45",
                              children: lang === "zh" ? "图表" : "Chart",
                            }),
                            /* @__PURE__ */ jsx("button", {
                              type: "button",
                              onClick: () => setChartTab("fund"),
                              className: chartTab === "fund" ? "tab-on" : "text-ink/45",
                              children: lang === "zh" ? "资金费" : "Funding",
                            }),
                          ],
                        }),
                      ],
                    }),
                    chartTab === "fund"
                      ? /* @__PURE__ */ jsx(FundingBoard, {
                          zh: lang === "zh",
                          mark: markN,
                          last: lastBar?.c ?? markN,
                        })
                      : /* @__PURE__ */ jsx("div", {
                          children: /* @__PURE__ */ jsx(Kline, {
                            bars: prices,
                            entry: entryN,
                            mark: markN,
                            liq: liqN,
                            tp: arm && !arm.spent ? arm.tp : 0,
                            sl: arm && !arm.spent ? arm.sl : 0,
                            supply,
                            lang,
                            desk: "perp",
                            frame,
                            onFrame: pickFrame,
                            frames: [
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
                            ].map(([id, zhLabel, enLabel]) => ({
                              id,
                              label: lang === "zh" ? zhLabel : enLabel,
                            })),
                            onPrice: (px) => {
                              setOrderStyle("limit");
                              setLimit(px.toFixed(4));
                            },
                          }),
                        }),
                    /* @__PURE__ */ jsxs("div", {
                      className: "grid grid-cols-2 gap-2 px-3 pb-3 xl:hidden",
                      children: [
                        /* @__PURE__ */ jsx("button", {
                          type: "button",
                          className: "h-11 bg-[#1b6b45] text-sm text-white",
                          onClick: () => {
                            setIntent("long");
                            setPhone("ticket");
                          },
                          children: lang === "zh" ? "开多" : "Long",
                        }),
                        /* @__PURE__ */ jsx("button", {
                          type: "button",
                          className: "h-11 bg-sell text-sm text-white",
                          onClick: () => {
                            setIntent("short");
                            setPhone("ticket");
                          },
                          children: lang === "zh" ? "开空" : "Short",
                        }),
                      ],
                    }),
                    lock.status === "bad" && feeBlocked
                      ? /* @__PURE__ */ jsx("p", {
                          className: "hidden",
                          children:
                            lang === "zh"
                              ? "收费地址对不上，开仓停了。"
                              : "The fee address does not match. Opening is stopped.",
                        })
                      : null,
                  ],
                }),
                /* @__PURE__ */ jsxs("div", {
                  className:
                    "ph-book order-3 flex h-full min-h-[28rem] min-w-0 flex-col self-stretch border-t border-gold xl:order-2 xl:border-t-0 xl:border-l",
                  children: [
                    /* @__PURE__ */ jsxs("div", {
                      className: "flex h-9 items-center gap-3 border-b border-gold px-3 text-xs",
                      children: [
                        jsx("button", {
                          type: "button",
                          onClick: () => setBookTab("book"),
                          className: bookTab === "book" ? "tab-on" : "text-ink/45",
                          children: lang === "zh" ? "订单簿" : "Book",
                        }),
                        jsx("button", {
                          type: "button",
                          onClick: () => setBookTab("tape"),
                          className: bookTab === "tape" ? "tab-on" : "text-ink/45",
                          children: lang === "zh" ? "最新成交" : "Trades",
                        }),
                      ],
                    }),
                    bookTab === "tape"
                      ? jsx("div", {
                          className: "book-scroll max-h-[28rem] overflow-auto",
                          children: fills.length
                            ? fills.slice(0, 30).map((row) =>
                                jsxs(
                                  "p",
                                  {
                                    className: "grid grid-cols-[1fr_auto] px-2 py-[3px] font-mono text-[12px]",
                                    children: [
                                      jsx("span", {
                                        className: "text-ink/80",
                                        children: row.kind,
                                      }),
                                      jsx("span", {
                                        className: "text-ink/45",
                                        children: new Date(row.t).toLocaleTimeString([], {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          second: "2-digit",
                                        }),
                                      }),
                                    ],
                                  },
                                  `${row.hash}-${row.t}`,
                                ),
                              )
                            : null,
                        })
                      : jsx(DeskLadder, {
                      rows: (view?.quotes ?? []).map((quote) => ({ perp, quote })),
                      mark: markN,
                      bookMark: settle,
                      account,
                      busy,
                      dec,
                      scan,
                      named,
                      lang,
                      unit: base,
                      onPrice: (px) => {
                        setOrderStyle("limit");
                        setLimit(px.toFixed(4));
                      },
                      onSize: (margin) => {
                        setSizePct(0);
                        setMargin(margin.toFixed(2));
                      },
                      onTake: (book, quote) => {
                        const px = quote.price > 0n ? Number(formatUnits(quote.price, 18)) : 0;
                        if (!withinSlip(px, [markN, settle], slipBps)) {
                          setBad(true);
                          setNote(
                            lang === "zh"
                              ? "这张单离标记价太远，没有吃。把滑点放到不限再点一次。"
                              : "That quote is too far from the mark. Set slippage to none and tap again.",
                          );
                          return;
                        }
                        run((from) =>
                          takePerp(
                            from,
                            book,
                            quote.id,
                            formatUnits(quote.margin, dec),
                            quote.lev,
                            quote.price > 0n,
                          ),
                        );
                      },
                      onCancel: (book, quote) =>
                        run((from) => cancelPerp(from, book, quote.id), "cancel"),
                    }),

                  ],
                }),
                /* @__PURE__ */ jsxs("div", {
                  className:
                    "ph-ticket perp-ticket order-2 flex min-w-0 flex-col gap-3 self-stretch border-t border-gold p-3 xl:sticky xl:top-14 xl:order-3 xl:max-h-[calc(100dvh-4.5rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain xl:border-t-0 xl:border-l",
                  children: [
                    /* @__PURE__ */ jsxs("div", {
                      className: "hl-modes grid grid-cols-3 gap-1 text-xs",
                      children: [
                        /* @__PURE__ */ jsx("button", {
                          type: "button",
                          onClick: () => setProOpen(true),
                          className: "h-8 xl:hidden",
                          children:
                            orderStyle === "market"
                              ? lang === "zh"
                                ? "市价"
                                : "Market"
                              : orderStyle === "limit"
                                ? lang === "zh"
                                  ? "限价"
                                  : "Limit"
                                : proLabel,
                        }),
                        /* @__PURE__ */ jsx("button", {
                          type: "button",
                          onClick: () => setMarginOpen(true),
                          className: "h-8 border border-gold/50",
                          children:
                            marginMode === "cross"
                              ? lang === "zh"
                                ? "全仓"
                                : "Cross"
                              : lang === "zh"
                                ? "逐仓"
                                : "Isolated",
                        }),
                        /* @__PURE__ */ jsxs("button", {
                          type: "button",
                          onClick: () => setLevOpen(true),
                          className: "lev-chip h-8 border border-up/40 font-mono",
                          children: [lev, "×"],
                        }),
                        /* @__PURE__ */ jsx("button", {
                          type: "button",
                          onClick: () => setAcctOpen(true),
                          className: "hidden h-8 border border-gold/50 xl:block",
                          children:
                            acctMode === "unified"
                              ? lang === "zh"
                                ? "统一"
                                : "Unified"
                              : acctMode === "port"
                                ? lang === "zh"
                                  ? "组合"
                                  : "Portfolio"
                                : lang === "zh"
                                  ? "手动"
                                  : "Manual",
                        }),
                      ],
                    }),
                    view?.liveDeals?.length
                      ? /* @__PURE__ */ jsxs("div", {
                          className: "hidden",
                          children: [
                            /* @__PURE__ */ jsxs("div", {
                              className: "flex items-center gap-2",
                              children: [
                                /* @__PURE__ */ jsx("p", {
                                  className: "text-xs tracking-widest text-gold",
                                  children: c.pkTitle,
                                }),
                                account &&
                                view.liveDeals.some(
                                  (deal) =>
                                    deal.long.toLowerCase() === account.toLowerCase() ||
                                    deal.short.toLowerCase() === account.toLowerCase(),
                                )
                                  ? /* @__PURE__ */ jsx("button", {
                                      type: "button",
                                      className:
                                        "ml-auto h-7 border border-sell px-2 text-[11px] text-sell",
                                      disabled: busy,
                                      onClick: () =>
                                        run(async (from) => {
                                          const mine = view.liveDeals.filter(
                                            (deal) =>
                                              deal.long.toLowerCase() === from.toLowerCase() ||
                                              deal.short.toLowerCase() === from.toLowerCase(),
                                          );
                                          let last;
                                          for (const deal of mine)
                                            last = await closePerp(from, perp, deal.id);
                                          return last;
                                        }),
                                      children: lang === "zh" ? "全平" : "Close all",
                                    })
                                  : null,
                              ],
                            }),
                            /* @__PURE__ */ jsx("div", {
                              className: "mt-2 flex flex-col gap-2",
                              children: view.liveDeals.map((deal) => {
                                const mineLong = Boolean(
                                  account && deal.long.toLowerCase() === account.toLowerCase(),
                                );
                                const mineShort = Boolean(
                                  account && deal.short.toLowerCase() === account.toLowerCase(),
                                );
                                const mineDeal = mineLong || mineShort;
                                const pnl = mineLong
                                  ? deal.eqL - deal.marginL
                                  : deal.eqS - deal.marginS;
                                const ahead =
                                  deal.eqL === deal.eqS
                                    ? c.pkFlat
                                    : deal.eqL > deal.eqS
                                      ? `${c.pkLong}${c.pkLead}`
                                      : `${c.pkShort}${c.pkLead}`;
                                return /* @__PURE__ */ jsxs(
                                  "div",
                                  {
                                    className: "border border-gold/30 px-2 py-2 text-sm",
                                    children: [
                                      /* @__PURE__ */ jsxs("p", {
                                        className: "break-all font-mono text-xs text-[#1b6b45]",
                                        children: [
                                          c.pkLong,
                                          " ",
                                          named(deal.long),
                                          mineLong ? (lang === "zh" ? " · 我的" : " · mine") : "",
                                          " · ",
                                          usdtText(deal.eqL),
                                        ],
                                      }),
                                      /* @__PURE__ */ jsxs("p", {
                                        className: "break-all font-mono text-xs text-sell",
                                        children: [
                                          c.pkShort,
                                          " ",
                                          named(deal.short),
                                          mineShort ? (lang === "zh" ? " · 我的" : " · mine") : "",
                                          " · ",
                                          usdtText(deal.eqS),
                                        ],
                                      }),
                                      /* @__PURE__ */ jsxs("p", {
                                        className: "mt-1",
                                        children: [
                                          ahead,
                                          " · ",
                                          pxText(deal.entry),
                                          " → ",
                                          markN > 0 ? markN.toFixed(4) : "—",
                                        ],
                                      }),
                                      mineDeal && prefs.showPnl
                                        ? /* @__PURE__ */ jsxs("p", {
                                            className: `mt-1 font-mono ${pnl >= 0n ? "text-gold" : "text-sell"}`,
                                            children: [
                                              c.pnl,
                                              " ",
                                              pnl >= 0n ? "+" : "",
                                              pretty(pnl, dec, 4),
                                              " USDT",
                                            ],
                                          })
                                        : null,
                                      mineDeal
                                        ? /* @__PURE__ */ jsxs("div", {
                                            className: "mt-2 flex gap-2",
                                            children: [
                                              /* @__PURE__ */ jsx("button", {
                                                type: "button",
                                                className: "min-h-11 bg-ink px-3 text-paper",
                                                disabled: busy,
                                                onClick: () =>
                                                  run(
                                                    (from) => closePerp(from, perp, deal.id),
                                                    "close",
                                                  ),
                                                children: c.closeDeal,
                                              }),
                                              /* @__PURE__ */ jsx("button", {
                                                type: "button",
                                                className: "min-h-11 border border-gold px-3",
                                                disabled: busy || !(markN > 0),
                                                onClick: () =>
                                                  run(async (from) => {
                                                    await closePerp(from, perp, deal.id);
                                                    const sideMargin = formatUnits(
                                                      mineLong ? deal.marginL : deal.marginS,
                                                      dec,
                                                    );
                                                    const sideLev = mineLong
                                                      ? deal.levL
                                                      : deal.levS;
                                                    return openPerp(
                                                      from,
                                                      perp,
                                                      !mineLong,
                                                      sideMargin,
                                                      sideLev || lev,
                                                      markN.toFixed(4),
                                                    );
                                                  }, "reverse"),
                                                children: lang === "zh" ? "反手" : "Reverse",
                                              }),
                                              /* @__PURE__ */ jsx("button", {
                                                type: "button",
                                                className: "min-h-11 border border-gold px-3",
                                                disabled: !account,
                                                onClick: () => {
                                                  if (!account) return;
                                                  const entry = Number(formatUnits(deal.entry, 18));
                                                  if (!(entry > 0)) return;
                                                  const band = easyBand(
                                                    entry,
                                                    (mineLong ? deal.levL : deal.levS) || 1,
                                                    mineLong,
                                                  );
                                                  const next = {
                                                    account,
                                                    perp,
                                                    long: mineLong,
                                                    tp: band.tp,
                                                    sl: band.sl,
                                                    spent: false,
                                                    hold: false,
                                                    deal: deal.id.toString(),
                                                  };
                                                  writeArm(next);
                                                  setArm(next);
                                                  setBad(false);
                                                  setNote(
                                                    lang === "zh"
                                                      ? "止盈止损画在图上。页面开着才会平仓。"
                                                      : "Take profit and stop are on the chart. They close while the page is open.",
                                                  );
                                                },
                                                children: lang === "zh" ? "保护" : "Protect",
                                              }),
                                            ],
                                          })
                                        : null,
                                      deal.weakL || deal.weakS
                                        ? /* @__PURE__ */ jsx("button", {
                                            type: "button",
                                            className:
                                              "mt-2 min-h-11 border border-sell px-3 text-sell",
                                            disabled: busy,
                                            onClick: () =>
                                              run((from) => liquidatePerp(from, perp, deal.id)),
                                            children: c.liqNow,
                                          })
                                        : null,
                                    ],
                                  },
                                  String(deal.id),
                                );
                              }),
                            }),
                          ],
                        })
                      : null,
                    /^0x[a-fA-F0-9]{40}$/.test(perp) &&
                      /* @__PURE__ */ jsxs("div", {
                        className: "flex min-h-0 flex-1 flex-col gap-2",
                        children: [
                          waiting
                            ? /* @__PURE__ */ jsx("p", { className: "hidden" })
                            : null,
                          inDeal && !view?.book
                            ? /* @__PURE__ */ jsx("div", { className: "hidden" })
                            : null,
                          false
                            ? /* @__PURE__ */ jsxs(Fragment, {
                                children: [
                                  /* @__PURE__ */ jsxs("div", {
                                    className: "hidden grid-cols-2 gap-2 xl:grid",
                                    children: [
                                      /* @__PURE__ */ jsx("button", {
                                        type: "button",
                                        onClick: () => setSheet("book"),
                                        className: `min-h-11 border border-gold ${sheet === "book" ? "bg-ink text-paper" : ""}`,
                                        children: c.bookMarket,
                                      }),
                                      /* @__PURE__ */ jsx("button", {
                                        type: "button",
                                        onClick: () => setSheet("mine"),
                                        className: `min-h-11 border border-gold ${sheet === "mine" ? "bg-ink text-paper" : ""}`,
                                        children: c.myOrders,
                                      }),
                                    ],
                                  }),
                                  sheet === "mine"
                                    ? /* @__PURE__ */ jsxs(Fragment, {
                                        children: [
                                          view.quotes.filter(
                                            (quote) =>
                                              account &&
                                              quote.user?.toLowerCase() === account.toLowerCase(),
                                          ).length === 0
                                            ? /* @__PURE__ */ jsx("p", {
                                                className: "text-sm text-ink/60",
                                                children:
                                                  lang === "zh"
                                                    ? "你还没有未成交的挂单。"
                                                    : "You have no resting quote.",
                                              })
                                            : null,
                                          view.quotes
                                            .filter(
                                              (quote) =>
                                                account &&
                                                quote.user?.toLowerCase() === account.toLowerCase(),
                                            )
                                            .map((quote) =>
                                              /* @__PURE__ */ jsxs(
                                                "div",
                                                {
                                                  className: "border border-gold/40 px-2 py-2",
                                                  children: [
                                                    /* @__PURE__ */ jsxs("p", {
                                                      className: "font-mono text-sm",
                                                      children: [
                                                        "#",
                                                        quote.id.toString(),
                                                        " · ",
                                                        quote.long ? c.postLong : c.postShort,
                                                        " · ",
                                                        usdtText(quote.margin),
                                                        " USDT · ",
                                                        quote.lev,
                                                        "×",
                                                        quote.price > 0n
                                                          ? ` · $${pxText(quote.price)}`
                                                          : "",
                                                      ],
                                                    }),
                                                    /* @__PURE__ */ jsx("p", {
                                                      className:
                                                        "mt-1 font-mono text-xs text-ink/70",
                                                      children: c.openPnl,
                                                    }),
                                                    /* @__PURE__ */ jsx("button", {
                                                      type: "button",
                                                      className:
                                                        "mt-2 min-h-11 border border-gold px-3",
                                                      disabled: busy,
                                                      onClick: () =>
                                                        run(
                                                          (from) =>
                                                            cancelPerp(from, perp, quote.id),
                                                          "cancel",
                                                        ),
                                                      children: c.cancelPost,
                                                    }),
                                                  ],
                                                },
                                                String(quote.id),
                                              ),
                                            ),
                                        ],
                                      })
                                    : null,
                                ],
                              })
                            : null,
                          true
                            ? /* @__PURE__ */ jsxs(Fragment, {
                                children: [
                                  <>
                                    <div className="hidden">
                                      <button
                                        type="button"
                                        onClick={() => setProOpen((on) => !on)}
                                        className="flex h-9 items-center justify-center gap-1 border border-gold/40 text-sm"
                                      >
                                        {orderStyle === "market"
                                          ? lang === "zh"
                                            ? "市价"
                                            : "Market"
                                          : orderStyle === "limit"
                                            ? lang === "zh"
                                              ? "限价"
                                              : "Limit"
                                            : proLabel}
                                        <PairChevron up={proOpen} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setMarginOpen(true)}
                                        className="h-9 border border-gold/40 text-sm"
                                      >
                                        {marginMode === "cross"
                                          ? lang === "zh"
                                            ? "全仓"
                                            : "Cross"
                                          : lang === "zh"
                                            ? "逐仓"
                                            : "Isolated"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setLevOpen(true)}
                                        className="h-9 border border-up/40 font-mono text-sm"
                                      >
                                        {lev}×
                                      </button>
                                    </div>
                                    {proOpen ? (
                                      <div
                                        className="fixed inset-0 z-50 xl:hidden"
                                        onClick={() => setProOpen(false)}
                                      >
                                        <div
                                          className="sheet-up absolute inset-x-0 bottom-0 max-h-[78dvh] overflow-auto border-t border-gold bg-card px-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
                                          onClick={(event) => event.stopPropagation()}
                                        >
                                          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-ink/20" />
                                          <div className="mb-2 flex items-center">
                                            <p className="text-sm">
                                              {lang === "zh" ? "订单类型" : "Order type"}
                                            </p>
                                            <button
                                              type="button"
                                              className="ml-auto px-2 text-lg"
                                              onClick={() => setProOpen(false)}
                                            >
                                              ×
                                            </button>
                                          </div>
                                          {(
                                            [
                                              ["market", "市价", "Market", "按当前标记价挂出"],
                                              ["limit", "限价", "Limit", "到了你填的价格才挂出"],
                                              ["scale", "分段订单", "Scale", "在两个价格之间拆开"],
                                              [
                                                "stop",
                                                "止损市价",
                                                "Stop",
                                                "标记价碰到触发价才挂出",
                                              ],
                                              ["post", "只挂", "Post", "会立刻成交的价格不挂"],
                                              [
                                                "trail",
                                                "移动止损",
                                                "Trail",
                                                "从最好的价格回撤后再平",
                                              ],
                                              ["twap", "TWAP", "TWAP", "按间隔拆成几笔"],
                                            ] as const
                                          ).map(([id, zhLabel, enLabel, hint]) => (
                                            <button
                                              key={id}
                                              type="button"
                                              onClick={() => {
                                                setOrderStyle(id);
                                                setProOpen(false);
                                              }}
                                              className={`flex w-full flex-col py-2 text-left ${orderStyle === id ? "text-up" : ""}`}
                                            >
                                              <span className="text-sm">
                                                {lang === "zh" ? zhLabel : enLabel}
                                              </span>
                                              <span className="text-[11px] text-ink/45">
                                                {hint}
                                              </span>
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                    <div className="relative hidden items-end gap-5 border-b border-gold/30 pb-2 text-sm xl:flex">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOrderStyle("market");
                                          setProOpen(false);
                                        }}
                                        className={
                                          orderStyle === "market" ? "tab-on" : "text-ink/45"
                                        }
                                      >
                                        {lang === "zh" ? "市价" : "Market"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOrderStyle("limit");
                                          setProOpen(false);
                                        }}
                                        className={
                                          orderStyle === "limit" ? "tab-on" : "text-ink/45"
                                        }
                                      >
                                        {lang === "zh" ? "限价" : "Limit"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setProOpen((on) => !on)}
                                        className={`inline-flex items-center gap-1 ${proOn ? "tab-on" : "text-ink/45"}`}
                                      >
                                        {proLabel}
                                        <PairChevron up={proOpen} />
                                      </button>
                                      {proOpen ? (
                                        <div className="pop-in absolute right-0 top-full z-20 mt-1 w-40 border border-gold bg-card py-1 shadow-plate">
                                          {(
                                            [
                                              ["chase", "追价", "Chase"],
                                              ["scale", "分段订单", "Scale"],
                                              ["stop", "止损市价", "Stop market"],
                                              ["post", "只挂", "Post only"],
                                              ["trail", "移动止损", "Trailing"],
                                              ["twap", "TWAP", "TWAP"],
                                            ] as const
                                          ).map(([id, zhLabel, enLabel]) => (
                                            <button
                                              key={id}
                                              type="button"
                                              onClick={() => {
                                                setOrderStyle(id);
                                                setProOpen(false);
                                              }}
                                              className={`block h-9 w-full px-3 text-left text-sm hover:bg-white/5 ${orderStyle === id ? "text-up" : ""}`}
                                            >
                                              {lang === "zh" ? zhLabel : enLabel}
                                            </button>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <button
                                        type="button"
                                        onClick={() => setIntent("long")}
                                        className={`h-10 text-sm ${intent === "long" ? "hl-buy" : "hl-buy off"}`}
                                      >
                                        {lang === "zh" ? "买入 / 做多" : "Buy / Long"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setIntent("short")}
                                        className={`h-10 text-sm ${intent === "short" ? "hl-sell" : "hl-sell off"}`}
                                      >
                                        {lang === "zh" ? "卖出 / 做空" : "Sell / Short"}
                                      </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-y-0.5 font-mono text-[12px]">
                                      <span className="text-ink/45">
                                        {lang === "zh" ? "可用" : "Available"}
                                      </span>
                                      <span className="text-right">
                                        {bal ? pretty(bal.usdt, dec, 2) : "—"}{" "}
                                        {chain === "xlayer" ? "USDT0" : "USDT"}
                                      </span>
                                      <span className="text-ink/45">
                                        {lang === "zh" ? "当前仓位" : "Position"}
                                      </span>
                                      <span className="text-right">
                                        {posSize ? posSize.toFixed(4) : "0.00"} {base}
                                      </span>
                                    </div>
                                    {orderStyle === "market" || orderStyle === "chase" ? (
                                      <p className="hl-field font-mono text-sm">
                                        <span className="shrink-0 text-[11px] text-ink/45">
                                          {lang === "zh" ? "价格" : "Price"}
                                        </span>
                                        <span className="ml-auto">
                                          {markN > 0 ? pxTextN(markN) : "—"}
                                          <span className="ml-2 text-[11px] text-ink/40">Mid</span>
                                        </span>
                                      </p>
                                    ) : null}
                                    {orderStyle === "limit" || orderStyle === "post" ? (
                                      <label className="relative flex items-center gap-2 border border-gold/40 px-3 py-2">
                                        <span className="shrink-0 text-[11px] text-ink/45">
                                          {lang === "zh" ? "价格" : "Price"}
                                        </span>
                                        <input
                                          value={limit}
                                          onChange={(event) => setLimit(event.target.value)}
                                          inputMode="decimal"
                                          className="w-full bg-transparent font-mono text-base outline-none"
                                        />
                                        {!limit.trim() ? (
                                          <span className="pointer-events-none absolute inset-y-0 right-2 flex max-w-[70%] items-center truncate font-mono text-[11px] text-ink/40">
                                            {lang === "zh" ? "输入限价" : "Limit"}
                                            {markN > 0 ? ` ${markN.toFixed(4)}` : ""}
                                          </span>
                                        ) : null}
                                      </label>
                                    ) : null}
                                    {orderStyle === "trail" ? (
                                      <label className="block border border-gold/40 px-3 py-2">
                                        <span className="block text-[11px] text-ink/45">
                                          {lang === "zh" ? "回撤 %" : "Retrace %"}
                                        </span>
                                        <input
                                          value={trailPct}
                                          onChange={(event) => setTrailPct(event.target.value)}
                                          inputMode="decimal"
                                          className="w-full bg-transparent font-mono text-xl outline-none"
                                        />
                                      </label>
                                    ) : null}
                                    {orderStyle === "stop" ? (
                                      <label className="block border border-gold/40 px-3 py-2">
                                        <span className="block text-[11px] text-ink/45">
                                          {lang === "zh" ? "触发价" : "Trigger"}
                                        </span>
                                        <input
                                          value={stopPx}
                                          onChange={(event) => setStopPx(event.target.value)}
                                          inputMode="decimal"
                                          placeholder={lang === "zh" ? "输入触发价" : "Trigger"}
                                          className="w-full bg-transparent font-mono text-xl outline-none placeholder:text-ink/35"
                                        />
                                      </label>
                                    ) : null}
                                    {orderStyle === "scale" ? (
                                      <div className="grid grid-cols-3 gap-1">
                                        <input
                                          value={scaleA}
                                          onChange={(event) => setScaleA(event.target.value)}
                                          inputMode="decimal"
                                          placeholder={lang === "zh" ? "起" : "From"}
                                          className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none"
                                        />
                                        <input
                                          value={scaleB}
                                          onChange={(event) => setScaleB(event.target.value)}
                                          inputMode="decimal"
                                          placeholder={lang === "zh" ? "止" : "To"}
                                          className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none"
                                        />
                                        <input
                                          value={String(scaleN)}
                                          onChange={(event) =>
                                            setScaleN(
                                              Math.min(
                                                5,
                                                Math.max(2, Number(event.target.value) || 2),
                                              ),
                                            )
                                          }
                                          inputMode="numeric"
                                          className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none"
                                        />
                                      </div>
                                    ) : null}
                                    {orderStyle === "twap" ? (
                                      <div className="grid grid-cols-2 gap-1">
                                        <input
                                          value={String(twapN)}
                                          onChange={(event) =>
                                            setTwapN(
                                              Math.min(
                                                12,
                                                Math.max(2, Number(event.target.value) || 2),
                                              ),
                                            )
                                          }
                                          inputMode="numeric"
                                          className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none"
                                        />
                                        <input
                                          value={String(twapGap)}
                                          onChange={(event) =>
                                            setTwapGap(
                                              Math.max(30, Number(event.target.value) || 30),
                                            )
                                          }
                                          inputMode="numeric"
                                          className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none"
                                        />
                                      </div>
                                    ) : null}
                                    <label className="flex items-center gap-2 border border-gold/40 px-3 py-2">
                                      <span className="shrink-0 text-[11px] text-ink/45">
                                        {lang === "zh" ? "数量" : "Size"}
                                      </span>
                                      <input
                                        value={margin}
                                        onChange={(event) => {
                                          setSizePct(0);
                                          setMargin(event.target.value);
                                        }}
                                        inputMode="decimal"
                                        placeholder={lang === "zh" ? "保证金" : "Margin"}
                                        className="w-full bg-transparent font-mono text-base outline-none placeholder:text-ink/35"
                                      />
                                      <span className="shrink-0 font-mono text-xs text-ink/55">
                                        {chain === "xlayer" ? "USDT0" : "USDT"}
                                      </span>
                                    </label>
                                    <div className="hidden">
                                      {[25, 50, 75, 100].map((pct) => (
                                        <button
                                          key={pct}
                                          type="button"
                                          onClick={() => fillMargin(pct)}
                                          className={`h-8 border font-mono text-xs ${sizePct === pct ? "border-transparent bg-ink" : "border-gold/40 text-ink/70"}`}
                                        >
                                          {pct}%
                                        </button>
                                      ))}
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="range"
                                        min={0}
                                        max={100}
                                        value={sizePct}
                                        onChange={(event) => fillMargin(Number(event.target.value))}
                                        className="touch-range w-full"
                                      />
                                      <span className="w-10 shrink-0 text-right font-mono text-xs">
                                        {sizePct}%
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-ink/70">
                                      <label className="flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={reduceOnly}
                                          onChange={() => setReduceOnly((on) => !on)}
                                        />
                                        {lang === "zh" ? "只减仓" : "Reduce only"}
                                      </label>
                                      <span className="font-mono text-ink/45">GTC</span>
                                      <label className="ml-auto flex items-center gap-2">
                                        <input
                                          type="checkbox"
                                          checked={ticketMore}
                                          onChange={() => setTicketMore((on) => !on)}
                                        />
                                        {lang === "zh" ? "止盈/止损" : "TP / SL"}
                                      </label>
                                    </div>
                                    <div className="hidden">
                                      {[10, 50, 100, 0].map((bps) => (
                                        <button
                                          key={bps}
                                          type="button"
                                          onClick={() => setSlipBps(bps)}
                                          className={`h-8 font-mono text-[11px] ${slipBps === bps ? "bg-ink" : "border border-gold/40 text-ink/70"}`}
                                        >
                                          {bps === 0
                                            ? lang === "zh"
                                              ? "滑点关"
                                              : "Slip off"
                                            : `${bps / 100}%`}
                                        </button>
                                      ))}
                                    </div>
                                  </>,
                                  ticketMore
                                    ? /* @__PURE__ */ jsxs("div", {
                                        className: "border border-gold/40 p-3",
                                        children: [
                                          /* @__PURE__ */ jsx("div", {
                                            className: "grid grid-cols-3 gap-2",
                                            children: ["easy", "pro", "off"].map((item) =>
                                              /* @__PURE__ */ jsx(
                                                "button",
                                                {
                                                  type: "button",
                                                  onClick: () => setGuard(item),
                                                  className: `min-h-11 border border-gold text-sm ${guard === item ? "bg-ink text-paper" : ""}`,
                                                  children:
                                                    item === "easy"
                                                      ? c.stopEasy
                                                      : item === "pro"
                                                        ? c.stopPro
                                                        : c.stopClear,
                                                },
                                                item,
                                              ),
                                            ),
                                          }),
                                          guard === "pro"
                                            ? /* @__PURE__ */ jsxs(Fragment, {
                                                children: [
                                                  /* @__PURE__ */ jsxs("div", {
                                                    className: "mt-2 grid grid-cols-2 gap-2",
                                                    children: [
                                                      /* @__PURE__ */ jsxs("label", {
                                                        className:
                                                          "border border-gold/40 px-2 py-2",
                                                        children: [
                                                          /* @__PURE__ */ jsx("span", {
                                                            className:
                                                              "block text-xs tracking-widest text-gold",
                                                            children: c.stopTp,
                                                          }),
                                                          /* @__PURE__ */ jsx("input", {
                                                            value: tpText,
                                                            onChange: (event) =>
                                                              setTpText(event.target.value),
                                                            inputMode: "decimal",
                                                            placeholder:
                                                              lang === "zh"
                                                                ? "止盈价格"
                                                                : "Take profit",
                                                            className:
                                                              "w-full bg-transparent font-mono text-xl outline-none placeholder:text-ink/35",
                                                          }),
                                                        ],
                                                      }),
                                                      /* @__PURE__ */ jsxs("label", {
                                                        className:
                                                          "border border-gold/40 px-2 py-2",
                                                        children: [
                                                          /* @__PURE__ */ jsx("span", {
                                                            className:
                                                              "block text-xs tracking-widest text-gold",
                                                            children: c.stopSl,
                                                          }),
                                                          /* @__PURE__ */ jsx("input", {
                                                            value: slText,
                                                            onChange: (event) =>
                                                              setSlText(event.target.value),
                                                            inputMode: "decimal",
                                                            placeholder:
                                                              lang === "zh"
                                                                ? "止损价格"
                                                                : "Stop loss",
                                                            className:
                                                              "w-full bg-transparent font-mono text-xl outline-none placeholder:text-ink/35",
                                                          }),
                                                        ],
                                                      }),
                                                    ],
                                                  }),
                                                  /* @__PURE__ */ jsx(StopReadout, {
                                                    lang,
                                                    entry: Number(limit) || markN,
                                                    usedMark: !(Number(limit) > 0),
                                                    tp: Number(tpText),
                                                    sl: Number(slText),
                                                    margin: Number(margin),
                                                    lev,
                                                    unit: chain === "xlayer" ? "USDT0" : "USDT",
                                                  }),
                                                ],
                                              })
                                            : null,
                                          guard === "easy" && (Number(limit) || markN) > 0
                                            ? /* @__PURE__ */ jsxs("div", {
                                                className: "mt-2 flex flex-col gap-1 font-mono text-sm tabular-nums",
                                                children: [
                                                  ["long", true],
                                                  ["short", false],
                                                ].map(([key, side]) => {
                                                  const entry = Number(limit) || markN;
                                                  const band = easyBand(entry, lev || 1, side === true);
                                                  const px = (n) => (n >= 100 ? n.toFixed(2) : n.toFixed(4));
                                                  const on = (side === true) === (intent === "long");
                                                  return /* @__PURE__ */ jsxs(
                                                    "p",
                                                    {
                                                      className: on ? "" : "text-ink/45",
                                                      children: [
                                                        side === true
                                                          ? lang === "zh"
                                                            ? "做多"
                                                            : "Long"
                                                          : lang === "zh"
                                                            ? "做空"
                                                            : "Short",
                                                        " ",
                                                        c.stopTp,
                                                        " ",
                                                        px(band.tp),
                                                        " · ",
                                                        c.stopSl,
                                                        " ",
                                                        px(band.sl),
                                                      ],
                                                    },
                                                    String(key),
                                                  );
                                                }),
                                              })
                                            : null,
                                          arm && !arm.spent
                                            ? /* @__PURE__ */ jsxs("p", {
                                                className: "mt-2 font-mono text-sm",
                                                children: [
                                                  arm.hold
                                                    ? lang === "zh"
                                                      ? "上次没平掉。保护还在，不会自动再弹钱包。"
                                                      : "The last close did not finish. The stop stays, and the wallet will not pop by itself."
                                                    : c.stopArmed,
                                                  " · ",
                                                  c.stopTp,
                                                  " $",
                                                  arm.tp.toFixed(2),
                                                  " · ",
                                                  c.stopSl,
                                                  " $",
                                                  arm.sl.toFixed(2),
                                                  arm.hold
                                                    ? /* @__PURE__ */ jsx("button", {
                                                        type: "button",
                                                        className: "ml-2 underline",
                                                        onClick: () => {
                                                          const next = {
                                                            ...arm,
                                                            hold: false,
                                                            spent: false,
                                                          };
                                                          writeArm(next);
                                                          setArm(next);
                                                        },
                                                        children:
                                                          lang === "zh" ? "再试一次" : "Try again",
                                                      })
                                                    : null,
                                                  /* @__PURE__ */ jsx("button", {
                                                    type: "button",
                                                    className: "ml-2 underline",
                                                    onClick: () => {
                                                      if (account) {
                                                        clearArm(account, perp);
                                                        setArm(null);
                                                      }
                                                    },
                                                    children: c.stopClear,
                                                  }),
                                                ],
                                              })
                                            : null,
                                        ],
                                      })
                                    : null,
                                  <div className="grid grid-cols-2 gap-y-1 font-mono text-[11px]">
                                    <span className="ph-stat text-ink/45">
                                      {lang === "zh" ? "可用" : "Available"}
                                    </span>
                                    <span className="ph-stat text-right">
                                      {bal ? pretty(bal.usdt, dec, 2) : "—"}{" "}
                                      {chain === "xlayer" ? "USDT0" : "USDT"}
                                    </span>
                                    <span className="ph-stat text-ink/45">
                                      {lang === "zh" ? "可开多" : "Can long"}
                                    </span>
                                    <span className="ph-stat text-right">
                                      {roomText} {base}
                                    </span>
                                    <span className="ph-stat text-ink/45">
                                      {lang === "zh" ? "可开空" : "Can short"}
                                    </span>
                                    <span className="ph-stat text-right">
                                      {roomText} {base}
                                    </span>
                                    <span className="ph-stat text-ink/45">
                                      {lang === "zh" ? "可平" : "Can close"}
                                    </span>
                                    <span className="ph-stat text-right">
                                      {posSize ? posSize.toFixed(4) : "0.00"} {base}
                                    </span>
                                    <span className="ph-stat text-ink/45">
                                      {lang === "zh" ? "当前仓位" : "Position"}
                                    </span>
                                    <span className="ph-stat text-right">
                                      {posSize ? posSize.toFixed(4) : "0.00"} {base}
                                    </span>
                                    <span className="text-ink/45">
                                      {lang === "zh" ? "强平价格" : "Liq. price"}
                                    </span>
                                    <span className="text-right">
                                      {planned.liq > 0
                                        ? planned.liq.toFixed(4)
                                        : liqN > 0
                                          ? liqN.toFixed(4)
                                          : quoteLiq > 0
                                            ? quoteLiq.toFixed(4)
                                            : "—"}
                                    </span>
                                    <span className="text-ink/45">
                                      {lang === "zh" ? "订单价值" : "Order value"}
                                    </span>
                                    <span className="text-right">
                                      {planned.net === "close"
                                        ? "0"
                                        : planned.lock > 0 && planned.lev > 0
                                          ? (planned.lock * planned.lev).toFixed(2)
                                          : ticket
                                            ? ticket.notional.toFixed(2)
                                            : "—"}
                                    </span>
                                    <span className="text-ink/45">
                                      {lang === "zh" ? "所需保证金" : "Margin"}
                                    </span>
                                    <span className="text-right">
                                      {planned.net === "close"
                                        ? "0"
                                        : planned.lock > 0
                                          ? planned.lock.toFixed(2)
                                          : marginOk
                                            ? margin
                                            : "—"}
                                    </span>
                                    <span className="text-ink/45">
                                      {lang === "zh" ? "费用" : "Fee"}
                                    </span>
                                    <span className="text-right">0.20% / 0.20%</span>
                                    <span className="text-ink/45">
                                      {lang === "zh" ? "滑点" : "Slippage"}
                                    </span>
                                    <span className="text-right">
                                      Est {slipBps === 0 ? "0%" : `${(slipBps / 100).toFixed(2)}%`}{" "}
                                      / Max 8.00%
                                    </span>
                                  </div>,
                                  !levOk || !marginOk
                                    ? /* @__PURE__ */ jsx("p", {
                                        className: "desk-extra",
                                        children: !levOk ? c.levCap : `${floor}–500 USDT`,
                                      })
                                    : null,
                                  !priceOk
                                    ? /* @__PURE__ */ jsx("p", {
                                        className: "desk-extra",
                                        children: c.badPrice,
                                      })
                                    : null,
                                  usdtShort
                                    ? /* @__PURE__ */ jsx("p", {
                                        className: "text-xs leading-snug text-sell",
                                        children: shortLine,
                                      })
                                    : null,
                                  <button
                                    type="button"
                                    className={`min-h-11 w-full text-sm ${intent === "short" ? "hl-sell" : "hl-buy"}`}
                                    disabled={
                                      busy ||
                                      (!canDeploy &&
                                        !markFar &&
                                        (feeBlocked ||
                                          !levOk ||
                                          !marginOk ||
                                          !priceOk ||
                                          (!alt && !view?.priced && !(markN > 0))))
                                    }
                                    onClick={() => {
                                      if (markFar) {
                                        run((from) => pokeBook(from, perp));
                                        return;
                                      }
                                      if (canDeploy) {
                                        run(async (from) => {
                                          const { book, hash } = await deployCoin(from, coin);
                                          setPerp(book);
                                          queueMicrotask(() => {
                                            setBad(false);
                                            setNote(
                                              lang === "zh"
                                                ? `已部署 ${book}。把这行地址发我，写进页面之后别人用的才是这一份。`
                                                : `Deployed ${book}. Send this address so the page uses it for everyone.`,
                                            );
                                          });
                                          return hash;
                                        });
                                        return;
                                      }
                                      if (planned.net === "reject") {
                                        setBad(true);
                                        setNote(
                                          lang === "zh"
                                            ? "组合保证金不能只减一截。数量要盖住现在的反向仓，或改回手动。"
                                            : "Portfolio margin cannot shrink part of a position. Cover the opposite side, or switch to manual.",
                                        );
                                        return;
                                      }
                                      if (alt) {
                                        setBad(true);
                                        setNote(
                                          lang === "zh"
                                            ? "这一张还没有结算合约，签名不会发出。"
                                            : "This contract has no settlement book, so nothing is signed.",
                                        );
                                        return;
                                      }
                                      if (usdtShort) {
                                        setBad(true);
                                        setNote(shortLine);
                                        return;
                                      }
                                      setCard(intent);
                                    }}
                                  >
                                    {canDeploy
                                      ? lang === "zh"
                                        ? "部署合约"
                                        : "Deploy the book"
                                      : markFar
                                      ? lang === "zh"
                                        ? "对齐标记价"
                                        : "Match the mark"
                                      : waiting &&
                                    view &&
                                    (intent === "long" ? !view.pendingLong : view.pendingLong)
                                      ? c.pullQuote
                                      : intent === "long"
                                        ? lang === "zh"
                                          ? "买入 / 做多"
                                          : "Buy / Long"
                                        : lang === "zh"
                                          ? "卖出 / 做空"
                                          : "Sell / Short"}
                                  </button>,
                                  note
                                    ? /* @__PURE__ */ jsx("p", {
                                        className: `text-xs ${bad ? "text-sell" : "text-ink/70"}`,
                                        children: note,
                                      })
                                    : null,
                                  card
                                    ? /* @__PURE__ */ jsx(SignCard, {
                                        title: lang === "zh" ? "签名前看一眼" : "Before you sign",
                                        yes: lang === "zh" ? "确认并签名" : "Confirm and sign",
                                        no: lang === "zh" ? "取消" : "Cancel",
                                        auto: !prefs.orderConfirm,
                                        warn: modeWarn,
                                        onNo: () => setCard(null),
                                        onYes: () => {
                                          const long = card === "long";
                                          setCard(null);
                                          if (alt) {
                                            setBad(false);
                                            return;
                                          }
                                          run(async (from) => {
                                            const before =
                                              view?.myDeal && view.myDeal > 0n
                                                ? view.myDeal.toString()
                                                : "0";
                                            if (reduceOnly && orderStyle !== "stop") {
                                              if (!view?.myDeal) throw new Error("flat");
                                              return closePerp(from, perp, view.myDeal);
                                            }
                                            const px =
                                              orderStyle === "limit" || orderStyle === "post"
                                                ? limit.trim()
                                                : markN > 0
                                                  ? markN.toFixed(4)
                                                  : "";
                                            if (!reduceOnly && planned.net === "close") {
                                              if (!view?.myDeal) throw new Error("flat");
                                              return closePerp(from, perp, view.myDeal);
                                            }
                                            if (!reduceOnly && planned.net === "flip") {
                                              if (!view?.myDeal) throw new Error("flat");
                                              await closePerp(from, perp, view.myDeal);
                                            }
                                            const sendMargin =
                                              !reduceOnly && planned.lock > 0
                                                ? planned.lock.toFixed(2)
                                                : margin;
                                            if (
                                              !reduceOnly &&
                                              planned.net !== "close" &&
                                              orderStyle !== "trail" &&
                                              Number(sendMargin) > freeN + 0.009
                                            )
                                              throw new Error("usdt");
                                            const sendLev = !reduceOnly && planned.lev > 0 ? planned.lev : lev;
                                            let tx;
                                            if (orderStyle === "post")
                                              tx = await openPostPerp(
                                                from,
                                                perp,
                                                long,
                                                sendMargin,
                                                sendLev,
                                                px,
                                              );
                                            else if (orderStyle === "scale")
                                              tx = await openScalePerp(
                                                from,
                                                perp,
                                                long,
                                                sendMargin,
                                                sendLev,
                                                scaleA,
                                                scaleB,
                                                scaleN,
                                              );
                                            else if (orderStyle === "chase")
                                              tx = await openPostPerp(
                                                from,
                                                perp,
                                                long,
                                                sendMargin,
                                                sendLev,
                                                chasePx(long, markN, view?.quotes ?? []),
                                              );
                                            else if (orderStyle === "trail") {
                                              if (!view?.myDeal || !(markN > 0))
                                                throw new Error("flat");
                                              const dist = Number(trailPct) / 100;
                                              if (!(dist > 0 && dist < 0.5))
                                                throw new Error("price");
                                              try {
                                                tx = await armTrailPerp(
                                                  from,
                                                  perp,
                                                  view.myDeal,
                                                  Math.round(dist * 10000),
                                                );
                                              } catch (err) {
                                                if (
                                                  !(err instanceof Error) ||
                                                  err.message !== "local"
                                                )
                                                  throw err;
                                                writeArm({
                                                  account: from,
                                                  perp,
                                                  long: Boolean(view.long),
                                                  tp: 0,
                                                  sl: 0,
                                                  spent: false,
                                                  hold: false,
                                                  deal: view.myDeal.toString(),
                                                  trail: dist,
                                                  peak: markN,
                                                });
                                                setTimeout(
                                                  () =>
                                                    setNote(
                                                      lang === "zh"
                                                        ? "追踪记在这台浏览器。页面开着，回撤到了就平仓。"
                                                        : "The trail sits in this browser and closes while the page is open.",
                                                    ),
                                                  0,
                                                );
                                                return undefined;
                                              }
                                            } else if (orderStyle === "stop") {
                                              if (!reduceOnly) {
                                                try {
                                                  tx = await openStopPerp(
                                                    from,
                                                    perp,
                                                    long,
                                                    sendMargin,
                                                    sendLev,
                                                    stopPx,
                                                  );
                                                } catch (err) {
                                                  if (
                                                    !(err instanceof Error) ||
                                                    err.message !== "local"
                                                  )
                                                    throw err;
                                                }
                                              }
                                              if (!tx) {
                                                const trigger = Number(stopPx);
                                                if (!(trigger > 0)) throw new Error("price");
                                                writeArm({
                                                  account: from,
                                                  perp,
                                                  long,
                                                  tp: long ? trigger * 1.5 : trigger,
                                                  sl: long ? trigger : trigger * 1.5,
                                                  spent: false,
                                                  hold: false,
                                                  before,
                                                  deal: "",
                                                });
                                                setTimeout(
                                                  () =>
                                                    setNote(
                                                      lang === "zh"
                                                        ? "止损记在这台浏览器。页面开着才会平仓。"
                                                        : "This stop sits in this browser and closes while the page is open.",
                                                    ),
                                                  0,
                                                );
                                                return undefined;
                                              }
                                            } else if (orderStyle === "twap")
                                              tx = await openTwapPerp(
                                                from,
                                                perp,
                                                long,
                                                sendMargin,
                                                sendLev,
                                                twapN,
                                                twapGap,
                                              );
                                            else
                                              tx = await (async () => {
                                                const fresh = await readPerp(perp, from).catch(() => null);
                                                const book = fresh?.quotes?.length ? fresh.quotes : (view?.quotes ?? []);
                                                const mineAddr = from.toLowerCase();
                                                const other = book.filter(
                                                  (quote) =>
                                                    quote.open !== false &&
                                                    quote.long !== long &&
                                                    quote.price > 0n &&
                                                    quote.user?.toLowerCase() !== mineAddr,
                                                );
                                                const best = other.reduce<
                                                  (typeof other)[number] | null
                                                >((pick, quote) => {
                                                  if (!pick) return quote;
                                                  return long
                                                    ? quote.price < pick.price
                                                      ? quote
                                                      : pick
                                                    : quote.price > pick.price
                                                      ? quote
                                                      : pick;
                                                }, null);
                                                const limitPx = Number(limit);
                                                const want =
                                                  orderStyle === "limit" && limitPx > 0 ? limitPx : markN;
                                                if (best && want > 0 && orderStyle !== "post") {
                                                  const awayPx = Number(formatUnits(best.price, 18));
                                                  const crosses =
                                                    orderStyle === "limit"
                                                      ? long
                                                        ? want + 1e-8 >= awayPx
                                                        : want <= awayPx + 1e-8
                                                      : withinSlip(
                                                          awayPx,
                                                          [want, markN, settle].filter((n) => n > 0),
                                                          slipBps,
                                                        );
                                                  if (crosses && awayPx > 0)
                                                    return takePerp(
                                                      from,
                                                      perp,
                                                      best.id,
                                                      sendMargin,
                                                      sendLev,
                                                      true,
                                                    );
                                                }
                                                return openPerp(
                                                  from,
                                                  perp,
                                                  long,
                                                  sendMargin,
                                                  sendLev,
                                                  px,
                                                );
                                              })();
                                            if (guard !== "off") {
                                              const entry = Number(limit) || markN;
                                              const band =
                                                guard === "easy"
                                                  ? easyBand(entry, sendLev || 1, long)
                                                  : {
                                                      tp: Number(tpText),
                                                      sl: Number(slText),
                                                    };
                                              if (entry > 0 && band.tp > 0 && band.sl > 0) {
                                                const next = {
                                                  account: from,
                                                  perp,
                                                  long,
                                                  tp: band.tp,
                                                  sl: band.sl,
                                                  spent: false,
                                                  hold: false,
                                                  before,
                                                  deal: "",
                                                };
                                                writeArm(next);
                                                setArm(next);
                                              }
                                            }
                                            return tx;
                                          });
                                        },
                                        lines: [
                                          {
                                            k: lang === "zh" ? "保证金" : "Margin",
                                            v: `${margin || "—"} ${chain === "xlayer" ? "USDT0" : "USDT"} · ${lev || "—"}×`,
                                          },
                                          {
                                            k: lang === "zh" ? "本单手续费" : "Fee",
                                            v: `${marginOk ? (Number(margin) * 0.002).toFixed(4) : "—"} ${chain === "xlayer" ? "USDT0" : "USDT"}`,
                                          },
                                        ],
                                      })
                                    : null,
                                ],
                              })
                            : null,
                          mine
                            ? /* @__PURE__ */ jsx("button", {
                                type: "button",
                                className: "min-h-12 border border-gold",
                                disabled: busy,
                                onClick: () => run((from) => cancelPerp(from, perp), "cancel"),
                                children: c.cancelPost,
                              })
                            : null,
                          inDeal
                            ? /* @__PURE__ */ jsx("button", {
                                type: "button",
                                className: "min-h-12 bg-ink text-paper",
                                disabled: busy,
                                onClick: () =>
                                  run((from) =>
                                    closePerp(
                                      from,
                                      perp,
                                      view && view.myDeal > 0n ? view.myDeal : void 0,
                                    ),
                                  ),
                                children: c.closeDeal,
                              })
                            : null,
                          view?.underwater && account
                            ? /* @__PURE__ */ jsx("button", {
                                type: "button",
                                className: "min-h-12 border border-sell text-sell",
                                disabled: busy,
                                onClick: () => run((from) => liquidatePerp(from, perp, account)),
                                children: c.liqNow,
                              })
                            : null,
                          /* @__PURE__ */ jsxs("div", {
                            className: "ticket-well",
                            children: [
                              usdtShort
                                ? /* @__PURE__ */ jsx("p", {
                                    className: "text-xs leading-snug text-sell",
                                    children: shortLine,
                                  })
                                : null,
                              /* @__PURE__ */ jsxs("div", {
                                className: "grid grid-cols-3 gap-2 font-mono text-[11px]",
                                children: [
                                  /* @__PURE__ */ jsxs("p", {
                                    className: "flex flex-col gap-0.5",
                                    children: [
                                      /* @__PURE__ */ jsx("span", {
                                        className: "text-ink/40",
                                        children: lang === "zh" ? "标记" : "Mark",
                                      }),
                                      /* @__PURE__ */ jsx("span", {
                                        children: markN > 0 ? pxTextN(markN) : "—",
                                      }),
                                    ],
                                  }),
                                  /* @__PURE__ */ jsxs("p", {
                                    className: "flex flex-col gap-0.5",
                                    children: [
                                      /* @__PURE__ */ jsx("span", {
                                        className: "text-ink/40",
                                        children: lang === "zh" ? "强平" : "Liq",
                                      }),
                                      /* @__PURE__ */ jsx("span", {
                                        children:
                                          planned.liq > 0
                                            ? planned.liq.toFixed(4)
                                            : quoteLiq > 0
                                              ? quoteLiq.toFixed(4)
                                              : "—",
                                      }),
                                    ],
                                  }),
                                  /* @__PURE__ */ jsxs("p", {
                                    className: "flex flex-col gap-0.5 text-right",
                                    children: [
                                      /* @__PURE__ */ jsx("span", {
                                        className: "text-ink/40",
                                        children: chain === "xlayer" ? "USDT0" : "USDT",
                                      }),
                                      /* @__PURE__ */ jsx("span", {
                                        children: walletUsdt,
                                      }),
                                    ],
                                  }),
                                ],
                              }),
                            ],
                          }),
                        ],
                      }),
                  ],
                }),
              ],
            }),
            account
              ? /* @__PURE__ */ jsxs("p", {
                  className: "hidden",
                  children: [
                    short(account),
                    " · ",
                    chain === "xlayer" ? "X Layer" : "BSC",
                    bal
                      ? ` · ${chain === "xlayer" ? "USDT0" : "USDT"} ${pretty(bal.usdt, dec, 2)} · ${chain === "xlayer" ? "OKB" : "BNB"} ${pretty(bal.bnb, 18, 4)}`
                      : "",
                  ],
                })
              : null,
            perp && bal && view && bal.usdt < view.min
              ? /* @__PURE__ */ jsx("p", {
                  className: "hidden",
                  children: chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt,
                })
              : null,
            false ? (
              <div className="grid gap-2 border-t border-gold px-3 py-2 sm:grid-cols-2">
                {shownDeals.map((deal) => {
                  const mineLong = deal.long.toLowerCase() === me;
                  const pnl = mineLong ? deal.eqL - deal.marginL : deal.eqS - deal.marginS;
                  const marginSide = mineLong ? deal.marginL : deal.marginS;
                  const roe = marginSide > 0n ? (Number(pnl) / Number(marginSide)) * 100 : 0;
                  const entry = Number(formatUnits(deal.entry, 18));
                  const size = Number(formatUnits(deal.base, 18));
                  const up = pnl >= 0n;
                  const sideLev = (mineLong ? deal.levL : deal.levS) || 0;
                  return (
                    <div
                      key={`pos-${deal.id.toString()}`}
                      className={`flex items-center gap-3 border px-3 py-2 ${mineLong ? "border-[#17875a]/40" : "border-sell/40"}`}
                    >
                      <span className={`h-10 w-1 shrink-0 ${up ? "bg-[#17875a]" : "bg-sell"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2 text-sm">
                          <span className="font-medium">{base}-USDT</span>
                          <span className={mineLong ? "text-[#17875a]" : "text-sell"}>
                            {mineLong ? (lang === "zh" ? "多" : "Long") : lang === "zh" ? "空" : "Short"}
                            {sideLev ? ` ${sideLev}×` : ""}
                          </span>
                        </p>
                        <p className="font-mono text-[11px] text-ink/50">
                          {size.toFixed(4)} {base}
                          {" · "}
                          {entry > 0 ? pxTextN(entry) : "—"}
                          {" → "}
                          {markN > 0 ? pxTextN(markN) : "—"}
                        </p>
                      </div>
                      <div className={`text-right font-mono ${up ? "text-[#17875a]" : "text-sell"}`}>
                        <p className="text-sm">
                          {up ? "+" : ""}
                          {pretty(pnl, dec, 4)}
                        </p>
                        <p className="text-[11px]">
                          {roe >= 0 ? "+" : ""}
                          {roe.toFixed(2)}%
                        </p>
                      </div>
                      <button
                        type="button"
                        className="h-8 shrink-0 border border-sell px-2 text-xs text-sell"
                        disabled={busy}
                        onClick={() => run((from) => closePerp(from, perp, deal.id), "close")}
                      >
                        {lang === "zh" ? "平仓" : "Close"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null,
            <div className="ph-blotter border-t border-gold xl:col-span-12 xl:grid xl:grid-cols-[minmax(0,1fr)_15.5rem]">
              <div className="min-w-0">
              <div className="flex gap-1 overflow-x-auto px-2 pt-1">
                {(
                  [
                    ["bal", lang === "zh" ? "余额" : "Balances"],
                    ["pos", lang === "zh" ? `仓位 (${shownDeals.length})` : `Positions (${shownDeals.length})`],
                    ["ord", lang === "zh" ? `当前委托 (${myQuotes.length})` : `Orders (${myQuotes.length})`],
                    ["twap", "TWAP"],
                    ["chase", lang === "zh" ? "追价" : "Chase", "phone-more"],
                    ["fill", lang === "zh" ? "历史成交" : "Trade history"],
                    ["fund", lang === "zh" ? "资金费历史" : "Funding", "phone-more"],
                    ["hist", lang === "zh" ? "历史委托" : "Order history", "phone-more"],
                  ] as const
                ).map(([id, label, extra]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDock(id)}
                    className={`h-8 shrink-0 px-2 text-xs ${extra || ""} ${dock === id ? "tab-on" : "text-ink/45"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="min-h-14 overflow-x-auto px-2 py-2 text-xs">
                {dock === "pos" ? (
                  shownDeals.length ? (
                    <div className="flex flex-col gap-2">
                      {shownDeals.map((deal) => {
                        const mineLong = deal.long.toLowerCase() === me;
                        const pnl = mineLong ? deal.eqL - deal.marginL : deal.eqS - deal.marginS;
                        const marginSide = mineLong ? deal.marginL : deal.marginS;
                        const roe = marginSide > 0n ? (Number(pnl) / Number(marginSide)) * 100 : 0;
                        const entry = Number(formatUnits(deal.entry, 18));
                        const sideLev = (mineLong ? deal.levL : deal.levS) || 0;
                        const liq =
                          entry > 0 && sideLev > 0
                            ? mineLong
                              ? entry * (1 - 0.5 / sideLev)
                              : entry * (1 + 0.5 / sideLev)
                            : 0;
                        const size = Number(formatUnits(deal.base, 18));
                        const up = pnl >= 0n;
                        return (
                          <div key={deal.id.toString()} className="border border-gold/30 px-2 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm">
                                  {base}-USDT{" "}
                                  <span className={mineLong ? "text-[#1b6b45]" : "text-sell"}>
                                    {mineLong ? (lang === "zh" ? "多" : "Long") : lang === "zh" ? "空" : "Short"}
                                    {sideLev ? ` ${sideLev}×` : ""}
                                  </span>
                                </p>
                                <p className="mt-1 font-mono text-[11px] text-ink/50">
                                  {size.toFixed(4)} {base}
                                  {" · "}
                                  {entry > 0 ? pxTextN(entry) : "—"}
                                  {" → "}
                                  {markN > 0 ? pxTextN(markN) : "—"}
                                  {" · "}
                                  {usdtText(marginSide)}
                                  {liq > 0 ? ` · ${lang === "zh" ? "强平" : "Liq"} ${liq.toFixed(4)}` : ""}
                                </p>
                              </div>
                              <div className={`shrink-0 text-right font-mono ${up ? "text-[#1b6b45]" : "text-sell"}`}>
                                <p className="text-base leading-none">
                                  {roe >= 0 ? "+" : ""}
                                  {roe.toFixed(2)}%
                                </p>
                                <p className="mt-1 text-[11px]">
                                  {up ? "+" : ""}
                                  {pretty(pnl, dec, 4)}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="mt-2 h-8 border border-sell px-3 text-sell"
                              disabled={busy}
                              onClick={() => run((from) => closePerp(from, perp, deal.id), "close")}
                            >
                              {lang === "zh" ? "平仓" : "Close"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-1 text-ink/45">
                      {myQuotes.length
                        ? lang === "zh"
                          ? "还没有成交。挂着的单在「委托」，没人接就没有盈亏。"
                          : "Nothing has filled. The resting order is under Orders. No fill, no PnL."
                        : lang === "zh"
                          ? "尚无开放仓位"
                          : "No open position"}
                    </p>
                  )
                ) : null}
                {dock === "bal" ? (
                  <p className="font-mono text-ink/70">
                    {bal
                      ? `${chain === "xlayer" ? "USDT0" : "USDT"} ${pretty(bal.usdt, dec, 2)} · ${chain === "xlayer" ? "OKB" : "BNB"} ${pretty(bal.bnb, 18, 4)}`
                      : "—"}
                  </p>
                ) : null}
                {dock === "ord" ? (
                  myQuotes.length ? (
                    <div className="flex flex-col gap-2">
                      {myQuotes.map((quote) => {
                        const px = quote.price > 0n ? Number(formatUnits(quote.price, 18)) : markN;
                        const marginN = Number(formatUnits(quote.margin, dec));
                        const size = px > 0 ? (marginN * quote.lev) / px : 0;
                        const hit = (view?.quotes ?? []).some((other) => {
                          if (!other.user || other.user.toLowerCase() === me) return false;
                          if (other.long === quote.long || !(other.price > 0n) || !(px > 0)) return false;
                          const opx = Number(formatUnits(other.price, 18));
                          return quote.long ? opx <= px : opx >= px;
                        });
                        return (
                          <div key={quote.id.toString()} className="flex items-center gap-2 border border-gold/30 px-2 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm">
                                {base}-USDT{" "}
                                <span className={quote.long ? "text-[#1b6b45]" : "text-sell"}>
                                  {quote.long ? (lang === "zh" ? "多" : "Long") : lang === "zh" ? "空" : "Short"}
                                  {` ${quote.lev}×`}
                                </span>
                              </p>
                              <p className="mt-1 font-mono text-[11px] text-ink/50">
                                {quote.price > 0n ? pxTextN(px) : lang === "zh" ? "随标记" : "Mark"}
                                {" · "}
                                {size > 0 ? size.toFixed(4) : "—"} {base}
                                {" · "}
                                {usdtText(quote.margin)}
                              </p>
                              {hit ? (
                                <p className="mt-1 text-[11px] text-ink/55">
                                  {lang === "zh"
                                    ? "对手已挂。对方再开一笔就会成交。同一个钱包不能吃自己的单。"
                                    : "A counterquote is up. Their next order fills this. One wallet cannot fill its own quote."}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="h-8 shrink-0 border border-gold px-2"
                              disabled={busy}
                              onClick={() => run((from) => cancelPerp(from, perp, quote.id), "cancel")}
                            >
                              {lang === "zh" ? "撤单" : "Cancel"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-1 text-ink/45">{lang === "zh" ? "没有未成交的委托" : "No open orders"}</p>
                  )
                ) : null}
                {stops.some(
                  (row) => account && row.user.toLowerCase() === account.toLowerCase(),
                ) ? (
                  <div className="mt-2 flex flex-col gap-1 font-mono">
                    {stops
                      .filter((row) => account && row.user.toLowerCase() === account.toLowerCase())
                      .map((row) => (
                        <p key={`s-${row.id.toString()}`} className="flex items-center gap-3">
                          <span>
                            {lang === "zh" ? "止损" : "Stop"} #{row.id.toString()}{" "}
                            {row.long
                              ? lang === "zh"
                                ? "多"
                                : "Long"
                              : lang === "zh"
                                ? "空"
                                : "Short"}{" "}
                            · {pxText(row.trigger)} · {usdtText(row.margin)}
                          </span>
                          <button
                            type="button"
                            className="underline"
                            disabled={busy}
                            onClick={() => run((from) => fireStopPerp(from, perp, row.id))}
                          >
                            {lang === "zh" ? "触发" : "Fire"}
                          </button>
                          <button
                            type="button"
                            className="underline"
                            disabled={busy}
                            onClick={() =>
                              run((from) => cancelStopPerp(from, perp, row.id), "cancel")
                            }
                          >
                            {lang === "zh" ? "撤销" : "Cancel"}
                          </button>
                        </p>
                      ))}
                  </div>
                ) : null}
                {dock === "twap" ? (
                  twaps.some(
                    (row) => account && row.user.toLowerCase() === account.toLowerCase(),
                  ) ? (
                    <div className="flex flex-col gap-1 font-mono">
                      {twaps
                        .filter(
                          (row) => account && row.user.toLowerCase() === account.toLowerCase(),
                        )
                        .map((row) => (
                          <p key={row.id.toString()} className="flex items-center gap-3">
                            <span>
                              #{row.id.toString()}{" "}
                              {row.long
                                ? lang === "zh"
                                  ? "多"
                                  : "Long"
                                : lang === "zh"
                                  ? "空"
                                  : "Short"}{" "}
                              · {row.left} · {usdtText(row.each)}
                            </span>
                            <button
                              type="button"
                              className="underline"
                              disabled={busy}
                              onClick={() => run((from) => pokeTwapPerp(from, perp, row.id))}
                            >
                              {lang === "zh" ? "推进一步" : "Poke"}
                            </button>
                            <button
                              type="button"
                              className="underline"
                              disabled={busy}
                              onClick={() =>
                                run((from) => cancelTwapPerp(from, perp, row.id), "cancel")
                              }
                            >
                              {lang === "zh" ? "撤销" : "Cancel"}
                            </button>
                          </p>
                        ))}
                    </div>
                  ) : (
                    <p className="text-ink/45">{lang === "zh" ? "还没有 TWAP" : "No TWAPs"}</p>
                  )
                ) : null}
                {dock === "chase" ? (
                  <p className="text-ink/45">{lang === "zh" ? "还没有追价" : "No chase"}</p>
                ) : null}
                {dock === "fill" ? (
                  fills.length ? (
                    <div className="flex flex-col gap-1 font-mono">
                      {fills.slice(0, 8).map((row) => (
                        <a
                          key={row.hash}
                          className="underline"
                          href={`${scan}/tx/${row.hash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {new Date(row.t).toLocaleTimeString()} · {row.kind}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-ink/45">{lang === "zh" ? "尚无交易" : "No trades"}</p>
                  )
                ) : null}
                {dock === "hist" ? (
                  fills.length ? (
                    <div className="flex flex-col gap-1 font-mono">
                      {fills.slice(0, 8).map((row) => (
                        <a
                          key={`h-${row.hash}`}
                          className="underline"
                          href={`${scan}/tx/${row.hash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {new Date(row.t).toLocaleString()} · {row.kind}
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-ink/45">
                      {lang === "zh" ? "尚无历史订单" : "No order history"}
                    </p>
                  )
                ) : null}
                {dock === "fund" ? (
                  <p className="font-mono text-ink/70">
                    {fundText} · {fundClock(lang === "zh")}
                  </p>
                ) : null}
              </div>
              </div>
              <aside className="hl-acct border-t border-gold px-3 py-2 xl:border-l xl:border-t-0">
                <p className="mb-1 text-[11px] text-ink/40">
                  {lang === "zh" ? "账户权益" : "Account equity"}
                </p>
                <p className="hl-kv">
                  <span>{lang === "zh" ? "现货" : "Spot"}</span>
                  <span>{spotN.toFixed(2)}</span>
                </p>
                <p className="hl-kv">
                  <span>{lang === "zh" ? "合约" : "Perps"}</span>
                  <span>{usedMargin.toFixed(2)}</span>
                </p>
                <p className="hl-kv">
                  <span>{lang === "zh" ? "余额" : "Balance"}</span>
                  <span>
                    {bal ? freeN.toFixed(2) : "—"} {chain === "xlayer" ? "USDT0" : "USDT"}
                  </span>
                </p>
                <p className="hl-kv">
                  <span>{lang === "zh" ? "未实现盈亏" : "uPnL"}</span>
                  <span className={openPnl >= 0 ? "text-up" : "text-sell"}>
                    {openPnl >= 0 ? "+" : ""}
                    {openPnl.toFixed(2)}
                  </span>
                </p>
                <p className="hl-kv">
                  <span>{lang === "zh" ? "费用" : "Fees"}</span>
                  <span>0.20% / 0.20%</span>
                </p>
              </aside>
            </div>,
            note
              ? /* @__PURE__ */ jsx("p", {
                  className: `text-xs xl:col-span-12 ${bad ? "text-sell" : "text-ink/70"}`,
                  children: note,
                })
              : null,
            hash
              ? /* @__PURE__ */ jsx("a", {
                  className: "desk-extra",
                  href: `${scan}/tx/${hash}`,
                  target: "_blank",
                  rel: "noreferrer",
                  children: c.walletTx,
                })
              : null,
          ],
        }),
      }),
      levOpen
        ? /* @__PURE__ */ jsx(LevDialog, {
            zh: lang === "zh",
            lev,
            onLev: (next) => {
              setLev(next);
              setLevText(String(next));
              if (next > 20) setMode("pro");
            },
            onClose: () => setLevOpen(false),
          })
        : null,
      marginOpen
        ? /* @__PURE__ */ jsx(MarginDialog, {
            zh: lang === "zh",
            mode: marginMode,
            onPick: (next) => {
              setMarginMode(next);
              saveModes(next, acctMode);
            },
            onClose: () => setMarginOpen(false),
          })
        : null,
      acctOpen
        ? /* @__PURE__ */ jsx(AccountDialog, {
            zh: lang === "zh",
            mode: acctMode,
            onPick: (next) => {
              setAcctMode(next);
              saveModes(marginMode, next);
            },
            onClose: () => setAcctOpen(false),
          })
        : null,
    ],
  });
}
function fundClock(zh: boolean): string {
  const slot = 8 * 3600 * 1000;
  const left = slot - (Date.now() % slot);
  const hh = Math.floor(left / 3600000);
  const mm = Math.floor((left % 3600000) / 60000);
  return zh
    ? `距下次 ${hh}时${String(mm).padStart(2, "0")}分`
    : `Next ${hh}h ${String(mm).padStart(2, "0")}m`;
}

function readFills(): { t: number; kind: string; hash: string }[] {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem("tapeliquid-fills-v1") ?? "[]") as {
      t: number;
      kind: string;
      hash: string;
    }[];
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function pushFill(kind: string, hash: string) {
  const next = [
    { t: Date.now(), kind, hash },
    ...readFills().filter((row) => row.hash !== hash),
  ].slice(0, 20);
  window.localStorage.setItem("tapeliquid-fills-v1", JSON.stringify(next));
  return next;
}

function chasePx(long: boolean, mark: number, quotes: { long: boolean; price: bigint }[]): string {
  const tick = mark >= 1 ? 0.01 : 0.0001;
  const bids = quotes
    .filter((quote) => quote.long && quote.price > 0n)
    .map((quote) => Number(formatUnits(quote.price, 18)));
  const asks = quotes
    .filter((quote) => !quote.long && quote.price > 0n)
    .map((quote) => Number(formatUnits(quote.price, 18)));
  const bestBid = bids.length ? Math.max(...bids) : 0;
  const bestAsk = asks.length ? Math.min(...asks) : 0;
  if (long) {
    const next = bestBid > 0 ? bestBid + tick : mark * 0.999;
    return (bestAsk > 0 && next >= bestAsk ? Math.max(bestAsk - tick, tick) : next).toFixed(4);
  }
  const next = bestAsk > 0 ? bestAsk - tick : mark * 1.001;
  return (bestBid > 0 && next <= bestBid ? bestBid + tick : next).toFixed(4);
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
  const row = (label: string, exit: number) => {
    if (!(exit > 0)) return null;
    const long = (margin * lev * (exit - entry)) / entry;
    const short = -long;
    return (
      <p key={label} className="font-mono text-xs tabular-nums">
        {label} {exit >= 100 ? exit.toFixed(2) : exit.toFixed(4)}
        {" · "}
        {zh ? "开多" : "Long"}{" "}
        <span className={long >= 0 ? "text-gold" : "text-sell"}>
          {signed(long)} {unit}
        </span>
        {" · "}
        {zh ? "开空" : "Short"}{" "}
        <span className={short >= 0 ? "text-gold" : "text-sell"}>
          {signed(short)} {unit}
        </span>
      </p>
    );
  };
  return (
    <div className="mt-2 flex flex-col gap-1">
      {row(zh ? "止盈" : "Take profit", tp)}
      {row(zh ? "止损" : "Stop", sl)}
    </div>
  );
}
