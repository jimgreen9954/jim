import { useEffect, useMemo, useState } from "react";
import { parseEther } from "viem";
import { useExchange } from "@/lib/exchange-store";
import { getOfficialBooks, OFFICIAL, type OfficialBid, type OfficialBooks, type OfficialList } from "@/lib/official-books";
import { buyOfficialCircuit, fillOfficialBid, placeOfficialBid } from "@/lib/official-trade";
import { BSC, txUrl } from "@/lib/bsc";
import { connectBsc } from "@/lib/bsc";
import { currentAccount } from "@/lib/wallet";

function px(n: number): string {
  if (!(n > 0)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
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
      getOfficialBooks()
        .then((row) => { if (!dead) setBooks(row); })
        .catch(() => { if (!dead) setBooks({ ok: false, error: "feed", asOf: null, block: null, bids: [], lists: [] }); });
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
    setNote(zh ? "先付千分之二，再签官网那一笔。官网失败的话，服务费不退。" : "The 0.2% is paid first. If the official trade fails, the fee stays.");
    try {
      const hash = await act();
      setNote(zh ? "官网成交已发出。" : "The official trade was sent.");
      window.open(txUrl(hash), "_blank", "noopener,noreferrer");
    } catch (error) {
      setBad(true);
      const message = error instanceof Error ? error.message : "";
      setNote(
        message === "fee-kept"
          ? zh ? "服务费已经付了，官网那一笔没有完成。服务费不退。" : "The fee was paid. The official trade did not finish. The fee is not returned."
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

  return (
    <section className="grid items-start gap-4 lg:grid-cols-12">
      <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1 lg:col-span-7">
        <p className="text-sm text-ink/80">
          {books?.ok
            ? zh ? `官网快照 ${books.asOf ?? ""} · 区块 ${books.block ?? "—"} · 约 15 秒` : `Official snapshot ${books.asOf ?? ""} · block ${books.block ?? "—"}`
            : zh ? `官网快照没读到${books?.error ? `（${books.error}）` : ""}` : "The official snapshot did not load."}
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
            <p className="text-sm">{zh ? "官网卖单合约没有开放。这里只同步买单。卖出就是吃下面的买单。" : "The official ask market is not open. This list is bids only. Selling means filling one of them."}</p>
            <ul className="max-h-[22rem] overflow-auto border border-gold">
              {bids.map((row) => (
                <li key={row.id}>
                  <button type="button" onClick={() => setBid(row)} className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-sm sm:flex-row sm:items-center sm:justify-between ${bid?.id === row.id ? "bg-ink text-paper" : ""}`}>
                    <span className="truncate">{row.name} <span className="font-mono text-xs opacity-70">#{row.id}</span></span>
                    <span className="font-mono text-xs">{px(row.priceBnb)} BNB · {zh ? "剩" : "left"} {row.remaining}</span>
                  </button>
                </li>
              ))}
              {bids.length === 0 ? <li className="px-3 py-3 text-sm text-ink/60">{zh ? "这只标的现在没有官网买单。" : "No official bid on this one."}</li> : null}
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
          <div className="grid gap-1 sm:grid-cols-[5rem_1fr]"><dt className="text-ink/60">{zh ? "官网合约" : "Official"}</dt><dd className="break-all font-mono text-xs">{mode === "chips" ? OFFICIAL.transistorMarket : OFFICIAL.circuitMarket}</dd></div>
          <div className="flex justify-between gap-3"><dt className="shrink-0 text-ink/60">{zh ? "本站服务费" : "Our fee"}</dt><dd className="text-right">0.20% → {OFFICIAL.feeTo.slice(0, 6)}…{OFFICIAL.feeTo.slice(-4)}</dd></div>
          <p className="text-xs leading-5 text-ink/70">{zh ? "官网费在他们合约里。我们另收千分之二，先付，不退。" : "The official fee stays in their contract. Ours is an extra 0.2%, paid first, not returned."}</p>
        </dl>
        {mode === "chips" ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="font-mono text-sm">{bid ? `#${bid.id} · ${px(bid.priceBnb)} BNB · ${zh ? "剩" : "left"} ${bid.remaining}` : zh ? "先选一张买单" : "Pick a bid"}</p>
            <input value={qty} onChange={(event) => setQty(event.target.value.replace(/[^\d]/g, ""))} className="border border-gold bg-paper px-3 py-2 font-mono outline-none" />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(event) => setAck(event.target.checked)} />
              <span>{zh ? "我知道服务费先打进写死地址，官网没成交也不退。" : "I know the fee is paid to the locked address first and is not returned."}</span>
            </label>
            <button type="button" disabled={!ack || !bid || busy} onClick={() => bid && void run(async () => {
              const from = currentAccount() ?? (await connectBsc());
              return fillOfficialBid(from, BigInt(bid.id), BigInt(qty || "0"), bid.transistors, BigInt(bid.priceWei));
            })} className="min-h-12 bg-ink font-display text-xl italic text-paper disabled:opacity-40">
              {zh ? "吃官网买单" : "Fill official bid"}
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
              {zh ? "挂官网买单" : "Place official bid"}
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
              {zh ? "买这张官网电路" : "Buy this official circuit"}
            </button>
          </div>
        )}
        <a className="mt-3 inline-flex text-sm underline decoration-gold underline-offset-4" href="https://tapeout.net/" target="_blank" rel="noreferrer">{zh ? "打开官网核对" : "Check tapeout.net"}</a>
        <a className="mt-1 block text-xs text-ink/60" href={`${BSC.explorer}/address/${mode === "chips" ? OFFICIAL.transistorMarket : OFFICIAL.circuitMarket}`} target="_blank" rel="noreferrer">{zh ? "浏览器里的合约" : "Contract on the explorer"}</a>
        {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </aside>
    </section>
  );
}
