import { useEffect, useState } from "react";
import { bindGate, cancelGateChain, claimGate, closeGateChain, gateAddress, gateMark, gateReady, openGate, pushMark, readGateChain, readGateRebate, registerGate, takeGateChain, type ChainDeal, type ChainOrder } from "@/lib/gate-chain";
import { FEE_TO, connectBsc } from "@/lib/bsc";
import { getTransistorDesk, type TransistorDesk } from "@/lib/transistor-market";
import { currentAccount, onAccount } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";
import { useFeeLock } from "@/lib/fee-lock";

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

function inviteLink(code: string): string {
  if (typeof window === "undefined") return `#gate=${encodeURIComponent(code)}`;
  return `${window.location.origin}${window.location.pathname}#gate=${encodeURIComponent(code)}`;
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
  const lock = useFeeLock();
  const [chainMark, setChainMark] = useState(0);
  const [ready, setReady] = useState(true);
  const [mineCode, setMineCode] = useState("");
  const [friend, setFriend] = useState("");
  const [rebate, setRebate] = useState({ accrued: 0, code: "", referrer: "" });

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => setPerp(gateAddress()), []);
  useEffect(() => {
    const gate = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("gate");
    if (gate) setFriend(gate.trim().slice(0, 16));
  }, []);

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
      gateMark(addr, marketOf(pick.token, pick.id)).then((next) => { if (!dead) setChainMark(next); }).catch(() => undefined);
      gateReady(addr, marketOf(pick.token, pick.id)).then((ok) => { if (!dead) setReady(ok); }).catch(() => { if (!dead) setReady(false); });
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

  async function place(long: boolean) {
    const user = account ?? currentAccount();
    const price = Number(limit) || mark;
    if (!user || !perp || !(price > 0)) return;
    setBusy(true);
    try {
      await openGate(user, perp, market, long, margin, lev, price, mark);
      const next = await readGateChain(perp);
      setOrders(next.orders);
      setDeals(next.deals);
      setNote(zh ? "已挂上。对手来了才会成交。" : "Posted. It fills when someone takes the other side.");
    } catch {
      setNote(zh ? "没有开成。十分钟均价还没写满，或保证金不够。" : "It did not open. The ten-minute average may not be ready, or the margin is short.");
    } finally {
      setBusy(false);
    }
  }

  async function take(row: ChainOrder) {
    const user = account ?? currentAccount();
    if (!user || !perp) return;
    setBusy(true);
    try {
      await takeGateChain(user, perp, BigInt(row.id), margin, lev, row.market, markFor(row.market));
      const next = await readGateChain(perp);
      setOrders(next.orders);
      setDeals(next.deals);
      setNote(zh ? "已吃到。" : "Taken.");
    } catch {
      setNote(zh ? "没有吃成。十分钟均价还没写满，或保证金不够。" : "The take did not fill. The average may not be ready, or the margin is short.");
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setNote(message === "mark" ? (zh ? "结算价离官网价太远，先不平，避免按错价分钱。" : "The mark is too far from the official price. Not closing, so the split is not wrong.") : zh ? "平仓没有完成。" : "The close did not finish.");
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
              <p className="text-xs tracking-widest text-gold">{zh ? "链上最新成交" : "Last on-chain trade"}</p>
              <p className="font-mono text-2xl tabular-nums">{px(mark)} OKB</p>
              <p className={`font-mono text-xs ${chainMark > 0 && mark > 0 && (chainMark / mark < 0.97 || chainMark / mark > 1.03) ? "text-sell" : "text-ink/50"}`}>{zh ? "合约结算" : "Contract"} {chainMark > 0 ? px(chainMark) : "—"}</p>
            </div>
          </div>
          <div className="grid grid-cols-[5rem_1fr_4.5rem_auto] gap-2 px-2 py-1 text-xs text-ink/50">
            <span>{zh ? "价格" : "Price"}</span>
            <span>{zh ? "地址" : "Address"}</span>
            <span>{zh ? "保证金" : "Margin"}</span>
            <span />
          </div>
          {asks.map((row) => (
            <OrderRow key={row.id} row={row} mine={mine} zh={zh} onCancel={() => cancel(row)} onTake={() => take(row)} />
          ))}
          <p className="my-1 flex items-center gap-3 px-2 font-mono text-sm">
            <span className="h-px flex-1 bg-gold/40" />
            <span>{px(mark)}</span>
            <span className="h-px flex-1 bg-gold/40" />
          </p>
          {bids.map((row) => (
            <OrderRow key={row.id} row={row} mine={mine} zh={zh} onCancel={() => cancel(row)} onTake={() => take(row)} />
          ))}
          {resting.length === 0 ? <p className="px-3 py-6 text-sm text-ink/60">{zh ? "这个标还没有人挂单。右边开多或开空，就会出现在这里。" : "No orders on this market yet. A long or a short from the ticket shows up here."}</p> : null}
        </div>
        <div className="flex flex-col gap-2 border border-gold bg-card p-3">
          {!ready ? (
            <div className="border border-sell px-2 py-2 text-sm">
              <p>{zh ? "这个标的现在开不了仓。上次写价已经超过 30 分钟。不用重新部署。收费地址再写一次这个标的就能开。超过 30 分钟没再写，会再停。" : "This market cannot open. The last post is older than 30 minutes. Do not deploy again. The fee address posts this market once. It stops again after 30 minutes without a post."}</p>
              <button type="button" className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40" disabled={busy} onClick={async () => {
                setBusy(true);
                setNote("");
                try {
                  const from = account ?? (await connectBsc());
                  setAccount(from);
                  if (!(mark > 0)) {
                    setNote(zh ? "参考价还没读到。等数字出来再点。" : "The reference price is not in yet. Click again when it is.");
                    return;
                  }
                  await pushMark(from, perp, market, mark);
                  setReady(true);
                  setNote(zh ? "这个标的已再写入，可以开仓。超过 30 分钟没再写，会再停。" : "This market was posted again. It stops if nothing is posted for 30 minutes.");
                } catch (err) {
                  const message = err instanceof Error ? err.message : "";
                  setNote(message === "oracle"
                    ? (zh ? "只有收费地址能写这一笔。" : "Only the fee address can post this.")
                    : (zh ? "没写上。可能还没到 30 秒，或这一笔挪过了 0.5%。" : "It was not posted. Wait 30 seconds, or the move was over 0.5%."));
                } finally {
                  setBusy(false);
                }
              }}>{zh ? "再写一次这个标的" : "Post this market again"}</button>
            </div>
          ) : null}
          {ready ? <button type="button" className="min-h-11 border border-gold" disabled={busy} onClick={async () => {
            setBusy(true);
            setNote("");
            try {
              const from = account ?? (await connectBsc());
              setAccount(from);
              if (from.toLowerCase() !== FEE_TO.toLowerCase()) {
                setNote(zh ? `只有收费地址能写价。当前是 ${from}` : `Only the fee address can post. This wallet is ${from}`);
                return;
              }
              await pushMark(from, perp, market, mark);
              setNote(zh ? "这个标的已写入。写入之后就可以开仓。超过 30 分钟没再写，结算价会作废。" : "This market was posted. It can open after the post. If nothing is posted for 30 minutes, the price expires.");
            } catch {
              setNote(zh ? "没写上。可能还没到 30 秒，或这一笔挪过了 0.5%。" : "It was not posted. Wait 30 seconds, or the move was over 0.5%.");
            } finally {
              setBusy(false);
            }
          }}>{zh ? "收费地址写入这个标的" : "Fee address posts this market"}</button> : null}
          <p className="text-xs tracking-widest text-gold">{zh ? "下单" : "Open"}</p>
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
            <button type="button" disabled={busy} className="min-h-11 bg-ink text-paper disabled:opacity-50" onClick={() => place(true)}>{zh ? "开多" : "Long"}</button>
            <button type="button" disabled={busy} className="min-h-11 border border-gold disabled:opacity-50" onClick={() => place(false)}>{zh ? "开空" : "Short"}</button>
          </div>
          <p className="text-xs leading-relaxed text-ink/60">{zh ? "划走 BSC 的 USDT。盈亏按推进后的官网价，不按限价。" : "Moves BSC USDT. PnL uses the pushed official price, not your limit."}</p>
          {perp ? <p className="break-all font-mono text-xs">{perp}</p> : null}
          <p className="text-xs tracking-widest text-gold">{zh ? "这份合约上的推荐" : "Referral on this contract"}</p>
          {rebate.code ? (
            <div>
              <p className="font-mono text-sm">{rebate.code}</p>
              <p className="mt-2 text-xs tracking-widest text-gold">{zh ? "邀请链接" : "Invite link"}</p>
              <input readOnly value={inviteLink(rebate.code)} className="mt-1 w-full border border-gold bg-transparent px-2 py-2 font-mono text-xs outline-none" />
              <button type="button" className="mt-2 min-h-10 border border-gold px-3 text-sm" onClick={() => {
                const link = inviteLink(rebate.code);
                navigator.clipboard.writeText(link).then(() => setNote(zh ? "链接已复制。朋友打开后核对，再点绑定。" : "Link copied. Your friend opens it, checks, then binds.")).catch(() => setNote(link));
              }}>{zh ? "复制链接" : "Copy link"}</button>
            </div>
          ) : (
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

function OrderRow({ row, mine, zh, onCancel, onTake }: { row: ChainOrder; mine: string; zh: boolean; onCancel: () => void; onTake: () => void }) {
  const own = row.user.toLowerCase() === mine;
  return (
    <div className="grid grid-cols-[5rem_1fr_4.5rem_auto] items-center gap-2 px-2 py-1 font-mono text-sm tabular-nums">
      <span className={row.long ? "text-[#1b6b45]" : "text-sell"}>{px(row.price)}</span>
      <span className="truncate">{own ? (zh ? "我" : "Me") : short(row.user)}</span>
      <span>{row.margin}</span>
      {own ? (
        <button type="button" className="min-h-8 border border-gold px-2 text-xs" onClick={onCancel}>{zh ? "撤单" : "Cancel"}</button>
      ) : (
        <button type="button" className="min-h-8 border border-gold px-2 text-xs" onClick={onTake}>{zh ? "吃单" : "Take"}</button>
      )}
    </div>
  );
}
