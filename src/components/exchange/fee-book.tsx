import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { BSC } from "@/lib/bsc";
import {
  BSC_FEE_TOKENS,
  FEE,
  feeBalances,
  feeDecimals,
  feeHead,
  feeLabel,
  feeText,
  pullBsc,
  pullX,
  rowKey,
  sgtBounds,
  sgtStamp,
  type FeeBalance,
  type FeeChain,
  type FeeRow,
} from "@/lib/fee-book";
import { useExchange } from "@/lib/exchange-store";
import { XLAYER } from "@/lib/xlayer";

const KEY = "tapeliquid-fee-book-v1";

type Cache = { rows: FeeRow[]; xLo: number; xHi: number; bscLo: Record<string, number>; bscHi: Record<string, number> };

function emptyCache(): Cache {
  return { rows: [], xLo: 0, xHi: 0, bscLo: {}, bscHi: {} };
}

function load(): Cache {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyCache();
    const parsed = JSON.parse(raw) as Cache;
    return { rows: parsed.rows ?? [], xLo: parsed.xLo ?? 0, xHi: parsed.xHi ?? 0, bscLo: parsed.bscLo ?? {}, bscHi: parsed.bscHi ?? {} };
  } catch {
    return emptyCache();
  }
}

function save(cache: Cache) {
  try { window.localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* the screen still holds this pass */ }
}

function merge(rows: FeeRow[], extra: FeeRow[]): FeeRow[] {
  const map = new Map<string, FeeRow>();
  for (const row of rows) map.set(rowKey(row), row);
  for (const row of extra) map.set(rowKey(row), row);
  return [...map.values()].sort((a, b) => b.block - a.block || b.i - a.i).slice(0, 4000);
}

function coverTs(tip: bigint, ts: number, lo: bigint, sec: number): number {
  if (ts <= 0 || lo <= 0n) return 0;
  return ts - Math.round(Number(tip - lo) * sec);
}

function reached(bound: number, chain: FeeChain | "all", xReach: number, bReach: number): boolean {
  if (chain === "x") return xReach > 0 && xReach <= bound;
  if (chain === "bsc") return bReach > 0 && bReach <= bound;
  return xReach > 0 && bReach > 0 && xReach <= bound && bReach <= bound;
}

function sgtDay(ts: number): string {
  if (!ts) return "—";
  const sgt = new Date(ts * 1000 + 8 * 3600 * 1000);
  const m = String(sgt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(sgt.getUTCDate()).padStart(2, "0");
  return `${sgt.getUTCFullYear()}-${m}-${d}`;
}

type Bucket = { inn: bigint; out: bigint; n: number };

function bucket(): Bucket {
  return { inn: 0n, out: 0n, n: 0 };
}

function addBucket(map: Map<string, Bucket>, key: string, dir: "in" | "out", amount: bigint) {
  const row = map.get(key) ?? bucket();
  if (dir === "in") row.inn += amount;
  else row.out += amount;
  row.n += 1;
  map.set(key, row);
}

function cell(n: bigint, token: string): string {
  return n > 0n ? feeText(n, feeDecimals(token)) : "—";
}

const IN = "text-[#0c9a6b]";
const OUT = "text-[#d64545]";

const SWATCH: Record<string, string> = {
  USDT: "#0c8f6a",
  OKB: "#c48a12",
  WOKB: "#c48a12",
  BNB: "#d4a017",
  WBNB: "#d4a017",
  TAPE: "#3f62b5",
  BEM: "#7c5cbf",
  BTCB: "#e07a12",
  ETH: "#4d74d6",
  ZEC: "#2f8f84",
  XAUT: "#b0893e",
};

function swatch(symbol: string): string {
  return SWATCH[symbol.split("·")[0].toUpperCase()] ?? "#6b6258";
}

function Name({ text }: { text: string }) {
  return <span style={{ color: swatch(text) }}>{text}</span>;
}

function Chain({ id }: { id: FeeChain }) {
  return <span style={{ color: id === "x" ? "#3f62b5" : "#c48a12" }}>{id === "x" ? "X Layer" : "BSC"}</span>;
}

export function FeeBook() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<FeeChain | "all">("all");
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [bals, setBals] = useState<FeeBalance[] | null>(null);
  const [note, setNote] = useState("");
  const [xLo, setXLo] = useState(0n);
  const [bscLo, setBscLo] = useState(0n);
  const [head, setHead] = useState<{ x: { tip: bigint; ts: number }; bsc: { tip: bigint; ts: number } } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    const cache = load();
    setRows(cache.rows);
    setNote(zh ? "正在读收费地址。" : "Reading the fee address.");
    feeBalances().then((next) => { if (!dead) setBals(next); }).catch(() => { if (!dead) setBals([]); });
    feeHead().then(async (next) => {
      if (dead) return;
      setHead(next);
      const monthFloorX = next.x.tip > 86400n * 31n ? next.x.tip - 86400n * 31n : 0n;
      const dayFloorX = next.x.tip > 90000n ? next.x.tip - 90000n : 0n;
      const monthFloorB = next.bsc.tip - BigInt(Math.floor((86400 * 31) / 0.45));
      const dayFloorB = next.bsc.tip - BigInt(Math.floor(90000 / 0.45));
      let book = cache.rows;
      let lo = cache.xLo > 0 ? BigInt(cache.xLo) : next.x.tip + 1n;
      let hi = cache.xHi > 0 ? BigInt(cache.xHi) : 0n;
      const bLo = { ...cache.bscLo };
      const bHi = { ...cache.bscHi };
      const publish = () => {
        if (dead) return;
        setRows(book);
        setXLo(lo > next.x.tip ? 0n : lo);
        const lows = BSC_FEE_TOKENS.map((row) => BigInt(bLo[row.token] ?? 0));
        setBscLo(lows.reduce((m, n) => (n > 0n && (m === 0n || n > m) ? n : m), 0n));
        save({ rows: book, xLo: Number(lo > next.x.tip ? next.x.tip : lo), xHi: Number(hi), bscLo: bLo, bscHi: bHi });
      };
      const walkX = async (from: bigint, to: bigint) => {
        let cursor = to;
        while (!dead && cursor >= from && cursor > 0n) {
          const start = cursor - 89n < from ? from : cursor - 89n;
          try {
            book = merge(book, await pullX(start, cursor, Number(next.x.tip), next.x.ts));
          } catch { /* a missed slice is not zero */ }
          if (lo === 0n || start < lo) lo = start;
          if (cursor > hi) hi = cursor;
          publish();
          cursor = start - 1n;
          await new Promise((resolve) => window.setTimeout(resolve, 40));
        }
      };
      const walkB = async (token: `0x${string}`, from: bigint, to: bigint) => {
        let cursor = to;
        while (!dead && cursor >= from && cursor > 0n) {
          const start = cursor - 2999n < from ? from : cursor - 2999n;
          try {
            book = merge(book, await pullBsc(token, start, cursor, Number(next.bsc.tip), next.bsc.ts));
          } catch {
            if (!bLo[token] || Number(cursor) < bLo[token]) bLo[token] = Number(cursor);
            publish();
            return;
          }
          if (!bLo[token] || Number(start) < bLo[token]) bLo[token] = Number(start);
          if (!bHi[token] || Number(cursor) > bHi[token]) bHi[token] = Number(cursor);
          publish();
          cursor = start - 1n;
        }
      };
      if (hi > 0n && next.x.tip > hi) await walkX(hi + 1n, next.x.tip);
      await walkX(dayFloorX, lo - 1n);
      for (const token of BSC_FEE_TOKENS) {
        if (dead) return;
        const seenHi = bHi[token.token] ? BigInt(bHi[token.token]) : 0n;
        const seenLo = bLo[token.token] ? BigInt(bLo[token.token]) : next.bsc.tip + 1n;
        if (seenHi > 0n && next.bsc.tip > seenHi) await walkB(token.token, seenHi + 1n, next.bsc.tip);
        await walkB(token.token, dayFloorB > 0n ? dayFloorB : 0n, seenLo - 1n);
      }
      if (!dead) setNote(zh ? "今日先读完。接着往本月前面读。关掉再打开，从上次停的地方继续。" : "Today is in. Reading back through the month. Close and reopen to resume.");
      await walkX(monthFloorX, dayFloorX > 0n ? dayFloorX - 1n : 0n);
      for (const token of BSC_FEE_TOKENS) {
        if (dead) return;
        const seenLo = bLo[token.token] ? BigInt(bLo[token.token]) : dayFloorB;
        await walkB(token.token, monthFloorB > 0n ? monthFloorB : 0n, seenLo - 1n);
      }
      if (!dead) setNote(zh ? "本月这一段读完了。再早的不在这一页。" : "This month is read. Older than that is not on this page.");
    }).catch(() => { if (!dead) setNote(zh ? "节点这一次没给。不写成 0。" : "The node missed. It is not shown as zero."); });
    return () => { dead = true; };
  }, [open, zh]);

  const bounds = sgtBounds(Math.floor(Date.now() / 1000));
  const shown = rows.filter((row) => chain === "all" || row.chain === chain);
  const xReach = head && xLo > 0n ? coverTs(head.x.tip, head.x.ts, xLo, 1) : 0;
  const bReach = head && bscLo > 0n ? coverTs(head.bsc.tip, head.bsc.ts, bscLo, 0.45) : 0;
  const dayDone = reached(bounds.day, chain, xReach, bReach);
  const monthDone = reached(bounds.month, chain, xReach, bReach);
  const books = useMemo(() => {
    const byToken = new Map<string, Bucket>();
    const byDay = new Map<string, Bucket>();
    for (const row of shown) {
      const amount = BigInt(row.amount);
      const tokenKey = `${row.chain}:${row.token}`;
      if (row.ts >= bounds.day) addBucket(byToken, `day:${tokenKey}`, row.dir, amount);
      if (row.ts >= bounds.month) addBucket(byToken, `mon:${tokenKey}`, row.dir, amount);
      addBucket(byToken, `all:${tokenKey}`, row.dir, amount);
      if (row.ts >= bounds.month) addBucket(byDay, `${sgtDay(row.ts)}:${tokenKey}`, row.dir, amount);
    }
    const tokens = [...new Set(shown.map((row) => `${row.chain}:${row.token}`))].map((key) => {
      const [ch, token] = key.split(":") as [FeeChain, string];
      const day = byToken.get(`day:${key}`) ?? bucket();
      const mon = byToken.get(`mon:${key}`) ?? bucket();
      const all = byToken.get(`all:${key}`) ?? bucket();
      return { chain: ch, token, day, mon, all };
    }).sort((a, b) => (a.mon.inn + a.mon.out > b.mon.inn + b.mon.out ? -1 : 1));
    const days = [...byDay.entries()].map(([key, val]) => {
      const cut = key.indexOf(":");
      const day = key.slice(0, cut);
      const rest = key.slice(cut + 1);
      const sep = rest.indexOf(":");
      const ch = rest.slice(0, sep) as FeeChain;
      const token = rest.slice(sep + 1);
      return { day, chain: ch, token, ...val };
    }).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.inn > b.inn ? -1 : 1));
    return { tokens, days };
  }, [shown, bounds.day, bounds.month]);
  const held = (bals ?? []).filter((row) => (chain === "all" || row.chain === chain) && row.amount > 0n);
  const balOf = (ch: FeeChain, token: string) => held.find((row) => row.chain === ch && row.token.toLowerCase() === token.toLowerCase());

  return (
    <>
      <button
        type="button"
        aria-label={zh ? "收费账本" : "Fee book"}
        title={zh ? "收费账本" : "Fee book"}
        className="inline-flex size-5 items-center justify-center"
        onClick={() => setOpen(true)}
      >
        <span className="size-1.5 rounded-full bg-[#c6a15b]" />
      </button>
      {open ? createPortal(
        <div className="fixed inset-0 z-[120] bg-[#1c1712]/55" onClick={() => setOpen(false)}>
          <section
            className="absolute inset-x-0 top-11 bottom-0 flex flex-col overflow-hidden bg-paper text-ink shadow-xl sm:inset-5 sm:border sm:border-gold lg:inset-8"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gold/50 px-4 py-3 sm:px-6 sm:py-4">
              <div className="min-w-0">
                <p className="text-[11px] tracking-[0.18em] text-gold">{zh ? "收费地址" : "Fee address"}</p>
                <h2 className="font-display text-3xl italic leading-none sm:text-4xl">{zh ? "账本" : "Ledger"}</h2>
                <p className="mt-1 break-all font-mono text-sm text-ink/70">{FEE}</p>
              </div>
              <button type="button" className="min-h-10 px-2 text-2xl leading-none" onClick={() => setOpen(false)}>×</button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {(["all", "x", "bsc"] as const).map((id) => (
                  <button key={id} type="button" onClick={() => setChain(id)} className={`min-h-9 px-3 ${chain === id ? "bg-ink text-paper" : "text-ink/55"}`}>
                    {id === "all" ? (zh ? "两条" : "Both") : id === "x" ? "X Layer" : "BSC"}
                  </button>
                ))}
                <a className="ml-auto text-sm underline decoration-gold underline-offset-4" href={`${XLAYER.explorer}/address/${FEE}`} target="_blank" rel="noreferrer">X Layer</a>
                <a className="text-sm underline decoration-gold underline-offset-4" href={`${BSC.explorer}/address/${FEE}`} target="_blank" rel="noreferrer">BSC</a>
              </div>
              <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <span className={IN}>{zh ? "收入" : "In"}</span>
                <span className={OUT}>{zh ? "支出" : "Out"}</span>
                {Object.entries(SWATCH).filter(([name]) => !name.startsWith("W")).map(([name, color]) => (
                  <span key={name} style={{ color }}>{name}</span>
                ))}
              </p>
              <p className="mt-2 text-sm text-ink/55">{note} {zh ? "新加坡时间。没读到的格子是 —，不写成 0。点四周发暗的空白处收起。" : "Singapore time. An unread cell is —, not zero. Click the dim margin to close."}</p>
              <p className="mt-1 text-xs text-ink/45">
                {zh ? "已读到" : "Read back to"} X Layer {xReach ? sgtStamp(xReach) : "—"} · BSC {bReach ? sgtStamp(bReach) : "—"}
                {zh ? "。OKB、BNB 原币只在余额里，没有进出流水。" : ". Native OKB and BNB are balances only."}
                {!dayDone ? (zh ? " 今日还在往前读。" : " Today is still being read.") : ""}
                {!monthDone ? (zh ? " 本月还在往前读。" : " The month is still being read.") : ""}
              </p>
              {bals ? (
                <ul className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
                  {held.map((row) => (
                    <li key={`${row.chain}-${row.token}`} className="min-w-0 border border-gold/40 px-3 py-2 sm:min-w-[11rem] sm:flex-1 sm:py-3" style={{ borderTop: `3px solid ${swatch(row.symbol)}` }}>
                      <p className="truncate text-sm"><Name text={row.symbol} /> · <Chain id={row.chain} /></p>
                      <p className="mt-1 font-mono text-lg tabular-nums sm:text-xl" style={{ color: swatch(row.symbol) }}>{feeText(row.amount, row.decimals)}</p>
                    </li>
                  ))}
                  {held.length === 0 ? <li className="text-sm text-ink/55">{zh ? "这个地址上现在没有余额。" : "This address holds nothing right now."}</li> : null}
                </ul>
              ) : <p className="mt-4 border border-gold/40 px-3 py-4 text-base">{zh ? "先读余额，流水紧跟着填进下面的表。" : "Balances first. Transfers fill the tables below."}</p>}

              <h3 className="mt-6 text-sm tracking-[0.16em] text-gold">{zh ? "按代币" : "By token"}</h3>
              <div className="mt-2 space-y-2 sm:hidden">
                {books.tokens.map((row) => {
                  const bal = balOf(row.chain, row.token);
                  const label = feeLabel(row.token);
                  return (
                    <article key={`m-${row.chain}-${row.token}`} className="border border-gold/40 px-3 py-2" style={{ borderLeft: `3px solid ${swatch(label)}` }}>
                      <p className="flex items-baseline justify-between text-sm"><Name text={label} /><Chain id={row.chain} /></p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-sm tabular-nums">
                        <div><dt className={IN}>{zh ? "今日收入" : "Today in"}</dt><dd className={IN}>{cell(row.day.inn, row.token)}</dd></div>
                        <div><dt className={OUT}>{zh ? "今日支出" : "Today out"}</dt><dd className={OUT}>{cell(row.day.out, row.token)}</dd></div>
                        <div><dt className={IN}>{zh ? "本月收入" : "Month in"}</dt><dd className={IN}>{cell(row.mon.inn, row.token)}</dd></div>
                        <div><dt className={OUT}>{zh ? "本月支出" : "Month out"}</dt><dd className={OUT}>{cell(row.mon.out, row.token)}</dd></div>
                        <div><dt className="text-[#3f62b5]">{zh ? "余额" : "Balance"}</dt><dd style={{ color: swatch(label) }}>{bal ? feeText(bal.amount, bal.decimals) : "—"}</dd></div>
                        <div><dt className="text-ink/45">{zh ? "笔数" : "Rows"}</dt><dd className="text-ink/55">{row.all.n}</dd></div>
                      </dl>
                    </article>
                  );
                })}
                {held.filter((row) => !books.tokens.some((have) => have.chain === row.chain && have.token.toLowerCase() === row.token.toLowerCase())).map((row) => (
                  <article key={`mb-${row.chain}-${row.token}`} className="border border-gold/40 px-3 py-2" style={{ borderLeft: `3px solid ${swatch(row.symbol)}` }}>
                    <p className="flex items-baseline justify-between text-sm"><Name text={row.symbol} /><Chain id={row.chain} /></p>
                    <p className="mt-1 font-mono text-sm tabular-nums" style={{ color: swatch(row.symbol) }}>{zh ? "余额" : "Balance"} {feeText(row.amount, row.decimals)}</p>
                  </article>
                ))}
                {books.tokens.length === 0 && held.length === 0 ? <p className="border border-gold/40 px-3 py-4 text-sm text-ink/45">{bals ? (zh ? "这一段还没有代币进出。" : "No token movement in this stretch.") : (zh ? "正在读。" : "Reading.")}</p> : null}
              </div>
              <div className="mt-2 hidden overflow-x-auto border border-gold/40 sm:block">
                <table className="w-full min-w-[52rem] table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-[14%]" />
                    <col className="w-[12%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[13%]" />
                    <col className="w-[14%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "代币" : "Token"}</th>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "链" : "Chain"}</th>
                      <th className={`px-3 py-2 text-right font-normal ${IN}`}>{zh ? "今日收入" : "Today in"}</th>
                      <th className={`px-3 py-2 text-right font-normal ${OUT}`}>{zh ? "今日支出" : "Today out"}</th>
                      <th className={`px-3 py-2 text-right font-normal ${IN}`}>{zh ? "本月收入" : "Month in"}</th>
                      <th className={`px-3 py-2 text-right font-normal ${OUT}`}>{zh ? "本月支出" : "Month out"}</th>
                      <th className="px-3 py-2 text-right font-normal text-[#3f62b5]">{zh ? "余额" : "Balance"}</th>
                      <th className="px-3 py-2 text-right font-normal text-ink/45">{zh ? "笔数" : "Rows"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.tokens.map((row) => {
                      const bal = balOf(row.chain, row.token);
                      const label = feeLabel(row.token);
                      return (
                        <tr key={`${row.chain}-${row.token}`} className="border-t border-gold/30 font-mono tabular-nums">
                          <td className="px-3 py-2"><Name text={label} /></td>
                          <td className="px-3 py-2"><Chain id={row.chain} /></td>
                          <td className={`px-3 py-2 text-right ${IN}`}>{cell(row.day.inn, row.token)}</td>
                          <td className={`px-3 py-2 text-right ${OUT}`}>{cell(row.day.out, row.token)}</td>
                          <td className={`px-3 py-2 text-right ${IN}`}>{cell(row.mon.inn, row.token)}</td>
                          <td className={`px-3 py-2 text-right ${OUT}`}>{cell(row.mon.out, row.token)}</td>
                          <td className="px-3 py-2 text-right" style={{ color: swatch(label) }}>{bal ? feeText(bal.amount, bal.decimals) : "—"}</td>
                          <td className="px-3 py-2 text-right text-ink/55">{row.all.n}</td>
                        </tr>
                      );
                    })}
                    {held.filter((row) => !books.tokens.some((have) => have.chain === row.chain && have.token.toLowerCase() === row.token.toLowerCase())).map((row) => (
                      <tr key={`bal-${row.chain}-${row.token}`} className="border-t border-gold/30 font-mono tabular-nums">
                        <td className="px-3 py-2"><Name text={row.symbol} /></td>
                        <td className="px-3 py-2"><Chain id={row.chain} /></td>
                        <td className="px-3 py-2 text-right text-ink/35">—</td>
                        <td className="px-3 py-2 text-right text-ink/35">—</td>
                        <td className="px-3 py-2 text-right text-ink/35">—</td>
                        <td className="px-3 py-2 text-right text-ink/35">—</td>
                        <td className="px-3 py-2 text-right" style={{ color: swatch(row.symbol) }}>{feeText(row.amount, row.decimals)}</td>
                        <td className="px-3 py-2 text-right text-ink/35">—</td>
                      </tr>
                    ))}
                    {books.tokens.length === 0 && held.length === 0 ? <tr><td className="px-3 py-4 text-ink/45" colSpan={8}>{bals ? (zh ? "这一段还没有代币进出。" : "No token movement in this stretch.") : (zh ? "正在读。" : "Reading.")}</td></tr> : null}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-6 text-sm tracking-[0.16em] text-gold">{zh ? "按日" : "By day"}</h3>
              <div className="mt-2 space-y-2 sm:hidden">
                {books.days.slice(0, 80).map((row) => {
                  const net = row.inn - row.out;
                  const label = feeLabel(row.token);
                  return (
                    <article key={`md-${row.day}-${row.chain}-${row.token}`} className="border border-gold/40 px-3 py-2">
                      <p className="flex items-baseline justify-between text-sm text-ink/70"><span>{row.day}</span><span><Name text={label} /> · <Chain id={row.chain} /></span></p>
                      <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-sm tabular-nums">
                        <div><dt className={IN}>{zh ? "收入" : "In"}</dt><dd className={IN}>{cell(row.inn, row.token)}</dd></div>
                        <div><dt className={OUT}>{zh ? "支出" : "Out"}</dt><dd className={OUT}>{cell(row.out, row.token)}</dd></div>
                        <div><dt className="text-[#3f62b5]">{zh ? "净额" : "Net"}</dt><dd className={net > 0n ? IN : net < 0n ? OUT : "text-ink/40"}>{net === 0n ? "—" : `${net < 0n ? "−" : ""}${feeText(net < 0n ? -net : net, feeDecimals(row.token))}`}</dd></div>
                      </dl>
                    </article>
                  );
                })}
                {books.days.length === 0 ? <p className="border border-gold/40 px-3 py-4 text-sm text-ink/45">{zh ? "本月这一段还没有按日的数。" : "No daily rows in this month yet."}</p> : null}
              </div>
              <div className="mt-2 hidden overflow-x-auto border border-gold/40 sm:block">
                <table className="w-full min-w-[44rem] table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-[18%]" />
                    <col className="w-[16%]" />
                    <col className="w-[12%]" />
                    <col className="w-[18%]" />
                    <col className="w-[18%]" />
                    <col className="w-[12%]" />
                    <col className="w-[6%]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "日期" : "Date"}</th>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "代币" : "Token"}</th>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "链" : "Chain"}</th>
                      <th className={`px-3 py-2 text-right font-normal ${IN}`}>{zh ? "收入" : "In"}</th>
                      <th className={`px-3 py-2 text-right font-normal ${OUT}`}>{zh ? "支出" : "Out"}</th>
                      <th className="px-3 py-2 text-right font-normal text-[#3f62b5]">{zh ? "净额" : "Net"}</th>
                      <th className="px-3 py-2 text-right font-normal text-ink/45">{zh ? "笔" : "N"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.days.slice(0, 80).map((row) => {
                      const net = row.inn - row.out;
                      const label = feeLabel(row.token);
                      return (
                        <tr key={`${row.day}-${row.chain}-${row.token}`} className="border-t border-gold/30 font-mono tabular-nums">
                          <td className="px-3 py-2 text-ink/70">{row.day}</td>
                          <td className="px-3 py-2"><Name text={label} /></td>
                          <td className="px-3 py-2"><Chain id={row.chain} /></td>
                          <td className={`px-3 py-2 text-right ${IN}`}>{cell(row.inn, row.token)}</td>
                          <td className={`px-3 py-2 text-right ${OUT}`}>{cell(row.out, row.token)}</td>
                          <td className={`px-3 py-2 text-right ${net > 0n ? IN : net < 0n ? OUT : "text-ink/40"}`}>{net === 0n ? "—" : `${net < 0n ? "−" : ""}${feeText(net < 0n ? -net : net, feeDecimals(row.token))}`}</td>
                          <td className="px-3 py-2 text-right text-ink/55">{row.n}</td>
                        </tr>
                      );
                    })}
                    {books.days.length === 0 ? <tr><td className="px-3 py-4 text-ink/45" colSpan={7}>{zh ? "本月这一段还没有按日的数。" : "No daily rows in this month yet."}</td></tr> : null}
                    {books.days.length > 80 ? <tr><td className="px-3 py-2 text-ink/40" colSpan={7}>+{books.days.length - 80}</td></tr> : null}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-6 text-sm tracking-[0.16em] text-gold">{zh ? "流水" : "Transfers"}</h3>
              <div className="mt-2 border border-gold/40 sm:hidden">
                {shown.slice(0, 300).map((row) => {
                  const label = feeLabel(row.token);
                  const inn = row.dir === "in";
                  return (
                    <a key={`mf-${rowKey(row)}`} className={`grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-x-2 border-t border-gold/30 px-3 py-2 font-mono text-sm tabular-nums first:border-t-0 ${inn ? "bg-[#0c9a6b]/10" : "bg-[#d64545]/10"}`} href={`${row.chain === "x" ? XLAYER.explorer : BSC.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">
                      <span className={inn ? IN : OUT}>{inn ? (zh ? "收入" : "In") : (zh ? "支出" : "Out")}</span>
                      <span className="min-w-0 truncate"><Name text={label} /> <span className="text-ink/45">{sgtStamp(row.ts)}</span></span>
                      <span className={`text-right ${inn ? IN : OUT}`}>{feeText(BigInt(row.amount), feeDecimals(row.token))}</span>
                    </a>
                  );
                })}
                {shown.length === 0 ? <p className="px-3 py-4 text-sm text-ink/45">{zh ? "这一段还没有代币进出。" : "No token transfers in this stretch yet."}</p> : null}
              </div>
              <div className="mt-2 hidden overflow-x-auto border border-gold/40 sm:block">
                <table className="w-full min-w-[52rem] table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-[16%]" />
                    <col className="w-[10%]" />
                    <col className="w-[12%]" />
                    <col className="w-[16%]" />
                    <col className="w-[18%]" />
                    <col className="w-[12%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "时间" : "Time"}</th>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "方向" : "Side"}</th>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "代币" : "Token"}</th>
                      <th className="px-3 py-2 text-right font-normal text-ink/45">{zh ? "数量" : "Amount"}</th>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "对方" : "Other"}</th>
                      <th className="px-3 py-2 text-right font-normal text-ink/45">{zh ? "区块" : "Block"}</th>
                      <th className="px-3 py-2 font-normal text-ink/45">{zh ? "链" : "Chain"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, 300).map((row) => {
                      const label = feeLabel(row.token);
                      const inn = row.dir === "in";
                      return (
                      <tr key={rowKey(row)} className={`border-t border-gold/30 font-mono tabular-nums ${inn ? "bg-[#0c9a6b]/10" : "bg-[#d64545]/10"}`}>
                        <td className="px-3 py-2 text-ink/70">{sgtStamp(row.ts)}</td>
                        <td className={`px-3 py-2 ${inn ? IN : OUT}`}>{inn ? (zh ? "收入" : "In") : (zh ? "支出" : "Out")}</td>
                        <td className="px-3 py-2"><Name text={label} /></td>
                        <td className={`px-3 py-2 text-right ${inn ? IN : OUT}`}>{feeText(BigInt(row.amount), feeDecimals(row.token))}</td>
                        <td className="truncate px-3 py-2 text-ink/60">{row.other ? `${row.other.slice(0, 6)}…${row.other.slice(-4)}` : "—"}</td>
                        <td className="px-3 py-2 text-right text-ink/55">{row.block || "—"}</td>
                        <td className="px-3 py-2">
                          <a className="underline decoration-gold underline-offset-2" style={{ color: row.chain === "x" ? "#3f62b5" : "#c48a12" }} href={`${row.chain === "x" ? XLAYER.explorer : BSC.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer"><Chain id={row.chain} /></a>
                        </td>
                      </tr>
                      );
                    })}
                    {shown.length === 0 ? <tr><td className="px-2 py-4 text-ink/45" colSpan={7}>{zh ? "这一段还没有代币进出。" : "No token transfers in this stretch yet."}</td></tr> : null}
                    {shown.length > 300 ? <tr><td className="px-2 py-2 text-ink/40" colSpan={7}>+{shown.length - 300}</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
