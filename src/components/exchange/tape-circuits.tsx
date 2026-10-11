import { useEffect, useMemo, useState } from "react";
import { circuitShapes, connectXLayer, myCircuits, XLAYER } from "@/lib/xlayer";
import { claimFreshCircuit, readCircuitLocks, type CircuitSeat } from "@/lib/tape-lock";
import { readTapePace, tapeText } from "@/lib/tape-mine";
import { Hint } from "@/components/exchange/hint";
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
  const [tab, setTab] = useState<"book" | "mine" | "tape">("book");
  const [sort, setSort] = useState<"day" | "ask" | "hash">("day");
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<string>("");
  const [price, setPrice] = useState("");
  const [chart, setChart] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      Promise.all([
        readListings(),
        account ? myCircuits(account) : Promise.resolve([]),
        account ? readCircuitLocks(account) : Promise.resolve([]),
        readCircuitPrints(),
        readTapePace(),
      ]).then(([rows, mine, seats, tape, nextPace]) => {
        if (dead) return;
        setLists(rows);
        setOwned(mine.map((row) => ({ id: row.id, gates: row.gates, nIn: row.nIn, nOut: row.nOut })));
        setLocked(seats);
        setPrints(tape);
        setPace(nextPace);
        const ids = [...rows.map((row) => row.id), ...mine.map((row) => BigInt(row.id)), ...seats.map((row) => BigInt(row.circuitId))];
        if (ids.length) circuitShapes(ids).then((next) => { if (!dead) setShapes(next); }).catch(() => undefined);
      }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

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
  const net = quote != null && fee != null ? quote - fee : null;
  const quoteDay = dayPx(quote, pickedShare);

  const run = (task: (from: string) => Promise<unknown>, ok: string) => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "正在连接 X Layer。请在钱包里确认。" : "Connecting X Layer. Confirm in the wallet.");
    connectXLayer().then((from) => task(from).then(() => { setAccount(from); setNote(ok); setBad(false); })).catch((err: unknown) => {
      const text = err instanceof Error ? err.message : "";
      setBad(true);
      setNote(/4001|rejected|denied/i.test(text) ? (zh ? "签名取消了。" : "Cancelled.") : zh ? "没有完成。" : "It did not finish.");
    }).finally(() => setBusy(false));
  };

  return (
    <section className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        <div className="grid grid-cols-2 gap-px overflow-hidden bg-gold/30 sm:grid-cols-4 xl:grid-cols-7">
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
              <span className="block text-[10px] tracking-[0.16em] text-ink/40"><Hint label={k} text={tip(zh, k)} /></span>
              <span className="mt-1 block font-mono text-[15px] tabular-nums">{v}</span>
            </p>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-[12px] leading-6 text-ink/50">
          {pace
            ? zh
              ? `今日排放 ${cutTape(pace.daily)} TAPE · 全网权重 ${pace.weight.toLocaleString("en-US")}。日产出按已经开工估算，没开工不是到账。日产能价单位是 USDT0 / 每日 1 TAPE。`
              : `Emission ${cutTape(pace.daily)} TAPE · weight ${pace.weight.toLocaleString("en-US")}. Daily output assumes the circuit is already mining.`
            : zh ? "全网权重还没读到。不估日产出。" : "Network weight is not in yet."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex bg-foil/80 p-0.5">
            {(["book", "mine", "tape"] as const).map((id) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`px-3 py-1.5 text-[13px] ${tab === id ? "bg-card text-ink" : "text-ink/45"}`}>
                {id === "book" ? (zh ? "在售" : "Book") : id === "mine" ? (zh ? `我的 ${owned.length + locked.length}` : "Mine") : zh ? "成交" : "Prints"}
              </button>
            ))}
          </div>
          {tab === "book" ? (
            <div className="flex gap-1 text-[12px]">
              {(["day", "ask", "hash"] as const).map((id) => (
                <button key={id} type="button" onClick={() => setSort(id)} className={`px-2 py-1 ${sort === id ? "text-ink underline decoration-gold underline-offset-4" : "text-ink/40"}`}>
                  {id === "day" ? (zh ? "日产能价" : "Day") : id === "ask" ? (zh ? "卖价" : "Ask") : zh ? "算力" : "Hash"}
                </button>
              ))}
            </div>
          ) : null}
          {bars.length > 1 ? <button type="button" onClick={() => setChart((on) => !on)} className="ml-auto px-2 py-1 text-[12px] text-ink/60 underline decoration-gold/70 underline-offset-4">{chart ? (zh ? "收起 K 线" : "Hide chart") : (zh ? "成交 K 线" : "Chart")}</button> : <span className="ml-auto" />}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "编号或卖家" : "Search"} className="h-8 w-36 border-b border-gold/60 bg-transparent px-1 text-[12px] outline-none placeholder:text-ink/30" />
        </div>
        {chart && bars.length > 1 ? (
          <div className="mt-3 overflow-hidden bg-card">
            <p className="px-3 pt-3 text-[11px] tracking-[0.14em] text-ink/40"><Hint label={zh ? "成交价" : "Prints"} text={zh ? "每根是一小时的电路成交价，单位 USDT0。不是日产能价。" : "Each candle is one hour of sale prices in USDT0."} /></p>
            <Kline bars={bars} mark={bestAsk != null ? Number(bestAsk) / 1e6 : 0} lang={zh ? "zh" : "en"} desk="circuit" />
          </div>
        ) : null}
        {tab === "book" ? (
          <div className="mt-3 max-h-[34rem] overflow-auto bg-card">
            <table className="w-full min-w-[64rem] text-left text-[12px]">
              <thead className="sticky top-0 bg-foil/90 text-ink/45">
                <tr>
                  {[
                    [zh ? "电路" : "Circuit", zh ? "编号。一整张，不能拆。" : "One circuit. It cannot be split."],
                    [zh ? "结构" : "Shape", zh ? "输入、输出、状态位数。" : "Inputs, outputs, and state bits."],
                    [zh ? "算力" : "Hash", zh ? "门数。开工后按这个数占全网权重。" : "Gate count. It takes this share of network weight after start."],
                    [zh ? "卖价" : "Ask", zh ? "买方付出的 USDT0。" : "USDT0 the buyer pays."],
                    [zh ? "手续费" : "Fee", zh ? "卖价的千分之二，成交时扣给收费地址。" : "0.2 percent of the ask, taken on the fill."],
                    [zh ? "卖方实收" : "Seller", zh ? "卖价减去千分之二。" : "Ask minus 0.2 percent."],
                    [zh ? "估算日产" : "Day", zh ? "按今天的排放和全网权重，开工后大约每天的 TAPE。" : "Estimated TAPE per day if this circuit were mining now."],
                    [zh ? "日产能价" : "Day px", zh ? "卖价除以估算日产。单位是 USDT0 / 每日 1 TAPE。只用来比较。" : "Ask divided by estimated daily TAPE. USDT0 per 1 TAPE per day."],
                    [zh ? "卖家" : "Seller", zh ? "现在挂着这张的地址。" : "The address listing it."],
                  ].map(([label, text]) => <th key={label} className="px-3 py-2.5 text-left font-normal tracking-[0.08em]"><Hint label={label} text={text} /></th>)}
                  <th className="sticky right-0 bg-foil/95 px-3 py-2.5 text-right font-normal tracking-[0.08em]">{zh ? "买入" : "Buy"}</th>
                </tr>
              </thead>
              <tbody>
                {book.length === 0 ? <tr><td colSpan={10} className="px-3 py-10 text-center text-ink/45">{zh ? "现在没有在售的电路。钱包里的在「我的」。" : "Nothing is listed. Wallet circuits are under Mine."}</td></tr> : null}
                {book.map(({ row, shape, share, day }) => {
                  const mine = account != null && row.seller.toLowerCase() === account.toLowerCase();
                  const cut = row.price * 20n / 10000n;
                  const on = pick === row.id.toString();
                  return (
                    <tr key={row.id.toString()} className={`cursor-pointer border-t border-gold/15 ${on ? "bg-foil/70" : "hover:bg-foil/40"}`} onClick={() => setPick(row.id.toString())}>
                      <td className="px-3 py-2.5 font-mono tabular-nums">#{row.id.toString()}</td>
                      <td className="px-3 py-2.5 font-mono whitespace-nowrap text-ink/80">{shapeLine(shape)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{shape ? Number(shape.gates).toLocaleString("en-US") : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{usdtText(row.price, 4)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-ink/55">{usdtText(cut, 4)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{usdtText(row.price - cut, 4)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{share != null ? cutTape(share) : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{num(day, day != null && day >= 100 ? 2 : 4)}</td>
                      <td className="px-3 py-2.5 font-mono text-ink/60">{mine ? (zh ? "我" : "Me") : short(row.seller)}</td>
                      <td className={`sticky right-0 px-3 py-2 text-right ${on ? "bg-foil/70" : "bg-card"}`}>
                        {mine
                          ? <button type="button" disabled={busy} className="min-h-8 border border-gold/80 px-3 text-[12px] disabled:opacity-40" onClick={(event) => { event.stopPropagation(); run((from) => cancelSpotCircuit(from, row.id), zh ? "已撤下。" : "Cancelled."); }}>{zh ? "撤下" : "Cancel"}</button>
                          : <button type="button" disabled={busy} className="min-h-8 bg-[#f23645] px-3 text-[12px] text-white disabled:opacity-40" onClick={(event) => { event.stopPropagation(); setPick(row.id.toString()); run((from) => buySpotCircuit(from, row.id, row.price), zh ? "已买下。" : "Bought."); }}>{zh ? "买入" : "Buy"}</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {tab === "mine" ? <Mine zh={zh} owned={owned} locked={locked} shapes={shapes} pace={pace} pick={pick} busy={busy} onPick={setPick} onClaim={(id) => run((from) => claimFreshCircuit(from, BigInt(id)), zh ? "已领回钱包。" : "Claimed.")} /> : null}
        {tab === "tape" ? <Prints zh={zh} rows={prints} /> : null}
      </div>
      <aside className="bg-card px-5 py-5 lg:sticky lg:top-3">
        <p className="text-[10px] tracking-[0.22em] text-ink/40">{pickedList ? (zh ? "买入" : "BUY") : zh ? "挂出" : "LIST"}</p>
        <p className="mt-3 font-display text-4xl italic leading-none">{pick ? `#${pick}` : (zh ? "点一行" : "Pick")}</p>
        {pick ? <p className="mt-2 font-mono text-[13px] text-ink/60">{shapeLine(pickedShape)} · {pickedShape ? Number(pickedShape.gates).toLocaleString("en-US") : "—"} H</p> : null}
        <dl className="mt-5">
          <Line k={zh ? "估算日产" : "Est. day"} v={pickedShare != null ? `${cutTape(pickedShare)} TAPE` : "—"} />
          <Line k={zh ? "报价" : "Quote"} v={quote != null ? `${usdtText(quote, 4)}` : "—"} />
          <Line k={zh ? "千分之二" : "0.20%"} v={fee != null ? usdtText(fee, 4) : "—"} />
          <Line k={zh ? "卖方实收" : "Seller gets"} v={net != null ? usdtText(net, 4) : "—"} />
          <Line k={zh ? "日产能价" : "Day px"} v={quoteDay != null ? num(quoteDay, quoteDay >= 100 ? 2 : 4) : "—"} />
        </dl>
        <p className="mt-4 text-[12px] leading-6 text-ink/45">{zh ? "买方付报价。卖方拿 99.8%。日产能价只用来比较。" : "The buyer pays the quote. The seller receives 99.8 percent."}</p>
        {pickedList && account?.toLowerCase() !== pickedList.seller.toLowerCase() ? (
          <button type="button" disabled={busy} className="mt-5 min-h-12 w-full bg-[#f23645] text-sm text-white disabled:opacity-40" onClick={() => run((from) => buySpotCircuit(from, pickedList.id, pickedList.price), zh ? "已买下。" : "Bought.")}>{zh ? `买入  ${usdtText(pickedList.price, 2)}` : `Buy ${usdtText(pickedList.price, 2)}`}</button>
        ) : null}
        {pickedOwn ? (
          <>
            <label className="mt-5 grid gap-2 text-[12px] text-ink/45">
              {zh ? "挂出价" : "Ask"}
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="USDT0" className="h-12 border-b border-gold bg-transparent font-mono text-lg text-ink outline-none" />
            </label>
            <button type="button" disabled={busy || typed == null} className="mt-4 min-h-12 w-full bg-ink text-sm text-paper disabled:opacity-40" onClick={() => typed != null && run((from) => listSpotCircuit(from, BigInt(pick), typed), zh ? "已挂上。" : "Listed.")}>{zh ? "挂出这一张" : "List this one"}</button>
          </>
        ) : null}
        {!pick ? <p className="mt-5 text-[13px] leading-6 text-ink/45">{zh ? "在售里点一行就能买。要挂的话，先去「我的」。" : "Pick a listed row to buy. To list, open Mine."}</p> : null}
        {note ? <p className={`mt-3 text-[12px] leading-5 ${bad ? "text-sell" : "text-ink/70"}`}>{note}</p> : null}
      </aside>
    </section>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-gold/20 py-2.5 text-[13px]"><dt className="text-ink/40">{k}</dt><dd className="font-mono tabular-nums">{v}</dd></div>;
}

function tip(zh: boolean, label: string): string {
  const notes: Record<string, string> = zh
    ? {
        "在售": "现在挂在订单簿上的电路张数。钱包里没挂的不算。",
        "最低卖价": "在售里最便宜的一张，单位 USDT0。",
        "挂单算力": "在售电路的门数加总。",
        "最低日产能价": "在售里，卖价除以估算日产之后最低的一张。",
        "钱包可挂": "这个钱包里还没挂出的电路。",
        "锁着": "期限合约里还没领回的电路。",
        "已读成交": "最近这段区块里，电路成交的 USDT0。",
      }
    : {
        Listed: "Circuits on the book. Wallet holdings are not included.",
        "Best ask": "Cheapest listed circuit, in USDT0.",
        "Listed H": "Gate counts of listed circuits, added.",
        "Best day px": "Lowest ask divided by estimated daily TAPE.",
        Wallet: "Circuits in this wallet that are not listed.",
        Locked: "Circuits still inside the term contract.",
        Prints: "USDT0 of circuit sales in the recent window.",
      };
  return notes[label] ?? label;
}

function Mine({ zh, owned, locked, shapes, pace, pick, busy, onPick, onClaim }: { zh: boolean; owned: { id: string; gates: string; nIn: string; nOut: string }[]; locked: CircuitSeat[]; shapes: Map<string, Shape>; pace: Pace | null; pick: string; busy: boolean; onPick: (id: string) => void; onClaim: (id: string) => void }) {
  return (
    <div className="mt-3 max-h-[34rem] overflow-auto bg-card">
      <table className="w-full min-w-[40rem] text-left text-[12px]">
        <thead className="sticky top-0 bg-foil/90 text-ink/45">
          <tr>
            <th className="px-2 py-2 font-normal">{zh ? "电路" : "Circuit"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "结构" : "Shape"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "算力" : "Hash"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "估算日产" : "Day"}</th>
            <th className="px-2 py-2 font-normal">{zh ? "状态" : "State"}</th>
            <th className="px-2 py-2 text-right font-normal">{zh ? "操作" : "Act"}</th>
          </tr>
        </thead>
        <tbody>
          {owned.length + locked.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-ink/55">{zh ? "这个钱包没有可挂的电路。" : "This wallet has no circuit to list."}</td></tr> : null}
          {owned.map((row) => {
            const shape = shapes.get(row.id) ?? { nIn: row.nIn, nOut: row.nOut, state: "—", gates: row.gates };
            const share = shareOf(shape.gates, pace);
            return (
              <tr key={row.id} className={`cursor-pointer border-t border-gold/20 ${pick === row.id ? "bg-gold/10" : ""}`} onClick={() => onPick(row.id)}>
                <td className="px-2 py-1.5 font-mono">#{row.id}</td>
                <td className="px-2 py-1.5 font-mono">{shapeLine(shape)}</td>
                <td className="px-2 py-1.5 font-mono">{Number(shape.gates).toLocaleString("en-US")}</td>
                <td className="px-2 py-1.5 font-mono">{share != null ? cutTape(share) : "—"}</td>
                <td className="px-2 py-1.5">{zh ? "在钱包" : "Wallet"}</td>
                <td className="px-2 py-1.5 text-right">{zh ? "右边挂出" : "List on the right"}</td>
              </tr>
            );
          })}
          {locked.map((row) => {
            const due = row.unlock * 1000 <= Date.now();
            const shape = shapes.get(row.circuitId);
            const share = shareOf(shape?.gates ?? row.gates.toString(), pace);
            return (
              <tr key={row.id} className="border-t border-gold/20 text-ink/70">
                <td className="px-2 py-1.5 font-mono">#{row.circuitId}</td>
                <td className="px-2 py-1.5 font-mono">{shapeLine(shape)}</td>
                <td className="px-2 py-1.5 font-mono">{row.gates.toLocaleString("en-US")}</td>
                <td className="px-2 py-1.5 font-mono">{share != null ? cutTape(share) : "—"}</td>
                <td className="px-2 py-1.5">{due ? (zh ? "到期可领" : "Due") : (zh ? "锁着" : "Locked")}</td>
                <td className="px-2 py-1.5 text-right">{due ? <button type="button" disabled={busy} className="min-h-7 border border-gold px-2" onClick={() => onClaim(row.id)}>{zh ? "领回" : "Claim"}</button> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Prints({ zh, rows }: { zh: boolean; rows: CircuitPrint[] }) {
  return (
    <div className="mt-3 max-h-[34rem] overflow-auto bg-card">
      <table className="w-full min-w-[36rem] text-left text-[12px]">
        <thead className="sticky top-0 bg-foil/90 text-ink/45">
          <tr>{[zh ? "时间" : "Age", zh ? "电路" : "Circuit", zh ? "成交价" : "Price", zh ? "手续费" : "Fee", zh ? "买方" : "Buyer", zh ? "卖方" : "Seller", ""].map((head) => <th key={head || "tx"} className="px-2 py-2 font-normal">{head}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-ink/55">{zh ? "这段区块里没有电路成交。" : "No circuit sale in this window."}</td></tr> : null}
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
  );
}
