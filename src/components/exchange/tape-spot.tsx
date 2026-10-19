import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SideRail } from "@/components/exchange/side-rail";
import { formatUnits } from "viem";
import { chainNote, XLAYER } from "@/lib/xlayer";
import { quoteOkb } from "@/lib/okb";
import { TapeCircuits } from "@/components/exchange/tape-circuits";
import { ContainerDesk } from "@/components/exchange/capacitor-desk";
import { currentAccount, onAccount } from "@/lib/wallet";
import {
  baseText,
  cancelSpot,
  deploySpot,
  placeSpot,
  readSpotView,
  peekSpotPrints,
  blockStamp,
  spotAddress,
  spotReady,
  spotBase,
  spotPrice,
  usdtText,
  type Level,
  type OpenOrder,
  type SpotMarket,
  type SpotPrint,
  type SpotPurse,
} from "@/lib/tape-spot";

const UNIT = 100_000_000n;
const NAMES = ["TAPE", "NAND", "LATCH"] as const;
type MoneyUnit = "usdt" | "okb";

function typedUsdt(text: string, unit: MoneyUnit, rate: bigint): bigint {
  const raw = spotPrice(text);
  if (unit !== "okb") return raw;
  if (rate <= 0n) throw new Error("rate");
  return raw * rate / 1_000_000n;
}

function moneyText(usdt: bigint, unit: MoneyUnit, rate: bigint): string {
  if (unit !== "okb" || rate <= 0n) return usdtText(usdt, 2);
  const okb = usdt * 1_000_000n / rate;
  const short = usdtText(okb, 2);
  return short === "0" && okb > 0n ? usdtText(okb, 4) : short;
}

function cost(market: number, size: bigint, price: bigint): bigint {
  return market === 0 ? size * price / UNIT : size * price;
}

function sumSide(rows: Level[], market: number) {
  return rows.reduce((sum, row) => ({ base: sum.base + row.size, quote: sum.quote + cost(market, row.size, row.price), lots: sum.lots + row.lots }), { base: 0n, quote: 0n, lots: 0 });
}

function Plan({ zh, market, side, price, amount, asks, bids, purse, name, unit, rate }: { zh: boolean; market: SpotMarket; side: "buy" | "sell"; price: string; amount: string; asks: Level[]; bids: Level[]; purse: SpotPurse | null; name: string; unit: MoneyUnit; rate: bigint }) {
  let px = 0n;
  let qty = 0n;
  try {
    px = typedUsdt(price, unit, rate);
    qty = amount.trim() ? spotBase(market, amount) : 0n;
  } catch {
    return null;
  }
  const scale = market === 0 ? UNIT : 1n;
  const walletBuy = purse && px > 0n ? purse.usdt * scale / px : 0n;
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
      <p className="bg-card px-2 py-2"><span className="block text-[10px] text-ink/45">{zh ? "这一笔能吃到" : "This order takes"}</span><span className="font-mono">{qty > 0n ? `${baseText(market, filled)} · ${moneyText(pay, unit, rate)}` : "—"}</span></p>
      <p className="bg-card px-2 py-2"><span className="block text-[10px] text-ink/45">{zh ? "吃完剩下挂出" : "Rest after the take"}</span><span className="font-mono">{qty > 0n ? baseText(market, left) : "—"}</span></p>
    </div>
  );
}

function Quote({ zh, market, side, price, amount, unit, rate }: { zh: boolean; market: SpotMarket; side: "buy" | "sell"; price: string; amount: string; unit: MoneyUnit; rate: bigint }) {
  let pay = 0n;
  let fee = 0n;
  try {
    const px = typedUsdt(price, unit, rate);
    const qty = spotBase(market, amount);
    pay = cost(market, qty, px);
    fee = pay * 20n / 10000n;
  } catch {
    return null;
  }
  if (pay === 0n || fee === 0n) return <p className="mt-2 text-xs text-sell">{zh ? "这一笔太小，手续费舍成 0，合约不会收。" : "This order is too small. The fee rounds to zero and the contract will not take it."}</p>;
  const label = unit === "okb" ? "OKB" : "USDT0";
  return (
    <div className="mt-2 grid grid-cols-3 border border-gold/40 text-center">
      <p className="px-1 py-2"><span className="block text-[10px] text-ink/45">{side === "buy" ? (zh ? "你支付" : "You pay") : (zh ? "买方支付" : "Buyer pays")}</span><span className="font-mono text-sm">{moneyText(pay, unit, rate)} {label}</span></p>
      <p className="border-x border-gold/40 px-1 py-2"><span className="block text-[10px] text-ink/45">{zh ? "千分之二" : "0.20%"}</span><span className="font-mono text-sm">{moneyText(fee, unit, rate)}</span></p>
      <p className="px-1 py-2"><span className="block text-[10px] text-ink/45">{side === "sell" ? (zh ? "你实收" : "You receive") : (zh ? "卖方实收" : "Seller receives")}</span><span className="font-mono text-sm">{moneyText(pay - fee, unit, rate)}</span></p>
    </div>
  );
}

function plainBase(market: number, amount: bigint): string {
  if (market !== 0) return amount.toString();
  const text = formatUnits(amount, 8);
  const [whole, frac = ""] = text.split(".");
  const cap = Number(whole) >= 1 ? 2 : 4;
  const cut = frac.slice(0, cap).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

const bookGrid = "grid grid-cols-[minmax(0,1.15fr)_minmax(0,.85fr)_minmax(0,1fr)] items-center text-[13px] tabular-nums lg:grid-cols-[minmax(0,1.15fr)_minmax(0,.9fr)_minmax(0,1.15fr)_6.5rem_4.25rem]";

function BookRow({ priceLabel, sizeLabel, totalLabel, cap, value, onChange, onPick, onTake, bid, mine, on, busy, depth, zh }: { priceLabel: string; sizeLabel: string; totalLabel: string; cap: string; value: string; onChange: (value: string) => void; onPick: () => void; onTake: () => void; bid: boolean; mine: boolean; on: boolean; busy: boolean; depth: number; zh: boolean }) {
  const fill = Math.min(100, Math.max(depth, 6));
  const wash = bid ? "rgba(137, 196, 168, 0.55)" : "rgba(240, 170, 170, 0.62)";
  return (
    <div className={on ? "bg-ink/[0.03]" : ""}>
      <div className={`${bookGrid} relative`}>
      <button type="button" onClick={onPick} className={`relative truncate px-2 py-2 text-left font-mono font-semibold lg:px-3 lg:py-1.5 ${bid ? "text-[#089981]" : "text-[#f23645]"}`}>
        {priceLabel}{mine ? <span className="ml-1 text-[11px] font-normal text-ink/40">{zh ? "我的" : "mine"}</span> : null}
      </button>
      <button type="button" onClick={onPick} className="relative px-2 py-2 text-right font-mono text-ink lg:px-3 lg:py-1.5">
        <span className="pointer-events-none absolute inset-y-1 left-1 lg:left-2" style={{ width: `${fill}%`, background: wash }} />
        <span className="relative">{sizeLabel}</span>
      </button>
      <button type="button" onClick={onPick} className="relative truncate px-2 py-2 text-right font-mono text-ink/80 lg:px-3 lg:py-1.5">{totalLabel}</button>
      <div className="relative hidden bg-card px-1 py-1 lg:block">
        <input value={value} placeholder={`≤${cap}`} inputMode="decimal" onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!busy) onTake(); } }} aria-label={zh ? `填数量，最多 ${cap}。不填就是这一档` : `Size, at most ${cap}. Blank takes the level.`} className="box-border h-7 w-full min-w-0 border border-ink/20 bg-paper px-1.5 text-right font-mono text-xs text-ink outline-none placeholder:text-ink/35 focus:border-ink" />
      </div>
      <div className="relative hidden bg-card py-1 pr-2 lg:block">
        <button type="button" disabled={busy} onClick={() => { if (!busy) onTake(); }} className={`h-7 w-full border bg-paper text-xs disabled:opacity-40 ${bid ? "border-[#f23645] text-[#f23645]" : "border-[#089981] text-[#089981]"}`}>{bid ? (zh ? "卖出" : "Sell") : (zh ? "买入" : "Buy")}</button>
      </div>
      </div>
      {on ? (
        <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-2 px-2 pb-2 lg:hidden">
          <input value={value} placeholder={`≤${cap}`} inputMode="decimal" onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (!busy) onTake(); } }} aria-label={zh ? `填数量，最多 ${cap}。不填就是这一档` : `Size, at most ${cap}. Blank takes the level.`} className="box-border h-10 w-full min-w-0 border border-ink/20 bg-paper px-2 text-right font-mono text-sm text-ink outline-none placeholder:text-ink/35 focus:border-ink" />
          <button type="button" disabled={busy} onClick={() => { if (!busy) onTake(); }} className={`h-10 border bg-paper text-sm disabled:opacity-40 ${bid ? "border-[#f23645] text-[#f23645]" : "border-[#089981] text-[#089981]"}`}>{bid ? (zh ? "卖出" : "Sell") : (zh ? "买入" : "Buy")}</button>
        </div>
      ) : null}
    </div>
  );
}

export function TapeSpotDesk({ zh, lanes }: { zh: boolean; lanes?: readonly (SpotMarket | "circuit" | "cap")[] }) {
  const choices = lanes ?? ([0, 1, 2, "circuit", "cap"] as const);
  const [spot, setSpot] = useState<string | null>(() => spotAddress());
  const [ready, setReady] = useState(true);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [lane, setLane] = useState<SpotMarket | "circuit" | "cap">(choices[0] ?? 0);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState<MoneyUnit>("usdt");
  const [okbRate, setOkbRate] = useState(0n);
  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);
  const [purse, setPurse] = useState<SpotPurse | null>(null);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [prints, setPrints] = useState<SpotPrint[]>([]);
  const [clock, setClock] = useState(0);
  const [reading, setReading] = useState(false);
  const [tab, setTab] = useState<"tape" | "mine">("tape");
  const [miss, setMiss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [takes, setTakes] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const market: SpotMarket = lane === "circuit" || lane === "cap" ? 0 : lane;

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => setSpot(spotAddress()), []);
  useEffect(() => {
    if (!spot) return;
    let dead = false;
    const look = () => {
      spotReady().then((ok) => { if (!dead && !ok) setReady(false); }).catch(() => undefined);
    };
    look();
    const id = window.setInterval(look, 8000);
    return () => { dead = true; window.clearInterval(id); };
  }, [spot]);

  useEffect(() => {
    setBids([]);
    setAsks([]);
    setPrints([]);
    setReading(true);
    setOrders([]);
    setMiss(false);
  }, [lane]);

  useEffect(() => {
    if (!spot || !ready || lane === "circuit" || lane === "cap") return;
    let dead = false;
    const look = () => {
      const snap = peekSpotPrints(market);
      if (dead) return;
      setPrints(snap.rows);
      setReading(snap.pending);
      setClock(blockStamp(snap.rows[0]?.block ?? 1) || Date.now());
    };
    look();
    const id = window.setInterval(look, 2000);
    return () => { dead = true; window.clearInterval(id); };
  }, [spot, ready, market, lane]);

  useEffect(() => {
    if (!spot || !ready || lane === "circuit" || lane === "cap") return;
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      readSpotView(market, account).then((view) => {
        if (dead || !view.book) return;
        setMiss(false);
        setBids(view.book.bids);
        setAsks(view.book.asks);
        if (view.purse) setPurse(view.purse);
        if (view.orders) setOrders(view.orders.filter((row) => row.market === market && row.left > 0n));
      }).catch(() => {
        window.setTimeout(() => {
          if (dead) return;
          readSpotView(market, account).then((view) => {
            if (dead || !view.book) return;
            setMiss(false);
            setBids(view.book.bids);
            setAsks(view.book.asks);
            if (view.purse) setPurse(view.purse);
            if (view.orders) setOrders(view.orders.filter((row) => row.market === market && row.left > 0n));
          }).catch(() => { if (!dead) setMiss(true); });
        }, 800);
      });
      quoteOkb("sell", 10n ** 18n).then((rate) => { if (!dead && rate > 0n) setOkbRate(rate); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 6000);
    const onShow = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { dead = true; window.clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, [spot, ready, market, account, lane]);

  const askBook = useMemo(() => sumSide(asks, market), [asks, market]);
  const bidBook = useMemo(() => sumSide(bids, market), [bids, market]);
  const traded = useMemo(() => prints.reduce((sum, row) => ({ n: sum.n + 1, base: sum.base + row.base, quote: sum.quote + row.quote, fee: sum.fee + row.fee }), { n: 0, base: 0n, quote: 0n, fee: 0n }), [prints]);
  const askView = useMemo(() => [...asks].reverse(), [asks]);
  const askBox = useRef<HTMLDivElement>(null);
  const bidBox = useRef<HTMLDivElement>(null);
  const bookBox = useRef<HTMLElement>(null);
  const stickAsk = useRef(true);
  useLayoutEffect(() => {
    const box = askBox.current;
    if (box && stickAsk.current) box.scrollTop = box.scrollHeight;
  }, [askView, market]);
  useEffect(() => {
    const node = bookBox.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      const ask = askBox.current;
      const bid = bidBox.current;
      if (!ask || !bid) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (!(target instanceof Node)) return;
      const box = ask.contains(target) ? ask : bid.contains(target) ? bid : null;
      if (!box) return;
      event.preventDefault();
      box.scrollTop += event.deltaY;
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);
  const maxAsk = asks.reduce((m, row) => row.size > m ? row.size : m, 0n);
  const maxBid = bids.reduce((m, row) => row.size > m ? row.size : m, 0n);
  const bestAsk = asks[0]?.price ?? 0n;
  const bestBid = bids[0]?.price ?? 0n;
  const spread = bestAsk > bestBid && bestBid > 0n ? bestAsk - bestBid : 0n;
  const name = NAMES[market];
  const quoteUnit: MoneyUnit = unit;
  const unitName = quoteUnit === "okb" ? "OKB" : "USDT0";
  const showPrice = (usdt: bigint, next: MoneyUnit = quoteUnit) => {
    const raw = next === "okb" && okbRate > 0n ? usdt * 1_000_000n / okbRate : usdt;
    const text = formatUnits(raw, 6);
    const [whole, frac = ""] = text.split(".");
    const cap = Number(whole) >= 1 ? 2 : 4;
    const cut = frac.slice(0, cap).replace(/0+$/, "");
    return cut ? `${whole}.${cut}` : whole;
  };
  const ownHit = (() => {
    let px = 0n;
    try { px = price.trim() ? typedUsdt(price, market === 0 ? "usdt" : unit, okbRate) : 0n; } catch { return null; }
    return orders.find((row) => row.market === market && row.left > 0n && (side === "sell" ? row.bid && px > 0n && px <= row.price : !row.bid && px > 0n && px >= row.price)) ?? null;
  })();

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
      const parts: string[] = [];
      let cur: unknown = err;
      for (let i = 0; cur && i < 4; i += 1) {
        if (!(cur instanceof Error)) break;
        parts.push(cur.message);
        const extra = cur as { shortMessage?: string; cause?: unknown };
        if (extra.shortMessage) parts.push(extra.shortMessage);
        cur = extra.cause;
      }
      const text = parts.join(" ");
      setBad(true);
      if ((err as { code?: number }).code === 4001) setNote(zh ? "签名取消了。币还在钱包。" : "Cancelled. The coins stayed in the wallet.");
      else if (text === "onlyfee") setNote(zh ? "只有收费地址能签这一次。" : "Only the fee address can sign this.");
      else if (text === "nonce") setNote(zh ? "收费地址在这之前又发过别的交易，地址对不上。把新地址发过来，我改页面。" : "The fee address sent another transaction first, so the address no longer matches. Send the new one and the page will be updated.");
      else if (text === "amount" || text === "price") setNote(zh ? "价格和数量都要填。NAND 和 LATCH 只收整数。" : "Enter a price and an amount. NAND and LATCH are whole numbers.");
      else if (/self/i.test(text)) setNote(zh ? "会碰到你自己的挂单。合约整笔拒绝，不会先成交别人的。先在下面撤掉自己的单，或把价格放在碰不到的一侧。" : "This would trade against your own order. The contract rejects the whole thing. Cancel yours below, or use a price that does not reach it.");
      else if (/token/i.test(text)) setNote(zh ? "币没划过来。看余额够不够，以及上一笔授权有没有成功。" : "The token did not move. Check the balance, and that the approval before this one succeeded.");
      else if (text === "chain") setNote(chainNote(zh, err && typeof err === "object" && "chainId" in err ? String((err as { chainId?: unknown }).chainId ?? "") : ""));
      else if (text === "address") setNote(zh ? "地址格式不对。" : "That address is not valid.");
      else if (text === "empty") setNote(zh ? "这个地址上没有合约。" : "There is no contract at that address.");
      else if (text === "fee") setNote(zh ? "这一笔太小，千分之二舍成 0。合约不收这种单。" : "This order is too small. The 0.2 percent rounds to zero.");
      else if (/nowallet/i.test(text)) setNote(zh ? "没有检测到 X Layer 钱包。" : "No X Layer wallet was found.");
      else setNote(zh ? `没有成交。${text ? text.slice(0, 80) : "先授权，再挂单。"}` : `It did not fill. ${text ? text.slice(0, 80) : "Approve, then place."}`);
    }).finally(() => setBusy(false));
  };

  const takeLevel = (level: Level, bookBid: boolean) => {
    const key = `${bookBid ? "b" : "a"}-${level.price}`;
    const typed = (takes[key] ?? "").trim() || plainBase(market, level.size);
    let qty = 0n;
    try { qty = spotBase(market, typed); } catch { setBad(true); setNote(zh ? "数量不对。NAND 和 LATCH 只收整数。" : "The amount is not valid. NAND and LATCH are whole numbers."); return; }
    if (qty <= 0n || qty > level.size) { setBad(true); setNote(zh ? `不能超过这一档的 ${plainBase(market, level.size)}。` : `It cannot be more than this level, ${plainBase(market, level.size)}.`); return; }
    const mine = orders.some((row) => row.market === market && row.bid === bookBid && (bookBid ? row.price >= level.price : row.price <= level.price));
    if (mine) { setBad(true); setNote(zh ? "这一档或更优的价格上有你自己的单。合约会整笔拒绝。先撤掉。" : "You have an order at this price or a better one. The contract rejects the whole trade. Cancel it first."); return; }
    run(() => placeSpot(account ?? "", market, !bookBid, level.price, qty), zh ? "已按这一档提交。数量不超过这一档，多出来的不会再挂成新单。" : "Submitted at this level. The amount does not exceed it, so nothing extra is left on the book.");
  };

  const pickLevel = (level: Level, bookBid: boolean) => {
    const key = `${bookBid ? "b" : "a"}-${level.price}`;
    setPicked(key);
    setSide(bookBid ? "sell" : "buy");
    setPrice(showPrice(level.price));
    setAmount(plainBase(market, level.size));
  };

  const fillPct = (pct: number) => {
    if (!purse) return;
    let px = 0n;
    try { px = typedUsdt(price, quoteUnit, okbRate); } catch { return; }
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

  const book = (
    <section className="flex min-h-0 flex-col lg:h-full">
      {lane === "circuit" ? <TapeCircuits zh={zh} /> : lane === "cap" ? <ContainerDesk zh={zh} /> : (
        <div className="flex min-h-0 flex-col lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_21.5rem] lg:items-stretch lg:overflow-hidden lg:border lg:border-gold xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="flex min-w-0 flex-col lg:h-full lg:min-h-0">
          <article ref={bookBox} className="flex h-[58dvh] min-h-[22rem] shrink-0 flex-col overflow-hidden border border-gold bg-card lg:h-auto lg:min-h-0 lg:flex-1 lg:border-0">
            <div className="flex shrink-0 flex-col gap-2 border-b border-gold/40 px-3 py-2 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] tracking-[0.14em] text-gold lg:text-xs">{market === 0 ? "TAPE" : "TAPELIQUID"} · {name} / {unitName}{spot ? <> · <a className="underline" href={`${XLAYER.explorer}/address/${spot}`} target="_blank" rel="noreferrer">{spot.slice(0, 6)}…{spot.slice(-4)}</a></> : null}</p>
                <h3 className="font-mono text-2xl leading-none tabular-nums lg:text-3xl">{bestAsk > 0n ? moneyText(bestAsk, quoteUnit, okbRate) : bestBid > 0n ? moneyText(bestBid, quoteUnit, okbRate) : "—"}</h3>
                <div className="mt-2 flex gap-1">
                    {(["usdt", "okb"] as const).map((next) => (
                      <button key={next} type="button" className={`min-h-7 px-2 text-[11px] ${quoteUnit === next ? "bg-ink text-paper" : "border border-gold text-ink/70"}`} onClick={() => {
                        if (next === unit) return;
                        try { if (price.trim()) setPrice(showPrice(typedUsdt(price, quoteUnit, okbRate), next)); } catch { /* keep the typed price */ }
                        setUnit(next);
                      }}>{next === "okb" ? "OKB" : "USDT0"}</button>
                    ))}
                  </div>
              </div>
              <div className="flex w-full gap-x-4 overflow-x-auto pb-1 text-right text-[11px] text-ink/60 sm:text-xs lg:w-auto lg:flex-nowrap lg:pb-0">
                <p className="shrink-0">{zh ? "买一" : "Bid"}<br /><span className="font-mono text-sm text-ink">{bestBid > 0n ? moneyText(bestBid, quoteUnit, okbRate) : "—"}</span></p>
                <p className="shrink-0">{zh ? "卖一" : "Ask"}<br /><span className="font-mono text-sm text-ink">{bestAsk > 0n ? moneyText(bestAsk, quoteUnit, okbRate) : "—"}</span></p>
                <p className="shrink-0">{zh ? "价差" : "Spread"}<br /><span className="font-mono text-sm text-ink">{spread > 0n ? moneyText(spread, quoteUnit, okbRate) : "—"}</span></p>
                <p className="shrink-0">{zh ? "卖盘" : "Asks"}<br /><span className="font-mono text-sm text-ink">{baseText(market, askBook.base)} {name}</span></p>
                <p className="shrink-0">{zh ? "买盘" : "Bids"}<br /><span className="font-mono text-sm text-ink">{baseText(market, bidBook.base)} {name}</span></p>
                <p className="shrink-0">{zh ? "成交" : "Prints"}<br /><span className="font-mono text-sm text-ink">{reading && traded.n === 0 ? "—" : traded.n}</span></p>
                <p className="shrink-0">{zh ? "手续费" : "Fees"}<br /><span className="font-mono text-sm text-ink">{reading && traded.n === 0 ? "—" : moneyText(traded.fee, quoteUnit, okbRate)}</span></p>
              </div>
            </div>
            <div className={`${bookGrid} shrink-0 text-xs text-ink/45`}>
              <span className="px-2 py-1.5 lg:px-3">{zh ? "价格" : "Price"}</span>
              <span className="px-2 py-1.5 text-right lg:px-3">{zh ? "数量" : "Size"}</span>
              <span className="px-2 py-1.5 text-right lg:px-3">{zh ? "总额" : "Total"} <span className="text-ink/35">{unitName}</span></span>
              <span className="hidden px-1 py-1.5 text-right lg:col-span-2 lg:block">{zh ? "指定成交" : "Take"}</span>
            </div>
            <div ref={askBox} onScroll={(event) => { const el = event.currentTarget; stickAsk.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 8; }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-gold/30">
              <div className="flex min-h-full flex-col justify-end">
              {askView.length === 0 ? <p className="px-3 py-2 text-xs text-ink/55">{zh ? "卖盘空着。" : "No asks."}</p> : askView.map((level) => {
                      const key = `a-${level.price}`;
                      return <BookRow key={key} zh={zh} bid={false} mine={orders.some((row) => row.market === market && !row.bid && row.price === level.price)} on={picked === key} busy={busy} depth={maxAsk > 0n ? Number((level.size * 100n) / maxAsk) : 0} priceLabel={moneyText(level.price, quoteUnit, okbRate)} sizeLabel={baseText(market, level.size)} totalLabel={`${moneyText(cost(market, level.size, level.price), quoteUnit, okbRate)} ${unitName}`} cap={plainBase(market, level.size)} value={takes[key] ?? ""} onChange={(value) => setTakes((cur) => ({ ...cur, [key]: value }))} onPick={() => pickLevel(level, false)} onTake={() => takeLevel(level, false)} />;
                    })}
              </div>
            </div>
            <p className="flex shrink-0 items-center gap-3 px-3 py-2 font-mono text-sm text-ink/60">
              <span className="h-px flex-1 bg-gold/40" />
              <span>{spread > 0n ? moneyText(spread, quoteUnit, okbRate) : "—"}</span>
              <span className="h-px flex-1 bg-gold/40" />
            </p>
            <div ref={bidBox} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {bids.length === 0 ? <p className="px-3 py-2 text-xs text-ink/55">{zh ? "买盘空着。" : "No bids."}</p> : bids.map((level) => {
                      const key = `b-${level.price}`;
                      return <BookRow key={key} zh={zh} bid mine={orders.some((row) => row.market === market && row.bid && row.price === level.price)} on={picked === key} busy={busy} depth={maxBid > 0n ? Number((level.size * 100n) / maxBid) : 0} priceLabel={moneyText(level.price, quoteUnit, okbRate)} sizeLabel={baseText(market, level.size)} totalLabel={`${moneyText(cost(market, level.size, level.price), quoteUnit, okbRate)} ${unitName}`} cap={plainBase(market, level.size)} value={takes[key] ?? ""} onChange={(value) => setTakes((cur) => ({ ...cur, [key]: value }))} onPick={() => pickLevel(level, true)} onTake={() => takeLevel(level, true)} />;
                    })}
            </div>
            {miss ? <p className="shrink-0 px-2 py-2 text-xs text-ink/55">{zh ? "这一次没读到。不写成 0。" : "This read missed. It is not shown as zero."}</p> : null}
          </article>
          <article className="mt-2 flex h-72 shrink-0 flex-col overflow-hidden border border-gold bg-card lg:mt-0 lg:h-[30%] lg:max-h-52 lg:border-0 lg:border-t lg:border-gold">
            <div className="grid shrink-0 grid-cols-2 border-b border-gold">
              <button type="button" onClick={() => setTab("tape")} className={`min-h-10 text-sm ${tab === "tape" ? "bg-ink text-paper" : ""}`}>{zh ? "成交" : "Prints"}</button>
              <button type="button" onClick={() => setTab("mine")} className={`min-h-10 text-sm ${tab === "mine" ? "bg-ink text-paper" : ""}`}>{zh ? "我的挂单" : "My orders"}</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "tape" ? (
              <ul>
                {prints.length === 0 ? <li className="px-3 py-3 text-sm text-ink/45">{reading ? (zh ? "读取中" : "Reading") : (zh ? "没有成交" : "None")}</li> : null}
                {prints.slice(0, 24).map((row) => {
                  const ts = clock ? blockStamp(row.block) : 0;
                  const time = ts ? new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ts * 1000)) : "—";
                  return (
                  <li key={`${row.tx}-${row.base}`} className="flex items-center gap-2 border-t border-gold/30 px-3 py-2 font-mono text-xs">
                    <span className="w-16 shrink-0 text-ink/55 sm:w-24">{time}</span>
                    <span className="min-w-0 flex-1 truncate">{moneyText(row.price, quoteUnit, okbRate)}</span>
                    <span className="w-16 shrink-0 truncate text-right sm:w-24">{baseText(market, row.base)}</span>
                    <a className="shrink-0 underline" href={`${XLAYER.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{zh ? "链上" : "Tx"}</a>
                  </li>
                  );
                })}
                {prints.length > 24 ? <li className="px-3 py-2 font-mono text-[11px] text-ink/40">+{prints.length - 24}</li> : null}
              </ul>
            ) : (
              <ul>
                {orders.length === 0 ? <li className="px-3 py-3 text-sm text-ink/45">{zh ? "没有挂单" : "None"}</li> : null}
                {orders.map((row) => (
                  <li key={row.id.toString()} className="grid items-center gap-2 border-t border-gold/30 px-3 py-2 text-xs sm:grid-cols-[4rem_1fr_1fr_auto]">
                    <span className={row.bid ? "text-[#089981]" : "text-[#f23645]"}>{row.bid ? (zh ? "买" : "Bid") : (zh ? "卖" : "Ask")}</span>
                    <span className="font-mono">{moneyText(row.price, quoteUnit, okbRate)}</span>
                    <span className="font-mono">{baseText(row.market, row.left)}</span>
                    <button type="button" disabled={busy} className="min-h-9 border border-gold px-2 disabled:opacity-40" onClick={() => run(() => cancelSpot(account ?? "", row.id), zh ? "已撤单。没吃掉的退回钱包。" : "Cancelled. The rest is back in the wallet.")}>{zh ? "撤单" : "Cancel"}</button>
                  </li>
                ))}
              </ul>
            )}
            </div>
          </article>
          </div>
          <div className="mt-2 border border-gold bg-card p-3 lg:mt-0 lg:h-full lg:overflow-y-auto lg:border-0 lg:border-l lg:border-gold">
            <div>
            <div className="grid grid-cols-2 border border-gold">
              <button type="button" onClick={() => setSide("buy")} className={`min-h-11 text-sm ${side === "buy" ? "bg-[#089981] text-white" : "text-[#089981]"}`}>{zh ? "买入" : "Buy"}</button>
              <button type="button" onClick={() => setSide("sell")} className={`min-h-11 text-sm ${side === "sell" ? "bg-[#f23645] text-white" : "text-[#f23645]"}`}>{zh ? "卖出" : "Sell"}</button>
            </div>
            <label className="mt-3 grid gap-1 text-xs text-ink/55">
              {zh ? `价格 ${unitName}` : `Price in ${unitName}`}
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            </label>
            <label className="mt-2 grid gap-1 text-xs text-ink/55">
              {zh ? `数量 ${name}` : `Amount ${name}`}
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            </label>
            <div className="mt-2 grid grid-cols-2 border border-gold/40">
              <p className="px-2 py-2">
                <span className="block text-xs text-ink/45">{zh ? "可买入" : "Can buy"}</span>
                <span className="font-mono text-sm">{purse ? `${usdtText(purse.usdt, 2)} USDT0` : "—"}</span>
              </p>
              <p className="border-l border-gold/40 px-2 py-2">
                <span className="block text-xs text-ink/45">{zh ? "可卖出" : "Can sell"}</span>
                <span className="font-mono text-sm">{purse ? `${baseText(market, market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch)} ${name}` : "—"}</span>
              </p>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {[25, 50, 75, 100].map((pct) => (
                <button key={pct} type="button" onClick={() => fillPct(pct)} className="min-h-9 border border-gold text-xs">{pct === 100 ? (zh ? "全部" : "All") : `${pct}%`}</button>
              ))}
            </div>
            <Quote zh={zh} market={market} side={side} price={price} amount={amount} unit={quoteUnit} rate={okbRate} />
            <Plan zh={zh} market={market} side={side} price={price} amount={amount} asks={asks} bids={bids} purse={purse} name={name} unit={quoteUnit} rate={okbRate} />
            {quoteUnit === "okb" ? <p className="mt-2 font-mono text-xs text-ink/55">{(() => { try { return `USDT0 ${usdtText(typedUsdt(price, "okb", okbRate), 4)}`; } catch { return "—"; } })()}</p> : null}
            {ownHit ? <p className="mt-2 text-sm text-sell">{zh ? "碰到自己的单。先撤掉。" : "That hits your own order. Cancel it first."}</p> : null}
            <button type="button" disabled={busy || Boolean(ownHit)} className={`mt-3 min-h-12 w-full text-sm text-white disabled:opacity-40 ${side === "buy" ? "bg-[#089981]" : "bg-[#f23645]"}`} onClick={() => {
              let px = 0n;
              let qty = 0n;
              try {
                px = typedUsdt(price, quoteUnit, okbRate);
                qty = spotBase(market, amount);
              } catch (err) {
                setBad(true);
                const text = err instanceof Error ? err.message : "";
                setNote(text === "amount" ? (zh ? "数量不对。NAND 和 LATCH 只收整数。" : "The amount is not valid. NAND and LATCH are whole numbers.") : (zh ? "价格不对。OKB 价还没读到时先用 USDT0。" : "The price is not valid. Use USDT0 if the OKB price is not in yet."));
                return;
              }
              run(() => placeSpot(account ?? "", market, side === "buy", px, qty), zh ? "已进订单簿。没有对手的部分继续挂着，不会消失。" : "It is on the book. Whatever did not meet another order stays there.");
            }}>
              {side === "buy" ? (zh ? `买入 ${name}` : `Buy ${name}`) : (zh ? `卖出 ${name}` : `Sell ${name}`)}
            </button>
            {note ? <p className={`mt-2 text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
            <details className="mt-3 text-xs text-ink/45">
              <summary className="cursor-pointer">{zh ? "说明" : "Notes"}</summary>
              <p className="mt-2 leading-5">{zh ? "点价格、数量或总额，右边的买卖和价格会跟着变。行尾不填就是这一档全部，填了不能超过这一档。卖方实收 99.8%。" : "A price, a size, or a total fills the ticket. Buy and sell follow that row. A blank size takes the whole level. A typed size cannot pass it. The seller receives 99.8%."}</p>
            </details>
            </div>
          </div>
        </div>
      )}
    </section>
  );
  if (choices.length < 2) return book;
  return (
    <SideRail items={choices.map((id) => ({
      key: String(id),
      label: id === "circuit" ? (zh ? "电路 · TAPELIQUID" : "Circuits") : id === "cap" ? (zh ? "容器 · TAPELIQUID" : "Box") : id === 0 ? "TAPE" : `${NAMES[id]} · TAPELIQUID`,
      on: lane === id,
      run: () => setLane(id),
    }))}>
      {book}
    </SideRail>
  );
}
