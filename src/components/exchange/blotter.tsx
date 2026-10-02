import { useState } from "react";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { fmtPx, fmtSz, fmtUsd } from "@/lib/format";
import { liqPrice, unrealized } from "@/lib/match-engine";

type Tab = "pos" | "ords" | "fills";

export function Blotter() {
  const lang = useExchange((s) => s.lang);
  const [tab, setTab] = useState<Tab>("pos");
  const c = copy[lang];
  const tabs: [Tab, string][] = [
    ["pos", c.pos],
    ["ords", c.ords],
    ["fills", c.fills],
  ];
  return (
    <section className="border border-gold bg-card shadow-plate">
      <div className="grid grid-cols-3 border-b border-gold/40">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-11 text-sm ${tab === id ? "bg-foil text-ink" : "text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-3">
        {tab === "pos" ? <Positions /> : null}
        {tab === "ords" ? <Orders /> : null}
        {tab === "fills" ? <Fills /> : null}
      </div>
    </section>
  );
}

function Positions() {
  const lang = useExchange((s) => s.lang);
  const bem = useExchange((s) => s.engine.bem);
  const price = useExchange((s) => s.engine.price);
  const pos = useExchange((s) => s.engine.position);
  const fundingPaid = useExchange((s) => s.engine.fundingPaid);
  const close = useExchange((s) => s.close);
  const c = copy[lang];
  const upnl = unrealized(pos, price);
  const liq = pos ? liqPrice(pos) : null;
  const danger = pos ? pos.margin + upnl < pos.margin * 0.3 : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between border-b border-gold/30 pb-2">
        <div>
          <p className="text-xs tracking-widest text-gold">{c.inventory}</p>
          <p className="font-mono text-lg tabular-nums">{fmtSz(bem)} BEM</p>
        </div>
        <p className="font-mono text-sm tabular-nums text-ink/70">
          {c.spotMv} {fmtUsd(bem * price)}
        </p>
      </div>
      {!pos || pos.size === 0 ? (
        <p className="text-sm leading-relaxed text-ink/80">{c.emptyPos}</p>
      ) : (
        <article className={`border p-3 ${danger ? "border-sell" : "border-gold"}`}>
          <div className="flex items-baseline justify-between">
            <h3 className="font-display text-2xl italic">{pos.size > 0 ? c.long : c.short}</h3>
            <p className="font-mono text-sm">{pos.leverage}×</p>
          </div>
          {danger ? <p className="mt-1 text-xs tracking-widest text-sell">{c.nearFuse}</p> : null}
          <dl className="mt-3 grid grid-cols-2 gap-y-1 font-mono text-sm tabular-nums">
            <dt className="text-ink/60">{c.size}</dt>
            <dd className="text-right">{fmtSz(Math.abs(pos.size))}</dd>
            <dt className="text-ink/60">{c.entry}</dt>
            <dd className="text-right">{fmtPx(pos.entry)}</dd>
            <dt className="text-ink/60">{c.mark}</dt>
            <dd className="text-right">{fmtPx(price)}</dd>
            <dt className="text-ink/60">{c.margin}</dt>
            <dd className="text-right">{fmtUsd(pos.margin)}</dd>
            <dt className="text-ink/60">{c.upnl}</dt>
            <dd className={`text-right ${upnl >= 0 ? "text-gold" : "text-sell"}`}>{fmtUsd(upnl)}</dd>
            <dt className="text-ink/60">{c.liq}</dt>
            <dd className="text-right text-sell">{liq != null ? fmtPx(liq) : "—"}</dd>
            <dt className="text-ink/60">{c.fundingPaid}</dt>
            <dd className={`text-right ${fundingPaid > 0 ? "text-sell" : "text-gold"}`}>{fmtUsd(fundingPaid)}</dd>
          </dl>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => close(0.5)} className="min-h-11 border border-gold">
              {c.closeHalf}
            </button>
            <button type="button" onClick={() => close(1)} className="min-h-11 bg-ink text-paper">
              {c.closeAll}
            </button>
          </div>
        </article>
      )}
    </div>
  );
}

function Orders() {
  const lang = useExchange((s) => s.lang);
  const orders = useExchange((s) => s.engine.orders);
  const cancel = useExchange((s) => s.cancel);
  const c = copy[lang];
  if (orders.length === 0) return <p className="text-sm leading-relaxed text-ink/80">{c.emptyOrd}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {orders.map((o) => (
        <li key={o.id} className="flex items-center justify-between gap-2 border border-gold/40 px-2 py-1">
          <div className="min-w-0 font-mono text-sm tabular-nums">
            <p className={o.side === "buy" ? "text-gold" : "text-sell"}>
              {o.market === "spot" ? c.spot : c.perp} · {o.side === "buy" ? c.bidSub : c.askSub}
            </p>
            <p>
              {fmtSz(o.remaining)} @ {fmtPx(o.price)}
            </p>
          </div>
          <button type="button" onClick={() => cancel(o.id)} className="min-h-11 shrink-0 border border-sell px-3 text-sell">
            {c.cancel}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Fills() {
  const lang = useExchange((s) => s.lang);
  const fills = useExchange((s) => s.engine.fills);
  const c = copy[lang];
  const mine = fills.filter((f) => f.kind === "trade" || f.kind === "liq");
  if (mine.length === 0) return <p className="text-sm leading-relaxed text-ink/80">{c.emptyFill}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {mine.map((f) => (
        <li key={f.id} className="flex items-baseline justify-between gap-2 font-mono text-sm tabular-nums">
          <span className={f.kind === "liq" ? "text-sell" : f.side === "buy" ? "text-gold" : "text-sell"}>
            {f.kind === "liq" ? c.nearFuse : f.side === "buy" ? c.bidSub : c.askSub} {f.market === "spot" ? c.spot : c.perp}
          </span>
          <span>
            {fmtSz(f.size)} @ {fmtPx(f.price)}
          </span>
          <span className={f.pnl >= 0 ? "text-gold" : "text-sell"}>{f.pnl !== 0 ? fmtUsd(f.pnl) : fmtUsd(f.fee)}</span>
        </li>
      ))}
    </ul>
  );
}
