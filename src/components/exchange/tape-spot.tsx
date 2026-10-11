import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { myCircuits, XLAYER } from "@/lib/xlayer";
import { currentAccount, onAccount } from "@/lib/wallet";
import {
  baseText,
  buySpotCircuit,
  cancelSpot,
  cancelSpotCircuit,
  deploySpot,
  listSpotCircuit,
  placeSpot,
  readListings,
  readMyOrders,
  readSpotBook,
  readSpotPrints,
  readSpotPurse,
  spotAddress,
  spotBase,
  spotPrice,
  usdtText,
  type CircuitAsk,
  type Level,
  type OpenOrder,
  type SpotMarket,
  type SpotPrint,
  type SpotPurse,
} from "@/lib/tape-spot";

const UNIT = 100_000_000n;
const NAMES = ["TAPE", "NAND", "LATCH"] as const;

function cost(market: number, size: bigint, price: bigint): bigint {
  return market === 0 ? size * price / UNIT : size * price;
}

function Row({ level, max, bid, market, onPick }: { level: Level; max: bigint; bid: boolean; market: number; onPick: () => void }) {
  const width = max > 0n ? Number((level.size * 100n) / max) : 0;
  return (
    <button type="button" onClick={onPick} className="relative grid min-h-9 grid-cols-[1.1fr_1fr_1.1fr_2.2rem] items-center px-2 text-left font-mono text-xs">
      <span className={`absolute inset-y-0 right-0 ${bid ? "bg-gold/25" : "bg-sell/15"}`} style={{ width: `${Math.max(width, 2)}%` }} />
      <span className={`relative ${bid ? "text-ink" : "text-sell"}`}>{usdtText(level.price, 6)}</span>
      <span className="relative">{baseText(market, level.size)}</span>
      <span className="relative text-ink/70">{usdtText(cost(market, level.size, level.price), 2)}</span>
      <span className="relative text-right text-ink/45">{level.lots}</span>
    </button>
  );
}

export function TapeSpotDesk({ zh, only }: { zh: boolean; only?: SpotMarket | "circuit" }) {
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [lane, setLane] = useState<SpotMarket | "circuit">(only ?? 0);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);
  const [purse, setPurse] = useState<SpotPurse | null>(null);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [prints, setPrints] = useState<SpotPrint[]>([]);
  const [lists, setLists] = useState<CircuitAsk[]>([]);
  const [owned, setOwned] = useState<{ id: string; gates: string }[]>([]);
  const [circuitId, setCircuitId] = useState("");
  const [tab, setTab] = useState<"tape" | "mine">("tape");
  const [miss, setMiss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const spot = spotAddress();
  const market: SpotMarket = lane === "circuit" ? 0 : lane;

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    if (!spot || lane === "circuit") return;
    let dead = false;
    const pull = () => {
      Promise.all([
        readSpotBook(market),
        readSpotPurse(account),
        account ? readMyOrders(account) : Promise.resolve([]),
        readSpotPrints(market),
      ]).then(([book, held, mine, tape]) => {
        if (dead) return;
        setMiss(false);
        setBids(book?.bids ?? []);
        setAsks(book?.asks ?? []);
        setPurse(held);
        setOrders(mine.filter((row) => row.market === market && row.left > 0n));
        setPrints(tape);
      }).catch(() => { if (!dead) setMiss(true); });
    };
    pull();
    const id = window.setInterval(pull, 12000);
    return () => { dead = true; window.clearInterval(id); };
  }, [spot, market, account, lane]);

  useEffect(() => {
    if (!spot || lane !== "circuit") return;
    let dead = false;
    const pull = () => {
      Promise.all([readListings(), account ? myCircuits(account) : Promise.resolve([])]).then(([rows, mine]) => {
        if (dead) return;
        setLists(rows);
        setOwned(mine.map((row) => ({ id: row.id, gates: row.gates })));
      }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [spot, lane, account]);

  const askView = useMemo(() => [...asks].reverse(), [asks]);
  const maxAsk = asks.reduce((m, row) => row.size > m ? row.size : m, 0n);
  const maxBid = bids.reduce((m, row) => row.size > m ? row.size : m, 0n);
  const bestAsk = asks[0]?.price ?? 0n;
  const bestBid = bids[0]?.price ?? 0n;
  const spread = bestAsk > bestBid && bestBid > 0n ? bestAsk - bestBid : 0n;
  const name = NAMES[market];

  const run = (task: () => Promise<unknown>, ok: string) => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入 X Layer。" : "Sign in to X Layer at the top right.");
      return;
    }
    setBusy(true);
    task().then(() => { setBad(false); setNote(ok); }).catch((err: unknown) => {
      const text = err instanceof Error ? err.message : "";
      setBad(true);
      if ((err as { code?: number }).code === 4001) setNote(zh ? "签名取消了。币还在钱包。" : "Cancelled. The coins stayed in the wallet.");
      else if (text === "amount" || text === "price") setNote(zh ? "价格和数量都要填。NAND 和 LATCH 只收整数。" : "Enter a price and an amount. NAND and LATCH are whole numbers.");
      else if (/self/i.test(text)) setNote(zh ? "这一档是你自己挂的。先撤掉，再吃。" : "That level is your own. Cancel it before taking it.");
      else setNote(zh ? "没有成交。要先授权再挂。Gas Limit 填 800000。同价先挂的先成交，一次最多吃 40 笔。" : "It did not fill. Approve, then place. Set Gas Limit to 800000. Earlier orders at a price fill first, up to 40 lots.");
    }).finally(() => setBusy(false));
  };

  const pick = (level: Level, bid: boolean) => {
    setSide(bid ? "sell" : "buy");
    setPrice(formatUnits(level.price, 6));
    setAmount(market === 0 ? formatUnits(level.size, 8) : level.size.toString());
  };

  const fillPct = (pct: number) => {
    if (!purse) return;
    let px = 0n;
    try { px = spotPrice(price); } catch { return; }
    if (side === "sell") {
      const bal = market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch;
      const cut = bal * BigInt(pct) / 100n;
      setAmount(market === 0 ? formatUnits(cut, 8) : cut.toString());
      return;
    }
    const unit = market === 0 ? UNIT : 1n;
    const raw = purse.usdt * unit / px;
    const cut = raw * BigInt(pct) / 100n;
    setAmount(market === 0 ? formatUnits(cut, 8) : cut.toString());
  };

  if (!spot) {
    return (
      <article className="border border-gold bg-card px-3 py-4">
        <p className="text-[11px] tracking-[0.22em] text-gold">{zh ? "现货" : "Spot"}</p>
        <h3 className="mt-1 font-display text-3xl italic">{zh ? "订单簿还没部署" : "The book is not deployed"}</h3>
        <p className="mt-2 text-sm leading-6">
          {zh
            ? "一份合约，四本账：TAPE、NAND、LATCH，外加电路。报价是 X Layer 的 USDT0。同价并成一档，先挂的排前面。买方按档位价格付。卖方实收 99.8%，千分之二进收费地址。没有管理员，不能改费率。Gas Limit 填 5000000。部署完把地址发我写进页面。"
            : "One contract, four books: TAPE, NAND, LATCH, and circuits. The quote is X Layer USDT0. One price is one level, earlier orders first. The buyer pays that price. The seller receives 99.8 percent. The 0.2 percent goes to the fee address. No admin. Set Gas Limit to 5000000, then send me the address."}
        </p>
        <button type="button" disabled={busy} className="mt-3 min-h-12 bg-ink px-4 text-sm text-paper disabled:opacity-40" onClick={() => run(() => deploySpot(account ?? ""), zh ? "现货合约已部署。把地址发我写进页面。" : "Deployed. Send me the address to pin.")}>{zh ? "部署现货订单簿" : "Deploy the book"}</button>
        {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </article>
    );
  }

  return (
    <section className="grid gap-3">
      {only == null ? (
        <div className="grid grid-cols-4 border border-gold">
          {([0, 1, 2, "circuit"] as const).map((id) => (
            <button key={String(id)} type="button" onClick={() => setLane(id)} className={`min-h-11 text-sm ${lane === id ? "bg-ink text-paper" : ""}`}>
              {id === "circuit" ? (zh ? "电路" : "Circuits") : NAMES[id]}
            </button>
          ))}
        </div>
      ) : null}
      {lane === "circuit" ? (
        <article className="border border-gold bg-card px-3 py-4">
          <h3 className="font-display text-2xl italic">{zh ? "TAPELIQUID 电路" : "TAPELIQUID circuits"}</h3>
          <p className="mt-1 text-xs leading-5 text-ink/60">{zh ? "一张电路一个价，不和别的并档。买方付标价。卖方实收 99.8%。锁着的电路不在钱包里，这里挂不上。" : "Each circuit has its own price. The buyer pays it. The seller receives 99.8 percent. A locked circuit is not in the wallet and cannot be listed."}</p>
          <ul className="mt-3 border border-gold/40">
            {lists.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "还没有挂出的电路。" : "No circuit is listed."}</li> : null}
            {lists.map((row) => (
              <li key={row.id.toString()} className="grid gap-2 border-t border-gold/30 px-2 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                <span className="font-mono">#{row.id.toString()} · {usdtText(row.price, 4)} USDT0</span>
                {account && row.seller.toLowerCase() === account.toLowerCase()
                  ? <button type="button" disabled={busy} className="min-h-10 border border-gold px-3 text-sm disabled:opacity-40" onClick={() => run(() => cancelSpotCircuit(account, row.id), zh ? "电路已撤下。" : "The circuit is off the book.")}>{zh ? "撤下" : "Cancel"}</button>
                  : <button type="button" disabled={busy} className="min-h-10 bg-ink px-3 text-sm text-paper disabled:opacity-40" onClick={() => run(() => buySpotCircuit(account ?? "", row.id, row.price), zh ? "电路已买下。" : "The circuit is yours.")}>{zh ? "买入" : "Buy"}</button>}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select value={circuitId} onChange={(event) => setCircuitId(event.target.value)} className="min-h-12 border border-gold bg-transparent px-2 text-sm">
              <option value="">{zh ? "选一张在钱包里的电路" : "A circuit in the wallet"}</option>
              {owned.map((row) => <option key={row.id} value={row.id}>#{row.id} · {Number(row.gates).toLocaleString("en-US")} {zh ? "门" : "gates"}</option>)}
            </select>
            <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder={zh ? "整张价格 USDT0" : "Price in USDT0"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono" />
            <button type="button" disabled={busy || !circuitId} className="min-h-12 bg-ink px-4 text-sm text-paper disabled:opacity-40" onClick={() => run(() => listSpotCircuit(account ?? "", BigInt(circuitId), spotPrice(price)), zh ? "电路已挂上。" : "The circuit is listed.")}>{zh ? "挂出" : "List"}</button>
          </div>
        </article>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
          <article className="border border-gold bg-card">
            <div className="flex items-end justify-between gap-3 px-3 py-3">
              <div>
                <p className="text-[11px] tracking-[0.18em] text-gold">{name} / USDT0</p>
                <h3 className="font-display text-3xl italic leading-none">{bestAsk > 0n ? usdtText(bestAsk, 4) : bestBid > 0n ? usdtText(bestBid, 4) : "—"}</h3>
              </div>
              <p className="text-right text-xs leading-5 text-ink/60">
                {zh ? "买一" : "Bid"} {bestBid > 0n ? usdtText(bestBid, 4) : "—"}
                <br />
                {zh ? "卖一" : "Ask"} {bestAsk > 0n ? usdtText(bestAsk, 4) : "—"}
                <br />
                {zh ? "价差" : "Spread"} {spread > 0n ? usdtText(spread, 4) : "—"}
              </p>
            </div>
            <div className="grid grid-cols-[1.1fr_1fr_1.1fr_2.2rem] px-2 pb-1 text-[10px] tracking-wide text-ink/45">
              <span>{zh ? "价格" : "Price"}</span><span>{zh ? "数量" : "Size"}</span><span>{zh ? "总额" : "Total"}</span><span className="text-right">{zh ? "笔" : "Lots"}</span>
            </div>
            <div className="border-t border-gold/30">
              {askView.length === 0 ? <p className="px-2 py-3 text-xs text-ink/50">{zh ? "卖盘是空的。" : "No asks."}</p> : askView.map((level) => (
                <Row key={`a-${level.price}`} level={level} max={maxAsk} bid={false} market={market} onPick={() => pick(level, false)} />
              ))}
            </div>
            <p className="border-y border-gold/40 px-2 py-1 text-center font-mono text-[11px] text-ink/55">{spread > 0n ? `${zh ? "价差" : "Spread"} ${usdtText(spread, 4)}` : (zh ? "还没有对敲的两档" : "No two-sided market")}</p>
            <div>
              {bids.length === 0 ? <p className="px-2 py-3 text-xs text-ink/50">{zh ? "买盘是空的。" : "No bids."}</p> : bids.map((level) => (
                <Row key={`b-${level.price}`} level={level} max={maxBid} bid market={market} onPick={() => pick(level, true)} />
              ))}
            </div>
            {miss ? <p className="px-2 py-2 text-xs text-ink/55">{zh ? "这一次没读到。不写成 0。" : "This read missed. It is not shown as zero."}</p> : null}
            <p className="px-3 py-2 text-[11px] leading-5 text-ink/50">{zh ? "同一价格并成一档，笔数写在右边。先挂的先成交。点一档，把价格和数量填进右边。" : "One price is one level. The count is on the right. Earlier orders fill first. Tap a level to fill the ticket."}</p>
          </article>
          <article className="border border-gold bg-card px-3 py-3">
            <div className="grid grid-cols-2 border border-gold">
              <button type="button" onClick={() => setSide("buy")} className={`min-h-11 text-sm ${side === "buy" ? "bg-ink text-paper" : ""}`}>{zh ? "买入" : "Buy"}</button>
              <button type="button" onClick={() => setSide("sell")} className={`min-h-11 text-sm ${side === "sell" ? "bg-ink text-paper" : ""}`}>{zh ? "卖出" : "Sell"}</button>
            </div>
            <label className="mt-3 grid gap-1 text-xs text-ink/55">
              {zh ? "价格 USDT0" : "Price in USDT0"}
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            </label>
            <label className="mt-2 grid gap-1 text-xs text-ink/55">
              {zh ? `数量 ${name}` : `Amount ${name}`}
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            </label>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} type="button" onClick={() => fillPct(pct)} className="min-h-9 border border-gold text-xs">{pct === 100 ? (zh ? "全部" : "All") : `${pct}%`}</button>
              ))}
            </div>
            <p className="mt-2 text-xs leading-5 text-ink/60">
              {zh ? "钱包" : "Wallet"} {purse ? (side === "buy" ? `${usdtText(purse.usdt, 2)} USDT0` : `${baseText(market, market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch)} ${name}`) : "—"}
              <br />
              {zh ? "买方按价格付。卖方实收 99.8%。千分之二进收费地址。能对上的马上吃，剩下的挂在这一档。" : "The buyer pays the price. The seller receives 99.8 percent. The 0.2 percent goes to the fee address. What crosses fills now. The rest rests."}
            </p>
            <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => placeSpot(account ?? "", market, side === "buy", spotPrice(price), spotBase(market, amount)), zh ? "已送进订单簿。" : "Sent to the book.")}>
              {side === "buy" ? (zh ? `买入 ${name}` : `Buy ${name}`) : (zh ? `卖出 ${name}` : `Sell ${name}`)}
            </button>
          </article>
        </div>
      )}
      {lane !== "circuit" ? (
        <article className="border border-gold bg-card">
          <div className="grid grid-cols-2 border-b border-gold">
            <button type="button" onClick={() => setTab("tape")} className={`min-h-10 text-sm ${tab === "tape" ? "bg-ink text-paper" : ""}`}>{zh ? "成交" : "Prints"}</button>
            <button type="button" onClick={() => setTab("mine")} className={`min-h-10 text-sm ${tab === "mine" ? "bg-ink text-paper" : ""}`}>{zh ? "我的挂单" : "My orders"}</button>
          </div>
          {tab === "tape" ? (
            <ul>
              {prints.length === 0 ? <li className="px-3 py-3 text-sm text-ink/60">{zh ? "这本账还没有成交。" : "No prints on this book."}</li> : null}
              {prints.map((row) => (
                <li key={`${row.tx}-${row.base}`} className="grid grid-cols-3 gap-2 border-t border-gold/30 px-3 py-2 font-mono text-xs">
                  <span>{usdtText(row.price, 4)}</span>
                  <span>{baseText(market, row.base)}</span>
                  <a className="text-right underline" href={`${XLAYER.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{usdtText(row.quote, 2)}</a>
                </li>
              ))}
            </ul>
          ) : (
            <ul>
              {orders.length === 0 ? <li className="px-3 py-3 text-sm text-ink/60">{zh ? "这本账上没有你的挂单。" : "You have no resting order on this book."}</li> : null}
              {orders.map((row) => (
                <li key={row.id.toString()} className="grid items-center gap-2 border-t border-gold/30 px-3 py-2 text-xs sm:grid-cols-[5rem_1fr_1fr_auto]">
                  <span>{row.bid ? (zh ? "买" : "Bid") : (zh ? "卖" : "Ask")}</span>
                  <span className="font-mono">{usdtText(row.price, 4)}</span>
                  <span className="font-mono">{baseText(row.market, row.left)}</span>
                  <button type="button" disabled={busy} className="min-h-9 border border-gold px-2 disabled:opacity-40" onClick={() => run(() => cancelSpot(account ?? "", row.id), zh ? "已撤单。没吃掉的退回钱包。" : "Cancelled. The rest is back in the wallet.")}>{zh ? "撤单" : "Cancel"}</button>
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : null}
      <p className="break-all text-[11px] text-ink/45">
        <a className="underline" href={`${XLAYER.explorer}/address/${spot}`} target="_blank" rel="noreferrer">{spot}</a>
      </p>
      {note ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </section>
  );
}
