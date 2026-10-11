import { useEffect, useMemo, useState } from "react";
import { getCircuitBoard, type CircuitBoard, type CircuitPrint, type CircuitRow } from "@/lib/circuit-board";
import { buyOfficialCircuit, fillSignedCircuit } from "@/lib/official-trade";
import { BSC, TxPending, txUrl } from "@/lib/bsc";
import { connectBsc } from "@/lib/bsc";
import { currentAccount, onAccount } from "@/lib/wallet";
import { Kline } from "@/components/exchange/kline";

function num(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function short(addr: string): string {
  return addr && addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function age(ts: number): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function stateText(status: string, zh: boolean): string {
  if (status === "verified") return zh ? "已验证" : "Verified";
  if (status === "unverified") return zh ? "未验证" : "Unverified";
  return status || "—";
}

export function CircuitMarket({ zh, lang }: { zh: boolean; lang: "zh" | "en" }) {
  const [board, setBoard] = useState<CircuitBoard | null>(null);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [tab, setTab] = useState<"official" | "other" | "mine" | "tape">("official");
  const [chart, setChart] = useState(true);
  const [sort, setSort] = useState<"day" | "ask" | "hash">("day");
  const [query, setQuery] = useState("");
  const [minHash, setMinHash] = useState("");
  const [maxHash, setMaxHash] = useState("");
  const [maxDay, setMaxDay] = useState("");
  const [picked, setPicked] = useState<CircuitRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      getCircuitBoard({ data: { account: account ?? "" } })
        .then((row) => { if (!dead) setBoard(row); })
        .catch(() => { if (!dead) setBoard(null); });
    };
    pull();
    const id = window.setInterval(pull, 20000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

  const rows = useMemo(() => {
    const source = tab === "other" ? board?.other ?? [] : tab === "mine" ? board?.mine ?? [] : board?.official ?? [];
    const q = query.trim().toLowerCase();
    const lo = Number(minHash);
    const hi = Number(maxHash);
    const cap = Number(maxDay);
    return source
      .filter((row) => !q || row.name.toLowerCase().includes(q) || row.tokenId.includes(q))
      .filter((row) => !(lo > 0) || row.hash >= lo)
      .filter((row) => !(hi > 0) || row.hash <= hi)
      .filter((row) => !(cap > 0) || (row.dayPx != null && row.dayPx <= cap))
      .sort((a, b) => {
        if (sort === "ask") return (a.ask ?? Number.POSITIVE_INFINITY) - (b.ask ?? Number.POSITIVE_INFINITY);
        if (sort === "hash") return b.hash - a.hash;
        return (a.dayPx ?? Number.POSITIVE_INFINITY) - (b.dayPx ?? Number.POSITIVE_INFINITY);
      });
  }, [board, tab, query, minHash, maxHash, maxDay, sort]);

  const buy = async (row: CircuitRow) => {
    if (!row.askWei || (row.officialId == null && !row.signed)) return;
    setPicked(row);
    setBusy(true);
    setBad(false);
    setNote(zh ? "先付千分之二，再签这一张。后面那笔没成交，服务费不退。" : "The 0.2% is paid first. If the fill fails, the fee stays.");
    try {
      const from = currentAccount() ?? (await connectBsc());
      const hash = row.officialId != null
        ? await buyOfficialCircuit(from, BigInt(row.officialId), BigInt(row.askWei))
        : await fillSignedCircuit(from, row.signed!);
      setNote(zh ? "买入已发出。" : "The buy was sent.");
      window.open(txUrl(hash), "_blank", "noopener,noreferrer");
    } catch (error) {
      setBad(true);
      const message = error instanceof Error ? error.message : "";
      setNote(
        message === "pending" || error instanceof TxPending
          ? zh ? "已经提交，回执还没读到。不要再签同一张。" : "Submitted. The receipt is not back."
          : message === "fee-kept"
            ? zh ? "服务费已经付了，买入没有完成。服务费不退。" : "The fee was paid. The buy did not finish."
            : zh ? "这张现在买不进。价格可能变了，刷新后再点。" : "This one cannot be bought now. The price may have moved.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <div className="grid grid-cols-2 border border-gold/50 text-xs sm:grid-cols-4 xl:grid-cols-7">
          {[
            [zh ? "日产能参考价" : "Day-output ref", board?.refDayPx != null ? `${num(board.refDayPx, 2)} BNB` : "—"],
            [zh ? "24h 成交额" : "24h volume", board?.vol24h != null ? `${num(board.vol24h, 2)} BNB` : "—"],
            [zh ? "24h 成交电路" : "24h circuits", board?.trades24h != null ? String(board.trades24h) : "—"],
            [zh ? "有效挂单" : "Open asks", board?.listed != null ? board.listed.toLocaleString("en-US") : "—"],
            [zh ? "电路总量" : "Circuits", board?.circuits != null ? board.circuits.toLocaleString("en-US") : "—"],
            [zh ? "持仓地址" : "Holders", board?.holders != null ? board.holders.toLocaleString("en-US") : "—"],
            [zh ? "挂单算力" : "Listed H", board?.listedHash != null ? board.listedHash.toLocaleString("en-US") : "—"],
          ].map(([k, v]) => (
            <p key={k} className="border-gold/30 px-2 py-2 [&:not(:last-child)]:border-r">
              <span className="block text-[10px] text-ink/45">{k}</span>
              <span className="font-mono text-sm">{v}</span>
            </p>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["official", "other", "mine", "tape"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`border-b-2 px-2 py-1 text-sm ${tab === id ? "border-ink font-medium" : "border-transparent text-ink/55"}`}>
              {id === "official" ? (zh ? "官方矿机" : "Official") : id === "other" ? (zh ? "其他电路" : "Other") : id === "mine" ? (zh ? "我的电路" : "Mine") : zh ? "成交" : "Prints"}
            </button>
          ))}
          <button type="button" onClick={() => setChart((on) => !on)} className={`ml-auto border px-2 py-1 text-xs ${chart ? "border-ink bg-ink text-paper" : "border-gold"}`}>{zh ? "日产能 K 线" : "Chart"}</button>
          {(["day", "ask", "hash"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setSort(id)} className={`border px-2 py-1 text-xs ${sort === id ? "border-ink" : "border-gold"}`}>
              {id === "day" ? (zh ? "日产能价" : "Day px") : id === "ask" ? (zh ? "卖价" : "Ask") : zh ? "算力" : "Hash"}
            </button>
          ))}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜处理器或编号" : "Search"} className="min-h-8 w-36 border border-gold/50 bg-transparent px-2 text-xs outline-none" />
        </div>
        {chart && (board?.bars.length ?? 0) > 1 ? (
          <div className="mt-2 border border-gold/40 bg-card">
            <p className="px-2 pt-2 text-[10px] text-ink/45">{zh ? "24 小时日产能价。每根是一小时。" : "24h day-output price. One candle is one hour."}</p>
            <Kline bars={board?.bars ?? []} mark={board?.refDayPx ?? 0} lang={lang} desk="circuit" />
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-ink/45">
          {board?.ok
            ? zh
              ? `快照 ${board.asOf ?? ""}。表里是当前排序的前 50 张。点一行右边的买入就签。官方盘和签名单都能买。另付千分之二，先付，后面没成交不退。`
              : `Snapshot ${board.asOf ?? ""}. Fifty rows. Day price is ask divided by estimated 24h BEM. This site only buys the official tapeout book.`
            : zh ? "电路快照没读到。" : "The circuit snapshot did not load."}
        </p>
        {tab === "tape" ? <Prints zh={zh} rows={board?.prints ?? []} /> : <Book zh={zh} rows={rows} picked={picked} busy={busy} onPick={setPicked} onBuy={(row) => void buy(row)} />}
      </div>
      <aside className="border border-gold bg-card px-3 py-3 lg:sticky lg:top-16">
        <p className="text-[11px] tracking-[0.16em] text-gold">{zh ? "这一张" : "This circuit"}</p>
        <p className="mt-2 text-sm">{picked ? `${picked.name} #${picked.tokenId}` : zh ? "点一行看全部指标" : "Pick a row"}</p>
        {picked ? <Ticket zh={zh} row={picked} /> : null}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="text-[11px] text-ink/55">{zh ? "最低算力" : "Min H"}<input value={minHash} onChange={(event) => setMinHash(event.target.value.replace(/[^\d.]/g, ""))} className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-1 font-mono text-xs outline-none" /></label>
          <label className="text-[11px] text-ink/55">{zh ? "最高算力" : "Max H"}<input value={maxHash} onChange={(event) => setMaxHash(event.target.value.replace(/[^\d.]/g, ""))} className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-1 font-mono text-xs outline-none" /></label>
          <label className="col-span-2 text-[11px] text-ink/55">{zh ? "日产能价不高于" : "Day price at most"}<input value={maxDay} onChange={(event) => setMaxDay(event.target.value.replace(/[^\d.]/g, ""))} placeholder="BNB" className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-1 font-mono text-xs outline-none" /></label>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-ink/50">{zh ? "筛选只改左边的表。电路整张成交，不能拆。买入另付千分之二，先付，不退。" : "Filters only change the table. A circuit sells whole. Buying adds 0.2%, paid first."}</p>
        {picked && (picked.officialId != null || picked.signed) ? (
          <button type="button" disabled={busy} className="mt-3 min-h-11 w-full bg-[#f23645] text-sm text-white disabled:opacity-40" onClick={() => void buy(picked)}>{zh ? "买入这一张" : "Buy this one"}</button>
        ) : picked ? <p className="mt-2 text-xs leading-5 text-ink/60">{zh ? "这张现在没有卖价。" : "This one has no ask."}</p> : null}
        {note ? <p className={`mt-2 text-xs leading-5 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </aside>
    </section>
  );
}

function Ticket({ zh, row }: { zh: boolean; row: CircuitRow }) {
  const lines: [string, string][] = [
    [zh ? "结构" : "Shape", `NAND ${row.nand} · LATCH ${row.latch}`],
    [zh ? "端口" : "Ports", `${zh ? "入" : "In"} ${row.nIn} → ${zh ? "出" : "Out"} ${row.nOut} · ${zh ? "态" : "St"} ${row.nState}`],
    [zh ? "门" : "Gates", row.gates.toLocaleString("en-US")],
    [zh ? "状态" : "Status", stateText(row.status, zh)],
    ["H", row.hash.toLocaleString("en-US")],
    [zh ? "晶体均价" : "Per transistor", row.crystal != null ? `${num(row.crystal, 5)} BNB` : "—"],
    [zh ? "算力均价" : "Per H", row.hashPx != null ? `${num(row.hashPx, 5)} BNB` : "—"],
    [zh ? "预计 24h" : "Est. 24h", row.dayBem != null ? `${num(row.dayBem, 4)} BEM` : "—"],
    [zh ? "日产能价" : "Day price", row.dayPx != null ? `${num(row.dayPx, 2)} BNB` : "—"],
    [zh ? "卖价" : "Ask", row.ask != null ? `${num(row.ask, 4)} BNB` : "—"],
    [zh ? "最高出价" : "Best bid", row.bid != null ? `${num(row.bid, 4)} BNB` : zh ? "暂无" : "None"],
    [zh ? "卖家" : "Seller", short(row.seller)],
    [zh ? "静态回本" : "Payback", row.paybackDays != null ? `${num(row.paybackDays, 1)} ${zh ? "天" : "d"}` : "—"],
  ];
  return (
    <dl className="mt-2 border-t border-gold/30">
      {lines.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[5.2rem_minmax(0,1fr)] gap-2 border-b border-gold/20 py-1 text-xs">
          <dt className="text-ink/45">{k}</dt>
          <dd className="text-right font-mono">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Book({ zh, rows, picked, busy, onPick, onBuy }: { zh: boolean; rows: CircuitRow[]; picked: CircuitRow | null; busy: boolean; onPick: (row: CircuitRow) => void; onBuy: (row: CircuitRow) => void }) {
  return (
    <div className="mt-2 max-h-[32rem] overflow-auto border border-gold/40">
      <table className="w-full min-w-[68rem] text-left text-xs">
        <thead className="sticky top-0 bg-paper text-ink/45">
          <tr>
            {[zh ? "时间" : "Age", zh ? "电路" : "Circuit", zh ? "结构" : "Shape", zh ? "状态" : "Status", "H", zh ? "晶体均价" : "Crystal", zh ? "算力均价" : "Per H", zh ? "预计24h" : "24h", zh ? "日产能价" : "Day px", zh ? "卖价" : "Ask", zh ? "最高出价" : "Bid"].map((head) => (
              <th key={head} className="px-2 py-2 font-normal">{head}</th>
            ))}
            <th className="sticky right-0 bg-paper px-2 py-2 text-right font-normal">{zh ? "买入" : "Buy"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={12} className="px-2 py-4 text-ink/50">{zh ? "这一档没有电路。" : "Nothing in this view."}</td></tr> : null}
          {rows.map((row) => (
            <tr key={row.key} className={`cursor-pointer border-t border-gold/20 ${picked?.key === row.key ? "bg-gold/10" : ""}`} onClick={() => onPick(row)}>
              <td className="px-2 py-1.5 font-mono">{age(row.listedAt)}</td>
              <td className="px-2 py-1.5"><span className="block">{row.name}</span><span className="font-mono text-[11px] text-ink/45">#{row.tokenId}</span></td>
              <td className="px-2 py-1.5 font-mono">NAND {row.nand} · LATCH {row.latch}<br />{row.nIn} → {row.nOut} · S{row.nState}</td>
              <td className={`px-2 py-1.5 ${row.status === "verified" ? "text-[#089981]" : "text-ink/45"}`}>{stateText(row.status, zh)}</td>
              <td className="px-2 py-1.5 font-mono">{row.hash.toLocaleString("en-US")}</td>
              <td className="px-2 py-1.5 font-mono">{num(row.crystal, 5)}</td>
              <td className="px-2 py-1.5 font-mono">{num(row.hashPx, 5)}</td>
              <td className="px-2 py-1.5 font-mono">{row.dayBem != null ? `${num(row.dayBem, 3)} BEM` : "—"}</td>
              <td className="px-2 py-1.5 font-mono">{row.dayPx != null ? `${num(row.dayPx, 2)}` : "—"}</td>
              <td className="px-2 py-1.5 font-mono text-sell">{row.ask != null ? `${num(row.ask, 4)}` : "—"}</td>
              <td className="px-2 py-1.5 font-mono">{row.bid != null ? num(row.bid, 4) : "—"}</td>
              <td className="sticky right-0 bg-paper px-2 py-1.5 text-right">
                {row.ask != null && (row.officialId != null || row.signed) ? (
                  <button type="button" disabled={busy} className="min-h-7 bg-[#f23645] px-2 text-white disabled:opacity-40" onClick={(event) => { event.stopPropagation(); onBuy(row); }}>{zh ? "买入" : "Buy"}</button>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Prints({ zh, rows }: { zh: boolean; rows: CircuitPrint[] }) {
  return (
    <div className="mt-2 max-h-[32rem] overflow-auto border border-gold/40">
      <table className="w-full min-w-[72rem] text-left text-xs">
        <thead className="sticky top-0 bg-paper text-ink/45">
          <tr>
            {[zh ? "时间" : "Time", zh ? "电路" : "Circuit", zh ? "结构" : "Shape", zh ? "状态" : "Status", "H", zh ? "晶体均价" : "Crystal", zh ? "算力均价" : "Per H", zh ? "预计24h" : "24h", zh ? "日产能价" : "Day px", zh ? "成交价" : "Price", zh ? "买卖" : "Who"].map((head) => (
              <th key={head} className="px-2 py-2 font-normal">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={11} className="px-2 py-4 text-ink/50">{zh ? "没有成交。" : "No prints."}</td></tr> : null}
          {rows.map((row) => (
            <tr key={`${row.tx}-${row.tokenId}`} className="border-t border-gold/20">
              <td className="px-2 py-1.5 font-mono">{age(row.ts)}</td>
              <td className="px-2 py-1.5">{row.name}<br /><span className="font-mono text-[11px] text-ink/45">#{row.tokenId}</span></td>
              <td className="px-2 py-1.5 font-mono">NAND {row.nand} · LATCH {row.latch}<br />{row.nIn} → {row.nOut} · S{row.nState}</td>
              <td className="px-2 py-1.5">{stateText(row.status, zh)}</td>
              <td className="px-2 py-1.5 font-mono">{row.hash.toLocaleString("en-US")}</td>
              <td className="px-2 py-1.5 font-mono">{num(row.crystal, 5)}</td>
              <td className="px-2 py-1.5 font-mono">{num(row.hashPx, 5)}</td>
              <td className="px-2 py-1.5 font-mono">{row.dayBem != null ? `${num(row.dayBem, 3)}` : "—"}</td>
              <td className="px-2 py-1.5 font-mono">{row.dayPx != null ? num(row.dayPx, 2) : "—"}</td>
              <td className="px-2 py-1.5 font-mono">{num(row.price, 4)} BNB</td>
              <td className="px-2 py-1.5 font-mono">
                <a className="underline" href={`${BSC.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{zh ? "买" : "Buy"} {short(row.buyer)}</a>
                <br />{zh ? "卖" : "Sell"} {short(row.seller)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
