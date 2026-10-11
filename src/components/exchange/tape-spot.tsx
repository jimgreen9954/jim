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
  spotReady,
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

function sumSide(rows: Level[], market: number) {
  return rows.reduce((sum, row) => ({ base: sum.base + row.size, quote: sum.quote + cost(market, row.size, row.price), lots: sum.lots + row.lots }), { base: 0n, quote: 0n, lots: 0 });
}

function Stat({ k, v, s }: { k: string; v: string; s: string }) {
  return <p className="border-gold/30 px-2 py-2 sm:border-l sm:first:border-l-0"><span className="block text-[10px] text-ink/45">{k}</span><span className="font-mono">{v}</span><span className="mt-0.5 block text-[10px] text-ink/45">{s}</span></p>;
}

function Plan({ zh, market, side, price, amount, asks, bids, purse, name }: { zh: boolean; market: SpotMarket; side: "buy" | "sell"; price: string; amount: string; asks: Level[]; bids: Level[]; purse: SpotPurse | null; name: string }) {
  let px = 0n;
  let qty = 0n;
  try {
    px = spotPrice(price);
    qty = amount.trim() ? spotBase(market, amount) : 0n;
  } catch {
    return null;
  }
  const unit = market === 0 ? UNIT : 1n;
  const walletBuy = purse && px > 0n ? purse.usdt * unit / px : 0n;
  const walletSell = purse ? (market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch) : 0n;
  const book = side === "buy" ? asks : bids;
  let left = qty;
  let filled = 0n;
  let pay = 0n;
  for (const row of book) {
    if (left === 0n) break;
    if (side === "buy" ? row.price > px : row.price < px) break;
    const take = left < row.size ? left : row.size;
    filled += take;
    pay += cost(market, take, row.price);
    left -= take;
  }
  return (
    <div className="mt-2 grid grid-cols-2 gap-px bg-gold/30 text-xs">
      <p className="bg-card px-2 py-2"><span className="block text-[10px] text-ink/45">{zh ? "这一价钱包最多买" : "Wallet can buy here"}</span><span className="font-mono">{purse ? `${baseText(market, walletBuy)} ${name}` : "—"}</span></p>
      <p className="bg-card px-2 py-2"><span className="block text-[10px] text-ink/45">{zh ? "钱包最多卖" : "Wallet can sell"}</span><span className="font-mono">{purse ? `${baseText(market, walletSell)} ${name}` : "—"}</span></p>
      <p className="bg-card px-2 py-2"><span className="block text-[10px] text-ink/45">{zh ? "这一笔能吃到" : "This order takes"}</span><span className="font-mono">{qty > 0n ? `${baseText(market, filled)} · ${usdtText(pay, 4)}` : "—"}</span></p>
      <p className="bg-card px-2 py-2"><span className="block text-[10px] text-ink/45">{zh ? "吃完剩下挂出" : "Rest after the take"}</span><span className="font-mono">{qty > 0n ? baseText(market, left) : "—"}</span></p>
    </div>
  );
}

function Quote({ zh, market, side, price, amount }: { zh: boolean; market: SpotMarket; side: "buy" | "sell"; price: string; amount: string }) {
  let pay = 0n;
  let fee = 0n;
  try {
    const px = spotPrice(price);
    const qty = spotBase(market, amount);
    pay = cost(market, qty, px);
    fee = pay * 20n / 10000n;
  } catch {
    return <p className="mt-2 text-xs text-ink/45">{zh ? "先填价格。比例按钮按这个价格，从钱包里切。" : "Enter a price first. The percent buttons cut the wallet at that price."}</p>;
  }
  if (pay === 0n || fee === 0n) return <p className="mt-2 text-xs text-sell">{zh ? "这一笔太小，手续费舍成 0，合约不会收。" : "This order is too small. The fee rounds to zero and the contract will not take it."}</p>;
  return (
    <div className="mt-2 grid grid-cols-3 border border-gold/40 text-center">
      <p className="px-1 py-2"><span className="block text-[10px] text-ink/45">{side === "buy" ? (zh ? "你支付" : "You pay") : (zh ? "买方支付" : "Buyer pays")}</span><span className="font-mono text-sm">{usdtText(pay, 4)}</span></p>
      <p className="border-x border-gold/40 px-1 py-2"><span className="block text-[10px] text-ink/45">{zh ? "千分之二" : "0.20%"}</span><span className="font-mono text-sm">{usdtText(fee, 4)}</span></p>
      <p className="px-1 py-2"><span className="block text-[10px] text-ink/45">{side === "sell" ? (zh ? "你实收" : "You receive") : (zh ? "卖方实收" : "Seller receives")}</span><span className="font-mono text-sm">{usdtText(pay - fee, 4)}</span></p>
    </div>
  );
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

export function TapeSpotDesk({ zh, lanes }: { zh: boolean; lanes?: readonly (SpotMarket | "circuit")[] }) {
  const choices = lanes ?? ([0, 1, 2, "circuit"] as const);
  const [spot, setSpot] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [lane, setLane] = useState<SpotMarket | "circuit">(choices[0] ?? 0);
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
  const market: SpotMarket = lane === "circuit" ? 0 : lane;

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => setSpot(spotAddress()), []);
  useEffect(() => {
    if (!spot) return;
    let dead = false;
    const look = () => {
      spotReady().then((ok) => { if (!dead) setReady(ok); }).catch(() => { if (!dead) setReady(false); });
    };
    look();
    const id = window.setInterval(look, 8000);
    return () => { dead = true; window.clearInterval(id); };
  }, [spot]);

  useEffect(() => {
    if (!spot || !ready || lane === "circuit") return;
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      readSpotBook(market).then((book) => {
        if (dead) return;
        setMiss(false);
        setBids(book?.bids ?? []);
        setAsks(book?.asks ?? []);
      }).catch(() => {
        window.setTimeout(() => {
          if (dead) return;
          readSpotBook(market).then((book) => {
            if (dead) return;
            setMiss(false);
            setBids(book?.bids ?? []);
            setAsks(book?.asks ?? []);
          }).catch(() => { if (!dead) setMiss(true); });
        }, 1200);
      });
      readSpotPurse(account).then((held) => { if (!dead) setPurse(held); }).catch(() => undefined);
      if (account) readMyOrders(account).then((mine) => { if (!dead) setOrders(mine.filter((row) => row.market === market && row.left > 0n)); }).catch(() => undefined);
      readSpotPrints(market).then((tape) => { if (!dead) setPrints(tape); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    const onShow = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { dead = true; window.clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, [spot, ready, market, account, lane]);

  useEffect(() => {
    if (!spot || !ready || lane !== "circuit") return;
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
  }, [spot, ready, lane, account]);

  const askBook = useMemo(() => sumSide(asks, market), [asks, market]);
  const bidBook = useMemo(() => sumSide(bids, market), [bids, market]);
  const traded = useMemo(() => prints.reduce((sum, row) => ({ n: sum.n + 1, quote: sum.quote + row.quote, fee: sum.fee + row.fee }), { n: 0, quote: 0n, fee: 0n }), [prints]);
  const askView = useMemo(() => [...asks].reverse(), [asks]);
  const maxAsk = asks.reduce((m, row) => row.size > m ? row.size : m, 0n);
  const maxBid = bids.reduce((m, row) => row.size > m ? row.size : m, 0n);
  const bestAsk = asks[0]?.price ?? 0n;
  const bestBid = bids[0]?.price ?? 0n;
  const spread = bestAsk > bestBid && bestBid > 0n ? bestAsk - bestBid : 0n;
  const name = NAMES[market];

  const run = (task: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "正在连接 X Layer 钱包。请在钱包中确认。" : "Connecting the X Layer wallet. Confirm the request there.");
    task().then((result) => {
      if (typeof result === "string" && /^0x[a-fA-F0-9]{40}$/.test(result)) {
        setSpot(result);
        setReady(true);
      } else setSpot(spotAddress());
      setBad(false);
      setNote(ok);
    }).catch((err: unknown) => {
      const text = err instanceof Error ? err.message : "";
      setBad(true);
      if ((err as { code?: number }).code === 4001) setNote(zh ? "签名取消了。币还在钱包。" : "Cancelled. The coins stayed in the wallet.");
      else if (text === "onlyfee") setNote(zh ? "只有收费地址能签这一次。" : "Only the fee address can sign this.");
      else if (text === "nonce") setNote(zh ? "收费地址在这之前又发过别的交易，地址对不上。把新地址发过来，我改页面。" : "The fee address sent another transaction first, so the address no longer matches. Send the new one and the page will be updated.");
      else if (text === "amount" || text === "price") setNote(zh ? "价格和数量都要填。NAND 和 LATCH 只收整数。" : "Enter a price and an amount. NAND and LATCH are whole numbers.");
      else if (/self/i.test(text)) setNote(zh ? "这一档是你自己挂的。先撤掉，再吃。" : "That level is your own. Cancel it before taking it.");
      else if (text === "chain") setNote(zh ? "钱包还停在别的链。切到 X Layer 再签。" : "The wallet is on another chain. Switch to X Layer, then sign.");
      else if (text === "address") setNote(zh ? "地址格式不对。" : "That address is not valid.");
      else if (text === "empty") setNote(zh ? "这个地址上没有合约。" : "There is no contract at that address.");
      else if (text === "fee") setNote(zh ? "这一笔太小，千分之二舍成 0。合约不收这种单。" : "This order is too small. The 0.2 percent rounds to zero.");
      else if (/nowallet/i.test(text)) setNote(zh ? "没有检测到 X Layer 钱包。" : "No X Layer wallet was found.");
      else setNote(zh ? `没有成交。${text ? text.slice(0, 80) : "先授权，再挂单。"}` : `It did not fill. ${text ? text.slice(0, 80) : "Approve, then place."}`);
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

  if (!ready) {
    return (
      <article className="border border-gold bg-card px-3 py-4">
        <p className="text-[11px] tracking-[0.22em] text-gold">{zh ? "现货" : "Spot"}</p>
        <h3 className="mt-1 font-display text-2xl italic sm:text-3xl">{zh ? "订单簿还差一次签名" : "The book needs one signature"}</h3>
        <p className="mt-2 text-sm leading-6">{zh ? "地址已经写在页面上。用收费地址签下面这一次，不要先做别的转账。签完之后，每台设备都能看到盘口。" : "The address is already on the page. Sign this once from the fee address, and do not send another transfer first. After that, every device sees the book."}</p>
        <p className="mt-2 break-all font-mono text-xs">{spot}</p>
        <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-ink px-4 text-sm text-paper disabled:opacity-40" onClick={() => run(() => deploySpot(account ?? ""), zh ? "订单簿已上线。" : "The book is live.")}>{busy ? (zh ? "等待钱包确认" : "Waiting for the wallet") : (zh ? "部署订单簿" : "Deploy the book")}</button>
        {note ? <p className={`mt-2 text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </article>
    );
  }

  return (
    <section className="grid gap-3">
      {choices.length > 1 ? (
        <div className="grid grid-cols-2 border border-gold sm:grid-cols-4">
          {choices.map((id) => (
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
          <article className="order-2 border border-gold bg-card lg:order-1">
            <div className="flex items-end justify-between gap-3 px-3 py-3">
              <div>
                <p className="text-[11px] tracking-[0.18em] text-gold">{name} / USDT0</p>
                <p className="mt-1 break-all font-mono text-[11px] text-ink/45">{spot}</p>
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
              {askView.length === 0 ? <p className="px-2 py-4 text-xs leading-5 text-ink/55">{zh ? "卖盘还没有单。在右边填价格和数量，这一档就会出现在这里。" : "No asks yet. Enter a price and a size on the right and the level appears here."}</p> : askView.map((level) => (
                <Row key={`a-${level.price}`} level={level} max={maxAsk} bid={false} market={market} onPick={() => pick(level, false)} />
              ))}
            </div>
            <p className="border-y border-gold/40 px-2 py-1 text-center font-mono text-[11px] text-ink/55">{spread > 0n ? `${zh ? "价差" : "Spread"} ${usdtText(spread, 4)}` : (zh ? "还没有对敲的两档" : "No two-sided market")}</p>
            <div>
              {bids.length === 0 ? <p className="px-2 py-4 text-xs leading-5 text-ink/55">{zh ? "买盘还没有单。买入挂在价差下面，同价的后来者排在后面。" : "No bids yet. A buy rests under the spread. A later order at the same price waits behind."}</p> : bids.map((level) => (
                <Row key={`b-${level.price}`} level={level} max={maxBid} bid market={market} onPick={() => pick(level, true)} />
              ))}
            </div>
            {miss ? <p className="px-2 py-2 text-xs text-ink/55">{zh ? "这一次没读到。不写成 0。" : "This read missed. It is not shown as zero."}</p> : null}
            <div className="grid grid-cols-2 border-t border-gold/40 text-xs sm:grid-cols-4">
              <Stat k={zh ? "卖盘可买" : "Asks can buy"} v={`${baseText(market, askBook.base)} ${name}`} s={zh ? `折合 ${usdtText(askBook.quote, 2)} · ${askBook.lots} 笔` : `${usdtText(askBook.quote, 2)} · ${askBook.lots}`} />
              <Stat k={zh ? "买盘可卖" : "Bids can sell"} v={`${baseText(market, bidBook.base)} ${name}`} s={zh ? `折合 ${usdtText(bidBook.quote, 2)} · ${bidBook.lots} 笔` : `${usdtText(bidBook.quote, 2)} · ${bidBook.lots}`} />
              <Stat k={zh ? "已读成交" : "Prints read"} v={`${traded.n}${zh ? " 笔" : ""}`} s={`${usdtText(traded.quote, 2)} USDT0`} />
              <Stat k={zh ? "已收手续费" : "Fees read"} v={`${usdtText(traded.fee, 4)} USDT0`} s={zh ? "只算读到的成交" : "Of the prints read"} />
            </div>
            <p className="px-3 py-2 text-[11px] leading-5 text-ink/50">{zh ? "同一价格并成一档。卖盘可买是挂着的全部卖单。买盘可卖是挂着的全部买单。点一档，价格和数量填进右边。" : "One price is one level. Tap a level to fill the ticket."} {spot}</p>
          </article>
          <article className="order-1 border border-gold bg-card px-3 py-3 lg:order-2">
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
            <div className="mt-2 grid grid-cols-2 border border-gold/40">
              <p className="px-2 py-2">
                <span className="block text-[10px] tracking-wide text-ink/45">{zh ? "可买入" : "Can buy"}</span>
                <span className="font-mono text-sm">{purse ? `${usdtText(purse.usdt, 2)} USDT0` : "—"}</span>
              </p>
              <p className="border-l border-gold/40 px-2 py-2">
                <span className="block text-[10px] tracking-wide text-ink/45">{zh ? "可卖出" : "Can sell"}</span>
                <span className="font-mono text-sm">{purse ? `${baseText(market, market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch)} ${name}` : "—"}</span>
              </p>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} type="button" onClick={() => fillPct(pct)} className="min-h-9 border border-gold text-xs">{pct === 100 ? (zh ? "全部" : "All") : `${pct}%`}</button>
              ))}
            </div>
            <Quote zh={zh} market={market} side={side} price={price} amount={amount} />
            <Plan zh={zh} market={market} side={side} price={price} amount={amount} asks={asks} bids={bids} purse={purse} name={name} />
            <p className="mt-2 text-xs leading-5 text-ink/60">
              {zh ? "两边都按钱包余额。买入切 USDT0，卖出切这种币。买方按价格付，卖方实收 99.8%。" : "Both figures are the wallet. Buy cuts USDT0. Sell cuts this coin. The buyer pays the price. The seller receives 99.8 percent."}
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
