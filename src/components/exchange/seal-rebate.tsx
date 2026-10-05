import { useEffect, useState } from "react";
import { useExchange } from "@/lib/exchange-store";
import {
  claimRebate,
  claimRows,
  fundRebate,
  passRebate,
  qualifyRebate,
  readRebate,
  rebateText,
  LOCKED_REBATE,
  withdrawRebate,
  type ClaimRow,
  type RebateChain,
  type RebateState,
} from "@/lib/seal-rebate";
import { currentAccount, onAccount } from "@/lib/wallet";

export function SealRebateBox() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [chain, setChain] = useState<RebateChain>("xlayer");
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [state, setState] = useState<RebateState | null>(null);
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readRebate(chain, account)
        .then(async (next) => {
          if (dead) return;
          setState(next);
          if (next && account) setRows(await claimRows(chain, account));
          else setRows([]);
        })
        .catch(() => {
          if (!dead) setState(null);
        });
    };
    pull();
    return () => {
      dead = true;
    };
  }, [chain, account, busy]);

  const run = async (work: () => Promise<void>, ok: string) => {
    setBusy(true);
    setNote(zh ? "在钱包里确认。" : "Confirm in the wallet.");
    try {
      await work();
      setNote(ok);
    } catch {
      setNote(zh ? "这笔没有完成。" : "That transaction did not finish.");
    } finally {
      setBusy(false);
    }
  };

  const clerk = state && account && state.clerk.toLowerCase() === account.toLowerCase();
  const onX = state ? state.circuits !== "0x0000000000000000000000000000000000000000" : chain === "xlayer";
  const weekPay = rows.reduce((sum, row) => sum + row.pay, 0n);
  const unit = (symbol: string) => (symbol.toUpperCase().includes("USDT") ? "USDT" : symbol);
  const when = (ts: number) =>
    new Date(ts * 1000).toLocaleString(zh ? "zh-CN" : "en-SG", {
      timeZone: "Asia/Singapore",
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="mt-4 border border-gold/40 p-3">
      <h3 className="font-display text-2xl italic">{zh ? "手续费领取" : "Fee rebate"}</h3>
      <p className="mt-2 text-sm leading-relaxed">
        {zh
          ? "灯亮不会自动减费。X Layer 要自己持有三张印鉴再登记。BSC 要部署者把地址记上。池子另充，不从收费地址扣。下面两个地址已经写死，换浏览器也不会换成新合约。一个新加坡周只能领一次，从周一 0 点到下周一 0 点。这一周没领，过点就作废，下周只算新的成交。金额按撮合日志筛出来，再按代币小数换成 USDT。有推荐人时，按少付之后的手续费再减半。同一笔成交只能进一次。"
          : "Lamps do not lower the fee. Register three seals on X Layer. On BSC the deployer marks the address. The pool is funded separately. The two addresses below are locked in the page. A new browser does not switch the contract. One claim per Singapore week, Monday 00:00 to the next Monday. Miss it and that week is gone. The next week counts only new fills. The amount uses the match log, then the token decimals, so it is in USDT. With a referrer, half of the discounted fee. A deal is included once."}
      </p>
      <div className="mt-3 flex gap-2">
        {(["xlayer", "bsc"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setChain(id)}
            className={`min-h-11 border border-gold px-3 ${chain === id ? "bg-foil" : "bg-card"}`}
          >
            {id === "xlayer" ? "X Layer" : "BSC"}
          </button>
        ))}
      </div>
      {state ? (
        <p className="mt-3 break-all font-mono text-xs">{state.address}</p>
      ) : (
        <p className="mt-3 break-all font-mono text-xs">{LOCKED_REBATE[chain]}</p>
      )}
      {state ? (
        <>
          <p className="mt-3 text-sm">
            {zh ? "池子里" : "Pool"} {rebateText(state.balance, state.decimals, unit(state.symbol))}
            {state.passed ? (zh ? " · 已登记" : " · registered") : zh ? " · 还没登记" : " · not registered"}
          </p>
          <p className="mt-2 font-mono text-lg tabular-nums">
            {zh ? "本周可领" : "This week"} {rebateText(weekPay, state.decimals, unit(state.symbol))}
          </p>
          <p className="text-xs text-ink/60">
            {state.symbol === "USDT" ? (zh ? "单位是 USDT，已按代币小数换算。" : "Shown in USDT, converted by the token decimals.") : zh ? `链上代币是 ${state.symbol}，上面对的是 1 ${state.symbol} = 1 USDT 的个数，不是最小单位。` : `The token is ${state.symbol}. The number above is whole tokens, not raw units.`}
          </p>
          <p className="mt-1 text-xs text-ink/60">{zh ? "晶体管那本账没有撮合时间，不算进本周。" : "The transistor book has no match time, so it is not in this week."}</p>
          <p className="mt-1 text-xs text-ink/60">
            {state.claimedThisWeek
              ? zh
                ? `本周已经领过。下一次从 ${when(state.resetAt)}（新加坡）重新计算。`
                : `Already claimed this week. Next count starts ${when(state.resetAt)} Singapore.`
              : zh
                ? `没领就过 ${when(state.resetAt)}（新加坡周一 0 点）作废。`
                : `Unclaimed after ${when(state.resetAt)} Singapore is dropped.`}
          </p>
          {!state.weekly ? <p className="mt-2 text-sm text-sell">{zh ? "这份还是旧合约，没有按周领取。重新部署一份再用。" : "This rebate is the old contract. Deploy the weekly one."}</p> : null}
          <div className="mt-3 flex gap-2">
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="min-h-11 min-w-0 flex-1 border border-gold bg-card px-3"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => fundRebate(chain, amount), zh ? "已充进领取合约。" : "Funded.")}
              className="min-h-11 border border-gold px-3 disabled:opacity-60"
            >
              {zh ? "充进去" : "Fund"}
            </button>
            {clerk ? (
              <button
                type="button"
                disabled={busy || state.balance === 0n}
                onClick={() => run(() => withdrawRebate(chain, amount), zh ? "已从池子取回。" : "Withdrawn from the pool.")}
                className="min-h-11 border border-gold px-3 disabled:opacity-60"
              >
                {zh ? "取回" : "Withdraw"}
              </button>
            ) : null}
          </div>
          {onX && !state.passed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => qualifyRebate(), zh ? "三盏灯已登记，可以领了。" : "The three lamps are registered.")}
              className="mt-3 min-h-12 w-full border border-gold disabled:opacity-60"
            >
              {zh ? "用这三盏灯登记" : "Register these three lamps"}
            </button>
          ) : null}
          {!onX && clerk && account && !state.passed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => passRebate(account), zh ? "这个地址已记上。" : "This address is marked.")}
              className="mt-3 min-h-12 w-full border border-gold disabled:opacity-60"
            >
              {zh ? "把这个钱包记上" : "Mark this wallet"}
            </button>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy || !state.passed || !state.weekly || state.claimedThisWeek || rows.length === 0 || weekPay === 0n || weekPay > state.balance}
              onClick={() => run(() => claimRebate(chain, rows), zh ? `已领取 ${rebateText(weekPay, state.decimals, unit(state.symbol))}。` : `Claimed ${rebateText(weekPay, state.decimals, unit(state.symbol))}.`)}
              className="min-h-12 border border-gold bg-ink px-3 text-paper disabled:opacity-60"
            >
              {zh ? "领取本周" : "Claim this week"}
            </button>
            {weekPay > state.balance ? <p className="text-sm text-sell">{zh ? "池子里的 USDT 不够付这一周。" : "The pool does not hold enough USDT for this week."}</p> : null}
            {rows.map((row) => (
              <p key={`${row.book}-${row.id.toString()}`} className="font-mono text-xs">
                #{row.id.toString()} · {rebateText(row.pay, state.decimals, unit(state.symbol))}
              </p>
            ))}
            {state.passed && !state.claimedThisWeek && rows.length === 0 ? <p className="text-sm">{zh ? "本周没有可领的成交。" : "No fill to claim this week."}</p> : null}
          </div>
        </>
      ) : null}
      {note ? <p className="mt-2 text-sm leading-relaxed">{note}</p> : null}
    </div>
  );
}
