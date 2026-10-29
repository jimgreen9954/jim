import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SideRail } from "@/components/exchange/side-rail";
import { formatUnits } from "viem";
import { XLAYER } from "@/lib/xlayer";
import { quoteOkb } from "@/lib/okb";
import { rememberFill, TradeLog } from "@/components/exchange/trade-foot";
import { Hint } from "@/components/exchange/hint";
import { TapeCircuits } from "@/components/exchange/tape-circuits";
import { ContainerDesk } from "@/components/exchange/capacitor-desk";
import { currentAccount, onAccount } from "@/lib/wallet";
import {
  baseText,
  cancelSpot,
  deploySpot,
  placeSpot,
  readMyOrders,
  readSpotBook,
  peekSpotPrints,
  readSpotPurse,
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
  return (raw * rate) / 1_000_000n;
}

function moneyText(usdt: bigint, unit: MoneyUnit, rate: bigint): string {
  if (unit !== "okb" || rate <= 0n) return usdtText(usdt, 2);
  const okb = (usdt * 1_000_000n) / rate;
  const short = usdtText(okb, 2);
  return short === "0" && okb > 0n ? usdtText(okb, 4) : short;
}

function cost(market: number, size: bigint, price: bigint): bigint {
  return market === 0 ? (size * price) / UNIT : size * price;
}

function sumSide(rows: Level[], market: number) {
  return rows.reduce(
    (sum, row) => ({
      base: sum.base + row.size,
      quote: sum.quote + cost(market, row.size, row.price),
      lots: sum.lots + row.lots,
    }),
    { base: 0n, quote: 0n, lots: 0 },
  );
}

function Stat({ k, v, s }: { k: ReactNode; v: string; s: string }) {
  return (
    <p className="border-gold/30 px-2 py-2 sm:border-l sm:first:border-l-0">
      <span className="block text-[10px] text-ink/45">{k}</span>
      <span className="font-mono">{v}</span>
      <span className="mt-0.5 block text-[10px] text-ink/45">{s}</span>
    </p>
  );
}

function Plan({
  zh,
  market,
  side,
  price,
  amount,
  asks,
  bids,
  purse,
  name,
  unit,
  rate,
}: {
  zh: boolean;
  market: SpotMarket;
  side: "buy" | "sell";
  price: string;
  amount: string;
  asks: Level[];
  bids: Level[];
  purse: SpotPurse | null;
  name: string;
  unit: MoneyUnit;
  rate: bigint;
}) {
  let px = 0n;
  let qty = 0n;
  try {
    px = typedUsdt(price, unit, rate);
    qty = amount.trim() ? spotBase(market, amount) : 0n;
  } catch {
    return null;
  }
  const scale = market === 0 ? UNIT : 1n;
  const walletBuy = purse && px > 0n ? (purse.usdt * scale) / px : 0n;
  const walletSell = purse
    ? market === 0
      ? purse.tape
      : market === 1
        ? purse.nand
        : purse.latch
    : 0n;
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
      <p className="bg-card px-2 py-2">
        <span className="block text-[10px] text-ink/45">
          {zh ? "这一价钱包最多买" : "Wallet can buy here"}
        </span>
        <span className="font-mono">{purse ? `${baseText(market, walletBuy)} ${name}` : "—"}</span>
      </p>
      <p className="bg-card px-2 py-2">
        <span className="block text-[10px] text-ink/45">
          {zh ? "钱包最多卖" : "Wallet can sell"}
        </span>
        <span className="font-mono">{purse ? `${baseText(market, walletSell)} ${name}` : "—"}</span>
      </p>
      <p className="bg-card px-2 py-2">
        <span className="block text-[10px] text-ink/45">
          {zh ? "这一笔能吃到" : "This order takes"}
        </span>
        <span className="font-mono">
          {qty > 0n ? `${baseText(market, filled)} · ${moneyText(pay, unit, rate)}` : "—"}
        </span>
      </p>
      <p className="bg-card px-2 py-2">
        <span className="block text-[10px] text-ink/45">
          {zh ? "吃完剩下挂出" : "Rest after the take"}
        </span>
        <span className="font-mono">{qty > 0n ? baseText(market, left) : "—"}</span>
      </p>
    </div>
  );
}

function Quote({
  zh,
  market,
  side,
  price,
  amount,
  unit,
  rate,
}: {
  zh: boolean;
  market: SpotMarket;
  side: "buy" | "sell";
  price: string;
  amount: string;
  unit: MoneyUnit;
  rate: bigint;
}) {
  let pay = 0n;
  let fee = 0n;
  try {
    const px = typedUsdt(price, unit, rate);
    const qty = spotBase(market, amount);
    pay = cost(market, qty, px);
    fee = (pay * 20n) / 10000n;
  } catch {
    return (
      <p className="mt-2 text-xs text-ink/45">
        {zh
          ? "先填价格。比例按钮按这个价格，从钱包里切。"
          : "Enter a price first. The percent buttons cut the wallet at that price."}
      </p>
    );
  }
  if (pay === 0n || fee === 0n)
    return (
      <p className="mt-2 text-xs text-sell">
        {zh
          ? "这一笔太小，手续费舍成 0，合约不会收。"
          : "This order is too small. The fee rounds to zero and the contract will not take it."}
      </p>
    );
  const label = unit === "okb" ? "OKB" : "USDT0";
  return (
    <div className="mt-2 grid grid-cols-3 border border-gold/40 text-center">
      <p className="px-1 py-2">
        <span className="block text-[10px] text-ink/45">
          {side === "buy" ? (zh ? "你支付" : "You pay") : zh ? "买方支付" : "Buyer pays"}
        </span>
        <span className="font-mono text-sm">
          {moneyText(pay, unit, rate)} {label}
        </span>
      </p>
      <p className="border-x border-gold/40 px-1 py-2">
        <span className="block text-[10px] text-ink/45">{zh ? "千分之二" : "0.20%"}</span>
        <span className="font-mono text-sm">{moneyText(fee, unit, rate)}</span>
      </p>
      <p className="px-1 py-2">
        <span className="block text-[10px] text-ink/45">
          {side === "sell" ? (zh ? "你实收" : "You receive") : zh ? "卖方实收" : "Seller receives"}
        </span>
        <span className="font-mono text-sm">{moneyText(pay - fee, unit, rate)}</span>
      </p>
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

function BookRow({
  priceLabel,
  sizeLabel,
  totalLabel,
  cap,
  value,
  onChange,
  onPick,
  onTake,
  bid,
  best,
  mine,
  on,
  busy,
  depth,
  zh,
}: {
  priceLabel: string;
  sizeLabel: string;
  totalLabel: string;
  cap: string;
  value: string;
  onChange: (value: string) => void;
  onPick: () => void;
  onTake: () => void;
  bid: boolean;
  best: boolean;
  mine: boolean;
  on: boolean;
  busy: boolean;
  depth: number;
  zh: boolean;
}) {
  const typed = value.trim().length > 0;
  return (
    <form
      className={`relative grid min-h-[30px] grid-cols-[3.2rem_minmax(0,1fr)_auto] items-center gap-1 px-1.5 text-[12px] tabular-nums sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto] sm:px-2 ${on ? "bg-ink/5" : best ? (bid ? "bg-up/10" : "bg-sell/10") : ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        onTake();
      }}
    >
      <span
        className={`pointer-events-none absolute inset-y-1 left-[11%] max-w-[31%] ${bid ? "bg-up/20" : "bg-sell/20"}`}
        style={{ width: `${Math.max(depth, 4)}%` }}
      />
      <button
        type="button"
        onClick={onPick}
        className={`relative truncate text-left font-mono font-semibold ${bid ? "text-up" : "text-sell"}`}
      >
        {priceLabel}
        {mine ? (
          <span className="ml-1 text-[10px] font-normal text-ink/45">{zh ? "我的" : "mine"}</span>
        ) : null}
      </button>
      <span className="relative truncate text-right font-mono text-ink/80 sm:text-left">
        {sizeLabel}
      </span>
      <span className="relative hidden truncate font-mono text-ink/45 sm:block">{totalLabel}</span>
      <span className="relative grid grid-cols-[3.4rem_2.6rem] justify-end gap-1 sm:grid-cols-[4.6rem_3.4rem]">
        <input
          value={value}
          placeholder={`≤${cap}`}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value)}
          aria-label={zh ? `这一档最多 ${cap}` : `At most ${cap}`}
          className="h-6 w-full border border-ink/25 bg-paper px-1 text-right font-mono text-[11px] text-ink outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={busy || !typed}
          className={`h-6 border bg-transparent text-[11px] font-semibold disabled:opacity-40 ${bid ? "border-sell text-sell" : "border-up text-up"}`}
        >
          {bid ? (zh ? "卖出" : "Sell") : zh ? "买入" : "Buy"}
        </button>
      </span>
    </form>
  );
}

export function TapeSpotDesk({
  zh,
  lanes,
}: {
  zh: boolean;
  lanes?: readonly (SpotMarket | "circuit" | "cap")[];
}) {
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
  const [reading, setReading] = useState(false);
  const [readMin, setReadMin] = useState(0);
  const [tab, setTab] = useState<"tape" | "mine">("tape");
  const [miss, setMiss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [takes, setTakes] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const askBox = useRef<HTMLDivElement>(null);
  const market: SpotMarket = lane === "circuit" || lane === "cap" ? 0 : lane;

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => setSpot(spotAddress()), []);
  useEffect(() => {
    if (!spot) return;
    let dead = false;
    const look = () => {
      spotReady()
        .then((ok) => {
          if (!dead && !ok) setReady(false);
        })
        .catch(() => undefined);
    };
    look();
    const id = window.setInterval(look, 8000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
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
      setReadMin(snap.minutes);
    };
    look();
    const id = window.setInterval(look, 2000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [spot, ready, market, lane]);

  useEffect(() => {
    if (!spot || !ready || lane === "circuit" || lane === "cap") return;
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      readSpotBook(market)
        .then((book) => {
          if (dead) return;
          setMiss(false);
          setBids(book?.bids ?? []);
          setAsks(book?.asks ?? []);
        })
        .catch(() => {
          window.setTimeout(() => {
            if (dead) return;
            readSpotBook(market)
              .then((book) => {
                if (dead) return;
                setMiss(false);
                setBids(book?.bids ?? []);
                setAsks(book?.asks ?? []);
              })
              .catch(() => {
                if (!dead) {
                  setMiss(true);
                  setBids([]);
                  setAsks([]);
                }
              });
          }, 1200);
        });
      readSpotPurse(account)
        .then((held) => {
          if (!dead) setPurse(held);
        })
        .catch(() => undefined);
      if (account)
        readMyOrders(account)
          .then((mine) => {
            if (!dead) setOrders(mine.filter((row) => row.market === market && row.left > 0n));
          })
          .catch(() => undefined);
      quoteOkb("sell", 10n ** 18n)
        .then((rate) => {
          if (!dead && rate > 0n) setOkbRate(rate);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    const onShow = () => {
      if (!document.hidden) pull();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [spot, ready, market, account, lane]);

  const askBook = useMemo(() => sumSide(asks, market), [asks, market]);
  const bidBook = useMemo(() => sumSide(bids, market), [bids, market]);
  const traded = useMemo(
    () =>
      prints.reduce(
        (sum, row) => ({
          n: sum.n + 1,
          base: sum.base + row.base,
          quote: sum.quote + row.quote,
          fee: sum.fee + row.fee,
        }),
        { n: 0, base: 0n, quote: 0n, fee: 0n },
      ),
    [prints],
  );
  const askView = useMemo(() => [...asks].reverse(), [asks]);
  const maxAsk = asks.reduce((m, row) => (row.size > m ? row.size : m), 0n);
  const maxBid = bids.reduce((m, row) => (row.size > m ? row.size : m), 0n);
  const bestAsk = asks[0]?.price ?? 0n;
  const bestBid = bids[0]?.price ?? 0n;
  const spread = bestAsk > bestBid && bestBid > 0n ? bestAsk - bestBid : 0n;
  const name = NAMES[market];
  const quoteUnit: MoneyUnit = unit;
  const unitName = quoteUnit === "okb" ? "OKB" : "USDT0";
  useEffect(() => {
    const node = askBox.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [askView, market]);
  const showPrice = (usdt: bigint, next: MoneyUnit = quoteUnit) => {
    const raw = next === "okb" && okbRate > 0n ? (usdt * 1_000_000n) / okbRate : usdt;
    const text = formatUnits(raw, 6);
    const [whole, frac = ""] = text.split(".");
    const cap = Number(whole) >= 1 ? 2 : 4;
    const cut = frac.slice(0, cap).replace(/0+$/, "");
    return cut ? `${whole}.${cut}` : whole;
  };
  const ownHit = (() => {
    let px = 0n;
    try {
      px = price.trim() ? typedUsdt(price, market === 0 ? "usdt" : unit, okbRate) : 0n;
    } catch {
      return null;
    }
    return (
      orders.find(
        (row) =>
          row.market === market &&
          row.left > 0n &&
          (side === "sell"
            ? row.bid && px > 0n && px <= row.price
            : !row.bid && px > 0n && px >= row.price),
      ) ?? null
    );
  })();

  const run = (task: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setBad(false);
    setNote(
      zh
        ? "正在连接 X Layer 钱包。请在钱包中确认。"
        : "Connecting the X Layer wallet. Confirm the request there.",
    );
    task()
      .then((result) => {
        if (typeof result === "string" && /^0x[a-fA-F0-9]{40}$/.test(result)) {
          setSpot(result);
          setReady(true);
        } else setSpot(spotAddress());
        setBad(false);
        setNote(ok);
        rememberFill(ok);
      })
      .catch((err: unknown) => {
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
        if ((err as { code?: number }).code === 4001)
          setNote(zh ? "签名取消了。币还在钱包。" : "Cancelled. The coins stayed in the wallet.");
        else if (text === "onlyfee")
          setNote(zh ? "只有收费地址能签这一次。" : "Only the fee address can sign this.");
        else if (text === "nonce")
          setNote(
            zh
              ? "收费地址在这之前又发过别的交易，地址对不上。把新地址发过来，我改页面。"
              : "The fee address sent another transaction first, so the address no longer matches. Send the new one and the page will be updated.",
          );
        else if (text === "amount" || text === "price")
          setNote(
            zh
              ? "价格和数量都要填。NAND 和 LATCH 只收整数。"
              : "Enter a price and an amount. NAND and LATCH are whole numbers.",
          );
        else if (/self/i.test(text))
          setNote(
            zh
              ? "会碰到你自己的挂单。合约整笔拒绝，不会先成交别人的。先在下面撤掉自己的单，或把价格放在碰不到的一侧。"
              : "This would trade against your own order. The contract rejects the whole thing. Cancel yours below, or use a price that does not reach it.",
          );
        else if (/token/i.test(text))
          setNote(
            zh
              ? "币没划过来。看余额够不够，以及上一笔授权有没有成功。"
              : "The token did not move. Check the balance, and that the approval before this one succeeded.",
          );
        else if (text === "chain")
          setNote(
            zh
              ? "钱包还停在别的链。切到 X Layer 再签。"
              : "The wallet is on another chain. Switch to X Layer, then sign.",
          );
        else if (text === "address") setNote(zh ? "地址格式不对。" : "That address is not valid.");
        else if (text === "empty")
          setNote(zh ? "这个地址上没有合约。" : "There is no contract at that address.");
        else if (text === "fee")
          setNote(
            zh
              ? "这一笔太小，千分之二舍成 0。合约不收这种单。"
              : "This order is too small. The 0.2 percent rounds to zero.",
          );
        else if (/nowallet/i.test(text))
          setNote(zh ? "没有检测到 X Layer 钱包。" : "No X Layer wallet was found.");
        else
          setNote(
            zh
              ? `没有成交。${text ? text.slice(0, 80) : "先授权，再挂单。"}`
              : `It did not fill. ${text ? text.slice(0, 80) : "Approve, then place."}`,
          );
      })
      .finally(() => setBusy(false));
  };

  const takeLevel = (level: Level, bookBid: boolean) => {
    const key = `${bookBid ? "b" : "a"}-${level.price}`;
    const typed = (takes[key] ?? "").trim();
    if (!typed) {
      setBad(true);
      setNote(
        zh
          ? "先在这一档右边填数量。点左边的价格，会把这一档填进下单栏。"
          : "Type a size on this row. The price on the left fills the ticket.",
      );
      return;
    }
    let qty = 0n;
    try {
      qty = spotBase(market, typed);
    } catch {
      setBad(true);
      setNote(
        zh
          ? "数量不对。NAND 和 LATCH 只收整数。"
          : "The amount is not valid. NAND and LATCH are whole numbers.",
      );
      return;
    }
    if (qty <= 0n || qty > level.size) {
      setBad(true);
      setNote(
        zh
          ? `不能超过这一档的 ${plainBase(market, level.size)}。`
          : `It cannot be more than this level, ${plainBase(market, level.size)}.`,
      );
      return;
    }
    const mine = orders.some(
      (row) =>
        row.market === market &&
        row.bid === bookBid &&
        (bookBid ? row.price >= level.price : row.price <= level.price),
    );
    if (mine) {
      setBad(true);
      setNote(
        zh
          ? "这一档或更优的价格上有你自己的单。合约会整笔拒绝。先撤掉。"
          : "You have an order at this price or a better one. The contract rejects the whole trade. Cancel it first.",
      );
      return;
    }
    run(
      () => placeSpot(account ?? "", market, !bookBid, level.price, qty),
      zh
        ? "已按这一档提交。数量不超过这一档，多出来的不会再挂成新单。"
        : "Submitted at this level. The amount does not exceed it, so nothing extra is left on the book.",
    );
  };

  const pickLevel = (level: Level, bookBid: boolean) => {
    const key = `${bookBid ? "b" : "a"}-${level.price}`;
    setPicked(key);
    setSide(bookBid ? "sell" : "buy");
    setPrice(showPrice(level.price));
    setAmount(plainBase(market, level.size));
    setTicketOpen(true);
  };

  const fillPct = (pct: number) => {
    if (!purse) return;
    let px = 0n;
    try {
      px = typedUsdt(price, quoteUnit, okbRate);
    } catch {
      return;
    }
    if (side === "sell") {
      const bal = market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch;
      const cut = (bal * BigInt(pct)) / 100n;
      setAmount(market === 0 ? formatUnits(cut, 8) : cut.toString());
      return;
    }
    const unit = market === 0 ? UNIT : 1n;
    const raw = (purse.usdt * unit) / px;
    const cut = (raw * BigInt(pct)) / 100n;
    setAmount(market === 0 ? formatUnits(cut, 8) : cut.toString());
  };

  if (!ready) {
    return (
      <article className="border border-gold bg-card px-3 py-4">
        <p className="text-[11px] tracking-[0.22em] text-gold">{zh ? "现货" : "Spot"}</p>
        <h3 className="mt-1 font-display text-2xl italic sm:text-3xl">
          {zh ? "订单簿还差一次签名" : "The book needs one signature"}
        </h3>
        <p className="mt-2 text-sm leading-6">
          {zh
            ? "地址已经写在页面上。用收费地址签下面这一次，不要先做别的转账。签完之后，每台设备都能看到盘口。"
            : "The address is already on the page. Sign this once from the fee address, and do not send another transfer first. After that, every device sees the book."}
        </p>
        <p className="mt-2 break-all font-mono text-xs">{spot}</p>
        <button
          type="button"
          disabled={busy}
          className="mt-3 min-h-12 w-full bg-ink px-4 text-sm text-paper disabled:opacity-40"
          onClick={() =>
            run(() => deploySpot(account ?? ""), zh ? "订单簿已上线。" : "The book is live.")
          }
        >
          {busy
            ? zh
              ? "等待钱包确认"
              : "Waiting for the wallet"
            : zh
              ? "部署订单簿"
              : "Deploy the book"}
        </button>
        {note ? <p className={`mt-2 text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </article>
    );
  }

  return (
    <SideRail
      items={choices.map((id) => ({
        key: String(id),
        label:
          id === "circuit"
            ? zh
              ? "TAPELIQUID 电路"
              : "TAPELIQUID circuits"
            : id === "cap"
              ? zh
                ? "TapeOut 容器"
                : "TapeOut container"
              : `TAPELIQUID ${NAMES[id]}`,
        on: lane === id,
        run: () => setLane(id),
      }))}
    >
      <section className="grid gap-3">
        {lane === "circuit" ? (
          <TapeCircuits zh={zh} />
        ) : lane === "cap" ? (
          <ContainerDesk zh={zh} />
        ) : (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-3">
            <div className="min-w-0 pb-24 lg:pb-0">
              <article className="border border-gold bg-card">
                <div className="flex items-end justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[11px] tracking-[0.18em] text-gold">
                      {name} / {unitName}
                    </p>
                    <h3 className="font-mono text-[1.75rem] leading-none tabular-nums">
                      {bestAsk > 0n
                        ? moneyText(bestAsk, quoteUnit, okbRate)
                        : bestBid > 0n
                          ? moneyText(bestBid, quoteUnit, okbRate)
                          : "—"}
                    </h3>
                    <div className="mt-2 flex gap-1">
                      {(["usdt", "okb"] as const).map((next) => (
                        <button
                          key={next}
                          type="button"
                          className={`min-h-7 px-2 text-[11px] ${quoteUnit === next ? "bg-ink text-paper" : "border border-gold text-ink/70"}`}
                          onClick={() => {
                            if (next === unit) return;
                            try {
                              if (price.trim())
                                setPrice(showPrice(typedUsdt(price, quoteUnit, okbRate), next));
                            } catch {
                              /* keep the typed price */
                            }
                            setUnit(next);
                          }}
                        >
                          {next === "okb" ? "OKB" : "USDT0"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-right text-xs leading-5 text-ink/60">
                    {zh ? "买一" : "Bid"}{" "}
                    {bestBid > 0n ? moneyText(bestBid, quoteUnit, okbRate) : "—"}
                    <br />
                    {zh ? "卖一" : "Ask"}{" "}
                    {bestAsk > 0n ? moneyText(bestAsk, quoteUnit, okbRate) : "—"}
                    <br />
                    <Hint
                      label={zh ? "价差" : "Spread"}
                      text={
                        zh
                          ? "卖一减去买一。价差越小，买卖两边越靠近。"
                          : "Best ask minus best bid. A smaller spread means the two sides are closer."
                      }
                    />{" "}
                    {spread > 0n ? moneyText(spread, quoteUnit, okbRate) : "—"}
                  </p>
                </div>
                <div className="grid grid-cols-[3.2rem_minmax(0,1fr)_auto] items-center px-1.5 py-1 text-[11px] text-ink/45 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto] sm:px-2">
                  <span>{zh ? "价格" : "Price"}</span>
                  <span className="text-right sm:text-left">{zh ? "数量" : "Size"}</span>
                  <span className="hidden sm:block">{zh ? "总额" : "Total"}</span>
                  <span className="text-right">{zh ? "指定成交" : "Take"}</span>
                </div>
                <div
                  ref={askBox}
                  className="max-h-[min(16rem,32vh)] overflow-y-auto border-t border-gold/30"
                >
                  {askView.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-ink/55">
                      {zh ? "卖盘空着。" : "No asks."}
                    </p>
                  ) : (
                    askView.map((level, index) => {
                      const key = `a-${level.price}`;
                      return (
                        <BookRow
                          key={key}
                          zh={zh}
                          bid={false}
                          best={index === askView.length - 1}
                          on={picked === key}
                          busy={busy}
                          mine={orders.some(
                            (row) => row.market === market && !row.bid && row.price === level.price,
                          )}
                          depth={maxAsk > 0n ? Number((level.size * 100n) / maxAsk) : 0}
                          priceLabel={moneyText(level.price, quoteUnit, okbRate)}
                          sizeLabel={baseText(market, level.size)}
                          totalLabel={moneyText(
                            cost(market, level.size, level.price),
                            quoteUnit,
                            okbRate,
                          )}
                          cap={plainBase(market, level.size)}
                          value={takes[key] ?? ""}
                          onChange={(value) => setTakes((cur) => ({ ...cur, [key]: value }))}
                          onPick={() => pickLevel(level, false)}
                          onTake={() => takeLevel(level, false)}
                        />
                      );
                    })
                  )}
                </div>
                <p className="border-y border-gold/40 px-2 py-1 text-center font-mono text-[11px] text-ink/55">
                  {spread > 0n
                    ? `${zh ? "价差" : "Spread"} ${moneyText(spread, quoteUnit, okbRate)} ${unitName}`
                    : zh
                      ? "还没有对敲的两档"
                      : "No two-sided market"}
                </p>
                <div className="max-h-[min(16rem,32vh)] overflow-y-auto">
                  {bids.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-ink/55">
                      {zh ? "买盘空着。" : "No bids."}
                    </p>
                  ) : (
                    bids.map((level, index) => {
                      const key = `b-${level.price}`;
                      return (
                        <BookRow
                          key={key}
                          zh={zh}
                          bid
                          best={index === 0}
                          on={picked === key}
                          busy={busy}
                          mine={orders.some(
                            (row) => row.market === market && row.bid && row.price === level.price,
                          )}
                          depth={maxBid > 0n ? Number((level.size * 100n) / maxBid) : 0}
                          priceLabel={moneyText(level.price, quoteUnit, okbRate)}
                          sizeLabel={baseText(market, level.size)}
                          totalLabel={moneyText(
                            cost(market, level.size, level.price),
                            quoteUnit,
                            okbRate,
                          )}
                          cap={plainBase(market, level.size)}
                          value={takes[key] ?? ""}
                          onChange={(value) => setTakes((cur) => ({ ...cur, [key]: value }))}
                          onPick={() => pickLevel(level, true)}
                          onTake={() => takeLevel(level, true)}
                        />
                      );
                    })
                  )}
                </div>
                {miss ? (
                  <p className="px-2 py-2 text-xs text-ink/55">
                    {zh ? "这一次没读到。不写成 0。" : "This read missed. It is not shown as zero."}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 border-t border-gold/40 text-xs sm:grid-cols-4">
                  <Stat
                    k={
                      <Hint
                        label={zh ? "卖盘可买" : "Asks can buy"}
                        text={
                          zh
                            ? "所有卖单加起来，现在还能买多少。"
                            : "Size still offered by asks, and its value."
                        }
                      />
                    }
                    v={`${baseText(market, askBook.base)} ${name}`}
                    s={`${moneyText(askBook.quote, quoteUnit, okbRate)} ${unitName} · ${askBook.lots}`}
                  />
                  <Stat
                    k={
                      <Hint
                        label={zh ? "买盘可卖" : "Bids can sell"}
                        text={
                          zh ? "所有买单加起来，现在还能卖多少。" : "Size still bid, and its value."
                        }
                      />
                    }
                    v={`${baseText(market, bidBook.base)} ${name}`}
                    s={`${moneyText(bidBook.quote, quoteUnit, okbRate)} ${unitName} · ${bidBook.lots}`}
                  />
                  <Stat
                    k={
                      <Hint
                        label={zh ? "成交" : "Prints"}
                        text={
                          zh
                            ? "从最新的区块往回读。NAND、LATCH、TAPE 分开算。读到的笔数和金额先显示，更早的还在补。"
                            : "Reads backward from the newest block. NAND, LATCH and TAPE are counted apart. Counts already found stay on screen while older blocks are still being read."
                        }
                      />
                    }
                    v={
                      reading && traded.n === 0
                        ? zh
                          ? "正在读"
                          : "Reading"
                        : `${traded.n}${zh ? " 笔" : ""}`
                    }
                    s={
                      reading && traded.n === 0
                        ? zh
                          ? `已回读 ${readMin} 分钟`
                          : `${readMin} min read`
                        : `${baseText(market, traded.base)} ${name} · ${moneyText(traded.quote, quoteUnit, okbRate)} ${unitName}`
                    }
                  />
                  <Stat
                    k={
                      <Hint
                        label={zh ? "已收手续费" : "Fees read"}
                        text={
                          zh
                            ? "这些成交里已经扣下的千分之二，进收费地址。卖方实收 99.8%。"
                            : "The 0.2 percent already taken on these prints. Sellers receive 99.8 percent."
                        }
                      />
                    }
                    v={`${moneyText(traded.fee, quoteUnit, okbRate)} ${unitName}`}
                    s={zh ? "只算已经读到的成交" : "Of the prints read"}
                  />
                </div>
              </article>
              <article className="mt-3 border border-gold bg-card">
                <div className="grid grid-cols-2 border-b border-gold">
                  <button
                    type="button"
                    onClick={() => setTab("tape")}
                    className={`min-h-10 text-sm ${tab === "tape" ? "bg-ink text-paper" : ""}`}
                  >
                    {zh ? "成交" : "Prints"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("mine")}
                    className={`min-h-10 text-sm ${tab === "mine" ? "bg-ink text-paper" : ""}`}
                  >
                    {zh ? "我的挂单" : "My orders"}
                  </button>
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {tab === "tape" ? (
                    <ul>
                      {prints.length === 0 ? (
                        <li className="px-3 py-3 text-sm text-ink/60">
                          {reading
                            ? zh
                              ? "正在把成交从链上读回来。"
                              : "Reading prints from the chain."
                            : zh
                              ? "这本账还没有成交。"
                              : "No prints on this book."}
                        </li>
                      ) : null}
                      {prints.slice(0, 24).map((row) => (
                        <li
                          key={`${row.tx}-${row.base}`}
                          className="grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-gold/30 px-3 py-2 font-mono text-xs sm:grid-cols-4"
                        >
                          <span>{moneyText(row.price, quoteUnit, okbRate)}</span>
                          <span className="truncate">{baseText(market, row.base)}</span>
                          <span className="hidden sm:block">
                            {moneyText(row.quote, quoteUnit, okbRate)}
                          </span>
                          <a
                            className="text-right underline"
                            href={`${XLAYER.explorer}/tx/${row.tx}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {zh ? "链上" : "Tx"}
                          </a>
                        </li>
                      ))}
                      {prints.length > 24 ? (
                        <li className="px-3 py-2 text-[11px] text-ink/50">
                          {zh
                            ? `还有 ${prints.length - 24} 笔更早的，已经算进上面的笔数和交易量。`
                            : `${prints.length - 24} older prints are already in the count and volume above.`}
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <ul>
                      {orders.length === 0 ? (
                        <li className="px-3 py-3 text-sm text-ink/60">
                          {zh
                            ? "这本账上没有你的挂单。"
                            : "You have no resting order on this book."}
                        </li>
                      ) : null}
                      {orders.map((row) => (
                        <li
                          key={row.id.toString()}
                          className="grid items-center gap-2 border-t border-gold/30 px-3 py-2 text-xs sm:grid-cols-[4rem_1fr_1fr_auto]"
                        >
                          <span className={row.bid ? "text-up" : "text-sell"}>
                            {row.bid ? (zh ? "买" : "Bid") : zh ? "卖" : "Ask"}
                          </span>
                          <span className="font-mono">
                            {moneyText(row.price, quoteUnit, okbRate)}
                          </span>
                          <span className="font-mono">{baseText(row.market, row.left)}</span>
                          <button
                            type="button"
                            disabled={busy}
                            className="min-h-9 border border-gold px-2 disabled:opacity-40"
                            onClick={() =>
                              run(
                                () => cancelSpot(account ?? "", row.id),
                                zh
                                  ? "已撤单。没吃掉的退回钱包。"
                                  : "Cancelled. The rest is back in the wallet.",
                              )
                            }
                          >
                            {zh ? "撤单" : "Cancel"}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            </div>
            <div
              className={`${ticketOpen ? "fixed inset-x-0 bottom-12 z-40 max-h-[78dvh] overflow-y-auto border-t border-gold bg-paper px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-plate lg:static lg:z-auto lg:max-h-none lg:overflow-visible lg:border lg:bg-card lg:p-3 lg:shadow-none" : "fixed inset-x-0 bottom-12 z-40 border-t border-gold bg-paper px-3 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:static lg:z-auto lg:border lg:bg-card lg:p-3"}`}
            >
              <div className="grid grid-cols-2 gap-2 lg:hidden">
                {ticketOpen ? (
                  <button
                    type="button"
                    className="col-span-2 min-h-9 text-xs text-ink/60"
                    onClick={() => setTicketOpen(false)}
                  >
                    {zh ? "收起" : "Close"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="min-h-11 bg-ink text-sm text-white"
                      onClick={() => {
                        setSide("buy");
                        setTicketOpen(true);
                      }}
                    >
                      {zh ? "买入" : "Buy"}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 bg-sell text-sm text-white"
                      onClick={() => {
                        setSide("sell");
                        setTicketOpen(true);
                      }}
                    >
                      {zh ? "卖出" : "Sell"}
                    </button>
                  </>
                )}
              </div>
              <div className={ticketOpen ? "mt-2 lg:mt-0" : "hidden lg:block"}>
                <div className="grid grid-cols-2 border border-gold">
                  <button
                    type="button"
                    onClick={() => setSide("buy")}
                    className={`min-h-11 text-sm ${side === "buy" ? "bg-ink text-white" : "text-up"}`}
                  >
                    {zh ? "买入" : "Buy"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide("sell")}
                    className={`min-h-11 text-sm ${side === "sell" ? "bg-sell text-white" : "text-sell"}`}
                  >
                    {zh ? "卖出" : "Sell"}
                  </button>
                </div>
                <label className="mt-3 grid gap-1 text-xs text-ink/55">
                  {zh ? `价格 ${unitName}` : `Price in ${unitName}`}
                  <input
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    inputMode="decimal"
                    className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink"
                  />
                </label>
                <label className="mt-2 grid gap-1 text-xs text-ink/55">
                  {zh ? `数量 ${name}` : `Amount ${name}`}
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    inputMode="decimal"
                    className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink"
                  />
                </label>
                <div className="mt-2 grid grid-cols-2 border border-gold/40">
                  <p className="px-2 py-2">
                    <span className="block text-[10px] tracking-wide text-ink/45">
                      {zh ? "可买入" : "Can buy"}
                    </span>
                    <span className="font-mono text-sm">
                      {purse ? `${usdtText(purse.usdt, 2)} USDT0` : "—"}
                    </span>
                  </p>
                  <p className="border-l border-gold/40 px-2 py-2">
                    <span className="block text-[10px] tracking-wide text-ink/45">
                      {zh ? "可卖出" : "Can sell"}
                    </span>
                    <span className="font-mono text-sm">
                      {purse
                        ? `${baseText(market, market === 0 ? purse.tape : market === 1 ? purse.nand : purse.latch)} ${name}`
                        : "—"}
                    </span>
                  </p>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => fillPct(pct)}
                      className="min-h-9 border border-gold text-xs"
                    >
                      {pct === 100 ? (zh ? "全部" : "All") : `${pct}%`}
                    </button>
                  ))}
                </div>
                <Quote
                  zh={zh}
                  market={market}
                  side={side}
                  price={price}
                  amount={amount}
                  unit={quoteUnit}
                  rate={okbRate}
                />
                <Plan
                  zh={zh}
                  market={market}
                  side={side}
                  price={price}
                  amount={amount}
                  asks={asks}
                  bids={bids}
                  purse={purse}
                  name={name}
                  unit={quoteUnit}
                  rate={okbRate}
                />
                {ownHit ? (
                  <p className="mt-2 text-sm leading-6 text-sell">
                    {zh
                      ? `这个价会碰到你自己的${ownHit.bid ? "买单" : "卖单"} ${usdtText(ownHit.price, 4)}。同一个钱包不能互吃，点下去会被整笔拒绝。先撤掉，或改一个碰不到的价格。`
                      : `This price reaches your own ${ownHit.bid ? "bid" : "ask"} at ${usdtText(ownHit.price, 4)}. The same wallet cannot take it. Cancel it, or move the price.`}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={busy || Boolean(ownHit)}
                  className={`mt-3 min-h-12 w-full text-sm text-white disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell"}`}
                  onClick={() => {
                    let px = 0n;
                    try {
                      px = typedUsdt(price, quoteUnit, okbRate);
                    } catch {
                      setBad(true);
                      setNote(
                        zh
                          ? "OKB 价格还没读到，先用 USDT0。"
                          : "The OKB price is not in yet. Use USDT0.",
                      );
                      return;
                    }
                    run(
                      () =>
                        placeSpot(
                          account ?? "",
                          market,
                          side === "buy",
                          px,
                          spotBase(market, amount),
                        ),
                      zh
                        ? "已进订单簿。没有对手的部分继续挂着，不会消失。"
                        : "It is on the book. Whatever did not meet another order stays there.",
                    );
                  }}
                >
                  {side === "buy"
                    ? zh
                      ? `买入 ${name}`
                      : `Buy ${name}`
                    : zh
                      ? `卖出 ${name}`
                      : `Sell ${name}`}
                </button>
                <TradeLog zh={zh} />
              </div>
            </div>
          </div>
        )}
        <p className="break-all text-[11px] text-ink/45">
          <a
            className="underline"
            href={`${XLAYER.explorer}/address/${spot}`}
            target="_blank"
            rel="noreferrer"
          >
            {spot}
          </a>
        </p>
        {note ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </section>
    </SideRail>
  );
}
