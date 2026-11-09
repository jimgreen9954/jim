import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { BSC, connectBsc } from "@/lib/bsc";
import { readUpRelease, redeemUp, buyReleasedUp, UP_INSTANT_BPS, UP_POOL, UP_UNLOCK_DAYS } from "@/lib/up-official";

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
  const [released, setReleased] = useState<bigint | null>(null);
  const [pending, setPending] = useState<bigint | null>(null);
  const [up, setUp] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!account) {
      setReleased(null);
      setPending(null);
      setUp(null);
      return;
    }
    let dead = false;
    readUpRelease(account)
      .then((row) => {
        if (dead) return;
        setReleased(row.released);
        setPending(row.pending);
        setUp(row.up);
      })
      .catch(() => {
        if (!dead) {
          setReleased(null);
          setPending(null);
          setUp(null);
        }
      });
    return () => {
      dead = true;
    };
  }, [account, note]);

  const claim = async () => {
    if (!account) {
      setNote(zh ? "先连接钱包。这一步不会弹出交易。" : "Connect a wallet first. Nothing was sent.");
      return;
    }
    if (released == null || pending == null || up == null) {
      setNote(zh ? "数量还在读取。读完再点。" : "Still reading the amounts. Tap again when they load.");
      return;
    }
    if (released <= 0n && up <= 0n) {
      setNote(
        zh
          ? "已释放的 BEM 是 0，合约里也没有待领的 UP，所以不会弹出钱包。未释放的要等时间到了才会变成已释放。"
          : "No BEM has been released, and no UP is waiting, so the wallet stays closed.",
      );
      return;
    }
    setBusy(true);
    setNote(zh ? "正在切到 BSC。" : "Switching to BSC.");
    try {
      const from = await connectBsc();
      const row = await readUpRelease(from);
      setReleased(row.released);
      setPending(row.pending);
      setUp(row.up);
      if (row.released <= 0n && row.up <= 0n) {
        setNote(zh ? "这个钱包在 BSC 上没有已释放的 BEM，也没有待领的 UP。" : "On BSC this wallet has no released BEM and no UP waiting.");
        return;
      }
      if (row.released > 0n) {
        setNote(zh ? "第一笔：用已释放的 BEM 买入 UP。请在钱包里确认。" : "First transaction: buy UP with the released BEM. Confirm it in the wallet.");
        await buyReleasedUp(from, row.released);
      }
      const after = await readUpRelease(from);
      setReleased(after.released);
      setPending(after.pending);
      setUp(after.up);
      if (after.up > 0n) {
        setNote(zh ? "第二笔：把 UP 领进钱包余额。请再确认一次。" : "Second transaction: move the UP into your wallet. Confirm once more.");
        await redeemUp(from, after.up);
        const done = await readUpRelease(from);
        setReleased(done.released);
        setPending(done.pending);
        setUp(done.up);
      }
      setNote(zh ? "UP 已进入钱包余额，可以卖出。" : "The UP is in the wallet balance. It can be sold.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setNote(
        message && message !== "revert"
          ? zh
            ? `领取没有发出。${message}`
            : `The claim was not sent. ${message}`
          : zh
            ? "领取没有发出。可领为 0 时要等释放。"
            : "The claim was not sent. Zero means it is still vesting.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 border border-gold/40 px-2 py-2 text-[12px] leading-5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink/50">{zh ? "已释放" : "Released"}</span>
        <span className="font-mono">{released == null ? "—" : `${formatUnits(released, BSC.bemDecimals)} BEM`}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink/50">{zh ? "未释放" : "Vesting"}</span>
        <span className="font-mono">{pending == null ? "—" : `${formatUnits(pending, BSC.bemDecimals)} BEM`}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink/50">{zh ? "待入账" : "UP held"}</span>
        <span className="font-mono">{up == null ? "—" : `${formatUnits(up, 18)} UP`}</span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={claim}
        className="mt-2 h-9 w-full bg-ink text-sm text-paper disabled:opacity-40"
      >
        {zh ? "领取并买入 UP" : "Claim and buy UP"}
      </button>
      {released === 0n && up === 0n ? (
        <p className="mt-1 text-ink/70">
          {zh
            ? "已释放是现在就能拿去买 UP 的 BEM。未释放还没到期。待入账是已经买好、还在合约里的 UP，点下去才会进钱包余额。"
            : "Released BEM can buy UP now. Vesting has not unlocked. UP held is already bought and stays in the contract until this button moves it into the wallet."}
        </p>
      ) : null}
      {note ? <p className="mt-1 text-ink/70">{note}</p> : null}
    </div>
  );
}
