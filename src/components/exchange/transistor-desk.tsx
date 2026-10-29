import { useEffect, useState } from "react";
import {
  bindGate,
  cancelGateChain,
  claimGate,
  closeGateChain,
  gateAddress,
  gateMark,
  gateReady,
  openGate,
  pushMark,
  readGateChain,
  readGateRebate,
  registerGate,
  takeGateChain,
  type ChainDeal,
  type ChainOrder,
} from "@/lib/gate-chain";
import { connectBsc } from "@/lib/bsc";
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

function inviteLink(code: string): string {
  if (typeof window === "undefined") return `#gate=${encodeURIComponent(code)}`;
  return `${window.location.origin}${window.location.pathname}#gate=${encodeURIComponent(code)}`;
}

function short(user: string): string {
  return `${user.slice(0, 6)}…${user.slice(-4)}`;
}

const NAMES = [
  "TapeOut NAND",
  "TapeOut LATCH",
  "Behemoth NAND",
  "Behemoth LATCH",
  "Genesis NAND",
  "Genesis LATCH",
];
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
  const [longSide, setLongSide] = useState(true);
  const [pane, setPane] = useState<"live" | "pos" | "orders">("live");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
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
      if (document.hidden) return;
      getTransistorDesk({ data: pick })
        .then((next) => {
          if (!dead) setDesk(next);
        })
        .catch(() => undefined);
      const addr = gateAddress();
      if (!addr) return;
      readGateChain(addr)
        .then((next) => {
          if (!dead) {
            setOrders(next.orders);
            setDeals(next.deals);
          }
        })
        .catch(() => undefined);
      const who = currentAccount();
      if (who)
        readGateRebate(who)
          .then((next) => {
            if (!dead) setRebate(next);
          })
          .catch(() => undefined);
      gateMark(addr, marketOf(pick.token, pick.id))
        .then((next) => {
          if (!dead) setChainMark(next);
        })
        .catch(() => undefined);
      gateReady(addr, marketOf(pick.token, pick.id))
        .then((ok) => {
          if (!dead) setReady(ok);
        })
        .catch(() => {
          if (!dead) setReady(false);
        });
    };
    pull();
    const timer = window.setInterval(pull, 12000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [pick]);

  const gate = desk?.gates.find(
    (row) => row.transistors.toLowerCase() === pick.token.toLowerCase() && row.tokenId === pick.id,
  );
  const mark = gate?.price ?? 0;
  const market = marketOf(pick.token, pick.id);
  const mine = (account ?? currentAccount() ?? "").toLowerCase();
  const resting = orders.filter((row) => row.market === market);
  const asks = resting.filter((row) => !row.long).sort((a, b) => b.price - a.price);
  const bids = resting.filter((row) => row.long).sort((a, b) => b.price - a.price);
  const mineOrders = orders.filter((row) => row.user.toLowerCase() === mine);
  const mineDeals = deals.filter(
    (row) => row.longUser.toLowerCase() === mine || row.shortUser.toLowerCase() === mine,
  );

  async function cancel(row: ChainOrder) {
    const user = account ?? currentAccount();
    if (!user || !perp) return;
    setBusy(true);
    try {
      await cancelGateChain(user, perp, BigInt(row.id));
      const next = await readGateChain(perp);
      setOrders(next.orders);
      setDeals(next.deals);
      setNote(
        zh
          ? "已撤。撤单费是保证金的千分之二，从退回的 USDT 里扣。"
          : "Cancelled. The 0.2% fee is taken from the USDT returned.",
      );
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
      setNote(
        zh ? "已挂上。对手来了才会成交。" : "Posted. It fills when someone takes the other side.",
      );
    } catch {
      setNote(
        zh
          ? "没有开成。十分钟均价还没写满，或保证金不够。"
          : "It did not open. The ten-minute average may not be ready, or the margin is short.",
      );
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
      setNote(
        zh
          ? "没有吃成。十分钟均价还没写满，或保证金不够。"
          : "The take did not fill. The average may not be ready, or the margin is short.",
      );
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
      setNote(
        zh
          ? "已平仓。USDT 按合约里的参考价退回钱包。"
          : "Closed. USDT was returned at the mark stored in the contract.",
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setNote(
        message === "mark"
          ? zh
            ? "结算价离 TapeOut 价太远，先不平，避免按错价分钱。"
            : "The mark is too far from the TapeOut price. Not closing, so the split is not wrong."
          : zh
            ? "平仓没有完成。"
            : "The close did not finish.",
      );
    } finally {
      setBusy(false);
    }
  }

  function markFor(id: number): number {
    const row = GATES[id];
    if (!row) return mark;
    const found = desk?.gates.find(
      (item) => item.transistors.toLowerCase() === row[0] && item.tokenId === row[1],
    );
    return found?.price ?? 0;
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="grid items-start gap-3 lg:grid-cols-[14rem_minmax(0,1fr)_16.5rem]">
        <div className="border border-gold/70 bg-card">
          {["TapeOut", "Behemoth", "Genesis"].map((family) => {
            const rows = (desk?.gates ?? []).filter((row) =>
              row.name.toLowerCase().includes(family.toLowerCase()),
            );
            if (!rows.length) return null;
            return (
              <div key={family} className="border-b border-gold/30">
                <p className="px-3 pt-2 text-sm font-medium">
                  TapeOut · {family === "Genesis" ? "Genesis" : family}
                </p>
                {rows.map((row) => {
                  const on =
                    row.transistors.toLowerCase() === pick.token.toLowerCase() &&
                    row.tokenId === pick.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => {
                        setPick({ token: row.transistors, id: row.tokenId });
                        setLimit("");
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${on ? "bg-gold/15" : ""}`}
                    >
                      <span className="text-[13px]">{row.kind}</span>
                      <span className="text-right font-mono text-[12px] tabular-nums">
                        <span className="block">{px(row.price)} BNB</span>
                        <span className={row.changePct >= 0 ? "text-up" : "text-sell"}>
                          {row.changePct >= 0 ? "+" : ""}
                          {row.changePct.toFixed(2)}%
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="min-w-0 border border-gold/70 bg-card">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/30 px-3 py-3">
            <div>
              <h3 className="font-display text-[1.65rem] italic leading-none">
                {gate ? `TapeOut · ${gate.name} / ${gate.kind}` : "TapeOut / NAND"}
              </h3>
              <p className="mt-1 font-mono text-xs text-ink/45">
                {zh ? "合约" : "Contract"} {perp ? `${perp.slice(0, 6)}…${perp.slice(-4)}` : "—"}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-ink/45">{zh ? "参考价" : "Mark"}</p>
              <p className="font-mono text-lg tabular-nums text-up">{px(mark)} BNB</p>
              <p className="font-mono text-[11px] text-ink/45">
                {zh ? "结算" : "Settle"} {chainMark > 0 ? `${px(chainMark)} BNB` : "—"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-[3.6rem_minmax(0,1fr)_auto] items-center px-2 py-1 text-[11px] text-ink/45 sm:grid-cols-[4.2rem_minmax(0,1fr)_4.2rem_4.6rem]">
            <span>{zh ? "价格" : "Price"}</span>
            <span>{zh ? "保证金" : "Margin"}</span>
            <span className="hidden text-right sm:block">{zh ? "名义" : "Notional"}</span>
            <span className="text-right">{zh ? "指定成交" : "Take"}</span>
          </div>
          <div className="max-h-[22rem] overflow-y-auto">
            {asks.map((row) => (
              <OrderRow
                key={row.id}
                row={row}
                mine={mine}
                zh={zh}
                max={Math.max(...resting.map((item) => item.margin), 1)}
                onCancel={() => cancel(row)}
                onTake={() => take(row)}
              />
            ))}
            <p className="my-1 flex items-center gap-3 px-2 font-mono text-[13px]">
              <span className="h-px flex-1 bg-gold/40" />
              <span>{px(mark)} BNB</span>
              <span className="h-px flex-1 bg-gold/40" />
            </p>
            {bids.map((row) => (
              <OrderRow
                key={row.id}
                row={row}
                mine={mine}
                zh={zh}
                max={Math.max(...resting.map((item) => item.margin), 1)}
                onCancel={() => cancel(row)}
                onTake={() => take(row)}
              />
            ))}
            {resting.length === 0 ? (
              <p className="px-3 py-6 text-sm text-ink/55">
                {zh
                  ? "这个标还没有挂单。右边开多或开空，会出现在这里。"
                  : "No orders yet. A long or a short from the ticket shows up here."}
              </p>
            ) : null}
          </div>
          <div className="flex gap-4 border-t border-gold/30 px-3">
            {(["live", "pos", "orders"] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setPane(id)}
                className={`border-b-2 py-2 text-sm ${pane === id ? "border-ink" : "border-transparent text-ink/45"}`}
              >
                {id === "live"
                  ? zh
                    ? "活动"
                    : "Live"
                  : id === "pos"
                    ? zh
                      ? "持仓"
                      : "Positions"
                    : zh
                      ? "我的挂单"
                      : "My orders"}
              </button>
            ))}
          </div>
          <div className="max-h-56 overflow-auto px-3 py-2 text-sm">
            {pane === "orders" ? (
              mineOrders.length === 0 ? (
                <p className="text-ink/55">{zh ? "没有未成交的单。" : "No resting orders."}</p>
              ) : (
                mineOrders.map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-2 border-t border-gold/20 py-2"
                  >
                    <p className="font-mono text-xs">
                      {NAMES[row.market]} · {row.long ? (zh ? "多" : "Long") : zh ? "空" : "Short"}{" "}
                      · {px(row.price)} · {row.margin} USDT · {row.lev}×
                    </p>
                    <button
                      type="button"
                      className="h-7 border border-gold px-2 text-xs"
                      onClick={() => cancel(row)}
                    >
                      {zh ? "撤单" : "Cancel"}
                    </button>
                  </div>
                ))
              )
            ) : null}
            {pane === "pos" ? (
              mineDeals.length === 0 ? (
                <p className="text-ink/55">
                  {zh
                    ? "没有持仓。成交后多单和空单在这里，盈亏跟着参考价。"
                    : "No position. After a fill, PnL follows the mark."}
                </p>
              ) : (
                mineDeals.map((row) => {
                  const live = markFor(row.market);
                  const pnl = pnlOf(row, mine, live);
                  const long = row.longUser.toLowerCase() === mine;
                  return (
                    <div key={row.id} className="border-t border-gold/20 py-2">
                      <p className="font-mono text-xs">
                        {NAMES[row.market]} · {long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} ·{" "}
                        {zh ? "开仓" : "Entry"} {px(row.entry)} · {zh ? "现价" : "Mark"} {px(live)}
                      </p>
                      <p className={`font-mono text-xs ${pnl >= 0 ? "text-up" : "text-sell"}`}>
                        {pnl >= 0 ? "+" : ""}
                        {pnl.toFixed(4)} USDT
                      </p>
                      <button
                        type="button"
                        className="mt-1 h-7 border border-gold px-2 text-xs"
                        onClick={() => close(row)}
                      >
                        {zh ? "平仓" : "Close"}
                      </button>
                    </div>
                  );
                })
              )
            ) : null}
            {pane === "live" ? (
              deals.filter((row) => row.market === market).length === 0 ? (
                <p className="text-ink/55">
                  {zh ? "这个标还没有成交。" : "No fills on this market."}
                </p>
              ) : (
                deals
                  .filter((row) => row.market === market)
                  .map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-3 gap-2 border-t border-gold/20 py-2 font-mono text-xs"
                    >
                      <span>
                        {zh ? "多" : "Long"} {short(row.longUser)}
                      </span>
                      <span className="text-right">{px(row.entry)} BNB</span>
                      <span className="text-right text-ink/55">
                        {row.marginL} / {row.marginS} USDT
                      </span>
                    </div>
                  ))
              )
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2 border border-gold/70 bg-card p-3">
          <div className="grid grid-cols-2 border border-gold/50 text-sm">
            <button
              type="button"
              onClick={() => setLongSide(true)}
              className={`min-h-10 ${longSide ? "bg-ink text-white" : ""}`}
            >
              {zh ? "开多" : "Long"}
            </button>
            <button
              type="button"
              onClick={() => setLongSide(false)}
              className={`min-h-10 ${!longSide ? "bg-sell text-white" : ""}`}
            >
              {zh ? "开空" : "Short"}
            </button>
          </div>
          <label className="text-xs text-ink/55">
            {zh ? "限价 BNB，空着用参考价" : "Limit in BNB. Blank uses the mark."}
            <input
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              inputMode="decimal"
              placeholder={px(mark)}
              className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-2 font-mono text-sm text-ink outline-none"
            />
          </label>
          <label className="text-xs text-ink/55">
            {zh ? "保证金 USDT" : "Margin USDT"}
            <input
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              inputMode="decimal"
              className="mt-1 w-full border border-gold/50 bg-transparent px-2 py-2 font-mono text-sm text-ink outline-none"
            />
          </label>
          <div className="grid grid-cols-3 gap-1">
            {LEVS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setLev(item)}
                className={`min-h-9 border font-mono text-xs ${lev === item ? "border-ink bg-ink text-paper" : "border-gold/50"}`}
              >
                {item}×
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => place(longSide)}
            className={`min-h-11 text-sm text-white disabled:opacity-40 ${longSide ? "bg-ink" : "bg-sell"}`}
          >
            {longSide ? (zh ? "开多" : "Open long") : zh ? "开空" : "Open short"}
          </button>
          {!ready ? (
            <button
              type="button"
              className="min-h-10 border border-gold text-xs disabled:opacity-40"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setNote("");
                try {
                  const from = account ?? (await connectBsc());
                  setAccount(from);
                  if (!(mark > 0)) {
                    setNote(zh ? "参考价还没读到。" : "The mark is not in yet.");
                    return;
                  }
                  await pushMark(from, perp, market, mark);
                  setReady(true);
                  setNote(zh ? "这个标的已写入，可以开仓。" : "This market is posted.");
                } catch (err) {
                  const message = err instanceof Error ? err.message : "";
                  setNote(
                    message === "oracle"
                      ? zh
                        ? "只有收费地址能写这一笔。"
                        : "Only the fee address can post this."
                      : zh
                        ? "没写上。可能还没到 30 秒，或这一笔挪过了 0.5%。"
                        : "It was not posted.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {zh ? "写入结算价" : "Post the mark"}
            </button>
          ) : null}
          <p className="text-[11px] leading-5 text-ink/50">
            {zh
              ? "盈亏按推进后的参考价，不按限价。保证金是 BSC 的 USDT。指定成交吃的是左边这一张真实挂单。"
              : "PnL uses the pushed mark, not the limit. Margin is BSC USDT. Take fills one real order."}
          </p>
          <p className="text-[11px] tracking-[0.14em] text-gold">{zh ? "推荐" : "Referral"}</p>
          {rebate.code ? (
            <button
              type="button"
              className="h-8 border border-gold text-xs"
              onClick={() =>
                navigator.clipboard
                  .writeText(inviteLink(rebate.code))
                  .then(() => setNote(zh ? "链接已复制。" : "Link copied."))
                  .catch(() => setNote(inviteLink(rebate.code)))
              }
            >
              {zh ? "复制邀请链接" : "Copy invite"}
            </button>
          ) : (
            <div className="flex gap-1">
              <input
                value={mineCode}
                onChange={(event) => setMineCode(event.target.value)}
                className="h-8 min-w-0 flex-1 border border-gold/50 bg-transparent px-2 text-xs outline-none"
                placeholder={zh ? "我的码" : "My code"}
              />
              <button
                type="button"
                disabled={busy}
                className="h-8 border border-gold px-2 text-xs"
                onClick={async () => {
                  const user = account ?? currentAccount();
                  if (!user) return;
                  setBusy(true);
                  try {
                    await registerGate(user, mineCode);
                    setNote(
                      zh ? "推荐码已写上。确认后不能改。" : "Code written. It cannot be changed.",
                    );
                  } catch {
                    setNote(zh ? "推荐码没写上。" : "The code was not written.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {zh ? "确认" : "Set"}
              </button>
            </div>
          )}
          {rebate.referrer && rebate.referrer !== "0x0000000000000000000000000000000000000000" ? (
            <p className="font-mono text-[11px]">{short(rebate.referrer)}</p>
          ) : (
            <div className="flex gap-1">
              <input
                value={friend}
                onChange={(event) => setFriend(event.target.value)}
                className="h-8 min-w-0 flex-1 border border-gold/50 bg-transparent px-2 text-xs outline-none"
                placeholder={zh ? "对方的码" : "Their code"}
              />
              <button
                type="button"
                disabled={busy}
                className="h-8 border border-gold px-2 text-xs"
                onClick={async () => {
                  const user = account ?? currentAccount();
                  if (!user) return;
                  setBusy(true);
                  try {
                    await bindGate(user, friend);
                    setNote(zh ? "已绑定。" : "Bound.");
                  } catch {
                    setNote(zh ? "绑定失败。对方要先确认过自己的码。" : "Bind failed.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {zh ? "绑定" : "Bind"}
              </button>
            </div>
          )}
          <p className="font-mono text-xs">
            {zh ? "可提" : "Claimable"} {rebate.accrued.toFixed(2)} USDT
          </p>
          <div className="grid grid-cols-4 gap-1">
            {[1, 10, 20, 50, 100, 300, 500].map((step) => (
              <button
                key={step}
                type="button"
                disabled={busy || rebate.accrued + 1e-9 < step}
                className="h-8 border border-gold/50 font-mono text-[11px] disabled:opacity-40"
                onClick={async () => {
                  const user = account ?? currentAccount();
                  if (!user) return;
                  setBusy(true);
                  try {
                    await claimGate(user, BigInt(step) * 10n ** 18n);
                    setNote(zh ? `已提 ${step} USDT。` : `Claimed ${step} USDT.`);
                  } catch {
                    setNote(zh ? "提现没有完成。" : "The claim did not finish.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {step}
              </button>
            ))}
          </div>
          {note ? <p className="text-xs leading-5">{note}</p> : null}
        </div>
      </section>
    </div>
  );
}

function OrderRow({
  row,
  mine,
  zh,
  max,
  onCancel,
  onTake,
}: {
  row: ChainOrder;
  mine: string;
  zh: boolean;
  max: number;
  onCancel: () => void;
  onTake: () => void;
}) {
  const own = row.user.toLowerCase() === mine;
  const depth = Math.max(8, Math.min(100, (row.margin / max) * 100));
  return (
    <div className="relative grid grid-cols-[3.6rem_minmax(0,1fr)_auto] items-center px-2 py-1 font-mono text-[12px] tabular-nums sm:grid-cols-[4.2rem_minmax(0,1fr)_4.2rem_4.6rem]">
      <span
        className={`pointer-events-none absolute inset-y-1 ${row.long ? "right-[28%] bg-up/15" : "left-[18%] bg-sell/15"}`}
        style={{ width: `${depth * 0.35}%` }}
      />
      <span className={`relative font-semibold ${row.long ? "text-up" : "text-sell"}`}>
        {px(row.price)}
      </span>
      <span className="relative">
        {row.margin} USDT · {row.lev}×
      </span>
      <span className="relative hidden text-right sm:block">
        {(row.margin * row.lev).toFixed(2)}
      </span>
      <button
        type="button"
        onClick={own ? onCancel : onTake}
        className={`relative ml-auto h-6 border bg-transparent px-1.5 text-[11px] ${own ? "border-ink/30 text-ink/70" : row.long ? "border-sell text-sell" : "border-up text-up"}`}
      >
        {own ? (zh ? "撤单" : "Cancel") : row.long ? (zh ? "开空" : "Short") : zh ? "开多" : "Long"}
      </button>
    </div>
  );
}
