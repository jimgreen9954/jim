import { useEffect, useRef, useState } from "react";
import { PhoneChrome, wantedPane, type PhonePane } from "@/components/exchange/phone-desk";
import { formatUnits } from "viem";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import {
  BSC,
  BNB_GAS_RESERVE,
  bemPrice,
  bnbPrice,
  connectBsc,
  DESK_FEE_BPS,
  ERC_BOOKS,
  ercPrice,
  BSC_SAFE,
  XLAYER_SAFE,
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
  swapWithBnb,
  quoteWithBnb,
  tokenCap,
  txUrl,
  TxPending,
  units,
  type ErcKey,
  type Balances,
  type PoolPrint,
} from "@/lib/bsc";
import { STOCK_KEYS, STOCKS, type StockKey } from "@/lib/stocks";
import { getSpotCandles } from "@/lib/candles";
import type { Candle } from "@/lib/bem-ohlcv";
import type { SpotFrame } from "@/lib/spot-ohlcv";
import { connectX, okbAddressUrl, okbPrice, okbPrints, okbTxUrl, OKB, quoteOkb, readOkbPurse, swapOkb, xCap } from "@/lib/okb";
import { XLAYER } from "@/lib/xlayer";
import { currentAccount, connectKind, onAccount, onOpenLink } from "@/lib/wallet";
import { markDeskFill } from "@/lib/red-packet";
import { rememberFill, TradeLog } from "@/components/exchange/trade-foot";
import { Kline } from "@/components/exchange/kline";
import { CoinMark } from "@/components/exchange/coin-mark";
import { PairChevron } from "@/components/exchange/pair-chevron";
import { LpPanel } from "@/components/exchange/lp-desk";
import { useFeeLock } from "@/lib/fee-lock";
import { SideRail } from "@/components/exchange/side-rail";

type SpotRest = { id: string; pair: "bem" | "bnb" | "okb" | ErcKey; side: "buy" | "sell"; amount: string; limit: number; unit: "usdt" | "bnb" };
const REST_KEY = "tape-spot-rest";

function readSpotRest(): SpotRest[] {
  try {
    const rows = JSON.parse(localStorage.getItem(REST_KEY) || "[]") as SpotRest[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeSpotRest(rows: SpotRest[]) {
  localStorage.setItem(REST_KEY, JSON.stringify(rows));
}

function limitMin(nextSide: "buy" | "sell", qty: string, px: number, nextPair: SpotRest["pair"], nextUnit: "usdt" | "bnb"): bigint | undefined {
  const n = Number(qty);
  if (!(px > 0) || !(n > 0) || (nextUnit === "bnb" && nextSide === "buy")) return undefined;
  const listed = isErcKey(nextPair) ? ERC_BOOKS[nextPair] : null;
  const baseDec = listed ? listed.decimals : nextPair === "bem" ? BSC.bemDecimals : 18;
  const usdtDec = nextPair === "okb" ? OKB.usdtDecimals : BSC.usdtDecimals;
  const raw = nextSide === "buy" ? n / px : n * px;
  if (!(raw > 0) || !Number.isFinite(raw)) return undefined;
  try { return units(raw.toFixed(8), nextSide === "buy" ? baseDec : usdtDec); } catch { return undefined; }
}

function sized(raw: bigint, decimals: number, pct: number, cap?: bigint): string {
  let cut = (raw * BigInt(pct)) / 100n;
  if (cap != null && cut > cap) cut = cap;
  const [whole, frac = ""] = formatUnits(cut, decimals).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function SpotDesk({ focus = "bem", onMarkets, openLp = false }: { focus?: "bem" | "bnb" | "okb" | "btc" | "eth" | "zec" | "xau"; onMarkets?: () => void; openLp?: boolean }) {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [book, setBook] = useState<"crypto" | "stock">("crypto");
  const [pair, setPair] = useState<"bem" | "bnb" | "okb" | ErcKey>("bem");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [unit, setUnit] = useState<"usdt" | "bnb">("usdt");
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
  const [assetBal, setAssetBal] = useState<bigint | null>(null);
  const [frame, setFrame] = useState<SpotFrame>("1h");
  const [bars, setBars] = useState<Candle[]>([]);
  const [supply, setSupply] = useState<number | null>(null);
  const [lane, setLane] = useState<"trade" | "lp">(openLp ? "lp" : "trade");
  const [phone, setPhone] = useState<PhonePane>(wantedPane());
  const [mode, setMode] = useState<"market" | "limit">("market");
  const [limitPx, setLimitPx] = useState("");
  const [rests, setRests] = useState<SpotRest[]>(() => readSpotRest());
  const midRef = useRef(0);
  const busyRef = useRef(false);
  const lock = useFeeLock();

  useEffect(() => {
    const chart = () => setPhone("chart");
    const trade = () => setPhone("ticket");
    window.addEventListener("tape-chart", chart);
    window.addEventListener("tape-trade", trade);
    return () => {
      window.removeEventListener("tape-chart", chart);
      window.removeEventListener("tape-trade", trade);
    };
  }, []);

  useEffect(() => {
    if (openLp) setLane("lp");
  }, [openLp]);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    setBook("crypto");
    setPair(focus);
    setAmount("");
    setOut(null);
    setMinOut(null);
  }, [focus]);
  useEffect(() => onOpenLink(setOpenLink), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
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
    const timer = window.setInterval(pull, 8000);
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
    let dead = false;
    const listed = isErcKey(pair) ? ERC_BOOKS[pair].token : null;
    const job = pair === "okb" ? xCap(OKB.wokb) : tokenCap(pair === "bnb" ? BSC.wbnb : listed ?? BSC.bem);
    job.then((n) => { if (!dead) setSupply(n || null); }).catch(() => { if (!dead) setSupply(null); });
    return () => { dead = true; };
  }, [pair]);

  useEffect(() => {
    const listed = isErcKey(pair) ? ERC_BOOKS[pair] : null;
    const payingBnb = pair !== "okb" && pair !== "bnb" && unit === "bnb";
    const baseToken = pair === "okb" ? OKB.wokb : pair === "bnb" ? BSC.wbnb : listed ? listed.token : BSC.bem;
    const baseDecimals = listed ? listed.decimals : pair === "bem" ? BSC.bemDecimals : 18;
    const payDecimals = payingBnb && side === "buy" ? 18 : pair === "okb" ? OKB.usdtDecimals : side === "buy" ? BSC.usdtDecimals : baseDecimals;
    const outDecimals = payingBnb && side === "sell" ? 18 : side === "buy" ? baseDecimals : pair === "okb" ? OKB.usdtDecimals : BSC.usdtDecimals;
    const fee = listed ? listed.fee : pair === "bnb" ? BSC.bnbFee : BSC.fee;
    let dead = false;
    try {
      const amountIn = units(amount || "0", payDecimals);
      if (amountIn <= 0n) {
        setOut(null);
        setMinOut(null);
        setFloor(null);
        return;
      }
      const { swapIn } = splitDeskFee(amountIn);
      const digits = side === "buy" ? (pair === "btc" ? 6 : 4) : 4;
      const quoted = payingBnb
        ? quoteWithBnb(baseToken, fee, side, swapIn)
        : pair === "okb"
          ? quoteOkb(side, swapIn)
          : quoteExact(side === "buy" ? BSC.usdt : baseToken, side === "buy" ? baseToken : BSC.usdt, swapIn, fee);
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
  }, [amount, side, pair, unit]);

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

  const trade = async (min?: bigint) => {
    setBusy(true);
    busyRef.current = true;
    setBad(false);
    setNote(c.walletBusy);
    try {
      const tx = await place(side, amount, unit, min, pair);
      setHash(tx);
      rememberFill(`${side === "buy" ? "买入" : "卖出"} ${amount} ${base}`, pair === "okb" ? okbTxUrl(tx) : txUrl(tx));
      setNote(null);
    } catch (err) {
      fail(err);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const place = async (nextSide: "buy" | "sell", nextAmount: string, nextUnit: "usdt" | "bnb", min: bigint | undefined, nextPair: typeof pair) => {
    const from = nextPair === "okb" ? account ?? (await connectX()) : account ?? (await connectBsc());
    setAccount(from);
    if (!nextAmount.trim()) throw new Error("amount");
    const paying = nextPair !== "okb" && nextPair !== "bnb" && nextUnit === "bnb";
    const listed = isErcKey(nextPair) ? ERC_BOOKS[nextPair] : null;
    const tx = nextPair === "okb"
      ? await swapOkb(from, nextSide, nextAmount, min)
      : paying
        ? await swapWithBnb(from, listed ? listed.token : BSC.bem, listed ? listed.decimals : BSC.bemDecimals, listed ? listed.fee : BSC.fee, nextSide, nextAmount, min)
        : nextPair === "bnb" ? await swapBnb(from, nextSide, nextAmount, min) : isErcKey(nextPair) ? await swapListed(from, nextPair, nextSide, nextAmount, min) : await swapBem(from, nextSide, nextAmount, min);
    const n = Number(nextAmount);
    const px = Number(price);
    const usd = nextUnit === "usdt" && nextSide === "buy" ? n : px > 0 ? n * px : 0;
    markDeskFill(nextPair === "okb" ? "xlayer" : "bsc", from, "spot", usd, nextPair);
    return tx;
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

  const sellRaw = pair === "okb"
    ? (okbBal && okbBal.okb > OKB.gasReserve ? okbBal.okb - OKB.gasReserve : 0n)
    : pair === "bnb"
      ? (balances && balances.bnb > BNB_GAS_RESERVE ? balances.bnb - BNB_GAS_RESERVE : 0n)
      : isErcKey(pair)
        ? (assetBal ?? 0n)
        : (balances?.bem ?? 0n);
  const sellDec = isErcKey(pair) ? ERC_BOOKS[pair].decimals : pair === "bem" ? BSC.bemDecimals : 18;
  const usdtRaw = pair === "okb" ? (okbBal?.usdt ?? 0n) : (balances?.usdt ?? 0n);
  const usdtDec = pair === "okb" ? OKB.usdtDecimals : BSC.usdtDecimals;
  const payingBnb = pair !== "okb" && pair !== "bnb" && unit === "bnb";
  const payRaw = payingBnb && side === "buy"
    ? (balances && balances.bnb > BNB_GAS_RESERVE ? balances.bnb - BNB_GAS_RESERVE : 0n)
    : pair === "okb"
    ? (side === "buy" ? (okbBal?.usdt ?? 0n) : (okbBal?.okb ?? 0n))
    : side === "buy"
      ? (balances?.usdt ?? 0n)
      : pair === "bnb"
        ? (balances?.bnb ?? 0n)
        : isErcKey(pair)
          ? (assetBal ?? 0n)
          : (balances?.bem ?? 0n);
  const payDecimals = payingBnb && side === "buy" ? 18 : side === "buy" ? (pair === "okb" ? OKB.usdtDecimals : BSC.usdtDecimals) : isErcKey(pair) ? ERC_BOOKS[pair].decimals : pair === "bem" ? BSC.bemDecimals : 18;
  const reserve = pair === "okb" ? OKB.gasReserve : BNB_GAS_RESERVE;
  const spendCap = (pair === "bnb" || pair === "okb") && side === "sell" ? (payRaw > reserve ? payRaw - reserve : 0n) : undefined;
  const spendable = spendCap ?? payRaw;
  const base = pair === "okb" ? "OKB" : pair === "bnb" ? "BNB" : pair === "bem" ? "BEM" : pair === "btc" ? "BTC" : pair === "eth" ? "ETH" : pair === "zec" ? "ZEC" : pair === "xau" ? "XAU" : pair in STOCKS ? STOCKS[pair].en : pair;
  const stock = pair in STOCKS ? STOCKS[pair as StockKey] : null;
  const payUnit = payingBnb && side === "buy" ? "BNB" : side === "buy" ? "USDT" : base;
  const recvUnit = payingBnb && side === "sell" ? "BNB" : side === "buy" ? base : "USDT";
  let typed = 0n;
  try {
    typed = amount.trim() ? units(amount, payDecimals) : 0n;
  } catch {
    typed = 0n;
  }
  const deskFee = typed > 0n ? splitDeskFee(typed) : null;
  const over = (pair === "okb" ? Boolean(okbBal) : isErcKey(pair) ? (side === "sell" ? assetBal != null : Boolean(balances)) : Boolean(balances)) && typed > spendable;
  const pcts = [25, 50, 75, 100];
  const midN = Number(String(shown ?? price ?? "").replace(/,/g, "")) || bars.at(-1)?.c || 0;
  const openC = bars[0]?.o || bars[0]?.c || 0;
  const change = openC > 0 && midN > 0 ? (midN - openC) / openC : 0;
  const tapeRows = prints.flatMap((row) => {
    const size = Number(String(row.bem).replace(/,/g, ""));
    const usd = Number(String(row.usdt).replace(/,/g, ""));
    if (!(size > 0) || !(usd > 0)) return [];
    return [{ tx: row.tx, px: usd / size, size, usd, side: row.side }];
  });
  const asks = tapeRows.filter((row) => row.side === "sell").slice(0, 12);
  const bids = tapeRows.filter((row) => row.side === "buy").slice(0, 12);
  midRef.current = midN;
  const mineRests = rests.filter((row) => row.pair === pair);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (busyRef.current) return;
      const mid = midRef.current;
      if (!(mid > 0)) return;
      const hit = readSpotRest().find((row) => row.pair === pair && (row.side === "buy" ? mid <= row.limit : mid >= row.limit));
      if (!hit) return;
      busyRef.current = true;
      setBusy(true);
      setBad(false);
      place(hit.side, hit.amount, hit.unit, limitMin(hit.side, hit.amount, hit.limit, hit.pair, hit.unit), hit.pair)
        .then((tx) => {
          const left = readSpotRest().filter((row) => row.id !== hit.id);
          writeSpotRest(left);
          setRests(left);
          setHash(tx);
          rememberFill(`${hit.side === "buy" ? "买入" : "卖出"} ${hit.amount}`, hit.pair === "okb" ? okbTxUrl(tx) : txUrl(tx));
          setNote(null);
        })
        .catch(fail)
        .finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
    }, 4_000);
    return () => window.clearInterval(id);
  }, [pair, account]);

  return (
    <SideRail items={([
      ["crypto", lang === "zh" ? "加密货币" : "Crypto"],
      ["stock", lang === "zh" ? "美股" : "Stocks"],
      ["lp", lang === "zh" ? "流动性" : "Liquidity"],
    ] as const).map(([key, label]) => ({
      key,
      label,
      on: key === "lp" ? lane === "lp" : lane === "trade" && book === key,
      run: () => {
        if (key === "lp") { setLane("lp"); return; }
        setLane("trade");
        setBook(key);
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
    <section className="phone-desk spot-split min-w-0 overflow-hidden border border-gold bg-card" data-phone={phone}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold px-3 py-2">
        <button type="button" onClick={onMarkets} className="flex min-w-0 items-center gap-2">
          <CoinMark id={pair} />
          <span className="truncate text-lg font-medium tracking-tight">{base}/USDT</span>
          <PairChevron />
          <span className="lev-chip shrink-0 rounded px-1.5 py-0.5 text-[11px]">{lang === "zh" ? "现货" : "Spot"}</span>
        </button>
        <p className="font-mono text-sm">{midN > 0 ? midN.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"} <span className="text-[11px] text-ink/40">USDT</span></p>
        <p className={`font-mono text-sm ${change < 0 ? "text-sell" : "text-up"}`}>{midN > 0 ? `${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%` : "—"}</p>
      </div>
      {lane === "lp" ? <LpPanel /> : (
      <>
      <PhoneChrome zh={lang === "zh"} pane={phone} setPane={setPhone} sheet={false} onBuy={() => { setSide("buy"); setPhone("ticket"); }} onSell={() => { setSide("sell"); setPhone("ticket"); }} />
      <div className={`spot-grid grid min-w-0 items-start xl:grid-cols-[minmax(0,1fr)_18rem_20rem]`} data-phone={phone}>
        <div className="ph-chart order-1 min-w-0">
          <Kline
            bars={bars}
            mark={midN}
            lang={lang}
            desk="spot"
            frame={frame}
            frames={([
              ["1m", "1分", "1m"],
              ["5m", "5分", "5m"],
              ["15m", "15分", "15m"],
              ["1h", "1时", "1h"],
              ["1d", "1日", "1d"],
            ] as const).map(([id, zhLabel, enLabel]) => ({ id, label: lang === "zh" ? zhLabel : enLabel }))}
            onFrame={(id) => setFrame(id as SpotFrame)}
            onPrice={(px) => { setMode("limit"); setLimitPx(px >= 1 ? px.toFixed(4) : px.toFixed(6)); setPhone("ticket"); }}
          />
        </div>
        <div className="ph-book order-3 min-w-0 border-t border-gold xl:order-2 xl:border-t-0 xl:border-l">
          <div className="flex h-9 items-center gap-3 border-b border-gold px-3 text-xs">
            <span className="tab-on">{lang === "zh" ? "最新成交" : "Trades"}</span>
          </div>
          <div className="spot-book px-2 py-1 text-[10px] text-ink/40">
            <span>{lang === "zh" ? "价格" : "Price"}</span>
            <span className="text-right">{base}</span>
            <span className="text-right">USDT</span>
          </div>
          <div className="book-scroll max-h-[28rem] overflow-auto">
            {asks.map((level) => (
              <button key={`a-${level.tx}`} type="button" onClick={() => { setMode("limit"); setSide("buy"); setLimitPx(level.px >= 1 ? level.px.toFixed(4) : level.px.toFixed(6)); setPhone("ticket"); }} className="spot-book w-full px-2 py-[3px] text-left font-mono text-[12px]">
                <span className="text-sell">{level.px >= 1 ? level.px.toFixed(4) : level.px.toFixed(6)}</span>
                <span className="text-right text-ink/80">{level.size.toFixed(4)}</span>
                <span className="text-right text-ink/45">{level.usd.toFixed(2)}</span>
              </button>
            ))}
            <p className="border-y border-gold/30 px-2 py-1 font-mono text-sm">{midN > 0 ? midN.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</p>
            {bids.map((level) => (
              <button key={`b-${level.tx}`} type="button" onClick={() => { setMode("limit"); setSide("sell"); setLimitPx(level.px >= 1 ? level.px.toFixed(4) : level.px.toFixed(6)); setPhone("ticket"); }} className="spot-book w-full px-2 py-[3px] text-left font-mono text-[12px]">
                <span className="text-up">{level.px >= 1 ? level.px.toFixed(4) : level.px.toFixed(6)}</span>
                <span className="text-right text-ink/80">{level.size.toFixed(4)}</span>
                <span className="text-right text-ink/45">{level.usd.toFixed(2)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ph-ticket relative order-2 border-t border-gold p-3 xl:order-3 xl:border-t-0 xl:border-l">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setMode("market")} className={`h-10 text-sm ${mode === "market" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{lang === "zh" ? "市价" : "Market"}</button>
            <button type="button" onClick={() => setMode("limit")} className={`h-10 text-sm ${mode === "limit" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{lang === "zh" ? "限价" : "Limit"}</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setSide("buy")} className={`h-10 text-sm ${side === "buy" ? "bg-ink" : "quiet-buy"}`}>{lang === "zh" ? "买入" : "Buy"}</button>
            <button type="button" onClick={() => setSide("sell")} className={`h-10 text-sm ${side === "sell" ? "bg-sell text-[#fff7f8]" : "quiet-sell"}`}>{lang === "zh" ? "卖出" : "Sell"}</button>
          </div>
          <p className="mt-3 font-mono text-lg tabular-nums">{midN > 0 ? midN.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"} <span className="text-xs text-ink/45">USDT</span></p>
          <div className="mt-2 grid grid-cols-2 border border-gold/40 font-mono text-sm">
            <p className="px-2 py-2">
              <span className="block text-[10px] text-ink/45">{lang === "zh" ? "可用" : "Available"} {payUnit}</span>
              {pretty(spendable, payDecimals, 4)}
            </p>
            <p className="border-l border-gold/40 px-2 py-2">
              <span className="block text-[10px] text-ink/45">{lang === "zh" ? "约得" : "About"} {recvUnit}</span>
              {out ?? "—"}
            </p>
          </div>
          {pair !== "okb" && pair !== "bnb" ? (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <button type="button" onClick={() => setUnit("usdt")} className={`h-8 text-xs ${unit === "usdt" ? "bg-ink" : "border border-gold/40 text-ink/60"}`}>USDT</button>
              <button type="button" onClick={() => setUnit("bnb")} className={`h-8 text-xs ${unit === "bnb" ? "bg-ink" : "border border-gold/40 text-ink/60"}`}>BNB</button>
            </div>
          ) : null}
          {mode === "limit" ? (
            <label className="relative mt-2 block border border-gold/40 px-2 py-2">
              <span className="text-[11px] text-ink/45">{lang === "zh" ? "限价" : "Limit"}</span>
              <input value={limitPx} onChange={(event) => setLimitPx(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-lg outline-none" />
              {!limitPx.trim() ? <span className="pointer-events-none absolute bottom-2 right-2 max-w-[75%] truncate font-mono text-[11px] text-ink/40">{lang === "zh" ? "输入限价" : "Limit"}{midN > 0 ? ` ${midN >= 1 ? midN.toFixed(4) : midN.toFixed(6)}` : ""}</span> : null}
            </label>
          ) : (
            <p className="mt-2 flex items-center justify-between border border-gold/40 px-2 py-2 font-mono">
              <span className="text-[11px] text-ink/45">{lang === "zh" ? "价格" : "Price"}</span>
              <span>{midN > 0 ? midN.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</span>
            </p>
          )}
          <label className="mt-2 block border border-gold/40 px-2 py-2">
            <span className="text-[11px] text-ink/45">{side === "buy" ? payUnit : base}</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-lg outline-none" />
          </label>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {pcts.map((pct) => (
              <button key={pct} type="button" onClick={() => max(pct)} className="h-7 border border-gold/30 font-mono text-[11px] text-ink/60">{pct}%</button>
            ))}
          </div>
          <button type="button" className={`mt-3 h-11 w-full text-sm disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell text-[#fff7f8]"}`} disabled={busy || over || !amount.trim()} onClick={() => {
            if (mode === "limit") {
              const px = Number(limitPx);
              if (!(px > 0)) return;
              const crossed = midN > 0 && (side === "buy" ? midN <= px : midN >= px);
              if (!crossed) {
                const row: SpotRest = { id: `${Date.now()}`, pair, side, amount, limit: px, unit };
                const next = [row, ...readSpotRest()].slice(0, 24);
                writeSpotRest(next);
                setRests(next);
                setAmount("");
                return;
              }
              void trade(limitMin(side, amount, px, pair, unit) ?? floor ?? undefined);
              return;
            }
            void trade(floor ?? undefined);
          }}>
            {busy ? (lang === "zh" ? "等待钱包" : "Waiting") : lang === "zh" ? `${side === "buy" ? "买入" : "卖出"} ${base} · ${side === "buy" ? "付" : "收"} ${side === "buy" ? payUnit : recvUnit}` : `${side === "buy" ? "Buy" : "Sell"} ${base}`}
          </button>
          {note ? <p className={`mt-2 text-xs ${bad ? "text-sell" : ""}`}>{note}</p> : null}
          {mineRests.map((row) => (
            <p key={row.id} className="mt-1 flex items-center justify-between font-mono text-[11px]">
              <span>{row.side === "buy" ? (lang === "zh" ? "买" : "Buy") : lang === "zh" ? "卖" : "Sell"} {row.amount} @ {row.limit}</span>
              <button type="button" className="underline" onClick={() => { const left = readSpotRest().filter((item) => item.id !== row.id); writeSpotRest(left); setRests(left); }}>{lang === "zh" ? "撤销" : "Cancel"}</button>
            </p>
          ))}
          <TradeLog zh={lang === "zh"} />
          {hash ? (
            <a className="mt-2 block text-xs underline" href={pair === "okb" ? okbTxUrl(hash) : txUrl(hash)} target="_blank" rel="noreferrer">{c.walletTx}</a>
          ) : null}
        </div>
      </div>
      </>
      )}
    </section>
    </SideRail>
  );
}
