import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "viem";
import { bscBemBalance, BSC_BRIDGE, payBridgeFee, quoteBridge, sendBridge, type BridgeQuote } from "@/lib/bem-bridge";
import { deskParts } from "@/lib/invite-cut";
import { bemPrice, BSC } from "@/lib/bsc";
import { openTapePrice, TAPE_BEM } from "@/lib/tape-pool";
import {
  deployDesk,
  deskAddress,
  deskText,
  fundUsdt,
  readDesk,
  sellTape,
  TAPE_BUYER,
  units,
  wholeTape,
  withdrawBought,
  withdrawUsdt,
  type DeskState,
} from "@/lib/tape-desk";
import {
  asTerm,
  claimTermBem,
  claimTermTape,
  deployTerm,
  fundTermBem,
  fundTermTape,
  readTerm,
  stakeTermBem,
  stakeTermTape,
  termAddress,
  unstakeTermBem,
  unstakeTermTape,
  withdrawTermBem,
  withdrawTermTape,
  type TermLock,
  type TermState,
} from "@/lib/tape-term";
import { XLAYER } from "@/lib/xlayer";

const TERMS = [
  { id: 0, zh: "三个月", en: "3 mo" },
  { id: 1, zh: "六个月", en: "6 mo" },
  { id: 2, zh: "九个月", en: "9 mo" },
  { id: 3, zh: "一年", en: "1 yr" },
  { id: 4, zh: "两年", en: "2 yr" },
  { id: 5, zh: "三年", en: "3 yr" },
] as const;

function termLabel(id: number, zh: boolean): string {
  return TERMS.find((row) => row.id === id)?.[zh ? "zh" : "en"] ?? "—";
}

function sgWhen(unix: bigint): string {
  const ms = Number(unix) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const text = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return `${text} SGT`;
}

export function OfficialBridge({ account, zh, xBem, bare = false }: { account: string | null; zh: boolean; xBem: bigint | null; bare?: boolean }) {
  const [open, setOpen] = useState(bare);
  const [toX, setToX] = useState(true);
  const [amt, setAmt] = useState("");
  const [bscBal, setBscBal] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [net, setNet] = useState<bigint | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [quoteBad, setQuoteBad] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const amount = /^[0-9]*\.?[0-9]+$/.test(amt.trim()) ? (() => { try { return units(amt, 8); } catch { return null; } })() : null;

  useEffect(() => {
    if (!open || !account) return;
    let dead = false;
    bscBemBalance(account).then((value) => { if (!dead) setBscBal(value); }).catch(() => { if (!dead) setBscBal(null); });
    return () => { dead = true; };
  }, [open, account, busy]);

  useEffect(() => {
    if (!amount) { setNet(null); setFee(null); return; }
    if (!account) {
      const cut = (amount * 20n) / 10_000n;
      setFee(cut);
      setNet(amount - cut);
      return;
    }
    let dead = false;
    deskParts(toX ? "bsc" : "xlayer", account, amount)
      .then((parts) => { if (!dead) { setFee(parts.reward + parts.desk); setNet(parts.swapIn); } })
      .catch(() => { if (!dead) { const cut = (amount * 20n) / 10_000n; setFee(cut); setNet(amount - cut); } });
    return () => { dead = true; };
  }, [account, toX, amount]);

  useEffect(() => {
    if (!open || !account || !net || net <= 0n) { setQuote(null); setQuoteBad(false); return; }
    let dead = false;
    setQuoteBad(false);
    quoteBridge(toX, account, net).then((next) => { if (!dead) setQuote(next); }).catch(() => { if (!dead) { setQuote(null); setQuoteBad(true); } });
    return () => { dead = true; };
  }, [open, account, toX, net]);

  const body = (
    <div className="grid gap-2">
      <p className="text-xs leading-5 text-ink/60">{zh ? "BEM 走 TapeOut 已经在用的桥。BSC 锁住，X Layer 铸出，回来则烧掉。本站另收 0.20%，先付。桥自己留下的是另一笔。台费不退。TAPE 没有桥。" : "BEM uses the bridge TapeOut already runs. BSC locks it and X Layer mints it. The return burns it. This site takes 0.20% first. The bridge keeps its own cut. The site fee is not returned. TAPE has no bridge."}</p>
      <div className="grid grid-cols-2 border border-gold text-sm">
        <button type="button" className={`min-h-11 ${toX ? "bg-ink text-paper" : ""}`} onClick={() => setToX(true)}>BSC → X Layer</button>
        <button type="button" className={`min-h-11 ${!toX ? "bg-ink text-paper" : ""}`} onClick={() => setToX(false)}>X Layer → BSC</button>
      </div>
      <label className="border border-gold px-3 py-2">
        <span className="flex items-center justify-between text-xs text-ink/55">
          <span>{zh ? "你支付" : "You pay"}</span>
          <button type="button" className="font-mono" onClick={() => { const bal = toX ? bscBal : xBem; if (bal && bal > 0n) setAmt(formatUnits(bal, 8)); }}>{zh ? "余额" : "Balance"} {toX ? (bscBal == null ? "—" : deskText(bscBal, 8)) : (xBem == null ? "—" : deskText(xBem, 8))} BEM</button>
        </span>
        <span className="mt-1 flex items-baseline gap-2">
          <input value={amt} onChange={(event) => setAmt(event.target.value)} inputMode="decimal" placeholder="0" className="w-full bg-transparent font-mono text-3xl outline-none" />
          <span className="font-mono text-sm">BEM</span>
        </span>
      </label>
      <p className="border border-gold/40 px-3 py-2">
        <span className="block text-xs text-ink/55">{zh ? "你收到" : "You receive"}</span>
        <span className="font-mono text-2xl tabular-nums">{quote ? deskText(quote.received, 8) : "—"} BEM</span>
      </p>
      <p className="font-mono text-xs leading-5 text-ink/70">
        {zh ? "台费" : "Site fee"} {fee == null ? "—" : deskText(fee, 8)} BEM
        {" · "}
        {zh ? "桥留下" : "Bridge keeps"} {quote ? deskText(quote.sent - quote.received, 8) : "—"} BEM
        {" · "}
        {toX ? "BNB" : "OKB"} {quote ? formatEther(quote.nativeFee) : "—"}
      </p>
      {quoteBad ? <p className="text-sm text-sell">{zh ? "报价没读到。数量改一下，或稍后再试。" : "The quote did not come back. Change the amount, or try again."}</p> : null}
      <button type="button" disabled={busy || !account || !amount || !net || !quote} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => {
        if (!account || !amount || !net) return;
        setBusy(true);
        let paid = false;
        payBridgeFee(toX, account, amount).then(() => { paid = true; return sendBridge(toX, account, net); }).then(() => { setBad(false); setNote(zh ? "已提交。到账要等桥的消息，不是这一笔里立刻到。" : "Submitted. It arrives with the bridge message, not in this transaction."); }).catch((error: unknown) => {
          setBad(true);
          const text = error instanceof Error ? error.message : "";
          setNote(paid ? (zh ? "台费已付，没有跨过去。这一笔不退。BEM 的其余还在原来的链上。" : "The site fee was paid and the bridge did not finish. That fee is not returned. The rest of the BEM is still on the original chain.") : /rejected|denied|4001/i.test(text) ? (zh ? "你取消了。" : "You cancelled.") : /insufficient funds/i.test(text) ? (zh ? `${toX ? "BNB" : "OKB"} 不够付桥的 gas。币还在原来的链上。` : `Not enough ${toX ? "BNB" : "OKB"} for the bridge gas. The BEM stayed on the original chain.`) : /exceeds balance|transfer amount/i.test(text) ? (zh ? "BEM 不够。还在原来的链上。" : "Not enough BEM. It stayed on the original chain.") : (zh ? "没有跨过去。BEM 还在原来的链上。" : "It did not cross. The BEM is still on the original chain."));
        }).finally(() => setBusy(false));
      }}>{toX ? (zh ? "签名转到 X Layer" : "Sign to X Layer") : (zh ? "签名转回 BSC" : "Sign back to BSC")}</button>
      <p className="break-all font-mono text-[11px] text-ink/40">
        <a className="underline" href={`${BSC.explorer}/address/${BSC_BRIDGE}`} target="_blank" rel="noreferrer">BSC {BSC_BRIDGE}</a>
        {" · "}
        <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_BEM}`} target="_blank" rel="noreferrer">X Layer {TAPE_BEM}</a>
      </p>
      {note ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );

  if (bare) return body;

  return (
    <div className="mt-3 border border-gold/40">
      <button type="button" className="flex min-h-11 w-full items-center justify-between px-3 text-left" onClick={() => setOpen((value) => !value)}>
        <span className="text-sm">{zh ? "TapeOut 跨链" : "TapeOut bridge"}</span>
        <span className="text-xs text-ink/50">{open ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {open ? <div className="border-t border-gold/30 px-3 py-3">{body}</div> : null}
    </div>
  );
}

function LockList({ locks, zh, busy, empty, onTake }: { locks: TermLock[]; zh: boolean; busy: boolean; empty: string; onTake: (index: number) => void }) {
  const open = locks.filter((row) => row.open);
  if (open.length === 0) return <p className="text-xs text-ink/50">{empty}</p>;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return (
    <ul className="grid gap-2">
      {open.map((row) => {
        const ready = now >= row.unlock;
        return (
          <li key={row.index} className="grid gap-2 border border-gold/40 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <p className="min-w-0 text-xs leading-5">
              <span className="font-mono">{deskText(row.amount, 8)}</span>
              {" · "}
              {termLabel(row.term, zh)}
              <span className="block text-ink/55">{zh ? "到期，新加坡时间" : "Unlocks, Singapore"} {sgWhen(row.unlock)}</span>
            </p>
            <button type="button" disabled={busy || !ready} className="min-h-11 w-full border border-gold px-3 text-sm disabled:opacity-40 sm:w-auto" onClick={() => onTake(row.index)}>
              {ready ? (zh ? "取回本金" : "Take principal") : (zh ? "到期再取" : "After expiry")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Figure({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="min-w-0 border border-gold/50 bg-paper/80 px-3 py-2">
      <p className="text-[11px] tracking-[0.16em] text-gold">{k}</p>
      <p className="break-all font-mono text-base leading-7 sm:text-lg">{v}</p>
      {sub ? <p className="break-all text-xs leading-5 text-ink/70">{sub}</p> : null}
    </div>
  );
}

function Yield({ label, value, quiet }: { label: string; value: string; quiet?: string }) {
  return (
    <div className="shrink-0 border border-gold/40 bg-paper px-3 py-2 text-right">
      <p className="text-[11px] tracking-[0.22em] text-gold">{label}</p>
      <p className="font-display text-4xl italic leading-none tabular-nums text-[color-mix(in_srgb,#8a5a12_65%,var(--color-ink))] lg:text-5xl">{value}</p>
      {quiet ? <p className="mt-1 max-w-40 text-[11px] leading-4 text-ink/50">{quiet}</p> : null}
    </div>
  );
}

function apy(pot: bigint, potDec: number, potPx: number | null, staked: bigint, stakeDec: number, stakePx: number | null): string {
  if (!potPx || !stakePx || staked === 0n) return "—";
  if (pot === 0n) return "0";
  const reward = Number(pot) / 10 ** potDec * potPx;
  const base = Number(staked) / 10 ** stakeDec * stakePx;
  if (!Number.isFinite(reward) || !Number.isFinite(base) || base <= 0) return "—";
  return (reward / base * 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function TapeDesk({ account, zh }: { account: string | null; zh: boolean }) {
  const [desk, setDesk] = useState<string | null>(() => deskAddress());
  const [term, setTerm] = useState<string | null>(() => termAddress());
  const [row, setRow] = useState<DeskState | null>(null);
  const [stake, setStake] = useState<TermState | null>(null);
  const [miss, setMiss] = useState(false);
  const [stakeMiss, setStakeMiss] = useState(false);
  const [tapePx, setTapePx] = useState<number | null>(null);
  const [bemPx, setBemPx] = useState<number | null>(null);
  const [sellAmt, setSellAmt] = useState("");
  const [usdtAmt, setUsdtAmt] = useState("");
  const [tapeAmt, setTapeAmt] = useState("");
  const [bemAmt, setBemAmt] = useState("");
  const [tapeTerm, setTapeTerm] = useState(0);
  const [bemTerm, setBemTerm] = useState(0);
  const [tapeAck, setTapeAck] = useState(false);
  const [bemAck, setBemAck] = useState(false);
  const [rewardTape, setRewardTape] = useState("");
  const [rewardBem, setRewardBem] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDesk(deskAddress());
    setTerm(termAddress());
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (desk) {
        readDesk(account).then((next) => { if (!dead && next) { setRow(next); setMiss(false); } }).catch(() => { if (!dead) setMiss(true); });
      }
      if (term) {
        readTerm(account).then((next) => { if (!dead && next) { setStake(next); setStakeMiss(false); } }).catch(() => { if (!dead) setStakeMiss(true); });
      }
      openTapePrice().then((px) => { if (!dead) setTapePx(px); }).catch(() => { if (!dead) setTapePx(null); });
      bemPrice().then((text) => { if (!dead) setBemPx(Number(text.replace(/,/g, "")) || null); }).catch(() => { if (!dead) setBemPx(null); });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account, desk, term]);

  const run = (task: () => Promise<unknown>, ok: string, refresh: "desk" | "term", kind: "usdt" | "stake" | "reward" | "unvest" = "usdt") => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。这一页不会跳进 OKX。" : "Sign in at the top right. This page stays here.");
      return;
    }
    setBusy(true);
    Promise.resolve()
      .then(task)
      .then(async () => {
        setBad(false);
        setNote(ok);
        if (refresh === "desk") {
          const next = await readDesk(account);
          if (next) setRow(next);
        } else {
          const next = await readTerm(account);
          if (next) setStake(next);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        const code = (err as { code?: number }).code;
        setBad(true);
        if (message === "amount" || message === "integer") {
          setNote(kind === "stake"
            ? (zh ? "先填要锁的数量，或点全部。" : "Enter the amount to lock, or tap All.")
            : kind === "reward"
              ? (zh ? "先填要充入的奖励数量。" : "Enter the reward amount.")
              : (zh ? "数量是空的，或不是数字。充 USDT 先在右边那一格填写，或点全部。卖 TAPE 只能填整数。" : "The amount is empty or not a number. Type the USDT on the right, or tap All. TAPE sells are whole numbers."));
          return;
        }
        if (code === 4001) {
          setNote(kind === "usdt"
            ? (zh ? "签名取消了。USDT 还在钱包，没有充进去。" : "The signature was cancelled. The USDT is still in the wallet.")
            : (zh ? "签名取消了。币还在钱包，没有锁上，也没有充进奖励。" : "The signature was cancelled. The coins are still in the wallet."));
          return;
        }
        setNote(kind === "stake"
          ? (zh ? "没有锁上。要签两笔：第一笔只授权，币还在钱包；第二笔才锁进期限合约。两笔都要确认。Gas Limit 填 500000。" : "It did not lock. Two signatures: the first only approves and the coins stay in the wallet; the second locks them. Confirm both. Set Gas Limit to 500000.")
          : kind === "unvest"
            ? (zh ? "没有取回来。刷新后再点一次。已经按 365 天开始分出去的那一点不能退，其余的可以退。" : "It did not come back. Refresh and tap it once more. The trace that already started vesting over 365 days cannot be returned. The rest can.")
            : kind === "reward"
            ? (zh ? "奖励没有充进去。要签两笔：第一笔只授权；第二笔才充入。两笔都要确认。Gas Limit 填 500000。" : "The reward did not go in. Two signatures: approve, then deposit. Confirm both. Set Gas Limit to 500000.")
            : (zh ? "没有充进去。要签两笔：第一笔只授权，币还在钱包；第二笔才进回购。两笔都要确认。地址是上面这一份。Gas Limit 填 500000。" : "It did not go in. Two signatures: the first only approves, the coins stay in the wallet; the second deposits. Confirm both. The address is the one above. Set Gas Limit to 500000."));
      })
      .finally(() => setBusy(false));
  };

  const deploy = () => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。" : "Sign in at the top right.");
      return;
    }
    setBusy(true);
    deployDesk(account).then((addr) => {
      setDesk(addr);
      setBad(false);
      setNote(zh ? `已部署 ${addr}。地址写入页面后，全站使用这一份。` : `Deployed ${addr}. The site uses this address after it is written into the page.`);
    }).catch(() => {
      setBad(true);
      setNote(zh ? "没有部署。留在这一页。Gas Limit 填 5000000。" : "It did not deploy. Stay on this page. Set Gas Limit to 5000000.");
    }).finally(() => setBusy(false));
  };

  const deployLocks = () => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。" : "Sign in at the top right.");
      return;
    }
    setBusy(true);
    deployTerm(account).then((addr) => {
      setTerm(addr);
      setBad(false);
      setNote(zh ? `期限质押已部署 ${addr}。地址写入页面前，仅本机可见。` : `Timed stake deployed at ${addr}. Only this browser can see it until the address is written into the page.`);
    }).catch(() => {
      setBad(true);
      setNote(zh ? "期限质押没有部署。留在这一页。Gas Limit 填 5000000。" : "Timed stake did not deploy. Stay on this page. Set Gas Limit to 5000000.");
    }).finally(() => setBusy(false));
  };

  const lock = (side: "tape" | "bem") => {
    const ack = side === "tape" ? tapeAck : bemAck;
    const text = side === "tape" ? tapeAmt : bemAmt;
    const wallet = side === "tape" ? stake?.tapeBal : stake?.bemBal;
    const coin = side === "tape" ? "TAPE" : "BEM";
    if (!ack) {
      setBad(true);
      setNote(zh ? `先勾确认。这笔 ${coin} 到期前不能取回本金。` : `Tick the box first. This ${coin} cannot leave before the term ends.`);
      return;
    }
    let amount: bigint;
    try {
      amount = units(text, 8);
    } catch {
      setBad(true);
      setNote(zh ? `先填要锁的 ${coin}，或点全部。` : `Enter the ${coin} to lock, or tap All.`);
      return;
    }
    if (wallet !== undefined && amount > wallet) {
      setBad(true);
      setNote(zh ? `钱包里的 ${coin} 不够这一笔。` : `The wallet does not have enough ${coin}.`);
      return;
    }
    if (side === "tape") {
      run(() => stakeTermTape(account ?? "", amount, asTerm(tapeTerm)), zh ? "TAPE 已按期限锁定。" : "TAPE is locked for the term.", "term", "stake");
    } else {
      run(() => stakeTermBem(account ?? "", amount, asTerm(bemTerm)), zh ? "BEM 已按期限锁定。" : "BEM is locked for the term.", "term", "stake");
    }
  };

  const maxTape = row && row.usdtPool > 0n ? row.usdtPool / 100_000n : 0n;
  const tapeApy = stake ? apy(stake.bemPot, 8, bemPx, stake.tapeStakedTotal, 8, tapePx) : "—";
  const bemApy = stake ? apy(stake.tapePot, 8, tapePx, stake.bemStakedTotal, 8, bemPx) : "—";
  const openTape = stake?.tapeLocks.filter((lock) => lock.open).length ?? 0;
  const openBem = stake?.bemLocks.filter((lock) => lock.open).length ?? 0;

  return (
    <section className="grid gap-4">
      <article className="border border-gold bg-card">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/50 bg-foil/70 px-4 py-3">
          <div>
            <p className="text-[11px] tracking-[0.22em] text-gold">{zh ? "回购" : "Buyback"}</p>
            <h2 className="font-display text-3xl italic leading-none sm:text-4xl">1 TAPE = 0.1 USDT</h2>
          </div>
          <p className="font-mono text-sm">{zh ? "池子可付" : "Pool can pay"} {desk && row ? deskText(row.usdtPool, 6, 2) : "—"} USDT</p>
        </div>
        <div className="px-4 py-3">
        {!desk ? (
          <>
            <p className="text-sm leading-6">{zh ? "新回购还没部署。只有买方地址能充 USDT 和取回剩余。下面的质押不靠这份合约，现在就能看。" : "The new buyback is not deployed yet. Only the buyer address can deposit USDT and take back what is left. Stake below does not use this contract and can be read now."}</p>
            <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-ink text-sm text-paper disabled:opacity-40 sm:w-auto sm:px-6" onClick={deploy}>{zh ? "部署回购合约" : "Deploy the buyback"}</button>
          </>
        ) : (
          <>
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="grid gap-1 text-xs text-ink/55">
            {zh ? "卖出整数枚" : "Sell whole TAPE"}
            <div className="flex gap-2">
              <input value={sellAmt} onChange={(event) => setSellAmt(event.target.value)} inputMode="numeric" placeholder="1" className="min-h-12 min-w-0 flex-1 border border-gold/50 bg-paper px-2 font-mono text-base text-ink" />
              <button type="button" disabled={busy} className="min-h-12 shrink-0 bg-ink px-5 text-sm text-paper disabled:opacity-40" onClick={() => run(() => sellTape(account ?? "", wholeTape(sellAmt)), zh ? "已换成 USDT。" : "Sold for USDT.", "desk")}>{zh ? "卖出" : "Sell"}</button>
            </div>
            <span>{zh ? "钱包" : "Wallet"} {row ? deskText(row.tapeBal, 8) : "—"} TAPE · {zh ? "每枚 0.1，到账" : "0.1 each, you get"} {/^[1-9]\d*$/.test(sellAmt.trim()) ? (Number(sellAmt.trim()) * 0.1).toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"} USDT</span>
          </label>
          {account?.toLowerCase() === TAPE_BUYER.toLowerCase() ? (
          <label className="grid gap-1 text-xs text-ink/55">
            {zh ? "买方充入 USDT" : "Buyer deposits USDT"}
            <input value={usdtAmt} onChange={(event) => setUsdtAmt(event.target.value)} inputMode="decimal" placeholder="100" className="min-h-12 border border-gold/50 bg-paper px-2 font-mono text-base text-ink" />
            <span>{zh ? "钱包" : "Wallet"} {row ? deskText(row.usdtBal, 6, 2) : "—"} · {zh ? "可取回" : "Unspent"} {row ? deskText(row.usdtLeft, 6, 2) : "—"} USDT · {zh ? "已买到" : "Bought"} {row ? deskText(row.tapeOwed, 8) : "—"} TAPE</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button type="button" disabled={busy || !row || row.usdtBal === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => setUsdtAmt(row ? formatUnits(row.usdtBal, 6) : "")}>{zh ? "全部" : "All"}</button>
              <button type="button" disabled={busy} className="min-h-12 bg-ink px-1 text-sm text-paper disabled:opacity-40" onClick={() => run(() => fundUsdt(account ?? "", units(usdtAmt, 6)), zh ? "USDT 已充入。池子要等这一页重新读到才变。" : "USDT is in. The pool changes when this page reads it again.", "desk")}>{zh ? "充入" : "Add"}</button>
              <button type="button" disabled={busy || !row || row.usdtLeft === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawUsdt(account ?? "", row?.usdtLeft ?? 0n), zh ? "没花掉的 USDT 已取回。" : "Unspent USDT is back.", "desk")}>{zh ? "取 USDT" : "Take USDT"}</button>
              <button type="button" disabled={busy || !row || row.tapeOwed === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawBought(account ?? "", row?.tapeOwed ?? 0n), zh ? "买到的 TAPE 已取回。" : "Bought TAPE is back.", "desk")}>{zh ? "取 TAPE" : "Take TAPE"}</button>
            </div>
          </label>
          ) : (
          <p className="self-center text-sm leading-6">{zh ? "这里只能卖整数枚 TAPE。充入和取回 USDT 只属于买方地址。" : "Only whole TAPE can be sold here. Depositing and withdrawing USDT belong only to the buyer address."}</p>
          )}
        </div>
        {miss ? <p className="mt-2 text-xs text-ink/55">{zh ? "这一次没读到。不写成 0。" : "This read missed. It is not shown as zero."}</p> : null}
          </>
        )}
        <details className="mt-3 border-t border-gold/30 pt-2 text-sm leading-6">
          <summary className="cursor-pointer text-xs tracking-[0.16em] text-gold">{zh ? "规则" : "Rules"}</summary>
          <dl className="mt-2 grid gap-3">
            <div>
              <dt className="text-[11px] tracking-[0.16em] text-gold">{zh ? "回收价" : "Price"}</dt>
              <dd>{zh ? "1 枚整数 TAPE 结算 0.1 USDT。价格写在合约中，不随现货变动。不足 1 枚不予接受。" : "One whole TAPE settles for 0.1 USDT. The price is in the contract and does not follow the spot market. Less than one TAPE is not accepted."}</dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-[0.16em] text-gold">{zh ? "谁能充" : "Who can fund"}</dt>
              <dd>{zh ? "只有买方地址可以充入 X Layer 的 USDT，也只有这个地址可以取回还没花掉的 USDT 和已经买到的 TAPE。其他地址不能在这里充 USDT。充入要签两笔：第一笔授权，币还在钱包；第二笔才充入。" : "Only the buyer address can deposit X Layer USDT. Only that address can withdraw USDT that has not been spent, and the TAPE it has bought. No other address can deposit USDT here. Two signatures: approve first, the coins stay in the wallet; the second deposits."}</dd>
            </div>
            <div>
              <dt className="text-[11px] tracking-[0.16em] text-gold">{zh ? "用户" : "Sellers"}</dt>
              <dd>{zh ? "只能卖出整数枚 TAPE。卖出当时收到 USDT，不能把已卖出的 TAPE 取回。池子里的 USDT 不够，这一笔整单失败，不会先收 TAPE。这份合约不加池。" : "A seller can only sell whole TAPE. USDT is paid in that same transaction. Sold TAPE cannot be taken back. If the USDT cannot cover the order, the whole order fails and no TAPE is taken. This contract does not add liquidity."}</dd>
            </div>
          </dl>
          <p className="mt-2 break-all font-mono text-[11px] text-ink/50">{zh ? "买方" : "Buyer"} {TAPE_BUYER}</p>
          {desk ? <p className="mt-1 break-all font-mono text-[11px] text-ink/50"><a className="underline" href={`${XLAYER.explorer}/address/${desk}`} target="_blank" rel="noreferrer">{desk}</a></p> : null}
          {desk && row ? <p className="mt-1 text-xs text-ink/55">{zh ? "最多再收" : "Room for"} <span className="font-mono">{maxTape.toLocaleString("en-US")} TAPE</span></p> : null}
        </details>
        </div>
      </article>
      {!term ? (
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">{zh ? "期限质押还没部署" : "Timed stake is not deployed"}</h3>
          <p className="mt-2 text-sm leading-6">
            {zh
              ? "期限为三个月、六个月、九个月、一年、两年、三年。到期前不可取回本金，奖励可提前领取。与回购合约分开。旧质押不再接受存入。部署时 Gas Limit 填 5000000。地址写入页面后全站可用。"
              : "Terms are 3, 6 and 9 months, then 1, 2 and 3 years. Principal stays until expiry. Rewards can be claimed earlier. This is separate from the buyback. The old stake no longer takes deposits. Set Gas Limit to 5000000. The site uses it after the address is written in."}
          </p>
          <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-ink text-sm text-paper disabled:opacity-40 sm:w-auto sm:px-6" onClick={deployLocks}>{zh ? "部署期限质押" : "Deploy timed stake"}</button>
        </article>
      ) : null}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <article className="border border-[#c4a574] border-t-4 border-t-[#a67c42] bg-[color-mix(in_srgb,#e8c07a_46%,var(--color-foil))] px-3 py-4 sm:px-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] tracking-[0.2em] text-[#8a5a12]">TAPE</p>
              <h3 className="font-display text-3xl italic leading-none">{zh ? "锁 TAPE，领 BEM" : "Lock TAPE, earn BEM"}</h3>
            </div>
            <Yield label={zh ? "年化" : "APY"} value={tapeApy === "—" ? "—" : `${tapeApy}%`} quiet={tapeApy === "—" ? (stake && stake.tapeStakedTotal > 0n ? (zh ? "价格没读到" : "Price missed") : (zh ? "还没有本金" : "No principal")) : undefined} />
          </div>
          <section className="mt-4 bg-[color-mix(in_srgb,var(--color-paper)_78%,#f6e7c8)] px-3 py-3">
            <h4 className="text-[11px] tracking-[0.18em] text-[#8a5a12]">{zh ? "本金" : "Principal"}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Figure k={zh ? "可质押" : "Available"} v={!account ? (zh ? "未登入" : "Sign in") : stake ? `${deskText(stake.tapeBal, 8)} TAPE` : row ? `${deskText(row.tapeBal, 8)} TAPE` : "—"} />
              <Figure k={zh ? "已质押" : "Staked"} v={!account ? (zh ? "未登入" : "Sign in") : stake ? `${deskText(stake.tapeStaked, 8)} TAPE` : "—"} sub={zh ? `全池 ${stake ? deskText(stake.tapeStakedTotal, 8) : "—"}` : `Pool ${stake ? deskText(stake.tapeStakedTotal, 8) : "—"}`} />
            </div>
            <div className="mt-3">
              <p className="mb-2 text-[11px] tracking-[0.16em] text-ink/45">{zh ? "我的锁仓" : "My locks"} · {zh ? `未到期 ${openTape}/16` : `${openTape}/16 open`}</p>
              <LockList locks={stake?.tapeLocks ?? []} zh={zh} busy={busy || !term} empty={zh ? (!account ? "登入后显示你已经质押的。" : stake && stake.tapeStaked > 0n ? "本金已记上。锁仓明细这一次没列出来。" : term ? "你还没有锁仓。" : "部署之后记在这里。") : (!account ? "Shown after sign-in." : stake && stake.tapeStaked > 0n ? "Principal is recorded. The lock rows missed this read." : term ? "You have no lock yet." : "Shown after deploy.")} onTake={(index) => run(() => unstakeTermTape(account ?? "", index), zh ? "到期本金已取回。" : "Expired principal is back.", "term", "stake")} />
            </div>
          </section>
          <section className="mt-3 bg-[color-mix(in_srgb,#a67c42_14%,var(--color-paper))] px-3 py-3">
            <h4 className="text-[11px] tracking-[0.18em] text-[#8a5a12]">{zh ? "锁入" : "Lock"}</h4>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {TERMS.map((item) => (
                <button key={item.id} type="button" className={`min-h-11 px-1 text-sm ${tapeTerm === item.id ? "bg-ink font-medium ring-2 ring-[#8a5a12]" : "border border-gold bg-paper/80"}`} onClick={() => { setTapeTerm(item.id); setTapeAck(false); }}>{zh ? item.zh : item.en}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={tapeAmt} onChange={(event) => setTapeAmt(event.target.value)} inputMode="decimal" placeholder={zh ? "TAPE 数量" : "TAPE amount"} className="min-h-12 border border-gold/50 bg-paper px-2 font-mono text-base text-ink sm:text-sm" />
              <button type="button" disabled={!stake || stake.tapeBal === 0n} className="min-h-12 border border-gold bg-paper px-3 text-sm disabled:opacity-40" onClick={() => setTapeAmt(stake ? formatUnits(stake.tapeBal, 8) : "")}>{zh ? "全部" : "All"}</button>
            </div>
            <label className="mt-2 flex min-h-11 items-start gap-2 text-xs leading-5">
              <input type="checkbox" className="mt-1 size-4 shrink-0" checked={tapeAck} onChange={(event) => setTapeAck(event.target.checked)} />
              <span>{zh ? `锁 ${termLabel(tapeTerm, true)}，到期前不能取回本金。` : `Locks ${termLabel(tapeTerm, false)}. Principal cannot leave early.`}</span>
            </label>
            <button type="button" disabled={busy || !term} className="mt-2 min-h-12 w-full bg-ink font-display text-xl italic text-paper disabled:opacity-40" onClick={() => lock("tape")}>{zh ? `质押 ${termLabel(tapeTerm, true)}` : `Stake ${termLabel(tapeTerm, false)}`}</button>
            <details className="mt-2 text-xs leading-5 text-ink/60">
              <summary className="cursor-pointer text-ink/45">{zh ? "怎么锁" : "How locking works"}</summary>
              <p className="mt-1">{zh ? "可质押是这个钱包里的 TAPE。已质押是你已经锁上的本金。全池不用登入也能看见。填数量，或点全部。不会按可质押自动锁定。要签两笔：第一笔授权，币还在钱包；第二笔才锁上。到期前不能取本金。领取只领奖励。" : "Available is the TAPE in this wallet. Staked is the principal you already locked. The pool total does not need a sign-in. Enter an amount, or tap All. It does not lock the available balance by itself. Two signatures: approve first; the second locks. Principal stays until expiry. Claim pays rewards only."}</p>
            </details>
          </section>
          <section className="mt-3 bg-[color-mix(in_srgb,var(--color-paper)_88%,#e7c99a)] px-3 py-3">
            <h4 className="text-[11px] tracking-[0.18em] text-[#8a5a12]">{zh ? "奖励 · BEM" : "Reward · BEM"}</h4>
            {stakeMiss ? <p className="mt-1 text-xs text-ink/55">{zh ? "期限这一次没读到。不写成 0。" : "This stake read missed. It is not shown as zero."}</p> : null}
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Figure k={zh ? "未分完" : "Unvested"} v={stake ? deskText(stake.bemPot, 8) : "—"} />
              <Figure k={zh ? "待领" : "Claimable"} v={stake ? deskText(stake.bemOwed, 8, 8) : "—"} />
              <Figure k={zh ? "还可取" : "Still yours"} v={stake ? deskText(stake.bemSponsor, 8, 8) : "—"} />
            </div>
            <input value={rewardBem} onChange={(event) => setRewardBem(event.target.value)} inputMode="decimal" placeholder={zh ? "这次充入的 BEM" : "BEM to add now"} className="mt-2 min-h-12 w-full border border-gold/50 bg-paper px-2 font-mono text-base text-ink sm:text-sm" />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" disabled={busy || !term} className="min-h-12 border border-gold bg-paper px-1 text-sm disabled:opacity-40" onClick={() => run(() => fundTermBem(account ?? "", units(rewardBem, 8)), zh ? "BEM 奖励已充入。" : "BEM reward added.", "term", "reward")}>{zh ? "充奖励" : "Add"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.bemSponsor === 0n} className="min-h-12 border border-gold bg-paper px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawTermBem(account ?? "", stake?.bemSponsor ?? 0n), zh ? "能退的 BEM 已取回。已经开始分给质押的那一点留在池子里。" : "The BEM that can be returned is back. The part that already started vesting stays in the pool.", "term", "unvest")}>{zh ? "取未分完" : "Unvested"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.bemOwed === 0n} className="min-h-12 bg-ink px-1 text-sm text-paper disabled:opacity-40" onClick={() => run(() => claimTermBem(account ?? ""), zh ? "BEM 已领取。本金还锁着。" : "BEM claimed. Principal stays locked.", "term", "stake")}>{zh ? "领取" : "Claim"}</button>
            </div>
          </section>
        </article>
        <article className="border border-[#7eaea0] border-t-4 border-t-[#2f6a5c] bg-[color-mix(in_srgb,#7dbaa8_42%,var(--color-card))] px-3 py-4 sm:px-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] tracking-[0.2em] text-[#3f6f62]">BEM</p>
              <h3 className="font-display text-3xl italic leading-none">{zh ? "锁 BEM，领 TAPE" : "Lock BEM, earn TAPE"}</h3>
            </div>
            <Yield label={zh ? "年化" : "APY"} value={bemApy === "—" ? "—" : `${bemApy}%`} quiet={bemApy === "—" ? (stake && stake.bemStakedTotal > 0n ? (zh ? "价格没读到" : "Price missed") : (zh ? "还没有本金" : "No principal")) : undefined} />
          </div>
          <section className="mt-4 bg-[color-mix(in_srgb,var(--color-paper)_78%,#d5ebe4)] px-3 py-3">
            <h4 className="text-[11px] tracking-[0.18em] text-[#3f6f62]">{zh ? "本金" : "Principal"}</h4>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Figure k={zh ? "可质押" : "Available"} v={!account ? (zh ? "未登入" : "Sign in") : stake ? `${deskText(stake.bemBal, 8)} BEM` : row ? `${deskText(row.bemBal, 8)} BEM` : "—"} />
              <Figure k={zh ? "已质押" : "Staked"} v={!account ? (zh ? "未登入" : "Sign in") : stake ? `${deskText(stake.bemStaked, 8)} BEM` : "—"} sub={zh ? `全池 ${stake ? deskText(stake.bemStakedTotal, 8) : "—"}` : `Pool ${stake ? deskText(stake.bemStakedTotal, 8) : "—"}`} />
            </div>
            <div className="mt-3">
              <p className="mb-2 text-[11px] tracking-[0.16em] text-ink/45">{zh ? "我的锁仓" : "My locks"} · {zh ? `未到期 ${openBem}/16` : `${openBem}/16 open`}</p>
              <LockList locks={stake?.bemLocks ?? []} zh={zh} busy={busy || !term} empty={zh ? (!account ? "登入后显示你已经质押的。" : stake && stake.bemStaked > 0n ? "本金已记上。锁仓明细这一次没列出来。" : term ? "你还没有锁仓。" : "部署之后记在这里。") : (!account ? "Shown after sign-in." : stake && stake.bemStaked > 0n ? "Principal is recorded. The lock rows missed this read." : term ? "You have no lock yet." : "Shown after deploy.")} onTake={(index) => run(() => unstakeTermBem(account ?? "", index), zh ? "到期本金已取回。" : "Expired principal is back.", "term", "stake")} />
            </div>
          </section>
          <section className="mt-3 bg-[color-mix(in_srgb,#2f6a5c_12%,var(--color-paper))] px-3 py-3">
            <h4 className="text-[11px] tracking-[0.18em] text-[#3f6f62]">{zh ? "锁入" : "Lock"}</h4>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {TERMS.map((item) => (
                <button key={item.id} type="button" className={`min-h-11 px-1 text-sm ${bemTerm === item.id ? "bg-ink font-medium ring-2 ring-[#3f6f62]" : "border border-gold bg-paper/80"}`} onClick={() => { setBemTerm(item.id); setBemAck(false); }}>{zh ? item.zh : item.en}</button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <input value={bemAmt} onChange={(event) => setBemAmt(event.target.value)} inputMode="decimal" placeholder={zh ? "BEM 数量" : "BEM amount"} className="min-h-12 border border-gold/50 bg-paper px-2 font-mono text-base text-ink sm:text-sm" />
              <button type="button" disabled={!stake || stake.bemBal === 0n} className="min-h-12 border border-gold bg-paper px-3 text-sm disabled:opacity-40" onClick={() => setBemAmt(stake ? formatUnits(stake.bemBal, 8) : "")}>{zh ? "全部" : "All"}</button>
            </div>
            <label className="mt-2 flex min-h-11 items-start gap-2 text-xs leading-5">
              <input type="checkbox" className="mt-1 size-4 shrink-0" checked={bemAck} onChange={(event) => setBemAck(event.target.checked)} />
              <span>{zh ? `锁 ${termLabel(bemTerm, true)}，到期前不能取回本金。` : `Locks ${termLabel(bemTerm, false)}. Principal cannot leave early.`}</span>
            </label>
            <button type="button" disabled={busy || !term} className="mt-2 min-h-12 w-full bg-ink font-display text-xl italic text-paper disabled:opacity-40" onClick={() => lock("bem")}>{zh ? `质押 ${termLabel(bemTerm, true)}` : `Stake ${termLabel(bemTerm, false)}`}</button>
            <details className="mt-2 text-xs leading-5 text-ink/60">
              <summary className="cursor-pointer text-ink/45">{zh ? "怎么锁" : "How locking works"}</summary>
              <p className="mt-1">{zh ? "可质押是这个钱包里的 X Layer BEM。已质押是你已经锁上的本金。BSC 的 BEM 先用下面的跨链转过来，本站不经手。填数量，或点全部。要签两笔：第一笔授权，第二笔才锁上。到期前不能取本金。" : "Available is the X Layer BEM in this wallet. Staked is the principal you already locked. BSC BEM has to cross on the bridge below. This site does not custody it. Enter an amount, or tap All. Two signatures: approve, then lock. Principal stays until expiry."}</p>
            </details>
          </section>
          <section className="mt-3 bg-[color-mix(in_srgb,var(--color-paper)_88%,#c5ddd4)] px-3 py-3">
            <h4 className="text-[11px] tracking-[0.18em] text-[#3f6f62]">{zh ? "奖励 · TAPE" : "Reward · TAPE"}</h4>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Figure k={zh ? "未分完" : "Unvested"} v={stake ? deskText(stake.tapePot, 8) : "—"} />
              <Figure k={zh ? "待领" : "Claimable"} v={stake ? deskText(stake.tapeOwed, 8, 8) : "—"} />
              <Figure k={zh ? "还可取" : "Still yours"} v={stake ? deskText(stake.tapeSponsor, 8, 8) : "—"} />
            </div>
            <input value={rewardTape} onChange={(event) => setRewardTape(event.target.value)} inputMode="decimal" placeholder={zh ? "这次充入的 TAPE" : "TAPE to add now"} className="mt-2 min-h-12 w-full border border-gold/50 bg-paper px-2 font-mono text-base text-ink sm:text-sm" />
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" disabled={busy || !term} className="min-h-12 border border-gold bg-paper px-1 text-sm disabled:opacity-40" onClick={() => run(() => fundTermTape(account ?? "", units(rewardTape, 8)), zh ? "TAPE 奖励已充入。" : "TAPE reward added.", "term", "reward")}>{zh ? "充奖励" : "Add"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.tapeSponsor === 0n} className="min-h-12 border border-gold bg-paper px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawTermTape(account ?? "", stake?.tapeSponsor ?? 0n), zh ? "能退的 TAPE 已取回。已经开始分给质押的那一点留在池子里。" : "The TAPE that can be returned is back. The part that already started vesting stays in the pool.", "term", "unvest")}>{zh ? "取未分完" : "Unvested"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.tapeOwed === 0n} className="min-h-12 bg-ink px-1 text-sm text-paper disabled:opacity-40" onClick={() => run(() => claimTermTape(account ?? ""), zh ? "TAPE 已领取。本金还锁着。" : "TAPE claimed. Principal stays locked.", "term", "stake")}>{zh ? "领取" : "Claim"}</button>
            </div>
          </section>
          <div className="mt-3 border-t border-[#8eaea0]/70 pt-1">
            <OfficialBridge account={account} zh={zh} xBem={stake ? stake.bemBal : row ? row.bemBal : null} />
          </div>
        </article>
      </div>
      <details className="text-xs leading-5 text-ink/55">
        <summary className="cursor-pointer">{zh ? "年化怎么算" : "How APY is figured"}</summary>
        <p className="mt-1">
          {zh
            ? "按现在还没分完的奖励、365 天分完、池子现价来算。TAPE 用现货池的 BEM 和 OKB 合成价。BEM 用 BSC 池子价，X Layer 的 BEM 按 1:1。有人再质押，或取走还没分完的奖励，这个数就变。价格没读到写成 —，不写成 0。不是承诺。到期时间是新加坡时间。签名停在这一页。"
            : "APY assumes the unvested pot pays out over 365 days at the current pool price. TAPE uses the spot pool's BEM and OKB. BEM uses the BSC pool, and X Layer BEM is counted 1:1. It changes when someone stakes or takes unvested rewards back. A missing price is —, not zero. It is not a promise. Unlock times are Singapore. Signing stays on this page."}
        </p>
        {term ? <p className="mt-1 break-all font-mono text-[11px]"><a className="underline" href={`${XLAYER.explorer}/address/${term}`} target="_blank" rel="noreferrer">{term}</a></p> : null}
      </details>
      {note ? <p className={`break-all text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </section>
  );
}
