import { useEffect, useMemo, useState } from "react";
import { circuitShapes, chainNote, connectXLayer, matchCircuitTask, myCircuits, rememberTask, rememberedCircuits, rememberedTasks, XLAYER } from "@/lib/xlayer";
import { claimFreshCircuit, readCircuitLocks, type CircuitSeat } from "@/lib/tape-lock";
import { openTape, readSeatFlags, readTapePace, tapeText } from "@/lib/tape-mine";
import { openTapePrice } from "@/lib/tape-pool";
import { Kline, type Bar } from "@/components/exchange/kline";
import { currentAccount, onAccount } from "@/lib/wallet";
import {
  buySpotCircuit,
  cancelSpotCircuit,
  listSpotCircuit,
  readCircuitPrints,
  readListings,
  spotPrice,
  usdtText,
  type CircuitAsk,
  type CircuitPrint,
} from "@/lib/tape-spot";

type Pace = { daily: bigint; weight: bigint };
type Shape = { nIn: string; nOut: string; state: string; gates: string };

function cutTape(amount: bigint): string {
  const [whole, frac = ""] = tapeText(amount).split(".");
  const tail = frac.slice(0, 4).replace(/0+$/, "");
  return tail ? `${whole}.${tail}` : whole;
}

function shareOf(gates: string, pace: Pace | null): bigint | null {
  try {
    const count = BigInt(gates || "0");
    if (!pace || pace.weight <= 0n || count <= 0n) return null;
    return (pace.daily * count) / pace.weight;
  } catch {
    return null;
  }
}

function dayPx(price: bigint | null, share: bigint | null): number | null {
  if (price == null || share == null || share <= 0n) return null;
  const human = (Number(price) / 1e6) / (Number(share) / 1e8);
  return Number.isFinite(human) ? human : null;
}

function hashPx(price: bigint | null, gates: string | undefined): number | null {
  const count = Number(gates || "0");
  if (price == null || !Number.isFinite(count) || count <= 0) return null;
  const value = (Number(price) / 1e6) / count;
  return Number.isFinite(value) ? value : null;
}

function payback(price: bigint | null, share: bigint | null, tapePx: number | null): { days: number | null; year: number | null } {
  if (price == null || share == null || share <= 0n || tapePx == null || tapePx <= 0) return { days: null, year: null };
  const daily = (Number(share) / 1e8) * tapePx;
  if (daily <= 0) return { days: null, year: null };
  const days = (Number(price) / 1e6) / daily;
  if (!Number.isFinite(days) || days <= 0) return { days: null, year: null };
  return { days, year: (365 / days) * 100 };
}

function num(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function short(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function age(ts: number): string {
  if (!ts) return "—";
  const mins = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (mins < 60) return `${mins}s`;
  if (mins < 3600) return `${Math.floor(mins / 60)}m`;
  if (mins < 86400) return `${Math.floor(mins / 3600)}h`;
  return `${Math.floor(mins / 86400)}d`;
}

function MineState({ zh, on, task }: { zh: boolean; on: boolean | undefined; task?: string }) {
  const mark = task === "none" ? (zh ? "没对上" : "No match") : task ? task : (zh ? "未核对" : "Unchecked");
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="border border-ink/15 px-1 text-[10px] text-ink/55">{mark}</span>
      <span className={on ? "text-[#089981]" : "text-ink/45"}>{on == null ? "—" : on ? (zh ? "开工" : "Live") : (zh ? "未开工" : "Idle")}</span>
    </span>
  );
}

function VerifyTap({ zh, id, busy, onVerify }: { zh: boolean; id: string; busy: boolean; onVerify: (id: string) => void }) {
  return (
    <button type="button" disabled={busy} className="min-h-8 border border-ink px-2 text-[11px] disabled:opacity-40" onClick={(event) => { event.stopPropagation(); onVerify(id); }}>
      {zh ? "对题目" : "Match task"}
    </button>
  );
}

function shapeLine(shape: Shape | undefined): string {
  if (!shape) return "—";
  return `${shape.nIn}→${shape.nOut} · 态 ${shape.state}`;
}

export function TapeCircuits({ zh }: { zh: boolean }) {
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [lists, setLists] = useState<CircuitAsk[]>([]);
  const [owned, setOwned] = useState<{ id: string; gates: string; nIn: string; nOut: string }[]>([]);
  const [shapes, setShapes] = useState<Map<string, Shape>>(new Map());
  const [pace, setPace] = useState<Pace | null>(null);
  const [locked, setLocked] = useState<CircuitSeat[]>([]);
  const [prints, setPrints] = useState<CircuitPrint[]>([]);
  const [printsPending, setPrintsPending] = useState(true);
  const [tab, setTab] = useState<"book" | "mine" | "tape">("book");
  const [sort, setSort] = useState<"day" | "ask" | "hash">("day");
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<string>("");
  const [price, setPrice] = useState("");
  const [chart, setChart] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [miss, setMiss] = useState(false);
  const [tapePx, setTapePx] = useState<number | null>(null);
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [tasks, setTasks] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const verifyOne = (id: string) => {
    setBusy(true);
    setBad(false);
    matchCircuitTask(id)
      .then((hit) => {
        const name = hit ? hit.name : "none";
        rememberTask(id, name);
        setTasks((prev) => ({ ...prev, [id]: name }));
        setNote(hit ? (zh ? `#${id} 对上了 ${hit.name}。这个浏览器会记住。权重仍按门数。` : `#${id} matches ${hit.name}. This browser keeps it. Weight stays the gate count.`) : (zh ? `#${id} 没对上公开组合题。` : `#${id} matches no public combinational task.`));
        setBad(!hit);
      })
      .catch(() => {
        setBad(true);
        setNote(zh ? "这一张没对完。再点这一张。" : "This one did not finish. Tap it again.");
      })
      .finally(() => setBusy(false));
  };
  const openOne = (id: string) => {
    if (!account) return;
    setOpening(id);
    setBad(false);
    openTape(account, BigInt(id))
      .then(() => {
        setFlags((prev) => ({ ...prev, [id]: true }));
        setNote(zh ? `#${id} 已开工。权重按门数。` : `#${id} is open. Weight is the gate count.`);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "";
        setBad(true);
        if (message === "listed") setNote(zh ? "这张已经挂在电路盘上，持有人是订单簿，不是这个钱包。先撤下，电路回到钱包再开工。" : "This one is listed. The book holds it, not this wallet. Cancel the listing, then open it.");
        else if (message === "locked") setNote(zh ? "这张在锁仓合约里，不能从钱包开工。" : "This one is in the lock. It cannot be opened from the wallet.");
        else if (message === "owner") setNote(zh ? "链上这张不在当前签名的钱包里。" : "The signing wallet does not hold this circuit.");
        else if (message === "account") setNote(zh ? "签名的钱包和页面地址不是同一个。" : "The signing wallet is not the address on this page.");
        else if (message === "open") setNote(zh ? "这张已经开工了。" : "This one is already open.");
        else if (message === "chain") setNote(zh ? "钱包还不是 X Layer。在钱包里把网络改成 X Layer，再点开工。" : "The wallet is not on X Layer. Switch it there, then open again.");
        else if (message === "gas") setNote(zh ? "钱包里的 OKB 不够付这笔矿工费。" : "Not enough OKB for the fee.");
        else if (message === "rejected" || /4001|rejected|denied/i.test(message)) setNote(zh ? "你取消了签名。" : "You cancelled the signature.");
        else if (message === "revert") setNote(zh ? "链上拒绝了这笔开工。电路还在，没有变成矿机。" : "The chain rejected this open. The circuit is unchanged.");
        else setNote(zh ? "这笔开工没在 X Layer 上确认。网络选 X Layer 后再点一次。" : "The open was not confirmed on X Layer. Choose X Layer and tap again.");
      })
      .finally(() => setOpening(null));
  };

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => setTasks(rememberedTasks()), []);
  useEffect(() => {
    if (!sheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setSheet(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [sheet]);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      readListings().then((rows) => { if (!dead) { setLists(rows); setLoaded(true); setMiss(false); } }).catch(() => { if (!dead) setMiss(true); });
      readTapePace().then((next) => { if (!dead && next) setPace(next); }).catch(() => undefined);
      openTapePrice().then((px) => { if (!dead && px && px > 0) setTapePx(px); }).catch(() => undefined);
      readCircuitPrints().then((tape) => { if (!dead) { setPrints(tape.rows); setPrintsPending(tape.pending); } }).catch(() => undefined);
      if (!account) {
        setOwned([]);
        setLocked([]);
        return;
      }
      const known = rememberedCircuits(account);
      if (known.length) setOwned((prev) => (prev.length ? prev : known));
      myCircuits(account).then((mine) => { if (!dead) setOwned(mine.map((row) => ({ id: row.id, gates: row.gates, nIn: row.nIn, nOut: row.nOut }))); }).catch(() => undefined);
      readCircuitLocks(account).then((seats) => { if (!dead) setLocked(seats); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 8000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);
  useEffect(() => {
    const ids = [...lists.map((row) => row.id), ...owned.map((row) => BigInt(row.id)), ...locked.map((row) => BigInt(row.circuitId))];
    if (!ids.length) return;
    let dead = false;
    circuitShapes(ids).then((next) => { if (!dead) setShapes(next); }).catch(() => undefined);
    return () => { dead = true; };
  }, [lists, owned, locked]);
  useEffect(() => {
    const ids = [...lists.map((row) => row.id.toString()), ...owned.map((row) => row.id)];
    if (!ids.length) return;
    let dead = false;
    readSeatFlags(ids).then((next) => { if (!dead) setFlags(next); }).catch(() => undefined);
    return () => { dead = true; };
  }, [lists, owned]);

  const book = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = lists
      .map((row) => {
        const shape = shapes.get(row.id.toString());
        const share = shareOf(shape?.gates ?? "0", pace);
        return { row, shape, share, day: dayPx(row.price, share), hash: Number(shape?.gates ?? 0) };
      })
      .filter((item) => !q || item.row.id.toString().includes(q) || item.row.seller.toLowerCase().includes(q));
    rows.sort((a, b) => {
      if (sort === "ask") return Number(a.row.price - b.row.price);
      if (sort === "hash") return b.hash - a.hash;
      return (a.day ?? Number.POSITIVE_INFINITY) - (b.day ?? Number.POSITIVE_INFINITY);
    });
    return rows;
  }, [lists, shapes, pace, query, sort]);

  const listedHash = book.reduce((sum, item) => sum + item.hash, 0);
  const bestAsk = book.reduce((min, item) => (min == null || item.row.price < min ? item.row.price : min), null as bigint | null);
  const bestDay = book.reduce((min, item) => (item.day != null && (min == null || item.day < min) ? item.day : min), null as number | null);
  const traded = prints.reduce((sum, row) => sum + row.price, 0n);
  const bars = useMemo<Bar[]>(() => {
    const buckets = new Map<number, Bar>();
    for (const row of [...prints].reverse()) {
      if (!row.ts) continue;
      const t = Math.floor(row.ts / 3600) * 3600;
      const px = Number(row.price) / 1e6;
      const cur = buckets.get(t);
      if (!cur) buckets.set(t, { t, o: px, h: px, l: px, c: px, v: px });
      else {
        cur.h = Math.max(cur.h, px);
        cur.l = Math.min(cur.l, px);
        cur.c = px;
        cur.v = (cur.v ?? 0) + px;
      }
    }
    return [...buckets.values()];
  }, [prints]);

  const pickedList = lists.find((row) => row.id.toString() === pick);
  const pickedOwn = owned.find((row) => row.id === pick);
  const pickedLock = locked.find((row) => row.circuitId === pick);
  const pickedShape = shapes.get(pick);
  const pickedShare = shareOf(pickedShape?.gates ?? pickedOwn?.gates ?? (pickedLock ? pickedLock.gates.toString() : "0"), pace);
  const ask = pickedList?.price ?? null;
  let typed: bigint | null = null;
  try { typed = price.trim() ? spotPrice(price) : null; } catch { typed = null; }
  const quote = ask ?? typed;
  const fee = quote != null ? quote * 20n / 10000n : null;
  const quoteDay = dayPx(quote, pickedShare);
  const perHash = hashPx(quote, pickedShape?.gates);
  const back = payback(quote, pickedShare, tapePx);

  const run = (task: (from: string) => Promise<unknown>, ok: string) => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "正在连接 X Layer。请在钱包里确认。" : "Connecting X Layer. Confirm in the wallet.");
    connectXLayer().then((from) => task(from).then(() => { setAccount(from); setNote(ok); setBad(false); })).catch((err: unknown) => {
      const text = err instanceof Error ? err.message : "";
      const seen = err && typeof err === "object" && "chainId" in err ? String((err as { chainId?: unknown }).chainId ?? "") : "";
      setBad(true);
      if (/4001|rejected|denied/i.test(text)) setNote(zh ? "签名取消了。" : "Cancelled.");
      else if (text === "chain") setNote(chainNote(zh, seen));
      else if (/token/i.test(text)) setNote(zh ? "网络对了也不够。买电路花的是这个钱包里的 X Layer USDT。币在别的链上、余额不够，或上一笔授权没签成，合约都拒绝。" : "The network is not enough. A circuit is bought with X Layer USDT in this wallet. Another chain, a short balance, or a missed approval is rejected.");
      else if (/escrow|listed/i.test(text)) setNote(zh ? "这张现在不能这样成交。在售的才能买，在这个钱包里的才能挂出。" : "This circuit cannot settle that way. Only a listing can be bought, and only one in this wallet can be listed.");
      else if (/owner/i.test(text)) setNote(zh ? "这张电路不在当前这个钱包里。" : "This wallet does not hold this circuit.");
      else if (/gas|insufficient/i.test(text)) setNote(zh ? "OKB 不够付这笔矿工费。" : "Not enough OKB for the fee.");
      else setNote(zh ? `没有成交。${text ? text.slice(0, 80) : "先看是不是 X Layer，再看 USDT。"}` : `It did not fill. ${text ? text.slice(0, 80) : "Check X Layer, then USDT."}`);
    }).finally(() => setBusy(false));
  };

  return (
    <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <p className="mb-2 text-[11px] tracking-[0.16em] text-gold">TAPELIQUID · {zh ? "电路" : "Circuits"}</p>
        <div className="flex items-end justify-between gap-4 lg:hidden">
          <div>
            <p className="text-[11px] text-ink/40">{zh ? "最低卖价" : "Best ask"}</p>
            <p className="mt-1 font-mono text-[1.75rem] leading-none tabular-nums">{bestAsk != null ? usdtText(bestAsk, 4) : "—"}</p>
          </div>
          <p className="text-right font-mono text-[12px] leading-5 text-ink/55">
            {zh ? "在售" : "Listed"} {lists.length}<br />
            {zh ? "钱包" : "Wallet"} {owned.length}<br />
            {zh ? "锁着" : "Locked"} {locked.length}
          </p>
        </div>
        <div className="hidden gap-px overflow-hidden bg-gold/30 lg:grid lg:grid-cols-7">
          {[
            [zh ? "在售" : "Listed", String(lists.length)],
            [zh ? "最低卖价" : "Best ask", bestAsk != null ? `${usdtText(bestAsk, 4)}` : "—"],
            [zh ? "挂单算力" : "Listed H", listedHash.toLocaleString("en-US")],
            [zh ? "最低日产能价" : "Best day px", bestDay != null ? num(bestDay, 2) : "—"],
            [zh ? "钱包可挂" : "Wallet", String(owned.length)],
            [zh ? "锁着" : "Locked", String(locked.length)],
            [zh ? "已读成交" : "Prints", prints.length ? `${usdtText(traded, 2)}` : "—"],
          ].map(([k, v]) => (
            <p key={k} className="bg-card px-3 py-3">
              <span className="block text-[10px] tracking-[0.16em] text-ink/40">{k}</span>
              <span className="mt-1 block font-mono text-[15px] tabular-nums">{v}</span>
            </p>
          ))}
        </div>
        <p className="mt-3 font-mono text-[12px] text-ink/45">
          {pace ? `${zh ? "排放" : "Emission"} ${cutTape(pace.daily)} · ${zh ? "权重" : "Weight"} ${pace.weight.toLocaleString("en-US")}` : "—"}
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="grid grid-cols-3 bg-foil/80 p-0.5 sm:flex">
            {(["book", "mine", "tape"] as const).map((id) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`px-3 py-2 text-center text-[13px] sm:py-1.5 ${tab === id ? "bg-card text-ink" : "text-ink/45"}`}>
                {id === "book" ? (zh ? "在售" : "Book") : id === "mine" ? (zh ? `我的 ${owned.length + locked.length}` : "Mine") : zh ? "成交" : "Prints"}
              </button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            {tab === "book" ? (["day", "ask", "hash"] as const).map((id) => (
              <button key={id} type="button" onClick={() => setSort(id)} className={`shrink-0 px-1 py-1 text-[12px] ${sort === id ? "text-ink underline decoration-gold underline-offset-4" : "text-ink/40"}`}>
                {id === "day" ? (zh ? "日产能价" : "Day") : id === "ask" ? (zh ? "卖价" : "Ask") : zh ? "算力" : "Hash"}
              </button>
            )) : null}
            {bars.length > 1 ? <button type="button" onClick={() => setChart((on) => !on)} className="shrink-0 px-1 py-1 text-[12px] text-ink/60 underline decoration-gold/70 underline-offset-4">{chart ? (zh ? "收起" : "Hide") : (zh ? "K 线" : "Chart")}</button> : null}
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "编号或卖家" : "Search"} className="h-9 min-w-0 flex-1 border-b border-gold/60 bg-transparent px-1 text-[13px] outline-none placeholder:text-ink/30 sm:w-36 sm:flex-none" />
          </div>
        </div>
        {chart && bars.length > 1 ? (
          <div className="mt-3 overflow-hidden bg-card">
            <p className="px-3 pt-3 text-[11px] tracking-[0.14em] text-ink/40">{zh ? "成交价" : "Prints"}</p>
            <Kline bars={bars} mark={bestAsk != null ? Number(bestAsk) / 1e6 : 0} lang={zh ? "zh" : "en"} desk="circuit" />
          </div>
        ) : null}
        {tab === "book" ? (
          <>
            <ul className="mt-4 divide-y divide-gold/25 border-y border-gold/30 lg:hidden">
              {book.length === 0 ? <li className="py-8 text-center text-[13px] text-ink/45">{miss ? (zh ? "盘口这一次没读到。" : "The book did not load.") : loaded ? (zh ? "现在没有在售。" : "Nothing is listed.") : (zh ? "正在读。" : "Reading.")}</li> : null}
              {book.map(({ row, shape, share, day }) => {
                const mine = account != null && row.seller.toLowerCase() === account.toLowerCase();
                const open = pick === row.id.toString();
                const cut = row.price * 20n / 10000n;
                return (
                  <li key={row.id.toString()} className="py-3" onClick={() => { setPick(row.id.toString()); setSheet(true); }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[15px]">#{row.id.toString()}</p>
                        <p className="mt-0.5 truncate font-mono text-[12px] text-ink/50">{shapeLine(shape)}</p>
                        <p className="mt-1"><MineState zh={zh} on={flags[row.id.toString()]} task={tasks[row.id.toString()]} /></p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-lg tabular-nums leading-none">{usdtText(row.price, 2)}</p>
                        <p className="mt-1 text-[11px] text-ink/40">USDT</p>
                      </div>
                    </div>
                    <p className="mt-2 font-mono text-[12px] text-ink/55">
                      {shape ? Number(shape.gates).toLocaleString("en-US") : "—"} H
                      <span className="px-1.5 text-ink/25">·</span>
                      {share != null ? cutTape(share) : "—"}
                      <span className="px-1.5 text-ink/25">·</span>
                      {num(day, 2)}
                    </p>
                    {open ? <p className="mt-1 text-[12px] text-ink/45">{zh ? "手续费" : "Fee"} {usdtText(cut, 4)} · {zh ? "卖方实收" : "Seller"} {usdtText(row.price - cut, 4)}</p> : null}
                    <div className="mt-2 flex justify-end">
                      {mine
                        ? <button type="button" disabled={busy} className="min-h-9 px-3 text-sm text-ink/70 disabled:opacity-40" onClick={(event) => { event.stopPropagation(); run((from) => cancelSpotCircuit(from, row.id), zh ? "已撤下。" : "Cancelled."); }}>{zh ? "撤下" : "Cancel"}</button>
                        : <button type="button" disabled={busy} className="min-h-9 bg-[#089981] px-4 text-sm text-white disabled:opacity-40" onClick={(event) => { event.stopPropagation(); run((from) => buySpotCircuit(from, row.id, row.price), zh ? "已买下。" : "Bought."); }}>{zh ? "买入" : "Buy"}</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          <div className="mt-3 hidden max-h-[34rem] overflow-auto bg-card lg:block">
            <table className="w-full table-fixed border-collapse text-left text-[12px]">
              <colgroup>
                <col className="w-[4.5rem]" />
                <col className="w-[7.5rem]" />
                <col className="w-[8.5rem]" />
                <col />
                <col />
                <col />
                <col />
                <col />
                <col />
                <col className="w-[6.5rem]" />
                <col className="w-[4.5rem]" />
              </colgroup>
              <thead className="sticky top-0 bg-foil/90 text-ink/45">
                <tr>
                  {[
                    [zh ? "电路" : "Circuit", false],
                    [zh ? "结构" : "Shape", false],
                    [zh ? "矿机" : "Miner", false],
                    [zh ? "算力" : "Hash", true],
                    [zh ? "卖价" : "Ask", true],
                    [zh ? "手续费" : "Fee", true],
                    [zh ? "实收" : "Net", true],
                    [zh ? "日产" : "Day", true],
                    [zh ? "日产能价" : "Day px", true],
                    [zh ? "卖家" : "Seller", false],
                  ].map(([label, right]) => (
                    <th key={String(label)} className={`px-2 py-2 align-middle font-normal ${right ? "text-right" : "text-left"}`}>{label}</th>
                  ))}
                  <th className="px-2 py-2 text-right align-middle font-normal">{zh ? "买入" : "Buy"}</th>
                </tr>
              </thead>
              <tbody>
                {book.length === 0 ? <tr><td colSpan={11} className="px-3 py-10 text-center text-ink/45">{miss ? (zh ? "没读到。" : "Not loaded.") : loaded ? (zh ? "没有在售。" : "None listed.") : (zh ? "读取中。" : "Reading.")}</td></tr> : null}
                {book.map(({ row, shape, share, day }) => {
                  const mine = account != null && row.seller.toLowerCase() === account.toLowerCase();
                  const cut = row.price * 20n / 10000n;
                  const on = pick === row.id.toString();
                  return (
                    <tr key={row.id.toString()} className={`h-11 cursor-pointer border-t border-gold/15 ${on ? "bg-foil/70" : "hover:bg-foil/40"}`} onClick={() => { setPick(row.id.toString()); setSheet(true); }}>
                      <td className="px-2 align-middle font-mono tabular-nums">#{row.id.toString()}</td>
                      <td className="px-2 align-middle font-mono whitespace-nowrap text-ink/80">{shapeLine(shape)}</td>
                      <td className="px-2 align-middle"><MineState zh={zh} on={flags[row.id.toString()]} task={tasks[row.id.toString()]} /></td>
                      <td className="px-2 text-right align-middle font-mono tabular-nums">{shape ? Number(shape.gates).toLocaleString("en-US") : "—"}</td>
                      <td className="px-2 text-right align-middle font-mono tabular-nums">{usdtText(row.price, 2)}</td>
                      <td className="px-2 text-right align-middle font-mono tabular-nums text-ink/55">{usdtText(cut, 2)}</td>
                      <td className="px-2 text-right align-middle font-mono tabular-nums">{usdtText(row.price - cut, 2)}</td>
                      <td className="px-2 text-right align-middle font-mono tabular-nums">{share != null ? cutTape(share) : "—"}</td>
                      <td className="px-2 text-right align-middle font-mono tabular-nums">{num(day, 2)}</td>
                      <td className="px-2 align-middle font-mono text-ink/60">{mine ? (zh ? "我" : "Me") : short(row.seller)}</td>
                      <td className="px-2 text-right align-middle">
                        {mine
                          ? <button type="button" disabled={busy} className="min-h-8 border border-gold/80 px-3 text-[12px] disabled:opacity-40" onClick={(event) => { event.stopPropagation(); run((from) => cancelSpotCircuit(from, row.id), zh ? "已撤下。" : "Cancelled."); }}>{zh ? "撤下" : "Cancel"}</button>
                          : <button type="button" disabled={busy} className="min-h-8 bg-[#089981] px-3 text-[12px] text-white disabled:opacity-40" onClick={(event) => { event.stopPropagation(); setPick(row.id.toString()); run((from) => buySpotCircuit(from, row.id, row.price), zh ? "已买下。" : "Bought."); }}>{zh ? "买入" : "Buy"}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        ) : null}
        {tab === "mine" ? <Mine zh={zh} account={account} owned={owned} locked={locked} shapes={shapes} pace={pace} pick={pick} flags={flags} tasks={tasks} busy={busy} opening={opening} onVerify={verifyOne} onOpen={openOne} onPick={(id) => { setPick(id); setSheet(true); }} onClaim={(id) => run((from) => claimFreshCircuit(from, BigInt(id)), zh ? "已领回钱包。" : "Claimed.")} /> : null}
        {tab === "tape" ? <Prints zh={zh} rows={prints} pending={printsPending} /> : null}
      </div>
      <aside className="border border-gold bg-card lg:sticky lg:top-16">
        <div className="grid grid-cols-2 border-b border-gold/30">
          <div className="border-r border-gold/30 px-4 py-3">
            <p className="text-[11px] text-ink/45">{zh ? "最低卖价" : "Best ask"}</p>
            <p className="mt-1 font-mono text-xl tabular-nums text-[#f23645]">{(pickedList?.price ?? bestAsk) != null ? usdtText((pickedList?.price ?? bestAsk) as bigint, 4) : "—"}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-[11px] text-ink/45">{zh ? "最高出价" : "Best bid"}</p>
            <p className="mt-1 font-mono text-xl">{zh ? "暂无" : "None"}</p>
          </div>
        </div>
        <div className="px-4 py-4">
          <p className="font-display text-3xl italic leading-none">{pick ? `#${pick}` : (zh ? "点一行" : "Pick a row")}</p>
          {pick ? <p className="mt-2 text-[12px]"><MineState zh={zh} on={flags[pick]} task={tasks[pick]} /></p> : null}
          {pick ? <p className="mt-1 font-mono text-[12px] text-ink/55">{shapeLine(pickedShape)} · {pickedShape ? Number(pickedShape.gates).toLocaleString("en-US") : "—"} H</p> : null}
          <label className="mt-4 block text-[12px] text-ink/55">
            {zh ? "购买数量" : "Quantity"}
            <input readOnly value={pickedList ? "1" : ""} placeholder="1" className="mt-1 h-11 w-full border border-gold/50 bg-paper px-3 font-mono text-lg outline-none" />
          </label>
          <p className="mt-1 text-[12px] text-ink/45">{pickedList ? "1" : "0"}</p>
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-gold/30 pt-3">
            <span className="text-sm">{zh ? "需支付" : "Pay"}</span>
            <strong className="font-mono text-2xl font-medium tabular-nums">{pickedList ? `${usdtText(pickedList.price, 4)}` : "—"}</strong>
          </div>
          <p className="mt-1 font-mono text-[12px] text-ink/45">{pickedList ? `${zh ? "手续费" : "Fee"} ${usdtText(fee ?? 0n, 4)}` : ""}</p>
          {pickedList && account?.toLowerCase() !== pickedList.seller.toLowerCase() ? (
            <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-[#089981] text-sm text-white disabled:opacity-40" onClick={() => run((from) => buySpotCircuit(from, pickedList.id, pickedList.price), zh ? "已买下。" : "Bought.")}>{zh ? "买入这一张" : "Buy this one"}</button>
          ) : null}
          {pickedList && account?.toLowerCase() === pickedList.seller.toLowerCase() ? (
            <button type="button" disabled={busy} className="mt-3 min-h-12 w-full border border-gold text-sm disabled:opacity-40" onClick={() => run((from) => cancelSpotCircuit(from, pickedList.id), zh ? "已撤下。" : "Cancelled.")}>{zh ? "撤下" : "Cancel"}</button>
          ) : null}
          {pickedOwn ? (
            <div className="mt-3">
              <label className="grid gap-1 text-[12px] text-ink/45">
                {zh ? "挂出价" : "Ask"}
                <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="USDT" className="h-12 border border-gold/50 bg-paper px-3 font-mono text-lg text-ink outline-none" />
              </label>
              <button type="button" disabled={busy || typed == null} className="mt-2 min-h-12 w-full bg-[#f23645] text-sm text-white disabled:opacity-40" onClick={() => typed != null && run((from) => listSpotCircuit(from, BigInt(pick), typed), zh ? "已挂上。" : "Listed.")}>{zh ? "挂出这一张" : "List this one"}</button>
            </div>
          ) : null}
          {note ? <p className={`mt-3 text-[12px] leading-5 ${bad ? "text-sell" : "text-ink/70"}`}>{note}</p> : null}
        </div>
      </aside>
      {sheet && pick ? (
        <div className="fixed inset-0 z-50 flex bg-ink/40 lg:items-center lg:justify-center lg:p-6" onClick={() => setSheet(false)}>
          <div className="flex h-[100dvh] w-full flex-col bg-paper lg:h-auto lg:max-h-[min(44rem,90dvh)] lg:max-w-5xl lg:flex-row" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gold/30 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
                <div className="min-w-0">
                  <p className="text-[11px] text-ink/40">{zh ? "电路" : "Circuit"}</p>
                  <h3 className="truncate font-display text-2xl italic leading-none sm:text-3xl">#{pick}</h3>
                </div>
                <button type="button" className="min-h-11 shrink-0 px-2 text-sm text-ink/50" onClick={() => setSheet(false)}>{zh ? "关闭" : "Close"}</button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <p className="text-[13px]">{zh ? "规格" : "Spec"}</p>
                <div className="mt-2 grid border border-gold/25 md:grid-cols-2">
                  <Pair k={zh ? "结构" : "Shape"} v={shapeLine(pickedShape)} />
                  <Pair k={zh ? "算力" : "Hash"} v={pickedShape ? Number(pickedShape.gates).toLocaleString("en-US") : "—"} />
                  <Pair k={zh ? "卖家" : "Seller"} v={pickedList ? short(pickedList.seller) : pickedOwn ? (zh ? "钱包" : "Wallet") : pickedLock ? (zh ? "锁着" : "Locked") : "—"} />
                  <Pair k={zh ? "状态" : "State"} v={pickedList ? (zh ? "在售" : "Listed") : pickedOwn ? (zh ? "钱包" : "Wallet") : pickedLock ? (zh ? "锁着" : "Locked") : "—"} />
                </div>
                <p className="mt-4 text-[13px]">{zh ? "估值" : "Value"}</p>
                <div className="mt-2 grid border border-gold/25 md:grid-cols-2">
                  <Pair k={zh ? "日产" : "Day"} v={pickedShare != null ? cutTape(pickedShare) : "—"} />
                  <Pair k={zh ? "日产能价" : "Day px"} v={quoteDay != null ? num(quoteDay, quoteDay >= 100 ? 2 : 4) : "—"} />
                  <Pair k={zh ? "算力均价" : "Hash px"} v={perHash != null ? num(perHash, 4) : "—"} />
                  <Pair k={zh ? "回本" : "Payback"} v={back.days != null ? `${num(back.days, 1)}${zh ? "天" : "d"}` : "—"} />
                  <Pair k={zh ? "年化" : "Year"} v={back.year != null ? `${num(back.year, 1)}%` : "—"} />
                  <Pair k={zh ? "晶体均价" : "Crystal"} v="—" />
                </div>
                <p className="mt-3 font-mono text-[12px] text-ink/45">{tapePx != null ? `TAPE ${num(tapePx, 4)}` : "—"}</p>
              </div>
            </div>
            <div className="shrink-0 border-t border-gold/30 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:w-[22rem] lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-0 lg:py-0">
              <div className="grid grid-cols-2 border-b border-gold/30">
                <div className="border-r border-gold/30 px-4 py-3">
                  <p className="text-[11px] text-ink/45">{zh ? "最低卖价" : "Best ask"}</p>
                  <p className="mt-1 font-mono text-lg tabular-nums text-[#f23645]">{quote != null ? usdtText(quote, 4) : "—"}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[11px] text-ink/45">{zh ? "最高出价" : "Best bid"}</p>
                  <p className="mt-1 font-mono text-lg">{zh ? "暂无" : "None"}</p>
                </div>
              </div>
              <div className="px-4 py-3">
                <label className="block text-[12px] text-ink/55">
                  {zh ? "购买数量" : "Quantity"}
                  <input readOnly value="1" className="mt-1 h-11 w-full border border-gold/50 bg-paper px-3 font-mono text-lg outline-none" />
                </label>
                <p className="mt-1 text-[12px] text-ink/45">{zh ? "当前可购买 1 个" : "1 available"}</p>
                <div className="mt-3 flex items-end justify-between">
                  <span className="text-sm">{zh ? "需支付" : "Pay"}</span>
                  <strong className="font-mono text-2xl font-medium tabular-nums">{quote != null ? `${usdtText(quote, 4)} USDT` : "—"}</strong>
                </div>
              {pickedList && account?.toLowerCase() !== pickedList.seller.toLowerCase() ? (
                <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-[#089981] text-sm text-white disabled:opacity-40" onClick={() => run((from) => buySpotCircuit(from, pickedList.id, pickedList.price), zh ? "已买下。" : "Bought.")}>{zh ? `买入 ${usdtText(pickedList.price, 2)}` : `Buy ${usdtText(pickedList.price, 2)}`}</button>
              ) : null}
              {pickedList && account?.toLowerCase() === pickedList.seller.toLowerCase() ? (
                <button type="button" disabled={busy} className="mt-3 min-h-12 w-full border border-gold text-sm disabled:opacity-40" onClick={() => run((from) => cancelSpotCircuit(from, pickedList.id), zh ? "已撤下。" : "Cancelled.")}>{zh ? "撤下" : "Cancel"}</button>
              ) : null}
              {pickedOwn ? (
                <div className="mt-3 flex items-end gap-2">
                  <label className="grid min-w-0 flex-1 gap-1 text-[12px] text-ink/45">
                    {zh ? "挂出价" : "Ask"}
                    <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="USDT" className="h-12 border-b border-gold bg-transparent font-mono text-lg text-ink outline-none" />
                  </label>
                  <button type="button" disabled={busy || typed == null} className="min-h-12 shrink-0 bg-[#f23645] px-4 text-sm text-white disabled:opacity-40" onClick={() => typed != null && run((from) => listSpotCircuit(from, BigInt(pick), typed), zh ? "已挂上。" : "Listed.")}>{zh ? "挂出" : "List"}</button>
                </div>
              ) : null}
              {pickedLock ? <p className="mt-3 text-[13px] text-ink/55">{pickedLock.unlock * 1000 <= Date.now() ? (zh ? "先领回。" : "Claim it first.") : (zh ? "还锁着。" : "Locked.")}</p> : null}
              {note ? <p className={`mt-2 text-[12px] leading-5 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-gold/20 px-3 py-2.5 text-[13px] md:[&:nth-child(odd)]:border-r"><dt className="text-ink/45">{k}</dt><dd className="text-right font-mono">{v}</dd></div>;
}

function Mine({ zh, account, owned, locked, shapes, pace, pick, flags, tasks, busy, opening, onVerify, onOpen, onPick, onClaim }: { zh: boolean; account: string | null; owned: { id: string; gates: string; nIn: string; nOut: string }[]; locked: CircuitSeat[]; shapes: Map<string, Shape>; pace: Pace | null; pick: string; flags: Record<string, boolean>; tasks: Record<string, string>; busy: boolean; opening: string | null; onVerify: (id: string) => void; onOpen: (id: string) => void; onPick: (id: string) => void; onClaim: (id: string) => void }) {
  return (
    <>
    <ul className="mt-4 divide-y divide-gold/25 border-y border-gold/30 lg:hidden">
      {owned.length + locked.length === 0 ? <li className="py-8 text-center text-[13px] text-ink/45">{account ? (zh ? "没有电路。" : "None.") : (zh ? "先连接钱包。" : "Connect.")}</li> : null}
      {owned.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-3" onClick={() => onPick(row.id)}>
          <div>
            <p className="font-mono text-[15px]">#{row.id}</p>
            <p className="mt-0.5 text-[12px] text-ink/50">{row.nIn}→{row.nOut} · {Number(row.gates).toLocaleString("en-US")} H</p>
            <p className="mt-1 flex flex-wrap items-center gap-2"><MineState zh={zh} on={flags[row.id]} task={tasks[row.id]} /><VerifyTap zh={zh} id={row.id} busy={busy} onVerify={onVerify} /></p>
            {flags[row.id] ? null : <button type="button" disabled={opening === row.id} className="mt-2 min-h-11 w-full bg-ink text-sm text-paper disabled:opacity-40" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}>{opening === row.id ? (zh ? "等待钱包" : "Waiting") : (zh ? "开工" : "Open")}</button>}
          </div>
          <span className="text-sm text-ink/70">{zh ? "挂出" : "List"}</span>
        </li>
      ))}
      {locked.map((row) => {
        const due = row.unlock * 1000 <= Date.now();
        return (
          <li key={row.id} className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="font-mono text-[15px]">#{row.circuitId}</p>
              <p className="mt-0.5 text-[12px] text-ink/50">{due ? (zh ? "到期可领" : "Due") : (zh ? "锁着" : "Locked")} · {row.gates.toLocaleString("en-US")} H</p>
            </div>
            {due ? <button type="button" disabled={busy} className="min-h-9 px-3 text-sm" onClick={() => onClaim(row.id)}>{zh ? "领回" : "Claim"}</button> : null}
          </li>
        );
      })}
    </ul>
    <div className="mt-3 hidden max-h-[34rem] overflow-auto bg-card lg:block">
      <table className="w-full min-w-[40rem] text-left text-[12px]">
        <thead className="sticky top-0 bg-foil/90 text-ink/45">
          <tr>
            <th className="px-2 py-2 font-normal">{zh ? "电路" : "Circuit"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "结构" : "Shape"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "算力" : "Hash"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "占比" : "Share"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "日产" : "Day"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "状态" : "State"}</th>
            <th className="px-2 py-2 text-right font-normal">{zh ? "操作" : "Act"}</th>
          </tr>
        </thead>
        <tbody>
          {owned.length + locked.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-ink/55">{account ? (zh ? "没有电路。" : "None.") : (zh ? "先连接钱包。" : "Connect a wallet.")}</td></tr> : null}
          {owned.map((row) => {
            const shape = shapes.get(row.id) ?? { nIn: row.nIn, nOut: row.nOut, state: "—", gates: row.gates };
            const share = shareOf(shape.gates, pace);
            const part = pace && pace.weight > 0n ? `${(Number(BigInt(shape.gates) * 10000n / pace.weight) / 100).toLocaleString("en-US", { maximumFractionDigits: 4 })}%` : "—";
            return (
              <tr key={row.id} className={`cursor-pointer border-t border-gold/20 ${pick === row.id ? "bg-foil/40" : ""}`} onClick={() => onPick(row.id)}>
                <td className="px-2 py-1.5 font-mono">#{row.id}</td>
                <td className="px-2 py-1.5 font-mono">{shapeLine(shape)}</td>
                <td className="px-2 py-1.5 font-mono">{Number(shape.gates).toLocaleString("en-US")}</td>
                <td className="px-2 py-1.5 font-mono">{part}</td>
                <td className="px-2 py-1.5 font-mono">{share != null ? cutTape(share) : "—"}</td>
                <td className="px-2 py-1.5"><span className="inline-flex items-center gap-2"><MineState zh={zh} on={flags[row.id]} task={tasks[row.id]} /><VerifyTap zh={zh} id={row.id} busy={busy} onVerify={onVerify} />{flags[row.id] ? null : <button type="button" disabled={opening === row.id} className="min-h-8 bg-ink px-3 text-paper disabled:opacity-40" onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}>{opening === row.id ? (zh ? "等待钱包" : "Waiting") : (zh ? "开工" : "Open")}</button>}</span></td>
                <td className="px-2 py-1.5 text-right">{zh ? "挂出" : "List"}</td>
              </tr>
            );
          })}
          {locked.map((row) => {
            const due = row.unlock * 1000 <= Date.now();
            const shape = shapes.get(row.circuitId);
            const share = shareOf(shape?.gates ?? row.gates.toString(), pace);
            const part = pace && pace.weight > 0n ? `${(Number(row.gates * 10000n / pace.weight) / 100).toLocaleString("en-US", { maximumFractionDigits: 4 })}%` : "—";
            return (
              <tr key={row.id} className="border-t border-gold/20 text-ink/70">
                <td className="px-2 py-1.5 font-mono">#{row.circuitId}</td>
                <td className="px-2 py-1.5 font-mono">{shapeLine(shape)}</td>
                <td className="px-2 py-1.5 font-mono">{row.gates.toLocaleString("en-US")}</td>
                <td className="px-2 py-1.5 font-mono">{part}</td>
                <td className="px-2 py-1.5 font-mono">{share != null ? cutTape(share) : "—"}</td>
                <td className="px-2 py-1.5">{due ? (zh ? "到期可领" : "Due") : (zh ? "锁着" : "Locked")}</td>
                <td className="px-2 py-1.5 text-right">{due ? <button type="button" disabled={busy} className="min-h-7 border border-gold px-2" onClick={() => onClaim(row.id)}>{zh ? "领回" : "Claim"}</button> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function Prints({ zh, rows, pending }: { zh: boolean; rows: CircuitPrint[]; pending: boolean }) {
  const empty = pending ? (zh ? "正在读电路成交。" : "Reading circuit sales.") : (zh ? "还没有电路成交。" : "No circuit sale yet.");
  return (
    <>
      <ul className="mt-3 divide-y divide-gold/25 border-y border-gold/30 md:hidden">
        {rows.length === 0 ? <li className="py-6 text-center text-[13px] text-ink/55">{empty}</li> : null}
        {rows.map((row) => (
          <li key={row.tx} className="grid grid-cols-2 gap-x-3 gap-y-1 py-3 text-[13px]">
            <p className="font-mono">#{row.id}</p>
            <p className="text-right font-mono tabular-nums">{usdtText(row.price, 2)} <span className="text-[11px] text-ink/45">USDT</span></p>
            <p className="font-mono text-ink/55">{age(row.ts)}</p>
            <p className="text-right font-mono tabular-nums text-ink/55">{zh ? "手续费" : "Fee"} {usdtText(row.fee, 4)}</p>
            <p className="col-span-2 font-mono text-[12px] text-ink/55">{short(row.buyer)} → {short(row.seller)} · <a className="underline" href={`${XLAYER.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{zh ? "链上" : "Tx"}</a></p>
          </li>
        ))}
      </ul>
      <div className="mt-3 hidden max-h-[34rem] overflow-auto bg-card md:block">
      <table className="w-full min-w-[36rem] text-left text-[12px]">
        <thead className="sticky top-0 bg-foil/90 text-ink/45">
          <tr>{[zh ? "时间" : "Age", zh ? "电路" : "Circuit", zh ? "成交价" : "Price", zh ? "手续费" : "Fee", zh ? "买方" : "Buyer", zh ? "卖方" : "Seller", ""].map((head) => <th key={head || "tx"} className="px-2 py-2 font-normal">{head}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-ink/55">{empty}</td></tr> : null}
          {rows.map((row) => (
            <tr key={row.tx} className="border-t border-gold/20">
              <td className="px-2 py-1.5 font-mono">{age(row.ts)}</td>
              <td className="px-2 py-1.5 font-mono">#{row.id}</td>
              <td className="px-2 py-1.5 font-mono">{usdtText(row.price, 4)}</td>
              <td className="px-2 py-1.5 font-mono">{usdtText(row.fee, 4)}</td>
              <td className="px-2 py-1.5 font-mono">{short(row.buyer)}</td>
              <td className="px-2 py-1.5 font-mono">{short(row.seller)}</td>
              <td className="px-2 py-1.5 text-right"><a className="underline" href={`${XLAYER.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{zh ? "链上" : "Tx"}</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
