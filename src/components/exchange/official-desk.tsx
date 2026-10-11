import { useEffect, useMemo, useState } from "react";
import { parseEther } from "viem";
import { useExchange } from "@/lib/exchange-store";
import { getOfficialBooks, OFFICIAL, type OfficialBid, type OfficialBooks, type OfficialList, type OfficialTrade } from "@/lib/official-books";
import { buyOfficialCircuit, fillOfficialBid, placeOfficialBid } from "@/lib/official-trade";
import { BSC, TxPending, txUrl } from "@/lib/bsc";
import { connectBsc } from "@/lib/bsc";
import { currentAccount, onAccount } from "@/lib/wallet";
import { Kline, type Bar } from "@/components/exchange/kline";

function px(n: number): string {
  if (!(n > 0)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
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

function hourBars(trades: OfficialTrade[]): Bar[] {
  const rows = trades.filter((row) => row.ts > 0 && row.priceBnb > 0).sort((a, b) => a.ts - b.ts);
  const map = new Map<number, Bar>();
  for (const row of rows) {
    const bucket = Math.floor(row.ts / 3600) * 3600;
    const cur = map.get(bucket);
    if (!cur) map.set(bucket, { t: bucket, o: row.priceBnb, h: row.priceBnb, l: row.priceBnb, c: row.priceBnb, v: row.priceBnb });
    else {
      cur.h = Math.max(cur.h, row.priceBnb);
      cur.l = Math.min(cur.l, row.priceBnb);
      cur.c = row.priceBnb;
      cur.v = (cur.v ?? 0) + row.priceBnb;
    }
  }
  return [...map.values()];
}

function CircuitMarket({
  zh,
  lang,
  books,
  busy,
  note,
  bad,
  run,
}: {
  zh: boolean;
  lang: "zh" | "en";
  books: OfficialBooks | null;
  busy: boolean;
  note: string | null;
  bad: boolean;
  run: (act: () => Promise<string>) => Promise<void>;
}) {
  const [tab, setTab] = useState<"book" | "tape" | "mine">("book");
  const [chart, setChart] = useState(true);
  const [sort, setSort] = useState<"price" | "gates">("price");
  const [list, setList] = useState<OfficialList | null>(null);
  const [ack, setAck] = useState(false);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [query, setQuery] = useState("");
  useEffect(() => onAccount(setAccount), []);
  const trades = books?.trades ?? [];
  const bars = useMemo(() => hourBars(trades), [trades]);
  const last = trades[0];
  const day = Math.floor(Date.now() / 1000) - 86400;
  const dayTrades = trades.filter((row) => row.ts >= day);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    const mine = account?.toLowerCase();
    return (books?.lists ?? [])
      .filter((row) => !q || row.name.toLowerCase().includes(q) || row.circuitId.includes(q))
      .filter((row) => tab !== "mine" || (mine && row.seller.toLowerCase() === mine))
      .sort((a, b) => (sort === "gates" ? b.gates - a.gates : a.priceBnb - b.priceBnb));
  }, [books, q, sort, tab, account]);
  const mineTrades = trades.filter((row) => account && (row.buyer.toLowerCase() === account.toLowerCase() || row.seller.toLowerCase() === account.toLowerCase()));
  const shownTrades = tab === "mine" ? mineTrades : trades;
  const fee = list ? list.priceBnb * 0.002 : 0;
  return (
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <div className="grid grid-cols-2 border border-gold/50 text-xs sm:grid-cols-4 lg:grid-cols-7">
          {[
            [zh ? "最新成交" : "Last", last ? `${px(last.priceBnb)} BNB` : "—"],
            [zh ? "24h 成交额" : "24h volume", books ? `${px(books.vol24h)} BNB` : "—"],
            [zh ? "24h 笔数" : "24h prints", String(dayTrades.length)],
            [zh ? "有效挂单" : "Open", books ? books.listed.toLocaleString("en-US") : "—"],
            [zh ? "卖家" : "Sellers", books ? books.sellers.toLocaleString("en-US") : "—"],
            [zh ? "电路编号" : "Max id", books?.maxId ? books.maxId.toLocaleString("en-US") : "—"],
            [zh ? "累计成交" : "All volume", books ? `${px(books.volTotal)} BNB` : "—"],
          ].map(([k, v]) => (
            <p key={k} className="border-gold/30 px-2 py-2 [&:not(:last-child)]:border-r">
              <span className="block text-[10px] text-ink/45">{k}</span>
              <span className="font-mono text-sm">{v}</span>
            </p>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(["book", "tape", "mine"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTab(id)} className={`border-b-2 px-2 py-1 text-sm ${tab === id ? "border-ink font-medium" : "border-transparent text-ink/55"}`}>
              {id === "book" ? (zh ? "挂单" : "Book") : id === "tape" ? (zh ? "成交" : "Prints") : zh ? "我的" : "Mine"}
            </button>
          ))}
          <button type="button" onClick={() => setChart((on) => !on)} className={`ml-auto border px-2 py-1 text-xs ${chart ? "border-ink bg-ink text-paper" : "border-gold"}`}>{zh ? "K 线" : "Chart"}</button>
          <button type="button" onClick={() => setSort((cur) => (cur === "price" ? "gates" : "price"))} className="border border-gold px-2 py-1 text-xs">{sort === "price" ? (zh ? "按价格" : "Price") : zh ? "按门数" : "Gates"}</button>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜处理器或编号" : "Search"} className="min-h-8 w-36 border border-gold/50 bg-transparent px-2 text-xs outline-none" />
        </div>
        {chart && bars.length > 1 ? (
          <div className="mt-2 border border-gold/40 bg-card">
            <Kline bars={bars} mark={last?.priceBnb ?? 0} lang={lang} desk="circuit" />
          </div>
        ) : chart ? <p className="mt-2 text-xs text-ink/50">{zh ? "成交还不够画 K 线。" : "Not enough prints for a chart."}</p> : null}
        <p className="mt-2 text-[11px] text-ink/45">{books?.ok ? (zh ? `快照 ${books.asOf ?? ""} · 区块 ${books.block ?? "—"} · 表里最多 80 张，按当前排序。日产能和算力不是这份快照里的字段，这里不编。` : `Snapshot ${books.asOf ?? ""}. At most 80 rows. Daily output is not in this feed, so it is not invented.`) : zh ? "快照没读到。" : "The snapshot did not load."}</p>
        {tab === "tape" || tab === "mine" ? (
          <div className="mt-2 max-h-[28rem] overflow-auto border border-gold/40">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead className="sticky top-0 bg-paper text-ink/45">
                <tr>
                  <th className="px-2 py-2 font-normal">{zh ? "时间" : "Time"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "电路" : "Circuit"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "成交价" : "Price"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "买方" : "Buyer"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "卖方" : "Seller"}</th>
                </tr>
              </thead>
              <tbody>
                {shownTrades.length === 0 ? <tr><td colSpan={5} className="px-2 py-4 text-ink/50">{zh ? "没有成交。" : "No prints."}</td></tr> : null}
                {shownTrades.slice(0, 40).map((row) => (
                  <tr key={`${row.tx}-${row.id}`} className="border-t border-gold/20">
                    <td className="px-2 py-1.5 font-mono">{age(row.ts)}</td>
                    <td className="px-2 py-1.5 font-mono">#{row.circuitId}</td>
                    <td className="px-2 py-1.5 font-mono">{px(row.priceBnb)} BNB</td>
                    <td className="px-2 py-1.5 font-mono">{short(row.buyer)}</td>
                    <td className="px-2 py-1.5 font-mono"><a className="underline" href={`${BSC.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{short(row.seller)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-2 max-h-[28rem] overflow-auto border border-gold/40">
            <table className="w-full min-w-[46rem] text-left text-xs">
              <thead className="sticky top-0 bg-paper text-ink/45">
                <tr>
                  <th className="px-2 py-2 font-normal">{zh ? "电路" : "Circuit"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "结构" : "Shape"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "门" : "Gates"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "卖价" : "Ask"}</th>
                  <th className="px-2 py-2 font-normal">{zh ? "状态" : "State"}</th>
                  <th className="px-2 py-2 text-right font-normal">{zh ? "操作" : "Act"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={6} className="px-2 py-4 text-ink/50">{zh ? "没有挂单。" : "No listing."}</td></tr> : null}
                {rows.map((row) => (
                  <tr key={row.id} className={`border-t border-gold/20 ${list?.id === row.id ? "bg-gold/10" : ""}`}>
                    <td className="px-2 py-1.5"><span className="block">{row.name}</span><span className="font-mono text-[11px] text-ink/45">#{row.circuitId}</span></td>
                    <td className="px-2 py-1.5 font-mono">{zh ? "入" : "In"} {row.nIn} → {zh ? "出" : "Out"} {row.nOut}<br />{zh ? "态" : "St"} {row.nState} · {zh ? "宽" : "W"} {row.width}</td>
                    <td className="px-2 py-1.5 font-mono">{row.gates.toLocaleString("en-US")}</td>
                    <td className="px-2 py-1.5 font-mono">{px(row.priceBnb)} BNB</td>
                    <td className="px-2 py-1.5">{row.eligible ? (zh ? "可接" : "Open") : (zh ? "未标" : "Unmarked")}</td>
                    <td className="px-2 py-1.5 text-right"><button type="button" className="min-h-7 bg-[#f23645] px-2 text-white" onClick={() => setList(row)}>{zh ? "买入" : "Buy"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <aside className="border border-gold bg-card px-3 py-3 lg:sticky lg:top-16">
        <p className="text-[11px] tracking-[0.16em] text-gold">{zh ? "买这一张" : "Buy this one"}</p>
        <p className="mt-2 text-sm">{list ? `${list.name} #${list.circuitId}` : zh ? "先在表里点买入" : "Pick a row"}</p>
        {list ? (
          <p className="mt-1 font-mono text-xs text-ink/60">{zh ? "入" : "In"} {list.nIn} → {zh ? "出" : "Out"} {list.nOut} · {list.gates.toLocaleString("en-US")} {zh ? "门" : "gates"}</p>
        ) : null}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <p><span className="block text-ink/45">{zh ? "卖价" : "Ask"}</span><span className="font-mono">{list ? `${px(list.priceBnb)} BNB` : "—"}</span></p>
          <p><span className="block text-ink/45">{zh ? "另付千分之二" : "Extra 0.2%"}</span><span className="font-mono">{list ? `${px(fee)} BNB` : "—"}</span></p>
        </div>
        <p className="mt-2 text-xs leading-5 text-ink/55">{zh ? "电路整张成交，不能拆。卖价进 tapeout。千分之二先付到收费地址，tapeout 没成交也不退。" : "A circuit sells whole. The ask is paid to tapeout. The extra 0.2% is paid first and is not returned."}</p>
        <label className="mt-2 flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={ack} onChange={(event) => setAck(event.target.checked)} />
          <span>{zh ? "我按这个价格买这一张。" : "I buy this one at this price."}</span>
        </label>
        <button type="button" disabled={!ack || !list || busy} className="mt-3 min-h-11 w-full bg-ink text-sm text-paper disabled:opacity-40" onClick={() => list && void run(async () => {
          const from = currentAccount() ?? (await connectBsc());
          return buyOfficialCircuit(from, BigInt(list.id), BigInt(list.priceWei));
        })}>{zh ? "确认买入" : "Buy"}</button>
        {note ? <p className={`mt-2 text-xs leading-5 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </aside>
    </section>
  );
}

export function OfficialDesk({ mode }: { mode: "chips" | "circuits" }) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [books, setBooks] = useState<OfficialBooks | null>(null);
  const [name, setName] = useState<string>("TapeOut");
  const [kind, setKind] = useState<0 | 1>(0);
  const [bid, setBid] = useState<OfficialBid | null>(null);
  const [list, setList] = useState<OfficialList | null>(null);
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [query, setQuery] = useState("");
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      getOfficialBooks()
        .then((row) => { if (!dead) setBooks(row); })
        .catch(() => { if (!dead) setBooks({ ok: false, error: "feed", asOf: null, block: null, bids: [], lists: [], listed: 0, sellers: 0, maxId: 0, vol24h: 0, volTotal: 0, trades: [] }); });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, []);

  const bids = useMemo(
    () => (books?.bids ?? []).filter((row) => row.name === name && row.tokenId === kind).slice(0, 12),
    [books, name, kind],
  );
  const lists = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (books?.lists ?? []).filter((row) => !q || row.name.toLowerCase().includes(q) || row.circuitId.includes(q)).slice(0, 20);
  }, [books, query]);

  const run = async (act: () => Promise<string>) => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "先付千分之二，再签 tapeout 那一笔。tapeout 失败的话，服务费不退。" : "The 0.2% is paid first. If the tapeout trade fails, the fee stays.");
    try {
      const hash = await act();
      setNote(zh ? "tapeout 成交已发出。" : "The tapeout trade was sent.");
      window.open(txUrl(hash), "_blank", "noopener,noreferrer");
    } catch (error) {
      setBad(true);
      const message = error instanceof Error ? error.message : "";
      setNote(
        message === "pending" || error instanceof TxPending
          ? zh
            ? `已经提交，回执还没读到。先核对 ${(error as TxPending).hash ?? ""}，不要再签同一笔。`
            : `Submitted. The receipt is not back. Check ${(error as TxPending).hash ?? ""} before signing again.`
          : message === "fee-kept"
          ? zh ? "服务费已经付了，tapeout 那一笔没有完成。服务费不退。" : "The fee was paid. The tapeout trade did not finish. The fee is not returned."
          : message === "gone"
            ? zh ? "这张买单数量不够了。刷新后再看。" : "That bid no longer has this size."
            : message === "locked"
              ? zh ? "这不是写死的三台处理器。" : "That processor is not one of the three locked ones."
              : message.includes("rejected") || message.includes("denied")
                ? zh ? "你取消了。" : "You cancelled."
                : zh ? "没有成交。" : "No fill.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (mode === "circuits") {
    return <CircuitMarket zh={zh} lang={lang} books={books} busy={busy} note={note} bad={bad} run={run} />;
  }

  return (
    <section className="grid items-start gap-4 lg:grid-cols-12">
      <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1 lg:col-span-7">
        <p className="text-sm text-ink/80">
          {books?.ok
            ? zh ? `tapeout 快照 ${books.asOf ?? ""} · 区块 ${books.block ?? "—"} · 约 15 秒` : `tapeout snapshot ${books.asOf ?? ""} · block ${books.block ?? "—"}`
            : zh ? `tapeout 快照没读到${books?.error ? `（${books.error}）` : ""}` : "The tapeout snapshot did not load."}
        </p>
        {mode === "chips" ? (
          <>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜处理器，例如 Blonskr、Genesis、TapeOut" : "Search a processor"} className="border border-gold bg-paper px-3 py-2 outline-none" />
            <div className="flex gap-2 overflow-x-auto">
              {[...new Set((books?.bids ?? []).map((row) => row.name))]
                .filter((row) => row.toLowerCase().includes(query.trim().toLowerCase()))
                .slice(0, 8)
                .map((row) => (
                  <button key={row} type="button" onClick={() => { setName(row); setBid(null); }} className={`min-h-10 shrink-0 border px-3 text-sm ${name === row ? "border-ink bg-ink text-paper" : "border-gold"}`}>{row}</button>
                ))}
            </div>
            <div className="grid grid-cols-2 border border-gold">
              {([0, 1] as const).map((id) => (
                <button key={id} type="button" onClick={() => { setKind(id); setBid(null); }} className={`min-h-10 ${kind === id ? "bg-ink text-paper" : ""}`}>{id === 0 ? "NAND" : "LATCH"}</button>
              ))}
            </div>
            <p className="text-sm">{zh ? "tapeout 卖单合约没有开放。这里只同步买单。卖出就是吃下面的买单。" : "The tapeout ask market is not open. This list is bids only. Selling means filling one of them."}</p>
            <ul className="max-h-[22rem] overflow-auto border border-gold">
              {bids.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => setBid(row)} className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm sm:flex-row sm:items-center sm:justify-between ${bid?.id === row.id ? "bg-ink text-paper" : ""}`}>
                    <span className="truncate">{row.name} <span className="font-mono text-xs opacity-70">#{row.id}</span></span>
                    <span className="font-mono text-xs">{px(row.priceBnb)} BNB · {zh ? "剩" : "left"} {row.remaining}</span>
                  </button>
                </li>
              ))}
              {bids.length === 0 ? <li className="px-3 py-3 text-sm text-ink/60">{zh ? "这只标的现在没有 tapeout 买单。" : "No tapeout bid on this one."}</li> : null}
            </ul>
          </>
        ) : (
          <>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜处理器或电路编号" : "Search processor or id"} className="border border-gold bg-paper px-3 py-2 outline-none" />
            <ul className="max-h-[22rem] overflow-auto border border-gold">
              {lists.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => setList(row)} className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm sm:flex-row sm:items-center sm:justify-between ${list?.id === row.id ? "bg-ink text-paper" : ""}`}>
                    <span className="truncate">{row.name} <span className="font-mono text-xs opacity-70">#{row.circuitId}</span></span>
                    <span className="font-mono text-xs">{px(row.priceBnb)} BNB · {row.gates} {zh ? "门" : "gates"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <aside className="order-1 min-w-0 border border-gold bg-card px-3 py-3 lg:sticky lg:top-3 lg:order-2 lg:col-span-5">
        <h3 className="font-display text-2xl italic">{zh ? "成交票" : "Trade ticket"}</h3>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-ink/60">{zh ? "链" : "Chain"}</dt><dd>BSC</dd></div>
          <div className="grid gap-1 sm:grid-cols-[5rem_1fr]"><dt className="text-ink/60">{zh ? "tapeout 合约" : "tapeout"}</dt><dd className="break-all font-mono text-xs">{mode === "chips" ? OFFICIAL.transistorMarket : OFFICIAL.circuitMarket}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-ink/60">{zh ? "本站服务费" : "Our fee"}</dt><dd className="text-right">0.20% → {OFFICIAL.feeTo.slice(0, 6)}…{OFFICIAL.feeTo.slice(-4)}</dd></div>
          <p className="text-xs leading-5 text-ink/70">{zh ? "tapeout 费在他们合约里。我们另收千分之二，先付，不退。" : "The tapeout fee stays in their contract. Ours is an extra 0.2%, paid first, not returned."}</p>
        </dl>
        {mode === "chips" ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="font-mono text-sm">{bid ? `#${bid.id} · ${px(bid.priceBnb)} BNB · ${zh ? "剩" : "left"} ${bid.remaining}` : zh ? "先选一张买单" : "Pick a bid"}</p>
            <input value={qty} onChange={(event) => setQty(event.target.value.replace(/[^\d]/g, ""))} className="border border-gold bg-paper px-3 py-2 font-mono outline-none" />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(event) => setAck(event.target.checked)} />
              <span>{zh ? "我知道服务费先打进写死地址，tapeout 没成交也不退。" : "I know the fee is paid to the locked address first and is not returned."}</span>
            </label>
            <button type="button" disabled={!ack || !bid || busy} onClick={() => bid && void run(async () => {
              const from = currentAccount() ?? (await connectBsc());
              return fillOfficialBid(from, BigInt(bid.id), BigInt(qty || "0"), bid.transistors, BigInt(bid.priceWei));
            })} className="min-h-12 bg-ink font-display text-xl italic text-paper disabled:opacity-40">
              {zh ? "吃 tapeout 买单" : "Fill tapeout bid"}
            </button>
            <p className="text-xs tracking-widest text-gold">{zh ? "或自己挂买单" : "Or place a bid"}</p>
            <input value={price} onChange={(event) => setPrice(event.target.value.replace(/[^\d.]/g, ""))} placeholder={zh ? "单价 BNB" : "Price in BNB"} className="border border-gold bg-paper px-3 py-2 font-mono outline-none" />
            <button
              type="button"
              disabled={!ack || busy || !price}
              onClick={() => {
                const chip = (books?.bids ?? []).find((row) => row.name === name);
                if (!chip) return;
                void run(async () => {
                  const from = currentAccount() ?? (await connectBsc());
                  return placeOfficialBid(from, chip.transistors as `0x${string}`, kind, parseEther(price), BigInt(qty || "0"));
                });
              }}
              className="min-h-12 border border-gold font-display text-xl italic disabled:opacity-40"
            >
              {zh ? "挂 tapeout 买单" : "Place tapeout bid"}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <p className="font-mono text-sm">{list ? `${list.name} #${list.circuitId} · ${px(list.priceBnb)} BNB` : zh ? "先选一张挂单" : "Pick a listing"}</p>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(event) => setAck(event.target.checked)} />
              <span>{zh ? "我按这个 BNB 价格买。服务费另付千分之二，先付不退。电路进我的 BSC 钱包。" : "I buy at this BNB price. The extra 0.2% is paid first and not returned. The circuit arrives in my BSC wallet."}</span>
            </label>
            <button
              type="button"
              disabled={!ack || !list || busy}
              onClick={() => list && void run(async () => {
                const from = currentAccount() ?? (await connectBsc());
                return buyOfficialCircuit(from, BigInt(list.id), BigInt(list.priceWei));
              })}
              className="min-h-12 bg-ink font-display text-xl italic text-paper disabled:opacity-40"
            >
              {zh ? "买这张 tapeout 电路" : "Buy this tapeout circuit"}
            </button>
          </div>
        )}
        <a className="mt-3 inline-flex text-sm underline decoration-gold underline-offset-4" href="https://tapeout.net/" target="_blank" rel="noreferrer">{zh ? "打开 tapeout 核对" : "Check tapeout.net"}</a>
        <a className="mt-1 block text-xs text-ink/60" href={`${BSC.explorer}/address/${mode === "chips" ? OFFICIAL.transistorMarket : OFFICIAL.circuitMarket}`} target="_blank" rel="noreferrer">{zh ? "浏览器里的合约" : "Contract on the explorer"}</a>
        {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </aside>
    </section>
  );
}
