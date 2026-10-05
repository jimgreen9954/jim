import { useEffect, useRef, useState, type PointerEvent } from "react";
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
const PRICE_H = 276;
const VOL_TOP = PAD.t + PRICE_H + 14;
const VOL_H = 78;

function sma(rows: Bar[], n: number): Array<number | null> {
  return rows.map((_, i) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let k = 0; k < n; k += 1) {
      const close = rows[i - k]?.c;
      if (!Number.isFinite(close)) return null;
      sum += close;
    }
    return sum / n;
  });
}

function vma(rows: Bar[], n: number): Array<number | null> {
  return rows.map((_, i) => {
    if (i < n - 1) return null;
    let sum = 0;
    for (let k = 0; k < n; k += 1) {
      const vol = rows[i - k]?.v;
      if (!Number.isFinite(vol)) return null;
      sum += vol as number;
    }
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
  const ms = t > 1e12 ? t : t * 1000;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const bit = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${bit("year")}-${bit("month")}-${bit("day")} ${bit("hour")}:${bit("minute")}:${bit("second")}`;
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
  const dragRef = useRef<Drag | null>(null);
  const [paint, setPaint] = useState(PAINTS[1]);
  const [ready, setReady] = useState(false);
  const [biasOn, setBiasOn] = useState(false);
  const [bias, setBias] = useState<Bias | null>(null);
  const [biasBusy, setBiasBusy] = useState(false);
  const [zoom, setZoom] = useState(48);
  const [edge, setEdge] = useState(0);
  const [lock, setLock] = useState<{ lo: number; hi: number } | null>(null);
  const panRef = useRef<{ x: number; edge: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const all = bars.filter((bar) => bar && Number.isFinite(bar.o) && Number.isFinite(bar.h) && Number.isFinite(bar.l) && Number.isFinite(bar.c)).slice(-300);
  const lastT = all.at(-1)?.t ?? 0;
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
    dragRef.current = null;
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
    if (!biasOn || bars.length < 8) return;
    let dead = false;
    const pull = () => {
      setBiasBusy(true);
      readBias({
        data: {
          lang,
          bars: bars.flatMap((bar) =>
            bar && Number.isFinite(bar.c) ? [{ o: bar.o, h: bar.h, l: bar.l, c: bar.c }] : [],
          ).slice(-36),
        },
      })
        .then((next) => {
          if (!dead) setBias(next);
        })
        .catch(() => {
          if (!dead) setBias({ side: "flat", price: 0, why: "" });
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
  }, ["bem-price", biasOn, lang, lastT]);

  const lenRef = useRef(0);
  lenRef.current = all.length;
  const plotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (ev.deltaY === 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      setZoom((value) => {
        const next = value * Math.exp(ev.deltaY * 0.0016);
        const cap = Math.max(8, lenRef.current || 8);
        return Math.min(cap, Math.max(8, Math.round(next)));
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [all.length]);

  if (!all.length) return null;
  const viewCount = Math.min(all.length, Math.max(8, zoom));
  const maxEdge = Math.max(0, all.length - viewCount);
  const shownEdge = Math.min(Math.max(0, edge), maxEdge);
  const startFloat = Math.max(0, all.length - shownEdge - viewCount);
  const start = Math.floor(startFloat);
  const slip = startFloat - start;
  const rows = all.slice(start, Math.min(all.length, Math.ceil(startFloat + viewCount))).filter((bar) => Number.isFinite(bar?.c));
  if (!rows.length) return null;

  const ma7 = sma(all, 7).slice(start, start + rows.length);
  const ma25 = sma(all, 25).slice(start, start + rows.length);
  const volMa = vma(all, 20).slice(start, start + rows.length);
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
  if (lock) {
    lo = Math.min(lo, lock.lo);
    hi = Math.max(hi, lock.hi);
  }
  const span = hi - lo || 1;
  const innerW = VB_W - PAD.l - PAD.r;
  const n = rows.length;
  const slot = innerW / viewCount;
  const y = (p: number) => PAD.t + ((hi - p) / span) * PRICE_H;
  const x = (i: number) => PAD.l + (i - slip) * slot + slot * 0.5;
  const maxV = Math.max(...rows.map((bar) => bar.v ?? 0), 1);
  const safeIdx = hover != null && hover >= 0 && hover < n ? hover : n - 1;
  const focus = rows[safeIdx] ?? rows[n - 1];
  const last = rows[n - 1] ?? focus;
  const earlier = safeIdx > 0 ? rows[safeIdx - 1] : undefined;
  if (!focus || !last) return null;
  const prev = earlier?.c ?? focus.o;
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
    if (first == null || end == null || end === first) return x(0);
    return x(0) + ((t - first) / (end - first)) * (x(n - 1) - x(0));
  };

  const ptFrom = (ev: PointerEvent<SVGSVGElement>, loose = false): Pt | null => {
    const rect = ev.currentTarget.getBoundingClientRect();
    let px = ((ev.clientX - rect.left) / rect.width) * VB_W;
    let yy = ((ev.clientY - rect.top) / rect.height) * VB_H;
    const outside = px < PAD.l || px > VB_W - PAD.r || yy < PAD.t || yy > PAD.t + PRICE_H;
    if (outside && !loose) return null;
    px = Math.min(VB_W - PAD.r, Math.max(PAD.l, px));
    yy = Math.min(PAD.t + PRICE_H, Math.max(PAD.t, yy));
    const f = (px - PAD.l) / slot + slip - 0.5;
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

  const near = (px: number, yy: number, cx: number, cy: number) => (px - cx) ** 2 + (yy - cy) ** 2 < 28 ** 2;

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
        if (dist < 28 ** 2) return { i, mode: "move" };
      } else {
        const left = Math.min(ax, bx);
        const right = Math.max(ax, bx);
        const top = Math.min(ay, by);
        const bottom = Math.max(ay, by);
        const inside = px >= left - 14 && px <= right + 14 && yy >= top - 14 && yy <= bottom + 14;
        const onFrame = px <= left + 14 || px >= right - 14 || yy <= top + 14 || yy >= bottom - 14;
        if (inside && onFrame) return { i, mode: "move" };
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
            <button type="button" onClick={() => setZoom((value) => Math.max(8, Math.round(value * 0.7)))} className="min-h-9 border border-gold px-3 text-xs">
              {zh ? "放大" : "In"}
            </button>
            <button type="button" onClick={() => setZoom((value) => Math.min(Math.max(8, all.length), Math.round(value * 1.4)))} className="min-h-9 border border-gold px-3 text-xs">
              {zh ? "缩小" : "Out"}
            </button>
            <button type="button" onClick={() => { setZoom(48); setEdge(0); }} className="min-h-9 border border-gold px-3 text-xs">
              {zh ? "最新" : "Now"}
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
              : zh
                ? "空白处左右拖。滚轮或放大缩小改柱子。"
                : "Drag empty space. Wheel or the buttons zoom."}
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
        {focus.v != null ? (
          <span>
            V {fmtSz(focus.v)}
            {volMa[safeIdx] != null ? ` MA20 ${fmtSz(volMa[safeIdx])} ${focus.v >= (volMa[safeIdx] ?? 0) ? (zh ? "放量" : "Up") : zh ? "缩量" : "Down"}` : ""}
          </span>
        ) : null}
        {ma7[safeIdx] != null ? <span className="text-gold">MA7 {fmtPx(ma7[safeIdx])}</span> : null}
        {ma25[safeIdx] != null ? <span className="text-ink/60">MA25 {fmtPx(ma25[safeIdx])}</span> : null}
        {focus.t && focus.t > 1e9 ? <span className="text-ink">新加坡 {clock(focus.t)}</span> : null}
      </p>
      <div ref={plotRef} className="relative">
      <div className="flex items-center gap-2 px-3 pb-1 text-xs">
        <span className="font-mono tabular-nums text-ink/60">{zh ? `${viewCount} 根` : `${viewCount}`}</span>
        {focus.t && focus.t > 1e9 ? <span className="bg-ink px-2 py-0.5 font-mono text-paper">新加坡 {clock(focus.t)}</span> : null}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="h-72 w-full touch-none overflow-hidden lg:h-96"
        overflow="hidden"
        style={{ cursor: tool === "look" ? "grab" : "crosshair" }}
        role="img"
        aria-label="BEM candlestick chart"
        onPointerLeave={() => {
          setHover(null);
          setPy(null);
        }}
        onPointerMove={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          const px = ((ev.clientX - rect.left) / rect.width) * VB_W;
          const panning = panRef.current;
          if (panning) {
            const shift = (px - panning.x) / slot;
            setEdge(Math.min(maxEdge, Math.max(0, panning.edge + shift)));
          }
          const next = Math.floor((px - PAD.l) / slot + slip);
          setHover(next >= 0 && next < n ? next : null);
          setPy(((ev.clientY - rect.top) / rect.height) * VB_H);
          if (panning) return;
          const moving = dragRef.current;
          if (!moving) return;
          const pt = ptFrom(ev, true);
          if (!pt) return;
          setInk((list) =>
            list.map((stroke, i) => {
              if (i !== moving.i) return stroke;
              if (moving.mode === "move") {
                return {
                  ...stroke,
                  a: { t: moving.a.t + pt.t - moving.origin.t, p: moving.a.p + pt.p - moving.origin.p },
                  b: { t: moving.b.t + pt.t - moving.origin.t, p: moving.b.p + pt.p - moving.origin.p },
                };
              }
              if (moving.mode === "a") return { ...stroke, a: pt };
              if (moving.mode === "b") return { ...stroke, b: pt };
              if (moving.mode === "ab") return { ...stroke, a: { t: pt.t, p: stroke.a.p }, b: { t: stroke.b.t, p: pt.p } };
              return { ...stroke, a: { t: stroke.a.t, p: pt.p }, b: { t: pt.t, p: stroke.b.p } };
            }),
          );
        }}
        onPointerUp={() => {
          dragRef.current = null;
          panRef.current = null;
          setLock(null);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          panRef.current = null;
          setLock(null);
        }}
        onPointerDown={(ev) => {
          const { px, yy } = boxOf(ev);
          const found = draft ? null : hit(px, yy);
          if (found) {
            const stroke = ink[found.i];
            const pt = ptFrom(ev, true);
            if (!stroke || !pt) return;
            dragRef.current = { i: found.i, mode: found.mode, origin: pt, a: { ...stroke.a }, b: { ...stroke.b } };
            setPicked(found.i);
            setTool("look");
            ev.currentTarget.setPointerCapture(ev.pointerId);
            return;
          }
          if (tool === "look") {
            panRef.current = { x: px, edge: shownEdge };
            setLock({ lo, hi });
            setPicked(null);
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
            setTool("look");
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
        <line x1={PAD.l} x2={VB_W - PAD.r} y1={VOL_TOP - 6} y2={VOL_TOP - 6} stroke="var(--color-gold)" strokeOpacity="0.35" />
        <path d={pathOf(volMa, x, (v) => VOL_TOP + VOL_H - Math.sqrt(Math.max(0, v) / maxV) * VOL_H)} fill="none" stroke="var(--color-ink)" strokeOpacity="0.7" strokeWidth="1.25" />
        <text x={VB_W - 6} y={VOL_TOP + 11} textAnchor="end" fill="var(--color-ink)" fontSize="10" fontFamily="IBM Plex Mono, monospace">
          {fmtSz(focus.v ?? last.v ?? 0)}
        </text>
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
          if (!bar || !Number.isFinite(bar.c) || !Number.isFinite(bar.o)) return null;
          const up = bar.c >= bar.o;
          const color = up ? "var(--color-gold)" : "var(--color-sell)";
          const bodyW = Math.max(1.4, slot * 0.68);
          const left = x(i) - bodyW / 2;
          const top = y(Math.max(bar.o, bar.c));
          const body = Math.max(1, Math.abs(y(bar.o) - y(bar.c)));
          const vol = bar.v ?? 0;
          const vh = Math.sqrt(vol / maxV) * VOL_H;
          const hot = i === safeIdx;
          const avg = volMa[i];
          return (
            <g key={`${bar.t ?? i}-${i}`}>
              <line x1={x(i)} x2={x(i)} y1={y(bar.h)} y2={y(bar.l)} stroke={color} strokeWidth="1" />
              <rect x={left} y={top} width={bodyW} height={body} fill={up ? "var(--color-card)" : color} stroke={color} />
              {bar.v != null ? (
                <rect
                  x={left}
                  y={VOL_TOP + VOL_H - vh}
                  width={bodyW}
                  height={vh}
                  fill={color}
                  opacity={hot ? 0.95 : avg != null && vol >= avg * 1.8 ? 0.8 : 0.4}
                />
              ) : null}
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
            <line x1={x(safeIdx)} x2={x(safeIdx)} y1={PAD.t} y2={VB_H - PAD.b} stroke="var(--color-ink)" strokeOpacity="0.35" strokeDasharray="2 3" />
            <line x1={PAD.l} x2={VB_W - PAD.r} y1={crossY} y2={crossY} stroke="var(--color-ink)" strokeOpacity="0.35" strokeDasharray="2 3" />
          </>
        ) : null}
        {hover != null && rows[safeIdx]?.t && (rows[safeIdx].t as number) > 1e9 ? (
          <g>
            <rect x={Math.max(PAD.l, Math.min(x(safeIdx) - 107, VB_W - PAD.r - 214))} y={PAD.t + 18} width="214" height="18" fill="var(--color-ink)" />
            <text x={Math.max(PAD.l, Math.min(x(safeIdx) - 107, VB_W - PAD.r - 214)) + 8} y={PAD.t + 31} fill="var(--color-paper)" fontSize="12" fontFamily="IBM Plex Mono, monospace">
              {clock(rows[safeIdx].t as number)}
            </text>
          </g>
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
              {clock(rows[i].t as number).slice(5, 16)}
            </text>
          ) : null,
        )}
      </svg>
      </div>
      </div>
      {biasOn ? (
        <aside className="border-t border-gold/30 bg-paper/60 p-4 lg:border-t-0 lg:border-l">
          <p className="text-xs tracking-widest text-gold">{zh ? "模型倾向" : "Model lean"}</p>
          <p className={`mt-3 font-display text-4xl italic leading-none ${bias?.side === "short" ? "text-sell" : "text-gold"}`}>
            {biasBusy && !bias ? (zh ? "在看" : "Reading") : lean}
          </p>
          {(() => {
            const spot = all[all.length - 1]?.c ?? 0;
            const guess = bias && bias.price > 0 && spot > 0 && Math.abs(bias.price - spot) / spot <= 0.04 ? bias.price : 0;
            return (
              <>
                <p className="mt-3 font-mono text-2xl tabular-nums">{guess > 0 ? fmtPx(guess) : "—"}</p>
                <p className="mt-1 text-xs tracking-widest text-gold">{zh ? "预测的 BEM 价格" : "Guessed BEM price"}</p>
                <p className="mt-1 font-mono text-xs tabular-nums text-ink/60">{zh ? `现价 ${fmtPx(spot)}` : `Now ${fmtPx(spot)}`}</p>
              </>
            );
          })()}
          {bias?.why ? <p className="mt-3 text-sm leading-relaxed">{bias.why}</p> : null}
          <p className="mt-3 text-xs leading-relaxed text-ink/50">
            {zh
              ? "预测价必须贴着现价，离现价超过 4% 的数字，比如 65，不会显示。这不是标记价，也不保证下一根会到。约两分钟重看。"
              : "The guess has to stay within 4% of the live price. A figure like 65 is dropped. It is not the mark, and it does not promise the next candle. Rechecked about every two minutes."}
          </p>
        </aside>
      ) : null}
    </div>
  );
}
