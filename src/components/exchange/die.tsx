import { useState } from "react";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { evalMatch, evalStamp } from "@/lib/match-engine";

export function ChipMark({ className, hot }: { className?: string; hot?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className ?? "size-12 text-gold"} aria-hidden>
      <rect x="14" y="14" width="36" height="36" fill="var(--color-card)" stroke="currentColor" strokeWidth="1.4" />
      {Array.from({ length: 4 }, (_, i) => (
        <g key={i}>
          <rect x={18 + i * 8} y="6" width="3" height="8" fill="currentColor" />
          <rect x={18 + i * 8} y="50" width="3" height="8" fill="currentColor" />
          <rect x="6" y={18 + i * 8} width="8" height="3" fill="currentColor" />
          <rect x="50" y={18 + i * 8} width="8" height="3" fill="currentColor" />
        </g>
      ))}
      <rect
        x="24"
        y="24"
        width="16"
        height="16"
        fill={hot ? "var(--color-foil)" : "none"}
        stroke="currentColor"
      />
    </svg>
  );
}

export function DiePanel() {
  const lang = useExchange((s) => s.lang);
  const clock = useExchange((s) => s.engine.clock);
  const inputs = useExchange((s) => s.engine.inputs);
  const target = useExchange((s) => s.engine.target);
  const solved = useExchange((s) => s.engine.solved);
  const taped = useExchange((s) => s.engine.taped);
  const lastMine = useExchange((s) => s.engine.lastMine);
  const flipPad = useExchange((s) => s.flipPad);
  const tap = useExchange((s) => s.tap);
  const c = copy[lang];
  const [bid, setBid] = useState(true);
  const [ask, setAsk] = useState(true);
  const lamp = evalMatch(bid, ask);
  const stampOut = evalStamp(inputs);
  const hot = clock - lastMine < 4;
  const pads = ["A", "B", "C", "D"] as const;

  return (
    <section className="relative overflow-hidden border border-gold bg-card p-4 shadow-plate">
      <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border border-gold/30" />
      <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full border border-dashed border-gold/40" />
      <div className="relative">
        <p className="text-xs tracking-widest text-gold">{c.specimen}</p>
        <div className="mt-3 flex items-center gap-4">
          <DieFace clock={clock} hot={hot} />
          <div>
            <h2 className="font-display text-3xl italic leading-none">TAPELIQUID-7</h2>
            <p className="mt-2 text-xs tracking-widest text-gold">{c.match}</p>
            <p className="mt-1 font-mono text-xs tabular-nums">CLK {String(clock).padStart(6, "0")}</p>
          </div>
        </div>

        <div className="mt-5 border border-gold/40 p-3">
          <p className="text-xs tracking-widest text-gold">{c.probe}</p>
          <p className="mt-1 text-sm leading-relaxed">{c.probeHint}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pad on={bid} label={c.bidPad} onClick={() => setBid((v) => !v)} />
            <Pad on={ask} label={c.askPad} onClick={() => setAsk((v) => !v)} />
            <Lamp on={lamp} label={c.lamp} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink/70">{c.netlistBody}</p>
        </div>

        <div className="mt-4 border border-gold/40 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-2xl italic">{c.seal}</h3>
            <div className="flex gap-1" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-2 w-6 ${i < solved ? "bg-foil" : "border border-gold"}`} />
              ))}
            </div>
          </div>
          {taped ? (
            <div className="mt-4">
              <div className="seal-pop mx-auto grid size-28 place-items-center border-4 border-sell text-sell">
                <div className="text-center">
                  <p className="font-display text-3xl leading-none">{lang === "zh" ? "流片" : "TAPE"}</p>
                  <p className="mt-1 text-xs tracking-widest">07</p>
                </div>
              </div>
              <p className="mt-4 text-center text-sm leading-relaxed">{c.sealDone}</p>
            </div>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed">{c.sealHint}</p>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {pads.map((name, i) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => flipPad(i as 0 | 1 | 2 | 3)}
                    className={`min-h-12 border border-gold font-mono ${inputs[i] ? "bg-foil text-ink" : "bg-card"}`}
                  >
                    {name}
                    <span className="block text-xs">{inputs[i] ? "1" : "0"}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <Lamp on={stampOut} label={c.lamp} />
                <p className="text-sm">
                  {c.target}{" "}
                  <span className={target ? "text-gold" : "text-sell"}>{target ? c.on : c.off}</span>
                </p>
              </div>
              <p className="mt-2 break-all font-mono text-xs text-ink/70">NAND(NAND(A,B), NAND(C,D))</p>
              <button type="button" onClick={tap} className="mt-3 min-h-12 w-full border border-gold bg-ink text-paper">
                {c.stamp}
              </button>
            </>
          )}
        </div>

        <details className="mt-4 border border-gold/40 p-3">
          <summary className="cursor-pointer font-display text-lg italic">{c.brief}</summary>
          <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed">
            <p>{c.briefP1}</p>
            <p>{c.briefP2}</p>
            <p className="text-xs tracking-widest text-gold">{c.reqTitle}</p>
            <ul className="list-disc pl-4">
              <li>{c.req1}</li>
              <li>{c.req2}</li>
              <li>{c.req3}</li>
            </ul>
            <p className="text-ink/70">{c.demo}</p>
            <p className="flex gap-4">
              <a className="underline decoration-gold underline-offset-4" href="https://ignix.bot/x_campaign" target="_blank" rel="noreferrer">
                {c.linkHack}
              </a>
              <a className="underline decoration-gold underline-offset-4" href="https://tapeout.club/" target="_blank" rel="noreferrer">
                {c.linkTape}
              </a>
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function DieFace({ clock, hot }: { clock: number; hot: boolean }) {
  return (
    <svg viewBox="0 0 120 120" className="size-28 shrink-0 text-gold" aria-hidden>
      <rect x="22" y="22" width="76" height="76" fill="var(--color-card)" stroke="currentColor" />
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <rect x={30 + i * 11} y="8" width="4" height="14" fill="currentColor" />
          <rect x={30 + i * 11} y="98" width="4" height="14" fill="currentColor" />
          <rect x="8" y={30 + i * 11} width="14" height="4" fill="currentColor" />
          <rect x="98" y={30 + i * 11} width="14" height="4" fill="currentColor" />
        </g>
      ))}
      {Array.from({ length: 16 }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const on = (clock + i) % 11 < 4 || (hot && i === clock % 16);
        return (
          <rect
            key={i}
            x={34 + col * 14}
            y={34 + row * 14}
            width="10"
            height="10"
            fill={on ? "var(--color-foil)" : "none"}
            stroke="currentColor"
          />
        );
      })}
    </svg>
  );
}

function Pad({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 min-w-16 border border-gold px-3 ${on ? "bg-foil" : "bg-card"}`}>
      {label}
      <span className="ml-1 font-mono text-xs">{on ? "1" : "0"}</span>
    </button>
  );
}

function Lamp({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 px-1">
      <span className={`inline-block size-4 rounded-full border border-gold ${on ? "bg-foil" : "bg-card"}`} />
      <span className="text-sm">
        {label} {on ? "1" : "0"}
      </span>
    </span>
  );
}
