// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { formatUnits, parseUnits } from "viem";
import { copy } from "@/lib/copy";
import { BSC, FEE_TO, connectBsc, ercPrice, pretty, tokenCap, units, type Balances } from "@/lib/bsc";
import { getCandles, getCoinCandles, getTapeCandles, getXCandles, type Candle, type CandleFrame } from "@/lib/candles";
import { previewFrame, readCandleBook, writeCandleBook } from "@/lib/bem-ohlcv";
import { currentAccount, onAccount, onOpenLink } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";
import { SignCard } from "@/components/exchange/sign-card";
import { useFeeLock } from "@/lib/fee-lock";
import { Kline } from "@/components/exchange/kline";
import { AccountDialog, FundingBoard, LevDialog, MarginDialog, PairChevron } from "@/components/exchange/desk-chrome";
import { CoinMark } from "@/components/exchange/coin-mark";
import { announceFill, readPrefs, useDeskPrefs } from "@/lib/desk-prefs";
import { nickOf, readNicks } from "@/lib/nicks";
import { clearArm, easyBand, readArm, writeArm, type Arm } from "@/lib/stops";
import {
  cancelPerp,
  closePerp,
  deployXLayer,
  bookOf,
  pickBook,
  KNOWN_XPERP,
  liquidatePerp,
  openPerp,
  openPostPerp,
  openScalePerp,
  openStopPerp,
  openTwapPerp,
  armTrailPerp,
  pokeXBem,
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
import { TAPE_BEM, readTapePool } from "@/lib/tape-pool";
import { peekSpotPrints } from "@/lib/tape-spot";
import { xCap } from "@/lib/okb";
import { SideRail } from "@/components/exchange/side-rail";
import { RiskBar } from "@/components/exchange/risk-bar";

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
  onPrice,
  onSize,
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
  const away = (row: (typeof drawn)[number]) => mark > 0 && row.px > 0 && Math.abs(row.px - mark) / mark > 0.15;
  const asks = drawn.filter((row) => !row.quote.long).sort((a, b) => b.px - a.px);
  const bids = drawn.filter((row) => row.quote.long).sort((a, b) => b.px - a.px);
  const nearAsks = asks.filter((row) => !away(row));
  const nearBids = bids.filter((row) => !away(row));
  const farCount = asks.length - nearAsks.length + (bids.length - nearBids.length);
  const [showFar, setShowFar] = useState(false);
  const [more, setMore] = useState(false);
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
  const askRows = more ? group(bookAsks) : group(bookAsks).slice(-6);
  const bidRows = more ? group(bookBids) : group(bookBids).slice(0, 6);
  const hidden = bookAsks.length + bookBids.length - askRows.length - bidRows.length;
  const bestAsk = (nearAsks.length ? nearAsks : asks).at(-1)?.px ?? 0;
  const bestBid = (nearBids.length ? nearBids : bids).at(0)?.px ?? 0;
  const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
  const zh = lang === "zh";
  const depthOf = Math.max(...[...askRows, ...bidRows].map((row) => row.margin), 1);
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
  const askCum = cumOf(askRows, true);
  const bidCum = cumOf(bidRows, false);
  const line = (row: (typeof drawn)[number], takeLong: boolean) => {
    const mine = Boolean(account && row.quote.user.toLowerCase() === account.toLowerCase());
    const pct = mark > 0 && row.px > 0 ? ((row.px - mark) / mark) * 100 : null;
    const depth = Math.max(8, Math.min(100, (row.margin / depthOf) * 100));
    const cum = (takeLong ? askCum : bidCum).get(`${row.perp}-${row.quote.id}`) ?? row.margin;
    return (
      <div key={`${row.perp}-${row.quote.id}`} className="relative grid grid-cols-[2.2rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-gold/20 px-2 py-2 text-sm">
        <span className="pointer-events-none absolute inset-y-0 right-0" style={{ width: `${depth}%`, background: takeLong ? "rgba(242,54,69,0.14)" : "rgba(8,153,129,0.14)" }} />
        <span className={`relative ${takeLong ? "text-sell" : "text-[#1b6b45]"}`}>{takeLong ? (zh ? "空" : "S") : zh ? "多" : "L"}</span>
        <button type="button" className="relative min-w-0 text-left font-mono tabular-nums" onClick={() => row.px > 0 && onPrice(row.px)}>
          <span className={takeLong ? "text-sell" : "text-[#1b6b45]"}>{row.limit > 0 ? row.px.toFixed(4) : zh ? "随标记" : "At mark"}</span>
          {pct != null ? <span className="ml-2 text-xs text-ink/45">{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span> : null}
          <span className="mt-0.5 block truncate text-xs text-ink/60" onClick={(event) => { event.stopPropagation(); onSize(row.margin); }}>
            {row.margin.toFixed(2)} USDT · Σ {cum.toFixed(2)} · {row.quote.lev}× · {row.size.toFixed(2)} {unit}
            {away(row) ? (zh ? " · 偏离" : " · far") : ""}
          </span>
        </button>
        <span className="relative flex flex-col items-end gap-1">
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
      <div className="flex gap-1 px-2 pb-1">
        {[0, 0.01, 0.1, 1].map((step) => (
          <button key={step} type="button" onClick={() => setTick(step)} className={`h-6 px-2 font-mono text-[10px] ${tick === step ? "bg-ink" : "border border-gold/30 text-ink/50"}`}>{step === 0 ? (zh ? "逐笔" : "Tick") : step}</button>
        ))}
      </div>
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
        <button type="button" className="font-mono" onClick={() => onPrice(bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : mark)}>{bestBid > 0 && bestAsk > 0 ? ((bestBid + bestAsk) / 2).toFixed(4) : mark > 0 ? mark.toFixed(4) : "—"}</button>
        <span className="h-px flex-1 bg-gold/40" />
      </p>
      {bidRows.map((row) => line(row, false))}
      {bids.length === 0 && asks.length > 0 ? <p className="px-2 py-1 text-xs text-ink/40">{zh ? "买盘空" : "No bids"}</p> : null}
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

export function RealPerp({ launch, onMarkets }: {
	launch?: { chain: Desk; coin: "bem" | "btc" | "eth" | "zec" | "tape" };
	onMarkets?: () => void;
} = {}) {
	const lang = useExchange((s) => s.lang);
	const prefs = useDeskPrefs();
	const live = useExchange((s) => s.chainBem);
	const c = copy[lang];
	const [chain, setChain] = useState(launch?.chain ?? savedDesk());
	const [coin, setCoin] = useState(launch?.coin ?? "bem");
	const [markets, setMarkets] = useState(false);
	const [perp, setPerp] = useState(() => pickBook(launch?.chain ?? savedDesk(), launch?.coin ?? "bem"));
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
	const [supply, setSupply] = useState(null);
	const [frame, setFrame] = useState("1h");
	const [chartTab, setChartTab] = useState("k");
	const [levOpen, setLevOpen] = useState(false);
	const [marginOpen, setMarginOpen] = useState(false);
	const [acctOpen, setAcctOpen] = useState(false);
	const [sizePct, setSizePct] = useState(0);
	const [orderStyle, setOrderStyle] = useState("market");
	const [intent, setIntent] = useState<"long" | "short">("long");
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
	const [dock, setDock] = useState<"bal" | "pos" | "ord" | "twap" | "chase" | "fill" | "fund" | "hist">("pos");
	const [fills, setFills] = useState<{ t: number; kind: string; hash: string }[]>(() => readFills());
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
		if (coin === "tape") {
			setSupply(null);
			return;
		}
		let dead = false;
		(chain === "xlayer" ? xCap(TAPE_BEM) : tokenCap(BSC.bem)).then((n) => {
			if (!dead) setSupply(n || null);
		}).catch(() => {
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
			readTapePool(null).then((row) => {
				const tape = Number(row.usdt.tape) / 1e8;
				const quote = Number(row.usdt.quote) / 1e6;
				if (dead || !(tape > 0)) return;
				const n = quote / tape;
				setCoinPx(n);
				setView(coinBook(n));
			}).catch(() => void 0);
			getTapeCandles({ data: frame }).then((next) => {
				if (dead) return;
				if (next.length > 1) {
					candleCache.current.set(frame, next);
					writeCandleBook(`${chain}:${coin}`, candleCache.current);
				}
				setPrices(next.length > 1 ? next : previewFrame(candleCache.current, frame));
			}).catch(() => {
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
		if (!account) return;
		setArm(readArm(account, perp));
	}, [
		account,
		perp,
		hash
	]);
	useEffect(() => {
		if (!account || !view || view.myDeal <= 0n || firing.current) return;
		const row = readArm(account, perp);
		if (!row || row.spent || row.hold) return;
		const id = view.myDeal.toString();
		if (row.deal && row.deal !== id) return;
		if (!row.deal && row.before != null && row.before === id) return;
		const px = chain === "xlayer" ? view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0 : live && live > 0 ? live : view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0;
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
			hold: false
		};
		writeArm(bound);
		setArm(bound);
		closePerp(account, perp, view.myDeal).then(() => {
			const done = {
				...bound,
				spent: true,
				hold: false
			};
			writeArm(done);
			setArm(done);
			setNote(lang === "zh" ? "止盈或止损已平仓。" : "The stop closed the position.");
			setBad(false);
		}).catch(() => {
			const held = {
				...bound,
				spent: false,
				hold: true
			};
			writeArm(held);
			setArm(held);
			setNote(lang === "zh" ? "平仓没有完成。保护还在，但不会自动再弹钱包。点再试一次。" : "The close did not finish. The stop is still there, but the wallet will not pop again until you tap retry.");
			setBad(true);
		}).finally(() => {
			firing.current = false;
		});
	}, [
		account,
		perp,
		view?.myDeal,
		view?.mark,
		live,
		hash,
		lang
	]);
	useEffect(() => {
		if (typeof window !== "undefined") {
			if (launch) {
				selectDesk(launch.chain);
				setPerp(pickBook(launch.chain, launch.coin));
			} else if (new URLSearchParams(window.location.hash.replace(/^#/, "")).get("ref") || new URLSearchParams(window.location.search).get("ref")) {
				selectDesk("xlayer");
				setChain("xlayer");
				setPerp(pickBook("xlayer", "bem"));
			} else activeBook().then(setPerp).catch(() => setPerp(pickBook(savedDesk(), "bem")));
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
		readChainPurse(chain, account).then((next) => {
			if (!dead) setBal({
				bnb: next.gas,
				usdt: next.usdt,
				bem: 0n
			});
		}).catch(() => void 0);
		return () => {
			dead = true;
		};
	}, [
		account,
		hash,
		chain
	]);
	useEffect(() => {
		if (!(chain === "bsc" && coin !== "bem")) return;
		let dead = false;
		setView(null);
		setBoard([]);
		setPrices([]);
		const load = () => {
			getCoinCandles({ data: {
				coin,
				frame
			} }).then((next) => {
				if (dead) return;
				if (next.length > 1) {
					candleCache.current.set(frame, next);
					writeCandleBook(`${chain}:${coin}`, candleCache.current);
				}
				setPrices(next.length > 1 ? next : previewFrame(candleCache.current, frame));
			}).catch(() => {
				if (!dead) setPrices(previewFrame(candleCache.current, frame));
			});
			ercPrice(coin).then((text) => {
				const n = Number(String(text).replace(/,/g, ""));
				if (dead || !(n > 0)) return;
				setCoinPx(n);
				setView(coinBook(n));
			}).catch(() => void 0);
		};
		load();
		const timer = window.setInterval(load, 12e3);
		return () => {
			dead = true;
			window.clearInterval(timer);
		};
	}, [
		chain,
		coin,
		frame
	]);
	useEffect(() => {
		if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) return;
		if (coin === "tape" || chain === "bsc" && coin !== "bem") return;
		let dead = false;
		const load = () => {
			selectDesk(chain);
			readPerp(perp, account).then((next) => {
				if (!dead) setView(next);
			}).catch((err) => {
				if (dead) return;
				setView(null);
				if ((err instanceof Error ? err.message : "") === "nochain") setNote(c.perpNoChain);
			});
			readBoard().then((rows) => {
				if (!dead) setBoard(rows);
			}).catch(() => void 0);
			(chain === "xlayer" ? getXCandles({ data: frame }) : getCandles({ data: frame })).then((next) => {
				if (dead) return;
				if (next.length > 1) {
					candleCache.current.set(frame, next);
					writeCandleBook(`${chain}:${coin}`, candleCache.current);
				}
				setPrices(next.length > 1 ? next : previewFrame(candleCache.current, frame));
			}).catch(() => {
				if (!dead) setPrices(previewFrame(candleCache.current, frame));
			});
		};
		load();
		const timer = window.setInterval(load, 12e3);
		return () => {
			dead = true;
			window.clearInterval(timer);
		};
	}, [
		perp,
		account,
		hash,
		frame,
		chain,
		coin
	]);
	useEffect(() => {
		if (chain !== "xlayer" || !account) return;
		const id = window.setInterval(() => {
			pokeXBem(account).catch(() => void 0);
		}, 35e3);
		return () => window.clearInterval(id);
	}, [
		chain,
		account,
		xbem
	]);
	const fail = (err) => {
		const code = err.code;
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
		else if (message === "slip") setNote(lang === "zh" ? "对手价超出滑点，市价没有发出。" : "The other side is outside the slippage. The market order was not sent.");
		else if (message === "cross") setNote(lang === "zh" ? "这个价会马上碰到对手单。只挂单不会发出。" : "That price would hit a resting quote. The post-only order was not sent.");
		else if (message === "flat") setNote(lang === "zh" ? "没有可减的仓。" : "There is no position to reduce.");
		else if (message === "risk") setNote(lang === "zh" ? "拆单在风险本上。先由收费地址部署。" : "TWAP is on the risk book. The fee address deploys it first.");
		else if (message === "local") setNote(lang === "zh" ? "这本合约没有链上止损。" : "This contract has no on-chain stop.");
		else if (message === "code") setNote(lang === "zh" ? "推荐码用 1 到 16 个英文字，汉字最多 5 个。" : "Use 1 to 16 English characters, or up to 5 Chinese characters.");
		else if (message === "taken") setNote(c.rebateTaken);
		else if (message === "have") setNote(c.rebateHave);
		else setNote(readPrefs().verboseErrors && message ? message : c.walletReject);
		setBad(true);
	};
	const run = async (task, kind) => {
		if ((kind === "close" || kind === "close-all") && readPrefs().closeConfirm) {
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
				const mine = view.liveDeals.filter((deal) => deal.long.toLowerCase() === from.toLowerCase() || deal.short.toLowerCase() === from.toLowerCase());
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
			}
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
	const levOk = lev >= 1 && lev <= (mode === "easy" ? 20 : 1e3);
	const marginOk = (() => {
		const n = Number(margin);
		return Number.isFinite(n) && n >= floor && n <= 500;
	})();
	const ticketPx = (() => {
		try {
			return limit.trim() ? units(limit, 18) : view?.mark ?? 0n;
		} catch {
			return view?.mark ?? 0n;
		}
	})();
	const alt = coin === "tape" || chain === "bsc" && coin !== "bem";
	const riskLive = !alt && perp.toLowerCase() === (typeof window === "undefined" ? "" : (window.localStorage.getItem(chain === "xlayer" ? "tapeliquid-risk-x" : "tapeliquid-risk-bsc") ?? "")).toLowerCase() && perp.startsWith("0x");
	const base = coin === "tape" ? "TAPE" : chain === "xlayer" || coin === "bem" ? "BEM" : coin.toUpperCase();
	const markN = alt ? coinPx : chain === "xlayer" ? view && view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0 : live && live > 0 ? live : view && view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0;
	const priceOk = orderStyle === "scale"
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
					: alt ? markN > 0 || Boolean(limit.trim()) : ticketPx >= 10n ** 16n && ticketPx <= 100000n * 10n ** 18n;
	const ticket = plan(margin, levOk ? lev : 1, ticketPx);
	const liqMove = levOk ? Math.max(.05, Math.round(5e3 / lev) / 100).toFixed(2) : null;
	let need = 0n;
	try {
		need = units(margin, dec);
	} catch {
		need = 0n;
	}
	const easy = floor <= 1 ? [
		{
			id: "try",
			margin: "1",
			lev: 3
		},
		{
			id: "daily",
			margin: "5",
			lev: 5
		},
		{
			id: "push",
			margin: "10",
			lev: 10
		}
	] : presets;
	const pickFrame = (id) => {
		setFrame(id);
		setPrices(previewFrame(candleCache.current, id));
	};
	const fillMargin = (pct) => {
		setSizePct(pct);
		const held = bal ? Number(formatUnits(bal.usdt, dec)) : 0;
		if (held > 0) {
			const n = Math.min(500, Math.max(floor, (held * pct) / 100));
			setMargin(n.toFixed(2));
			return;
		}
		setMargin(pct === 25 ? "1" : pct === 50 ? "5" : pct === 75 ? "10" : "25");
	};
	const entryN = view && view.dealEntry > 0n ? Number(formatUnits(view.dealEntry, 18)) : 0;
	const mineOpen = view?.liveDeals.find((deal) => account && (deal.long.toLowerCase() === account.toLowerCase() || deal.short.toLowerCase() === account.toLowerCase()) && deal.id === view.myDeal);
	const mineLev = mineOpen ? (account && mineOpen.long.toLowerCase() === account.toLowerCase() ? mineOpen.levL : mineOpen.levS) : 0;
	const liqN = entryN > 0 && mineLev > 0 ? (account && mineOpen && mineOpen.long.toLowerCase() === account.toLowerCase() ? entryN * (1 - 0.5 / mineLev) : entryN * (1 + 0.5 / mineLev)) : 0;
	const usedMargin = (() => {
		if (!account || !view) return 0;
		const me = account.toLowerCase();
		const quotes = view.quotes.filter((quote) => quote.user.toLowerCase() === me).reduce((sum, quote) => sum + Number(formatUnits(quote.margin, dec)), 0);
		const deals = view.liveDeals.reduce((sum, deal) => sum + (deal.long.toLowerCase() === me ? Number(formatUnits(deal.marginL, dec)) : 0) + (deal.short.toLowerCase() === me ? Number(formatUnits(deal.marginS, dec)) : 0), 0);
		return quotes + deals;
	})();
	const openPnl = (() => {
		if (!account || !view) return 0;
		const me = account.toLowerCase();
		return view.liveDeals.reduce((sum, deal) => {
			if (deal.long.toLowerCase() === me) return sum + Number(formatUnits(deal.eqL - deal.marginL, dec));
			if (deal.short.toLowerCase() === me) return sum + Number(formatUnits(deal.eqS - deal.marginS, dec));
			return sum;
		}, 0);
	})();
	const pick = (nextMargin, nextLev) => {
		setMargin(nextMargin);
		setLev(nextLev);
		setLevText(String(nextLev));
	};
	const lastBar = prices.at(-1);
	const openBar = prices[0];
	const drift = lastBar && openBar && openBar.o > 0 ? (lastBar.c - openBar.o) / openBar.o : 0;
	const bookVol = prices.reduce((sum, bar) => sum + (bar.v && Number.isFinite(bar.v) ? bar.v : 0), 0);
	const pxTextN = (n) => n >= 100 ? n.toFixed(2) : n.toFixed(4);
	const choose = (nextChain, nextCoin) => {
		setMarkets(false);
		setCoin(nextCoin);
		if (nextCoin === "tape") {
			setChain("xlayer");
			return;
		}
		if (nextChain === chain) return;
		selectDesk(nextChain);
		setChain(nextChain);
		setPerp(pickBook(nextChain, nextCoin));
		(nextChain === "xlayer" ? connectXLayer() : connectBsc()).catch(() => void 0);
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
	const proLabel = proOn ? proNames[orderStyle][lang === "zh" ? 0 : 1] : lang === "zh" ? "专业" : "Pro";
	const posSize = !account || !view ? 0 : view.liveDeals.reduce((sum, deal) => {
		const me = account.toLowerCase();
		if (deal.long.toLowerCase() !== me && deal.short.toLowerCase() !== me) return sum;
		return sum + Number(formatUnits(deal.base, 18));
	}, 0);
	return /* @__PURE__ */ jsxs("div", { children: [
		/* @__PURE__ */ jsx("section", {
			className: "overflow-hidden border border-gold bg-card",
			children: /* @__PURE__ */ jsxs("div", {
				className: "flex flex-col gap-3 p-0",
				children: [
					chain === "xlayer" && !/^0x[a-fA-F0-9]{40}$/.test("0xCAC69F02c06bfCa3bFDb1eaF1F4a60e17e718081") ? /* @__PURE__ */ jsx("p", {
						className: "px-3 pt-3 text-sm leading-relaxed",
						children: c.xOpen
					}) : null,
					chain === "xlayer" && !/^0x[a-fA-F0-9]{40}$/.test("0xCAC69F02c06bfCa3bFDb1eaF1F4a60e17e718081") && !xbem ? /* @__PURE__ */ jsxs("div", {
						className: "grid gap-2 p-3",
						children: [
							/* @__PURE__ */ jsx("button", {
								type: "button",
								className: "min-h-12 bg-ink px-3 text-sm text-paper disabled:opacity-40",
								disabled: busy,
								onClick: () => {
									setBusy(true);
									setBad(false);
									const steps = [
										c.deployX1,
										c.deployX2,
										c.deployX3
									];
									setDeployNote(lang === "zh" ? "正在连接 X Layer 钱包。请在钱包中确认，确认窗不在本页。" : "Connecting the X Layer wallet. Confirm the request in the wallet. It does not appear on this page.");
									setNote(steps[0]);
									(async () => {
										try {
											selectDesk("xlayer");
											const from = account ?? await connectXLayer();
											setAccount(from);
											if (from.toLowerCase() !== "0x823b9F6A93Ac44Ce5A469823A336c15b6117054D".toLowerCase()) {
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
											setDeployNote(message === "oracle" ? lang === "zh" ? "只有收费地址可以部署本合约。" : "Only the fee address can deploy this contract." : lang === "zh" ? `部署未完成。${message.slice(0, 80) || "若钱包未弹出，请切换至 X Layer 后重试。"}` : `Deployment did not finish. ${message.slice(0, 80)}`);
										} finally {
											setBusy(false);
										}
									})();
								},
								children: busy ? lang === "zh" ? "等待钱包确认" : "Waiting for the wallet" : lang === "zh" ? "部署读 X Layer 池子的新永续" : "Deploy the book that reads the X Layer pools"
							}),
							deployNote ? /* @__PURE__ */ jsx("p", {
								className: `text-sm leading-6 ${bad ? "text-sell" : ""}`,
								children: deployNote
							}) : /* @__PURE__ */ jsx("p", {
								className: "text-sm leading-6 text-ink/70",
								children: lang === "zh" ? "若已经部署过，把永续地址贴在下面。本机记得之后，部署按钮会收起。" : "If it is already deployed, paste the perpetual address. Once this device remembers it, the deploy button goes away."
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]",
								children: [/* @__PURE__ */ jsx("input", {
									value: pasted,
									onChange: (event) => setPasted(event.target.value),
									placeholder: "0x",
									className: "min-h-12 border border-gold bg-transparent px-2 font-mono text-sm"
								}), /* @__PURE__ */ jsx("button", {
									type: "button",
									className: "min-h-12 border border-gold px-4 text-sm disabled:opacity-40",
									disabled: busy,
									onClick: () => {
										setBusy(true);
										setBad(false);
										setDeployNote(lang === "zh" ? "正在核对链上合约。" : "Checking the contract.");
										rememberXBem(pasted).then((addr) => {
											setXbem(addr);
											setPerp(addr);
											setChain("xlayer");
											selectDesk("xlayer");
											setBad(false);
											setDeployNote(addr);
										}).catch(() => {
											setBad(true);
											setDeployNote(lang === "zh" ? "这个地址不是可用的永续合约。" : "That address is not a usable perpetual.");
										}).finally(() => setBusy(false));
									},
									children: lang === "zh" ? "使用已部署的地址" : "Use the deployed address"
								})]
							})
						]
					}) : null,
					/* @__PURE__ */ jsxs("div", {
						className: "flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-gold px-3 py-2",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "relative",
								children: [/* @__PURE__ */ jsxs("button", {
									type: "button",
									onClick: () => onMarkets ? onMarkets() : setMarkets((open) => !open),
									className: "flex items-center gap-2",
									children: [
										<CoinMark id={coin} />,
										<span className="text-lg font-medium tracking-tight">{coin === "tape" ? "TAPE-USDT0" : chain === "xlayer" ? "BEM-USDT0" : `${base}-USDT`}</span>,
										<PairChevron up={markets} />,
										<span className="lev-chip rounded px-1.5 py-0.5 font-mono text-[11px]">{lev}×</span>,
									]
								}), markets && !onMarkets ? /* @__PURE__ */ jsxs("div", {
									className: "pop-in absolute left-0 top-full z-40 mt-2 w-[min(28rem,calc(100vw-2rem))] border border-gold bg-card p-1 shadow-plate",
									children: [/* @__PURE__ */ jsx("p", {
										className: "px-2 py-1 text-[11px] tracking-wide text-ink/45",
										children: lang === "zh" ? "永续 · 保证金" : "Perpetual · margin"
									}), [
										[
											"xlayer",
											"tape",
											"TAPE-USDT0",
											"X Layer"
										],
										[
											"bsc",
											"bem",
											"BEM-USDT",
											"BSC"
										],
										[
											"bsc",
											"btc",
											"BTC-USDT",
											"BSC"
										],
										[
											"bsc",
											"eth",
											"ETH-USDT",
											"BSC"
										],
										[
											"bsc",
											"zec",
											"ZEC-USDT",
											"BSC"
										],
										[
											"xlayer",
											"bem",
											"BEM-USDT0",
											"X Layer"
										]
									].map(([nextChain, nextCoin, label, venue]) => {
										return /* @__PURE__ */ jsxs("button", {
											type: "button",
											onClick: () => choose(nextChain, nextCoin),
											className: `flex w-full items-center gap-2 px-2 py-2 text-left text-sm ${coin === nextCoin && (nextCoin === "tape" || chain === nextChain) ? "bg-foil" : "hover:bg-foil/70"}`,
											children: [/* @__PURE__ */ jsx(CoinMark, { id: nextCoin, className: "size-5" }), /* @__PURE__ */ jsx("span", { className: "mr-auto", children: label }), /* @__PURE__ */ jsxs("span", {
												className: "text-[11px] text-ink/50",
												children: [
													venue,
													" · ",
													lang === "zh" ? "永续" : "Perp"
												]
											})]
										}, `${nextChain}-${nextCoin}`);
									})]
								}) : null]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "font-mono text-sm",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: c.mark
								}), markN > 0 ? pxTextN(markN) : "—"]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "font-mono text-sm",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: lang === "zh" ? "预言机" : "Oracle"
								}), lastBar ? pxTextN(lastBar.c) : "—"]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "font-mono text-sm",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: lang === "zh" ? "溢价" : "Premium"
								}), lastBar && markN > 0 && lastBar.c > 0 ? `${((markN - lastBar.c) / lastBar.c * 100).toFixed(3)}%` : "—"]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: `font-mono text-sm ${drift < 0 ? "text-sell" : "text-up"}`,
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: lang === "zh" ? "24小时变化" : "24h change"
								}), lastBar ? `${drift >= 0 ? "+" : ""}${(drift * 100).toFixed(2)}%` : "—"]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "font-mono text-sm",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: lang === "zh" ? "高 / 低" : "High / low"
								}), prices.length ? `${Math.max(...prices.map((bar) => bar.h)).toFixed(4)} / ${Math.min(...prices.map((bar) => bar.l)).toFixed(4)}` : "—"]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "font-mono text-sm",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: lang === "zh" ? "24小时成交量" : "24h volume"
								}), bookVol > 0 ? bookVol.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "font-mono text-sm",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: lang === "zh" ? "合约持仓量" : "Open interest"
								}), view?.liveDeals?.length ? view.liveDeals.reduce((sum, deal) => sum + Number(formatUnits(deal.base, 18)) * (markN || 0), 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "font-mono text-sm",
								children: [/* @__PURE__ */ jsx("span", {
									className: "mr-2 text-[11px] text-ink/45",
									children: lang === "zh" ? "资金费 / 倒计时" : "Funding"
								}), riskLive ? (lang === "zh" ? "本内结算" : "On this book") : lang === "zh" ? "不收" : "None", " · ", fundClock(lang === "zh")]
							}),
							/* @__PURE__ */ jsxs("p", {
								className: "text-[11px] text-ink/45",
								children: [chain === "xlayer" ? lang === "zh" ? "逐仓 · USDT0" : "Isolated · USDT0" : lang === "zh" ? "逐仓 · USDT" : "Isolated · USDT", !alt && /^0x[a-fA-F0-9]{40}$/.test(perp) ? /* @__PURE__ */ jsxs(Fragment, { children: [" · ", /* @__PURE__ */ jsx("a", {
									className: "underline",
									href: `${scan}/address/${perp}`,
									target: "_blank",
									rel: "noreferrer",
									children: lang === "zh" ? "合约" : "Contract"
								})] }) : null]
							})
						]
					}),
					link ? /* @__PURE__ */ jsx("a", {
						href: link,
						target: "_blank",
						rel: "noreferrer",
						className: "mx-3 inline-flex min-h-10 items-center justify-center bg-ink px-3 text-sm text-paper",
						children: c.signOkx
					}) : null,
					/* @__PURE__ */ jsxs("div", {
						className: "grid items-start xl:grid-cols-[minmax(0,1fr)_17.5rem_22rem]",
						children: [
							/* @__PURE__ */ jsxs("div", {
								className: "order-1 min-w-0 xl:order-1",
								children: [
									/* @__PURE__ */ jsxs("div", {
										className: "flex flex-col gap-2 px-2 pt-2",
										children: [/* @__PURE__ */ jsxs("div", {
											className: "flex gap-3 px-1 text-sm",
											children: [/* @__PURE__ */ jsx("button", {
												type: "button",
												onClick: () => setChartTab("k"),
												className: chartTab === "k" ? "tab-on" : "text-ink/45",
												children: lang === "zh" ? "图表" : "Chart"
											}), /* @__PURE__ */ jsx("button", {
												type: "button",
												onClick: () => setChartTab("fund"),
												className: chartTab === "fund" ? "tab-on" : "text-ink/45",
												children: lang === "zh" ? "资金费" : "Funding"
											})]
										})]
									}),
									chartTab === "fund" ? /* @__PURE__ */ jsx(FundingBoard, {
										zh: lang === "zh",
										mark: markN,
										last: lastBar?.c ?? markN
									}) : /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsx(Kline, {
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
											["1y", "一年", "1y"]
										].map(([id, zhLabel, enLabel]) => ({ id, label: lang === "zh" ? zhLabel : enLabel })),
										onPrice: (px) => {
											setOrderStyle("limit");
											setLimit(px.toFixed(4));
										}
									}) }),
									/* @__PURE__ */ jsxs("details", {
										className: "px-3 py-2 text-xs text-ink/55",
										children: [/* @__PURE__ */ jsx("summary", {
											className: "min-h-8 cursor-pointer",
											children: lang === "zh" ? "风险" : "Risk"
										}), /* @__PURE__ */ jsx("p", {
											className: "mt-1 leading-5",
											children: chain === "xlayer" ? c.perpWarnX : c.perpWarn
										})]
									}),
									!view ? /* @__PURE__ */ jsx("p", {
										className: "px-3 py-2 text-sm text-ink/60",
										children: lang === "zh" ? "正在读合约，读完才能开仓。" : "Reading the contract. Open waits until that finishes."
									}) : null,
									lock.status === "bad" ? /* @__PURE__ */ jsx("p", {
										className: "px-3 pb-2 text-sm text-sell",
										children: lang === "zh" ? "收费地址对不上，开仓停了。" : "The fee address does not match. Opening is stopped."
									}) : null
								]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "order-3 min-w-0 border-t border-gold xl:order-2 xl:border-t-0 xl:border-l",
								children: [/* @__PURE__ */ jsxs("div", {
									className: "flex h-9 items-center border-b border-gold px-3 text-xs text-ink/70",
									children: [/* @__PURE__ */ jsx("span", { children: lang === "zh" ? "订单簿" : "Book" }), account && view?.quotes.some((quote) => quote.user.toLowerCase() === account.toLowerCase()) ? /* @__PURE__ */ jsx("button", {
										type: "button",
										className: "ml-2 underline",
										disabled: busy,
										onClick: () => run(async (from) => {
											const mine = (view?.quotes ?? []).filter((quote) => quote.user.toLowerCase() === from.toLowerCase());
											let last;
											for (const quote of mine) last = await cancelPerp(from, perp, quote.id);
											return last;
										}, "cancel"),
										children: lang === "zh" ? "全撤" : "Cancel all"
									}) : null, /* @__PURE__ */ jsx("span", {
										className: "ml-auto font-mono text-ink/40",
										children: lang === "zh" ? "价差" : "Spread"
									})]
								}), /* @__PURE__ */ jsx(DeskLadder, {
									rows: board,
									mark: markN,
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
										if (slipBps > 0 && markN > 0 && quote.price > 0n) {
											const away = Math.abs(Number(formatUnits(quote.price, 18)) - markN) / markN;
											if (away > slipBps / 10000) {
												setBad(true);
												setNote(lang === "zh" ? "这张单超出滑点，没有吃。" : "That quote is outside the slippage. It was not taken.");
												return;
											}
										}
										run((from) => takePerp(from, book, quote.id, formatUnits(quote.margin, dec), quote.lev, quote.price > 0n));
									},
									onCancel: (book, quote) => run((from) => cancelPerp(from, book, quote.id), "cancel")
								})]
							}),
							/* @__PURE__ */ jsxs("div", {
								className: "order-2 flex min-w-0 flex-col gap-3 border-t border-gold p-3 xl:sticky xl:top-14 xl:order-3 xl:max-h-[calc(100dvh-4.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:border-t-0 xl:border-l",
								children: [
									/* @__PURE__ */ jsx(RiskBar, {
										zh: lang === "zh",
										chain,
										coin,
										onUse: setPerp
									}),
									/* @__PURE__ */ jsxs("div", {
										className: "grid grid-cols-3 gap-1 text-xs",
										children: [
											/* @__PURE__ */ jsx("button", {
												type: "button",
												onClick: () => setMarginOpen(true),
												className: "h-8 border border-gold/50",
												children: lang === "zh" ? "逐仓" : "Isolated"
											}),
											/* @__PURE__ */ jsxs("button", {
												type: "button",
												onClick: () => setLevOpen(true),
												className: "lev-chip h-8 border border-up/40 font-mono",
												children: [lev, "×"]
											}),
											/* @__PURE__ */ jsx("button", {
												type: "button",
												onClick: () => setAcctOpen(true),
												className: "h-8 border border-gold/50",
												children: lang === "zh" ? "手动" : "Manual"
											})
										]
									}),
									view?.liveDeals.length ? /* @__PURE__ */ jsxs("div", {
										className: "border border-gold/40 p-3",
										children: [/* @__PURE__ */ jsxs("div", {
											className: "flex items-center gap-2",
											children: [/* @__PURE__ */ jsx("p", {
												className: "text-xs tracking-widest text-gold",
												children: c.pkTitle
											}), account && view.liveDeals.some((deal) => deal.long.toLowerCase() === account.toLowerCase() || deal.short.toLowerCase() === account.toLowerCase()) ? /* @__PURE__ */ jsx("button", {
												type: "button",
												className: "ml-auto h-7 border border-sell px-2 text-[11px] text-sell",
												disabled: busy,
												onClick: () => run(async (from) => {
													const mine = view.liveDeals.filter((deal) => deal.long.toLowerCase() === from.toLowerCase() || deal.short.toLowerCase() === from.toLowerCase());
													let last;
													for (const deal of mine) last = await closePerp(from, perp, deal.id);
													return last;
												}),
												children: lang === "zh" ? "全平" : "Close all"
											}) : null]
										}), /* @__PURE__ */ jsx("div", {
											className: "mt-2 flex flex-col gap-2",
											children: view.liveDeals.map((deal) => {
												const mineLong = Boolean(account && deal.long.toLowerCase() === account.toLowerCase());
												const mineShort = Boolean(account && deal.short.toLowerCase() === account.toLowerCase());
												const mineDeal = mineLong || mineShort;
												const pnl = mineLong ? deal.eqL - deal.marginL : deal.eqS - deal.marginS;
												const ahead = deal.eqL === deal.eqS ? c.pkFlat : deal.eqL > deal.eqS ? `${c.pkLong}${c.pkLead}` : `${c.pkShort}${c.pkLead}`;
												return /* @__PURE__ */ jsxs("div", {
													className: "border border-gold/30 px-2 py-2 text-sm",
													children: [
														/* @__PURE__ */ jsxs("p", {
															className: "break-all font-mono text-xs text-[#1b6b45]",
															children: [
																c.pkLong,
																" ",
																named(deal.long),
																mineLong ? lang === "zh" ? " · 我的" : " · mine" : "",
																" · ",
																usdtText$1(deal.eqL)
															]
														}),
														/* @__PURE__ */ jsxs("p", {
															className: "break-all font-mono text-xs text-sell",
															children: [
																c.pkShort,
																" ",
																named(deal.short),
																mineShort ? lang === "zh" ? " · 我的" : " · mine" : "",
																" · ",
																usdtText$1(deal.eqS)
															]
														}),
														/* @__PURE__ */ jsxs("p", {
															className: "mt-1",
															children: [
																ahead,
																" · ",
																pxText(deal.entry),
																" → ",
																markN > 0 ? markN.toFixed(4) : "—"
															]
														}),
														mineDeal && prefs.showPnl ? /* @__PURE__ */ jsxs("p", {
															className: `mt-1 font-mono ${pnl >= 0n ? "text-gold" : "text-sell"}`,
															children: [
																c.pnl,
																" ",
																pnl >= 0n ? "+" : "",
																pretty(pnl, dec, 4),
																" USDT"
															]
														}) : null,
														mineDeal ? /* @__PURE__ */ jsxs("div", {
															className: "mt-2 flex gap-2",
															children: [/* @__PURE__ */ jsx("button", {
																type: "button",
																className: "min-h-11 bg-ink px-3 text-paper",
																disabled: busy,
																onClick: () => run((from) => closePerp(from, perp, deal.id), "close"),
																children: c.closeDeal
															}), /* @__PURE__ */ jsx("button", {
																type: "button",
																className: "min-h-11 border border-gold px-3",
																disabled: busy || !(markN > 0),
																onClick: () => run(async (from) => {
																	await closePerp(from, perp, deal.id);
																	const sideMargin = formatUnits(mineLong ? deal.marginL : deal.marginS, dec);
																	const sideLev = mineLong ? deal.levL : deal.levS;
																	return openPerp(from, perp, !mineLong, sideMargin, sideLev || lev, markN.toFixed(4));
																}, "reverse"),
																children: lang === "zh" ? "反手" : "Reverse"
															}), /* @__PURE__ */ jsx("button", {
																type: "button",
																className: "min-h-11 border border-gold px-3",
																disabled: !account,
																onClick: () => {
																	if (!account) return;
																	const entry = Number(formatUnits(deal.entry, 18));
																	if (!(entry > 0)) return;
																	const band = easyBand(entry, (mineLong ? deal.levL : deal.levS) || 1, mineLong);
																	const next = { account, perp, long: mineLong, tp: band.tp, sl: band.sl, spent: false, hold: false, deal: deal.id.toString() };
																	writeArm(next);
																	setArm(next);
																	setBad(false);
																	setNote(lang === "zh" ? "止盈止损画在图上。页面开着才会平仓。" : "Take profit and stop are on the chart. They close while the page is open.");
																},
																children: lang === "zh" ? "保护" : "Protect"
															})]
														}) : null,
														deal.weakL || deal.weakS ? /* @__PURE__ */ jsx("button", {
															type: "button",
															className: "mt-2 min-h-11 border border-sell px-3 text-sell",
															disabled: busy,
															onClick: () => run((from) => liquidatePerp(from, perp, deal.id)),
															children: c.liqNow
														}) : null
													]
												}, String(deal.id));
											})
										})]
									}) : null,
									/^0x[a-fA-F0-9]{40}$/.test(perp) && /* @__PURE__ */ jsxs("div", {
										className: "flex flex-col gap-3 border border-gold/40 p-3",
										children: [
											waiting ? /* @__PURE__ */ jsxs("p", {
												className: "text-sm leading-relaxed",
												children: [
													mine ? c.perpOther : `${c.waitQuote} · ${view?.pendingLong ? c.postLong : c.postShort} · ${usdtText$1(view?.pendingMargin ?? 0n)} USDT · ${view?.pendingLev}×`,
													" ",
													c.pkMiss
												]
											}) : null,
											inDeal && !view?.book ? /* @__PURE__ */ jsxs("div", {
												className: "grid grid-cols-2 gap-2 text-sm",
												children: [
													/* @__PURE__ */ jsxs("p", {
														className: "border border-gold/40 px-2 py-2",
														children: [/* @__PURE__ */ jsx("span", {
															className: "block text-xs tracking-widest text-gold",
															children: lang === "zh" ? "方向和倍数" : "Side and leverage"
														}), /* @__PURE__ */ jsxs("span", {
															className: "font-mono",
															children: [view?.long ? lang === "zh" ? "多" : "Long" : lang === "zh" ? "空" : "Short", (() => {
																const notional = view ? Number(formatUnits(view.base, 18)) * Number(formatUnits(view.entry, 18)) : 0;
																const marginN = view ? Number(formatUnits(view.margin, dec)) : 0;
																const times = marginN > 0 && notional > 0 ? Math.max(1, Math.round(notional / marginN)) : 0;
																return times ? ` · ${times}×` : "";
															})()]
														})]
													}),
													/* @__PURE__ */ jsxs("p", {
														className: "border border-gold/40 px-2 py-2",
														children: [/* @__PURE__ */ jsx("span", {
															className: "block text-xs tracking-widest text-gold",
															children: lang === "zh" ? "保证金" : "Margin"
														}), /* @__PURE__ */ jsxs("span", {
															className: "font-mono",
															children: [usdtText$1(view?.margin ?? view?.equity ?? 0n), " USDT"]
														})]
													}),
													/* @__PURE__ */ jsxs("p", {
														className: "border border-gold/40 px-2 py-2",
														children: [/* @__PURE__ */ jsx("span", {
															className: "block text-xs tracking-widest text-gold",
															children: lang === "zh" ? "强平价" : "Liquidation"
														}), /* @__PURE__ */ jsx("span", {
															className: "font-mono",
															children: (() => {
																const notional = view ? Number(formatUnits(view.base, 18)) * Number(formatUnits(view.entry, 18)) : 0;
																const marginN = view ? Number(formatUnits(view.margin, dec)) : 0;
																const times = marginN > 0 && notional > 0 ? Math.max(1, Math.round(notional / marginN)) : 0;
																if (!(entryN > 0) || !times) return "—";
																return (view?.long ? entryN * (1 - .5 / times) : entryN * (1 + .5 / times)).toFixed(4);
															})()
														})]
													}),
													/* @__PURE__ */ jsxs("p", {
														className: "border border-gold/40 px-2 py-2",
														children: [/* @__PURE__ */ jsx("span", {
															className: "block text-xs tracking-widest text-gold",
															children: lang === "zh" ? "开仓价" : "Entry"
														}), /* @__PURE__ */ jsx("span", {
															className: "font-mono",
															children: pxText(view?.entry ?? 0n)
														})]
													})
												]
											}) : null,
											view?.book ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("div", {
												className: "grid grid-cols-2 gap-2",
												children: [/* @__PURE__ */ jsx("button", {
													type: "button",
													onClick: () => setSheet("book"),
													className: `min-h-11 border border-gold ${sheet === "book" ? "bg-ink text-paper" : ""}`,
													children: c.bookMarket
												}), /* @__PURE__ */ jsx("button", {
													type: "button",
													onClick: () => setSheet("mine"),
													className: `min-h-11 border border-gold ${sheet === "mine" ? "bg-ink text-paper" : ""}`,
													children: c.myOrders
												})]
											}), sheet === "mine" ? /* @__PURE__ */ jsxs(Fragment, { children: [view.quotes.filter((quote) => account && quote.user.toLowerCase() === account.toLowerCase()).length === 0 ? /* @__PURE__ */ jsx("p", {
												className: "text-sm text-ink/60",
												children: lang === "zh" ? "你还没有未成交的挂单。" : "You have no resting quote."
											}) : null, view.quotes.filter((quote) => account && quote.user.toLowerCase() === account.toLowerCase()).map((quote) => /* @__PURE__ */ jsxs("div", {
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
															usdtText$1(quote.margin),
															" USDT · ",
															quote.lev,
															"×",
															quote.price > 0n ? ` · $${pxText(quote.price)}` : ""
														]
													}),
													/* @__PURE__ */ jsx("p", {
														className: "mt-1 font-mono text-xs text-ink/70",
														children: c.openPnl
													}),
													/* @__PURE__ */ jsx("button", {
														type: "button",
														className: "mt-2 min-h-11 border border-gold px-3",
														disabled: busy,
														onClick: () => run((from) => cancelPerp(from, perp, quote.id), "cancel"),
														children: c.cancelPost
													})
												]
											}, String(quote.id)))] }) : null] }) : null,
											(view?.book ? sheet === "book" : !inDeal && !mine) ? /* @__PURE__ */ jsxs(Fragment, { children: [
<>
												<div className="relative flex items-end gap-5 border-b border-gold/30 pb-2 text-sm">
													<button type="button" onClick={() => { setOrderStyle("market"); setProOpen(false); }} className={orderStyle === "market" ? "tab-on" : "text-ink/45"}>{lang === "zh" ? "市价" : "Market"}</button>
													<button type="button" onClick={() => { setOrderStyle("limit"); setProOpen(false); if (!limit.trim() && markN > 0) setLimit(markN.toFixed(4)); }} className={orderStyle === "limit" ? "tab-on" : "text-ink/45"}>{lang === "zh" ? "限价" : "Limit"}</button>
													<button type="button" onClick={() => setProOpen((on) => !on)} className={`inline-flex items-center gap-1 ${proOn ? "tab-on" : "text-ink/45"}`}>
														{proLabel}
														<PairChevron up={proOpen} />
													</button>
													{proOpen ? (
														<div className="pop-in absolute right-0 top-full z-20 mt-1 w-40 border border-gold bg-card py-1 shadow-plate">
															{([["chase", "追价", "Chase"], ["scale", "分段订单", "Scale"], ["stop", "止损市价", "Stop market"], ["post", "只挂", "Post only"], ["trail", "移动止损", "Trailing"], ["twap", "TWAP", "TWAP"]] as const).map(([id, zhLabel, enLabel]) => (
																<button key={id} type="button" onClick={() => { setOrderStyle(id); setProOpen(false); }} className={`block h-9 w-full px-3 text-left text-sm hover:bg-white/5 ${orderStyle === id ? "text-up" : ""}`}>{lang === "zh" ? zhLabel : enLabel}</button>
															))}
														</div>
													) : null}
												</div>
												<div className="grid grid-cols-2 gap-2">
													<button type="button" onClick={() => setIntent("long")} className={`h-10 text-sm ${intent === "long" ? "bg-up text-paper" : "border border-gold/40 text-ink/55"}`}>{lang === "zh" ? "买入 / 做多" : "Buy / Long"}</button>
													<button type="button" onClick={() => setIntent("short")} className={`h-10 text-sm ${intent === "short" ? "bg-sell text-paper" : "border border-gold/40 text-ink/55"}`}>{lang === "zh" ? "卖出 / 做空" : "Sell / Short"}</button>
												</div>
												{orderStyle === "limit" || orderStyle === "post" ? (
													<label className="block border border-gold/40 px-3 py-2">
														<span className="block text-[11px] text-ink/45">{lang === "zh" ? "价格" : "Price"}</span>
														<input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-xl outline-none" />
													</label>
												) : null}
												{orderStyle === "trail" ? (
													<label className="block border border-gold/40 px-3 py-2">
														<span className="block text-[11px] text-ink/45">{lang === "zh" ? "回撤 %" : "Retrace %"}</span>
														<input value={trailPct} onChange={(event) => setTrailPct(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-xl outline-none" />
													</label>
												) : null}
												{orderStyle === "stop" ? (
													<label className="block border border-gold/40 px-3 py-2">
														<span className="block text-[11px] text-ink/45">{lang === "zh" ? "触发价" : "Trigger"}</span>
														<input value={stopPx} onChange={(event) => setStopPx(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-xl outline-none" />
													</label>
												) : null}
												{orderStyle === "scale" ? (
													<div className="grid grid-cols-3 gap-1">
														<input value={scaleA} onChange={(event) => setScaleA(event.target.value)} inputMode="decimal" placeholder={lang === "zh" ? "起" : "From"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
														<input value={scaleB} onChange={(event) => setScaleB(event.target.value)} inputMode="decimal" placeholder={lang === "zh" ? "止" : "To"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
														<input value={String(scaleN)} onChange={(event) => setScaleN(Math.min(5, Math.max(2, Number(event.target.value) || 2)))} inputMode="numeric" className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
													</div>
												) : null}
												{orderStyle === "twap" ? (
													<div className="grid grid-cols-2 gap-1">
														<input value={String(twapN)} onChange={(event) => setTwapN(Math.min(12, Math.max(2, Number(event.target.value) || 2)))} inputMode="numeric" className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
														<input value={String(twapGap)} onChange={(event) => setTwapGap(Math.max(30, Number(event.target.value) || 30))} inputMode="numeric" className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
													</div>
												) : null}
												<label className="block border border-gold/40 px-3 py-2">
													<span className="block text-[11px] text-ink/45">{lang === "zh" ? "保证金" : "Margin"} USDT</span>
													<input value={margin} onChange={(event) => { setSizePct(0); setMargin(event.target.value); }} inputMode="decimal" className="w-full bg-transparent font-mono text-2xl outline-none" />
												</label>
												<div className="grid grid-cols-4 gap-1">
													{[25, 50, 75, 100].map((pct) => (
														<button key={pct} type="button" onClick={() => fillMargin(pct)} className={`h-8 border font-mono text-xs ${sizePct === pct ? "border-transparent bg-ink" : "border-gold/40 text-ink/70"}`}>{pct}%</button>
													))}
												</div>
												<button type="button" onClick={() => setReduceOnly((on) => !on)} className={`h-8 text-sm ${reduceOnly ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{lang === "zh" ? "只减仓" : "Reduce"}</button>
												<div className="grid grid-cols-4 gap-1">
													{[10, 50, 100, 0].map((bps) => (
														<button key={bps} type="button" onClick={() => setSlipBps(bps)} className={`h-8 font-mono text-[11px] ${slipBps === bps ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{bps === 0 ? (lang === "zh" ? "滑点关" : "Slip off") : `${bps / 100}%`}</button>
													))}
												</div>
												<button type="button" className="h-8 text-left text-xs text-ink/55" onClick={() => setTicketMore((on) => !on)}>{ticketMore ? (lang === "zh" ? "收起止盈止损" : "Hide stops") : (lang === "zh" ? "止盈止损" : "Stops")}</button>
											</>,
												ticketMore ? /* @__PURE__ */ jsxs("div", {
													className: "border border-gold/40 p-3",
													children: [
														/* @__PURE__ */ jsx("div", {
															className: "grid grid-cols-3 gap-2",
															children: [
																"easy",
																"pro",
																"off"
															].map((item) => /* @__PURE__ */ jsx("button", {
																type: "button",
																onClick: () => setGuard(item),
																className: `min-h-11 border border-gold text-sm ${guard === item ? "bg-ink text-paper" : ""}`,
																children: item === "easy" ? c.stopEasy : item === "pro" ? c.stopPro : c.stopClear
															}, item))
														}),
														guard === "pro" ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("div", {
															className: "mt-2 grid grid-cols-2 gap-2",
															children: [/* @__PURE__ */ jsxs("label", {
																className: "border border-gold/40 px-2 py-2",
																children: [/* @__PURE__ */ jsx("span", {
																	className: "block text-xs tracking-widest text-gold",
																	children: c.stopTp
																}), /* @__PURE__ */ jsx("input", {
																	value: tpText,
																	onChange: (event) => setTpText(event.target.value),
																	inputMode: "decimal",
																	className: "w-full bg-transparent font-mono text-xl outline-none"
																})]
															}), /* @__PURE__ */ jsxs("label", {
																className: "border border-gold/40 px-2 py-2",
																children: [/* @__PURE__ */ jsx("span", {
																	className: "block text-xs tracking-widest text-gold",
																	children: c.stopSl
																}), /* @__PURE__ */ jsx("input", {
																	value: slText,
																	onChange: (event) => setSlText(event.target.value),
																	inputMode: "decimal",
																	className: "w-full bg-transparent font-mono text-xl outline-none"
																})]
															})]
														}), /* @__PURE__ */ jsx(StopReadout, {
															lang,
															entry: Number(limit) || markN,
															usedMark: !(Number(limit) > 0),
															tp: Number(tpText),
															sl: Number(slText),
															margin: Number(margin),
															lev,
															unit: chain === "xlayer" ? "USDT0" : "USDT"
														})] }) : null,
														guard === "easy" && markN > 0 ? /* @__PURE__ */ jsxs("p", {
															className: "mt-2 font-mono text-sm tabular-nums",
															children: [
																c.stopTp,
																" $",
																easyBand(Number(limit) || markN, lev || 1, true).tp.toFixed(2),
																" · ",
																c.stopSl,
																" $",
																easyBand(Number(limit) || markN, lev || 1, true).sl.toFixed(2)
															]
														}) : null,
														arm && !arm.spent ? /* @__PURE__ */ jsxs("p", {
															className: "mt-2 font-mono text-sm",
															children: [
																arm.hold ? lang === "zh" ? "上次没平掉。保护还在，不会自动再弹钱包。" : "The last close did not finish. The stop stays, and the wallet will not pop by itself." : c.stopArmed,
																" · ",
																c.stopTp,
																" $",
																arm.tp.toFixed(2),
																" · ",
																c.stopSl,
																" $",
																arm.sl.toFixed(2),
																arm.hold ? /* @__PURE__ */ jsx("button", {
																	type: "button",
																	className: "ml-2 underline",
																	onClick: () => {
																		const next = {
																			...arm,
																			hold: false,
																			spent: false
																		};
																		writeArm(next);
																		setArm(next);
																	},
																	children: lang === "zh" ? "再试一次" : "Try again"
																}) : null,
																/* @__PURE__ */ jsx("button", {
																	type: "button",
																	className: "ml-2 underline",
																	onClick: () => {
																		if (account) {
																			clearArm(account, perp);
																			setArm(null);
																		}
																	},
																	children: c.stopClear
																})
															]
														}) : null
													]
												}) : null,
												<div className="grid grid-cols-2 gap-y-1 font-mono text-[11px]">
													<span className="text-ink/45">{lang === "zh" ? "可用" : "Available"}</span>
													<span className="text-right">{bal ? pretty(bal.usdt, dec, 2) : "—"} {chain === "xlayer" ? "USDT0" : "USDT"}</span>
													<span className="text-ink/45">{lang === "zh" ? "当前仓位" : "Position"}</span>
													<span className="text-right">{posSize ? posSize.toFixed(4) : "0.00"} {base}</span>
													<span className="text-ink/45">{lang === "zh" ? "强平价格" : "Liq. price"}</span>
													<span className="text-right">{liqN > 0 ? liqN.toFixed(4) : liqMove ? `${liqMove}%` : "—"}</span>
													<span className="text-ink/45">{lang === "zh" ? "订单价值" : "Order value"}</span>
													<span className="text-right">{ticket ? ticket.notional.toFixed(2) : "—"}</span>
													<span className="text-ink/45">{lang === "zh" ? "所需保证金" : "Margin"}</span>
													<span className="text-right">{marginOk ? margin : "—"}</span>
													<span className="text-ink/45">{lang === "zh" ? "费用" : "Fee"}</span>
													<span className="text-right">0.20% / 0.20%</span>
												</div>,
												levOk && lev >= 100 && liqMove && prefs.showWarnings ? /* @__PURE__ */ jsx("p", {
													className: "text-sm text-sell",
													children: lang === "zh" ? `${lev} 倍。标记价反向大约 ${liqMove}%，保证金大约亏掉一半，仓可以被强平。` : `${lev}×. A mark move of about ${liqMove}% can take half the margin and liquidate.`
												}) : null,
												!levOk || !marginOk ? /* @__PURE__ */ jsx("p", {
													className: "text-sm text-sell",
													children: !levOk ? c.levCap : `${floor}–500 USDT`
												}) : null,
												!priceOk ? /* @__PURE__ */ jsx("p", {
													className: "text-sm text-sell",
													children: c.badPrice
												}) : null,
												bal && marginOk && bal.usdt < need ? /* @__PURE__ */ jsxs("p", {
													className: "text-sm text-sell",
													children: [
														chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt,
														" ",
														pretty(bal.usdt, dec, 2),
														" / ",
														margin,
														" USDT"
													]
												}) : null,
												<button
													type="button"
													className={`min-h-12 text-paper disabled:opacity-40 ${intent === "long" ? "bg-up" : "bg-sell"}`}
													disabled={busy || lock.status !== "ok" || !levOk || !marginOk || !priceOk || !view?.priced || Boolean(!view?.book && waiting && (intent === "long" ? view?.pendingLong : !view?.pendingLong))}
													onClick={() => {
														if (lev > 20 && !hot) {
															setHot(true);
															return;
														}
														setCard(intent);
													}}
												>
													{lev > 20 && !hot ? (lang === "zh" ? "超过 20 倍，再点一次" : "Over 20×. Tap again") : waiting && view && (intent === "long" ? !view.pendingLong : view.pendingLong) ? c.pullQuote : intent === "long" ? (lang === "zh" ? "买入 / 做多" : "Buy / Long") : lang === "zh" ? "卖出 / 做空" : "Sell / Short"}
												</button>,
												card ? /* @__PURE__ */ jsx(SignCard, {
													title: lang === "zh" ? "签名前看一眼" : "Before you sign",
													yes: lang === "zh" ? "确认并签名" : "Confirm and sign",
													no: lang === "zh" ? "取消" : "Cancel",
													auto: !prefs.orderConfirm,
													warn: prefs.showWarnings ? (coin === "tape" ? lang === "zh" ? "TAPE 永续的结算本还没部署。确认不会签名，也不会扣 USDT。要成交去「现货」。" : "The TAPE perpetual settlement book is not deployed. Confirm does not sign and does not take USDT. Fills are on Spot." : alt ? lang === "zh" ? "这一张单和 BEM 相同。这条交易对的结算合约还没接上，确认不会签名，USDT 也不会扣，也不会去买现货。" : "This ticket matches BEM. This pair's settlement contract is not attached, so confirm does not sign, does not take USDT, and does not buy spot." : board.length === 0 ? lang === "zh" ? "簿上没有别人的单。签下去只是把保证金挂进合约，不会马上成交。想先看盈亏，去模拟。" : "Nobody else is on the book. Signing only posts margin into the contract. It does not fill. Use the paper book if you want to see PnL first." : lang === "zh" ? "两链不能合成一笔。钱包不在这条链时，签名前会切过去。" : "The two chains do not net. If the wallet is on the other chain, it switches before the signature.") : "",
													onNo: () => setCard(null),
													onYes: () => {
														const long = card === "long";
														setCard(null);
														if (alt) {
															setBad(false);
															setNote(coin === "tape" ? lang === "zh" ? "TAPE 永续结算本还没部署。没有签名，USDT 没动。现货可以下单。" : "The TAPE perpetual book is not deployed. Nothing was signed and no USDT moved. Spot can still be ordered." : lang === "zh" ? `${base} 和 BEM 是同一张合约单。结算本还没接上，没有签名，USDT 没动。` : `${base} uses the same ticket as BEM. The settlement book is not attached, so nothing was signed and no USDT moved.`);
															return;
														}
														run(async (from) => {
															const before = view?.myDeal && view.myDeal > 0n ? view.myDeal.toString() : "0";
															if (reduceOnly && orderStyle !== "stop") {
																if (!view?.myDeal) throw new Error("flat");
																return closePerp(from, perp, view.myDeal);
															}
															const px = orderStyle === "limit" || orderStyle === "post" ? limit.trim() : markN > 0 ? markN.toFixed(4) : "";
															let tx;
															if (orderStyle === "post") tx = await openPostPerp(from, perp, long, margin, lev, px);
															else if (orderStyle === "scale") tx = await openScalePerp(from, perp, long, margin, lev, scaleA, scaleB, scaleN);
															else if (orderStyle === "chase") tx = await openPostPerp(from, perp, long, margin, lev, chasePx(long, markN, view?.quotes ?? []));
															else if (orderStyle === "trail") {
																if (!view?.myDeal || !(markN > 0)) throw new Error("flat");
																const dist = Number(trailPct) / 100;
																if (!(dist > 0 && dist < 0.5)) throw new Error("price");
																try {
																	tx = await armTrailPerp(from, perp, view.myDeal, Math.round(dist * 10000));
																} catch (err) {
																	if (!(err instanceof Error) || err.message !== "local") throw err;
																	writeArm({ account: from, perp, long: Boolean(view.long), tp: 0, sl: 0, spent: false, hold: false, deal: view.myDeal.toString(), trail: dist, peak: markN });
																	setTimeout(() => setNote(lang === "zh" ? "追踪记在这台浏览器。页面开着，回撤到了就平仓。" : "The trail sits in this browser and closes while the page is open."), 0);
																	return undefined;
																}
															}
															else if (orderStyle === "stop") {
																if (!reduceOnly) {
																	try {
																		tx = await openStopPerp(from, perp, long, margin, lev, stopPx);
																	} catch (err) {
																		if (!(err instanceof Error) || err.message !== "local") throw err;
																	}
																}
																if (!tx) {
																	const trigger = Number(stopPx);
																	if (!(trigger > 0)) throw new Error("price");
																	writeArm({ account: from, perp, long, tp: long ? trigger * 1.5 : trigger, sl: long ? trigger : trigger * 1.5, spent: false, hold: false, before, deal: "" });
																	setTimeout(() => setNote(lang === "zh" ? "止损记在这台浏览器。页面开着才会平仓。" : "This stop sits in this browser and closes while the page is open."), 0);
																	return undefined;
																}
															} else if (orderStyle === "twap") tx = await openTwapPerp(from, perp, long, margin, lev, twapN, twapGap);
															else tx = await (async () => {
																if (orderStyle !== "market" || slipBps <= 0) return openPerp(from, perp, long, margin, lev, px);
																const other = (view?.quotes ?? []).filter((quote) => quote.long !== long && quote.price > 0n);
																const best = other.reduce<(typeof other)[number] | null>((pick, quote) => {
																	if (!pick) return quote;
																	return long ? (quote.price < pick.price ? quote : pick) : quote.price > pick.price ? quote : pick;
																}, null);
																if (!best || !(markN > 0)) return openPerp(from, perp, long, margin, lev, px);
																const away = Math.abs(Number(formatUnits(best.price, 18)) - markN) / markN;
																if (away > slipBps / 10000) throw new Error("slip");
																return takePerp(from, perp, best.id, margin, lev, true);
															})();
															if (guard !== "off") {
																const entry = Number(limit) || markN;
																const band = guard === "easy" ? easyBand(entry, lev || 1, long) : {
																	tp: Number(tpText),
																	sl: Number(slText)
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
																		deal: ""
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
															k: lang === "zh" ? "链" : "Chain",
															v: chain === "xlayer" ? "X Layer · 196" : "BNB Smart Chain · 56"
														},
														{
															k: lang === "zh" ? "合约" : "Contract",
															v: coin === "tape" ? lang === "zh" ? "TAPE 永续 · 结算本未部署" : "TAPE perpetual · book not deployed" : alt ? lang === "zh" ? "与 BEM 同一类永续，结算本未接入" : "Same perpetual as BEM. Settlement book not attached." : perp,
															href: alt ? void 0 : `${scan}/address/${perp}`
														},
														{
															k: lang === "zh" ? "钱去哪" : "Where funds go",
															v: chain === "xlayer" ? lang === "zh" ? "保证金是 USDT0，锁进这份 X Layer 合约。千分之二进收费地址。" : "Margin is USDT0, locked in this X Layer contract. 0.2% goes to the fee address." : lang === "zh" ? "保证金是 BSC 的 USDT，锁进这份合约。千分之二进收费地址。" : "Margin is BSC USDT, locked in this contract. 0.2% goes to the fee address."
														},
														{
															k: lang === "zh" ? "保证金" : "Margin",
															v: `${margin || "—"} ${chain === "xlayer" ? "USDT0" : "USDT"} · ${lev || "—"}×`
														},
														{
															k: lang === "zh" ? "本单手续费" : "Fee",
															v: `${marginOk ? (Number(margin) * .002).toFixed(4) : "—"} ${chain === "xlayer" ? "USDT0" : "USDT"}`
														},
														{
															k: lang === "zh" ? "标记价" : "Mark",
															v: chain === "xlayer" ? lang === "zh" ? `标记读取 X Layer 的 OKB/BEM 与 USDT0/WOKB。${riskLive ? "资金费在多空之间结算。强平的一成进保险基金，不能提取。不够时只减另一笔浮盈。" : "没有资金费。没有保险基金。没有自动减仓。"}` : riskLive ? "Funding settles between the two sides. Insurance cannot be withdrawn. ADL takes profit only." : "No funding. No insurance fund. No auto-deleveraging." : lang === "zh" ? `Pancake 池大约 10 分钟均价。${riskLive ? "资金费在多空之间结算。强平的一成进保险基金，不能提取。不够时只减另一笔浮盈。" : "没有资金费。没有保险基金，没有自动减仓。"}` : riskLive ? "Funding settles between the two sides. Insurance cannot be withdrawn. ADL takes profit only." : "No funding. No insurance fund. No auto-deleveraging."
														},
														{
															k: lang === "zh" ? "强平" : "Liquidation",
															v: liqMove ? lang === "zh" ? `反向大约 ${liqMove}%，保证金亏一半就可以被强平` : `About ${liqMove}% the wrong way and half the margin can be liquidated` : "—"
														}
													]
												}) : null
											] }) : null,
											mine ? /* @__PURE__ */ jsx("button", {
												type: "button",
												className: "min-h-12 border border-gold",
												disabled: busy,
												onClick: () => run((from) => cancelPerp(from, perp), "cancel"),
												children: c.cancelPost
											}) : null,
											inDeal ? /* @__PURE__ */ jsx("button", {
												type: "button",
												className: "min-h-12 bg-ink text-paper",
												disabled: busy,
												onClick: () => run((from) => closePerp(from, perp, view && view.myDeal > 0n ? view.myDeal : void 0)),
												children: c.closeDeal
											}) : null,
											view?.underwater && account ? /* @__PURE__ */ jsx("button", {
												type: "button",
												className: "min-h-12 border border-sell text-sell",
												disabled: busy,
												onClick: () => run((from) => liquidatePerp(from, perp, account)),
												children: c.liqNow
											}) : null
										]
									})
								]
							})
						]
					}),
					account ? /* @__PURE__ */ jsxs("p", {
						className: "font-mono text-xs xl:col-span-12",
						children: [
							short$3(account),
							" · ",
							chain === "xlayer" ? "X Layer" : "BSC",
							bal ? ` · ${chain === "xlayer" ? "USDT0" : "USDT"} ${pretty(bal.usdt, dec, 2)} · ${chain === "xlayer" ? "OKB" : "BNB"} ${pretty(bal.bnb, 18, 4)}` : ""
						]
					}) : null,
					perp && bal && view && bal.usdt < view.min ? /* @__PURE__ */ jsx("p", {
						className: "text-sm text-sell xl:col-span-12",
						children: chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt
					}) : null,
					<div className="border-t border-gold xl:col-span-12">
						<div className="flex gap-1 overflow-x-auto px-2 pt-1">
							{([
								["bal", lang === "zh" ? "余额" : "Balances"],
								["pos", lang === "zh" ? "仓位" : "Positions"],
								["ord", lang === "zh" ? "当前委托" : "Open orders"],
								["twap", "TWAP"],
								["chase", lang === "zh" ? "追价" : "Chase"],
								["fill", lang === "zh" ? "历史成交" : "Trade history"],
								["fund", lang === "zh" ? "资金费历史" : "Funding"],
								["hist", lang === "zh" ? "历史委托" : "Order history"],
							] as const).map(([id, label]) => (
								<button key={id} type="button" onClick={() => setDock(id)} className={`h-8 shrink-0 px-2 text-xs ${dock === id ? "tab-on" : "text-ink/45"}`}>{label}</button>
							))}
						</div>
						<div className="min-h-14 px-3 py-2 text-xs">
							{dock === "pos" ? (
								account && view?.liveDeals.some((deal) => deal.long.toLowerCase() === account.toLowerCase() || deal.short.toLowerCase() === account.toLowerCase()) ? (
									<div className="flex flex-col gap-1 font-mono">
										{view.liveDeals.filter((deal) => deal.long.toLowerCase() === account.toLowerCase() || deal.short.toLowerCase() === account.toLowerCase()).map((deal) => {
											const mineLong = deal.long.toLowerCase() === account.toLowerCase();
											const pnl = mineLong ? deal.eqL - deal.marginL : deal.eqS - deal.marginS;
											const marginSide = mineLong ? deal.marginL : deal.marginS;
											const roe = marginSide > 0n ? Number(pnl) / Number(marginSide) * 100 : 0;
											const entry = Number(formatUnits(deal.entry, 18));
											const sideLev = (mineLong ? deal.levL : deal.levS) || 0;
											const liq = entry > 0 && sideLev > 0 ? (mineLong ? entry * (1 - 0.5 / sideLev) : entry * (1 + 0.5 / sideLev)) : 0;
											return (
												<p key={deal.id.toString()} className="flex flex-wrap items-center gap-2">
													<span>#{deal.id.toString()} {mineLong ? (lang === "zh" ? "多" : "Long") : lang === "zh" ? "空" : "Short"} · {pxText(deal.entry)}{prefs.showPnl ? ` · ${pnl >= 0n ? "+" : ""}${pretty(pnl, dec, 4)} · ${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%` : ""} · {lang === "zh" ? "强平" : "Liq"} {liq > 0 ? liq.toFixed(4) : "—"}</span>
													<button type="button" className="underline" disabled={busy} onClick={() => run((from) => closePerp(from, perp, deal.id), "close")}>{lang === "zh" ? "平仓" : "Close"}</button>
												</p>
											);
										})}
									</div>
								) : <p className="text-ink/45">{lang === "zh" ? "尚无开放仓位" : "No open position"}</p>
							) : null}
							{dock === "bal" ? (
								<p className="font-mono text-ink/70">{bal ? `${chain === "xlayer" ? "USDT0" : "USDT"} ${pretty(bal.usdt, dec, 2)} · ${chain === "xlayer" ? "OKB" : "BNB"} ${pretty(bal.bnb, 18, 4)}` : "—"}</p>
							) : null}
							{dock === "ord" ? (
								view?.quotes.some((quote) => account && quote.user.toLowerCase() === account.toLowerCase()) ? (
									<div className="flex flex-col gap-1 font-mono">
										{view.quotes.filter((quote) => account && quote.user.toLowerCase() === account.toLowerCase()).map((quote) => (
											<p key={quote.id.toString()} className="flex items-center gap-3">
												<span>#{quote.id.toString()} {quote.long ? (lang === "zh" ? "多" : "Long") : lang === "zh" ? "空" : "Short"} · {quote.price > 0n ? pxText(quote.price) : "—"} · {usdtText$1(quote.margin)}</span>
												<button type="button" className="underline" disabled={busy} onClick={() => run((from) => cancelPerp(from, perp, quote.id), "cancel")}>{lang === "zh" ? "撤销" : "Cancel"}</button>
											</p>
										))}
									</div>
								) : <p className="text-ink/45">{lang === "zh" ? "没有未成交的委托" : "No open orders"}</p>
							) : null}
							{dock === "twap" ? <p className="text-ink/45">{lang === "zh" ? "还没有 TWAP" : "No TWAPs"}</p> : null}
							{dock === "chase" ? <p className="text-ink/45">{lang === "zh" ? "还没有追价" : "No chase"}</p> : null}
							{dock === "fill" ? (
								fills.length ? (
									<div className="flex flex-col gap-1 font-mono">
										{fills.slice(0, 8).map((row) => (
											<a key={row.hash} className="underline" href={`${scan}/tx/${row.hash}`} target="_blank" rel="noreferrer">{new Date(row.t).toLocaleTimeString()} · {row.kind}</a>
										))}
									</div>
								) : <p className="text-ink/45">{lang === "zh" ? "尚无交易" : "No trades"}</p>
							) : null}
							{dock === "hist" ? (
								fills.length ? (
									<div className="flex flex-col gap-1 font-mono">
										{fills.slice(0, 8).map((row) => (
											<a key={`h-${row.hash}`} className="underline" href={`${scan}/tx/${row.hash}`} target="_blank" rel="noreferrer">{new Date(row.t).toLocaleString()} · {row.kind}</a>
										))}
									</div>
								) : <p className="text-ink/45">{lang === "zh" ? "尚无历史订单" : "No order history"}</p>
							) : null}
							{dock === "fund" ? (
								<p className="font-mono text-ink/70">{riskLive ? (lang === "zh" ? "本内结算" : "On this book") : lang === "zh" ? "不收" : "None"} · {fundClock(lang === "zh")}</p>
							) : null}
						</div>
					</div>,
					note ? /* @__PURE__ */ jsx("p", {
						className: `text-sm xl:col-span-12 ${bad ? "text-sell" : ""}`,
						children: note
					}) : null,
					hash ? /* @__PURE__ */ jsx("a", {
						className: "text-sm underline decoration-gold underline-offset-4 xl:col-span-12",
						href: `${scan}/tx/${hash}`,
						target: "_blank",
						rel: "noreferrer",
						children: c.walletTx
					}) : null
				]
			})
		}),
		levOpen ? /* @__PURE__ */ jsx(LevDialog, {
			zh: lang === "zh",
			lev,
			onLev: (next) => {
				setLev(next);
				setLevText(String(next));
				if (next > 20) setMode("pro");
			},
			onClose: () => setLevOpen(false)
		}) : null,
		marginOpen ? /* @__PURE__ */ jsx(MarginDialog, {
			zh: lang === "zh",
			onClose: () => setMarginOpen(false)
		}) : null,
		acctOpen ? /* @__PURE__ */ jsx(AccountDialog, {
			zh: lang === "zh",
			onClose: () => setAcctOpen(false)
		}) : null
	] });
}
function fundClock(zh: boolean): string {
  const slot = 8 * 3600 * 1000;
  const left = slot - (Date.now() % slot);
  const hh = Math.floor(left / 3600000);
  const mm = Math.floor((left % 3600000) / 60000);
  return zh ? `距下次 ${hh}时${String(mm).padStart(2, "0")}分` : `Next ${hh}h ${String(mm).padStart(2, "0")}m`;
}

function readFills(): { t: number; kind: string; hash: string }[] {
  if (typeof window === "undefined") return [];
  try {
    const rows = JSON.parse(window.localStorage.getItem("tapeliquid-fills-v1") ?? "[]") as { t: number; kind: string; hash: string }[];
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function pushFill(kind: string, hash: string) {
  const next = [{ t: Date.now(), kind, hash }, ...readFills().filter((row) => row.hash !== hash)].slice(0, 20);
  window.localStorage.setItem("tapeliquid-fills-v1", JSON.stringify(next));
  return next;
}

function chasePx(long: boolean, mark: number, quotes: { long: boolean; price: bigint }[]): string {
  const tick = mark >= 1 ? 0.01 : 0.0001;
  const bids = quotes.filter((quote) => quote.long && quote.price > 0n).map((quote) => Number(formatUnits(quote.price, 18)));
  const asks = quotes.filter((quote) => !quote.long && quote.price > 0n).map((quote) => Number(formatUnits(quote.price, 18)));
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
        {zh ? "开多" : "Long"} <span className={long >= 0 ? "text-gold" : "text-sell"}>{signed(long)} {unit}</span>
        {" · "}
        {zh ? "开空" : "Short"} <span className={short >= 0 ? "text-gold" : "text-sell"}>{signed(short)} {unit}</span>
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
