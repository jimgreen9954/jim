import { useEffect, useMemo, useState } from "react";
import { parseEther } from "viem";
import { useExchange } from "@/lib/exchange-store";
import {
  getOfficialBooks,
  OFFICIAL,
  type OfficialBid,
  type OfficialBooks,
  type OfficialList,
} from "@/lib/official-books";
import { buyOfficialCircuit, fillOfficialBid, placeOfficialBid } from "@/lib/official-trade";
import { BSC, TxPending, txUrl } from "@/lib/bsc";
import { connectBsc } from "@/lib/bsc";
import { currentAccount } from "@/lib/wallet";
import { CircuitMarket } from "@/components/exchange/circuit-market";

function px(n: number): string {
  if (!(n > 0)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
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
        .then((row) => {
          if (!dead) setBooks(row);
        })
        .catch(() => {
          if (!dead)
            setBooks({
              ok: false,
              error: "feed",
              asOf: null,
              block: null,
              bids: [],
              lists: [],
              listed: 0,
              sellers: 0,
              maxId: 0,
              vol24h: 0,
              volTotal: 0,
              trades: [],
            });
        });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  const bids = useMemo(
    () =>
      (books?.bids ?? []).filter((row) => row.name === name && row.tokenId === kind).slice(0, 12),
    [books, name, kind],
  );
  const lists = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (books?.lists ?? [])
      .filter((row) => !q || row.name.toLowerCase().includes(q) || row.circuitId.includes(q))
      .slice(0, 20);
  }, [books, query]);

  const run = async (act: () => Promise<string>) => {
    setBusy(true);
    setBad(false);
    setNote(
      zh
        ? "先付千分之二，再签 TapeOut 那一笔。TapeOut 失败的话，服务费不退。"
        : "The 0.2% is paid first. If the TapeOut trade fails, the fee stays.",
    );
    try {
      const hash = await act();
      setNote(zh ? "TapeOut 成交已发出。" : "The TapeOut trade was sent.");
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
            ? zh
              ? "服务费已经付了，TapeOut 那一笔没有完成。服务费不退。"
              : "The fee was paid. The TapeOut trade did not finish. The fee is not returned."
            : message === "gone"
              ? zh
                ? "这张买单数量不够了。刷新后再看。"
                : "That bid no longer has this size."
              : message === "locked"
                ? zh
                  ? "这不是写死的三台处理器。"
                  : "That processor is not one of the three locked ones."
                : message.includes("rejected") || message.includes("denied")
                  ? zh
                    ? "你取消了。"
                    : "You cancelled."
                  : zh
                    ? "没有成交。"
                    : "No fill.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (mode === "circuits") {
    return <CircuitMarket zh={zh} lang={lang} />;
  }

  return (
    <section className="grid items-start gap-3 lg:grid-cols-[11rem_minmax(0,1fr)_16.5rem]">
      <div className="flex gap-2 overflow-x-auto border border-gold/50 lg:block lg:overflow-visible">
        {["TapeOut", "Behemoth", "Genesis"].map((family) => {
          const rows = (books?.bids ?? []).filter((row) =>
            row.name.toLowerCase().includes(family.toLowerCase()),
          );
          return (
            <div key={family} className="min-w-36 shrink-0 border-b border-gold/30 lg:min-w-0">
              <p className="px-2 pt-2 text-sm">
                TapeOut · {family === "Genesis" ? "Genesis" : family}
              </p>
              {([0, 1] as const).map((id) => {
                const sample = rows.find((row) => row.tokenId === id);
                const on = name.toLowerCase().includes(family.toLowerCase()) && kind === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setName(sample?.name ?? (family === "Genesis" ? "Genesis CPU" : family));
                      setKind(id);
                      setBid(null);
                    }}
                    className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-[13px] ${on ? "bg-gold/15" : ""}`}
                  >
                    <span>{id === 0 ? "NAND" : "LATCH"}</span>
                    <span className="font-mono text-[12px]">
                      {sample ? px(sample.priceBnb) : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="min-w-0 border border-gold/50">
        <div className="flex items-end justify-between gap-3 px-3 py-3">
          <div>
            <h3 className="font-display text-2xl italic leading-none">
              TapeOut · {name} / {kind === 0 ? "NAND" : "LATCH"}
            </h3>
            <p className="mt-1 text-[11px] text-ink/45">
              {books?.ok
                ? zh
                  ? `快照 ${books.asOf ?? ""} · 约 15 秒`
                  : `Snapshot ${books.asOf ?? ""}`
                : zh
                  ? "快照没读到"
                  : "Snapshot missed"}
            </p>
          </div>
          <p className="font-mono text-sm">{bids[0] ? `${px(bids[0].priceBnb)} BNB` : "—"}</p>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[32rem]">
            <div className="grid grid-cols-[8.5rem_7.5rem_8.5rem_auto] gap-x-6 px-3 py-1.5 text-[11px] text-ink/45">
              <span>{zh ? "价格" : "Price"}</span>
              <span>{zh ? "剩余" : "Left"}</span>
              <span className="text-right">{zh ? "总额" : "Total"}</span>
              <span className="text-right">{zh ? "指定成交" : "Take"}</span>
            </div>
            {bids.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink/55">
                {zh
                  ? "这只标的现在没有买单。右边可以自己挂。"
                  : "No bid on this one. Place one from the ticket."}
              </p>
            ) : (
              bids.map((row) => (
                <div
                  key={row.id}
                  className={`grid grid-cols-[8.5rem_7.5rem_8.5rem_auto] items-center gap-x-6 px-3 py-1.5 font-mono text-[12px] tabular-nums ${bid?.id === row.id ? "bg-up/10" : ""}`}
                >
                  <span className="whitespace-nowrap text-up">{px(row.priceBnb)}</span>
                  <span className="whitespace-nowrap">{row.remaining.toLocaleString("en-US")}</span>
                  <span className="whitespace-nowrap text-right">
                    {px(row.priceBnb * row.remaining)}
                  </span>
                  <button
                    type="button"
                    className="ml-2 h-6 justify-self-end border border-sell px-2 text-[11px] text-sell"
                    onClick={() => {
                      setBid(row);
                      setQty(String(row.remaining));
                    }}
                  >
                    {zh ? "卖出" : "Sell"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
        <p className="px-3 py-2 text-[11px] leading-5 text-ink/45">
          {zh
            ? "这里只有买单。卖出是把 NAND 或 LATCH 卖进这一档。"
            : "Bids only. Selling fills one of them."}
        </p>
      </div>
      <aside className="min-w-0 border border-gold bg-card px-3 py-3 lg:sticky lg:top-16">
        <h3 className="font-display text-2xl italic">{zh ? "卖出" : "Sell"}</h3>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink/60">{zh ? "链" : "Chain"}</dt>
            <dd>BSC</dd>
          </div>
          <div className="grid gap-1 sm:grid-cols-[5rem_1fr]">
            <dt className="text-ink/60">{zh ? "TapeOut 合约" : "TapeOut"}</dt>
            <dd className="break-all font-mono text-xs">
              {mode === "chips" ? OFFICIAL.transistorMarket : OFFICIAL.circuitMarket}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/60">{zh ? "本站服务费" : "Our fee"}</dt>
            <dd className="text-right">
              0.20% → {OFFICIAL.feeTo.slice(0, 6)}…{OFFICIAL.feeTo.slice(-4)}
            </dd>
          </div>
        </dl>
        {mode === "chips" ? (
          <div className="mt-3 flex flex-col gap-2">
            <p className="font-mono text-sm">
              {bid
                ? `#${bid.id} · ${px(bid.priceBnb)} BNB · ${zh ? "剩" : "left"} ${bid.remaining}`
                : zh
                  ? "先选一张买单"
                  : "Pick a bid"}
            </p>
            <input
              value={qty}
              onChange={(event) => setQty(event.target.value.replace(/[^\d]/g, ""))}
              className="border border-gold bg-paper px-3 py-2 font-mono outline-none"
            />
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={ack}
                onChange={(event) => setAck(event.target.checked)}
              />
              <span>
                {zh
                  ? "我知道服务费先打进写死地址，TapeOut 没成交也不退。"
                  : "I know the fee is paid to the locked address first and is not returned."}
              </span>
            </label>
            <button
              type="button"
              disabled={!ack || !bid || busy}
              onClick={() =>
                bid &&
                void run(async () => {
                  const from = currentAccount() ?? (await connectBsc());
                  return fillOfficialBid(
                    from,
                    BigInt(bid.id),
                    BigInt(qty || "0"),
                    bid.transistors,
                    BigInt(bid.priceWei),
                  );
                })
              }
              className="min-h-12 bg-ink font-display text-xl italic text-paper disabled:opacity-40"
            >
              {zh ? "吃 TapeOut 买单" : "Fill TapeOut bid"}
            </button>
            <p className="text-xs tracking-widest text-gold">
              {zh ? "或自己挂买单" : "Or place a bid"}
            </p>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value.replace(/[^\d.]/g, ""))}
              placeholder={zh ? "单价 BNB" : "Price in BNB"}
              className="border border-gold bg-paper px-3 py-2 font-mono outline-none"
            />
            <button
              type="button"
              disabled={!ack || busy || !price}
              onClick={() => {
                const chip = (books?.bids ?? []).find((row) => row.name === name);
                if (!chip) return;
                void run(async () => {
                  const from = currentAccount() ?? (await connectBsc());
                  return placeOfficialBid(
                    from,
                    chip.transistors as `0x${string}`,
                    kind,
                    parseEther(price),
                    BigInt(qty || "0"),
                  );
                });
              }}
              className="min-h-12 border border-gold font-display text-xl italic disabled:opacity-40"
            >
              {zh ? "挂 TapeOut 买单" : "Place TapeOut bid"}
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <p className="font-mono text-sm">
              {list
                ? `${list.name} #${list.circuitId} · ${px(list.priceBnb)} BNB`
                : zh
                  ? "先选一张挂单"
                  : "Pick a listing"}
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={ack}
                onChange={(event) => setAck(event.target.checked)}
              />
              <span>
                {zh
                  ? "我按这个 BNB 价格买。服务费另付千分之二，先付不退。电路进我的 BSC 钱包。"
                  : "I buy at this BNB price. The extra 0.2% is paid first and not returned. The circuit arrives in my BSC wallet."}
              </span>
            </label>
            <button
              type="button"
              disabled={!ack || !list || busy}
              onClick={() =>
                list &&
                void run(async () => {
                  const from = currentAccount() ?? (await connectBsc());
                  return buyOfficialCircuit(from, BigInt(list.id), BigInt(list.priceWei));
                })
              }
              className="min-h-12 bg-ink font-display text-xl italic text-paper disabled:opacity-40"
            >
              {zh ? "买这张 TapeOut 电路" : "Buy this TapeOut circuit"}
            </button>
          </div>
        )}
        <a
          className="mt-3 inline-flex text-sm underline decoration-gold underline-offset-4"
          href="https://tapeout.net/"
          target="_blank"
          rel="noreferrer"
        >
          {zh ? "打开 TapeOut 核对" : "Check tapeout.net"}
        </a>
        <a
          className="mt-1 block text-xs text-ink/60"
          href={`${BSC.explorer}/address/${mode === "chips" ? OFFICIAL.transistorMarket : OFFICIAL.circuitMarket}`}
          target="_blank"
          rel="noreferrer"
        >
          {zh ? "浏览器里的合约" : "Contract on the explorer"}
        </a>
        {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </aside>
    </section>
  );
}
