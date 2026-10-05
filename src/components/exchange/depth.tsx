import { useMemo, useRef, useState, type PointerEvent } from "react";
import { fmtPx, fmtSz } from "@/lib/format";

type Level = { price: number; size: number };

const W = 860;
const H = 168;
const PAD = { l: 8, r: 72, t: 12, b: 20 };

export function DepthTape({ bids, asks, lang }: { bids: Level[]; asks: Level[]; lang: "zh" | "en" }) {
  const zh = lang === "zh";
  const book = useMemo(() => {
    const bid = bids.filter((level) => level.price > 0 && level.size > 0).sort((a, b) => b.price - a.price);
    const ask = asks.filter((level) => level.price > 0 && level.size > 0).sort((a, b) => a.price - b.price);
    let cum = 0;
    const bidPts = bid.map((level) => {
      cum += level.size;
      return { price: level.price, cum };
    });
    cum = 0;
    const askPts = ask.map((level) => {
      cum += level.size;
      return { price: level.price, cum };
    });
    return { bidPts, askPts };
  }, [asks, bids]);
  const prices = [...book.bidPts, ...book.askPts].map((point) => point.price);
  const fitLo = prices.length ? Math.min(...prices) : 0;
  const fitHi = prices.length ? Math.max(...prices) : 1;
  const fitMid = (fitLo + fitHi) / 2 || 1;
  const fitHalf = Math.max((fitHi - fitLo) / 2, Math.abs(fitMid) * 0.004, 1e-8);
  const [half, setHalf] = useState<number | null>(null);
  const [mid, setMid] = useState<number | null>(null);
  const viewHalf = half ?? fitHalf * 1.15;
  const viewMid = mid ?? fitMid;
  const lo = viewMid - viewHalf;
  const hi = viewMid + viewHalf;
  const span = hi - lo || 1;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (price: number) => PAD.l + ((price - lo) / span) * innerW;
  const shown = [...book.bidPts, ...book.askPts].filter((point) => point.price >= lo && point.price <= hi);
  const maxCum = Math.max(1, ...shown.map((point) => point.cum));
  const y = (cum: number) => PAD.t + (1 - cum / maxCum) * innerH;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef<{ x: number; mid: number } | null>(null);

  const area = (points: { price: number; cum: number }[], side: "bid" | "ask") => {
    const inside = points.filter((point) => point.price >= lo - span && point.price <= hi + span);
    if (!inside.length) return "";
    const ordered = side === "bid" ? [...inside].sort((a, b) => b.price - a.price) : [...inside].sort((a, b) => a.price - b.price);
    const first = ordered[0];
    let d = `M ${x(first.price).toFixed(1)} ${y(0).toFixed(1)}`;
    ordered.forEach((point, index) => {
      const prev = ordered[index - 1] ?? point;
      d += ` L ${x(point.price).toFixed(1)} ${y(prev.cum).toFixed(1)} L ${x(point.price).toFixed(1)} ${y(point.cum).toFixed(1)}`;
    });
    const last = ordered[ordered.length - 1];
    d += ` L ${x(last.price).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L ${x(first.price).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} Z`;
    return d;
  };

  const pointer = (ev: PointerEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return ((ev.clientX - rect.left) / rect.width) * W;
  };

  return (
    <div className="border-t border-gold/30">
      <div className="flex items-center justify-between gap-2 px-3 py-1">
        <p className="text-[11px] tracking-widest text-gold">
          {zh ? "深度" : "Depth"}
          {prices.length > 0 ? <span className="ml-2 font-mono tabular-nums text-ink/50">{fmtSz(maxCum)}</span> : null}
        </p>
        <div className="flex items-center gap-1 text-[11px]">
          <button type="button" onClick={() => setHalf((value) => Math.max(fitHalf * 0.15, (value ?? fitHalf * 1.15) * 0.7))} className="h-6 border border-gold px-1.5">
            {zh ? "放大" : "In"}
          </button>
          <button type="button" onClick={() => setHalf((value) => Math.min(fitHalf * 8, (value ?? fitHalf * 1.15) * 1.4))} className="h-6 border border-gold px-1.5">
            {zh ? "缩小" : "Out"}
          </button>
          <button type="button" onClick={() => { setHalf(null); setMid(null); }} className="h-6 px-1.5 text-ink/60">
            {zh ? "全貌" : "Fit"}
          </button>
        </div>
      </div>
      {prices.length === 0 ? (
        <p className="px-3 pb-4 text-sm text-ink/50">{zh ? "这一边还没有挂单。" : "No orders on this side yet."}</p>
      ) : (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-24 w-full touch-none"
          role="img"
          aria-label={zh ? "深度图" : "Depth chart"}
          onPointerDown={(ev) => {
            panRef.current = { x: pointer(ev), mid: viewMid };
            ev.currentTarget.setPointerCapture(ev.pointerId);
          }}
          onPointerUp={() => {
            panRef.current = null;
          }}
          onPointerMove={(ev) => {
            const panning = panRef.current;
            if (!panning) return;
            const dx = pointer(ev) - panning.x;
            setMid(panning.mid - (dx / innerW) * span);
          }}
        >
          <path d={area(book.bidPts, "bid")} fill="#6e5014" fillOpacity="0.28" stroke="#6e5014" />
          <path d={area(book.askPts, "ask")} fill="#9e1b12" fillOpacity="0.22" stroke="#9e1b12" />
          {[0, 0.5, 1].map((step) => {
            const price = lo + span * step;
            return (
              <g key={step}>
                <line x1={x(price)} x2={x(price)} y1={PAD.t} y2={PAD.t + innerH} stroke="#6e5014" strokeOpacity="0.15" />
                <text
                  x={step === 0 ? PAD.l : step === 1 ? x(price) : W - PAD.r}
                  y={H - 4}
                  textAnchor={step === 0 ? "start" : step === 1 ? "middle" : "end"}
                  fontSize="10"
                  fill="var(--color-ink)"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {fmtPx(price)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
