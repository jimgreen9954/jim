import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { fmt, fmtPx, fmtSz } from "@/lib/format";
import { buildBook, spreadBps, type Level } from "@/lib/match-engine";

export function Book() {
  const price = useExchange((s) => s.engine.price);
  const orders = useExchange((s) => s.engine.orders);
  const clock = useExchange((s) => s.engine.clock);
  const market = useExchange((s) => s.market);
  const lang = useExchange((s) => s.lang);
  const pick = useExchange((s) => s.pickLevel);
  const c = copy[lang];
  const { bids, asks } = buildBook(price, orders, market, clock);
  const max = Math.max(1, ...bids.map((l) => l.size), ...asks.map((l) => l.size));
  const asksDesc = [...asks].reverse();

  return (
    <section className="border border-gold bg-card shadow-plate">
      <header className="flex items-center justify-between border-b border-gold/40 px-3 py-2">
        <h2 className="font-display text-xl italic">{c.book}</h2>
        <p className="font-mono text-xs tabular-nums text-gold">
          {c.kerf} {fmt(spreadBps(price), 1)} bp
        </p>
      </header>
      <div className="max-h-96 overflow-auto px-1 py-1">
        {asksDesc.map((level) => (
          <Row key={`a-${level.price}`} level={level} max={max} side="ask" mine={c.mine} onPick={() => pick(level.price, "buy")} />
        ))}
        <div className="my-1 flex items-center justify-between border-y border-dashed border-gold px-2 py-2">
          <span className="text-xs tracking-widest text-gold">{c.kerf}</span>
          <span className="font-mono text-lg tabular-nums">{fmtPx(price)}</span>
        </div>
        {bids.map((level) => (
          <Row key={`b-${level.price}`} level={level} max={max} side="bid" mine={c.mine} onPick={() => pick(level.price, "sell")} />
        ))}
      </div>
    </section>
  );
}

function Row({
  level,
  max,
  side,
  mine,
  onPick,
}: {
  level: Level;
  max: number;
  side: "bid" | "ask";
  mine: string;
  onPick: () => void;
}) {
  const pct = Math.min(100, (level.size / max) * 100);
  return (
    <button type="button" onClick={onPick} className="relative flex min-h-11 w-full items-center lg:min-h-8">
      <span
        className={`absolute inset-y-1 ${side === "bid" ? "left-0 bg-foil/80" : "right-0 bg-sell/20"}`}
        style={{ width: `${pct}%` }}
      />
      <span className="relative flex w-full items-center justify-between px-2 font-mono text-sm tabular-nums">
        <span>{fmtSz(level.size)}</span>
        <span className="flex items-center gap-2">
          {level.mine > 0 ? (
            <span className="bg-ink px-1 text-xs text-paper">
              {mine} {fmtSz(level.mine)}
            </span>
          ) : null}
          <span className={side === "ask" ? "text-sell" : "text-ink"}>{fmtPx(level.price)}</span>
        </span>
      </span>
    </button>
  );
}
