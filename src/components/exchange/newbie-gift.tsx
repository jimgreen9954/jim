import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import { FEE_TO } from "@/lib/bsc";
import {
  bemGiftReady,
  claimBem,
  claimNand,
  deployBemGift,
  deployNandGift,
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

  return (
    <section className="border border-gold p-3">
      <p className="text-xs tracking-widest text-gold">{zh ? "新手礼包" : "Starter gift"}</p>
      <h3 className="font-display text-2xl italic">{zh ? "NAND 和 BEM" : "NAND and BEM"}</h3>
      <p className="mt-1 text-xs leading-5 text-ink/70">
        {zh
          ? "谁充谁取。取回的只是你还没被领走的那一份。别人领奖，按份额少掉奖金，不能把你的充值整笔转走。池子空了就停，有余额就继续发。"
          : "You withdraw only your own remaining share. A claim reduces every share. It cannot take someone else's whole deposit. An empty pool stops. A funded pool keeps paying."}
      </p>
      <p className="mt-2 text-xs leading-5 text-ink/70">
        {zh
          ? "次数只认已经撮合的永续，一边保证金不少于 5 美元。X Layer 永续记 NAND。BSC 的 BEM 永续和晶体管永续记 BEM。同一笔只能记一次。现货不记，因为那笔不在礼包合约里。"
          : "Only a matched perpetual counts, and only if your side's margin is at least 5 dollars. X Layer fills count for NAND. BSC BEM and transistor fills count for BEM. One fill counts once. Spot is not counted, because that trade is not inside the gift contract."}
      </p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <article className="border border-gold/40 p-2">
          <p className="text-sm">X Layer NAND</p>
          <p className="mt-1 font-mono text-xs">{zh ? "池子" : "Pool"} {row ? row.nandPool.toString() : "—"} · {zh ? "我的" : "Mine"} {row ? row.nandMine.toString() : "—"}</p>
          <p className="font-mono text-xs">{zh ? "已记" : "Counted"} {row ? row.nandTrades.toString() : "—"} · {zh ? "已领" : "Claimed"} {row ? row.nandClaimed.toString() : "—"} / 5</p>
          {nandOn ? (
            <div className="mt-2 grid gap-2">
              <input value={nandAmt} onChange={(event) => setNandAmt(event.target.value.replace(/[^\d]/g, ""))} placeholder={zh ? "充或取的 NAND 个数" : "NAND amount"} className="min-h-10 border border-gold bg-transparent px-2 font-mono outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy || !nandAmt} className="min-h-10 bg-ink text-paper disabled:opacity-40" onClick={() => run(() => depositNand(account, BigInt(nandAmt)), zh ? "NAND 已充进你的份额。" : "NAND was added to your share.")}>{zh ? "充值" : "Deposit"}</button>
                <button type="button" disabled={busy || !nandAmt} className="min-h-10 border border-gold disabled:opacity-40" onClick={() => run(() => withdrawNand(account, BigInt(nandAmt)), zh ? "NAND 已退回这个地址。" : "NAND is back in this address.")}>{zh ? "提现" : "Withdraw"}</button>
              </div>
              <button type="button" disabled={busy || !canNand} className="min-h-10 border border-gold disabled:opacity-40" onClick={() => run(() => claimNand(account), zh ? "已领 10 个 NAND。" : "Claimed 10 NAND.")}>{zh ? "领取 10 NAND" : "Claim 10 NAND"}</button>
            </div>
          ) : (
            <button type="button" disabled={busy} className="mt-2 min-h-10 border border-gold px-2 text-sm" onClick={() => run(async () => {
              if (account.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
              const addr = await deployNandGift(account);
              say(zh ? `NAND 礼包 ${addr}。还没写进网页，把地址发我。` : `NAND gift ${addr}. It is not on the site yet. Send me the address.`);
            }, "")}>{zh ? "收费地址部署 NAND 礼包" : "Fee address deploys the NAND gift"}</button>
          )}
        </article>
        <article className="border border-gold/40 p-2">
          <p className="text-sm">BSC BEM</p>
          <p className="mt-1 font-mono text-xs">{zh ? "池子" : "Pool"} {row ? (Number(row.bemPool) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"} · {zh ? "我的" : "Mine"} {row ? (Number(row.bemMine) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—"}</p>
          <p className="font-mono text-xs">{zh ? "已记" : "Counted"} {row ? row.bemTrades.toString() : "—"} · {row?.bemClaimed ? (zh ? "已领 0.1" : "0.1 claimed") : (zh ? "未领 0.1" : "0.1 not claimed")}</p>
          {bemOn ? (
            <div className="mt-2 grid gap-2">
              <input value={bemAmt} onChange={(event) => setBemAmt(event.target.value.replace(/[^\d.]/g, ""))} placeholder={zh ? "充或取的 BEM" : "BEM amount"} className="min-h-10 border border-gold bg-transparent px-2 font-mono outline-none" />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy || !bemAmt} className="min-h-10 bg-ink text-paper disabled:opacity-40" onClick={() => run(() => depositBem(account, parseUnits(bemAmt, 8)), zh ? "BEM 已充进你的份额。" : "BEM was added to your share.")}>{zh ? "充值" : "Deposit"}</button>
                <button type="button" disabled={busy || !bemAmt} className="min-h-10 border border-gold disabled:opacity-40" onClick={() => run(() => withdrawBem(account, parseUnits(bemAmt, 8)), zh ? "BEM 已退回这个地址。" : "BEM is back in this address.")}>{zh ? "提现" : "Withdraw"}</button>
              </div>
              <button type="button" disabled={busy || !canBem} className="min-h-10 border border-gold disabled:opacity-40" onClick={() => run(() => claimBem(account), zh ? "已领 0.1 BEM。" : "Claimed 0.1 BEM.")}>{zh ? "领取 0.1 BEM" : "Claim 0.1 BEM"}</button>
            </div>
          ) : (
            <button type="button" disabled={busy} className="mt-2 min-h-10 border border-gold px-2 text-sm" onClick={() => run(async () => {
              if (account.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
              const addr = await deployBemGift(account);
              say(zh ? `BEM 礼包 ${addr}。还没写进网页，把地址发我。` : `BEM gift ${addr}. It is not on the site yet. Send me the address.`);
            }, "")}>{zh ? "收费地址部署 BEM 礼包" : "Fee address deploys the BEM gift"}</button>
          )}
        </article>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr_auto_auto]">
        <input value={deal} onChange={(event) => setDeal(event.target.value.replace(/[^\d]/g, ""))} placeholder={zh ? "成交编号" : "Fill id"} className="min-h-10 border border-gold bg-transparent px-2 font-mono outline-none" />
        <p className="self-center text-xs text-ink/60">{zh ? "填你自己那一边的成交编号。保证金要不少于 5 美元。" : "The fill id on your side. Your margin must be at least 5 dollars."}</p>
        <button type="button" disabled={busy || !nandOn || id < 1n} className="min-h-10 border border-gold px-2 text-sm disabled:opacity-40" onClick={() => run(() => stampNand(account, id), zh ? "这笔 X Layer 成交已记下。" : "That X Layer fill is counted.")}>{zh ? "记入 NAND" : "Count for NAND"}</button>
        <button type="button" disabled={busy || !bemOn || id < 1n} className="min-h-10 border border-gold px-2 text-sm disabled:opacity-40" onClick={() => run(() => stampBem(account, id, gate), zh ? "这笔 BSC 成交已记下。" : "That BSC fill is counted.")}>{gate ? (zh ? "记晶体管" : "Count transistor") : (zh ? "记 BEM 永续" : "Count BEM perp")}</button>
      </div>
      <button type="button" className="mt-2 text-xs underline" onClick={() => setGate((value) => !value)}>{gate ? (zh ? "现在记的是晶体管永续，点此改记 BEM 永续" : "Counting the transistor book. Tap for the BEM book.") : (zh ? "现在记的是 BEM 永续，点此改记晶体管永续" : "Counting the BEM book. Tap for the transistor book.")}</button>
      {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </section>
  );
}
