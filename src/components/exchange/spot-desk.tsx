import { useEffect, useState } from "react";
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
  FEE_TO,
  pretty,
  quoteExact,
  readBalances,
  recentPrints,
  splitDeskFee,
  swapBem,
  swapBnb,
  txUrl,
  units,
  type Balances,
  type PoolPrint,
} from "@/lib/bsc";
import { currentAccount, onAccount } from "@/lib/wallet";
import { SignCard } from "@/components/exchange/sign-card";
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
  const [pair, setPair] = useState<"bem" | "bnb">("bem");
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
  const lock = useFeeLock();

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      const priceOf = pair === "bnb" ? bnbPrice : bemPrice;
      priceOf().then((text) => {
        if (!dead) setPrice(text);
      }).catch(() => undefined);
      recentPrints(pair).then((rows) => {
        if (!dead) setPrints(rows);
      }).catch(() => undefined);
      const who = account ?? currentAccount();
      if (who) readBalances(who).then((next) => {
        if (!dead) setBalances(next);
      }).catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 4000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [account, hash, pair]);

  useEffect(() => {
    const base = pair === "bnb" ? BSC.wbnb : BSC.bem;
    const baseDecimals = pair === "bnb" ? 18 : BSC.bemDecimals;
    const tokenIn = side === "buy" ? BSC.usdt : base;
    const tokenOut = side === "buy" ? base : BSC.usdt;
    const decimals = side === "buy" ? BSC.usdtDecimals : baseDecimals;
    const outDecimals = side === "buy" ? baseDecimals : BSC.usdtDecimals;
    const fee = pair === "bnb" ? BSC.bnbFee : BSC.fee;
    let dead = false;
    try {
      const amountIn = units(amount || "0", decimals);
      if (amountIn <= 0n) {
        setOut(null);
        setMinOut(null);
        return;
      }
      const { swapIn } = splitDeskFee(amountIn);
      const digits = side === "buy" ? (pair === "bnb" ? 6 : 4) : 2;
      quoteExact(tokenIn, tokenOut, swapIn, fee)
        .then((quoted) => {
          if (!dead) {
            setOut(pretty(quoted, outDecimals, digits));
            setMinOut(pretty((quoted * BigInt(10_000 - BSC.slippageBps)) / 10_000n, outDecimals, digits));
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

  const trade = async () => {
    setBusy(true);
    setBad(false);
    setNote(c.walletBusy);
    try {
      const from = account ?? (await connectBsc());
      setAccount(from);
      if (!amount.trim()) return;
      const tx = pair === "bnb" ? await swapBnb(from, side, amount) : await swapBem(from, side, amount);
      setHash(tx);
      setNote(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const max = (pct: number) => {
    if (!balances) return;
    const raw = side === "buy" ? balances.usdt : pair === "bnb" ? balances.bnb : balances.bem;
    const decimals = side === "buy" ? BSC.usdtDecimals : pair === "bnb" ? 18 : BSC.bemDecimals;
    const cap = pair === "bnb" && side === "sell" && raw > BNB_GAS_RESERVE ? raw - BNB_GAS_RESERVE : undefined;
    setAmount(sized(raw, decimals, pct, cap));
  };

  const payRaw = balances ? (side === "buy" ? balances.usdt : pair === "bnb" ? balances.bnb : balances.bem) : 0n;
  const payDecimals = side === "buy" ? BSC.usdtDecimals : pair === "bnb" ? 18 : BSC.bemDecimals;
  const spendCap = pair === "bnb" && side === "sell" ? (payRaw > BNB_GAS_RESERVE ? payRaw - BNB_GAS_RESERVE : 0n) : undefined;
  const spendable = spendCap ?? payRaw;
  const base = pair === "bnb" ? "BNB" : "BEM";
  const payUnit = side === "buy" ? "USDT" : base;
  const recvUnit = side === "buy" ? base : "USDT";
  let typed = 0n;
  try {
    typed = amount.trim() ? units(amount, payDecimals) : 0n;
  } catch {
    typed = 0n;
  }
  const deskFee = typed > 0n ? splitDeskFee(typed) : null;
  const over = Boolean(balances) && typed > spendable;
  const pcts = [25, 50, 75, 100];

  return (
    <section className="border border-gold bg-card shadow-plate">
      <div className="grid gap-0 lg:grid-cols-12">
        <div className="border-b border-gold/40 p-3 lg:col-span-7 lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs tracking-widest text-gold">{base} / USDT</p>
            <div className="grid grid-cols-2">
              {(["bem", "bnb"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setPair(key);
                    setAmount("");
                    setOut(null);
                    setMinOut(null);
                    setPrice(null);
                  }}
                  className={`min-h-8 border border-gold px-3 font-mono text-xs ${pair === key ? "bg-ink text-paper" : ""}`}
                >
                  {key === "bem" ? "BEM" : "BNB"}
                </button>
              ))}
            </div>
          </div>
          <p className="font-display text-5xl italic leading-none tabular-nums">{shown ? `$${shown}` : "—"}</p>
          <p className="mt-1 font-mono text-xs text-ink/50">
            {pair === "bnb"
              ? lang === "zh"
                ? "Pancake BNB / USDT · 池费率 0.01% · 买到的是钱包里的 BNB"
                : "Pancake BNB / USDT · pool fee 0.01% · a buy lands as BNB"
              : lang === "zh"
                ? "Pancake 池子报价 · 每秒从链上读"
                : "Pancake pool quote · read every second"}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink/80">{c.realNote}</p>
          <h2 className="mt-4 text-xs tracking-widest text-gold">{c.poolPrints}</h2>
          <ul className="mt-2 divide-y divide-gold/30">
            {prints.length === 0 ? <li className="py-3 text-sm text-ink/60">{lang === "zh" ? "当前区间无成交" : "No trades in this window"}</li> : null}
            {prints.map((row) => (
              <li key={row.id}>
                <a className="flex items-baseline justify-between gap-3 py-2 font-mono text-sm tabular-nums" href={txUrl(row.tx)} target="_blank" rel="noreferrer">
                  <span className={row.side === "buy" ? "text-gold" : "text-sell"}>{row.side === "buy" ? c.buy : c.sell}</span>
                  <span className="min-w-0 truncate">{row.bem} {base}</span>
                  <span className="text-ink/70">{row.usdt}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <form
          className="flex flex-col gap-3 p-3 lg:col-span-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (lock.status !== "ok" || over || !amount.trim()) return;
            setCard(true);
          }}
        >
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
              [
                ["BEM", balances ? pretty(balances.bem, BSC.bemDecimals, 4) : "—"],
                ["USDT", balances ? pretty(balances.usdt, BSC.usdtDecimals, 2) : "—"],
                ["BNB", balances ? pretty(balances.bnb, 18, 4) : "—"],
              ] as const
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
          <p className="text-xs text-ink/70">
            {c.slippage} 1% · PancakeSwap V3 · {lang === "zh" ? "台费在池子手续费之外另收" : "Desk fee is on top of the pool fee"} {(DESK_FEE_BPS / 100).toFixed(2)}% ·{" "}
            <a className="underline decoration-gold underline-offset-4" href={`${BSC.explorer}/address/${FEE_TO}`} target="_blank" rel="noreferrer">
              {FEE_TO}
            </a>
            {pair === "bnb" && side === "sell" ? (lang === "zh" ? " · 留下 0.003 BNB 付 gas" : " · 0.003 BNB stays for gas") : ""}
          </p>
          <button type="submit" className="min-h-12 bg-ink text-paper disabled:opacity-40" disabled={busy || over || lock.status !== "ok" || (Boolean(account) && !amount.trim())}>
            {account ? `${side === "buy" ? c.buy : c.sell} ${base}` : c.walletConnect}
          </button>
          {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
          {hash ? (
            <a className="text-sm underline decoration-gold underline-offset-4" href={txUrl(hash)} target="_blank" rel="noreferrer">
              {c.walletTx}
            </a>
          ) : null}
          {card ? (
            <SignCard
              title={lang === "zh" ? "签名前看一眼" : "Before you sign"}
              yes={lang === "zh" ? "确认并签名" : "Confirm and sign"}
              no={lang === "zh" ? "取消" : "Cancel"}
              warn={lang === "zh" ? "这是 BSC 现货。不会和 X Layer 的单合成一笔。钱包若不在 BSC，签名前会切过去。" : "This is BSC spot. It does not net with an X Layer order. If the wallet is on another chain, it switches to BSC before the signature."}
              onNo={() => setCard(false)}
              onYes={() => {
                setCard(false);
                void trade();
              }}
              lines={[
                { k: lang === "zh" ? "链" : "Chain", v: "BNB Smart Chain · 56" },
                { k: lang === "zh" ? "路由" : "Router", v: BSC.router, href: `${BSC.explorer}/address/${BSC.router}` },
                { k: lang === "zh" ? "钱去哪" : "Where funds go", v: lang === "zh" ? "成交的币留在钱包。千分之二先进收费地址，剩下的才进池子。这千分之二加在 Pancake 池子手续费之外。" : "The fill stays in the wallet. 0.2% goes to the fee address first. The rest goes to the pool. That 0.2% is on top of the Pancake pool fee." },
                { k: lang === "zh" ? "付出" : "Pay", v: `${amount || "—"} ${payUnit}` },
                { k: lang === "zh" ? "本单台费" : "Fee", v: `${deskFee ? pretty(deskFee.fee, payDecimals, 4) : "—"} ${payUnit}` },
                { k: lang === "zh" ? "收费地址" : "Fee address", v: FEE_TO, href: `${BSC.explorer}/address/${FEE_TO}` },
                { k: lang === "zh" ? "预估到账" : "Estimate", v: `${out ?? "—"} ${recvUnit}` },
                { k: lang === "zh" ? "最少到账 · 滑点 1%" : "Minimum · 1% slippage", v: `${minOut ?? "—"} ${recvUnit}` },
              ]}
            />
          ) : null}
        </form>
      </div>
    </section>
  );
}
