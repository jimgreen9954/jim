import { useEffect, useState } from "react";
import { parseUnits } from "viem";
import {
  bemGiftReady,
  claimBem,
  claimNand,
  deployBemGift,
  deployNandGift,
  depositBem,
  depositNand,
  giftMoved,
  nandGiftReady,
  readGift,
  readGiftFills,
  stampBem,
  stampNand,
  withdrawBem,
  withdrawNand,
  type GiftFill,
  type GiftBooks,
  type GiftState,
} from "@/lib/newbie";

export function GiftDeploy({ account, zh }: { account: string | null; zh: boolean }) {
  const [moved, setMoved] = useState(giftMoved());
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  if (moved.nand && moved.bem) return null;
  const run = (task: () => Promise<string>, ok: string) => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先连接收费地址。" : "Connect the fee address first.");
      return;
    }
    setBusy(true);
    task()
      .then((addr) => {
        setMoved(giftMoved());
        setBad(false);
        setNote(`${ok} ${addr}`);
      })
      .catch(() => {
        setBad(true);
        setNote(zh ? "没有部署。只有收费地址能签，Gas Limit 填 3000000。" : "It did not deploy. Only the fee address can sign. Set Gas Limit to 3000000.");
      })
      .finally(() => setBusy(false));
  };
  return (
    <div className="border-t border-gold bg-card px-4 py-3">
      <p className="text-sm leading-6">
        {zh
          ? "刚签的两枚礼包还认上一本。交易已经切到不会停的这一本，池子也是空的。再点下面一次，新成交才能选编号领取。签完把地址发我。"
          : "The two gifts just signed still read the previous books. Trading is now on the books that do not stop, and both pools are empty. Deploy once more so a new fill can be selected. Send me the addresses."}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {moved.nand ? null : (
          <button type="button" disabled={busy} className="min-h-12 bg-ink px-3 text-sm text-paper disabled:opacity-40" onClick={() => run(() => deployNandGift(account ?? ""), zh ? "NAND 礼包已部署。" : "NAND gift deployed.")}>
            {zh ? "部署认新永续的 NAND 礼包" : "Deploy the NAND gift"}
          </button>
        )}
        {moved.bem ? null : (
          <button type="button" disabled={busy} className="min-h-12 bg-ink px-3 text-sm text-paper disabled:opacity-40" onClick={() => run(() => deployBemGift(account ?? ""), zh ? "BEM 礼包已部署。" : "BEM gift deployed.")}>
            {zh ? "部署认新晶体管的 BEM 礼包" : "Deploy the BEM gift"}
          </button>
        )}
      </div>
      {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );
}

export function NewbieGift({ account, zh, pulse = 0 }: { account: string; zh: boolean; pulse?: number }) {
  const [row, setRow] = useState<GiftState | null>(null);
  const [fills, setFills] = useState<GiftFill[]>([]);
  const [seen, setSeen] = useState(0);
  const [small, setSmall] = useState(0);
  const [books, setBooks] = useState<GiftBooks | null>(null);
  const [scan, setScan] = useState<"run" | "ok" | "bad">("run");
  const [nandAmt, setNandAmt] = useState("");
  const [bemAmt, setBemAmt] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const nandOn = nandGiftReady();
  const bemOn = bemGiftReady();

  useEffect(() => {
    let dead = false;
    const pull = () => {
      setScan("run");
      readGift(account).then((next) => { if (!dead) setRow(next); }).catch(() => undefined);
      readGiftFills(account).then((next) => {
        if (dead) return;
        setFills(next.fills);
        setSeen(next.seen);
        setSmall(next.small);
        setBooks(next.books);
        setScan("ok");
      }).catch(() => { if (!dead) setScan("bad"); });
    };
    pull();
    const id = window.setInterval(pull, 20000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account, pulse]);

  const say = (text: string, failed = false) => { setBad(failed); setNote(text); };
  const run = (task: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    task().then(() => { if (ok) say(ok); }).catch(() => say(zh ? "没有完成。签名时 Gas Limit 填 3000000。资产还在原处。" : "It did not finish. Set Gas Limit to 3000000. The assets stayed put.", true)).finally(() => setBusy(false));
  };
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
          <p className="mt-1 text-ink/80">{zh ? "现货、加池、流片都不算。5 美元是你这一边锁进永续的保证金，不是买到多少币。两本永续不能并成一笔。同一笔只能记一次。" : "Spot, liquidity, and tape-out do not count. Five dollars means the margin locked on your side, not the coins you bought. The two books do not combine. One fill counts once."}</p>
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
      <div className="border-t border-gold/30 px-4 py-3">
        <p className="text-sm">{zh ? "可以领的成交" : "Fills you can claim"}</p>
        <p className="mt-1 text-xs leading-5 text-ink/55">
          {scan === "run"
            ? (zh ? "正在读永续成交。" : "Reading perpetual fills.")
            : scan === "bad"
              ? (zh ? "这次没读到。点个人中心的刷新再试。" : "This read failed. Use Refresh on the account page.")
              : seen === 0
                ? (zh ? "这两本永续里没有你的成交。现货的 5 美元不会出现在这里。" : "You have no fill on these perpetual books. A 5 dollar spot trade does not show up here.")
                : fills.some((fill) => fill.ok)
                  ? (zh ? "点下面亮着的一笔。X Layer 记下后领 10 个 NAND。BSC 记满 11 笔才领 0.1 BEM。灰的那几笔保证金不到 5 美元，合约不认。" : "Select a lit row. An X Layer fill pays 10 NAND. BSC pays 0.1 BEM after 11. Grey rows are under 5 dollars of margin, so the contract rejects them.")
                  : (zh ? `扫到你的 ${seen} 笔永续，保证金都不到 5 美元。开 5 美元会先扣千分之二，链上剩 4.99，礼包不认。要领的话，保证金至少开 5.02 美元。` : `Found ${seen} perpetual fills, all under 5 dollars of margin. A 5 dollar order loses 0.2 percent first, so 4.99 remains and the gift rejects it. Open at least 5.02 dollars of margin.`)}
        </p>
        {row && row.nandPool < 10n && row.bemPool < 10_000_000n ? <p className="mt-2 text-xs text-sell">{zh ? "两个奖池现在都不够发。记下成交也不会打出奖励，要先有人放入。" : "Both pools are too small to pay. Counting a fill does not send a reward until someone adds funds."}</p> : null}
        {books && !books.nandLive ? <p className="mt-2 text-xs text-sell">{zh ? "NAND 礼包还认旧的 X Layer 永续，新成交不会出现。收费地址部署新礼包后才会列出。旧池子里的可以取回，新礼包要重新放入。" : "The NAND gift still reads the previous X Layer book, so new fills are not listed. The fee address deploys the new gift first. The old pool can be withdrawn. The new gift starts empty."}</p> : null}
        {books && !books.gateLive ? <p className="mt-2 text-xs text-sell">{zh ? "BEM 礼包的晶体管还认旧合约。新的晶体管成交不会出现。BSC 的 BEM 永续不受影响。" : "The BEM gift still reads the previous transistor book. New transistor fills are not listed. The BSC BEM book is unaffected."}</p> : null}
        <ul className="mt-2 flex flex-col gap-2">
          {fills.map((fill) => (
            <li key={`${fill.kind}-${fill.id}`}>
              {fill.ok ? (
              <button
                type="button"
                disabled={busy || (fill.kind === "nand" ? !nandOn : !bemOn)}
                className="flex min-h-11 w-full items-center justify-between gap-2 border border-gold px-2 text-left text-sm disabled:opacity-40"
                onClick={() => {
                  setBusy(true);
                  const take = async () => {
                    if (fill.kind === "nand") {
                      await stampNand(account, BigInt(fill.id));
                      const next = await readGift(account);
                      if (next.nandClaimed < 5n && next.nandTrades > next.nandClaimed && next.nandPool >= 10n) {
                        await claimNand(account);
                        return zh ? `#${fill.id} 已记下，10 个 NAND 已领。` : `#${fill.id} counted. 10 NAND claimed.`;
                      }
                      return zh ? `#${fill.id} 已记下。池子不够 10 个，或这个地址已经领满 5 次。` : `#${fill.id} is counted. The pool is under 10, or this address already claimed 5 times.`;
                    }
                    await stampBem(account, BigInt(fill.id), fill.kind === "gate");
                    const next = await readGift(account);
                    if (!next.bemClaimed && next.bemTrades >= 11n && next.bemPool >= 10_000_000n) {
                      await claimBem(account);
                      return zh ? `#${fill.id} 已记下，0.1 BEM 已领。` : `#${fill.id} counted. 0.1 BEM claimed.`;
                    }
                    const left = Math.max(0, 11 - Number(next.bemTrades));
                    return zh ? `#${fill.id} 已记下。还差 ${left} 笔才领 0.1 BEM。` : `#${fill.id} is counted. ${left} more before 0.1 BEM.`;
                  };
                  take().then((text) => say(text)).catch(() => say(zh ? "没有完成。这笔可能已经记过。" : "It did not finish. This fill may already be counted.", true)).finally(() => setBusy(false));
                }}
              >
                <span className="font-mono">#{fill.id} · {fill.kind === "nand" ? "X Layer" : fill.kind === "gate" ? (zh ? "晶体管" : "Transistor") : "BEM"} · {fill.side === "long" ? (zh ? "多" : "Long") : (zh ? "空" : "Short")}</span>
                <span className="font-mono">{fill.margin} {zh ? "美元" : "USD"} · {fill.kind === "nand" ? (zh ? "领 10 NAND" : "Claim 10 NAND") : (zh ? "记入 BEM" : "Count BEM")}</span>
              </button>
              ) : (
                <p className="flex min-h-11 items-center justify-between gap-2 border border-gold/30 px-2 text-sm text-ink/45">
                  <span className="font-mono">#{fill.id} · {fill.kind === "nand" ? "X Layer" : fill.kind === "gate" ? (zh ? "晶体管" : "Transistor") : "BEM"} · {fill.side === "long" ? (zh ? "多" : "Long") : (zh ? "空" : "Short")}</span>
                  <span className="font-mono">{fill.margin} {zh ? "美元 · 不到 5" : "USD · under 5"}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
        {books && (!books.nandLive || !books.gateLive) ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {!books.nandLive ? <button type="button" disabled={busy} className="min-h-10 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => deployNandGift(account), zh ? "新的 NAND 礼包已部署。把地址发我，我写进网页。旧池子请先取回再放入新的。" : "The new NAND gift is deployed. Send me the address. Withdraw the old pool before adding to the new one.")}>{zh ? "部署认新永续的 NAND 礼包" : "Deploy the NAND gift on the live book"}</button> : null}
            {!books.gateLive ? <button type="button" disabled={busy} className="min-h-10 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => deployBemGift(account), zh ? "新的 BEM 礼包已部署。把地址发我。旧池子请先取回。" : "The new BEM gift is deployed. Send me the address. Withdraw the old pool first.")}>{zh ? "部署认新晶体管的 BEM 礼包" : "Deploy the BEM gift on the live transistor book"}</button> : null}
          </div>
        ) : null}
      </div>
      {note ? <p className={`px-4 pb-3 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );
}


