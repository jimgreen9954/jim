import { useEffect, useState, type PointerEvent } from "react";
import { readBias, type Bias } from "@/lib/bias";
import { fmtPct, fmtPx, fmtSz } from "@/lib/format";

export type Bar = { t?: number; o: number; h: number; l: number; c: number; v?: number };

type Pt = { t: number; p: number };
type Tool = "look" | "line" | "zone";
type Grip = "move" | "a" | "b" | "ab" | "ba";
type Stroke = { kind: "line" | "zone"; a: Pt; b: Pt; color: string };
type Drag = { i: number; mode: Grip; origin: Pt; a: Pt; b: Pt };

const PAINTS = ["#14110d", "#6e5014", "#e4c56b", "#9e1b12", "#1f6b45", "#1d4e89"];

const VB_W = 860;
const VB_H = 420;
const PAD = { l: 8, r: 76, t: 10, b: 22 };
const PRICE_H = 292;
const VOL_TOP = PAD.t + PRICE_H + 16;

function sma(rows: Bar[], n: number): Array<number | null> {
  return rows.map((_, i) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let k = 0; k < n; k += 1) sum += rows[i - k].c;
    return sum / n;
  });
}

function pathOf(values: Array<number | null>, x: (i: number) => number, y: (p: number) => number): string {
  let d = "";
  values.forEach((value, i) => {
    if (value == null) return;
    d += `${values[i - 1] == null ? "M" : "L"}${x(i).toFixed(1)},${y(value).toFixed(1)} `;
  });
  return d;
}

function clock(t: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Singapore",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(t * 1000);
}

export function Kline({
  bars,
  entry = 0,
  mark = 0,
  lang,
  desk = "tape",
}: {
  bars: Bar[];
  entry?: number;
  mark?: number;
  lang: "zh" | "en";
  desk?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [py, setPy] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("look");
  const [ink, setInk] = useState<Stroke[]>([]);
  const [draft, setDraft] = useState<Pt | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [paint, setPaint] = useState(PAINTS[1]);
  const [ready, setReady] = useState(false);
  const [biasOn, setBiasOn] = useState(false);
  const [bias, setBias] = useState<Bias | null>(null);
  const [biasBusy, setBiasBusy] = useState(false);
  const rows = bars.slice(-100);
  const lastT = rows.at(-1)?.t ?? 0;
  const zh = lang === "zh";

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`tapeliquid-ink-${desk}`);
      const parsed = saved ? (JSON.parse(saved) as Stroke[]) : [];
      setInk(
        Array.isArray(parsed)
          ? parsed.flatMap((item) =>
              item && (item.kind === "line" || item.kind === "zone") && item.a && item.b
                ? [{ ...item, color: PAINTS.includes(item.color) ? item.color : PAINTS[0] }]
                : [],
            )
          : [],
      );
      setBiasOn(window.localStorage.getItem("tapeliquid-bias") === "1");
    } catch {
      setInk([]);
    }
    setDraft(null);
    setPicked(null);
    setDrag(null);
    setReady(true);
  }, [desk]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(`tapeliquid-ink-${desk}`, JSON.stringify(ink));
  }, [desk, ink, ready]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem("tapeliquid-bias", biasOn ? "1" : "0");
  }, [biasOn, ready]);

  useEffect(() => {
    if (!biasOn || rows.length < 8) return;
    let dead = false;
    const pull = () => {
      setBiasBusy(true);
      readBias({
        data: {
          lang,
          bars: rows.slice(-36).map((bar) => ({ o: bar.o, h: bar.h, l: bar.l, c: bar.c })),
        },
      })
        .then((next) => {
          if (!dead) setBias(next);
        })
        .catch(() => {
          if (!dead) setBias({ side: "flat", p: 0, why: "" });
        })
        .finally(() => {
          if (!dead) setBiasBusy(false);
        });
    };
    pull();
    const id = window.setInterval(pull, 120_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [biasOn, lang, lastT]);

  if (!rows.length) return null;

  const ma7 = sma(rows, 7);
  const ma25 = sma(rows, 25);
  const lows = rows.map((bar) => bar.l);
  const highs = rows.map((bar) => bar.h);
  let lo = Math.min(...lows);
  let hi = Math.max(...highs);
  const band = Math.max(hi - lo, hi * 0.004, 1e-8);
  for (const extra of [entry, mark]) {
    if (extra > 0 && extra > lo - band * 0.12 && extra < hi + band * 0.12) {
      lo = Math.min(lo, extra);
      hi = Math.max(hi, extra);
    }
  }
  const pad = Math.max(hi - lo, hi * 0.002) * 0.08;
  lo -= pad;
  hi += pad;
  const span = hi - lo || 1;
  const innerW = VB_W - PAD.l - PAD.r;
  const n = rows.length;
  const slot = innerW / n;
  const y = (p: number) => PAD.t + ((hi - p) / span) * PRICE_H;
  const x = (i: number) => PAD.l + i * slot + slot * 0.5;
  const maxV = Math.max(...rows.map((bar) => bar.v ?? 0), 1);
  const last = rows[n - 1];
  const idx = hover ?? n - 1;
  const focus = rows[idx];
  const prev = idx > 0 ? rows[idx - 1].c : focus.o;
  const chg = focus.c - prev;
  const upLast = last.c >= last.o;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + (hi - lo) * (1 - t));
  const crossY = py != null && py >= PAD.t && py <= PAD.t + PRICE_H ? py : y(focus.c);
  const crossP = hi - ((crossY - PAD.t) / PRICE_H) * span;

  const guides = [
    entry > 0 ? { p: entry, label: zh ? "开仓" : "Entry", dash: "4 3", color: "var(--color-gold)" } : null,
    mark > 0 ? { p: mark, label: zh ? "标记" : "Mark", dash: "1 3", color: "var(--color-ink)" } : null,
  ].filter((item): item is { p: number; label: string; dash: string; color: string } => item != null && item.p >= lo && item.p <= hi);

  const times = rows.some((bar) => bar.t)
    ? [0, Math.floor(n / 2), n - 1].filter((value, i, all) => all.indexOf(value) === i)
    : [];

  const xAt = (t: number) => {
    const first = rows[0]?.t;
    const end = rows[n - 1]?.t;
    if (first == null || end == null) return x(Math.min(n - 1, Math.max(0, t)));
    if (t <= first) return x(0);
    if (t >= end) return x(n - 1);
    for (let i = 1; i < n; i += 1) {
      const a = rows[i - 1].t ?? 0;
      const b = rows[i].t ?? a;
      if (t <= b) return x(i - 1) + ((x(i) - x(i - 1)) * (t - a)) / (b - a || 1);
    }
    return x(n - 1);
  };

  const ptFrom = (ev: PointerEvent<SVGSVGElement>, loose = false): Pt | null => {
    const rect = ev.currentTarget.getBoundingClientRect();
    let px = ((ev.clientX - rect.left) / rect.width) * VB_W;
    let yy = ((ev.clientY - rect.top) / rect.height) * VB_H;
    const outside = px < PAD.l || px > VB_W - PAD.r || yy < PAD.t || yy > PAD.t + PRICE_H;
    if (outside && !loose) return null;
    px = Math.min(VB_W - PAD.r, Math.max(PAD.l, px));
    yy = Math.min(PAD.t + PRICE_H, Math.max(PAD.t, yy));
    const f = (px - PAD.l) / slot - 0.5;
    const i = Math.min(n - 2, Math.max(0, Math.floor(f)));
    const frac = n < 2 ? 0 : f - i;
    const t0 = rows[Math.max(0, i)].t ?? i;
    const t1 = rows[Math.min(n - 1, i + 1)].t ?? t0 + 1;
    return { t: t0 + (t1 - t0) * Math.min(1, Math.max(0, frac)), p: hi - ((yy - PAD.t) / PRICE_H) * span };
  };

  const boxOf = (ev: PointerEvent<SVGSVGElement>) => {
    const rect = ev.currentTarget.getBoundingClientRect();
    return {
      px: ((ev.clientX - rect.left) / rect.width) * VB_W,
      yy: ((ev.clientY - rect.top) / rect.height) * VB_H,
    };
  };

  const near = (px: number, yy: number, cx: number, cy: number) => (px - cx) ** 2 + (yy - cy) ** 2 < 16 ** 2;

  const hit = (px: number, yy: number): { i: number; mode: Grip } | null => {
    for (let i = ink.length - 1; i >= 0; i -= 1) {
      const stroke = ink[i];
      const ax = xAt(stroke.a.t);
      const ay = y(stroke.a.p);
      const bx = xAt(stroke.b.t);
      const by = y(stroke.b.p);
      if (i === picked) {
        if (near(px, yy, ax, ay)) return { i, mode: "a" };
        if (near(px, yy, bx, by)) return { i, mode: "b" };
        if (stroke.kind === "zone") {
          if (near(px, yy, ax, by)) return { i, mode: "ab" };
          if (near(px, yy, bx, ay)) return { i, mode: "ba" };
        }
      }
      if (stroke.kind === "line") {
        const dx = bx - ax;
        const dy = by - ay;
        const len = dx * dx + dy * dy || 1;
        const u = Math.min(1, Math.max(0, ((px - ax) * dx + (yy - ay) * dy) / len));
        const dist = (px - (ax + dx * u)) ** 2 + (yy - (ay + dy * u)) ** 2;
        if (dist < 14 ** 2) return { i, mode: "move" };
      } else {
        const left = Math.min(ax, bx);
        const right = Math.max(ax, bx);
        const top = Math.min(ay, by);
        const bottom = Math.max(ay, by);
        if (px >= left && px <= right && yy >= top && yy <= bottom) return { i, mode: "move" };
      }
    }
    return null;
  };

  const lean = bias?.side === "long" ? (zh ? "看多" : "Long") : bias?.side === "short" ? (zh ? "看空" : "Short") : zh ? "不明显" : "Unclear";

  return (
    <div className={biasOn ? "lg:grid lg:grid-cols-[minmax(0,1fr)_13rem]" : ""}>
      <div>
      <div className="flex flex-col gap-2 border-b border-gold/30 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex border border-gold">
            {(
              [
                ["look", zh ? "看" : "Look"],
                ["line", zh ? "线" : "Line"],
                ["zone", zh ? "块" : "Zone"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTool(id);
                  setDraft(null);
                }}
                className={`min-h-9 px-3 text-xs ${tool === id ? "bg-ink text-paper" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setInk((list) => list.slice(0, -1))} className="min-h-9 px-2 text-xs text-ink/70">
              {zh ? "撤销" : "Undo"}
            </button>
            <button
              type="button"
              disabled={picked == null}
              onClick={() => {
                setInk((list) => list.filter((_, i) => i !== picked));
                setPicked(null);
              }}
              className="min-h-9 px-2 text-xs disabled:opacity-30"
            >
              {zh ? "删除" : "Delete"}
            </button>
            <button type="button" onClick={() => setInk([])} className="min-h-9 px-2 text-xs text-ink/70">
              {zh ? "清空" : "Clear"}
            </button>
            <button
              type="button"
              onClick={() => setBiasOn((on) => !on)}
              className={`min-h-9 border px-2 text-xs ${biasOn ? "border-ink bg-ink text-paper" : "border-gold"}`}
            >
              {biasOn ? (zh ? "收起倾向" : "Hide") : zh ? "倾向" : "Lean"}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {PAINTS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              onClick={() => {
                setPaint(color);
                if (picked == null) return;
                setInk((list) => list.map((stroke, i) => (i === picked ? { ...stroke, color } : stroke)));
              }}
              className={`size-5 ${paint === color ? "ring-2 ring-ink ring-offset-2 ring-offset-card" : ""}`}
              style={{ background: color }}
            />
          ))}
          <span className="ml-auto text-xs text-ink/50">
            {draft
              ? zh
                ? "再点一次"
                : "Tap again"
              : tool === "look"
                ? zh
                  ? "拖动画线，拖圆点改形状"
                  : "Drag to move, dots to reshape"
                : zh
                  ? "点两次"
                  : "Two taps"}
          </span>
        </div>
      </div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 pt-2 font-mono text-xs tabular-nums">
        <span className={chg >= 0 ? "text-gold" : "text-sell"}>
          {chg >= 0 ? "+" : ""}
          {fmtPx(chg)} {fmtPct(prev ? chg / prev : 0)}
        </span>
        <span>O {fmtPx(focus.o)}</span>
        <span>H {fmtPx(focus.h)}</span>
        <span>L {fmtPx(focus.l)}</span>
        <span>C {fmtPx(focus.c)}</span>
        {focus.v != null ? <span>V {fmtSz(focus.v)}</span> : null}
        {ma7[idx] != null ? <span className="text-gold">MA7 {fmtPx(ma7[idx])}</span> : null}
        {ma25[idx] != null ? <span className="text-ink/60">MA25 {fmtPx(ma25[idx])}</span> : null}
        {focus.t ? <span className="text-ink/50">{clock(focus.t)} SGT</span> : null}
      </p>
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-72 w-full touch-none lg:h-96"
        role="img"
        aria-label="BEM candlestick chart"
        onPointerLeave={() => {
          setHover(null);
          setPy(null);
        }}
        onPointerMove={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          const px = ((ev.clientX - rect.left) / rect.width) * VB_W;
          const next = Math.floor((px - PAD.l) / slot);
          setHover(next >= 0 && next < n ? next : null);
          setPy(((ev.clientY - rect.top) / rect.height) * VB_H);
          if (!drag) return;
          const pt = ptFrom(ev, true);
          if (!pt) return;
          setInk((list) =>
            list.map((stroke, i) => {
              if (i !== drag.i) return stroke;
              if (drag.mode === "move") {
                return {
                  ...stroke,
                  a: { t: drag.a.t + pt.t - drag.origin.t, p: drag.a.p + pt.p - drag.origin.p },
                  b: { t: drag.b.t + pt.t - drag.origin.t, p: drag.b.p + pt.p - drag.origin.p },
                };
              }
              if (drag.mode === "a") return { ...stroke, a: pt };
              if (drag.mode === "b") return { ...stroke, b: pt };
              if (drag.mode === "ab") return { ...stroke, a: { t: pt.t, p: stroke.a.p }, b: { t: stroke.b.t, p: pt.p } };
              return { ...stroke, a: { t: stroke.a.t, p: pt.p }, b: { t: pt.t, p: stroke.b.p } };
            }),
          );
        }}
        onPointerUp={() => setDrag(null)}
        onPointerDown={(ev) => {
          if (tool === "look") {
            const { px, yy } = boxOf(ev);
            const found = hit(px, yy);
            if (!found) {
              setPicked(null);
              return;
            }
            const stroke = ink[found.i];
            const pt = ptFrom(ev, true);
            if (!stroke || !pt) return;
            setPicked(found.i);
            setDrag({ i: found.i, mode: found.mode, origin: pt, a: stroke.a, b: stroke.b });
            ev.currentTarget.setPointerCapture(ev.pointerId);
            return;
          }
          const pt = ptFrom(ev);
          if (!pt) return;
          if (!draft) setDraft(pt);
          else {
            setInk((list) => [...list, { kind: tool, a: draft, b: pt, color: paint }]);
            setPicked(ink.length);
            setDraft(null);
          }
        }}
      >
        {ticks.map((p) => (
          <g key={p}>
            <line x1={PAD.l} x2={VB_W - PAD.r} y1={y(p)} y2={y(p)} stroke="var(--color-gold)" strokeOpacity="0.18" />
            <text x={VB_W - 4} y={y(p) + 3} textAnchor="end" fill="var(--color-ink)" fontSize="11" fontFamily="IBM Plex Mono, monospace">
              {fmtPx(p)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={VB_W - PAD.r} y1={VOL_TOP - 8} y2={VOL_TOP - 8} stroke="var(--color-gold)" strokeOpacity="0.35" />
        {guides.map((guide) => (
          <g key={guide.label}>
            <line x1={PAD.l} x2={VB_W - PAD.r} y1={y(guide.p)} y2={y(guide.p)} stroke={guide.color} strokeDasharray={guide.dash} strokeOpacity="0.8" />
            <text x={PAD.l + 2} y={y(guide.p) - 3} fill={guide.color} fontSize="10" fontFamily="IBM Plex Mono, monospace">
              {guide.label} {fmtPx(guide.p)}
            </text>
          </g>
        ))}
        <path d={pathOf(ma25, x, y)} fill="none" stroke="var(--color-ink)" strokeOpacity="0.45" strokeWidth="1.25" />
        <path d={pathOf(ma7, x, y)} fill="none" stroke="var(--color-gold)" strokeWidth="1.25" />
        {rows.map((bar, i) => {
          const up = bar.c >= bar.o;
          const color = up ? "var(--color-gold)" : "var(--color-sell)";
          const bodyW = Math.max(1.4, slot * 0.68);
          const left = x(i) - bodyW / 2;
          const top = y(Math.max(bar.o, bar.c));
          const body = Math.max(1, Math.abs(y(bar.o) - y(bar.c)));
          const vh = ((bar.v ?? 0) / maxV) * 62;
          return (
            <g key={`${bar.t ?? i}-${i}`}>
              <line x1={x(i)} x2={x(i)} y1={y(bar.h)} y2={y(bar.l)} stroke={color} strokeWidth="1" />
              <rect x={left} y={top} width={bodyW} height={body} fill={up ? "var(--color-card)" : color} stroke={color} />
              {bar.v != null ? <rect x={left} y={VOL_TOP + 62 - vh} width={bodyW} height={vh} fill={color} opacity="0.4" /> : null}
            </g>
          );
        })}
        {ink.map((stroke, i) => {
          const x1 = xAt(stroke.a.t);
          const x2 = xAt(stroke.b.t);
          const y1 = y(stroke.a.p);
          const y2 = y(stroke.b.p);
          if (stroke.kind === "line") {
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke.color}
                strokeWidth={i === picked ? 2.4 : 1.6}
              />
            );
          }
          return (
            <rect
              key={i}
              x={Math.min(x1, x2)}
              y={Math.min(y1, y2)}
              width={Math.abs(x2 - x1)}
              height={Math.abs(y2 - y1)}
              fill={stroke.color}
              fillOpacity="0.16"
              stroke={stroke.color}
              strokeWidth={i === picked ? 2 : 1}
            />
          );
        })}
        {picked != null && ink[picked] ? (
          <>
            {[
              [ink[picked].a.t, ink[picked].a.p],
              [ink[picked].b.t, ink[picked].b.p],
              ...(ink[picked].kind === "zone"
                ? [
                    [ink[picked].a.t, ink[picked].b.p],
                    [ink[picked].b.t, ink[picked].a.p],
                  ]
                : []),
            ].map(([t, p]) => (
              <circle key={`${t}-${p}`} cx={xAt(t)} cy={y(p)} r="5" fill="var(--color-card)" stroke={ink[picked].color} strokeWidth="2" />
            ))}
          </>
        ) : null}
        {draft ? <circle cx={xAt(draft.t)} cy={y(draft.p)} r="3" fill="var(--color-gold)" /> : null}
        {hover != null && tool === "look" ? (
          <>
            <line x1={x(idx)} x2={x(idx)} y1={PAD.t} y2={VB_H - PAD.b} stroke="var(--color-ink)" strokeOpacity="0.35" strokeDasharray="2 3" />
            <line x1={PAD.l} x2={VB_W - PAD.r} y1={crossY} y2={crossY} stroke="var(--color-ink)" strokeOpacity="0.35" strokeDasharray="2 3" />
          </>
        ) : null}
        <rect x={VB_W - PAD.r + 2} y={y(last.c) - 8} width={PAD.r - 4} height={16} fill={upLast ? "var(--color-gold)" : "var(--color-sell)"} />
        <text x={VB_W - 6} y={y(last.c) + 4} textAnchor="end" fill="var(--color-paper)" fontSize="11" fontFamily="IBM Plex Mono, monospace">
          {fmtPx(last.c)}
        </text>
        {hover != null ? (
          <>
            <rect x={VB_W - PAD.r + 2} y={crossY - 8} width={PAD.r - 4} height="16" fill="var(--color-ink)" />
            <text x={VB_W - 6} y={crossY + 4} textAnchor="end" fill="var(--color-paper)" fontSize="11" fontFamily="IBM Plex Mono, monospace">
              {fmtPx(crossP)}
            </text>
          </>
        ) : null}
        {times.map((i) =>
          rows[i]?.t ? (
            <text key={i} x={x(i)} y={VB_H - 6} textAnchor="middle" fill="var(--color-ink)" fontSize="10" fontFamily="IBM Plex Mono, monospace">
              {clock(rows[i].t as number)}
            </text>
          ) : null,
        )}
      </svg>
      </div>
      {biasOn ? (
        <aside className="border-t border-gold/30 bg-paper/60 p-4 lg:border-t-0 lg:border-l">
          <p className="text-xs tracking-widest text-gold">{zh ? "模型倾向" : "Model lean"}</p>
          <p className={`mt-3 font-display text-4xl italic leading-none ${bias?.side === "short" ? "text-sell" : "text-gold"}`}>
            {biasBusy && !bias ? (zh ? "在看" : "Reading") : lean}
          </p>
          {bias && bias.p > 0 ? <p className="mt-2 font-mono text-sm tabular-nums">{bias.p}</p> : null}
          {bias?.why ? <p className="mt-3 text-sm leading-relaxed">{bias.why}</p> : null}
          <p className="mt-3 text-xs leading-relaxed text-ink/50">
            {zh ? "不是标记价，不保证下一根。约两分钟重看。" : "Not the mark. Not a promise. Rechecked about every two minutes."}
          </p>
        </aside>
      ) : null}
    </div>
  );
}
