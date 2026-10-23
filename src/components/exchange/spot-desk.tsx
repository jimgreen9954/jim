import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { TapePoolDesk } from "@/components/exchange/tape-pool-desk";
import {
  BSC,
  BNB_GAS_RESERVE,
  ALT_BOOKS,
  altPrice,
  altPrints,
  bemPrice,
  bnbPrice,
  connectBsc,
  DESK_FEE_BPS,
  ERC_BOOKS,
  ercPrice,
  FEE_TO,
  isAltKey,
  isErcKey,
  poolMark,
  pretty,
  quoteAlt,
  quoteExact,
  readAsset,
  readBalances,
  recentPrints,
  splitDeskFee,
  swapAlt,
  swapBem,
  swapBnb,
  swapListed,
  tokenCap,
  txUrl,
  TxPending,
  units,
  type AltKey,
  type ErcKey,
  type Balances,
  type PoolPrint,
} from "@/lib/bsc";
import { STOCK_KEYS, STOCKS, type StockKey } from "@/lib/stocks";
import { pullSpot, type SpotFrame, type SpotPair } from "@/lib/spot-ohlcv";
import type { Candle } from "@/lib/bem-ohlcv";
import { connectX, okbAddressUrl, okbPrice, okbPrints, okbTxUrl, OKB, quoteOkb, quoteXBem, readOkbPurse, readXBemPurse, swapOkb, swapXBem, xBemPrice, xBemPrints, xCap, X_BEM } from "@/lib/okb";
import { XLAYER } from "@/lib/xlayer";
import { currentAccount, connectKind, onAccount, onOpenLink } from "@/lib/wallet";
import { Kline } from "@/components/exchange/kline";
import { SignCard } from "@/components/exchange/sign-card";
import { LpPanel } from "@/components/exchange/lp-desk";
import { useFeeLock } from "@/lib/fee-lock";
import { SideRail } from "@/components/exchange/side-rail";
import { SymbolMenu } from "@/components/exchange/symbol-menu";

function sized(raw: bigint, decimals: number, pct: number, cap?: bigint): string {
  let cut = (raw * BigInt(pct)) / 100n;
  if (cap != null && cut > cap) cut = cap;
  const [whole, frac = ""] = formatUnits(cut, decimals).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function cachedBars(pair: string, frame: string): Candle[] {
  try {
    const raw = JSON.parse(localStorage.getItem("tapeliquid-spot-candles") || "{}") as Record<string, Candle[]>;
    const rows = raw[`${pair}:${frame}`];
    return Array.isArray(rows) ? rows.filter((row) => row && Number(row.c) > 0).slice(-120) : [];
  } catch {
    return [];
  }
}

function saveBars(pair: string, frame: string, rows: Candle[]) {
  try {
    const raw = JSON.parse(localStorage.getItem("tapeliquid-spot-candles") || "{}") as Record<string, Candle[]>;
    raw[`${pair}:${frame}`] = rows.slice(-120);
    const keys = Object.keys(raw);
    for (const key of keys.slice(0, Math.max(0, keys.length - 24))) delete raw[key];
    localStorage.setItem("tapeliquid-spot-candles", JSON.stringify(raw));
  } catch {
    /* The chart is already on screen. */
  }
}

export function SpotDesk() {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [book, setBook] = useState<"crypto" | "stock" | "tape">("crypto");
  useEffect(() => {
    const apply = () => {
      if (window.location.hash === "#tapetrade") setBook("tape");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const [pair, setPair] = useState<"bem" | "xbem" | "bnb" | "okb" | ErcKey | AltKey>("bem");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState<string | null>(null);
  const live = useExchange((s) => s.chainBem);
  const shown = pair === "bem" && live && live > 0 ? live.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : price;
  const [out, setOut] = useState<string | null>(null);
  const [minOut, setMinOut] = useState<string | null>(null);
  const [floor, setFloor] = useState<bigint | null>(null);
  const [quotedAt, setQuotedAt] = useState(0);
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
  const [xbemBal, setXbemBal] = useState<{ bem: bigint; usdt: bigint } | null>(null);
  const [assetBal, setAssetBal] = useState<bigint | null>(null);
  const [frame, setFrame] = useState<SpotFrame>("1m");
  const [bars, setBars] = useState<Candle[]>([]);
  const [supply, setSupply] = useState<number | null>(null);
  const [lane, setLane] = useState<"trade" | "lp">("trade");
  const lock = useFeeLock();

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => onOpenLink(setOpenLink), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      const priceOf = isAltKey(pair) ? () => altPrice(pair) : pair === "xbem" ? xBemPrice : pair === "okb" ? okbPrice : () => poolMark(pair).catch(() => (pair === "bnb" ? bnbPrice() : pair === "bem" ? bemPrice() : ercPrice(pair)));
      priceOf().then((text) => {
        if (!dead) setPrice(text);
      }).catch(() => undefined);
      const printsOf = isAltKey(pair) ? altPrints(pair) : pair === "xbem" ? xBemPrints() : pair === "okb" ? okbPrints() : recentPrints(pair);
      printsOf.then((rows) => {
        if (!dead) setPrints(rows);
      }).catch(() => undefined);
      const who = account ?? currentAccount();
      if (who && pair === "okb") {
        readOkbPurse(who).then((next) => {
          if (!dead) setOkbBal(next);
        }).catch(() => undefined);
      } else if (who && pair === "xbem") {
        readXBemPurse(who).then((next) => {
          if (!dead) setXbemBal(next);
        }).catch(() => undefined);
      } else if (who) {
        readBalances(who).then((next) => {
          if (!dead) setBalances(next);
        }).catch(() => undefined);
        if (isErcKey(pair) || isAltKey(pair)) {
          readAsset(who, isAltKey(pair) ? ALT_BOOKS[pair].token : ERC_BOOKS[pair].token).then((next) => {
            if (!dead) setAssetBal(next);
          }).catch(() => undefined);
        }
      }
    };
    pull();
    const timer = window.setInterval(pull, 8000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [account, hash, pair]);

  useEffect(() => {
    let dead = false;
    const known = cachedBars(pair, frame);
    setBars(known);
    pullSpot(pair as SpotPair, frame)
      .then((rows) => {
        if (dead || rows.length === 0) return;
        setBars(rows);
        saveBars(pair, frame, rows);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [pair, frame, hash]);

  useEffect(() => {
    let dead = false;
    const listed = isErcKey(pair) ? ERC_BOOKS[pair].token : isAltKey(pair) ? ALT_BOOKS[pair].token : null;
    const job = pair === "okb" ? xCap(OKB.wokb) : pair === "xbem" ? xCap(X_BEM.token) : tokenCap(pair === "bnb" ? BSC.wbnb : listed ?? BSC.bem);
    job.then((n) => { if (!dead) setSupply(n || null); }).catch(() => { if (!dead) setSupply(null); });
    return () => { dead = true; };
  }, [pair]);

  useEffect(() => {
    const listed = isErcKey(pair) ? ERC_BOOKS[pair] : null;
    const alt = isAltKey(pair) ? ALT_BOOKS[pair] : null;
    const base = pair === "okb" ? OKB.wokb : pair === "xbem" ? X_BEM.token : pair === "bnb" ? BSC.wbnb : listed ? listed.token : alt ? alt.token : BSC.bem;
    const baseDecimals = listed ? listed.decimals : alt ? alt.decimals : pair === "xbem" ? X_BEM.decimals : pair === "bem" ? BSC.bemDecimals : 18;
    const payDecimals = pair === "okb" || pair === "xbem" ? 6 : BSC.usdtDecimals;
    const tokenIn = side === "buy" ? (pair === "xbem" ? X_BEM.usdt : pair === "okb" ? OKB.usdt : BSC.usdt) : base;
    const tokenOut = side === "buy" ? base : pair === "xbem" ? X_BEM.usdt : pair === "okb" ? OKB.usdt : BSC.usdt;
    const decimals = side === "buy" ? payDecimals : baseDecimals;
    const outDecimals = side === "buy" ? baseDecimals : payDecimals;
    const fee = listed ? listed.fee : pair === "bnb" ? BSC.bnbFee : BSC.fee;
    let dead = false;
    try {
      const amountIn = units(amount || "0", decimals);
      if (amountIn <= 0n) {
        setOut(null);
        setMinOut(null);
        setFloor(null);
        return;
      }
      const { swapIn } = splitDeskFee(amountIn);
      const digits = side === "buy" ? (isAltKey(pair) ? ALT_BOOKS[pair].buyDigits : pair === "btc" ? 6 : pair === "bem" || pair === "xbem" ? 4 : 4) : 2;
      const quoted = isAltKey(pair) ? quoteAlt(pair, side, swapIn) : pair === "xbem" ? quoteXBem(side, swapIn) : pair === "okb" ? quoteOkb(side, swapIn) : quoteExact(tokenIn, tokenOut, swapIn, fee);
      quoted
        .then((value) => {
          if (!dead) {
            const min = (value * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
            setOut(pretty(value, outDecimals, digits));
            setMinOut(pretty(min, outDecimals, digits));
            setFloor(min);
            setQuotedAt(Date.now());
          }
        })
        .catch(() => {
          if (!dead) {
            setOut(null);
            setMinOut(null);
            setFloor(null);
          }
        });
    } catch {
      setOut(null);
      setMinOut(null);
      setFloor(null);
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
    else if (message === "pending" || err instanceof TxPending) {
      const pending = err as TxPending;
      if (pending.hash) setHash(pending.hash);
      setNote(lang === "zh" ? "交易已经提交，回执还没读到。先打开这笔哈希核对，不要再签同一笔。同一金额不会再收一次台费。" : "Submitted. The receipt is not back yet. Open this hash before signing again. The same amount is not charged a second desk fee.");
    }
    else if (message === "quote-moved") setNote(lang === "zh" ? "价格变了，现在的最少到账低于刚才确认的数。看新报价再签。" : "The price moved. The new minimum is below the one you confirmed. Look again, then sign.");
    else if (message === "fee-kept") setNote(lang === "zh" ? "台费已经打进收费地址，不退。兑换没有完成，其余的币还在钱包里。同一金额再试，不会再收一次台费。" : "The desk fee reached the fee address and is not returned. The swap did not. The rest is still in the wallet. Retrying the same amount does not charge the fee again.");
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
      if (pair === "okb" || pair === "xbem") await connectX();
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

  const trade = async (min: bigint) => {
    setBusy(true);
    setBad(false);
    setNote(c.walletBusy);
    try {
      const from = pair === "okb" || pair === "xbem" ? account ?? (await connectX()) : account ?? (await connectBsc());
      setAccount(from);
      if (!amount.trim()) return;
      const tx = pair === "xbem" ? await swapXBem(from, side, amount, min) : pair === "okb" ? await swapOkb(from, side, amount, min) : pair === "bnb" ? await swapBnb(from, side, amount, min) : isAltKey(pair) ? await swapAlt(from, pair, side, amount, min) : isErcKey(pair) ? await swapListed(from, pair, side, amount, min) : await swapBem(from, side, amount, min);
      setHash(tx);
      setNote(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const max = (pct: number) => {
    const ready = pair === "okb" ? Boolean(okbBal) : pair === "xbem" ? Boolean(xbemBal) : isErcKey(pair) || isAltKey(pair) ? (side === "sell" ? assetBal != null : Boolean(balances)) : Boolean(balances);
    if (!ready) return;
    const raw = side === "buy"
      ? (pair === "okb" ? (okbBal?.usdt ?? 0n) : pair === "xbem" ? (xbemBal?.usdt ?? 0n) : (balances?.usdt ?? 0n))
      : pair === "okb" ? (okbBal?.okb ?? 0n) : pair === "xbem" ? (xbemBal?.bem ?? 0n) : pair === "bnb" ? (balances?.bnb ?? 0n) : isErcKey(pair) || isAltKey(pair) ? (assetBal ?? 0n) : (balances?.bem ?? 0n);
    const decimals = side === "buy" ? (pair === "okb" || pair === "xbem" ? 6 : BSC.usdtDecimals) : isAltKey(pair) ? ALT_BOOKS[pair].decimals : isErcKey(pair) ? ERC_BOOKS[pair].decimals : pair === "xbem" ? X_BEM.decimals : pair === "bem" ? BSC.bemDecimals : 18;
    const cap = (pair === "bnb" || pair === "okb") && side === "sell" && raw > (pair === "okb" ? OKB.gasReserve : BNB_GAS_RESERVE) ? raw - (pair === "okb" ? OKB.gasReserve : BNB_GAS_RESERVE) : undefined;
    setAmount(sized(raw, decimals, pct, cap));
  };

  const payRaw = pair === "okb"
    ? (side === "buy" ? (okbBal?.usdt ?? 0n) : (okbBal?.okb ?? 0n))
    : pair === "xbem"
      ? (side === "buy" ? (xbemBal?.usdt ?? 0n) : (xbemBal?.bem ?? 0n))
    : side === "buy"
      ? (balances?.usdt ?? 0n)
      : pair === "bnb"
        ? (balances?.bnb ?? 0n)
        : isErcKey(pair) || isAltKey(pair)
          ? (assetBal ?? 0n)
          : (balances?.bem ?? 0n);
  const payDecimals = side === "buy" ? (pair === "okb" || pair === "xbem" ? 6 : BSC.usdtDecimals) : isAltKey(pair) ? ALT_BOOKS[pair].decimals : isErcKey(pair) ? ERC_BOOKS[pair].decimals : pair === "xbem" ? X_BEM.decimals : pair === "bem" ? BSC.bemDecimals : 18;
  const reserve = pair === "okb" ? OKB.gasReserve : BNB_GAS_RESERVE;
  const spendCap = (pair === "bnb" || pair === "okb") && side === "sell" ? (payRaw > reserve ? payRaw - reserve : 0n) : undefined;
  const spendable = spendCap ?? payRaw;
  const base = isAltKey(pair) ? (lang === "zh" ? ALT_BOOKS[pair].zh : ALT_BOOKS[pair].symbol) : pair === "okb" ? "OKB" : pair === "bnb" ? "BNB" : pair === "bem" || pair === "xbem" ? "BEM" : pair === "btc" ? "BTC" : pair === "eth" ? "ETH" : pair === "zec" ? "ZEC" : pair === "xau" ? "XAU" : pair in STOCKS ? STOCKS[pair].en : pair;
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
  const over = (pair === "okb" ? Boolean(okbBal) : pair === "xbem" ? Boolean(xbemBal) : isErcKey(pair) || isAltKey(pair) ? (side === "sell" ? assetBal != null : Boolean(balances)) : Boolean(balances)) && typed > spendable;
  const pcts = [25, 50, 75, 100];

  return (
    <SideRail items={([
      ["crypto", lang === "zh" ? "加密货币" : "Crypto"],
      ["stock", lang === "zh" ? "美股" : "Stocks"],
      ["tape", "TAPE"],
      ["lp", lang === "zh" ? "流动性" : "Liquidity"],
    ] as const).map(([key, label]) => ({
      key,
      label,
      on: key === "lp" ? lane === "lp" : lane === "trade" && book === key,
      run: () => {
        if (key === "lp") { setLane("lp"); return; }
        setLane("trade");
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
      },
    }))}>
    <section className="border border-gold bg-card shadow-plate">
      {book === "tape" && lane === "trade" ? <TapePoolDesk /> : lane === "lp" ? <LpPanel /> : (
      <div className="grid gap-0 lg:grid-cols-12">
        <div className="border-b border-gold/40 p-3 lg:col-span-7 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs tracking-widest text-gold">{base} / USDT</p>
          </div>
          <div className="mt-2">
            <SymbolMenu
              zh={lang === "zh"}
              label={`${base} / USDT`}
              note={pair === "okb" || pair === "xbem" ? "X Layer" : "BSC"}
              items={(book === "crypto" ? (["bem", "xbem", "bnb", "okb", "btc", "eth", "zec", "xau", "btccn", "dagou"] as const) : STOCK_KEYS).map((key) => ({
                id: key,
                title: isAltKey(key) ? (lang === "zh" ? ALT_BOOKS[key].zh : ALT_BOOKS[key].symbol) : key in STOCKS ? (lang === "zh" ? STOCKS[key as StockKey].zh : STOCKS[key as StockKey].en) : key === "bem" || key === "xbem" ? "BEM" : key === "bnb" ? "BNB" : key === "okb" ? "OKB" : key === "btc" ? "BTC" : key === "eth" ? "ETH" : key === "zec" ? "ZEC" : "XAU",
                note: key === "okb" || key === "xbem" ? "X Layer" : "BSC",
                on: pair === key,
                run: () => {
                  setPair(key);
                  setAmount("");
                  setOut(null);
                  setMinOut(null);
                  setPrice(null);
                  setAssetBal(null);
                  setPrints([]);
                },
              }))}
            />
          </div>
          <p className="mt-3 flex items-baseline gap-2 leading-none">
            <span className="font-mono text-4xl tabular-nums tracking-tight sm:text-5xl">{shown ?? "—"}</span>
            {shown ? <span className="font-mono text-xs tracking-widest text-gold">USDT</span> : null}
          </p>
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
                  ? "Pancake BTCB / USDT · BSC · 池费率 0.01% · 买到的是钱包里的 BTCB"
                  : "Pancake BTCB / USDT · BSC · pool fee 0.01% · a buy lands as BTCB"
                : pair === "eth"
                  ? lang === "zh"
                    ? "Pancake ETH / USDT · BSC · 池费率 0.05% · 买到的是钱包里的 ETH"
                    : "Pancake ETH / USDT · BSC · pool fee 0.05% · a buy lands as ETH"
                  : pair === "zec"
                    ? lang === "zh"
                      ? "Pancake ZEC / USDT · BSC · 池费率 0.05% · 买到的是钱包里的 ZEC"
                      : "Pancake ZEC / USDT · BSC · pool fee 0.05% · a buy lands as ZEC"
                : pair === "xbem"
                  ? lang === "zh"
                    ? "Uniswap v3 · X Layer · USDT → WOKB → BEM · 这是 X Layer 的 BEM，不是 BSC 那一份 · BEM/WOKB 1% · WOKB/USDT 0.05% · 台费 0.20%"
                    : "Uniswap v3 · X Layer · USDT → WOKB → BEM · this is X Layer BEM, not the BSC token · BEM/WOKB 1% · WOKB/USDT 0.05% · desk fee 0.20%"
                : pair === "okb"
                  ? lang === "zh"
                    ? "X Layer PotatoSwap · OKB / USDT · 买到的是钱包里的 OKB · 成交地址从池子日志读"
                    : "X Layer PotatoSwap · OKB / USDT · a buy lands as OKB · addresses come from the pool log"
                  : pair === "btccn"
                    ? lang === "zh"
                      ? "Uniswap 比特币 / USDT · BSC · 台费 0.20% · 池费率 0.30% · 买到的是这个合约的币，不是 BTCB"
                      : "Uniswap 比特币 / USDT · BSC · desk fee 0.20% · pool fee 0.30% · a buy lands as this token, not BTCB"
                    : pair === "dagou"
                      ? lang === "zh"
                        ? "Uniswap USDT → CAKE → 大狗币 · BSC · 台费 0.20% · 池子另收自己的费率 · 买到的是钱包里的 DAGOU"
                        : "Uniswap USDT → CAKE → DAGOU · BSC · desk fee 0.20% · the pool charges its own fee · a buy lands as DAGOU"
                  : pair === "bnb"
                    ? lang === "zh"
                      ? "Pancake BNB / USDT · 池费率 0.01% · 买到的是钱包里的 BNB"
                      : "Pancake BNB / USDT · pool fee 0.01% · a buy lands as BNB"
                    : lang === "zh"
                      ? "Pancake 池子报价 · 每秒从链上读"
                      : "Pancake pool quote · read every second"}
          </p>
          {pair === "xbem" || pair === "okb" ? null : <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/80">{c.realNote}</p>}
          <div className="mt-3 flex flex-wrap border border-gold">
            {(["1m", "5m", "15m", "1h", "1d"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setFrame(item)} className={`min-h-9 flex-1 font-mono text-xs ${frame === item ? "bg-ink text-paper" : ""}`}>
                {item === "1d" ? (lang === "zh" ? "1日" : "1d") : item}
              </button>
            ))}
          </div>
          <Kline bars={bars} lang={lang} desk="spot" supply={supply} />
          <h2 className="mt-4 text-xs tracking-widest text-gold">{lang === "zh" ? "链上成交 · 地址是签名的钱包" : "On-chain fills · the address signed the trade"}</h2>
          <div className="mt-2 overflow-x-auto">
          <div className="grid min-w-[22rem] grid-cols-[3rem_1fr_5rem_7.5rem] gap-2 font-mono text-xs text-ink/45">
            <span>{lang === "zh" ? "买卖" : "Side"}</span>
            <span>{base}</span>
            <span>USDT</span>
            <span>{lang === "zh" ? "地址" : "Address"}</span>
          </div>
          <ul className="mt-2 min-w-[22rem] divide-y divide-gold/30">
            {prints.length === 0 ? <li className="py-3 text-sm text-ink/60">{lang === "zh" ? (pair === "xbem" ? "这根周期还没有池子成交。报价仍从 Uniswap 读取。" : pair === "okb" ? "这根周期还没有池子成交。报价仍每秒从 PotatoSwap 读取。" : isAltKey(pair) ? "这段还没有读到池子成交。报价仍从 Uniswap 读取。" : "这根周期还没有池子成交。报价仍每秒从 Pancake 读取。") : pair === "xbem" ? "No pool trades in this candle yet. The quote is still read from Uniswap." : "No pool trades in this candle yet. The quote is still read every second."}</li> : null}
            {prints.map((row) => (
              <li key={row.id} className="grid grid-cols-[3rem_1fr_5rem_7.5rem] items-baseline gap-2 py-2 font-mono text-sm tabular-nums">
                <a className={row.side === "buy" ? "text-gold" : "text-sell"} href={pair === "okb" || pair === "xbem" ? okbTxUrl(row.tx) : txUrl(row.tx)} target="_blank" rel="noreferrer">
                  {row.side === "buy" ? c.buy : c.sell}
                </a>
                <span className="min-w-0 truncate">{row.bem} {base}</span>
                <span className="text-ink/70">{row.usdt}</span>
                {row.who ? (
                  <a className="truncate text-xs underline decoration-gold underline-offset-4" href={pair === "okb" || pair === "xbem" ? okbAddressUrl(row.who) : `${BSC.explorer}/address/${row.who}`} target="_blank" rel="noreferrer">
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
                : pair === "xbem"
                  ? ([
                      ["BEM", xbemBal ? pretty(xbemBal.bem, X_BEM.decimals, 4) : "—"],
                      ["USDT", xbemBal ? pretty(xbemBal.usdt, 6, 2) : "—"],
                      ["链", "X Layer"],
                    ] as const)
                : isErcKey(pair) || isAltKey(pair)
                  ? ([
                      [base, assetBal != null ? pretty(assetBal, isAltKey(pair) ? ALT_BOOKS[pair].decimals : ERC_BOOKS[pair].decimals, 4) : "—"],
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
                {c.ofBal} {(pair === "okb" ? Boolean(okbBal) : pair === "xbem" ? Boolean(xbemBal) : Boolean(balances)) ? pretty(payRaw, payDecimals, side === "buy" ? 2 : 4) : "—"} {side === "buy" ? "USDT" : base}
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
            {lang === "zh" ? " · 绑了邀请人则这笔的 6% 给邀请人，少付 4%，90% 进收费地址" : " · with a referrer, 6% of this fee, 4% off, 90% to the fee address"}
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
            <a className="text-sm underline decoration-gold underline-offset-4" href={pair === "okb" || pair === "xbem" ? okbTxUrl(hash) : txUrl(hash)} target="_blank" rel="noreferrer">
              {c.walletTx}
            </a>
          ) : null}
          {card ? (
            <SignCard
              title={lang === "zh" ? "签名前看一眼" : "Before you sign"}
              yes={lang === "zh" ? `签名并${side === "buy" ? "买入" : "卖出"}` : `Sign and ${side === "buy" ? "buy" : "sell"}`}
              no={lang === "zh" ? "取消" : "Cancel"}
              warn={
                pair === "okb" || pair === "xbem"
                  ? lang === "zh"
                    ? "这是 X Layer 现货。钱包会切到 X Layer。不会和 BSC 的单合成一笔。台费先付，后面的兑换没完成也不退。"
                    : "This is X Layer spot. The wallet switches to X Layer. It does not net with a BSC order. The desk fee is paid first and is not returned if the swap does not finish."
                  : lang === "zh"
                    ? "这是 BSC 现货。不会和 X Layer 的单合成一笔。台费先付，后面的兑换没完成也不退。"
                    : "This is BSC spot. It does not net with an X Layer order. The desk fee is paid first and is not returned if the swap does not finish."
              }
              onNo={() => setCard(false)}
              onYes={() => {
                if (!floor || Date.now() - quotedAt > 30_000) {
                  setCard(false);
                  setBad(true);
                  setNote(lang === "zh" ? "报价超过 30 秒，已经作废。看新的最少到账再签。" : "The quote is older than 30 seconds. Read the new minimum, then sign.");
                  return;
                }
                const min = floor;
                setCard(false);
                void trade(min);
              }}
              lines={[
                { k: lang === "zh" ? "这一笔" : "This order", v: `${side === "buy" ? (lang === "zh" ? "买入" : "Buy") : lang === "zh" ? "卖出" : "Sell"} ${amount} ${payUnit}` },
                { k: lang === "zh" ? "池子约得" : "Pool estimate", v: `${out ?? "—"} ${recvUnit}` },
                { k: lang === "zh" ? "台费，打入收费地址" : "Desk fee, to the fee address", v: `${deskFee ? pretty(deskFee.fee, payDecimals, 4) : "—"} ${payUnit}` },
                { k: lang === "zh" ? "滑点 1% 内最少到账" : "Minimum within 1% slippage", v: `${minOut ?? "—"} ${recvUnit}` },
                { k: lang === "zh" ? "收费地址" : "Fee address", v: FEE_TO, href: pair === "okb" || pair === "xbem" ? `${XLAYER.explorer}/address/${FEE_TO}` : `${BSC.explorer}/address/${FEE_TO}` },
              ]}
            />
          ) : null}
        </form>
      </div>
      )}
    </section>
    </SideRail>
  );
}
