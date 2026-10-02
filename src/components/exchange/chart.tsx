import { useEffect, useState } from "react";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { fmtPx, fmtSz } from "@/lib/format";
import { getPaperCandles, PAPER_FRAMES, paperLabel, type Ohlc, type PaperFrame } from "@/lib/candles";

const VB_W = 800;
const VB_H = 360;
const PAD = { l: 12, r: 72, t: 16, b: 18 };

export function TraceChart() {
  const live = useExchange((s) => s.chainBem);
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [frame, setFrame] = useState<PaperFrame>("1m");
  const [rows, setRows] = useState<Ohlc[]>([]);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    setRows([]);
    const pull = () => {
      getPaperCandles({ data: frame })
        .then((next) => {
          if (!dead && next.length > 0) setRows(next);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, frame === "1m" ? 15_000 : 60_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [frame]);

  const view = rows.map((candle, index) => {
    if (index !== rows.length - 1 || !(live && live > 0)) return candle;
    return { ...candle, c: live, h: Math.max(candle.h, live), l: Math.min(candle.l, live) };
  });
  const rawMin = view.length ? Math.min(...view.map((x) => x.l)) : 0;
  const rawMax = view.length ? Math.max(...view.map((x) => x.h)) : 1;
  const span0 = Math.max(1e-6, rawMax - rawMin);
  const min = rawMin - span0 * 0.12;
  const max = rawMax + span0 * 0.12;
  const span = max - min;
  const innerW = VB_W - PAD.l - PAD.r;
  const innerH = VB_H - PAD.t - PAD.b;
  const priceH = innerH * 0.8;
  const y = (p: number) => PAD.t + ((max - p) / span) * priceH;
  const n = Math.max(view.length, 1);
  const slot = innerW / n;
  const last = view[view.length - 1];
  const hi = hover != null ? view[hover] : last;
  const maxV = Math.max(...view.map((x) => x.v), 1);

  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * (1 - t));

  return (
    <section className="border border-gold bg-card shadow-plate">
      <div className="flex items-center justify-between gap-2 border-b border-gold/40 px-3 py-2">
        <p className="text-xs tracking-widest text-gold">{c.paper}</p>
        <div className="flex flex-wrap justify-end gap-1">
          {PAPER_FRAMES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFrame(item)}
              className={`min-h-9 px-2 text-xs ${frame === item ? "bg-foil text-ink" : "text-ink"}`}
            >
              {paperLabel(item, lang)}
            </button>
          ))}
        </div>
      </div>
      {hi ? (
        <p className="flex flex-wrap gap-x-3 gap-y-1 px-3 pt-2 font-mono text-xs tabular-nums text-ink/70">
          <span>O {fmtPx(hi.o)}</span>
          <span>H {fmtPx(hi.h)}</span>
          <span>L {fmtPx(hi.l)}</span>
          <span>C {fmtPx(hi.c)}</span>
          <span>V {fmtSz(hi.v)}</span>
        </p>
      ) : null}
      {view.length === 0 ? <p className="px-3 py-6 text-sm text-ink/60">{lang === "zh" ? "K线还在读池子。" : "Reading the pool candles."}</p> : null}
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-64 w-full lg:h-96"
        role="img"
        aria-label="BEM trace chart"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          const x = ((ev.clientX - rect.left) / rect.width) * VB_W;
          const idx = Math.floor((x - PAD.l) / slot);
          if (idx >= 0 && idx < view.length) setHover(idx);
          else setHover(null);
        }}
      >
        {ticks.map((p) => (
          <g key={p}>
            <line
              x1={PAD.l}
              x2={VB_W - PAD.r}
              y1={y(p)}
              y2={y(p)}
              stroke="var(--color-gold)"
              strokeOpacity="0.25"
            />
            <text x={VB_W - PAD.r + 6} y={y(p) + 4} fill="var(--color-ink)" fontSize="11" fontFamily="IBM Plex Mono, monospace">
              {fmtPx(p)}
            </text>
          </g>
        ))}
        {last ? (
          <line
            x1={PAD.l}
            x2={VB_W - PAD.r}
            y1={y(last.c)}
            y2={y(last.c)}
            stroke="var(--color-gold)"
            strokeDasharray="4 4"
          />
        ) : null}
        {view.map((candle, i) => {
          const x = PAD.l + i * slot + slot * 0.2;
          const w = Math.max(1.5, slot * 0.6);
          const up = candle.c >= candle.o;
          const y1 = y(Math.max(candle.o, candle.c));
          const y2 = y(Math.min(candle.o, candle.c));
          const body = Math.max(1, y2 - y1);
          const cx = x + w / 2;
          const vh = (candle.v / maxV) * innerH * 0.14;
          return (
            <g key={`${candle.t}-${i}`}>
              <line
                x1={cx}
                x2={cx}
                y1={y(candle.h)}
                y2={y(candle.l)}
                stroke={up ? "var(--color-gold)" : "var(--color-sell)"}
                strokeWidth="1"
              />
              <rect
                x={x}
                y={y1}
                width={w}
                height={body}
                fill={up ? "var(--color-foil)" : "var(--color-card)"}
                stroke={up ? "var(--color-gold)" : "var(--color-sell)"}
              />
              <rect
                x={x}
                y={PAD.t + priceH + 8 + (innerH * 0.16 - vh)}
                width={w}
                height={vh}
                fill={up ? "var(--color-foil)" : "var(--color-sell)"}
                opacity="0.45"
              />
            </g>
          );
        })}
        {view.length > 1 ? (
          <polyline
            fill="none"
            stroke="var(--color-gold)"
            strokeWidth="1.25"
            points={view.map((candle, i) => `${PAD.l + i * slot + slot * 0.5},${y(candle.c)}`).join(" ")}
          />
        ) : null}
      </svg>
    </section>
  );
}
