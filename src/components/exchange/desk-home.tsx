import { Component, lazy, Suspense, type ReactNode, useEffect, useRef, useState } from "react";
import { ArriveHint } from "@/components/exchange/phone-desk";
import { PoolSpot } from "@/components/exchange/pool-spot";
import { useExchange } from "@/lib/exchange-store";
import type { DeskView } from "@/components/exchange/desk-chrome";
import { currentAccount, onAccount } from "@/lib/wallet";

const RedGift = lazy(() => import("@/components/exchange/red-gift").then((mod) => ({ default: mod.RedGift })));

const MarketSheet = lazy(() => import("@/components/exchange/desk-chrome").then((mod) => ({ default: mod.MarketSheet })));

const RealPerp = lazy(() => import("@/components/exchange/real-perp").then((mod) => ({ default: mod.RealPerp })));
const SpotDesk = lazy(() => import("@/components/exchange/spot-desk").then((mod) => ({ default: mod.SpotDesk })));
const TapeTerminal = lazy(() => import("@/components/exchange/tape-terminal").then((mod) => ({ default: mod.TapeTerminal })));

let held: DeskView = { kind: "tape", market: 0 };
let wantLp = false;

export function rememberDesk(next: DeskView) {
  held = next;
  wantLp = false;
}

export function rememberLp() {
  held = { kind: "pancake", pair: "bem" };
  wantLp = true;
}

export function DeskHome({ desk, onDesk }: { desk: "spot" | "perp"; onDesk: (next: "spot" | "perp") => void }) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [view, setView] = useState<DeskView>(held);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<"all" | "perp" | "spot">("spot");
  const [lp, setLp] = useState(wantLp);

  useEffect(() => {
    const onHome = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const next: DeskView = detail === "tape-perp" || detail === "perp"
        ? (held.kind === "perp" ? held : { kind: "perp", chain: "xlayer", coin: "bem" })
        : { kind: "tape", market: 0 };
      held = next;
      wantLp = false;
      setView(next);
      setLp(false);
      setOpen(false);
    };
    const onLp = () => {
      const next: DeskView = { kind: "pancake", pair: "bem" };
      held = next;
      wantLp = true;
      setView(next);
      setLp(true);
    };
    window.addEventListener("tape-home", onHome);
    window.addEventListener("tape-lp", onLp);
    const onMarkets = () => {
      setSheet(desk === "perp" ? "perp" : "spot");
      setOpen(true);
    };
    window.addEventListener("tape-markets", onMarkets);
    return () => {
      window.removeEventListener("tape-home", onHome);
      window.removeEventListener("tape-lp", onLp);
      window.removeEventListener("tape-markets", onMarkets);
    };
  }, [desk]);

  const pick = (next: DeskView) => {
    held = next;
    wantLp = false;
    setView(next);
    setLp(false);
    setOpen(false);
    const side = next.kind === "perp" ? "perp" : "spot";
    onDesk(side);
    const url = `#${side}`;
    if (window.location.hash !== url) {
      window.history.replaceState(null, "", url);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    onDesk(side);
    window.dispatchEvent(new CustomEvent("tape-chart"));
  };

  const showPerp = desk === "perp" || view.kind === "perp";
  const pool = !showPerp && view.kind === "tape" && view.market === 0;
  const book = !showPerp && (view.kind === "otc" || (view.kind === "tape" && view.market !== 0));
  const showCake = !showPerp && view.kind === "pancake";
  const launch = view.kind === "perp" ? view : { kind: "perp" as const, chain: "bsc" as const, coin: "bem" as const };

  return (
    <>
      <ArriveHint zh={zh} />
      {showPerp ? (
        <Suspense fallback={null}>
        <DeskGuard key={`${launch.chain}-${launch.coin}`} reset={`${launch.chain}-${launch.coin}`}>
        <RealPerp
          key={`${launch.chain}-${launch.coin}`}
          launch={{ chain: launch.chain, coin: launch.coin }}
          onMarkets={() => { setSheet("perp"); setOpen(true); }}
        />
        </DeskGuard>
        </Suspense>
      ) : null}
      {pool ? (
        <PoolSpot
          pair={view.kind === "tape" ? view.pair ?? "usdt" : "usdt"}
          onPair={(next) => {
            const picked: DeskView = { kind: "tape", market: 0, pair: next };
            held = picked;
            setView(picked);
          }}
          onMarkets={() => { setSheet("spot"); setOpen(true); }}
          onOtc={() => setView({ kind: "otc", market: 0 })}
          onJump={pick}
        />
      ) : null}
      {book ? (
        <Suspense fallback={null}>
        <TapeTerminal
          market={view.kind === "otc" || view.kind === "tape" ? view.market : 0}
          otc={view.kind === "otc"}
          onMarkets={() => { setSheet("spot"); setOpen(true); }}
        />
        </Suspense>
      ) : null}
      {showCake ? (
        <Suspense fallback={null}>
        <SpotDesk focus={view.kind === "pancake" ? view.pair : "bem"} openLp={lp} onMarkets={() => { setSheet("spot"); setOpen(true); }} />
        </Suspense>
      ) : null}
      {open ? (
        <Suspense fallback={null}>
          <MarketSheet zh={zh} initial={sheet} onClose={() => setOpen(false)} onPick={pick} />
        </Suspense>
      ) : null}
    </>
  );
}

export function RedPocket() {
  const zh = useExchange((s) => s.lang) === "zh";
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [until, setUntil] = useState(0);
  const [live, setLive] = useState(false);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    let stop = false;
    const look = () => {
      void import("@/lib/red-packet").then(({ readRed }) => Promise.all([
        readRed("xlayer", null, "official"),
        readRed("bsc", null, "official"),
        readRed("xlayer", null, "volunteer"),
        readRed("bsc", null, "volunteer"),
      ])).then((rows) => {
        if (stop) return;
        const next = rows.map((row) => Number(row.endsAt)).filter((t) => t * 1000 > Date.now()).sort((a, b) => a - b)[0] ?? 0;
        setUntil(next);
        setLive(next > 0);
      }).catch(() => undefined);
    };
    let id = 0;
    const wait = window.setTimeout(() => {
      look();
      id = window.setInterval(look, 20_000);
    }, 2_500);
    return () => {
      stop = true;
      window.clearTimeout(wait);
      window.clearInterval(id);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <>
      <PacketMark zh={zh} live={live} until={until} onOpen={() => setOpen(true)} />
      {open ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 sm:items-center" onClick={() => setOpen(false)}>
          <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden bg-card text-ink shadow-plate" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="text-base text-ink">{zh ? "红包" : "Packet"}</span>
              <button type="button" className="grid h-11 w-11 place-items-center text-2xl leading-none text-ink" aria-label={zh ? "关闭" : "Close"} onClick={() => setOpen(false)}>×</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
              <Suspense fallback={null}>
                <RedGift account={account} zh={zh} forceOpen onIdle={() => setOpen(false)} />
              </Suspense>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

function PacketMark({ zh, live, until, onOpen }: { zh: boolean; live: boolean; until: number; onOpen: () => void }) {
  const [at, setAt] = useState(() => {
    try {
      const raw = localStorage.getItem("tl-pouch-pos");
      if (raw) {
        const saved = JSON.parse(raw) as { x?: number; y?: number };
        if (typeof saved.x === "number" && typeof saved.y === "number") return { x: saved.x, y: saved.y };
      }
    } catch { /* ignore */ }
    return { x: 8, y: 58 };
  });
  const [left, setLeft] = useState(0);
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  useEffect(() => {
    if (!live) return;
    const tick = () => setLeft(Math.max(0, until * 1000 - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [live, until]);

  const place = (x: number, y: number) => ({
    x: Math.min(Math.max(4, x), Math.max(4, window.innerWidth - 72)),
    y: Math.min(Math.max(4, y), Math.max(4, window.innerHeight - 56)),
  });

  return (
    <button
      type="button"
      aria-label={zh ? "红包锦囊" : "Red packet"}
      className="fixed z-[80] w-16 touch-none active:scale-95"
      style={{ left: at.x, top: at.y }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: at.x, y: at.y, px: event.clientX, py: event.clientY, moved: false };
      }}
      onPointerMove={(event) => {
        const hold = drag.current;
        if (!hold) return;
        const dx = event.clientX - hold.px;
        const dy = event.clientY - hold.py;
        if (Math.abs(dx) + Math.abs(dy) > 4) hold.moved = true;
        setAt(place(hold.x + dx, hold.y + dy));
      }}
      onPointerUp={() => {
        const hold = drag.current;
        drag.current = null;
        if (!hold) return;
        if (!hold.moved) onOpen();
        else setAt((now) => {
          try { localStorage.setItem("tl-pouch-pos", JSON.stringify(now)); } catch { /* ignore */ }
          return now;
        });
      }}
    >
      <svg viewBox="0 0 32 36" className="mx-auto h-8 w-8 drop-shadow" aria-hidden="true">
        <rect x="4" y="8" width="24" height="24" rx="2" fill="#8c1c1c" />
        <path d="M4 16h24" stroke="#e6c36a" strokeWidth="2" />
        <path d="M16 8v24" stroke="#e6c36a" strokeWidth="2" />
        <path d="M8 8c3-5 13-5 16 0" fill="#6e1212" stroke="#e6c36a" strokeWidth="1.4" />
      </svg>
      {live ? <span className="mt-0.5 block text-center font-mono text-[10px] leading-none text-[#e6c36a]">{clock(left)}</span> : null}
    </button>
  );
}

class DeskGuard extends Component<{ children: ReactNode; reset: string }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() {
    return { bad: true };
  }
  componentDidUpdate(prev: { reset: string }) {
    if (prev.reset !== this.props.reset && this.state.bad) this.setState({ bad: false });
  }
  render() {
    if (!this.state.bad) return this.props.children;
    return (
      <section className="border border-gold bg-card px-4 py-8">
        <button type="button" className="mt-3 h-10 bg-ink px-3 text-sm" onClick={() => this.setState({ bad: false })}>再打开</button>
      </section>
    );
  }
}
