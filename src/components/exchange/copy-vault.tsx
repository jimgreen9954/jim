import { useEffect, useState } from "react";
import {
  cancelVault,
  closeVault,
  depositVault,
  openVault,
  readCopyVault,
  showAmt,
  syncVault,
  takeVault,
  vaultLeader,
  vaultUnit,
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
  if (code === "idle") return zh ? "有仓位时，只能取出还没锁上的钱。" : "While a position is open, only idle cash can be withdrawn.";
  if (code === "leader") return zh ? "只有带单多签能下单。" : "Only the leader multisig can trade.";
  if (code === "nowallet") return zh ? "先连接钱包。" : "Connect a wallet first.";
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
  const unit = vaultUnit(chain);
  const leader = Boolean(account && account.toLowerCase() === vaultLeader(chain).toLowerCase());

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

  const money = (value: bigint | undefined) => (view && value !== undefined ? showAmt(value, unit.decimals) : "—");

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
          disabled={busy}
          className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40"
          onClick={() =>
            run(
              () => (side === "in" ? depositVault(chain, amount) : withdrawVault(chain, amount)),
              side === "in" ? (zh ? "已存入。" : "Deposited.") : zh ? "已取出。" : "Withdrawn.",
            )
          }
        >
          {side === "in" ? (zh ? "存入" : "Deposit") : zh ? "取出" : "Withdraw"}
        </button>
        <ol className="mt-3 grid gap-1.5 text-xs leading-5 text-ink/75">
          <li>
            {zh
              ? "1. 先选链。X Layer 存 USDT0，跟的是 X Layer 永续。BSC 存 USDT，跟的是 BSC 永续。两口金库的钱不互通。"
              : "1. Pick a chain. X Layer takes USDT0 and follows the X Layer perp. BSC takes USDT and follows the BSC perp. The two vaults do not share funds."}
          </li>
          <li>
            {zh
              ? "2. 点存入。第一次会先授权，再存入。你拿到的是份额，不是单独开给你的仓。金库赚钱，每份更值钱。金库亏钱，每份更便宜。"
              : "2. Deposit. The first time asks for approval, then the deposit. You receive shares, not a private position. If the vault gains, each share is worth more. If it loses, each share is worth less."}
          </li>
          <li>
            {zh
              ? "3. 带单人用金库的钱挂单、吃单、平仓。上面的净值是现金加上还锁在仓里的保证金。我的，是你的份额现在值多少。"
              : "3. The leader posts, takes, and closes with the vault's money. Equity is cash plus margin still locked in positions. Mine is what your shares are worth now."}
          </li>
          <li>
            {zh
              ? "4. 点取出。没有仓位时，按份额拿回。有仓位时，锁进仓里的保证金取不出，只能取还留在金库里的现金。平仓之后再取剩下的。"
              : "4. Withdraw. With no position, you take your share. With a position open, locked margin stays. You can take only the cash still sitting in the vault. The rest comes out after the position closes."}
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
                ? "中途存入，按当时净值买份额。有仓时，净值先按锁进去的保证金算，没平仓的浮动盈亏还不能取出。"
                : "A deposit made midway buys shares at the equity then. While a position is open, equity counts locked margin at cost. Unrealized profit cannot be withdrawn yet."}
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
                  #{quote.id.toString()} {quote.long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} · {showAmt(quote.margin, unit.decimals)} {unit.symbol} · {quote.lev}x · {showAmt(quote.price, 18)}
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
                    onClick={() => run(() => takeVault(chain, quote.id, margin || showAmt(quote.margin, unit.decimals).replace(/,/g, ""), Number(lev) || quote.lev), zh ? "已吃单。" : "Taken.")}
                  >
                    {zh ? "吃单" : "Take"}
                  </button>
                )}
              </li>
            ))}
            {view?.deals.map((deal) => (
              <li key={`d-${deal.id.toString()}`} className="flex items-center justify-between gap-2 border border-gold/30 px-2 py-2 text-xs">
                <span>
                  #{deal.id.toString()} {deal.long ? (zh ? "多仓" : "Long") : zh ? "空仓" : "Short"} · {showAmt(deal.margin, unit.decimals)} {unit.symbol} · {showAmt(deal.entry, 18)}
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
