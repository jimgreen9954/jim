import { useEffect, useState } from "react";
import {
  askVaultExit,
  cancelVault,
  closeVault,
  depositVault,
  forceVaultFlat,
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
import { SyncDesk } from "@/components/exchange/sync-desk";

const empty = "";

function failText(err: unknown, zh: boolean): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "amount") return zh ? "数量不对。" : "That amount is not valid.";
  if (code === "margin") return zh ? "保证金要在 1 到 500 之间。" : "Margin must be from 1 to 500.";
  if (code === "price") return zh ? "限价要在 0.01 到 100000 之间。" : "Limit price must be from 0.01 to 100000.";
  if (code === "lev") return zh ? "杠杆要在 1 到 50 之间。" : "Leverage must be from 1 to 50.";
  if (code === "usdt") return zh ? "余额不够。" : "Balance is not enough.";
  if (code === "idle") return zh ? "闲置现金不够取出这一笔。已部署合约有仓时，仍可能让别人先取走现金。" : "Idle cash cannot cover this withdrawal. On the deployed vault, someone can still take cash while a position is open.";
  if (code === "flat") return zh ? "金库还有挂单或仓位。结清以后才能存入或取出。" : "The vault still has a quote or a position. Deposit and withdrawal wait until it is flat.";
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
  const [rulesOpen, setRulesOpen] = useState(false);
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
            {zh ? "份额" : "Shares"}
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
            placeholder={side === "in" ? (zh ? "份额数量" : "Shares") : zh ? "取出数量" : "Amount"}
            className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={busy}
          className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40"
          onClick={() => {
            if (side === "in") run(() => depositVault(chain, amount), zh ? "已存入。" : "Deposited.");
            else run(() => withdrawVault(chain, amount), zh ? "已取出。" : "Withdrawn.");
          }}
        >
          {side === "in" ? (zh ? "存入份额" : "Deposit shares") : zh ? "取出份额" : "Withdraw shares"}
        </button>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            disabled={busy}
            className="min-h-10 border border-gold text-xs disabled:opacity-40"
            onClick={() => run(() => askVaultExit(chain), zh ? "已开始计时。满 6 小时后可以强制平仓。" : "The clock has started. After 6 hours anyone can force it flat.")}
          >
            {zh ? "申请退出" : "Ask to exit"}
          </button>
          <button
            type="button"
            disabled={busy}
            className="min-h-10 border border-gold text-xs disabled:opacity-40"
            onClick={() => run(() => forceVaultFlat(chain), zh ? "已强制平掉这口金库自己的单。" : "This vault's own orders are flat.")}
          >
            {zh ? "满 6 小时后强制平仓" : "Force flat after 6 hours"}
          </button>
        </div>
        <button type="button" className="mt-3 min-h-9 text-xs text-ink/70" onClick={() => setRulesOpen((open) => !open)}>
          {rulesOpen ? (zh ? "收起说明" : "Hide notes") : zh ? "说明" : "Notes"}
        </button>
        {rulesOpen ? (
          <div className="mt-2 grid gap-2 text-xs leading-5 text-ink/75">
            <p>
              {zh
                ? "这里只处理跟单金库的份额。取出的是这口金库里的稳定币。它不是 UP、TAPE、FAB 的保险金，也不能用来开那三本的仓。"
                : "This only handles copy-vault shares. A withdrawal pays this vault's stablecoin. It is not the UP, TAPE or FAB insurance, and it cannot open those books."}
            </p>
            <p>
              {zh
                ? "页面读的是新金库。BSC 0x66EFC8E54F84D5349F2445F4A836A503B09F4039 绑当前 BEM 永续 0x070c66555535e1145275df54f4eEBBfd28d98581。X Layer 0xA270097f263cb935beFE69AbeE7C6BDF02a08494 绑当前 BEM 永续 0x46cBAfCA59873E7115dF7825fdBF659BafAc3a51。上一口 BSC 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5 和 X Layer 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe 净值都是 0，页面不再读。"
                : "The page reads the new vaults. BSC 0x66EFC8E54F84D5349F2445F4A836A503B09F4039 is bound to the live BEM book 0x070c66555535e1145275df54f4eEBBfd28d98581. X Layer 0xA270097f263cb935beFE69AbeE7C6BDF02a08494 is bound to the live BEM book 0x46cBAfCA59873E7115dF7825fdBF659BafAc3a51. The previous vaults, BSC 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5 and X Layer 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe, have zero equity. The page does not read them."}
            </p>
            <p>
              {zh
                ? "金库没有挂单和仓位时可以存入和取出。存入只从当前钱包扣稳定币，取出只付回这个钱包。带单地址不能把存款转到自己的钱包。"
                : "A deposit or a withdrawal needs the vault flat. A deposit pulls stablecoin only from this wallet, and a withdrawal pays only this wallet. The leader cannot move deposits to its own wallet."}
            </p>
            <p>
              {zh
                ? "有份额的地址可以申请退出。满 6 小时后，任何人可以强制平掉这口金库自己的挂单和仓位。时间未到，强制平仓会失败。这两口在已申请退出后都不再新开。"
                : "A shareholder can ask to exit. After 6 hours anyone can force this vault's own quotes and positions flat. Before that, force-flat fails. After the request, neither of these two vaults can open again."}
            </p>
            <p>
              {zh
                ? "带单地址是这口金库的多签，只能开仓、吃单、撤单和平仓，不能把存款转到自己的钱包。抽成 10%，只在全部平仓、利润回到金库、并且净值高过历史最高时，从多出来的部分收取。亏损不抽，本金不抽。"
                : "The leader is this vault's multisig. It can open, take, cancel and close. It cannot transfer deposits to its own wallet. The cut is 10%, taken only after the vault is flat, profit is back in cash, and equity is above its high. Losses and principal are not cut."}
            </p>
          </div>
        ) : null}
        {note ? <p className={`mt-2 text-xs ${bad ? "text-down" : "text-ink/70"}`}>{note}</p> : null}
      </article>
      <SyncDesk zh={zh} />
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
            onClick={() => {
              run(
                () => openVault(chain, long, margin, Number(lev), price),
                zh ? "已挂出。" : "Posted.",
              );
            }}
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
