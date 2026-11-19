import { useEffect, useState } from "react";
import {
  cancelVault,
  closeVault,
  openVault,
  readCopyVault,
  showAmt,
  syncVault,
  takeVault,
  withdrawVault,
  type VaultChain,
  type VaultView,
} from "@/lib/copy-vault";
import { connectAny } from "@/lib/wallet";

const empty = "";

function failText(err: unknown, zh: boolean): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "amount") return zh ? "数量不对。" : "That amount is not valid.";
  if (code === "margin") return zh ? "保证金要在 1 到 500 之间。" : "Margin must be from 1 to 500.";
  if (code === "price") return zh ? "限价要在 0.01 到 100000 之间。" : "Limit price must be from 0.01 to 100000.";
  if (code === "lev") return zh ? "杠杆要在 1 到 1000 之间。" : "Leverage must be from 1 to 1000.";
  if (code === "usdt") return zh ? "余额不够。" : "Balance is not enough.";
  if (code === "idle") return zh ? "闲置现金不够取出这一笔。已部署合约有仓时，仍可能让别人先取走现金。" : "Idle cash cannot cover this withdrawal. On the deployed vault, someone can still take cash while a position is open.";
  if (code === "halt") return zh ? "新的存入已关闭。页面不会再发起存款。" : "New deposits are closed. This page will not send one.";
  if (code === "token") return zh ? "这口金库的稳定币不在已知名单里，页面不猜它的小数位。" : "This vault's token is not a known stablecoin. The page will not guess its decimals.";
  if (code === "nowallet") return zh ? "先连接钱包。" : "Connect a wallet first.";
  if (code === "leader") return zh ? "只有这口金库链上的带单地址能下单。" : "Only the leader stored on this vault can trade.";
  if (code === "revert") return zh ? "链上没有成交。" : "The chain did not fill it.";
  if (code === "pending") return zh ? "还在确认。不要重复提交。" : "Still confirming. Do not send it again.";
  if (/rejected|denied|cancel/i.test(code)) return zh ? "已取消。" : "Cancelled.";
  return zh ? "没有完成。请等待钱包弹出再确认。" : "It did not finish. Wait for the wallet, then confirm.";
}

export function CopyVault({ zh, account }: { zh: boolean; account: string | null }) {
  const [chain, setChain] = useState<VaultChain>("xlayer");
  const [view, setView] = useState<VaultView | null>(null);
  const [side, setSide] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState(empty);
  const [long, setLong] = useState(true);
  const [margin, setMargin] = useState(empty);
  const [lev, setLev] = useState("1");
  const [price, setPrice] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(empty);
  const [bad, setBad] = useState(false);
  const unit = {
    decimals: view?.decimals ?? null,
    symbol: view?.symbol || (zh ? "未知" : "unknown"),
  };
  const leader = Boolean(account && view && account.toLowerCase() === view.leader.toLowerCase());

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readCopyVault(chain, account)
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
  }, [chain, account, busy]);

  const say = (text: string, failed = false) => {
    setBad(failed);
    setNote(text);
  };

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    say(zh ? "请等待钱包弹出再确认。" : "Wait for the wallet, then confirm.");
    void (async () => {
      try {
        if (!account) await connectAny();
        await work();
        say(done);
        setAmount(empty);
      } catch (err) {
        say(failText(err, zh), true);
      } finally {
        setBusy(false);
      }
    })();
  };

  const money = (value: bigint | undefined) =>
    view && value !== undefined && unit.decimals != null ? showAmt(value, unit.decimals) : "—";

  return (
    <section className="grid gap-3">
      <article className="border border-gold bg-card px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-3xl italic">{zh ? "跟单金库" : "Copy vault"}</h2>
          <div className="flex gap-1">
            {(["xlayer", "bsc"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`min-h-9 px-2 text-xs ${chain === id ? "bg-foil text-ink" : "text-ink/60"}`}
                onClick={() => setChain(id)}
              >
                {id === "xlayer" ? "X Layer" : "BSC"}
              </button>
            ))}
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cell k={zh ? "净值" : "Equity"} v={`${money(view?.equity)} ${unit.symbol}`} />
          <Cell k={zh ? "可取" : "Idle"} v={`${money(view?.idle)} ${unit.symbol}`} />
          <Cell k={zh ? "锁在仓里" : "Locked"} v={`${money(view?.locked)} ${unit.symbol}`} />
          <Cell k={zh ? "我的" : "Mine"} v={`${money(view?.claim)} ${unit.symbol}`} />
        </dl>
        <div className="mt-3 flex gap-1">
          <button type="button" className={`min-h-9 px-3 text-sm ${side === "in" ? "bg-ink text-paper" : "text-ink/60"}`} onClick={() => setSide("in")}>
            {zh ? "存入" : "Deposit"}
          </button>
          <button type="button" className={`min-h-9 px-3 text-sm ${side === "out" ? "bg-ink text-paper" : "text-ink/60"}`} onClick={() => setSide("out")}>
            {zh ? "取出" : "Withdraw"}
          </button>
        </div>
        <label className="mt-2 block text-xs text-ink/55">
          {side === "in"
            ? zh
              ? `可用 ${money(view?.wallet)} ${unit.symbol}`
              : `Available ${money(view?.wallet)} ${unit.symbol}`
            : zh
              ? `现在可取 ${money(view?.withdrawable)} ${unit.symbol}`
              : `Withdrawable now ${money(view?.withdrawable)} ${unit.symbol}`}
          <input
            value={amount}
            inputMode="decimal"
            placeholder={side === "in" ? (zh ? "存入数量" : "Amount") : zh ? "取出数量" : "Amount"}
            className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy || side === "in"}
          className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40"
          onClick={() => {
            if (side === "in") return;
            run(() => withdrawVault(chain, amount), zh ? "已取出。" : "Withdrawn.");
          }}
        >
          {side === "in" ? (zh ? "存入已关闭" : "Deposits closed") : zh ? "取出" : "Withdraw"}
        </button>
        <ol className="mt-3 grid gap-1.5 text-xs leading-5 text-ink/75">
          <li>
            {zh
              ? "1. 先选链。页面读的是这口新金库自己的 book、稳定币和带单人。两口新金库的钱不互通。旧金库没有升级，页面不再读它。"
              : "1. Pick a chain. This page reads this new vault's own book, token, and leader. The two new vaults do not share funds. The old vault was not upgraded, and this page no longer reads it."}
          </li>
          <li>
            {zh
              ? "2. 新的存入已关闭，页面不会再授权或存款。带单开仓也已停用。这口新金库在还有挂单、仓位或未结保证金时，存和取都会失败，结清后才按现金记净值。"
              : "2. New deposits are closed. This page will not approve or deposit. Opening a copy trade is already stopped. This new vault rejects deposit and withdraw while a quote, a position, or unsettled margin remains, and prices shares on cash only after it is flat."}
          </li>
          <li>
            {zh
              ? "3. 上面的净值是现金加上锁着的保证金，不是未实现盈亏。有仓时这口新金库不让取。"
              : "3. Equity on screen is cash plus locked margin, not unrealized PnL. This new vault will not pay a withdrawal while a position is open."}
          </li>
          <li>
            {zh
              ? "4. 取出发给这口新金库。有挂单、仓位或未结保证金时合约会拒绝。旧金库不在这个按钮上。"
              : "4. Withdraw calls this new vault. It reverts while a quote, a position, or unsettled margin remains. The old vault is not this button."}
          </li>
        </ol>
        <details className="mt-2 text-xs text-ink/55">
          <summary className="cursor-pointer">{zh ? "详细规则" : "Full rules"}</summary>
          <div className="mt-1 grid gap-1 leading-5">
            <p>
              {zh
                ? "带单人是这口金库的多签。只能开仓、吃单、撤单、平仓。没有把存款转到自己钱包的功能，也没有管理员提取。"
                : "The leader is this vault's multisig. It can only open, take, cancel, and close. It cannot transfer deposits to its own wallet, and there is no admin withdrawal."}
            </p>
            <p>
              {zh
                ? "抽成 10%。只在全部平掉、利润已经回到金库、并且净值高过历史最高时，从多出来的利润里抽。亏的时候不抽，本金不抽。"
                : "The cut is 10%. It is taken only after everything is closed, the profit is back in the vault, and equity is above its high. Losses pay no cut. Principal pays no cut."}
            </p>
            <p>
              {zh
                ? "中途按浮动盈亏进出，这口新金库不允许。页面已关掉新存入。直接调用旧金库仍可能存入，那不是这个页面发的。"
                : "This new vault does not accept a deposit or a withdrawal against unrealized PnL. The page no longer sends deposits. A direct call to the old vault can still deposit. This page does not send that."}
            </p>
            <p>
              {zh
                ? "带单会亏，仓位也可能被强平。那是交易结果。存入之前看清楚这条链和这个带单人。"
                : "The leader can lose, and a position can be liquidated. That is the trading result. Check the chain and the leader before you deposit."}
            </p>
          </div>
        </details>
        {note ? <p className={`mt-2 text-xs ${bad ? "text-down" : "text-ink/70"}`}>{note}</p> : null}
      </article>
      {leader ? (
        <article className="border border-gold bg-card px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-display text-2xl italic">{zh ? "带单" : "Lead"}</h3>
            <button
              type="button"
              disabled={busy}
              className="min-h-9 px-2 text-xs text-ink/70 disabled:opacity-40"
              onClick={() => run(() => syncVault(chain), zh ? "已记账。" : "Synced.")}
            >
              {zh ? "记账" : "Sync"}
            </button>
          </div>
          {view?.mark ? (
            <button type="button" className="mt-1 text-xs text-ink/60" onClick={() => setPrice(showAmt(view.mark || 0n, 18).replace(/,/g, ""))}>
              {zh ? "标记" : "Mark"} {showAmt(view.mark, 18)}
            </button>
          ) : null}
          <div className="mt-2 flex gap-1">
            <button type="button" className={`min-h-9 px-3 text-sm ${long ? "bg-up text-paper" : "text-ink/60"}`} onClick={() => setLong(true)}>
              {zh ? "做多" : "Long"}
            </button>
            <button type="button" className={`min-h-9 px-3 text-sm ${!long ? "bg-down text-paper" : "text-ink/60"}`} onClick={() => setLong(false)}>
              {zh ? "做空" : "Short"}
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label={zh ? "保证金" : "Margin"} value={margin} placeholder="1" onChange={setMargin} />
            <Field label={zh ? "杠杆" : "Leverage"} value={lev} placeholder="1" onChange={setLev} />
            <Field label={zh ? "限价" : "Limit"} value={price} placeholder={zh ? "限价" : "Limit"} onChange={setPrice} />
          </div>
          <button
            type="button"
            disabled={busy}
            className="mt-2 min-h-11 w-full border border-gold disabled:opacity-40"
            onClick={() =>
              run(
                () => openVault(chain, long, margin, Number(lev), price),
                zh ? "已挂出。" : "Posted.",
              )
            }
          >
            {zh ? "挂单" : "Post"}
          </button>
          <ul className="mt-3 grid gap-2">
            {view?.quotes.map((quote) => (
              <li key={`${quote.ours ? "o" : "b"}-${quote.id.toString()}`} className="flex items-center justify-between gap-2 border border-gold/30 px-2 py-2 text-xs">
                <span>
                  #{quote.id.toString()} {quote.long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} · {unit.decimals != null ? showAmt(quote.margin, unit.decimals) : "—"} {unit.symbol} · {quote.lev}x · {showAmt(quote.price, 18)}
                </span>
                {quote.ours ? (
                  <button type="button" disabled={busy} className="min-h-9 px-2" onClick={() => run(() => cancelVault(chain, quote.id), zh ? "已撤单。" : "Cancelled.")}>
                    {zh ? "撤单" : "Cancel"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-9 px-2"
                    onClick={() => run(() => takeVault(chain, quote.id, margin || (unit.decimals != null ? showAmt(quote.margin, unit.decimals).replace(/,/g, "") : ""), Number(lev) || quote.lev), zh ? "已吃单。" : "Taken.")}
                  >
                    {zh ? "吃单" : "Take"}
                  </button>
                )}
              </li>
            ))}
            {view?.deals.map((deal) => (
              <li key={`d-${deal.id.toString()}`} className="flex items-center justify-between gap-2 border border-gold/30 px-2 py-2 text-xs">
                <span>
                  #{deal.id.toString()} {deal.long ? (zh ? "多仓" : "Long") : zh ? "空仓" : "Short"} · {unit.decimals != null ? showAmt(deal.margin, unit.decimals) : "—"} {unit.symbol} · {showAmt(deal.entry, 18)}
                </span>
                <button type="button" disabled={busy} className="min-h-9 px-2" onClick={() => run(() => closeVault(chain, deal.id), zh ? "已平仓。" : "Closed.")}>
                  {zh ? "平仓" : "Close"}
                </button>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-gold/30 px-2 py-2">
      <dt className="text-[11px] text-ink/50">{k}</dt>
      <dd className="mt-1 text-sm">{v}</dd>
    </div>
  );
}

function Field({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (next: string) => void }) {
  return (
    <label className="text-xs text-ink/55">
      {label}
      <input
        value={value}
        inputMode="decimal"
        placeholder={placeholder}
        className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
