import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { copy } from "@/lib/copy";
import { BSC, connectBsc, pretty, units, type Balances } from "@/lib/bsc";
import { getCandles, type Candle, type CandleFrame } from "@/lib/candles";
import { currentAccount, onAccount, onOpenLink } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";
import { MineDesk } from "@/components/exchange/mine-desk";
import { nickOf, readNicks } from "@/lib/nicks";
import { clearArm, easyBand, readArm, writeArm, type Arm } from "@/lib/stops";
import {
  cancelPerp,
  closePerp,
  deployXLayer,
  bookOf,
  KNOWN_PERP,
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
  splitEquity,
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

function PkTape({ candles, entry, mark }: { candles: Candle[]; entry: number; mark: number }) {
  const drawn = candles.length
    ? candles
    : mark > 0
      ? [{ o: entry || mark, h: Math.max(entry || mark, mark), l: Math.min(entry || mark, mark), c: mark }]
      : [];
  if (!drawn.length) return null;
  const highs = drawn.map((candle) => candle.h);
  const lows = drawn.map((candle) => candle.l);
  const last = drawn[drawn.length - 1]?.c ?? mark;
  const refs = entry > 0 ? [...highs, ...lows, entry, last] : [...highs, ...lows, last];
  const lo = Math.min(...refs);
  const hi = Math.max(...refs);
  const span = hi - lo || 1;
  const w = 320;
  const h = 148;
  const pad = 8;
  const right = 52;
  const y = (v: number) => pad + ((hi - v) / span) * (h - pad * 2);
  const cw = (w - pad - right) / drawn.length;
  const label = (v: number) => v.toFixed(2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-40 w-full" role="img">
      <text x={w - 2} y={y(hi) + 4} textAnchor="end" fontSize="10" fill="#6e5014">{label(hi)}</text>
      <text x={w - 2} y={y(lo)} textAnchor="end" fontSize="10" fill="#9e1b12">{label(lo)}</text>
      <text x={w - 2} y={Math.min(h - 4, Math.max(12, y(last)))} textAnchor="end" fontSize="10" fill="#1c1408">{label(last)}</text>
      {entry > 0 ? (
        <line x1={pad} x2={w - right} y1={y(entry)} y2={y(entry)} stroke="#6e5014" strokeDasharray="3 3" strokeWidth="1" />
      ) : null}
      <line x1={pad} x2={w - right} y1={y(last)} y2={y(last)} stroke="#1c1408" strokeDasharray="1 3" strokeWidth="1" />
      {drawn.map((candle, i) => {
        const up = candle.c >= candle.o;
        const color = up ? "#6e5014" : "#9e1b12";
        const x = pad + i * cw + cw * 0.2;
        const body = Math.max(1.5, Math.abs(y(candle.o) - y(candle.c)));
        return (
          <g key={i}>
            <line x1={x + cw * 0.3} x2={x + cw * 0.3} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth="1" />
            <rect x={x} y={Math.min(y(candle.o), y(candle.c))} width={Math.max(2, cw * 0.6)} height={body} fill={color} />
          </g>
        );
      })}
    </svg>
  );
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
}) {
  const drawn = rows.map(({ perp, quote }) => {
    const px = quote.price > 0n ? Number(formatUnits(quote.price, 18)) : mark;
    const margin = Number(formatUnits(quote.margin, dec));
    const size = px > 0 ? (margin * quote.lev) / px : 0;
    return { perp, quote, px, margin, size };
  });
  const asks = drawn.filter((row) => !row.quote.long).sort((a, b) => b.px - a.px);
  const bids = drawn.filter((row) => row.quote.long).sort((a, b) => b.px - a.px);
  const [open, setOpen] = useState(false);
  const askRows = open ? asks : asks.slice(-5);
  const bidRows = open ? bids : bids.slice(0, 5);
  const hidden = asks.length + bids.length - askRows.length - bidRows.length;
  const zh = lang === "zh";
  const max = Math.max(1, ...drawn.map((row) => row.size));
  const line = (row: (typeof drawn)[number], buy: boolean) => {
    const mine = Boolean(account && row.quote.user.toLowerCase() === account.toLowerCase());
    const width = `${Math.max(8, Math.round((row.size / max) * 100))}%`;
    return (
      <div
        key={`${row.perp}-${row.quote.id}`}
        role={mine ? undefined : "button"}
        tabIndex={mine ? undefined : 0}
        onClick={() => {
          if (!mine && !busy) onTake(row.perp, row.quote);
        }}
        onKeyDown={(event) => {
          if (!mine && !busy && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            onTake(row.perp, row.quote);
          }
        }}
        className={`relative grid w-full grid-cols-[4.5rem_1fr_1fr_auto] items-center gap-2 px-2 py-1.5 text-left font-mono text-sm tabular-nums ${mine ? "" : "cursor-pointer"}`}
      >
        <span className="absolute inset-y-1 left-0" style={{ width, background: buy ? "rgba(158,27,18,0.12)" : "rgba(30,110,70,0.14)" }} />
        <span className={`relative ${buy ? "text-sell" : "text-[#1b6b45]"}`}>{row.px > 0 ? row.px.toFixed(4) : "—"}</span>
        <span className="relative">{row.size.toFixed(2)}</span>
        <span className="relative">{row.margin.toFixed(2)}</span>
        <span className="relative flex items-center gap-1">
          <span className="hidden border border-gold/40 px-1 text-xs sm:inline">≤{Math.max(1, Math.round(row.size))}</span>
          {mine ? (
            <span className="px-2 text-xs text-ink/50">{zh ? "我的" : "Mine"}</span>
          ) : (
            <button type="button" disabled={busy} onClick={(event) => { event.stopPropagation(); onTake(row.perp, row.quote); }} className={`min-h-9 px-3 text-paper ${buy ? "bg-sell" : "bg-[#1b6b45]"}`}>
              {buy ? (zh ? "开多吃" : "Buy") : zh ? "开空吃" : "Sell"}
            </button>
          )}
          <a className="text-xs text-ink/50 underline" href={`${scan}/address/${row.quote.user}`} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            {named(row.quote.user).slice(0, 6)}
          </a>
        </span>
      </div>
    );
  };
  return (
    <div>
      <div className="grid grid-cols-[4.5rem_1fr_1fr_auto] gap-2 px-2 py-1 text-xs text-ink/50">
        <span>{zh ? "价格" : "Price"}</span>
        <span>{zh ? "数量 BEM" : "Size BEM"}</span>
        <span>{zh ? "保证金" : "Margin"}</span>
        <span className="text-right">{zh ? "指定成交" : "Take"}</span>
      </div>
      {asks.length === 0 && bids.length === 0 ? <p className="px-2 py-3 text-sm text-ink/60">{zh ? "这口价附近还没有挂单。" : "No orders near this price."}</p> : null}
      {asks.length > askRows.length ? <p className="px-2 py-1 text-xs text-ink/50">{zh ? `上面还有 ${asks.length - askRows.length} 张` : `${asks.length - askRows.length} more above`}</p> : null}
      {askRows.map((row) => line(row, true))}
      <p className="my-1 flex items-center gap-3 px-2 font-mono text-sm text-ink/70">
        <span className="h-px flex-1 bg-gold/40" />
        <span>{mark > 0 ? `${mark.toFixed(4)} USD` : "—"}</span>
        <span className="h-px flex-1 bg-gold/40" />
      </p>
      {bidRows.map((row) => line(row, false))}
      {bids.length > bidRows.length ? <p className="px-2 py-1 text-xs text-ink/50">{zh ? `下面还有 ${bids.length - bidRows.length} 张` : `${bids.length - bidRows.length} more below`}</p> : null}
      {hidden > 0 || (open && asks.length + bids.length > 10) ? (
        <button type="button" className="min-h-11 w-full border-t border-gold/40 text-sm" onClick={() => setOpen((value) => !value)}>
          {open ? (zh ? "收起" : "Fold") : zh ? `展开其余 ${hidden} 张` : `Show ${hidden} more`}
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
  const [perp, setPerp] = useState(savedDesk() === "xlayer" ? bookOf("xlayer") : KNOWN_PERP);
  const [redeploy, setRedeploy] = useState(false);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [view, setView] = useState<PerpView | null>(null);
  const [margin, setMargin] = useState("1");
  const [lev, setLev] = useState(1);
  const [mode, setMode] = useState<"easy" | "pro">("easy");
  const [sheet, setSheet] = useState<"book" | "mine">("book");
  const [levText, setLevText] = useState("1");
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
  const firing = useRef(false);

  useEffect(() => {
    if (!account) return;
    setArm(readArm(account, perp));
  }, [account, perp, hash]);

  useEffect(() => {
    if (!account || !view || view.myDeal <= 0n || firing.current) return;
    const row = readArm(account, perp);
    if (!row || row.spent) return;
    const px = live && live > 0 ? live : view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0;
    if (!(px > 0)) return;
    const hit = row.long ? px >= row.tp || px <= row.sl : px <= row.tp || px >= row.sl;
    if (!hit) return;
    firing.current = true;
    const spent = { ...row, spent: true };
    writeArm(spent);
    setArm(spent);
    run((from) => closePerp(from, perp, view.myDeal))
      .catch(() => {
        const back = { ...row, spent: false };
        writeArm(back);
        setArm(back);
      })
      .finally(() => {
        firing.current = false;
      });
  }, [account, perp, view?.myDeal, view?.mark, live, hash]);

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
    else if (message === "revert") setNote(c.perpRevert);
    else if (code === 4001) setNote(c.walletReject);
    else if (/RPC|publicnode|Archive|Invalid param/i.test(message)) setNote(c.rpcWait);
    else if (message === "margin") setNote(`${floor}–500 USDT`);
    else if (message === "price") setNote(c.badPrice);
    else if (message === "lev") setNote(c.levCap);
    else if (message === "code") setNote(lang === "zh" ? "推荐码用 1 到 16 个英文字，汉字最多 5 个。" : "Use 1 to 16 English characters, or up to 5 Chinese characters.");
    else if (message === "taken") setNote(c.rebateTaken);
    else if (message === "have") setNote(c.rebateHave);
    else setNote(message || c.walletReject);
    setBad(true);
  };

  const run = async (task: (from: string) => Promise<unknown>) => {
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
      fail(err);
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
  const priceOk = ticketPx >= 10n ** 16n && ticketPx <= 100_000n * 10n ** 18n;
  const ticket = plan(margin, levOk ? lev : 1, ticketPx);
  let need = 0n;
  try {
    need = units(margin, dec);
  } catch {
    need = 0n;
  }
  const easy = floor <= 1
    ? [
        { id: "try", margin: "1", lev: 1 },
        { id: "daily", margin: "5", lev: 1 },
        { id: "push", margin: "10", lev: 2 },
      ]
    : presets;
  const markN = live && live > 0 ? live : view && view.mark > 0n ? Number(formatUnits(view.mark, 18)) : 0;
  const markWei = markN > 0 ? parseUnits(markN.toFixed(8), 18) : 0n;
  const split = view?.dealOpen ? splitEquity(view.dealBase, view.dealEntry, markWei, view.marginL, view.marginS) : null;
  const lead = split ? (split.eqL === split.eqS ? "flat" : split.eqL > split.eqS ? "long" : "short") : null;
  const entryN = view && view.dealEntry > 0n ? Number(formatUnits(view.dealEntry, 18)) : 0;
  const pick = (nextMargin: string, nextLev: number) => {
    setMargin(nextMargin);
    setLev(nextLev);
    setLevText(String(nextLev));
  };

  return (
    <section className="border border-gold bg-card shadow-plate">
      <div className="flex flex-col gap-3 p-3">
        <p className="text-sm leading-relaxed text-ink/80">{chain === "xlayer" ? c.perpWarnX : c.perpWarn}</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`min-h-12 border border-gold ${chain === "bsc" ? "bg-ink text-paper" : ""}`}
            onClick={() => {
              selectDesk("bsc");
              setChain("bsc");
              setPerp(KNOWN_PERP);
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
          <p className="text-sm leading-relaxed">{c.xOpen}</p>
        ) : null}
        {chain === "xlayer" && !/^0x[a-fA-F0-9]{40}$/.test(perp) ? (
          <button
            type="button"
            className="min-h-12 bg-ink text-paper"
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
          <button type="button" className="min-h-11 border border-gold" disabled={busy} onClick={() => run((from) => pushMark(from).then(() => "ok"))}>
            {c.pushMark}
          </button>
        ) : null}
        {link ? (
          <a href={link} className="inline-flex min-h-12 items-center justify-center bg-ink px-3 text-paper">
            {c.signOkx}
          </a>
        ) : null}
        <p className="border border-gold/40 px-3 py-2">
          <span className="block text-xs tracking-widest text-gold">{c.yourEq}</span>
          <span className="font-mono text-2xl tabular-nums">{view && account ? usdtText(view.equity) : "—"}</span>
        </p>
        <div className="border border-gold bg-card">
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
          <div className="grid grid-cols-6 gap-1 px-2 pt-2">
            {(["15s", "1m", "5m", "15m", "1h", "4h"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setFrame(item)} className={`min-h-9 border border-gold font-mono text-xs ${frame === item ? "bg-ink text-paper" : ""}`}>
                {item}
              </button>
            ))}
          </div>
          <PkTape candles={prices} entry={entryN} mark={markN} />
          <DeskLadder
            rows={board}
            mark={markN}
            account={account}
            busy={busy}
            dec={dec}
            scan={scan}
            named={named}
            lang={lang}
            onTake={(book, quote) => run((from) => takePerp(from, book, quote.id, formatUnits(quote.margin, dec), quote.lev, quote.price > 0n))}
          />
          <p className="px-3 py-2 text-xs text-ink/50">
            {lang === "zh"
              ? "上面红的是空单，点整行或「开多吃」。下面绿的是多单，点整行或「开空吃」。自己的单写着「我的」。靠近现价的各留 5 张，其余可以展开。"
              : "Red rows above are shorts. Tap the row or Buy. Green rows below are longs. Tap the row or Sell. Yours says Mine. Five stay next to the price. The rest can open."}
          </p>
        </div>
        <div className="border border-gold/40 p-3">
          <p className="text-xs tracking-widest text-gold">{c.pkTitle}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <p>
              <span className="block text-xs text-gold">{c.pkLong}</span>
              <a className="break-all font-mono text-xs underline decoration-gold" href={view?.dealOpen ? `${scan}/address/${view.longAddr}` : view && waiting && view.pendingLong ? `${scan}/address/${view.pendingUser}` : undefined}>
                {view?.dealOpen ? short(view.longAddr) : waiting && view?.pendingLong ? short(view.pendingUser) : c.pkEmpty}
              </a>
              <span className="mt-1 block font-mono text-sm tabular-nums">{split ? `${usdtText(split.eqL)} USDT` : waiting && view?.pendingLong ? `${usdtText(view.pendingMargin)}` : "—"}</span>
            </p>
            <p className="text-right">
              <span className="block text-xs text-sell">{c.pkShort}</span>
              <a className="break-all font-mono text-xs underline decoration-gold" href={view?.dealOpen ? `${scan}/address/${view.shortAddr}` : view && waiting && !view.pendingLong ? `${scan}/address/${view.pendingUser}` : undefined}>
                {view?.dealOpen ? short(view.shortAddr) : waiting && view && !view.pendingLong ? short(view.pendingUser) : c.pkEmpty}
              </a>
              <span className="mt-1 block font-mono text-sm tabular-nums">{split ? `${usdtText(split.eqS)} USDT` : waiting && view && !view.pendingLong ? `${usdtText(view.pendingMargin)}` : "—"}</span>
            </p>
          </div>
          <div className="mt-2 h-3 overflow-hidden border border-gold/40">
            <div className="h-full bg-ink" style={{ width: split && split.eqL + split.eqS > 0n ? `${Number((split.eqL * 1000n) / (split.eqL + split.eqS)) / 10}%` : "50%" }} />
          </div>
          <p className="mt-2 text-sm">
            {lead === "long" ? `${c.pkLong}${c.pkLead}` : lead === "short" ? `${c.pkShort}${c.pkLead}` : c.pkFlat}
            {entryN > 0 ? ` · ${entryN.toFixed(2)} → ${markN.toFixed(2)}` : markN > 0 ? ` · $${markN.toFixed(2)}` : ""}
          </p>
          <p className="text-xs leading-relaxed text-ink/60">{c.pkNote}</p>
        </div>
        {/^0x[a-fA-F0-9]{40}$/.test(perp) && (
          <>
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
                  <span className="block text-xs tracking-widest text-gold">{view?.long ? c.postLong : c.postShort}</span>
                  <span className="font-mono">{pretty(view?.base ?? 0n, 18, 4)} BEM</span>
                </p>
                <p className="border border-gold/40 px-2 py-2">
                  <span className="block text-xs tracking-widest text-gold">{c.perpMark}</span>
                  <span className="font-mono">{pxText(view?.entry ?? 0n)}</span>
                </p>
                <p className="border border-gold/40 px-2 py-2">
                  <span className="block text-xs tracking-widest text-gold">{c.yourEq}</span>
                  <span className="font-mono">{usdtText(view?.equity ?? 0n)} USDT</span>
                </p>
                <p className="border border-gold/40 px-2 py-2">
                  <span className="block text-xs tracking-widest text-gold">{c.waitQuote}</span>
                  <span className="font-mono">{view?.other ? short(view.other) : "—"}</span>
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
                      <p className="text-sm text-ink/60">{c.pkEmpty}</p>
                    ) : null}
                    {view.quotes
                      .filter((quote) => account && quote.user.toLowerCase() === account.toLowerCase())
                      .map((quote) => (
                          <div key={String(quote.id)} className="border border-gold/40 px-2 py-2">
                            <p className="font-mono text-sm">
                              #{quote.id.toString()} · {quote.long ? c.postLong : c.postShort} · {usdtText(quote.margin)} USDT · {quote.lev}×{quote.price > 0n ? ` · $${pxText(quote.price)}` : ""}
                            </p>
                            <p className="mt-1 font-mono text-xs text-ink/70">{c.openPnl}</p>
                            <button type="button" className="mt-2 min-h-11 border border-gold px-3" disabled={busy} onClick={() => run((from) => cancelPerp(from, perp, quote.id))}>
                              {c.cancelPost}
                            </button>
                          </div>
                        ))}
                  </>
                ) : null}
                {view.liveDeals.map((deal) => {
                  if (sheet !== "mine") return null;
                  const mineDeal = Boolean(account && (deal.long.toLowerCase() === account.toLowerCase() || deal.short.toLowerCase() === account.toLowerCase()));
                  if (sheet === "mine" && !mineDeal) return null;
                  const mineLong = Boolean(account && deal.long.toLowerCase() === account.toLowerCase());
                  const pnl = mineLong ? deal.eqL - deal.marginL : deal.eqS - deal.marginS;
                  const ahead = deal.eqL === deal.eqS ? c.pkFlat : deal.eqL > deal.eqS ? `${c.pkLong}${c.pkLead}` : `${c.pkShort}${c.pkLead}`;
                  return (
                    <div key={String(deal.id)} className="border border-gold/40 px-2 py-2 text-sm">
                      <p className="font-mono text-xs">
                        {c.pkLong} {named(deal.long)} · {usdtText(deal.eqL)}
                      </p>
                      <p className="font-mono text-xs">
                        {c.pkShort} {named(deal.short)} · {usdtText(deal.eqS)}
                      </p>
                      <p className="mt-1">{ahead}</p>
                      {mineDeal ? (
                        <p className={`mt-1 font-mono ${pnl >= 0n ? "text-gold" : "text-sell"}`}>
                          {c.pnl} {pnl >= 0n ? "+" : ""}{pretty(pnl, dec, 4)} USDT
                        </p>
                      ) : null}
                      {mineDeal ? (
                        <button type="button" className="mt-2 min-h-11 bg-ink px-3 text-paper" disabled={busy} onClick={() => run((from) => closePerp(from, perp, deal.id))}>
                          {c.closeDeal}
                        </button>
                      ) : null}
                      {deal.weakL || deal.weakS ? (
                        <button type="button" className="mt-2 min-h-11 border border-sell px-3 text-sell" disabled={busy} onClick={() => run((from) => liquidatePerp(from, perp, deal.id))}>
                          {c.liqNow}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </>
            ) : null}
            {sheet === "mine" || !view?.book ? (
            <MineDesk
              account={account}
              busy={busy}
              chain={chain}
              run={run}
              onBook={(addr) => setPerp(addr)}
              onChain={(next) => {
                selectDesk(next);
                setChain(next);
                setPerp(bookOf(next));
              }}
              addresses={Array.from(
                new Map(
                  [...(view?.quotes ?? []).map((quote) => quote.user), ...(view?.liveDeals ?? []).flatMap((deal) => [deal.long, deal.short])]
                    .filter((addr) => account && addr.toLowerCase() !== account.toLowerCase() && addr !== zero)
                    .map((addr) => [addr.toLowerCase(), addr]),
                ).values(),
              )}
            />
            ) : null}
            {(view?.book ? sheet === "book" : !inDeal && !mine) ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setMode("easy")} className={`min-h-11 border border-gold ${mode === "easy" ? "bg-ink text-paper" : ""}`}>
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
                <div className="grid grid-cols-4 gap-2">
                  {[10, 20, 30, 50, 100, 200, 500, 1000].map((item) => (
                    <button key={item} type="button" onClick={() => pick(margin, item)} className={`min-h-11 border border-gold font-mono text-xs ${lev === item ? "bg-ink text-paper" : ""}`}>
                      {item}×
                    </button>
                  ))}
                </div>
                <label className="border border-gold/40 px-3 py-2">
                  <span className="block text-xs tracking-widest text-gold">{c.limitPrice}</span>
                  <input
                    value={limit}
                    onChange={(event) => setLimit(event.target.value)}
                    inputMode="decimal"
                    className="w-full bg-transparent font-mono text-3xl outline-none"
                  />
                </label>
                <button
                  type="button"
                  className="min-h-11 border border-gold"
                  onClick={() => {
                    if (view?.mark) setLimit(formatUnits(view.mark, 18).slice(0, 8));
                  }}
                >
                  {c.useMark}{view?.mark ? ` $${pxText(view.mark)}` : ""}
                </button>
                <p className="text-sm leading-relaxed text-ink/70">{c.priceNote}</p>
                <div className="border border-gold/40 p-3">
                  <div className="grid grid-cols-3 gap-2">
                    {(["easy", "pro", "off"] as const).map((item) => (
                      <button key={item} type="button" onClick={() => setGuard(item)} className={`min-h-11 border border-gold text-sm ${guard === item ? "bg-ink text-paper" : ""}`}>
                        {item === "easy" ? c.stopEasy : item === "pro" ? c.stopPro : c.stopClear}
                      </button>
                    ))}
                  </div>
                  {guard === "pro" ? (
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
                  ) : null}
                  {guard === "easy" && markN > 0 ? (
                    <p className="mt-2 font-mono text-sm tabular-nums">
                      {c.stopTp} ${easyBand(Number(limit) || markN, lev || 1, true).tp.toFixed(2)} · {c.stopSl} ${easyBand(Number(limit) || markN, lev || 1, true).sl.toFixed(2)}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs leading-relaxed text-ink/60">{c.stopNote}</p>
                  {arm && !arm.spent ? (
                    <p className="mt-2 font-mono text-sm">
                      {c.stopArmed} · {c.stopTp} ${arm.tp.toFixed(2)} · {c.stopSl} ${arm.sl.toFixed(2)}
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
                    <span className="font-mono tabular-nums">{levOk ? `${Math.max(0.05, Math.round((5000 / lev)) / 100)}%` : "—"}</span>
                  </p>
                </div>
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
                    className="min-h-12 bg-ink text-paper"
                    disabled={busy || !levOk || !marginOk || !priceOk || !view?.priced || Boolean(!view?.book && waiting && view?.pendingLong)}
                    onClick={() =>
                      run(async (from) => {
                        const entry = Number(limit) || markN;
                        if (guard !== "off" && entry > 0) {
                          const band = guard === "easy" ? easyBand(entry, lev || 1, true) : { tp: Number(tpText), sl: Number(slText) };
                          if (band.tp > 0 && band.sl > 0) {
                            const next = { account: from, perp, long: true, tp: band.tp, sl: band.sl, spent: false };
                            writeArm(next);
                            setArm(next);
                          }
                        }
                        return openPerp(from, perp, true, margin, lev, limit);
                      })
                    }
                  >
                    {waiting && view && !view.pendingLong ? c.pullQuote : `${c.postLong} · ${margin || "1"} USDT`}
                  </button>
                  <button
                    type="button"
                    className="min-h-12 border border-gold"
                    disabled={busy || !levOk || !marginOk || !priceOk || !view?.priced || Boolean(!view?.book && waiting && !view?.pendingLong)}
                    onClick={() =>
                      run(async (from) => {
                        const entry = Number(limit) || markN;
                        if (guard !== "off" && entry > 0) {
                          const band = guard === "easy" ? easyBand(entry, lev || 1, false) : { tp: Number(tpText), sl: Number(slText) };
                          if (band.tp > 0 && band.sl > 0) {
                            const next = { account: from, perp, long: false, tp: band.tp, sl: band.sl, spent: false };
                            writeArm(next);
                            setArm(next);
                          }
                        }
                        return openPerp(from, perp, false, margin, lev, limit);
                      })
                    }
                  >
                    {waiting && view?.pendingLong ? c.pullQuote : `${c.postShort} · ${margin || "1"} USDT`}
                  </button>
                </div>
              </>
            ) : null}
            {mine ? (
              <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => run((from) => cancelPerp(from, perp))}>
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
          </>
        )}
        {account ? (
          <p className="font-mono text-xs">
            {short(account)} · {chain === "xlayer" ? "X Layer" : "BSC"}
            {bal
              ? ` · ${chain === "xlayer" ? "USDT0" : "USDT"} ${pretty(bal.usdt, dec, 2)} · ${chain === "xlayer" ? "OKB" : "BNB"} ${pretty(bal.bnb, 18, 4)}`
              : ""}
          </p>
        ) : null}
        {perp && bal && view && bal.usdt < view.min ? (
          <p className="text-sm text-sell">{chain === "xlayer" ? c.perpNeedX : c.perpNeedUsdt}</p>
        ) : null}
        {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        {hash ? (
          <a className="text-sm underline decoration-gold underline-offset-4" href={`${scan}/tx/${hash}`} target="_blank" rel="noreferrer">
            {c.walletTx}
          </a>
        ) : null}
      </div>
    </section>
  );
}
