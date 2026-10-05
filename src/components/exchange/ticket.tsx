import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { fmtPx, fmtSz, fmtUsd } from "@/lib/format";
import { feeRate, touchAsk, touchBid } from "@/lib/match-engine";

const LEVS = [2, 5, 10, 20];

export function Ticket() {
  const lang = useExchange((s) => s.lang);
  const market = useExchange((s) => s.market);
  const side = useExchange((s) => s.side);
  const draft = useExchange((s) => s.draft);
  const usd = useExchange((s) => s.engine.usd);
  const bem = useExchange((s) => s.engine.bem);
  const price = useExchange((s) => s.engine.price);
  const taped = useExchange((s) => s.engine.taped);
  const position = useExchange((s) => s.engine.position);
  const setSide = useExchange((s) => s.setSide);
  const setOrderType = useExchange((s) => s.setOrderType);
  const setSize = useExchange((s) => s.setSize);
  const setPrice = useExchange((s) => s.setPrice);
  const setLev = useExchange((s) => s.setLev);
  const applyPercent = useExchange((s) => s.applyPercent);
  const submit = useExchange((s) => s.submit);
  const c = copy[lang];

  const touch = side === "buy" ? touchAsk(price) : touchBid(price);
  const limitPx = draft.orderType === "limit" && Number(draft.price) > 0 ? Number(draft.price) : touch;
  const sizeN = Number(draft.size);
  const taker = draft.orderType === "market" || (side === "buy" ? limitPx >= touchAsk(price) : limitPx <= touchBid(price));
  const rate = feeRate(taped, taker);
  const fee = Number.isFinite(sizeN) && sizeN > 0 ? limitPx * sizeN * rate : 0;
  const lev = position && position.size !== 0 ? position.leverage : draft.leverage;
  let hold = 0;
  let holdBem = false;
  if (market === "spot" && side === "buy") hold = limitPx * (Number.isFinite(sizeN) ? sizeN : 0) + fee;
  if (market === "spot" && side === "sell") {
    hold = Number.isFinite(sizeN) ? sizeN : 0;
    holdBem = true;
  }
  if (market === "perp") hold = (limitPx * (Number.isFinite(sizeN) ? sizeN : 0)) / lev + fee;
  const takerBps = Math.round(feeRate(taped, true) * 10000);
  const makerBps = Math.round(feeRate(taped, false) * 10000);

  const label = actionLabel();

  function actionLabel() {
    const n = Number.isFinite(sizeN) ? sizeN : 0;
    if (market === "spot") return side === "buy" ? c.buySpot : c.sellSpot;
    if (!position || position.size === 0) return side === "buy" ? c.openLong : c.openShort;
    const dir = side === "buy" ? 1 : -1;
    if (Math.sign(position.size) === dir) return side === "buy" ? c.addLong : c.addShort;
    if (n > Math.abs(position.size) + 1e-6) return side === "buy" ? c.flipLong : c.flipShort;
    return side === "buy" ? c.closeLong : c.closeShort;
  }

  return (
    <section className="border border-gold bg-card p-3 shadow-plate">
      <div className="grid grid-cols-2">
        <button
          type="button"
          onClick={() => setSide("buy")}
          className={`min-h-12 border border-gold ${side === "buy" ? "bg-foil text-ink" : "bg-card text-ink"}`}
        >
          <span className="block text-sm">{c.bidSub}</span>
          <span className="block font-display text-lg italic">{side === "buy" ? label : lang === "zh" ? "买入" : "Buy"}</span>
        </button>
        <button
          type="button"
          onClick={() => setSide("sell")}
          className={`min-h-12 border border-gold ${side === "sell" ? "bg-sell text-[#f7f5f0]" : "bg-card text-sell"}`}
        >
          <span className="block text-sm">{c.askSub}</span>
          <span className="block font-display text-lg italic">{side === "sell" ? label : lang === "zh" ? "卖出" : "Sell"}</span>
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setOrderType("market")}
          className={`min-h-11 border ${draft.orderType === "market" ? "border-ink bg-ink text-paper" : "border-gold"}`}
        >
          {c.market}
        </button>
        <button
          type="button"
          onClick={() => setOrderType("limit")}
          className={`min-h-11 border ${draft.orderType === "limit" ? "border-ink bg-ink text-paper" : "border-gold"}`}
        >
          {c.limit}
        </button>
      </div>

      <label className="mt-4 block text-xs tracking-widest text-gold" htmlFor="bem-size">
        {c.size}
      </label>
      <input
        id="bem-size"
        inputMode="decimal"
        autoComplete="off"
        value={draft.size}
        onChange={(e) => setSize(e.target.value)}
        className="w-full border-b border-gold bg-transparent py-2 font-mono text-lg tabular-nums outline-none"
      />
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[0.25, 0.5, 1].map((pct) => (
          <button key={pct} type="button" onClick={() => applyPercent(pct)} className="min-h-11 border border-gold text-sm">
            {Math.round(pct * 100)}%
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="text-xs tracking-widest text-gold">{c.price}</p>
        {draft.orderType === "limit" ? (
          <input
            inputMode="decimal"
            autoComplete="off"
            value={draft.price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full border-b border-gold bg-transparent py-2 font-mono text-lg tabular-nums outline-none"
            aria-label={c.price}
          />
        ) : (
          <p className="border-b border-gold py-2 font-mono text-lg tabular-nums">
            {c.willFill} {fmtPx(touch)}
          </p>
        )}
      </div>

      {market === "perp" ? (
        <div className="mt-4">
          <p className="text-xs tracking-widest text-gold">{c.lev}</p>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {LEVS.map((n) => (
              <button
                key={n}
                type="button"
                disabled={Boolean(position && position.size !== 0)}
                onClick={() => setLev(n)}
                className={`min-h-11 border border-gold disabled:opacity-40 ${lev === n ? "bg-foil" : "bg-card"}`}
              >
                {n}×
              </button>
            ))}
          </div>
          {position && position.size !== 0 ? <p className="mt-2 text-xs text-ink/70">{c.levLock}</p> : null}
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-ink/60">{c.freeUsd}</dt>
        <dd className="text-right">{fmtUsd(usd)}</dd>
        <dt className="text-ink/60">{c.freeBem}</dt>
        <dd className="text-right">{fmtSz(bem)}</dd>
        <dt className="text-ink/60">{c.est}</dt>
        <dd className="text-right">{holdBem ? `${fmtSz(hold)} BEM` : fmtUsd(hold)}</dd>
        <dt className="text-ink/60">{lang === "zh" ? "本单费用" : "This fee"}</dt>
        <dd className="text-right">{fmtUsd(fee)}</dd>
        <dt className="text-ink/60">
          {c.taker}/{c.maker}
        </dt>
        <dd className="text-right">
          {(takerBps / 100).toFixed(2)}% / {(makerBps / 100).toFixed(2)}%
        </dd>
      </dl>

      <button
        type="button"
        onClick={submit}
        className={`mt-4 min-h-12 w-full font-display text-xl italic ${side === "buy" ? "bg-foil text-ink" : "bg-sell text-[#f7f5f0]"}`}
      >
        {label}
      </button>
    </section>
  );
}
