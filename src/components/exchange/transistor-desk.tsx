import { useEffect, useState } from "react";
import { useExchange } from "@/lib/exchange-store";
import { easyBand } from "@/lib/stops";
import { getTransistorDesk, type Level, type TransistorDesk } from "@/lib/transistor-market";

const FIRST = { token: "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087", id: 0 };
const KEY = "tapeliquid-gate-pos";

type Pos = {
  id: string;
  name: string;
  kind: string;
  long: boolean;
  margin: number;
  lev: number;
  entry: number;
  tp: number;
  sl: number;
};

function px(value: number): string {
  if (!(value > 0)) return "—";
  if (value < 0.001) return value.toFixed(8);
  if (value < 1) return value.toFixed(4);
  return value.toFixed(2);
}

function loadPos(): Pos[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Pos[];
  } catch {
    return [];
  }
}

function Ladder({ asks, bids, mark }: { asks: Level[]; bids: Level[]; mark: number }) {
  const max = Math.max(1, ...asks.map((row) => row.qty), ...bids.map((row) => row.qty));
  const line = (row: Level, buy: boolean) => (
    <div key={`${buy}-${row.price}-${row.maker}`} className="relative grid grid-cols-[4.8rem_1fr_1fr_auto] items-center gap-2 px-2 py-1 font-mono text-sm tabular-nums">
      <span className="absolute inset-y-1 left-0" style={{ width: `${Math.max(6, Math.round((row.qty / max) * 100))}%`, background: buy ? "rgba(158,27,18,0.12)" : "rgba(30,110,70,0.14)" }} />
      <span className={`relative ${buy ? "text-sell" : "text-[#1b6b45]"}`}>{px(row.price)}</span>
      <span className="relative">{Math.round(row.qty)}</span>
      <span className="relative">{row.total.toFixed(4)}</span>
      <span className={`relative min-h-8 px-2 text-xs text-paper ${buy ? "bg-sell" : "bg-[#1b6b45]"}`}>{buy ? "买入" : "卖出"}</span>
    </div>
  );
  const askRows = [...asks].sort((a, b) => b.price - a.price);
  const bidRows = [...bids].sort((a, b) => b.price - a.price);
  return (
    <div>
      <div className="grid grid-cols-[4.8rem_1fr_1fr_auto] gap-2 px-2 py-1 text-xs text-ink/50">
        <span>价格 BNB</span>
        <span>数量</span>
        <span>总额</span>
        <span>指定成交</span>
      </div>
      {askRows.map((row) => line(row, true))}
      <p className="my-1 flex items-center gap-3 px-2 font-mono text-sm">
        <span className="h-px flex-1 bg-gold/40" />
        <span>{px(mark)} BNB</span>
        <span className="h-px flex-1 bg-gold/40" />
      </p>
      {bidRows.map((row) => line(row, false))}
    </div>
  );
}

export function TransistorDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [pick, setPick] = useState(FIRST);
  const [desk, setDesk] = useState<TransistorDesk | null>(null);
  const [margin, setMargin] = useState("0.01");
  const [lev, setLev] = useState(10);
  const [guard, setGuard] = useState<"easy" | "pro">("easy");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [positions, setPositions] = useState<Pos[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    setPositions(loadPos());
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      getTransistorDesk({ data: pick })
        .then((next) => {
          if (!dead) setDesk(next);
        })
        .catch(() => undefined);
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

  useEffect(() => {
    if (!(mark > 0) || positions.length === 0) return;
    const next = positions.filter((pos) => {
      if (!gate || pos.name !== gate.name || pos.kind !== gate.kind) return true;
      const hit = pos.long ? mark >= pos.tp || mark <= pos.sl : mark <= pos.tp || mark >= pos.sl;
      return !hit;
    });
    if (next.length !== positions.length) {
      setPositions(next);
      window.localStorage.setItem(KEY, JSON.stringify(next));
      setNote(zh ? "止盈或止损已按官网价平掉。" : "A stop closed at the official price.");
    }
  }, [mark, positions, zh]);

  function open(long: boolean) {
    const amount = Number(margin);
    if (!(amount > 0) || !(mark > 0) || !gate) return;
    const band = guard === "easy" ? easyBand(mark, lev, long) : { tp: Number(tp), sl: Number(sl) };
    if (!(band.tp > 0) || !(band.sl > 0)) return;
    const fee = amount * 0.002;
    const row: Pos = {
      id: `${Date.now()}`,
      name: gate.name,
      kind: gate.kind,
      long,
      margin: amount,
      lev,
      entry: mark,
      tp: band.tp,
      sl: band.sl,
    };
    const next = [row, ...positions].slice(0, 20);
    setPositions(next);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    setNote(zh ? `已开。手续费 ${fee.toFixed(6)} BNB。有推荐人时，其中 4% 让给开仓的人，6% 记给推荐人，和 BEM 合约同一套。` : `Opened. Fee ${fee.toFixed(6)} BNB. With a referrer, 4% of that fee is the trader's discount and 6% is the referrer's, the same split as the BEM contract.`);
  }

  function close(id: string) {
    const next = positions.filter((pos) => pos.id !== id);
    setPositions(next);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  }

  return (
    <section className="grid gap-3 lg:grid-cols-[15rem_1fr_17rem]">
      <div className="border border-gold bg-card">
        {(desk?.gates.length ? desk.gates : []).map((row) => {
          const on = row.transistors.toLowerCase() === pick.token.toLowerCase() && row.tokenId === pick.id;
          return (
            <button key={row.id} type="button" onClick={() => setPick({ token: row.transistors, id: row.tokenId })} className={`flex w-full items-center justify-between gap-2 border-b border-gold/30 px-3 py-2 text-left ${on ? "bg-foil" : ""}`}>
              <span>
                <span className="block text-sm">{row.name}</span>
                <span className="font-mono text-xs text-ink/60">{row.kind}</span>
              </span>
              <span className="text-right font-mono text-xs tabular-nums">
                <span className="block">{px(row.price)} BNB</span>
                <span className={row.changePct >= 0 ? "text-[#1b6b45]" : "text-sell"}>{row.changePct.toFixed(2)}%</span>
              </span>
            </button>
          );
        })}
        {!desk?.gates.length ? <p className="p-3 text-sm text-ink/60">{desk?.error ? (zh ? "官网价暂时读不到。" : "The official price is not available.") : zh ? "正在同步官网。" : "Syncing."}</p> : null}
      </div>
      <div className="border border-gold bg-card">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-gold/30 px-3 py-3">
          <div>
            <p className="font-display text-2xl italic">{gate ? `${gate.name} / ${gate.kind}` : "NAND"}</p>
            <p className="mt-1 break-all font-mono text-xs text-ink/50">{gate?.transistors}</p>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-widest text-gold">{zh ? "参考价" : "Mark"}</p>
            <p className="font-mono text-2xl tabular-nums">{px(mark)}</p>
            <p className="font-mono text-xs text-ink/50">{zh ? "每秒跟官网" : "Official, each second"}</p>
          </div>
        </div>
        <Ladder asks={desk?.asks ?? []} bids={desk?.bids ?? []} mark={mark} />
        <p className="px-3 py-2 text-xs leading-relaxed text-ink/50">{zh ? "红的是官网卖单，绿的是官网买单。中间这根是参考价。右边开的是我们的合约，按这根价结算。" : "Red rows are the official asks. Green rows are the official bids. The line in the middle is the mark. The ticket on the right is our contract, settled at that price."}</p>
      </div>
      <div className="flex flex-col gap-2 border border-gold bg-card p-3">
        <p className="text-xs tracking-widest text-gold">{zh ? "合约" : "Contract"}</p>
        <label className="text-sm">
          {zh ? "保证金 BNB" : "Margin BNB"}
          <input value={margin} onChange={(event) => setMargin(event.target.value)} inputMode="decimal" className="mt-1 w-full border border-gold bg-transparent px-2 py-2 font-mono outline-none" />
        </label>
        <div className="grid grid-cols-4 gap-1">
          {[1, 5, 10, 20, 50, 100].map((item) => (
            <button key={item} type="button" onClick={() => setLev(item)} className={`min-h-10 border border-gold font-mono text-xs ${lev === item ? "bg-ink text-paper" : ""}`}>{item}×</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button type="button" onClick={() => setGuard("easy")} className={`min-h-10 border border-gold text-sm ${guard === "easy" ? "bg-ink text-paper" : ""}`}>{zh ? "小白止盈止损" : "Simple"}</button>
          <button type="button" onClick={() => setGuard("pro")} className={`min-h-10 border border-gold text-sm ${guard === "pro" ? "bg-ink text-paper" : ""}`}>{zh ? "高手" : "Manual"}</button>
        </div>
        {guard === "pro" ? (
          <div className="grid grid-cols-2 gap-1">
            <input value={tp} onChange={(event) => setTp(event.target.value)} placeholder={zh ? "止盈价" : "Take profit"} className="border border-gold bg-transparent px-2 py-2 font-mono outline-none" />
            <input value={sl} onChange={(event) => setSl(event.target.value)} placeholder={zh ? "止损价" : "Stop"} className="border border-gold bg-transparent px-2 py-2 font-mono outline-none" />
          </div>
        ) : mark > 0 ? (
          <p className="font-mono text-xs">{zh ? "开多" : "Long"} {px(easyBand(mark, lev, true).tp)} / {px(easyBand(mark, lev, true).sl)}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => open(true)} className="min-h-11 bg-ink text-paper">{zh ? "开多" : "Long"}</button>
          <button type="button" onClick={() => open(false)} className="min-h-11 border border-gold">{zh ? "开空" : "Short"}</button>
        </div>
        <p className="text-xs leading-relaxed text-ink/60">{zh ? "手续费是保证金的千分之二。有推荐人时，交易者少付其中 4%，推荐人记其中 6%。比例和 BEM 永续合约一样。这一页的仓位按官网价结算，不进 BEM 的订单簿。" : "The fee is 0.2% of margin. With a referrer, the trader pays 4% less of that fee and the referrer is credited 6%. Same split as the BEM perpetual. These positions settle at the official price and do not enter the BEM book."}</p>
        {note ? <p className="text-sm">{note}</p> : null}
        {positions.filter((pos) => !gate || (pos.name === gate.name && pos.kind === gate.kind)).map((pos) => {
          const move = pos.entry > 0 ? ((mark - pos.entry) / pos.entry) * (pos.long ? 1 : -1) : 0;
          const pnl = pos.margin * pos.lev * move;
          return (
            <div key={pos.id} className="border border-gold/40 px-2 py-2 text-sm">
              <p className="font-mono">{pos.long ? (zh ? "多" : "Long") : zh ? "空" : "Short"} · {pos.lev}× · {pos.margin} BNB</p>
              <p className={`font-mono ${pnl >= 0 ? "text-gold" : "text-sell"}`}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(6)} BNB</p>
              <button type="button" className="mt-1 min-h-9 border border-gold px-2" onClick={() => close(pos.id)}>{zh ? "平仓" : "Close"}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
