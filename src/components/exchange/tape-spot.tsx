import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SideRail } from "@/components/exchange/side-rail";
import { formatUnits } from "viem";
import { chainNote, XLAYER } from "@/lib/xlayer";
import { bookOkbRate } from "@/lib/okb";
import { TapeCircuits } from "@/components/exchange/tape-circuits";
import { ContainerDesk } from "@/components/exchange/capacitor-desk";
import { currentAccount, onAccount } from "@/lib/wallet";
import {
  baseText,
  cancelSpotPaid,
  deploySpot,
  isOkbBid,
  placeSpotPaid,
  readSpotView,
  readDustHeads,
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
  type BookDust,
} from "@/lib/tape-spot";
import { openTapePrice } from "@/lib/tape-pool";

const UNIT = 100_000_000n;
const NAMES = ["TAPE", "NAND", "LATCH"] as const;
type MoneyUnit = "usdt" | "okb";

function typedUsdt(text: string, unit: MoneyUnit, rate: bigint): bigint {
  const raw = spotPrice(text);
  if (unit !== "okb") return raw;
  if (rate <= 0n) throw new Error("rate");
  return raw * rate / 1_000_000n;
}

function moneyText(usdt: bigint, unit: MoneyUnit, rate: bigint, digits = 2): string {
  if (unit !== "okb" || rate <= 0n) return usdtText(usdt, digits);
  const okb = usdt * 1_000_000n / rate;
  const short = usdtText(okb, digits);
  return short === "0" && okb > 0n ? usdtText(okb, Math.max(digits, 4)) : short;
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
  const spendableOkb = purse && purse.okb > 2_000_000_000_000_000n ? purse.okb - 2_000_000_000_000_000n : 0n;
  const budget = !purse ? 0n : unit === "okb" ? (rate > 0n ? spendableOkb * rate / 10n ** 18n : 0n) : purse.usdt;
  const walletBuy = purse && px > 0n ? budget * scale / px : 0n;
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
  const label = unit === "okb" ? "OKB" : "USDT";
  return (
    <div className="mt-2 grid grid-cols-3 border border-gold/40 text-center">
      <p className="px-1 py-2"><span className="block text-[10px] text-ink/45">{side === "buy" ? (zh ? "你支付" : "You pay") : (zh ? "买方支付" : "Buyer pays")}</span><span className="font-mono text-sm">{moneyText(pay, unit, rate)} {label}</span></p>
      <p className="border-x border-gold/40 px-1 py-2"><span className="block text-[10px] text-ink/45">{zh ? "千分之二" : "0.20%"}</span><span className="font-mono text-sm">{moneyText(fee, unit, rate)}</span></p>
      <p className="px-1 py-2"><span className="block text-[10px] text-ink/45">{side === "sell" ? (zh ? "你实收" : "You receive") : (zh ? "卖方实收" : "Seller receives")}</span><span className="font-mono text-sm">{moneyText(pay - fee, unit, rate)}</span></p>
    </div>
  );
}

function usdRaw(n: number): bigint {
  if (!(n > 0) || !Number.isFinite(n)) return 0n;
  const [whole, frac = ""] = n.toFixed(6).split(".");
  return BigInt(`${whole}${frac.padEnd(6, "0").slice(0, 6)}`);
}

function okbText(amount: bigint): string {
  const [whole, frac = ""] = formatUnits(amount, 18).split(".");
  const cut = frac.slice(0, 4).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
}

function ago(ts: number): string {
  if (!ts) return "—";
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
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
        <button type="button" disabled={busy} onClick={() => { if (!busy) onTake(); }} className={`h-7 w-full text-xs text-white disabled:opacity-40 ${bid ? "bg-[#c47b7b]" : "bg-[#6f9a86]"}`}>{bid ? (zh ? "卖出" : "Sell") : (zh ? "买入" : "Buy")}</button>
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
  const [poolPx, setPoolPx] = useState<number | null>(null);
  const [bids, setBids] = useState<Level[]>([]);
  const [asks, setAsks] = useState<Level[]>([]);
  const [dustAsk, setDustAsk] = useState<BookDust | null>(null);
  const [dustBid, setDustBid] = useState<BookDust | null>(null);
  const [purse, setPurse] = useState<SpotPurse | null>(null);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [prints, setPrints] = useState<SpotPrint[]>([]);
  const [older, setOlder] = useState(true);
  const [sheet, setSheet] = useState(false);
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
    setDustAsk(null);
    setDustBid(null);
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
      setOlder(snap.older);
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
      readDustHeads(market).then((dust) => {
        if (dead) return;
        setDustAsk(dust.ask);
        setDustBid(dust.bid);
      }).catch(() => undefined);
      bookOkbRate().then((rate) => { if (!dead && rate > 0n) setOkbRate(rate); }).catch(() => undefined);
      if (market === 0) openTapePrice().then((px) => { if (!dead) setPoolPx(px); }).catch(() => undefined);
      else setPoolPx(null);
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
  const pairTitle = market === 0 ? "TAPE" : `TAPELIQUID / ${name}`;
  const poolRaw = market === 0 ? usdRaw(poolPx ?? 0) : 0n;
  const headPx = poolRaw > 0n ? poolRaw : bestAsk > 0n ? bestAsk : bestBid;
  const quoteUnit: MoneyUnit = unit;
  const unitName = quoteUnit === "okb" ? "OKB" : "USDT";
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
  let crossDust = false;
  try {
    const px = price.trim() ? typedUsdt(price, market === 0 ? "usdt" : unit, okbRate) : 0n;
    crossDust = side === "buy" ? Boolean(dustAsk && px >= dustAsk.price) : Boolean(dustBid && px > 0n && px <= dustBid.price);
  } catch {
    crossDust = false;
  }

  const run = (task: () => Promise<unknown>, ok: string, start?: string) => {
    setBusy(true);
    setBad(false);
    setNote(start ?? (zh ? "正在连接 X Layer 钱包。请在钱包中确认。" : "Connecting the X Layer wallet. Confirm the request there."));
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
      else if (text === "fee" || /reason: fee|reverted: fee|reverted with reason: fee/i.test(text)) setNote(market === 0 ? (zh ? "挂单吃不过去。卖一最前有一笔灰单，合约整笔拒绝。只有挂出的地址能撤。买 TAPE 去上面的现货。" : "The book cannot be taken. A dust order is first, so the trade reverts. Only that maker can cancel it. Buy TAPE on Spot.") : (zh ? "对手盘最前有一笔灰单，合约整笔拒绝。只有挂出的地址能撤。" : "A dust order is first, so the trade reverts. Only that maker can cancel it."));
      else if (text === "okbshort") setNote(zh ? "OKB 不够。还要留一点做 gas。" : "Not enough OKB. A little has to stay for gas.");
      else if (text === "okbpool") setNote(zh ? "OKB 没换成。池子不够，或价格刚动过。单没进订单簿。" : "The OKB swap did not clear. Nothing was placed.");
      else if (text === "usdtleft") setNote(zh ? "OKB 已换成 USDT，挂单没成功，也没换回去。USDT 在钱包里。" : "OKB became USDT, the order missed, and the swap back failed. USDT is in the wallet.");
      else if (text === "usdtback") setNote(zh ? "这一步已经完成。换成 OKB 没走成，USDT 在钱包里。" : "That step is done. The swap back to OKB failed. USDT is in the wallet.");
      else if (/nowallet/i.test(text)) setNote(zh ? "没有检测到 X Layer 钱包。" : "No X Layer wallet was found.");
      else setNote(zh ? `没有成交。${text ? text.slice(0, 80) : "先授权，再挂单。"}` : `It did not fill. ${text ? text.slice(0, 80) : "Approve, then place."}`);
    }).finally(() => setBusy(false));
  };

  const takeLevel = (level: Level, bookBid: boolean) => {
    if (!bookBid && dustAsk) { setBad(true); setNote(market === 0 ? (zh ? "这一档吃不过去。卖一最前是灰单，买单会整笔失败。要买去现货。" : "This level cannot be taken. The best ask is dust, so a buy reverts. Use Spot to buy.") : (zh ? `卖一最前面是灰单 #${dustAsk.id}。买单会整笔失败。` : `The best ask starts with dust order #${dustAsk.id}. The buy reverts.`)); return; }
    if (bookBid && dustBid) { setBad(true); setNote(zh ? `买一最前面是灰单 #${dustBid.id}。卖出吃单会被整笔拒绝。` : `The best bid starts with dust order #${dustBid.id}. A sell that takes it reverts.`); return; }
    const key = `${bookBid ? "b" : "a"}-${level.price}`;
    const typed = (takes[key] ?? "").trim() || plainBase(market, level.size);
    let qty = 0n;
    try { qty = spotBase(market, typed); } catch { setBad(true); setNote(zh ? "数量不对。NAND 和 LATCH 只收整数。" : "The amount is not valid. NAND and LATCH are whole numbers."); return; }
    if (qty <= 0n || qty > level.size) { setBad(true); setNote(zh ? `不能超过这一档的 ${plainBase(market, level.size)}。` : `It cannot be more than this level, ${plainBase(market, level.size)}.`); return; }
    const mine = orders.some((row) => row.market === market && row.bid === bookBid && (bookBid ? row.price >= level.price : row.price <= level.price));
    if (mine) { setBad(true); setNote(zh ? "这一档或更优的价格上有你自己的单。合约会整笔拒绝。先撤掉。" : "You have an order at this price or a better one. The contract rejects the whole trade. Cancel it first."); return; }
    const paying = quoteUnit === "okb" ? (zh ? "用 OKB。钱包先签兑换，再签订单簿。" : "Paying in OKB. The wallet signs the swap, then the book.") : undefined;
    run(() => placeSpotPaid(account ?? "", market, !bookBid, level.price, qty, quoteUnit), zh ? "已按这一档提交。" : "Submitted at this level.", paying);
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
    const scale = market === 0 ? UNIT : 1n;
    const spendableOkb = purse.okb > 2_000_000_000_000_000n ? purse.okb - 2_000_000_000_000_000n : 0n;
    const budget = quoteUnit === "okb" ? (okbRate > 0n ? spendableOkb * okbRate / 10n ** 18n : 0n) : purse.usdt;
    const raw = px > 0n ? budget * scale / px : 0n;
    const cut = raw * BigInt(pct) / 100n;
    setAmount(market === 0 ? formatUnits(cut, 8) : cut.toString());
  };

  const submitOrder = () => {
    let px = 0n;
    let qty = 0n;
    try {
      px = typedUsdt(price, quoteUnit, okbRate);
      qty = spotBase(market, amount);
    } catch (err) {
      setBad(true);
      const text = err instanceof Error ? err.message : "";
      setNote(text === "amount" ? (zh ? "数量不对。NAND 和 LATCH 只收整数。" : "The amount is not valid. NAND and LATCH are whole numbers.") : (zh ? "价格不对。OKB 价还没读到时先用 USDT。" : "The price is not valid. Use USDT if the OKB price is not in yet."));
      return;
    }
    const paying = quoteUnit === "okb" ? (zh ? "用 OKB。钱包先签兑换，再签订单簿。" : "Paying in OKB. The wallet signs the swap, then the book.") : undefined;
    if (side === "buy" && dustAsk && px >= dustAsk.price) { setBad(true); setNote(market === 0 ? (zh ? `这个价格会碰到灰单。买单失败。挂在 ${showPrice(dustAsk.price)} 下面，或去现货买。` : `This price hits the dust order. The buy reverts. Rest below ${showPrice(dustAsk.price)}, or use Spot.`) : (zh ? `这个价格会碰到灰单 #${dustAsk.id}。买单整笔失败。` : `This price hits dust order #${dustAsk.id}. The buy reverts.`)); return; }
    if (side === "sell" && dustBid && px <= dustBid.price) { setBad(true); setNote(zh ? `这个价格会碰到灰单 #${dustBid.id}。卖单整笔失败。` : `This price hits dust order #${dustBid.id}. The sell reverts.`); return; }
    run(() => placeSpotPaid(account ?? "", market, side === "buy", px, qty, quoteUnit), zh ? "已进订单簿。没有对手的部分继续挂着。" : "It is on the book. Whatever did not meet another order stays there.", paying);
  };

  const openOrder = (next: "buy" | "sell") => {
    setSide(next);
    if (!price.trim()) {
      const px = next === "buy" ? bestAsk : bestBid;
      if (px > 0n) setPrice(showPrice(px));
    }
    setSheet(true);
  };

  const orderForm = (
    <>
      <div className="grid grid-cols-2 border border-gold">
        <button type="button" onClick={() => setSide("buy")} className={`min-h-11 text-sm ${side === "buy" ? "bg-[#089981] text-white" : "text-[#089981]"}`}>{zh ? "买入" : "Buy"}</button>
        <button type="button" onClick={() => setSide("sell")} className={`min-h-11 text-sm ${side === "sell" ? "bg-[#f23645] text-white" : "text-[#f23645]"}`}>{zh ? "卖出" : "Sell"}</button>
      </div>
      <label className="mt-3 grid gap-1 text-xs text-ink/55">
        <span className="flex items-center justify-between"><span>{zh ? `价格 ${unitName}` : `Price ${unitName}`}</span></span>
        <span className="relative block">
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="min-h-12 w-full border border-gold/50 bg-paper px-2 pr-[4.5rem] font-mono text-base text-ink" />
          <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-[#c47b7b]" onClick={() => {
            const px = side === "buy" ? bestAsk : bestBid;
            if (px > 0n) setPrice(showPrice(px));
          }}>{side === "buy" ? (zh ? "最优卖价" : "Best ask") : (zh ? "最优买价" : "Best bid")}</button>
        </span>
      </label>
      <label className="mt-2 grid gap-1 text-xs text-ink/55">
        {zh ? `数量 ${name}` : `Amount ${name}`}
        <span className="flex items-center justify-between gap-2">
          <span>{zh ? `钱包 ${purse ? (side === "sell" ? `${baseText(market, market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch)} ${name}` : quoteUnit === "okb" ? `${okbText(purse.okb)} OKB` : `${usdtText(purse.usdt, 2)} USDT`) : "—"}` : `Wallet ${purse ? (side === "sell" ? `${baseText(market, market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch)} ${name}` : quoteUnit === "okb" ? `${okbText(purse.okb)} OKB` : `${usdtText(purse.usdt, 2)} USDT`) : "—"}`}</span>
          <button type="button" onClick={() => fillPct(100)} className="text-[#089981]">{zh ? "全部" : "All"}</button>
        </span>
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
      </label>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {[25, 50, 75, 100].map((pct) => (
          <button key={pct} type="button" onClick={() => fillPct(pct)} className="min-h-9 border border-gold text-xs">{pct === 100 ? (zh ? "全部" : "All") : `${pct}%`}</button>
        ))}
      </div>
      <Quote zh={zh} market={market} side={side} price={price} amount={amount} unit={quoteUnit} rate={okbRate} />
      <Plan zh={zh} market={market} side={side} price={price} amount={amount} asks={asks} bids={bids} purse={purse} name={name} unit={quoteUnit} rate={okbRate} />
      {quoteUnit === "okb" ? <p className="mt-2 font-mono text-xs text-ink/55">{(() => { try { return `USDT ${usdtText(typedUsdt(price, "okb", okbRate), 4)}`; } catch { return "—"; } })()}</p> : null}
      {ownHit ? <p className="mt-2 text-sm text-sell">{zh ? "碰到自己的单。先撤掉。" : "That hits your own order. Cancel it first."}</p> : null}
      {dustAsk && market === 0 ? <p className="mt-2 text-sm leading-6 text-sell">{zh ? "这是挂单，不是现货。卖一最前有一笔灰单，吃单会失败，只有挂出的地址能撤。" : "This is the order book, not the spot pool. A dust order is first, so a crossing buy fails. Only that maker can cancel it."} <a className="underline" href="#tape">{zh ? "去现货" : "Open spot"}</a></p> : null}
      <button type="button" disabled={busy || Boolean(ownHit) || !amount.trim() || crossDust} className={`mt-3 min-h-12 w-full text-sm text-white disabled:opacity-40 ${side === "buy" ? "bg-[#089981]" : "bg-[#f23645]"}`} onClick={submitOrder}>
        {!amount.trim() ? (zh ? "输入数量" : "Enter an amount") : side === "buy" ? (zh ? `买入 ${name}` : `Buy ${name}`) : (zh ? `卖出 ${name}` : `Sell ${name}`)}
      </button>
      {note ? <p className={`mt-2 text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      <p className="mt-2 text-right text-[11px] text-ink/45" title={quoteUnit === "okb" ? (zh ? "OKB 先换成这本订单簿的 USDT。买单没吃完的，撤单时换回 OKB。卖出当场收到的换成 OKB。挂着等别人来吃的卖单，之后进钱包的是 USDT。" : "OKB is swapped into the book's USDT. A resting bid returns as OKB on cancel. A sell that fills now comes back as OKB. A resting ask pays USDT when someone else takes it.") : (zh ? "限价。点盘口一行，数量不能超过这一档。卖方实收 99.8%。" : "Limit only. A row take cannot pass that level. The seller receives 99.8%.")}>{quoteUnit === "okb" ? (zh ? "用 OKB。挂着的卖单，之后进账是 USDT。" : "OKB. A resting ask pays USDT later.") : (zh ? "限价。卖方实收 99.8%。" : "Limit. The seller receives 99.8%.")}</p>
    </>
  );

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
    <section className="flex flex-col lg:h-full lg:min-h-0 lg:flex-1">
      {lane === "circuit" ? <TapeCircuits zh={zh} /> : lane === "cap" ? <ContainerDesk zh={zh} /> : (
        <>
        <div className="flex flex-col gap-2 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_20.5rem] lg:items-stretch lg:gap-3 lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col lg:h-full lg:min-h-0 lg:overflow-hidden lg:border lg:border-gold lg:bg-card">
          <article ref={bookBox} className="flex h-[clamp(12rem,calc(100dvh-30rem),22rem)] flex-col overflow-hidden border border-gold bg-card lg:h-auto lg:max-h-none lg:min-h-0 lg:flex-1 lg:border-0">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gold/40 px-3 py-1.5 lg:hidden">
              <div className="min-w-0">
                <p className="truncate text-[11px] tracking-[0.14em] text-gold">{pairTitle}{market === 0 ? "" : ` / ${unitName}`}{spot ? <> · <a className="underline" href={`${XLAYER.explorer}/address/${spot}`} target="_blank" rel="noreferrer">{spot.slice(0, 6)}…{spot.slice(-4)}</a></> : null}</p>
                <div className="mt-0.5 flex items-center gap-2">
                  {poolRaw > 0n ? <span className="text-[10px] tracking-widest text-ink/45">{zh ? "现货" : "Spot"}</span> : null}
                  <h3 className="font-mono text-[1.65rem] leading-none tabular-nums">{headPx > 0n ? moneyText(headPx, quoteUnit, okbRate, poolRaw > 0n ? 4 : 2) : "—"}</h3>
                  <div className="flex gap-1">
                    {(["usdt", "okb"] as const).map((next) => (
                      <button key={next} type="button" className={`min-h-7 px-2 text-[11px] ${quoteUnit === next ? "bg-ink text-paper" : "border border-gold text-ink/70"}`} onClick={() => {
                        if (next === unit) return;
                        try { if (price.trim()) setPrice(showPrice(typedUsdt(price, quoteUnit, okbRate), next)); } catch { /* keep the typed price */ }
                        setUnit(next);
                      }}>{next === "okb" ? "OKB" : "USDT"}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-x-3 text-right text-[11px] text-ink/60">
                <p>{zh ? "买一" : "Bid"}<br /><span className="font-mono text-sm text-ink">{bestBid > 0n ? moneyText(bestBid, quoteUnit, okbRate) : "—"}</span></p>
                <p>{zh ? "卖一" : "Ask"}<br /><span className="font-mono text-sm text-ink">{bestAsk > 0n ? moneyText(bestAsk, quoteUnit, okbRate) : "—"}</span></p>
              </div>
            </div>
            <div className="hidden shrink-0 items-center gap-4 overflow-x-auto border-b border-gold/40 px-3 py-2 lg:flex">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{pairTitle}</p>
                <p className="truncate font-mono text-[11px] text-ink/45">{spot ? <a className="underline" href={`${XLAYER.explorer}/address/${spot}`} target="_blank" rel="noreferrer">{spot.slice(0, 6)}…{spot.slice(-4)}</a> : "—"}</p>
              </div>
              <div className="flex gap-1">
                {(["usdt", "okb"] as const).map((next) => (
                  <button key={next} type="button" className={`min-h-7 px-2 text-[11px] ${quoteUnit === next ? "bg-ink text-paper" : "border border-gold text-ink/70"}`} onClick={() => {
                    if (next === unit) return;
                    try { if (price.trim()) setPrice(showPrice(typedUsdt(price, quoteUnit, okbRate), next)); } catch { /* keep */ }
                    setUnit(next);
                  }}>{next === "okb" ? "OKB" : "USDT"}</button>
                ))}
              </div>
              <div className="ml-auto flex items-end gap-4 text-right">
                {([
                  [market === 0 ? (zh ? "现货" : "Spot") : (zh ? "参考价" : "Ref"), headPx > 0n ? moneyText(headPx, quoteUnit, okbRate, poolRaw > 0n ? 4 : 2) : "—"],
                  [zh ? "买一" : "Bid", bestBid > 0n ? moneyText(bestBid, quoteUnit, okbRate) : "—"],
                  [zh ? "卖一" : "Ask", bestAsk > 0n ? moneyText(bestAsk, quoteUnit, okbRate) : "—"],
                  [zh ? "价差" : "Spread", spread > 0n ? moneyText(spread, quoteUnit, okbRate) : "—"],
                  [zh ? "卖盘" : "Asks", baseText(market, askBook.base)],
                  [zh ? "买盘" : "Bids", baseText(market, bidBook.base)],
                  [zh ? "成交" : "Prints", reading && traded.n === 0 ? "—" : String(traded.n)],
                  [zh ? "手续费" : "Fees", reading && traded.n === 0 ? "—" : moneyText(traded.fee, quoteUnit, okbRate)],
                ] as const).map(([k, v]) => (
                  <p key={k} className="min-w-[3.2rem] shrink-0">
                    <span className="block text-[10px] tracking-wide text-ink/40">{k}</span>
                    <span className="font-mono text-sm text-ink">{v}</span>
                  </p>
                ))}
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
            <p className="flex shrink-0 items-center justify-center border-y border-gold/30 px-3 py-1 font-mono text-sm font-semibold text-[#089981] lg:py-1.5">
              {bestAsk > 0n ? moneyText(bestAsk, quoteUnit, okbRate) : bestBid > 0n ? moneyText(bestBid, quoteUnit, okbRate) : "—"} {unitName}
            </p>
            <div ref={bidBox} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {bids.length === 0 ? <p className="px-3 py-2 text-xs text-ink/55">{zh ? "买盘空着。" : "No bids."}</p> : bids.map((level) => {
                      const key = `b-${level.price}`;
                      return <BookRow key={key} zh={zh} bid mine={orders.some((row) => row.market === market && row.bid && row.price === level.price)} on={picked === key} busy={busy} depth={maxBid > 0n ? Number((level.size * 100n) / maxBid) : 0} priceLabel={moneyText(level.price, quoteUnit, okbRate)} sizeLabel={baseText(market, level.size)} totalLabel={`${moneyText(cost(market, level.size, level.price), quoteUnit, okbRate)} ${unitName}`} cap={plainBase(market, level.size)} value={takes[key] ?? ""} onChange={(value) => setTakes((cur) => ({ ...cur, [key]: value }))} onPick={() => pickLevel(level, true)} onTake={() => takeLevel(level, true)} />;
                    })}
            </div>
            {miss ? <p className="shrink-0 px-2 py-2 text-xs text-ink/55">{zh ? "这一次没读到。不写成 0。" : "This read missed. It is not shown as zero."}</p> : null}
          </article>
          <article className="mt-2 flex flex-col border border-gold bg-card lg:mt-0 lg:h-[34%] lg:max-h-none lg:min-h-36 lg:flex-none lg:overflow-hidden lg:border-0 lg:border-t lg:border-gold/50">
            <div className="flex shrink-0 gap-5 border-b border-gold/40 px-3">
              <button type="button" onClick={() => setTab("tape")} className={`min-h-10 text-sm ${tab === "tape" ? "border-b-2 border-ink font-medium" : "text-ink/45"}`}>{zh ? "活动" : "Prints"}</button>
              <button type="button" onClick={() => setTab("mine")} className={`min-h-10 text-sm ${tab === "mine" ? "border-b-2 border-ink font-medium" : "text-ink/45"}`}>{zh ? "我的挂单" : "My orders"}</button>
            </div>
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {tab === "tape" ? (
              <table className="w-full table-fixed border-collapse font-mono text-[12px] tabular-nums">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[20%]" />
                  <col className="w-[18%]" />
                  <col className="w-[20%]" />
                  <col className="w-[28%]" />
                </colgroup>
                <thead>
                  <tr className="text-[11px] text-ink/40">
                    <th className="px-2 py-1.5 text-left font-normal">{zh ? "买卖" : "Side"}</th>
                    <th className="px-1 py-1.5 text-right font-normal">{zh ? "价格" : "Price"}</th>
                    <th className="px-1 py-1.5 text-right font-normal">{zh ? "数量" : "Size"}</th>
                    <th className="px-1 py-1.5 text-right font-normal">{zh ? "总额" : "Total"}</th>
                    <th className="px-2 py-1.5 text-right font-normal">{zh ? "时间" : "Time"}</th>
                  </tr>
                </thead>
                <tbody>
                {prints.length === 0 ? <tr><td colSpan={5} className="px-3 py-6 text-left font-sans text-sm text-ink/55">{reading ? (zh ? "正在读成交。节点一次只给一小段，不会把没读到写成 0。" : "Reading prints. A miss is not written as zero.") : (zh ? "这段还没有成交。" : "No prints in this stretch.")}</td></tr> : null}
                {prints.slice(0, 80).map((row) => {
                  const ts = blockStamp(row.block);
                  const who = row.taker || "";
                  const short = who.length > 8 ? `${who.slice(0, 4)}…${who.slice(-4)}` : "—";
                  const buy = row.side === "buy";
                  const sell = row.side === "sell";
                  const tone = buy ? "text-[#089981]" : sell ? "text-[#f23645]" : "text-ink/35";
                  return (
                  <tr key={`${row.tx}-${row.base}-${row.quote}`} className="border-t border-gold/30">
                    <td className={`px-2 py-1.5 text-left ${tone}`}>{buy ? (zh ? "买" : "Buy") : sell ? (zh ? "卖" : "Sell") : "·"}</td>
                    <td className={`px-1 py-1.5 text-right ${tone}`}>{moneyText(row.price, quoteUnit, okbRate)}</td>
                    <td className="px-1 py-1.5 text-right">{baseText(market, row.base)}</td>
                    <td className="px-1 py-1.5 text-right">{moneyText(row.quote, quoteUnit, okbRate)}</td>
                    <td className="px-2 py-1 text-right leading-tight text-ink/55">
                      <span className="block">{clock >= 0 ? ago(ts) : "—"}</span>
                      {who ? <a className="block truncate text-[10px] underline" href={`${XLAYER.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{short}</a> : null}
                    </td>
                  </tr>
                  );
                })}
                {prints.length > 80 ? <tr><td colSpan={5} className="px-3 py-2 text-[11px] text-ink/40">+{prints.length - 80}</td></tr> : null}
                {older && prints.length > 0 ? <tr><td colSpan={5} className="px-3 py-2 text-left font-sans text-[11px] text-ink/40">{zh ? "更早的成交还在往前读。" : "Older prints are still being read."}</td></tr> : null}
                </tbody>
              </table>
            ) : (
              <ul>
                {orders.length === 0 ? <li className="px-3 py-3 text-sm text-ink/45">{zh ? "没有挂单" : "None"}</li> : null}
                {orders.map((row) => (
                  <li key={row.id.toString()} className="grid grid-cols-[4.6rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 border-t border-gold/30 px-3 py-2 text-xs">
                    <span className={row.bid ? "text-[#089981]" : "text-[#f23645]"}>{row.bid ? (zh ? "买" : "Bid") : (zh ? "卖" : "Ask")}{row.bid && isOkbBid(row.id) ? " ·OKB" : ""}</span>
                    <span className="text-right font-mono tabular-nums">{moneyText(row.price, quoteUnit, okbRate)}</span>
                    <span className="text-right font-mono tabular-nums">{baseText(row.market, row.left)}</span>
                    <button type="button" disabled={busy} className="min-h-9 border border-gold px-2 disabled:opacity-40" onClick={() => run(() => cancelSpotPaid(account ?? "", row.id), row.bid && isOkbBid(row.id) ? (zh ? "已撤单。锁着的换成 OKB 退回。" : "Cancelled. The locked amount swaps back to OKB.") : (zh ? "已撤单。没吃掉的退回钱包。" : "Cancelled. The rest is back in the wallet."), row.bid && isOkbBid(row.id) ? (zh ? "撤单后把锁着的 USDT 换回 OKB。" : "After the cancel, the locked USDT swaps back to OKB.") : undefined)}>{zh ? "撤单" : "Cancel"}</button>
                  </li>
                ))}
              </ul>
            )}
            </div>
          </article>
          </div>
          <div className="hidden overflow-y-auto border border-gold bg-card p-3 lg:block lg:h-full">
            {orderForm}
          </div>
        </div>
        <div className="fixed inset-x-0 bottom-[3.75rem] z-30 grid grid-cols-2 gap-2 border-t border-gold/40 bg-paper px-3 py-2 lg:hidden">
          <button type="button" className="min-h-12 bg-[#089981] text-sm text-white" onClick={() => openOrder("buy")}>{zh ? "买入" : "Buy"}</button>
          <button type="button" className="min-h-12 bg-[#f23645] text-sm text-white" onClick={() => openOrder("sell")}>{zh ? "卖出" : "Sell"}</button>
        </div>
        {sheet ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" aria-label={zh ? "关闭" : "Close"} className="absolute inset-0 bg-ink/40" onClick={() => setSheet(false)} />
            <div className="absolute inset-x-0 bottom-0 max-h-[min(36rem,88dvh)] overflow-y-auto rounded-t-2xl border border-gold bg-paper px-3 pb-4 pt-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm">{zh ? `交易 ${name}` : `Trade ${name}`}</p>
                <button type="button" className="min-h-9 px-2 text-lg leading-none" onClick={() => setSheet(false)}>×</button>
              </div>
              {orderForm}
            </div>
          </div>
        ) : null}
        </>
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
