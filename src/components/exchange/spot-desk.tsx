import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { TapePoolDesk } from "@/components/exchange/tape-pool-desk";
import {
  BSC,
  BNB_GAS_RESERVE,
  bemPrice,
  bnbPrice,
  connectBsc,
  DESK_FEE_BPS,
  ERC_BOOKS,
  ercPrice,
  FEE_TO,
  isErcKey,
  pretty,
  quoteExact,
  readAsset,
  readBalances,
  recentPrints,
  splitDeskFee,
  swapBem,
  swapBnb,
  swapListed,
  txUrl,
  units,
  type ErcKey,
  type Balances,
  type PoolPrint,
} from "@/lib/bsc";
import { STOCK_KEYS, STOCKS, type StockKey } from "@/lib/stocks";
import { getSpotCandles } from "@/lib/candles";
import type { Candle } from "@/lib/bem-ohlcv";
import type { SpotFrame } from "@/lib/spot-ohlcv";
import { connectX, okbAddressUrl, okbPrice, okbPrints, okbTxUrl, OKB, quoteOkb, readOkbPurse, swapOkb } from "@/lib/okb";
import { XLAYER } from "@/lib/xlayer";
import { currentAccount, connectKind, onAccount, onOpenLink } from "@/lib/wallet";
import { Kline } from "@/components/exchange/kline";
import { SignCard } from "@/components/exchange/sign-card";
import { LpPanel } from "@/components/exchange/lp-desk";
import { useFeeLock } from "@/lib/fee-lock";

function sized(raw: bigint, decimals: number, pct: number, cap?: bigint): string {
  let cut = (raw * BigInt(pct)) / 100n;
  if (cap != null && cut > cap) cut = cap;
  const [whole, frac = ""] = formatUnits(cut, decimals).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function SpotDesk() {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [book, setBook] = useState<"crypto" | "stock" | "tape">("crypto");
  const [pair, setPair] = useState<"bem" | "bnb" | "okb" | ErcKey>("bem");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState<string | null>(null);
  const live = useExchange((s) => s.chainBem);
  const shown = pair === "bem" && live && live > 0 ? live.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : price;
  const [out, setOut] = useState<string | null>(null);
  const [minOut, setMinOut] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [balances, setBalances] = useState<Balances | null>(null);
  const [prints, setPrints] = useState<PoolPrint[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [card, setCard] = useState(false);
  const [openLink, setOpenLink] = useState<string | null>(null);
  const [okbBal, setOkbBal] = useState<{ okb: bigint; usdt: bigint } | null>(null);
  const [assetBal, setAssetBal] = useState<bigint | null>(null);
  const [frame, setFrame] = useState<SpotFrame>("1m");
  const [bars, setBars] = useState<Candle[]>([]);
  const [lane, setLane] = useState<"trade" | "lp">("trade");
  const lock = useFeeLock();

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => onOpenLink(setOpenLink), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      const priceOf = pair === "bnb" ? bnbPrice : pair === "okb" ? okbPrice : pair === "bem" ? bemPrice : () => ercPrice(pair);
      priceOf().then((text) => {
        if (!dead) setPrice(text);
      }).catch(() => undefined);
      const printsOf = pair === "okb" ? okbPrints() : recentPrints(pair);
      printsOf.then((rows) => {
        if (!dead) setPrints(rows);
      }).catch(() => undefined);
      const who = account ?? currentAccount();
      if (who && pair === "okb") {
        readOkbPurse(who).then((next) => {
          if (!dead) setOkbBal(next);
        }).catch(() => undefined);
      } else if (who) {
        readBalances(who).then((next) => {
          if (!dead) setBalances(next);
        }).catch(() => undefined);
        if (isErcKey(pair)) {
          readAsset(who, ERC_BOOKS[pair].token).then((next) => {
            if (!dead) setAssetBal(next);
          }).catch(() => undefined);
        }
      }
    };
    pull();
    const timer = window.setInterval(pull, 4000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [account, hash, pair]);

  useEffect(() => {
    let dead = false;
    getSpotCandles({ data: { pair, frame } })
      .then((rows) => {
        if (!dead) setBars(rows);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [pair, frame, hash]);
  useEffect(() => {
    const listed = isErcKey(pair) ? ERC_BOOKS[pair] : null;
    const base = pair === "okb" ? OKB.wokb : pair === "bnb" ? BSC.wbnb : listed ? listed.token : BSC.bem;
    const baseDecimals = listed ? listed.decimals : pair === "bem" ? BSC.bemDecimals : 18;
    const payDecimals = pair === "okb" ? OKB.usdtDecimals : BSC.usdtDecimals;
    const tokenIn = side === "buy" ? (pair === "okb" ? OKB.usdt : BSC.usdt) : base;
    const tokenOut = side === "buy" ? base : pair === "okb" ? OKB.usdt : BSC.usdt;
    const decimals = side === "buy" ? payDecimals : baseDecimals;
    const outDecimals = side === "buy" ? baseDecimals : payDecimals;
    const fee = listed ? listed.fee : pair === "bnb" ? BSC.bnbFee : BSC.fee;
    let dead = false;
    try {
      const amountIn = units(amount || "0", decimals);
      if (amountIn <= 0n) {
        setOut(null);
        setMinOut(null);
        return;
      }
      const { swapIn } = splitDeskFee(amountIn);
      const digits = side === "buy" ? (pair === "btc" ? 6 : pair === "bem" ? 4 : 4) : 2;
      const quoted = pair === "okb" ? quoteOkb(side, swapIn) : quoteExact(tokenIn, tokenOut, swapIn, fee);
      quoted
        .then((value) => {
          if (!dead) {
            setOut(pretty(value, outDecimals, digits));
            setMinOut(pretty((value * BigInt(10_000 - BSC.slippageBps)) / 10_000n, outDecimals, digits));
          }
        })
        .catch(() => {
          if (!dead) {
            setOut(null);
            setMinOut(null);
          }
        });
    } catch {
      setOut(null);
      setMinOut(null);
    }
    return () => {
      dead = true;
    };
  }, [amount, side, pair]);

  const fail = (err: unknown) => {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (message === "nowallet") setNote(c.walletNo);
    else if (code === 4001) setNote(c.walletReject);
    else if (message === "fee-kept") setNote(lang === "zh" ? "台费已经打进收费地址。兑换没有完成，其余的币还在钱包里。" : "The desk fee reached the fee address. The swap did not. The rest is still in the wallet.");
    else if (message === "fee-kept-slip" || message === "slip") setNote(lang === "zh" ? "滑点超过 1%，兑换取消。若台费已划走，只少了那一笔，其余还在钱包。" : "Slippage was over 1% and the swap was cancelled. If the fee already moved, only that fee left the wallet.");
    else if (message === "reverted") setNote(lang === "zh" ? "签名成功，链上失败。钱还在钱包里。" : "The signature was sent and the chain rejected it. The funds stayed in the wallet.");
    else if (/insufficient|exceeds balance|transfer amount/i.test(message)) setNote(lang === "zh" ? "余额不够。币还在钱包里，这一笔没有发生。" : "Not enough balance. Nothing left the wallet.");
    else if (/RPC|publicnode|Archive|Invalid param/i.test(message)) setNote(c.rpcWait);
    else if (message === "amount") setNote(c.pay);
    else setNote(message || c.walletReject);
    setBad(true);
  };

  const connectHere = async (which: "okx" | "binance") => {
    setBusy(true);
    setBad(false);
    setNote(lang === "zh" ? "正在打开钱包…" : "Opening the wallet…");
    try {
      const from = await connectKind(which);
      if (pair === "okb") await connectX();
      else await connectBsc();
      setAccount(from);
      setNote(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "binanceapp") return;
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const trade = async () => {
    setBusy(true);
    setBad(false);
    setNote(c.walletBusy);
    try {
      const from = pair === "okb" ? account ?? (await connectX()) : account ?? (await connectBsc());
      setAccount(from);
      if (!amount.trim()) return;
      const tx = pair === "okb" ? await swapOkb(from, side, amount) : pair === "bnb" ? await swapBnb(from, side, amount) : isErcKey(pair) ? await swapListed(from, pair, side, amount) : await swapBem(from, side, amount);
      setHash(tx);
      setNote(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const max = (pct: number) => {
    const ready = pair === "okb" ? Boolean(okbBal) : isErcKey(pair) ? (side === "sell" ? assetBal != null : Boolean(balances)) : Boolean(balances);
    if (!ready) return;
    const raw = side === "buy"
      ? (pair === "okb" ? (okbBal?.usdt ?? 0n) : (balances?.usdt ?? 0n))
      : pair === "okb" ? (okbBal?.okb ?? 0n) : pair === "bnb" ? (balances?.bnb ?? 0n) : isErcKey(pair) ? (assetBal ?? 0n) : (balances?.bem ?? 0n);
    const decimals = side === "buy" ? (pair === "okb" ? OKB.usdtDecimals : BSC.usdtDecimals) : isErcKey(pair) ? ERC_BOOKS[pair].decimals : pair === "bem" ? BSC.bemDecimals : 18;
    const cap = (pair === "bnb" || pair === "okb") && side === "sell" && raw > (pair === "okb" ? OKB.gasReserve : BNB_GAS_RESERVE) ? raw - (pair === "okb" ? OKB.gasReserve : BNB_GAS_RESERVE) : undefined;
    setAmount(sized(raw, decimals, pct, cap));
  };

  const payRaw = pair === "okb"
    ? (side === "buy" ? (okbBal?.usdt ?? 0n) : (okbBal?.okb ?? 0n))
    : side === "buy"
      ? (balances?.usdt ?? 0n)
      : pair === "bnb"
        ? (balances?.bnb ?? 0n)
        : isErcKey(pair)
          ? (assetBal ?? 0n)
          : (balances?.bem ?? 0n);
  const payDecimals = side === "buy" ? (pair === "okb" ? OKB.usdtDecimals : BSC.usdtDecimals) : isErcKey(pair) ? ERC_BOOKS[pair].decimals : pair === "bem" ? BSC.bemDecimals : 18;
  const reserve = pair === "okb" ? OKB.gasReserve : BNB_GAS_RESERVE;
  const spendCap = (pair === "bnb" || pair === "okb") && side === "sell" ? (payRaw > reserve ? payRaw - reserve : 0n) : undefined;
  const spendable = spendCap ?? payRaw;
  const base = pair === "okb" ? "OKB" : pair === "bnb" ? "BNB" : pair === "btc" ? "BTC" : pair === "xau" ? "XAU" : pair === "bem" ? "BEM" : STOCKS[pair].en;
  const stock = pair in STOCKS ? STOCKS[pair as StockKey] : null;
  const payUnit = side === "buy" ? "USDT" : base;
  const recvUnit = side === "buy" ? base : "USDT";
  let typed = 0n;
  try {
    typed = amount.trim() ? units(amount, payDecimals) : 0n;
  } catch {
    typed = 0n;
  }
  const deskFee = typed > 0n ? splitDeskFee(typed) : null;
  const over = (pair === "okb" ? Boolean(okbBal) : isErcKey(pair) ? (side === "sell" ? assetBal != null : Boolean(balances)) : Boolean(balances)) && typed > spendable;
  const pcts = [25, 50, 75, 100];

  return (
    <section className="border border-gold bg-card shadow-plate">
      <div className="grid grid-cols-2 border-b border-gold">
        <button type="button" onClick={() => setLane("trade")} className={`min-h-11 text-sm ${lane === "trade" ? "bg-ink text-paper" : ""}`}>
          {lang === "zh" ? "买卖" : "Trade"}
        </button>
        <button type="button" onClick={() => setLane("lp")} className={`min-h-11 text-sm ${lane === "lp" ? "bg-ink text-paper" : ""}`}>
          {lang === "zh" ? "流动性" : "Liquidity"}
        </button>
      </div>
      {lane === "lp" ? <LpPanel /> : (
      <>
      <div className="grid grid-cols-3 border-b border-gold">
        {(["crypto", "stock", "tape"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setBook(key);
              if (key === "tape") return;
              const next = key === "crypto" ? "bem" : "spy";
              setPair(next);
              setAmount("");
              setOut(null);
              setMinOut(null);
              setPrice(null);
              setAssetBal(null);
              setPrints([]);
            }}
            className={`min-h-11 text-sm ${book === key ? "bg-ink text-paper" : ""}`}
          >
            {key === "crypto" ? (lang === "zh" ? "加密货币" : "Crypto") : key === "stock" ? (lang === "zh" ? "美股" : "US stocks") : "TAPE"}
          </button>
        ))}
      </div>
      {book === "tape" ? <TapePoolDesk /> : (
      <div className="grid gap-0 lg:grid-cols-12">
        <div className="border-b border-gold/40 p-3 lg:col-span-7 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs tracking-widest text-gold">{base} / USDT</p>
          </div>
          <div className={`mt-2 grid gap-0 ${book === "crypto" ? "grid-cols-3 sm:grid-cols-5" : "grid-cols-3"}`}>
            {(book === "crypto" ? (["bem", "bnb", "okb", "btc", "xau"] as const) : STOCK_KEYS).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setPair(key);
                  setAmount("");
                  setOut(null);
                  setMinOut(null);
                  setPrice(null);
                  setAssetBal(null);
                  setPrints([]);
                }}
                className={`min-h-8 border border-gold px-2 font-mono text-xs ${pair === key ? "bg-ink text-paper" : ""}`}
              >
                {key in STOCKS ? (lang === "zh" ? STOCKS[key as StockKey].zh : STOCKS[key as StockKey].en) : key === "bem" ? "BEM" : key === "bnb" ? "BNB" : key === "okb" ? "OKB" : key === "btc" ? "BTC" : "XAU"}
              </button>
            ))}
          </div>
          <p className="font-display text-4xl italic leading-none tabular-nums sm:text-5xl">{shown ? `$${shown}` : "—"}</p>
          <p className="mt-1 font-mono text-xs text-ink/50">
            {stock
              ? lang === "zh"
                ? `Pancake ${base} / USDT · bStocks · 池费率 ${(ERC_BOOKS[pair as ErcKey].fee / 10000).toFixed(2)}% · 买到的是钱包里的代币，一枚对一股`
                : `Pancake ${base} / USDT · bStocks · pool fee ${(ERC_BOOKS[pair as ErcKey].fee / 10000).toFixed(2)}% · a buy lands in the wallet, one token for one share`
              : pair === "xau"
              ? lang === "zh"
                ? "Pancake XAUt / USDT · Tether Gold · 池费率 0.05% · 一枚对一盎司黄金"
                : "Pancake XAUt / USDT · Tether Gold · pool fee 0.05% · one token, one troy ounce"
              : pair === "btc"
                ? lang === "zh"
                  ? "Pancake BTCB / USDT · 池费率 0.01% · 买到的是钱包里的 BTCB"
                  : "Pancake BTCB / USDT · pool fee 0.01% · a buy lands as BTCB"
                : pair === "okb"
                  ? lang === "zh"
                    ? "X Layer PotatoSwap · OKB / USDT · 买到的是钱包里的 OKB · 成交地址从池子日志读"
                    : "X Layer PotatoSwap · OKB / USDT · a buy lands as OKB · addresses come from the pool log"
                  : pair === "bnb"
                    ? lang === "zh"
                      ? "Pancake BNB / USDT · 池费率 0.01% · 买到的是钱包里的 BNB"
                      : "Pancake BNB / USDT · pool fee 0.01% · a buy lands as BNB"
                    : lang === "zh"
                      ? "Pancake 池子报价 · 每秒从链上读"
                      : "Pancake pool quote · read every second"}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/80">{c.realNote}</p>
          <div className="mt-3 flex flex-wrap border border-gold">
            {(["1m", "5m", "15m", "1h", "1d"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setFrame(item)} className={`min-h-9 flex-1 font-mono text-xs ${frame === item ? "bg-ink text-paper" : ""}`}>
                {item === "1d" ? (lang === "zh" ? "1日" : "1d") : item}
              </button>
            ))}
          </div>
          <Kline bars={bars} lang={lang} desk="spot" />
          <h2 className="mt-4 text-xs tracking-widest text-gold">{lang === "zh" ? "链上成交 · 地址是签名的钱包" : "On-chain fills · the address signed the trade"}</h2>
          <div className="mt-2 overflow-x-auto">
          <div className="grid min-w-[22rem] grid-cols-[3rem_1fr_5rem_7.5rem] gap-2 font-mono text-xs text-ink/45">
            <span>{lang === "zh" ? "买卖" : "Side"}</span>
            <span>{base}</span>
            <span>USDT</span>
            <span>{lang === "zh" ? "地址" : "Address"}</span>
          </div>
          <ul className="mt-2 min-w-[22rem] divide-y divide-gold/30">
            {prints.length === 0 ? <li className="py-3 text-sm text-ink/60">{lang === "zh" ? (pair === "okb" ? "这根周期还没有池子成交。报价仍每秒从 PotatoSwap 读取。" : "这根周期还没有池子成交。报价仍每秒从 Pancake 读取。") : "No pool trades in this candle yet. The quote is still read every second."}</li> : null}
            {prints.map((row) => (
              <li key={row.id} className="grid grid-cols-[3rem_1fr_5rem_7.5rem] items-baseline gap-2 py-2 font-mono text-sm tabular-nums">
                <a className={row.side === "buy" ? "text-gold" : "text-sell"} href={pair === "okb" ? okbTxUrl(row.tx) : txUrl(row.tx)} target="_blank" rel="noreferrer">
                  {row.side === "buy" ? c.buy : c.sell}
                </a>
                <span className="min-w-0 truncate">{row.bem} {base}</span>
                <span className="text-ink/70">{row.usdt}</span>
                {row.who ? (
                  <a className="truncate text-xs underline decoration-gold underline-offset-4" href={pair === "okb" ? okbAddressUrl(row.who) : `${BSC.explorer}/address/${row.who}`} target="_blank" rel="noreferrer">
                    {row.who.slice(0, 6)}…{row.who.slice(-4)}
                  </a>
                ) : (
                  <span className="text-xs text-ink/40">—</span>
                )}
              </li>
            ))}
          </ul>
          </div>
        </div>
        <form
          className="flex flex-col gap-3 p-3 lg:sticky lg:top-28 lg:col-span-5 lg:self-start"
          onSubmit={(event) => {
            event.preventDefault();
            if (!account || lock.status !== "ok" || over || !amount.trim() || !out || !minOut) return;
            setCard(true);
          }}
        >
          <p className="font-mono text-xs text-ink/70">
            {account ? `${lang === "zh" ? "已连接" : "Connected"} ${account.slice(0, 6)}…${account.slice(-4)}` : lang === "zh" ? "未连接" : "Not connected"}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["buy", "sell"] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSide(key)}
                className={`min-h-12 border border-gold ${side === key ? "bg-ink text-paper" : "bg-card"}`}
              >
                {key === "buy" ? c.buy : c.sell}
              </button>
            ))}
          </div>
          <p className="text-xs tracking-widest text-gold">{c.balTitle}</p>
          <div className="grid grid-cols-3 gap-2">
            {(
              pair === "okb"
                ? ([
                    ["OKB", okbBal ? pretty(okbBal.okb, 18, 4) : "—"],
                    ["USDT", okbBal ? pretty(okbBal.usdt, OKB.usdtDecimals, 2) : "—"],
                    ["链", "X Layer"],
                  ] as const)
                : isErcKey(pair)
                  ? ([
                      [base, assetBal != null ? pretty(assetBal, ERC_BOOKS[pair].decimals, 4) : "—"],
                      ["USDT", balances ? pretty(balances.usdt, BSC.usdtDecimals, 2) : "—"],
                      ["BNB", balances ? pretty(balances.bnb, 18, 4) : "—"],
                    ] as const)
                : ([
                    ["BEM", balances ? pretty(balances.bem, BSC.bemDecimals, 4) : "—"],
                    ["USDT", balances ? pretty(balances.usdt, BSC.usdtDecimals, 2) : "—"],
                    ["BNB", balances ? pretty(balances.bnb, 18, 4) : "—"],
                  ] as const)
            ).map(([name, value]) => (
              <p key={name} className="border border-gold/40 px-2 py-2">
                <span className="block text-xs tracking-widest text-gold">{name}</span>
                <span className="block truncate font-mono text-sm tabular-nums">{value}</span>
              </p>
            ))}
          </div>
          <label className="border border-gold/40 px-3 py-2">
            <span className="flex items-center justify-between text-xs tracking-widest text-gold">
              {c.pay}
              <span className="max-w-[9rem] truncate font-mono normal-case tracking-normal text-ink/70">
                {c.ofBal} {balances ? pretty(payRaw, payDecimals, side === "buy" ? 2 : 4) : "—"} {side === "buy" ? "USDT" : base}
              </span>
            </span>
            <span className="flex items-baseline gap-2">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="w-full bg-transparent font-mono text-3xl outline-none"
                aria-label={c.pay}
              />
              <span className="font-mono text-sm">{side === "buy" ? "USDT" : base}</span>
            </span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {pcts.map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => max(pct)}
                className={`min-h-11 border border-gold font-mono text-sm ${amount && amount === sized(payRaw, payDecimals, pct, spendCap) ? "bg-ink text-paper" : ""}`}
              >
                {pct}%
              </button>
            ))}
          </div>
          <p className="border border-gold/40 px-3 py-2">
            <span className="block text-xs tracking-widest text-gold">{c.receive}</span>
            <span className="font-mono text-2xl tabular-nums">
              {out ?? "—"} {recvUnit}
            </span>
          </p>
          <p className="font-mono text-xs tabular-nums text-ink/70">
            {lang === "zh" ? "本单台费" : "Fee"} {deskFee ? pretty(deskFee.fee, payDecimals, 4) : "—"} {payUnit}
            {" · "}
            {lang === "zh" ? "最少到账" : "Min. received"} {minOut ?? "—"} {recvUnit}
          </p>
          {over ? <p className="text-sm text-sell">{lang === "zh" ? "余额不够，减一点数量。" : "Not enough balance. Use a smaller size."}</p> : null}
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink/70">
            <span>{lang === "zh" ? "本单台费收款，与规则页登记地址一致" : "This order's fee. Same address as the rules page."}</span>
            <button
              type="button"
              className="font-mono underline decoration-gold underline-offset-4"
              onClick={() => void navigator.clipboard?.writeText(FEE_TO)}
            >
              {FEE_TO.slice(0, 6)}…{FEE_TO.slice(-4)}
            </button>
          </p>
          {!account ? (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => void connectHere("okx")}>
                {lang === "zh" ? "用 OKX 连接" : "Connect OKX"}
              </button>
              <button type="button" className="min-h-12 border border-gold" disabled={busy} onClick={() => void connectHere("binance")}>
                {lang === "zh" ? "用币安连接" : "Connect Binance"}
              </button>
            </div>
          ) : (
            <button type="submit" className="min-h-12 bg-ink text-paper disabled:opacity-40" disabled={busy || over || lock.status !== "ok" || !amount.trim() || !out || !minOut}>
              {lang === "zh" ? `签名并${side === "buy" ? "买入" : "卖出"}` : `Sign and ${side === "buy" ? "buy" : "sell"}`}
            </button>
          )}
          {openLink ? (
            <a className="inline-flex min-h-11 items-center justify-center border border-gold bg-ink px-3 text-paper" href={openLink} target="_blank" rel="noreferrer">
              {lang === "zh" ? "没弹出的话，点这里打开 OKX" : "If nothing opened, open OKX"}
            </a>
          ) : null}
          {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
          {hash ? (
            <a className="text-sm underline decoration-gold underline-offset-4" href={pair === "okb" ? okbTxUrl(hash) : txUrl(hash)} target="_blank" rel="noreferrer">
              {c.walletTx}
            </a>
          ) : null}
          {card ? (
            <SignCard
              title={lang === "zh" ? "签名前看一眼" : "Before you sign"}
              yes={lang === "zh" ? `签名并${side === "buy" ? "买入" : "卖出"}` : `Sign and ${side === "buy" ? "buy" : "sell"}`}
              no={lang === "zh" ? "取消" : "Cancel"}
              warn={
                pair === "okb"
                  ? lang === "zh"
                    ? "这是 X Layer 现货。钱包会切到 X Layer。不会和 BSC 的单合成一笔。"
                    : "This is X Layer spot. The wallet switches to X Layer. It does not net with a BSC order."
                  : lang === "zh"
                    ? "这是 BSC 现货。不会和 X Layer 的单合成一笔。"
                    : "This is BSC spot. It does not net with an X Layer order."
              }
              onNo={() => setCard(false)}
              onYes={() => {
                setCard(false);
                void trade();
              }}
              lines={[
                { k: lang === "zh" ? "这一笔" : "This order", v: `${side === "buy" ? (lang === "zh" ? "买入" : "Buy") : lang === "zh" ? "卖出" : "Sell"} ${amount} ${payUnit}` },
                { k: lang === "zh" ? "池子约得" : "Pool estimate", v: `${out ?? "—"} ${recvUnit}` },
                { k: lang === "zh" ? "台费，打入收费地址" : "Desk fee, to the fee address", v: `${deskFee ? pretty(deskFee.fee, payDecimals, 4) : "—"} ${payUnit}` },
                { k: lang === "zh" ? "滑点 1% 内最少到账" : "Minimum within 1% slippage", v: `${minOut ?? "—"} ${recvUnit}` },
                { k: lang === "zh" ? "收费地址" : "Fee address", v: FEE_TO, href: pair === "okb" ? `${XLAYER.explorer}/address/${FEE_TO}` : `${BSC.explorer}/address/${FEE_TO}` },
              ]}
            />
          ) : null}
        </form>
      </div>
      )}
      </>
      )}
    </section>
  );
}
