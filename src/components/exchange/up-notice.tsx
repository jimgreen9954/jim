import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { BSC } from "@/lib/bsc";
import { readUpRelease, redeemUp, UP_INSTANT_BPS, UP_POOL, UP_UNLOCK_DAYS } from "@/lib/up-official";

export function UpSpotNotice({
  zh,
  open,
  onClose,
}: {
  zh: boolean;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-3 sm:items-center" onMouseDown={onClose}>
      <div
        className="w-full max-w-md border border-gold bg-card p-5"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="text-[11px] tracking-[0.22em] text-gold">UP · tapeup.io</p>
        <h2 className="mt-2 font-display text-3xl italic">{zh ? "这笔现货按官方池成交" : "This spot uses the official pool"}</h2>
        <p className="mt-3 text-sm leading-6 text-ink/80">
          {zh
            ? `UP 现货走 tapeup.io 官方合约 ${UP_POOL.slice(0, 6)}…${UP_POOL.slice(-4)}，不是普通的即时全额兑换。买入资金的 ${UP_INSTANT_BPS / 100}% 马上买成 UP。其余 ${100 - UP_INSTANT_BPS / 100}% 留在官方合约里，按 ${UP_UNLOCK_DAYS} 天释放。释放不会过期，在本页领取后才会再买成 UP。卖出不受这条例限制。`
            : `UP spot settles in the tapeup.io pool ${UP_POOL.slice(0, 6)}…${UP_POOL.slice(-4)}, not as an instant full fill. ${UP_INSTANT_BPS / 100}% of a buy is filled now. The other ${100 - UP_INSTANT_BPS / 100}% stays in the official contract and vests over ${UP_UNLOCK_DAYS} days. It does not expire. Claiming it here buys the released budget into UP. A sell is not on this schedule.`}
        </p>
        <button type="button" className="mt-4 h-11 w-full bg-ink text-sm text-paper" onClick={onClose}>
          {zh ? "我已知悉，进入交易" : "I understand"}
        </button>
      </div>
    </div>
  );
}

export function UpRelease({
  zh,
  account,
}: {
  zh: boolean;
  account: string | null;
}) {
  const [ready, setReady] = useState<bigint | null>(null);
  const [budget, setBudget] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!account) {
      setReady(null);
      setBudget(null);
      return;
    }
    let dead = false;
    readUpRelease(account)
      .then((row) => {
        if (dead) return;
        setReady(row.ready);
        setBudget(row.budget > row.spent ? row.budget - row.spent : 0n);
      })
      .catch(() => {
        if (!dead) {
          setReady(null);
          setBudget(null);
        }
      });
    return () => {
      dead = true;
    };
  }, [account, note]);

  const claim = async () => {
    if (!account || !ready || ready <= 0n) return;
    setBusy(true);
    setNote("");
    try {
      await redeemUp(account, ready);
      setNote(zh ? "已领取，释放的额度已按现价买成 UP。" : "Claimed. The released budget bought UP.");
    } catch {
      setNote(zh ? "领取没有发出。可领为 0 时要等释放。" : "The claim was not sent. Zero means it is still vesting.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border border-gold/40 px-2 py-2 text-[12px] leading-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink/50">{zh ? "可领" : "Ready"}</span>
        <span className="font-mono">{ready == null ? "—" : `${formatUnits(ready, BSC.bemDecimals)} BEM`}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink/50">{zh ? "未释放" : "Vesting"}</span>
        <span className="font-mono">{budget == null ? "—" : `${formatUnits(budget, BSC.bemDecimals)} BEM`}</span>
      </div>
      <button
        type="button"
        disabled={busy || !account || !ready || ready <= 0n}
        onClick={claim}
        className="mt-2 h-9 w-full bg-ink text-sm text-paper disabled:opacity-40"
      >
        {zh ? "领取并买入 UP" : "Claim and buy UP"}
      </button>
      {note ? <p className="mt-1 text-ink/70">{note}</p> : null}
    </div>
  );
}
