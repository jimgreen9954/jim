import { useEffect, useState } from "react";
import { bindGate, cancelGateChain, claimGate, closeGateChain, gateAddress, openGate, readGateChain, readGateRebate, registerGate, takeGateChain, type ChainDeal, type ChainOrder } from "@/lib/gate-chain";
import { getTransistorDesk, type TransistorDesk } from "@/lib/transistor-market";
import { currentAccount, onAccount } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";

const GATES = [
  ["0xcc42ba5de07f01b472a5b14cf45abcca79eb8087", 0],
  ["0xcc42ba5de07f01b472a5b14cf45abcca79eb8087", 1],
  ["0xe2dfd802081c7a05341e20b6582b04b908e8550c", 0],
  ["0xe2dfd802081c7a05341e20b6582b04b908e8550c", 1],
  ["0x1d23bf70ec6baad95f396ea38f8a8415119dfde6", 0],
  ["0x1d23bf70ec6baad95f396ea38f8a8415119dfde6", 1],
] as const;

function marketOf(token: string, id: number): number {
  const found = GATES.findIndex((row) => row[0] === token.toLowerCase() && row[1] === id);
  return found < 0 ? 0 : found;
}

function px(value: number): string {
  if (!(value > 0)) return "—";
  if (value < 0.001) return value.toFixed(8);
  if (value < 1) return value.toFixed(4);
  return value.toFixed(2);
}

function short(user: string): string {
  return `${user.slice(0, 6)}…${user.slice(-4)}`;
}

const NAMES = ["TapeOut NAND", "TapeOut LATCH", "Behemoth NAND", "Behemoth LATCH", "Genesis NAND", "Genesis LATCH"];
const FIRST = { token: "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087", id: 0 };
const LEVS = [1, 5, 10, 20, 50, 100];

function pnlOf(row: ChainDeal, user: string, mark: number): number {
  if (!(mark > 0) || !(row.entry > 0)) return 0;
  const long = row.longUser.toLowerCase() === user.toLowerCase();
  const margin = long ? row.marginL : row.marginS;
  const lev = long ? row.levL : row.levS;
  const other = long ? row.marginS : row.marginL;
  const raw = margin * lev * ((mark - row.entry) / row.entry) * (long ? 1 : -1);
  return Math.max(-margin, Math.min(other, raw));
}

export function TransistorDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(null);
  const [pick, setPick] = useState(FIRST);
  const [desk, setDesk] = useState<TransistorDesk | null>(null);
  const [perp, setPerp] = useState("");
  const [orders, setOrders] = useState<ChainOrder[]>([]);
  const [deals, setDeals] = useState<ChainDeal[]>([]);
  const [margin, setMargin] = useState("1");
  const [limit, setLimit] = useState("");
  const [lev, setLev] = useState(10);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [mineCode, setMineCode] = useState("");
  const [friend, setFriend] = useState("");
  const [rebate, setRebate] = useState({ accrued: 0, code: "", referrer: "" });

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => setPerp(gateAddress()), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      getTransistorDesk({ data: pick }).then((next) => {
        if (!dead) setDesk(next);
      }).catch(() => undefined);
      const addr = gateAddress();
      if (!addr) return;
      readGateChain(addr).then((next) => {
        if (!dead) {
          setOrders(next.orders);
          setDeals(next.deals);
        }
      }).catch(() => undefined);
      const who = currentAccount();
      if (who) readGateRebate(who).then((next) => { if (!dead) setRebate(next); }).catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 1000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [pick]);

  const gate = desk?.gates.find((row) => row.transistors.toLowerCase() === pick.token.toLowerCase() && row.tokenId === pick.id);
  const mark = gate?.price ?? 0;
  const market = marketOf(pick.token, pick.id);
  const mine = (account ?? currentAccount() ?? "").toLowerCase();
  const resting = orders.filter((row) => row.market === market);
  const asks = resting.filter((row) => !row.long).sort((a, b) => b.price - a.price);
  const bids = resting.filter((row) => row.long).sort((a, b) => b.price - a.price);
  const mineOrders = orders.filter((row) => row.user.toLowerCase() === mine);
  const mineDeals = deals.filter((row) => row.longUser.toLowerCase() === mine || row.shortUser.toLowerCase() === mine);

  async function send(long: boolean) {
    const user = account ?? currentAccount();
    if (!user || !gate) {
      setNote(zh ? "先连接钱包。" : "Connect a wallet.");
      return;
    }
    if (!perp) {
      setNote(zh ? "全站合约还没写进页面。" : "The shared contract is not in the page yet.");
      return;
    }
    const limitPx = Number(limit) > 0 ? Number(limit) : mark;
    if (!(limitPx > 0) || !(mark > 0)) return;
    setBusy(true);
    try {
      await openGate(user, perp, market, long, margin, lev, limitPx, mark);
      const next = await readGateChain(perp);
      setOrders(next.orders);
      setDeals(next.deals);
      setNote(zh ? "链上挂单成功。USDT 已从钱包划进合约。单子在下面，别人可以吃。" : "Posted on chain. USDT moved from the wallet into the contract. The order is below.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setNote(message === "usdt" ? (zh ? "USDT 不够。最少 1。" : "Not enough USDT. Minimum 1.") : message === "margin" ? (zh ? "保证金要在 1 到 500 USDT。" : "Margin is 1 to 500 USDT.") : zh ? "钱包没有完成这笔交易。" : "The wallet did not finish the transaction.");
    } finally {
      setBusy(false);
    }
  }

  async function take(row: ChainOrder) {
    const user = account ?? currentAccount();
    if (!user || !perp) return;
    setBusy(true);
    try {
      await takeGateChain(user, perp, BigInt(row.id), margin, lev);
      const next = await readGateChain(perp);
      setOrders(next.orders);
      setDeals(next.deals);
      setNote(zh ? "吃单成功。持仓在下面，盈亏按官网参考价推进后的合约价。" : "Filled. The position is below.");
    } catch {
      setNote(zh ? "吃单没有完成。" : "The take did not finish.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(row: ChainOrder) {
    const user = account ?? currentAccount();
    if (!user || !perp) return;
    setBusy(true);
    try {
      await cancelGateChain(user, perp, BigInt(row.id));
      const next = await readGateChain(perp);
      setOrders(next.orders);
      setDeals(next.deals);
      setNote(zh ? "已撤。撤单费是保证金的千分之二，从退回的 USDT 里扣。" : "Cancelled. The 0.2% fee is taken from the USDT returned.");
    } catch {
      setNote(zh ? "撤单没有完成。" : "The cancel did not finish.");
    } finally {
      setBusy(false);
    }
  }

  async function close(row: ChainDeal) {
    const user = account ?? currentAccount();
    if (!user || !perp) return;
    setBusy(true);
    try {
      await closeGateChain(user, perp, BigInt(row.id));
      const next = await readGateChain(perp);
      setOrders(next.orders);
      setDeals(next.deals);
      setNote(zh ? "已平仓。USDT 按合约里的参考价退回钱包。" : "Closed. USDT was returned at the mark stored in the contract.");
    } catch {
      setNote(zh ? "平仓没有完成。" : "The close did not finish.");
    } finally {
      setBusy(false);
    }
  }

  function markFor(id: number): number {
    const row = GATES[id];
    if (!row) return mark;
    const found = desk?.gates.find((item) => item.transistors.toLowerCase() === row[0] && item.tokenId === row[1]);
    return found?.price ?? 0;
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="grid gap-3 lg:grid-cols-[15rem_1fr_17rem]">
        <div className="border border-gold bg-card">
          {(desk?.gates ?? []).map((row) => {
            const on = row.transistors.toLowerCase() === pick.token.toLowerCase() && row.tokenId === pick.id;
            return (
              <button key={row.id} type="button" onClick={() => { setPick({ token: row.transistors, id: row.tokenId }); setLimit(""); }} className={`flex w-full items-center justify-between gap-2 border-b border-gold/30 px-3 py-2 text-left ${on ? "bg-foil" : ""}`}>
                <span>
                  <span className="block text-sm">{row.name}</span>
                  <span className="font-mono text-xs text-ink/60">{row.kind}</span>
                </span>
                <span className="text-right font-mono text-xs tabular-nums">
                  <span className="block">{px(row.price)}</span>
                  <span className={row.changePct >= 0 ? "text-[#1b6b45]" : "text-sell"}>{row.changePct.toFixed(2)}%</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="border border-gold bg-card">
          <div className="flex flex-wrap items-end justify-between gap-2 border-b border-gold/30 px-3 py-3">
            <div>
              <p className="text-xs tracking-widest text-gold">{zh ? "我们的盘口" : "Our book"}</p>
              <p className="font-display text-2xl italic">{gate ? `${gate.name} / ${gate.kind}` : "NAND"}</p>
            </div>
            <div className="text-right">
              <p className="text-xs tracking-widest text-gold">{zh ? "官网参考价" : "Official mark"}</p>
              <p className="font-mono text-2xl tabular-nums">{px(mark)} BNB</p>
            </div>
          </div>
          <div className="grid grid-cols-[5rem_1fr_4.5rem_auto] gap-2 px-2 py-1 text-xs text-ink/50">
            <span>{zh ? "价格" : "Price"}</span>
            <span>{zh ? "地址" : "Address"}</span>
            <span>{zh ? "保证金" : "Margin"}</span>
            <span />
          </div>
          {asks.map((row) => (
            <OrderRow key={row.id} row={row} mine={mine} zh={zh} onTake={() => take(row)} onCancel={() => cancel(row)} />
          ))}
          <p className="my-1 flex items-center gap-3 px-2 font-mono text-sm">
            <span className="h-px flex-1 bg-gold/40" />
            <span>{px(mark)}</span>
            <span className="h-px flex-1 bg-gold/40" />
          </p>
          {bids.map((row) => (
            <OrderRow key={row.id} row={row} mine={mine} zh={zh} onTake={() => take(row)} onCancel={() => cancel(row)} />
          ))}
          {resting.length === 0 ? <p className="px-3 py-6 text-sm text-ink/60">{zh ? "这个标还没有人挂单。右边开多或开空，就会出现在这里。" : "No orders on this market yet. A long or a short from the ticket shows up here."}</p> : null}
        </div>
        <div className="flex flex-col gap-2 border border-gold bg-card p-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "下单" : "Order"}</p>
          <label className="text-sm">
            {zh ? "限价 BNB，空着就用参考价" : "Limit in BNB. Blank uses the mark."}
            <input value={limit} onChange={(event) => setLimit(event.target.value)} inputMode="decimal" placeholder={px(mark)} className="mt-1 w-full border border-gold bg-transparent px-2 py-2 font-mono outline-none" />
          </label>
          <label className="text-sm">
            {zh ? "保证金 USDT" : "Margin USDT"}
            <input value={margin} onChange={(event) => setMargin(event.target.value)} inputMode="decimal" className="mt-1 w-full border border-gold bg-transparent px-2 py-2 font-mono outline-none" />
          </label>
          <div className="grid grid-cols-3 gap-1">
            {LEVS.map((item) => (
              <button key={item} type="button" onClick={() => setLev(item)} className={`min-h-10 border border-gold font-mono text-xs ${lev === item ? "bg-ink text-paper" : ""}`}>{item}×</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => send(true)} className="min-h-11 bg-ink text-paper disabled:opacity-50">{zh ? "开多" : "Long"}</button>
            <button type="button" disabled={busy} onClick={() => send(false)} className="min-h-11 border border-gold disabled:opacity-50">{zh ? "开空" : "Short"}</button>
          </div>
          <p className="text-xs leading-relaxed text-ink/60">{zh ? "开多开空会让钱包先授权再划走 BSC 的 USDT，最少 1。官网价先推进合约，之后盈亏按合约里的价结算，不按你填的限价。手续费千分之二。有推荐人时，交易者少付其中 4%，推荐人记其中 6%，和 BEM 一样，提到这份合约的 USDT。" : "A long or short asks the wallet to approve and then move BSC USDT, from 1. The official price is pushed into the contract first. PnL uses that stored price, not your limit. The fee is 0.2%. With a referrer, the trader pays 4% less of it and the referrer is credited 6%, paid in this contract's USDT."}</p>
          {perp ? <p className="break-all font-mono text-xs">{perp}</p> : null}
          <p className="text-xs tracking-widest text-gold">{zh ? "这份合约上的推荐" : "Referral on this contract"}</p>
          {rebate.code ? <p className="font-mono text-sm">{rebate.code}</p> : (
            <div className="flex gap-2">
              <input value={mineCode} onChange={(event) => setMineCode(event.target.value)} className="min-h-10 flex-1 border border-gold bg-transparent px-2 outline-none" placeholder={zh ? "我的码" : "My code"} />
              <button type="button" disabled={busy} className="min-h-10 border border-gold px-2 text-sm" onClick={async () => {
                const user = account ?? currentAccount();
                if (!user) return;
                setBusy(true);
                try { await registerGate(user, mineCode); setNote(zh ? "推荐码已写上这份合约。确认后不能改。" : "Code written on this contract. It cannot be changed."); }
                catch { setNote(zh ? "推荐码没写上。可能已被占用，或这个地址已经有码。" : "The code was not written. It may be taken, or this address already has one."); }
                finally { setBusy(false); }
              }}>{zh ? "确认" : "Confirm"}</button>
            </div>
          )}
          {rebate.referrer && rebate.referrer !== "0x0000000000000000000000000000000000000000" ? <p className="font-mono text-xs">{short(rebate.referrer)}</p> : (
            <div className="flex gap-2">
              <input value={friend} onChange={(event) => setFriend(event.target.value)} className="min-h-10 flex-1 border border-gold bg-transparent px-2 outline-none" placeholder={zh ? "对方的码" : "Their code"} />
              <button type="button" disabled={busy} className="min-h-10 border border-gold px-2 text-sm" onClick={async () => {
                const user = account ?? currentAccount();
                if (!user) return;
                setBusy(true);
                try { await bindGate(user, friend); setNote(zh ? "已绑定。不能再改。" : "Bound. It cannot be changed."); }
                catch { setNote(zh ? "绑定失败。对方要先在这份合约上确认过自己的码。" : "Bind failed. They must confirm their code on this contract first."); }
                finally { setBusy(false); }
              }}>{zh ? "绑定" : "Bind"}</button>
            </div>
          )}
          <p className="font-mono text-sm">{zh ? "可提" : "Claimable"} {rebate.accrued.toFixed(2)} USDT</p>
          <div className="grid grid-cols-4 gap-1">
            {[1, 10, 20, 50, 100, 300, 500].map((step) => (
              <button key={step} type="button" disabled={busy || rebate.accrued + 1e-9 < step} className="min-h-9 border border-gold font-mono text-xs disabled:opacity-40" onClick={async () => {
                const user = account ?? currentAccount();
                if (!user) return;
                setBusy(true);
                try { await claimGate(user, BigInt(step) * 10n ** 18n); setNote(zh ? `已提 ${step} USDT。` : `Claimed ${step} USDT.`); }
                catch { setNote(zh ? "提现没有完成。" : "The claim did not finish."); }
                finally { setBusy(false); }
              }}>{step}</button>
            ))}
          </div>
          {note ? <p className="text-sm">{note}</p> : null}
        </div>
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="border border-gold bg-card p-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "我的挂单" : "My orders"}</p>
          {mineOrders.length === 0 ? <p className="mt-2 text-sm text-ink/60">{zh ? "还没有未成交的单。" : "No resting orders."}</p> : null}
          {mineOrders.map((row) => (
            <div key={row.id} className="mt-2 flex items-center justify-between gap-2 border-t border-gold/30 pt-2 text-sm">
              <p className="font-mono">{NAMES[row.market]} · {row.long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} · {px(row.price)} · {row.margin} USDT · {row.lev}×</p>
              <button type="button" className="min-h-9 border border-gold px-2" onClick={() => cancel(row)}>{zh ? "撤单" : "Cancel"}</button>
            </div>
          ))}
        </div>
        <div className="border border-gold bg-card p-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "我的持仓" : "My positions"}</p>
          {mineDeals.length === 0 ? <p className="mt-2 text-sm text-ink/60">{zh ? "成交之后，多单和空单在这里，盈亏跟着官网参考价变。" : "After a fill, longs and shorts stay here. PnL follows the official mark."}</p> : null}
          {mineDeals.map((row) => {
            const live = markFor(row.market);
            const pnl = pnlOf(row, mine, live);
            const long = row.longUser.toLowerCase() === mine;
            return (
              <div key={row.id} className="mt-2 border-t border-gold/30 pt-2 text-sm">
                <p className="font-mono">{NAMES[row.market]} · {long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} · {zh ? "开仓" : "Entry"} {px(row.entry)} · {zh ? "现价" : "Mark"} {px(live)}</p>
                <p className="font-mono text-xs text-ink/50">{zh ? "对手" : "Against"} {short(long ? row.shortUser : row.longUser)}</p>
                <p className={`font-mono ${pnl >= 0 ? "text-gold" : "text-sell"}`}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(4)} USDT</p>
                <button type="button" className="mt-1 min-h-9 border border-gold px-2" onClick={() => close(row)}>{zh ? "平仓" : "Close"}</button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function OrderRow({ row, mine, zh, onTake, onCancel }: { row: ChainOrder; mine: string; zh: boolean; onTake: () => void; onCancel: () => void }) {
  const own = row.user.toLowerCase() === mine;
  return (
    <div className="grid grid-cols-[5rem_1fr_4.5rem_auto] items-center gap-2 px-2 py-1 font-mono text-sm tabular-nums">
      <span className={row.long ? "text-[#1b6b45]" : "text-sell"}>{px(row.price)}</span>
      <span className="truncate">{own ? (zh ? "我" : "Me") : short(row.user)}</span>
      <span>{row.margin}</span>
      {own ? (
        <button type="button" className="min-h-8 border border-gold px-2 text-xs" onClick={onCancel}>{zh ? "撤单" : "Cancel"}</button>
      ) : (
        <button type="button" className={`min-h-8 px-2 text-xs text-paper ${row.long ? "bg-[#1b6b45]" : "bg-sell"}`} onClick={onTake}>{row.long ? (zh ? "开空吃" : "Short") : zh ? "开多吃" : "Long"}</button>
      )}
    </div>
  );
}
