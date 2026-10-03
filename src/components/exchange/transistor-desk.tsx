import { useEffect, useState } from "react";
import { cancelGate, closeGate, getGateBook, postGate, takeGate, type GateBook } from "@/lib/gate-book";
import { dealPnl, type GateDeal, type GateOrder } from "@/lib/gate-core";
import { getTransistorDesk, type TransistorDesk } from "@/lib/transistor-market";
import { currentAccount, onAccount } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";

const FIRST = { token: "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087", id: 0 };
const LEVS = [1, 5, 10, 20, 50, 100];

function px(value: number): string {
  if (!(value > 0)) return "—";
  if (value < 0.001) return value.toFixed(8);
  if (value < 1) return value.toFixed(4);
  return value.toFixed(2);
}

function short(user: string): string {
  return `${user.slice(0, 6)}…${user.slice(-4)}`;
}

function feeOf(margin: number): number {
  return margin * 0.002;
}

export function TransistorDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(null);
  const [pick, setPick] = useState(FIRST);
  const [desk, setDesk] = useState<TransistorDesk | null>(null);
  const [book, setBook] = useState<GateBook>({ orders: [], deals: [] });
  const [margin, setMargin] = useState("0.01");
  const [limit, setLimit] = useState("");
  const [lev, setLev] = useState(10);
  const [note, setNote] = useState("");

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      getTransistorDesk({ data: pick }).then((next) => {
        if (!dead) setDesk(next);
      }).catch(() => undefined);
      getGateBook().then((next) => {
        if (!dead) setBook(next);
      }).catch(() => undefined);
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
  const market = `${pick.token.toLowerCase()}:${pick.id}`;
  const mine = (account ?? currentAccount() ?? "").toLowerCase();
  const resting = book.orders.filter((row) => row.market === market);
  const asks = resting.filter((row) => !row.long).sort((a, b) => b.price - a.price);
  const bids = resting.filter((row) => row.long).sort((a, b) => b.price - a.price);
  const mineOrders = book.orders.filter((row) => row.user.toLowerCase() === mine);
  const mineDeals = book.deals.filter((row) => row.longUser.toLowerCase() === mine || row.shortUser.toLowerCase() === mine);

  async function send(long: boolean) {
    const user = account ?? currentAccount();
    if (!user || !gate) {
      setNote(zh ? "先连接钱包，单子才会记在你的地址上。" : "Connect a wallet so the order is stored under your address.");
      return;
    }
    const price = Number(limit) > 0 ? Number(limit) : mark;
    const amount = Number(margin);
    if (!(price > 0) || !(amount > 0)) return;
    try {
      const next = await postGate({ data: { user, market, name: gate.name, kind: gate.kind, long, price, margin: amount, lev } });
      setBook(next);
      const crossed = next.deals.some((row) => row.market === market && (row.longUser.toLowerCase() === user.toLowerCase() || row.shortUser.toLowerCase() === user.toLowerCase()));
      const fee = feeOf(amount);
      setNote(crossed
        ? (zh ? `吃到对手单了。手续费 ${fee.toFixed(6)} BNB，其中 6% 按 BEM 的比例记给推荐人。持仓在下面。` : `Filled. Fee ${fee.toFixed(6)} BNB. 6% of it is the referrer's share, the same split as BEM. The position is below.`)
        : (zh ? "挂到我们自己的盘口了。别人可以吃。你的挂单在下面。" : "Resting on our book. Someone else can take it. Your order is below."));
    } catch {
      setNote(zh ? "这张单没挂上。" : "The order was not posted.");
    }
  }

  async function take(row: GateOrder) {
    const user = account ?? currentAccount();
    if (!user) return;
    const amount = Number(margin);
    if (!(amount > 0)) return;
    setBook(await takeGate({ data: { user, id: row.id, margin: amount, lev } }));
    setNote(zh ? "已成交，持仓在下面。" : "Filled. The position is below.");
  }

  async function cancel(row: GateOrder) {
    const user = account ?? currentAccount();
    if (!user) return;
    setBook(await cancelGate({ data: { user, id: row.id } }));
    setNote(zh ? `已撤。撤单费 ${feeOf(row.margin).toFixed(6)} BNB，和 BEM 一样是保证金的千分之二。` : `Cancelled. Fee ${feeOf(row.margin).toFixed(6)} BNB, 0.2% of margin, same as BEM.`);
  }

  async function close(row: GateDeal) {
    const user = account ?? currentAccount();
    if (!user) return;
    const pnl = dealPnl(row, user, markOf(row));
    setBook(await closeGate({ data: { user, id: row.id } }));
    setNote(zh ? `已平。盈亏 ${pnl >= 0 ? "+" : ""}${pnl.toFixed(6)} BNB，按官网参考价。` : `Closed. PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(6)} BNB at the official mark.`);
  }

  function markOf(row: GateDeal): number {
    const found = desk?.gates.find((item) => `${item.transistors.toLowerCase()}:${item.tokenId}` === row.market);
    return found?.price ?? (row.market === market ? mark : 0);
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
            {zh ? "保证金 BNB" : "Margin BNB"}
            <input value={margin} onChange={(event) => setMargin(event.target.value)} inputMode="decimal" className="mt-1 w-full border border-gold bg-transparent px-2 py-2 font-mono outline-none" />
          </label>
          <div className="grid grid-cols-3 gap-1">
            {LEVS.map((item) => (
              <button key={item} type="button" onClick={() => setLev(item)} className={`min-h-10 border border-gold font-mono text-xs ${lev === item ? "bg-ink text-paper" : ""}`}>{item}×</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => send(true)} className="min-h-11 bg-ink text-paper">{zh ? "开多" : "Long"}</button>
            <button type="button" onClick={() => send(false)} className="min-h-11 border border-gold">{zh ? "开空" : "Short"}</button>
          </div>
          <p className="text-xs leading-relaxed text-ink/60">{zh ? "成交价按挂单价。盈亏按官网参考价，最多赢光对手保证金，最多亏光自己的。手续费是保证金的千分之二。有推荐人时，交易者少付其中 4%，推荐人记其中 6%。" : "Fills use the resting price. PnL uses the official mark, capped by both margins. The fee is 0.2% of margin. With a referrer, the trader pays 4% less of it and the referrer is credited 6%."}</p>
          {note ? <p className="text-sm">{note}</p> : null}
        </div>
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="border border-gold bg-card p-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "我的挂单" : "My orders"}</p>
          {mineOrders.length === 0 ? <p className="mt-2 text-sm text-ink/60">{zh ? "还没有未成交的单。" : "No resting orders."}</p> : null}
          {mineOrders.map((row) => (
            <div key={row.id} className="mt-2 flex items-center justify-between gap-2 border-t border-gold/30 pt-2 text-sm">
              <p className="font-mono">{row.name} {row.kind} · {row.long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} · {px(row.price)} · {row.margin} BNB · {row.lev}×</p>
              <button type="button" className="min-h-9 border border-gold px-2" onClick={() => cancel(row)}>{zh ? "撤单" : "Cancel"}</button>
            </div>
          ))}
        </div>
        <div className="border border-gold bg-card p-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "我的持仓" : "My positions"}</p>
          {mineDeals.length === 0 ? <p className="mt-2 text-sm text-ink/60">{zh ? "成交之后，多单和空单在这里，盈亏跟着官网参考价变。" : "After a fill, longs and shorts stay here. PnL follows the official mark."}</p> : null}
          {mineDeals.map((row) => {
            const live = markOf(row);
            const pnl = dealPnl(row, mine, live);
            const long = row.longUser.toLowerCase() === mine;
            return (
              <div key={row.id} className="mt-2 border-t border-gold/30 pt-2 text-sm">
                <p className="font-mono">{row.name} {row.kind} · {long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} · {zh ? "开仓" : "Entry"} {px(row.entry)} · {zh ? "现价" : "Mark"} {px(live)}</p>
                <p className="font-mono text-xs text-ink/50">{zh ? "对手" : "Against"} {short(long ? row.shortUser : row.longUser)}</p>
                <p className={`font-mono ${pnl >= 0 ? "text-gold" : "text-sell"}`}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(6)} BNB</p>
                <button type="button" className="mt-1 min-h-9 border border-gold px-2" onClick={() => close(row)}>{zh ? "平仓" : "Close"}</button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function OrderRow({ row, mine, zh, onTake, onCancel }: { row: GateOrder; mine: string; zh: boolean; onTake: () => void; onCancel: () => void }) {
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
