import { useEffect, useMemo, useState } from "react";
import { getCircuitBoard, type CircuitBoard, type CircuitPrint, type CircuitRow } from "@/lib/circuit-board";
import { buyOfficialCircuit, fillSignedCircuit } from "@/lib/official-trade";
import { BSC, TxPending, txUrl } from "@/lib/bsc";
import { connectBsc } from "@/lib/bsc";
import { currentAccount, onAccount } from "@/lib/wallet";
import { Kline } from "@/components/exchange/kline";
import { Hint, verifyCopy } from "@/components/exchange/hint";

function noted(zh: boolean, label: string): string | null {
  const notes: Record<string, string> = zh
    ? {
        "日产能参考价": "买下每天产出 1 BEM 的电路，参考要花多少 BNB。这是全市场的参考，不是某一张的卖价。",
        "挂单算力": "现在还挂着的电路，算力 H 加在一起。",
        H: "算力 H 是这张电路当前计入挖矿的权重。验证过的进验证池，没验证的进另一池。",
        "日产能价": "卖价除以预计 24 小时产出的 BEM。越低，同样的钱买到的日产出越多。",
        "卖价": "卖方挂出的单价。买方按这个数付 BNB。它不是日产能价。",
        "算力均价": "卖价除以算力 H。每一份算力花了多少 BNB。",
        "晶体均价": "卖价除以这张电路直接用掉的 NAND 和 LATCH 之和。",
        "预计24h": "按现在的全网权重，这张电路大约每天分到的 BEM。有人新开工，这个数会变。",
        "日产能 K 线": "每根蜡烛是一小时的日产能价。鼠标停在字上出说明，移开就消失。绿涨红跌。",
        "算力": "按算力 H 从高到低排。H 是这张电路计入挖矿的权重。",
      }
    : {
        "Day-output ref": "BNB for one BEM of daily output. A market reference, not one circuit's ask.",
        "Listed H": "Hash of the circuits still offered, added together.",
        H: "Hash currently counted for mining.",
        "Day px": "Ask divided by estimated BEM over 24 hours. Lower buys more daily output.",
        Ask: "The seller's price in BNB. Not the day-output price.",
        "Per H": "Ask divided by hash.",
        Crystal: "Ask divided by the NAND plus LATCH used in this circuit.",
        "24h": "Estimated BEM this circuit receives in a day at the current network weight.",
        Hash: "Sort by hash, high to low.",
        "Day chart": "Each candle is one hour of the day-output price. The note hides when the pointer leaves.",
      };
  return notes[label] ?? null;
}

function Label({ zh, text }: { zh: boolean; text: string }) {
  const tip = noted(zh, text);
  return tip ? <Hint label={text} text={tip} /> : <>{text}</>;
}

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
  if (status === "optimal") return zh ? "最优" : "Optimal";
  return status || "—";
}

function StatusMark({ status, zh }: { status: string; zh: boolean }) {
  const label = stateText(status, zh);
  return <Hint label={label} text={verifyCopy(zh)} />;
}

export function CircuitMarket({ zh, lang }: { zh: boolean; lang: "zh" | "en" }) {
  const [board, setBoard] = useState<CircuitBoard | null>(null);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [tab, setTab] = useState<"official" | "other" | "mine">("official");
  const [sheet, setSheet] = useState<"book" | "prints">("book");
  const [chart, setChart] = useState(false);
  const [sort, setSort] = useState<"day" | "ask" | "hash">("day");
  const [query, setQuery] = useState("");
  const [minHash, setMinHash] = useState("");
  const [maxHash, setMaxHash] = useState("");
  const [maxDay, setMaxDay] = useState("");
  const [picked, setPicked] = useState<CircuitRow | null>(null);
  const [print, setPrint] = useState<CircuitPrint | null>(null);
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
    const officialKeys = new Set((board?.official ?? []).map((row) => row.key));
    const source = tab === "other" ? (board?.other ?? []).filter((row) => !officialKeys.has(row.key)) : tab === "mine" ? board?.mine ?? [] : board?.official ?? [];
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
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="min-w-0">
        <nav className="flex gap-5 overflow-x-auto border-b border-gold/40">
          {([
            ["official", zh ? "TapeOut矿机" : "TapeOut"],
            ["other", zh ? "其他电路" : "Other"],
            ["mine", zh ? "我的电路" : "Mine"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`shrink-0 border-b-2 py-2 text-sm ${tab === id ? "border-ink font-medium" : "border-transparent text-ink/45"}`}>{label}</button>
          ))}
        </nav>
        <div className="mt-2 flex gap-4 overflow-x-auto text-xs">
          {[
            [zh ? "TapeOut矿机" : "TapeOut", zh ? "电路" : "Circuits"],
            [zh ? "日产能参考价" : "Day-output ref", board?.refDayPx != null ? `${num(board.refDayPx, 2)} BNB` : "—"],
            [zh ? "24h 成交额" : "24h volume", board?.vol24h != null ? `${num(board.vol24h, 2)} BNB` : "—"],
            [zh ? "24h 成交电路" : "24h circuits", board?.trades24h != null ? String(board.trades24h) : "—"],
            [zh ? "有效挂单" : "Open asks", board?.listed != null ? board.listed.toLocaleString("en-US") : "—"],
            [zh ? "电路总量" : "Circuits", board?.circuits != null ? board.circuits.toLocaleString("en-US") : "—"],
            [zh ? "持仓地址" : "Holders", board?.holders != null ? board.holders.toLocaleString("en-US") : "—"],
          ].map(([k, v]) => (
            <p key={k} className="border-gold/30 px-2 py-2 [&:not(:last-child)]:border-r">
              <span className="block text-[10px] text-ink/45"><Label zh={zh} text={k} /></span>
              <span className="font-mono text-sm">{v}</span>
            </p>
          ))}
        </div>
        <div className="mt-2 flex gap-4 overflow-x-auto border-b border-gold/30 text-sm">
          <button type="button" onClick={() => setSheet("book")} className={`shrink-0 border-b-2 py-1.5 ${sheet === "book" ? "border-ink" : "border-transparent text-ink/45"}`}>{zh ? "挂单" : "Book"}</button>
          <button type="button" onClick={() => setSheet("prints")} className={`shrink-0 border-b-2 py-1.5 ${sheet === "prints" ? "border-ink" : "border-transparent text-ink/45"}`}>{zh ? "成交" : "Prints"}</button>
          <button type="button" onClick={() => setChart((on) => !on)} className={`shrink-0 border-b-2 py-1.5 ${chart ? "border-ink" : "border-transparent text-ink/45"}`}>{zh ? "日产能" : "Day"}</button>
          {(["day", "ask", "hash"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setSort(id)} className={`shrink-0 border-b-2 py-1.5 ${sort === id ? "border-ink" : "border-transparent text-ink/45"}`}>
              {id === "day" ? (zh ? "按日产能" : "By day") : id === "ask" ? (zh ? "按卖价" : "By ask") : (zh ? "按算力" : "By hash")}
            </button>
          ))}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索" : "Search"} className="ml-auto w-24 shrink-0 bg-transparent py-1 text-xs outline-none" />
        </div>
        {chart && (board?.bars.length ?? 0) > 1 ? (
          <div className="mt-2 border border-gold/40 bg-card">
            <p className="px-2 pt-2 text-[10px] text-ink/45">{zh ? "24 小时日产能价。每根是一小时。" : "24h day-output price. One candle is one hour."}</p>
            <Kline bars={board?.bars ?? []} mark={board?.refDayPx ?? 0} lang={lang} desk="circuit" />
          </div>
        ) : null}
        <p className="mt-2 text-[11px] text-ink/45">{zh ? "点一行，右边看这张。买入另付千分之二，先付，没成交不退。" : "Pick a row. Buying adds 0.2%, paid first."}</p>
        {sheet === "prints" ? <Prints zh={zh} rows={board?.prints ?? []} picked={print} onPick={setPrint} /> : <Book zh={zh} rows={rows} picked={picked} busy={busy} onPick={(row) => { setPrint(null); setPicked(row); }} onBuy={(row) => void buy(row)} />}
      </div>
      <aside className="border border-gold bg-card lg:sticky lg:top-16">
        {sheet === "prints" && print ? (
          <div className="px-4 py-4">
            <p className="text-[11px] tracking-[0.16em] text-gold">{zh ? "本次成交" : "This print"}</p>
            <p className="mt-2 text-sm">{print.name} #{print.tokenId}</p>
            <dl className="mt-3">
              <RightLine k={zh ? "成交价" : "Price"} v={`${num(print.price, 4)} BNB`} />
              <RightLine k={zh ? "成交时可挖矿市值" : "Mining value then"} v="—" tip={zh ? "公开成交没有这一列。不写成 0。" : "The public print has no mining value. It is not shown as zero."} />
              <RightLine k={zh ? "成交时间" : "Time"} v={age(print.ts)} />
              <RightLine k={zh ? "买方" : "Buyer"} v={short(print.buyer)} />
              <RightLine k={zh ? "卖方" : "Seller"} v={short(print.seller)} />
              <RightLine k={zh ? "交易哈希" : "Tx"} v={short(print.tx)} />
            </dl>
            <a className="mt-3 inline-flex text-sm underline" href={`${BSC.explorer}/tx/${print.tx}`} target="_blank" rel="noreferrer">{zh ? "在浏览器打开" : "Open the transaction"}</a>
          </div>
        ) : (
          <BuyColumn
            zh={zh}
            row={picked}
            rows={rows}
            busy={busy}
            onBuy={() => picked && void buy(picked)}
          />
        )}
        <details className="border-t border-gold/30 px-4 py-3">
          <summary className="cursor-pointer text-[12px] text-ink/55">{zh ? "筛选" : "Filter"}</summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-[11px] text-ink/55">{zh ? "最低算力" : "Min H"}<input value={minHash} onChange={(event) => setMinHash(event.target.value.replace(/[^\d.]/g, ""))} className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-1 font-mono text-xs outline-none" /></label>
            <label className="text-[11px] text-ink/55">{zh ? "最高算力" : "Max H"}<input value={maxHash} onChange={(event) => setMaxHash(event.target.value.replace(/[^\d.]/g, ""))} className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-1 font-mono text-xs outline-none" /></label>
            <label className="col-span-2 text-[11px] text-ink/55">{zh ? "日产能价不高于" : "Day price at most"}<input value={maxDay} onChange={(event) => setMaxDay(event.target.value.replace(/[^\d.]/g, ""))} placeholder="BNB" className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-1 font-mono text-xs outline-none" /></label>
          </div>
        </details>
        {note ? <p className={`px-4 pb-3 text-xs leading-5 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </aside>
    </section>
  );
}

function RightLine({ k, v, tip }: { k: string; v: string; tip?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-gold/20 py-2 text-[13px]">
      <dt className="text-ink/45">{tip ? <Hint label={k} text={tip} /> : k}</dt>
      <dd className="text-right font-mono">{v}</dd>
    </div>
  );
}

function BuyColumn({ zh, row, rows, busy, onBuy }: { zh: boolean; row: CircuitRow | null; rows: CircuitRow[]; busy: boolean; onBuy: () => void }) {
  const marketAsk = rows.reduce<number | null>((min, item) => (item.ask != null && (min == null || item.ask < min) ? item.ask : min), null);
  const marketBid = rows.reduce<number | null>((max, item) => (item.bid != null && (max == null || item.bid > max) ? item.bid : max), null);
  const ask = row?.ask ?? marketAsk;
  const bid = row ? row.bid : marketBid;
  const can = Boolean(row && row.ask != null && (row.officialId != null || row.signed));
  return (
    <div>
      <div className="grid grid-cols-2 border-b border-gold/30">
        <div className="border-r border-gold/30 px-4 py-3">
          <p className="text-[11px] text-ink/45"><Hint label={zh ? "最低卖价" : "Best ask"} text={zh ? "这张电路的卖价。没点选时，是左边表里最低的卖价。单位 BNB。" : "This circuit's ask. With nothing picked, the lowest ask in the table. BNB."} /></p>
          <p className="mt-1 font-mono text-xl tabular-nums text-[#f23645]">{ask != null ? num(ask, 4) : "—"}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-[11px] text-ink/45"><Hint label={zh ? "最高出价" : "Best bid"} text={zh ? "有人挂的最高买价。没有就写暂无，不写成 0。" : "The highest bid. None is not written as zero."} /></p>
          <p className="mt-1 font-mono text-xl tabular-nums">{bid != null ? num(bid, 4) : (zh ? "暂无" : "None")}</p>
        </div>
      </div>
      <div className="px-4 py-4">
        <p className="text-sm">{row ? `${row.name} #${row.tokenId}` : (zh ? "点左边一行" : "Pick a row")}</p>
        {row ? <p className="mt-1 text-[12px]"><StatusMark status={row.status} zh={zh} /></p> : null}
        <label className="mt-4 block text-[12px] text-ink/55">
          {zh ? "购买数量" : "Quantity"}
          <input readOnly value={can ? "1" : ""} placeholder="1" className="mt-1 h-11 w-full border border-gold/50 bg-paper px-3 font-mono text-lg text-ink outline-none" />
        </label>
        <p className="mt-1 text-[12px] text-ink/45">{can ? (zh ? "当前可购买 1 个" : "1 available") : (zh ? "当前可购买 0 个" : "0 available")}</p>
        <div className="mt-4 flex items-end justify-between gap-3 border-t border-gold/30 pt-3">
          <span className="text-sm">{zh ? "需支付" : "Pay"}</span>
          <strong className="font-mono text-2xl font-medium tabular-nums">{ask != null && (row ? can : false) ? `${num(ask, 4)} BNB` : "—"}</strong>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-ink/45">{zh ? "电路整张成交，数量锁成 1。买入另付本站千分之二，先付，没成交不退。" : "A circuit sells whole, so the quantity stays 1. Buying adds this site's 0.2%, paid first and not returned."}</p>
        <button type="button" disabled={!can || busy} className="mt-3 min-h-12 w-full bg-[#f23645] text-sm text-white disabled:opacity-40" onClick={onBuy}>{zh ? "买入这一张" : "Buy this one"}</button>
        {row ? (
          <dl className="mt-4 border-t border-gold/30">
            <RightLine k={zh ? "结构" : "Shape"} v={`NAND ${row.nand} · LATCH ${row.latch}`} />
            <RightLine k={zh ? "端口" : "Ports"} v={`${row.nIn} → ${row.nOut} · S${row.nState}`} />
            <RightLine k="H" v={row.hash.toLocaleString("en-US")} />
            <RightLine k={zh ? "预计 24h" : "Est. 24h"} v={row.dayBem != null ? `${num(row.dayBem, 4)} BEM` : "—"} />
            <RightLine k={zh ? "日产能价" : "Day price"} v={row.dayPx != null ? `${num(row.dayPx, 2)} BNB` : "—"} />
            <RightLine k={zh ? "卖家" : "Seller"} v={short(row.seller)} />
          </dl>
        ) : null}
      </div>
    </div>
  );
}

function Book({ zh, rows, picked, busy, onPick, onBuy }: { zh: boolean; rows: CircuitRow[]; picked: CircuitRow | null; busy: boolean; onPick: (row: CircuitRow) => void; onBuy: (row: CircuitRow) => void }) {
  return (
    <>
      <ul className="mt-2 border border-gold/40 md:hidden">
        {rows.length === 0 ? <li className="px-3 py-4 text-sm text-ink/50">{zh ? "这一档没有电路。" : "Nothing in this view."}</li> : null}
        {rows.map((row) => (
          <li key={row.key} className={`border-t border-gold/20 px-3 py-2 ${picked?.key === row.key ? "bg-gold/10" : ""}`}>
            <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => onPick(row)}>
              <span>
                <span className="block text-sm">{row.name}</span>
                <span className="font-mono text-[11px] text-ink/45">#{row.tokenId} · NAND {row.nand} · LATCH {row.latch}</span>
                <span className={`mt-1 block text-[11px] ${row.status === "verified" ? "text-[#089981]" : "text-ink/45"}`}><StatusMark status={row.status} zh={zh} /></span>
              </span>
              <span className="text-right font-mono text-xs">
                <span className="block text-[#f23645]">{row.ask != null ? `${num(row.ask, 4)} BNB` : "—"}</span>
                <span className="text-ink/45">{row.dayPx != null ? `${num(row.dayPx, 2)}` : "—"}</span>
              </span>
            </button>
            {row.ask != null && (row.officialId != null || row.signed) ? (
              <button type="button" disabled={busy} className="mt-2 h-8 w-full bg-[#f23645] text-xs text-white disabled:opacity-40" onClick={() => onBuy(row)}>{zh ? "买入" : "Buy"}</button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-2 hidden max-h-[32rem] overflow-auto border border-gold/40 md:block">
      <table className="w-full min-w-[68rem] text-left text-xs">
        <thead className="sticky top-0 bg-paper text-ink/45">
          <tr>
            {[zh ? "时间" : "Age", zh ? "电路" : "Circuit", zh ? "结构" : "Shape", zh ? "状态" : "Status", "H", zh ? "晶体均价" : "Crystal", zh ? "算力均价" : "Per H", zh ? "预计24h" : "24h", zh ? "日产能价" : "Day px", zh ? "卖价" : "Ask", zh ? "最高出价" : "Bid"].map((head) => (
              <th key={head} className="px-2 py-2 font-normal"><Label zh={zh} text={head} /></th>
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
              <td className={`px-2 py-1.5 ${row.status === "verified" ? "text-[#089981]" : "text-ink/45"}`}><StatusMark status={row.status} zh={zh} /></td>
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
    </>
  );
}

function Prints({ zh, rows, picked, onPick }: { zh: boolean; rows: CircuitPrint[]; picked: CircuitPrint | null; onPick: (row: CircuitPrint) => void }) {
  return (
    <div className="mt-2 max-h-[32rem] overflow-auto border border-gold/40">
      <table className="w-full min-w-[72rem] text-left text-xs">
        <thead className="sticky top-0 bg-paper text-ink/45">
          <tr>
            {[zh ? "时间" : "Time", zh ? "电路" : "Circuit", zh ? "结构" : "Shape", zh ? "状态" : "Status", "H", zh ? "晶体均价" : "Crystal", zh ? "算力均价" : "Per H", zh ? "预计24h" : "24h", zh ? "日产能价" : "Day px", zh ? "成交价" : "Price", zh ? "买卖" : "Who"].map((head) => (
              <th key={head} className="px-2 py-2 font-normal"><Label zh={zh} text={head} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={11} className="px-2 py-4 text-ink/50">{zh ? "没有成交。" : "No prints."}</td></tr> : null}
          {rows.map((row) => (
            <tr key={`${row.tx}-${row.tokenId}`} className={`cursor-pointer border-t border-gold/20 ${picked?.tx === row.tx && picked.tokenId === row.tokenId ? "bg-gold/10" : ""}`} onClick={() => onPick(row)}>
              <td className="px-2 py-1.5 font-mono">{age(row.ts)}</td>
              <td className="px-2 py-1.5">{row.name}<br /><span className="font-mono text-[11px] text-ink/45">#{row.tokenId}</span></td>
              <td className="px-2 py-1.5 font-mono">NAND {row.nand} · LATCH {row.latch}<br />{row.nIn} → {row.nOut} · S{row.nState}</td>
              <td className="px-2 py-1.5"><StatusMark status={row.status} zh={zh} /></td>
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
