import { useEffect, useState } from "react";
import {
  aprText,
  borrowLend,
  depositLend,
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
  if (code === "leader") return zh ? "这个钱包不是多签的签名地址。" : "This wallet is not a signer of the multisig.";
  if (code === "second") return zh ? "已记下这个地址的签名。换成另一个签名地址再点一次，才会从多签发出。" : "This signature is saved. Switch to the other signer and tap again. Then it is sent from the multisig.";
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
        {view?.price ? <p className="mt-2 text-xs text-ink/60">{`1 ${market.collSym} = ${lendText(view.price, market.usdtDec)} ${market.usdtSym}`}</p> : null}
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cell k={zh ? "我的存款" : "My supply"} v={`${money(view?.supply)} ${market.usdtSym}`} />
          <Cell k={zh ? "已抵押" : "Locked"} v={`${money(view?.posted, market.collDec)} ${market.collSym}`} />
          <Cell k={zh ? "欠款" : "Debt"} v={`${money(view?.debt)} ${market.usdtSym}`} />
          <Cell k={zh ? "还能借" : "Room"} v={`${money(view?.maxBorrow)} ${market.usdtSym}`} />
        </dl>
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
        <button type="button" disabled={busy} className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40" onClick={() => run(act, zh ? "已完成。" : "Done.")}>
          {mode === "in" ? (zh ? "存入" : "Supply") : mode === "out" ? (zh ? "取出" : "Withdraw") : mode === "lock" ? (zh ? "抵押" : "Lock") : mode === "free" ? (zh ? "取回" : "Unlock") : mode === "borrow" ? (zh ? "借入" : "Borrow") : zh ? "还款" : "Repay"}
        </button>
        {live && !market.native && market.mode !== 0 ? (
          <button
            type="button"
            disabled={busy}
            className="mt-2 min-h-9 w-full text-xs text-ink/70 disabled:opacity-40"
            onClick={() => run(() => pokeLend(chain, asset), zh ? "已完成。" : "Done.")}
          >
            {zh ? "记账" : "Post"}
          </button>
        ) : null}
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
