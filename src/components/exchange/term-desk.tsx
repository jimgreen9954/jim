import { useEffect, useState } from "react";
import {
  addTermColl,
  aprText,
  depositTerm,
  freshAt,
  hourlyWad,
  liquidateTerm,
  liqCollPrice,
  liqPay,
  ltvBps,
  MIN_USD,
  owedAt,
  pokeTerm,
  readTerm,
  repayTerm,
  termAsset,
  termAssets,
  TERM_ROWS,
  termPlain,
  termText,
  usdOf,
  withdrawTerm,
  openTerm,
  type TermChain,
  type TermLoan,
  type TermPool,
  type TermSnap,
} from "@/lib/term";
import { units } from "@/lib/bsc";
import { connectAny } from "@/lib/wallet";

const WAD = 10n ** 18n;

function failText(err: unknown, zh: boolean): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "amount") return zh ? "数量不对。" : "That amount is not valid.";
  if (code === "balance") return zh ? "余额不够。" : "Balance is not enough.";
  if (code === "gas") return zh ? "要留下一点当网络费，不能全部转进去。" : "Leave a little for the network fee.";
  if (code === "live") return zh ? "这一本还没部署。" : "This book is not deployed.";
  if (code === "dry") return zh ? "池子里现在没有这么多可借的。" : "The pool does not have that much to lend.";
  if (code === "price") return zh ? "价格还不可用。先记账，等它记稳。" : "The price is not usable yet. Post it and wait until it settles.";
  if (code === "ltv") return zh ? "超过抵押品价值的 50%。" : "That is over 50% of the collateral.";
  if (code === "min") return zh ? "单笔至少借 10 美元。" : "A loan has to be at least $10.";
  if (code === "same") return zh ? "抵押和借出不能是同一枚。" : "Collateral and debt cannot be the same asset.";
  if (code === "full") return zh ? "这个地址已经有 16 笔没还的。" : "This address already has 16 open loans.";
  if (code === "idle") return zh ? "可取的现金不够，借出去的部分要等还回来。" : "Not enough cash. The part already borrowed has to come back first.";
  if (code === "leader") return zh ? "这个钱包不是多签的签名地址。" : "This wallet is not a signer of the multisig.";
  if (code === "second") return zh ? "已记下这个地址的签名。换成另一个签名地址再点一次，才会从多签发出。" : "This signature is saved. Switch to the other signer and tap again.";
  if (code === "nowallet") return zh ? "先连接钱包。" : "Connect a wallet first.";
  if (code === "self") return zh ? "这是你自己的仓。请还款，不要平自己。" : "This is your loan. Repay it. Do not liquidate yourself.";
  if (code === "revert") return zh ? "链上没有成交。看一下价格、余额和池子现金。" : "The chain did not fill it. Check the price, the balance, and the cash.";
  if (code === "pending") return zh ? "还在确认。不要重复提交。" : "Still confirming. Do not send it again.";
  if (/rejected|denied|cancel/i.test(code)) return zh ? "已取消。" : "Cancelled.";
  return zh ? "没有完成。请等待钱包弹出再确认。" : "It did not finish. Wait for the wallet, then confirm.";
}

function remain(sec: number, zh: boolean): string {
  if (sec <= 0) return zh ? "已到期" : "Past due";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (d > 0) return zh ? `${d} 天 ${pad(h)}:${pad(m)}:${pad(s)}` : `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function signed(value: bigint | null): string {
  if (value == null) return "—";
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const mark = neg ? "−" : value > 0n ? "+" : "";
  return `${mark}${termText(abs, 18, 2)}`;
}

function bpsText(bps: bigint | null): string {
  if (bps == null) return "—";
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

export function TermDesk({ zh, account }: { zh: boolean; account: string | null }) {
  const [chain, setChain] = useState<TermChain>("xlayer");
  const [asset, setAsset] = useState(0);
  const [coll, setColl] = useState(1);
  const [debt, setDebt] = useState(0);
  const [term, setTerm] = useState(2);
  const [putIn, setPutIn] = useState("");
  const [takeOut, setTakeOut] = useState("");
  const [collText, setCollText] = useState("");
  const [debtText, setDebtText] = useState("");
  const [pays, setPays] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [snap, setSnap] = useState<TermSnap | null>(null);
  const [miss, setMiss] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const assets = termAssets(chain);
  const picked = assets.find((row) => row.id === asset) ?? assets[0];
  const collAsset = assets.find((row) => row.id === coll) ?? assets[1] ?? assets[0];
  const debtAsset = assets.find((row) => row.id === debt) ?? assets[0];
  const pool = snap?.pools.find((row) => row.id === picked.id);
  const collPool = snap?.pools.find((row) => row.id === collAsset.id);
  const debtPool = snap?.pools.find((row) => row.id === debtAsset.id);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readTerm(chain, account)
        .then((row) => {
          if (dead) return;
          setSnap(row);
          setMiss(false);
        })
        .catch(() => {
          if (!dead) setMiss(true);
        });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [chain, account, busy]);

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    setBad(false);
    setNote(zh ? "请等待钱包弹出再确认。" : "Wait for the wallet, then confirm.");
    void (async () => {
      try {
        if (!account) await connectAny();
        await work();
        setNote(done);
        setBad(false);
      } catch (err) {
        setNote(failText(err, zh));
        setBad(true);
      } finally {
        setBusy(false);
      }
    })();
  };

  const chooseChain = (next: TermChain) => {
    setChain(next);
    setAsset(0);
    setColl(1);
    setDebt(0);
    setTerm(2);
    setPutIn("");
    setTakeOut("");
    setCollText("");
    setDebtText("");
  };

  const live = Boolean(snap?.live && snap.address && !snap.mismatch);
  const lenderPnl = pool && pool.supply > 0n ? pool.supply - pool.basis : pool?.supply === 0n ? 0n : null;
  const preview = openPreview(collText, debtText, collAsset.decimals, debtAsset.decimals, collPool, debtPool, debtAsset.kind, term, now);

  return (
    <section className="grid gap-3">
      <article className="border border-gold bg-card px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-3xl italic">{zh ? "期贷" : "Term"}</h2>
          <div className="flex gap-1">
            {(["xlayer", "bsc"] as const).map((id) => (
              <button key={id} type="button" className={`min-h-9 px-2 text-xs ${chain === id ? "bg-foil text-ink" : "text-ink/60"}`} onClick={() => chooseChain(id)}>
                {id === "xlayer" ? "X Layer" : "BSC"}
              </button>
            ))}
          </div>
        </div>
        <details className="mt-2 text-xs text-ink/60">
          <summary className="min-h-11 cursor-pointer text-ink/70">{zh ? "规则" : "Rules"}</summary>
          <p className="mt-2 leading-5 text-ink/70">
            {zh
              ? "这是另一本账，不是借贷，也不是期限质押。利率写死。利息按整点、按剩余本金计，不满一小时不计。到期不还，之后每个小时按两倍计，直到还清或被平仓。没还的利息不滚进本金。"
              : "This is a separate book. It is not Lend, and it is not timed stake. The rate is fixed. Interest ticks on the hour, on the remaining principal. A partial hour is not charged. After the due hour it ticks at twice the rate until repayment or liquidation. Unpaid interest is not added to principal."}
          </p>
          <ul className="mt-2 grid gap-1 leading-5">
            <li>{zh ? "八档按整天算：24 小时、3 天、7 天、30 天、90 天、180 天、270 天、365 天。不是日历月。" : "Eight terms, in exact days: 24 hours, 3, 7, 30, 90, 180, 270, 365. Not calendar months."}</li>
            <li>{zh ? "基础年化：USDT、USDT0 是 8%，BNB、OKB 是 12%，BEM、UP、TAPE、FAB 是 18%。期限越长乘 1、1.05、1.10、1.20、1.35、1.50、1.65、1.80。逾期再乘 2。" : "Base APR: USDT and USDT0 8%, BNB and OKB 12%, BEM, UP, TAPE and FAB 18%. Longer terms multiply by 1, 1.05, 1.10, 1.20, 1.35, 1.50, 1.65, 1.80. Overdue doubles that."}</li>
            <li>{zh ? "新开最多借到抵押品的 50%，单笔至少 10 美元。负债率过 75%，别人可以代还，并多拿走大约 5% 的抵押。同一枚不能既抵押又借出。一个人最多 16 笔。" : "New loans stop at 50% of collateral, and at least $10. Above 75%, someone may repay and take about 5% extra collateral. One asset cannot be both sides. Sixteen open loans at most."}</li>
            <li>{zh ? "利息的 10% 记成这条链多签的存款份额，90% 留给存款人。本金不另收费。别人还没还的利息还不在可取余额里。已经借出的本金，现金不够时取不出。" : "Ten percent of interest is credited to that chain's multisig. Lenders keep 90%. Principal is not charged. Unpaid interest is not withdrawable until a repayment or a liquidation. Borrowed principal cannot be withdrawn while cash is short."}</li>
            <li>{zh ? "价格每 10 分钟最多动 0.5%。要连续记到现货价和记下的价相差不超过 2%，才能新借或平仓。超过 30 分钟没记，这两件事停下。还款和加抵押不受影响。稳定币记成 1 美元。直接转进合约的取不回。" : "A posted price moves at most 0.5% every 10 minutes. New loans and liquidations wait until the spot is within 2% of the posted price. After 30 minutes they pause. Repayment and added collateral do not. Stables post at $1. A raw transfer into the contract is lost."}</li>
          </ul>
        </details>
        {snap?.address ? <p className="mt-2 break-all font-mono text-xs text-ink/80">{snap.address}</p> : null}
        {snap?.mismatch ? (
          <p className="mt-2 text-xs text-sell">{zh ? "链上这份对不上期贷合约。" : "The contract on chain is not this term book."}</p>
        ) : null}
        {miss && !snap ? <p className="mt-2 text-xs text-sell">{zh ? "链上没读到。不写成 0。" : "The chain did not answer. This is not shown as zero."}</p> : null}
      </article>

      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-[11px] tracking-[0.14em] text-ink/45">{zh ? "记账" : "Post"}</p>
        <details className="mt-1 text-xs text-ink/55">
          <summary className="min-h-11 cursor-pointer">{zh ? "说明" : "Note"}</summary>
          <p className="mt-1 leading-5">
            {chain === "xlayer"
              ? zh
                ? "先记 USDT0 和 OKB。BEM 要等 OKB 可用。FAB 要等 BEM 可用。TAPE 可以单独记。"
                : "Post USDT0 and OKB first. BEM waits for a usable OKB price. FAB waits for BEM. TAPE can be posted on its own."
              : zh
                ? "先记 USDT、BNB 和 BEM。UP 要等 BEM 可用。"
                : "Post USDT, BNB and BEM first. UP waits for a usable BEM price."}
          </p>
        </details>
        <div className="mt-2 flex flex-wrap gap-1">
          {assets.map((row) => {
            const book = snap?.pools.find((item) => item.id === row.id);
            const ready = freshAt(book, now);
            return (
              <button
                key={row.id}
                type="button"
                disabled={busy || !live}
                className="min-h-9 border border-gold/40 px-2 text-xs disabled:opacity-40"
                onClick={() => run(() => pokeTerm(chain, row.id), zh ? "已记账。" : "Posted.")}
              >
                {zh ? "记" : "Post"} {row.symbol}
                {ready ? (zh ? " · 可用" : " · ready") : book && book.price > 0n ? ` · ${book.stamp}/3` : zh ? " · 还没有" : " · none"}
              </button>
            );
          })}
        </div>
      </article>

      <article className="border border-gold bg-card px-3 py-3">
        <div className="flex flex-wrap gap-1">
          {assets.map((row) => (
            <button key={row.id} type="button" className={`min-h-9 px-2 text-xs ${picked.id === row.id ? "bg-ink text-paper" : "text-ink/60"}`} onClick={() => setAsset(row.id)}>
              {row.symbol}
            </button>
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cell k={zh ? "池子现金" : "Cash"} v={`${pool ? termText(pool.cash, picked.decimals) : "—"} ${picked.symbol}`} />
          <Cell k={zh ? "已借出" : "Borrowed"} v={`${pool ? termText(pool.out, picked.decimals) : "—"} ${picked.symbol}`} />
          <Cell k={zh ? "我的可取" : "I can take"} v={`${pool ? termText(pool.supply, picked.decimals) : "—"} ${picked.symbol}`} />
          <Cell k={zh ? "存款盈亏" : "Supply PnL"} v={pool ? `${tokenSigned(lenderPnl, picked.decimals)} ${picked.symbol}` : "—"} />
        </dl>
        <p className="mt-1 text-xs text-ink/55">
          {pool && pool.price > 0n ? `1 ${picked.symbol} = ${termText(pool.price, 18, 4)} USD` : zh ? "还没有价格。" : "No price yet."}
          {ageText(pool, now, zh)}
        </p>
        <details className="mt-1 text-xs text-ink/55">
          <summary className="min-h-11 cursor-pointer">{zh ? "盈亏怎么算" : "How PnL is counted"}</summary>
          <p className="mt-1 leading-5">
            {zh
              ? "存款盈亏 = 现在能取回的数量 − 还记在你名下的成本。别人没还的利息还没算进来。取出会按比例减成本。已经借出的部分，要等还回来才取得出。"
              : "Supply PnL is what you can take back now, minus the cost still booked to you. Interest nobody has repaid yet is not in it. A withdrawal reduces the cost in proportion. Borrowed funds come out only after they are repaid."}
          </p>
        </details>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink/55">
            {zh ? "存入" : "Supply"} · {zh ? "可用" : "Available"} {pool ? termText(pool.wallet, picked.decimals) : "—"} {picked.symbol}
            <input value={putIn} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink" onChange={(event) => setPutIn(event.target.value)} />
          </label>
          <label className="text-xs text-ink/55">
            {zh ? "取出" : "Withdraw"} · {zh ? "现在可取" : "Withdrawable"} {pool ? termText(pool.supply < pool.cash ? pool.supply : pool.cash, picked.decimals) : "—"} {picked.symbol}
            <input value={takeOut} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink" onChange={(event) => setTakeOut(event.target.value)} />
          </label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy || !live} className="min-h-11 bg-ink text-paper disabled:opacity-40" onClick={() => run(() => depositTerm(chain, picked.id, putIn).then(() => setPutIn("")), zh ? "已存入。" : "Supplied.")}>
            {zh ? "存入" : "Supply"}
          </button>
          <button type="button" disabled={busy || !live} className="min-h-11 border border-ink text-ink disabled:opacity-40" onClick={() => run(() => withdrawTerm(chain, picked.id, takeOut).then(() => setTakeOut("")), zh ? "已取出。" : "Withdrawn.")}>
            {zh ? "取出" : "Withdraw"}
          </button>
        </div>
      </article>

      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-[11px] tracking-[0.14em] text-ink/45">{zh ? "开一笔" : "Open"}</p>
        <p className="mt-1 text-xs text-ink/55">{zh ? "抵押" : "Collateral"}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {assets.map((row) => (
            <button key={row.id} type="button" className={`min-h-9 px-2 text-xs ${collAsset.id === row.id ? "bg-ink text-paper" : "text-ink/60"}`} onClick={() => setColl(row.id)}>
              {row.symbol}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink/55">{zh ? "借出" : "Borrow"}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {assets.map((row) => (
            <button key={row.id} type="button" className={`min-h-9 px-2 text-xs ${debtAsset.id === row.id ? "bg-foil text-ink" : "text-ink/60"}`} onClick={() => setDebt(row.id)}>
              {row.symbol}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
          {TERM_ROWS.map((row) => (
            <button key={row.id} type="button" className={`min-h-12 px-2 text-left text-xs ${term === row.id ? "bg-ink text-paper" : "text-ink/70"}`} onClick={() => setTerm(row.id)}>
              <span className="block">{zh ? row.zh : row.en}</span>
              <span className="block opacity-70">{aprText(debtAsset.kind, row.mul)}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink/55">
            {zh ? "抵押数量" : "Collateral"} · {poolBalance(collPool, collAsset.decimals)} {collAsset.symbol}
            <input value={collText} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink" onChange={(event) => setCollText(event.target.value)} />
          </label>
          <label className="text-xs text-ink/55">
            {zh ? "借入数量" : "Borrow"} · {zh ? "池子现金" : "Cash"} {debtPool ? termText(debtPool.cash, debtAsset.decimals) : "—"} {debtAsset.symbol}
            <input value={debtText} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink" onChange={(event) => setDebtText(event.target.value)} />
          </label>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cell k={zh ? "负债率" : "Debt ratio"} v={bpsText(preview.ltv)} />
          <Cell k={zh ? "借入市值" : "Debt value"} v={preview.debtUsd == null ? "—" : `${termText(preview.debtUsd, 18, 2)} USD`} />
          <Cell k={zh ? "每小时利息" : "Each hour"} v={preview.hour == null ? "—" : `${termText(preview.hour, debtAsset.decimals, 6)} ${debtAsset.symbol}`} />
          <Cell k={zh ? "到期" : "Due"} v={preview.due ? new Date(preview.due * 1000).toLocaleString() : "—"} />
        </dl>
        {collAsset.id === debtAsset.id ? <p className="mt-2 text-xs text-sell">{zh ? "抵押和借出不能是同一枚。" : "Collateral and debt cannot be the same asset."}</p> : preview.warn ? <p className="mt-2 text-xs text-sell">{failText(new Error(preview.warn), zh)}</p> : null}
        <button
          type="button"
          disabled={busy || !live || collAsset.id === debtAsset.id}
          className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40"
          onClick={() => run(() => openTerm(chain, collAsset.id, debtAsset.id, term, collText, debtText).then(() => {
            setCollText("");
            setDebtText("");
          }), zh ? "已开仓。" : "Opened.")}
        >
          {zh ? "开仓" : "Open"}
        </button>
        <details className="mt-2 text-xs text-ink/55">
          <summary className="min-h-11 cursor-pointer">{zh ? "这一档" : "This term"}</summary>
          <p className="mt-1 leading-5">
            {zh
              ? `这一档年化 ${aprText(debtAsset.kind, TERM_ROWS[term]?.mul ?? 10000)}。逾期后小时利息变成两倍。开仓时的净值会记下来，下面的盈亏用现在的净值去减它。`
              : `This term is ${aprText(debtAsset.kind, TERM_ROWS[term]?.mul ?? 10000)} APR. After it is due, the hourly interest doubles. Equity at open is stored. PnL below is equity now minus that.`}
          </p>
        </details>
      </article>

      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-[11px] tracking-[0.14em] text-ink/45">{zh ? "我的仓" : "My loans"}</p>
        {!account ? <p className="mt-2 text-xs text-ink/55">{zh ? "先连接钱包。" : "Connect a wallet."}</p> : null}
        {account && snap && snap.mine.length === 0 ? <p className="mt-2 text-xs text-ink/55">{zh ? "没有未还的期贷。" : "No open term loan."}</p> : null}
        <div className="mt-2 grid gap-2">
          {snap?.mine.map((loan) => (
            <LoanCard
              key={String(loan.id)}
              zh={zh}
              chain={chain}
              loan={loan}
              pools={snap.pools}
              now={now}
              busy={busy || !live}
              pay={pays[String(loan.id)] ?? ""}
              extra={extras[String(loan.id)] ?? ""}
              onPay={(value) => setPays((prev) => ({ ...prev, [String(loan.id)]: value }))}
              onExtra={(value) => setExtras((prev) => ({ ...prev, [String(loan.id)]: value }))}
              onRepay={(amount) => run(() => repayTerm(chain, loan.id, loan.debt, amount), zh ? "已还款。" : "Repaid.")}
              onAdd={(amount) => run(() => addTermColl(chain, loan.id, loan.coll, amount), zh ? "已加上抵押。" : "Collateral added.")}
              onFill={(value) => setPays((prev) => ({ ...prev, [String(loan.id)]: value }))}
            />
          ))}
        </div>
        {snap?.truncated ? <p className="mt-2 text-xs text-ink/45">{zh ? "只列出最近的一部分。" : "Only the latest slice is listed."}</p> : null}
      </article>

      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-[11px] tracking-[0.14em] text-ink/45">{zh ? "可以看的未还仓" : "Open loans"}</p>
        {snap && snap.active.length === 0 ? <p className="mt-2 text-xs text-ink/55">{zh ? "现在没有未还的仓。" : "Nothing is open."}</p> : null}
        <ul className="mt-2">
          {snap?.active.map((loan) => {
            const collRow = termAsset(chain, loan.coll);
            const debtRow = termAsset(chain, loan.debt);
            const cPool = snap.pools.find((row) => row.id === loan.coll);
            const dPool = snap.pools.find((row) => row.id === loan.debt);
            const owed = owedAt(loan, debtRow.kind, now);
            const collUsd = cPool && cPool.price > 0n ? usdOf(loan.collAmt, cPool.price, collRow.decimals) : null;
            const debtUsd = dPool && dPool.price > 0n ? usdOf(owed, dPool.price, debtRow.decimals) : null;
            const ratio = collUsd != null && debtUsd != null ? ltvBps(debtUsd, collUsd) : null;
            const hot = ratio != null && ratio > 7500n;
            const quote = cPool && dPool ? liqPay(loan, owed, cPool.price, dPool.price, collRow.decimals, debtRow.decimals) : null;
            const mine = account && loan.user.toLowerCase() === account.toLowerCase();
            const ready = freshAt(cPool, now) && freshAt(dPool, now);
            return (
              <li key={String(loan.id)} className="border-t border-gold/20 py-2 text-xs first:border-t-0">
                <p className="font-mono">
                  #{loan.id.toString()} · {collRow.symbol} → {debtRow.symbol} · {bpsText(ratio)}
                  {hot ? (zh ? " · 可平" : " · liquidatable") : ""}
                </p>
                <p className="mt-1 text-ink/60">
                  {zh ? "欠" : "Owes"} {termText(owed, debtRow.decimals)} {debtRow.symbol}
                  {" · "}
                  {zh ? "抵押" : "Coll"} {termText(loan.collAmt, collRow.decimals)} {collRow.symbol}
                </p>
                {quote && hot ? (
                  <p className="mt-1 text-ink/60">
                    {zh ? "代还大约" : "Repay about"} {termText(quote.pay, debtRow.decimals)} {debtRow.symbol}
                    {" · "}
                    {zh ? "拿走" : "Take"} {termText(quote.seize, collRow.decimals)} {collRow.symbol}
                  </p>
                ) : null}
                {mine ? <p className="mt-1 text-ink/55">{zh ? "这是你的仓。请在上面还款。" : "This is yours. Repay it above."}</p> : null}
                {!mine && hot ? (
                  <button
                    type="button"
                    disabled={busy || !live || !ready || !quote}
                    className="mt-1 min-h-9 border border-sell px-2 text-sell disabled:opacity-40"
                    onClick={() => quote && run(() => liquidateTerm(chain, loan, quote.pay), zh ? "已平仓。" : "Liquidated.")}
                  >
                    {ready ? (zh ? "平仓" : "Liquidate") : zh ? "价格超过 30 分钟，现在不能平" : "Price is older than 30 minutes"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </article>
      {note ? <p className={`text-xs ${bad ? "text-sell" : "text-ink/70"}`}>{note}</p> : null}
    </section>
  );
}

function poolBalance(pool: TermPool | undefined, decimals: number): string {
  if (!pool) return "—";
  return termText(pool.wallet, decimals);
}

function tokenSigned(value: bigint | null, decimals: number): string {
  if (value == null) return "—";
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const mark = neg ? "−" : value > 0n ? "+" : "";
  return `${mark}${termText(abs, decimals, 4)}`;
}

function ageText(pool: TermPool | undefined, now: number, zh: boolean): string {
  if (!pool || pool.at <= 0) return "";
  const left = pool.at + 30 * 60 - now;
  if (left <= 0) return zh ? " · 已超过 30 分钟" : " · older than 30 minutes";
  return zh ? ` · 30 分钟内还剩 ${remain(left, zh)}` : ` · ${remain(left, zh)} left of 30 minutes`;
}

function parseAmt(text: string, decimals: number): bigint | null {
  const trimmed = text.trim();
  if (!trimmed) return 0n;
  try {
    return units(trimmed, decimals);
  } catch {
    return null;
  }
}

function openPreview(
  collText: string,
  debtText: string,
  collDec: number,
  debtDec: number,
  collPool: TermPool | undefined,
  debtPool: TermPool | undefined,
  kind: "stable" | "gas" | "coin",
  term: number,
  now: number,
): { ltv: bigint | null; debtUsd: bigint | null; hour: bigint | null; due: number; warn: string } {
  const collAmt = parseAmt(collText, collDec);
  const principal = parseAmt(debtText, debtDec);
  const row = TERM_ROWS[term] ?? TERM_ROWS[0];
  const due = Math.floor(Date.now() / 1000) + row.days * 86400;
  if (collAmt == null || principal == null) return { ltv: null, debtUsd: null, hour: null, due, warn: "amount" };
  const hour = principal > 0n ? (principal * hourlyWad(kind, row.mul)) / WAD : null;
  if (!collPool || !debtPool || collPool.price <= 0n || debtPool.price <= 0n || collAmt <= 0n || principal <= 0n) {
    return { ltv: null, debtUsd: principal > 0n && debtPool && debtPool.price > 0n ? usdOf(principal, debtPool.price, debtDec) : null, hour, due, warn: "" };
  }
  const collUsd = usdOf(collAmt, collPool.price, collDec);
  const debtUsd = usdOf(principal, debtPool.price, debtDec);
  const ltv = ltvBps(debtUsd, collUsd);
  let warn = "";
  if (debtUsd < MIN_USD) warn = "min";
  else if (collUsd * 5000n < debtUsd * 10000n) warn = "ltv";
  else if (principal > debtPool.cash) warn = "dry";
  else if (!freshAt(collPool, now) || !freshAt(debtPool, now)) warn = "price";
  return { ltv, debtUsd, hour, due, warn };
}

function LoanCard({
  zh,
  chain,
  loan,
  pools,
  now,
  busy,
  pay,
  extra,
  onPay,
  onExtra,
  onRepay,
  onAdd,
  onFill,
}: {
  zh: boolean;
  chain: TermChain;
  loan: TermLoan;
  pools: TermPool[];
  now: number;
  busy: boolean;
  pay: string;
  extra: string;
  onPay: (value: string) => void;
  onExtra: (value: string) => void;
  onRepay: (amount: string) => void;
  onAdd: (amount: string) => void;
  onFill: (value: string) => void;
}) {
  const coll = termAsset(chain, loan.coll);
  const debt = termAsset(chain, loan.debt);
  const cPool = pools.find((row) => row.id === loan.coll);
  const dPool = pools.find((row) => row.id === loan.debt);
  const owed = owedAt(loan, debt.kind, now);
  const collUsd = cPool && cPool.price > 0n ? usdOf(loan.collAmt, cPool.price, coll.decimals) : null;
  const debtUsd = dPool && dPool.price > 0n ? usdOf(owed, dPool.price, debt.decimals) : null;
  const equity = collUsd != null && debtUsd != null ? collUsd - debtUsd : null;
  const pnl = equity != null ? equity - (loan.collUsd0 - loan.debtUsd0) : null;
  const ratio = collUsd != null && debtUsd != null ? ltvBps(debtUsd, collUsd) : null;
  const closePx = dPool && dPool.price > 0n ? liqCollPrice(owed, dPool.price, debt.decimals, loan.collAmt, coll.decimals) : null;
  const row = TERM_ROWS[loan.term] ?? TERM_ROWS[0];
  const done = Math.floor((Math.max(now, loan.start) - loan.start) / 3600);
  const next = loan.start + (done + 1) * 3600 - now;
  const overdue = now >= loan.due;
  const step = (loan.principal * hourlyWad(debt.kind, row.mul)) / WAD;
  const nextAdd = loan.start + (done + 1) * 3600 > loan.due ? step * 2n : step;
  return (
    <article className={`border px-3 py-3 ${ratio != null && ratio > 7500n ? "border-sell" : "border-gold/40"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm">
          #{loan.id.toString()} · {coll.symbol} / {debt.symbol} · {zh ? row.zh : row.en}
        </p>
        <p className={`font-mono text-sm ${pnl == null ? "" : pnl < 0n ? "text-sell" : "text-up"}`}>{zh ? "盈亏" : "PnL"} {signed(pnl)} USD</p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Cell k={zh ? "净值" : "Equity"} v={equity == null ? "—" : `${signed(equity)} USD`} />
        <Cell k={zh ? "负债率" : "Debt ratio"} v={bpsText(ratio)} />
        <Cell k={zh ? "欠款" : "Owes"} v={`${termText(owed, debt.decimals)} ${debt.symbol}`} />
        <Cell k={zh ? "抵押" : "Coll"} v={`${termText(loan.collAmt, coll.decimals)} ${coll.symbol}`} />
        <Cell k={zh ? "距到期" : "Until due"} v={remain(loan.due - now, zh)} />
        <Cell k={zh ? "距下一小时" : "Next hour"} v={remain(next, zh)} />
        <Cell k={zh ? "下一小时利息" : "Next tick"} v={`${termText(nextAdd, debt.decimals, 6)} ${debt.symbol}`} />
        <Cell k={zh ? "抵押平仓价" : "Close"} v={closePx ? `${termText(closePx, 18, 4)} USD` : "—"} />
      </dl>
      <details className="mt-2 text-xs text-ink/55">
        <summary className="min-h-11 cursor-pointer">{zh ? "计息" : "Interest"}</summary>
        <p className="mt-1 leading-5">
          {overdue
            ? zh
              ? "已经过期。接下来每个整点按两倍计息，直到还清或负债率过 75% 被平仓。"
              : "Past due. Each new hour is charged at twice the rate until you repay or the ratio passes 75%."
            : zh
              ? "利息只在整点加上。这一小时里面欠款不变，倒计时在走。"
              : "Interest is added only on the hour. During this hour the debt stays put. The timer is what moves."}
        </p>
      </details>
      {ratio != null && ratio > 7500n ? <p className="mt-1 text-xs text-sell">{zh ? "负债率已经超过 75%。现在就可以被平仓。" : "The ratio is over 75%. Liquidation is allowed."}</p> : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-ink/55">
          {zh ? "还款" : "Repay"} {debt.symbol}
          <input value={pay} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink" onChange={(event) => onPay(event.target.value)} />
        </label>
        <label className="text-xs text-ink/55">
          {zh ? "再加抵押" : "Add collateral"} {coll.symbol}
          <input value={extra} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink" onChange={(event) => onExtra(event.target.value)} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="min-h-9 px-2 text-xs underline" onClick={() => onFill(termPlain(owed, debt.decimals))}>
          {zh ? "按欠款填入" : "Fill the debt"}
        </button>
        <button type="button" disabled={busy || !pay.trim()} className="min-h-9 bg-ink px-3 text-xs text-paper disabled:opacity-40" onClick={() => onRepay(pay)}>
          {zh ? "还款" : "Repay"}
        </button>
        <button type="button" disabled={busy || !extra.trim()} className="min-h-9 border border-ink px-3 text-xs disabled:opacity-40" onClick={() => onAdd(extra)}>
          {zh ? "加抵押" : "Add"}
        </button>
      </div>
    </article>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink/45">{k}</dt>
      <dd className="font-mono text-sm tabular-nums">{v}</dd>
    </div>
  );
}
