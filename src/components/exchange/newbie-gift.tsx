import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import {
  bemGiftReady,
  claimBem,
  claimNand,
  depositBem,
  depositNand,
  nandGiftReady,
  readGift,
  stampBem,
  stampNand,
  withdrawBem,
  withdrawNand,
  type GiftState,
} from "@/lib/newbie";

export function NewbieGift({ account, zh }: { account: string; zh: boolean }) {
  const [row, setRow] = useState<GiftState | null>(null);
  const [nandAmt, setNandAmt] = useState("");
  const [bemAmt, setBemAmt] = useState("");
  const [deal, setDeal] = useState("");
  const [gate, setGate] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const nandOn = nandGiftReady();
  const bemOn = bemGiftReady();

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readGift(account).then((next) => { if (!dead) setRow(next); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

  const say = (text: string, failed = false) => { setBad(failed); setNote(text); };
  const run = (task: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    task().then(() => { if (ok) say(ok); }).catch(() => say(zh ? "没有完成。签名时 Gas Limit 填 3000000。资产还在原处。" : "It did not finish. Set Gas Limit to 3000000. The assets stayed put.", true)).finally(() => setBusy(false));
  };
  const id = BigInt(deal || "0");
  const nandLeft = row ? 5n - row.nandClaimed : 0n;
  const canNand = Boolean(row && nandLeft > 0n && row.nandTrades > row.nandClaimed && row.nandPool >= 10n);
  const canBem = Boolean(row && !row.bemClaimed && row.bemTrades >= 11n && row.bemPool >= 10_000_000n);
  const nandText = (value: bigint | undefined) => (value == null ? "—" : value.toLocaleString("en-US"));
  const bemText = (value: bigint | undefined) => (value == null ? "—" : (Number(value) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 4 }));

  return (
    <div className="border-t border-gold/30">
      <div className="grid gap-3 px-4 py-3 text-sm leading-6 sm:grid-cols-2">
        <div>
          <p className="text-[11px] tracking-[0.18em] text-gold">{zh ? "这是什么" : "What it is"}</p>
          <p className="mt-1 text-ink/80">{zh ? "隐藏活动，不是充值入口，也不是理财。奖励池里的 NAND 和 BEM 是别人自愿放进去的。你只能领规则里的那一档。放进去的人，只能取回还没被领走的份额。" : "A closed activity, not a deposit and not savings. The NAND and BEM in the pool were added by choice. You can claim only the stated amount. Whoever added funds can take back only what has not been claimed."}</p>
        </div>
        <div>
          <p className="text-[11px] tracking-[0.18em] text-gold">{zh ? "领 NAND" : "NAND"}</p>
          <p className="mt-1 text-ink/80">{zh ? "X Layer 永续，已经撮合，你这一边保证金不少于 5 USDT0。记下这一笔，领 10 个。一个地址最多 5 次。池子少于 10 个就停。" : "One matched X Layer perpetual, with your margin at least 5 USDT0. Count that fill, then claim 10. Five times per address. The pool stops under 10."}</p>
        </div>
        <div>
          <p className="text-[11px] tracking-[0.18em] text-gold">{zh ? "领 BEM" : "BEM"}</p>
          <p className="mt-1 text-ink/80">{zh ? "BSC 的 BEM 永续，或晶体管永续。每笔你这一边不少于 5 USDT。记下的成交超过 10 笔，领一次 0.1 BEM。池子少于 0.1 就停。" : "The BSC BEM perpetual, or the transistor perpetual. Each fill needs your margin of at least 5 USDT. After more than 10 counted fills, claim 0.1 BEM once. The pool stops under 0.1."}</p>
        </div>
        <div>
          <p className="text-[11px] tracking-[0.18em] text-gold">{zh ? "不算的" : "Not counted"}</p>
          <p className="mt-1 text-ink/80">{zh ? "现货不算。同一笔成交只能记一次。练习单不算。两本永续不能并成一笔。成交编号要自己填，页面不代记。" : "Spot is not counted. One fill counts once. Practice is not counted. The two books do not combine. You enter the fill id yourself. The page does not count it for you."}</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-2">
        <article className="px-4 py-3 sm:border-r sm:border-gold/30">
          <p className="text-xs text-ink/50">NAND · X Layer</p>
          <p className="mt-1 font-display text-3xl leading-none">{nandText(row?.nandPool)}</p>
          <p className="mt-1 text-xs text-ink/55">{zh ? "池子" : "Pool"} · {zh ? "我的" : "Mine"} {nandText(row?.nandMine)}</p>
          <p className="mt-2 font-mono text-xs">{zh ? "已记" : "Counted"} {nandText(row?.nandTrades)} · {nandText(row?.nandClaimed)} / 5</p>
          <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
            <input value={nandAmt} onChange={(event) => setNandAmt(event.target.value.replace(/[^\d]/g, ""))} placeholder={zh ? "数量" : "Amount"} className="min-h-10 min-w-0 border border-gold bg-card px-2 font-mono text-sm outline-none" />
            <button type="button" disabled={busy || !nandOn || !nandAmt} className="min-h-10 bg-ink px-3 text-sm text-paper disabled:opacity-40" onClick={() => run(() => depositNand(account, BigInt(nandAmt)), zh ? "NAND 已记入你的份额。" : "NAND was added to your share.")}>{zh ? "放入" : "Add"}</button>
            <button type="button" disabled={busy || !nandOn || !nandAmt} className="min-h-10 border border-gold px-3 text-sm disabled:opacity-40" onClick={() => run(() => withdrawNand(account, BigInt(nandAmt)), zh ? "未领走的 NAND 已退回。" : "Unclaimed NAND is back.")}>{zh ? "取回" : "Back"}</button>
          </div>
          <button type="button" disabled={busy || !canNand} className="mt-2 min-h-10 w-full border border-gold text-sm disabled:opacity-40" onClick={() => run(() => claimNand(account), zh ? "已领 10 个 NAND。" : "Claimed 10 NAND.")}>{zh ? "领取 10 NAND" : "Claim 10 NAND"}</button>
        </article>
        <article className="border-t border-gold/30 px-4 py-3 sm:border-t-0">
          <p className="text-xs text-ink/50">BEM · BSC</p>
          <p className="mt-1 font-display text-3xl leading-none">{bemText(row?.bemPool)}</p>
          <p className="mt-1 text-xs text-ink/55">{zh ? "池子" : "Pool"} · {zh ? "我的" : "Mine"} {bemText(row?.bemMine)}</p>
          <p className="mt-2 font-mono text-xs">{zh ? "已记" : "Counted"} {row ? row.bemTrades.toString() : "—"} · {row?.bemClaimed ? "0.1" : "0"} / 0.1</p>
          <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2">
            <input value={bemAmt} onChange={(event) => setBemAmt(event.target.value.replace(/[^\d.]/g, ""))} placeholder={zh ? "数量" : "Amount"} className="min-h-10 min-w-0 border border-gold bg-card px-2 font-mono text-sm outline-none" />
            <button type="button" disabled={busy || !bemOn || !bemAmt} className="min-h-10 bg-ink px-3 text-sm text-paper disabled:opacity-40" onClick={() => run(() => depositBem(account, parseUnits(bemAmt, 8)), zh ? "BEM 已记入你的份额。" : "BEM was added to your share.")}>{zh ? "放入" : "Add"}</button>
            <button type="button" disabled={busy || !bemOn || !bemAmt} className="min-h-10 border border-gold px-3 text-sm disabled:opacity-40" onClick={() => run(() => withdrawBem(account, parseUnits(bemAmt, 8)), zh ? "未领走的 BEM 已退回。" : "Unclaimed BEM is back.")}>{zh ? "取回" : "Back"}</button>
          </div>
          <button type="button" disabled={busy || !canBem} className="mt-2 min-h-10 w-full border border-gold text-sm disabled:opacity-40" onClick={() => run(() => claimBem(account), zh ? "已领 0.1 BEM。" : "Claimed 0.1 BEM.")}>{zh ? "领取 0.1 BEM" : "Claim 0.1 BEM"}</button>
        </article>
      </div>
      <details className="border-t border-gold/30 px-4 py-3">
        <summary className="cursor-pointer text-sm">{zh ? "记一笔成交" : "Count a fill"}</summary>
        <p className="mt-2 text-xs leading-5 text-ink/55">
          {zh
            ? "只认已经撮合的永续，你这一边保证金不少于 5 美元。X Layer 记 NAND，最多领 5 次。BSC 的 BEM 永续和晶体管永续记 BEM，超过 10 笔领一次 0.1。同一笔只能记一次。现货不记。"
            : "Only a matched perpetual counts, and only if your margin is at least 5 dollars. X Layer fills count toward NAND, five claims at most. BSC BEM and transistor fills count toward 0.1 BEM after more than 10. One fill counts once. Spot does not."}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr]">
          <input value={deal} onChange={(event) => setDeal(event.target.value.replace(/[^\d]/g, ""))} placeholder={zh ? "成交编号" : "Fill id"} className="min-h-10 border border-gold bg-card px-2 font-mono outline-none" />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy || !nandOn || id < 1n} className="min-h-10 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => stampNand(account, id), zh ? "这笔 X Layer 成交已记下。" : "That X Layer fill is counted.")}>{zh ? "记入 NAND" : "Count NAND"}</button>
            <button type="button" disabled={busy || !bemOn || id < 1n} className="min-h-10 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => stampBem(account, id, gate), zh ? "这笔 BSC 成交已记下。" : "That BSC fill is counted.")}>{gate ? (zh ? "记晶体管" : "Transistor") : (zh ? "记 BEM" : "BEM")}</button>
          </div>
        </div>
        <button type="button" className="mt-2 text-xs text-ink/60 underline" onClick={() => setGate((value) => !value)}>{gate ? (zh ? "正在记晶体管永续" : "Counting the transistor book") : (zh ? "正在记 BEM 永续" : "Counting the BEM book")}</button>
      </details>
      {note ? <p className={`px-4 pb-3 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );
}


