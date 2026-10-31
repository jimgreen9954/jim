import { useEffect, useState } from "react";
import {
  aprText,
  borrowLend,
  depositLend,
  deployLend,
  lendAddress,
  lendChoices,
  lendSpec,
  lendText,
  lockLend,
  pokeLend,
  readLend,
  repayLend,
  unlockLend,
  withdrawLend,
  type LendAsset,
  type LendChain,
  type LendView,
} from "@/lib/lend";
import { connectAny } from "@/lib/wallet";

type Mode = "in" | "out" | "lock" | "free" | "borrow" | "repay";

function failText(err: unknown, zh: boolean): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "amount") return zh ? "数量不对。" : "That amount is not valid.";
  if (code === "usdt") return zh ? "稳定币余额不够。" : "Stablecoin balance is not enough.";
  if (code === "coll") return zh ? "抵押品余额不够。" : "Collateral balance is not enough.";
  if (code === "gas") return zh ? "要留下一点当网络费，不能全部抵押。" : "Leave a little for the network fee. You cannot lock all of it.";
  if (code === "idle") return zh ? "别人借走的部分现在取不出。" : "The part already borrowed cannot be withdrawn now.";
  if (code === "live") return zh ? "这口借贷还没部署。" : "This market is not deployed.";
  if (code === "leader") return zh ? "要用这条链的多签部署。" : "Deploy it with this chain's multisig.";
  if (code === "nowallet") return zh ? "先连接钱包。" : "Connect a wallet first.";
  if (code === "revert") return zh ? "链上没有成交。看一下抵押、欠款和池子里还有没有现金。" : "The chain did not fill it. Check the collateral, the debt, and the cash left in the pool.";
  if (code === "pending") return zh ? "还在确认。不要重复提交。" : "Still confirming. Do not send it again.";
  if (/rejected|denied|cancel/i.test(code)) return zh ? "已取消。" : "Cancelled.";
  return zh ? "没有完成。请等待钱包弹出再确认。" : "It did not finish. Wait for the wallet, then confirm.";
}

export function LendDesk({ zh, account }: { zh: boolean; account: string | null }) {
  const [chain, setChain] = useState<LendChain>("xlayer");
  const [asset, setAsset] = useState<LendAsset>("gas");
  const [view, setView] = useState<LendView | null>(null);
  const [mode, setMode] = useState<Mode>("in");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const market = lendSpec(chain, asset);
  const collMode = mode === "lock" || mode === "free";
  const live = Boolean(lendAddress(chain, asset));

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readLend(chain, asset, account)
        .then((row) => {
          if (!dead) setView(row);
        })
        .catch(() => {
          if (!dead) setView(null);
        });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [chain, asset, account, busy]);

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    setBad(false);
    setNote(zh ? "请等待钱包弹出再确认。" : "Wait for the wallet, then confirm.");
    void (async () => {
      try {
        if (!account) await connectAny();
        await work();
        setAmount("");
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

  const money = (value: bigint | undefined, dec: number = market.usdtDec) => (view && value !== undefined ? lendText(value, dec) : "—");
  const gasFree = view && market.native && view.walletGas > market.reserve ? view.walletGas - market.reserve : view?.walletColl ?? 0n;

  const act = () => {
    if (mode === "in") return depositLend(chain, asset, amount);
    if (mode === "out") return withdrawLend(chain, asset, amount);
    if (mode === "lock") return lockLend(chain, asset, amount);
    if (mode === "free") return unlockLend(chain, asset, amount);
    if (mode === "borrow") return borrowLend(chain, asset, amount);
    return repayLend(chain, asset, amount);
  };

  return (
    <section className="grid gap-3">
      <article className="border border-gold bg-card px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-3xl italic">{zh ? "借贷" : "Lend"}</h2>
          <div className="flex gap-1">
            {(["xlayer", "bsc"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`min-h-9 px-2 text-xs ${chain === id ? "bg-foil text-ink" : "text-ink/60"}`}
                onClick={() => {
                  setChain(id);
                  if (id === "bsc" && asset === "tape") setAsset("gas");
                }}
              >
                {id === "xlayer" ? "X Layer" : "BSC"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-1">
          {lendChoices(chain).map((id) => (
            <button
              key={id}
              type="button"
              className={`min-h-9 px-2 text-xs ${asset === id ? "bg-ink text-paper" : "text-ink/60"}`}
              onClick={() => setAsset(id)}
            >
              {id === "gas" ? marketLabel(chain) : id === "tape" ? "TAPE" : "BEM"}
            </button>
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cell k={zh ? "池子现金" : "Cash"} v={`${money(view?.cash)} ${market.usdtSym}`} />
          <Cell k={zh ? "已借出" : "Borrowed"} v={`${money(view ? view.assets - view.cash : undefined)} ${market.usdtSym}`} />
          <Cell k={zh ? "存款年化" : "Supply"} v={view ? aprText(view.supplyApr) : "—"} />
          <Cell k={zh ? "借款年化" : "Borrow"} v={view ? aprText(view.borrowApr) : "—"} />
        </dl>
        <p className="mt-2 text-xs text-ink/60">
          {view?.price ? `1 ${market.collSym} = ${lendText(view.price, market.usdtDec)} ${market.usdtSym}` : zh ? "价格还没读到。" : "Price has not loaded."}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cell k={zh ? "我的存款" : "My supply"} v={`${money(view?.supply)} ${market.usdtSym}`} />
          <Cell k={zh ? "已抵押" : "Locked"} v={`${money(view?.posted, market.collDec)} ${market.collSym}`} />
          <Cell k={zh ? "欠款" : "Debt"} v={`${money(view?.debt)} ${market.usdtSym}`} />
          <Cell k={zh ? "还能借" : "Room"} v={`${money(view?.maxBorrow)} ${market.usdtSym}`} />
        </dl>
        <ol className="mt-3 grid gap-1.5 text-xs leading-5 text-ink/75">
          <li>{zh ? `1. 这口只借 ${market.usdtSym}。抵押品是 ${market.collSym}。两条链各一口，钱不互通。` : `1. This market lends ${market.usdtSym}. Collateral is ${market.collSym}. The two chains do not share funds.`}</li>
          <li>{zh ? "2. 存入是把稳定币借给别人，赚利息。别人还没还的部分取不出来。" : "2. Deposit means lending the stablecoin. You earn interest. You cannot withdraw what is still on loan."}</li>
          <li>{zh ? `3. 借入要先抵押 ${market.collSym}。最多借到抵押品价值的 50%。欠款会按借款年化变多。` : `3. Lock ${market.collSym} before you borrow. The limit is 50% of the collateral. The debt grows at the borrow rate.`}</li>
          <li>{zh ? "4. 还清以后可以取回抵押。欠款超过抵押品价值的 75%，别人可以替你还款，并多拿走 5% 的抵押。" : "4. After you repay, you can unlock. Above 75% of the collateral value, someone else may repay and take a 5% bonus."}</li>
        </ol>
        <div className="mt-3 flex flex-wrap gap-1">
          {([
            ["in", zh ? "存入" : "Supply"],
            ["out", zh ? "取出" : "Withdraw"],
            ["lock", zh ? "抵押" : "Lock"],
            ["free", zh ? "取回" : "Unlock"],
            ["borrow", zh ? "借入" : "Borrow"],
            ["repay", zh ? "还款" : "Repay"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={`min-h-9 px-2 text-xs ${mode === id ? "bg-ink text-paper" : "text-ink/60"}`} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="mt-2 block text-xs text-ink/55">
          {mode === "in"
            ? `${zh ? "可用" : "Available"} ${money(view?.walletUsdt)} ${market.usdtSym}`
            : mode === "out"
              ? `${zh ? "现在可取" : "Withdrawable"} ${money(view && view.supply < view.cash ? view.supply : view?.cash)} ${market.usdtSym}`
              : mode === "lock"
                ? `${zh ? "可用" : "Available"} ${money(market.native ? gasFree : view?.walletColl, market.collDec)} ${market.collSym}`
                : mode === "free"
                  ? `${zh ? "可取回" : "Free"} ${money(view?.freeColl, market.collDec)} ${market.collSym}`
                  : mode === "borrow"
                    ? `${zh ? "还能借" : "Room"} ${money(view?.maxBorrow)} ${market.usdtSym}`
                    : `${zh ? "可用" : "Available"} ${money(view?.walletUsdt)} ${market.usdtSym}`}
          <input
            value={amount}
            inputMode="decimal"
            placeholder={collMode ? market.collSym : market.usdtSym}
            className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        {live ? (
          <button type="button" disabled={busy} className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40" onClick={() => run(act, zh ? "已完成。" : "Done.")}>
            {mode === "in" ? (zh ? "存入" : "Supply") : mode === "out" ? (zh ? "取出" : "Withdraw") : mode === "lock" ? (zh ? "抵押" : "Lock") : mode === "free" ? (zh ? "取回" : "Unlock") : mode === "borrow" ? (zh ? "借入" : "Borrow") : zh ? "还款" : "Repay"}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40"
            onClick={() => {
              if (busy) return;
              setBusy(true);
              setBad(false);
              setNote(zh ? "请等待钱包弹出再确认。" : "Wait for the wallet, then confirm.");
              void (async () => {
                try {
                  if (!account) await connectAny();
                  const addr = await deployLend(chain, asset);
                  setNote(zh ? `已部署 ${addr}。把这个地址发我。` : `Deployed at ${addr}. Send me this address.`);
                } catch (err) {
                  setNote(failText(err, zh));
                  setBad(true);
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {zh ? "用多签部署这口借贷" : "Deploy this market with the multisig"}
          </button>
        )}
        {live && !market.native && market.mode !== 0 ? (
          <button
            type="button"
            disabled={busy}
            className="mt-2 min-h-9 w-full text-xs text-ink/70 disabled:opacity-40"
            onClick={() => run(() => pokeLend(chain, asset), zh ? "价格已向前记了一步。" : "The price moved one step.")}
          >
            {view?.fresh ? (zh ? "价格有效。可以再记账，每次最多 0.5%。" : "Price is fresh. Posting again moves it by at most 0.5%.") : zh ? "价格停了。先记账，新的借款才开。" : "The price is stale. Post it before a new borrow."}
          </button>
        ) : null}
        <details className="mt-2 text-xs text-ink/55">
          <summary className="cursor-pointer">{zh ? "详细规则" : "Full rules"}</summary>
          <div className="mt-1 grid gap-1 leading-5">
            <p>{zh ? "没有管理员，也没有人能把池子里的钱转走。利息全部留给存款人。借款年化从 2% 起，最高 50%。" : "There is no admin and no way to transfer the pool out. All interest stays with suppliers. Borrow interest starts at 2% and stops at 50%."}</p>
            <p>{market.mode === 0 ? (zh ? `价格用 ${market.collSym} 对 ${market.usdtSym} 池子的 30 分钟均价，不用最后一笔成交。均价朝对借款人更严的方向取整。` : `The price is a 30-minute average of the ${market.collSym}/${market.usdtSym} pool, not the last trade. It is rounded against the borrower.`) : (zh ? "价格从现货池子读出，但每 30 秒最多走动 0.5%。超过 30 分钟没有记账，就不能新借，旧的欠款仍按最后记下的价格清算。" : "The price comes from the spot pool, but it can move at most 0.5% every 30 seconds. After 30 minutes without an update, new borrows pause. Old debt is still valued at the last posted price.")}</p>
            <p>{zh ? "有人替你还款时，多拿走的 5% 从你的抵押里出。抵押不够覆盖欠款时，差额由存款人承担，你的抵押会被买完。" : "A liquidation takes a 5% bonus from your collateral. If the collateral cannot cover the debt, suppliers take the shortfall and the collateral is sold."}</p>
            <p>{market.native ? (zh ? "抵押直接付 OKB 或 BNB，合约自己换成包装币。请留下一点当网络费。" : "You lock OKB or BNB directly. The contract wraps it. Leave a little for the network fee.") : (zh ? `抵押的是钱包里的 ${market.collSym}。第一次会先授权，再抵押。` : `You lock the ${market.collSym} already in the wallet. The first time asks for approval, then the lock.`)}</p>
          </div>
        </details>
        {note ? <p className={`mt-2 text-xs ${bad ? "text-down" : "text-ink/70"}`}>{note}</p> : null}
      </article>
    </section>
  );
}

function marketLabel(chain: LendChain) {
  return chain === "xlayer" ? "OKB" : "BNB";
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-gold/30 px-2 py-2">
      <dt className="text-[11px] text-ink/50">{k}</dt>
      <dd className="mt-1 text-sm">{v}</dd>
    </div>
  );
}
