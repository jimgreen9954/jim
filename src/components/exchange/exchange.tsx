import { useEffect, useState } from "react";
import { copy } from "@/lib/copy";
import { startPersistence, useExchange } from "@/lib/exchange-store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/format";
import { equity, sessionChange } from "@/lib/match-engine";
import { Blotter } from "@/components/exchange/blotter";
import { Book } from "@/components/exchange/book";
import { TraceChart } from "@/components/exchange/chart";
import { DiePanel } from "@/components/exchange/die";
import { Ticket } from "@/components/exchange/ticket";
import { LiveBoard } from "@/components/exchange/live-board";
import { RealPerp } from "@/components/exchange/real-perp";
import { SpotDesk } from "@/components/exchange/spot-desk";
import { TransistorDesk } from "@/components/exchange/transistor-desk";
import { ConnectButton, WalletBar } from "@/components/exchange/wallet-bar";
import { Whitepaper } from "@/components/exchange/whitepaper";
import { KNOWN_PERP, KNOWN_XPERP } from "@/lib/perp";
import { bemPrice } from "@/lib/bsc";
import { XLAYER } from "@/lib/xlayer";

type Pane = "spot" | "paper" | "perp" | "gate" | "wafer" | "brief";

export function Exchange() {
  const [pane, setPane] = useState<Pane>("spot");
  return (
    <div className="min-h-screen overflow-x-hidden bg-paper text-ink">
      <Crops />
      <SimClock />
      <BannerToast />
      <FuseFlash />
      <div className={`mx-auto flex max-w-6xl flex-col gap-4 px-3 pt-4 lg:px-6 ${pane === "paper" ? "pb-24 lg:pb-10" : "pb-8"}`}>
        <Header pane={pane} setPane={setPane} />
        {pane === "spot" ? <SpotDesk /> : null}
        {pane === "paper" ? <PaperFloor /> : null}
        {pane === "perp" ? <RealPerp /> : null}
        {pane === "gate" ? <TransistorDesk /> : null}
        {pane === "wafer" ? <WaferFloor /> : null}
        {pane === "brief" ? <Whitepaper /> : null}
        <NextStep pane={pane} setPane={setPane} />
        <SiteFoot />
      </div>
      {pane === "paper" ? <MobileNav /> : null}
    </div>
  );
}

function Crops() {
  return (
    <div aria-hidden>
      <span className="crop crop-tl" />
      <span className="crop crop-tr" />
      <span className="crop crop-bl" />
      <span className="crop crop-br" />
    </div>
  );
}

function SimClock() {
  const tick = useExchange((s) => s.tick);
  const follow = useExchange((s) => s.setChainBem);
  useEffect(() => {
    const stop = startPersistence();
    const id = window.setInterval(() => tick(400), 400);
    let dead = false;
    let pending = false;
    const pull = () => {
      if (pending) return;
      pending = true;
      bemPrice()
        .then((text) => {
          const n = Number(text.replace(/,/g, ""));
          if (!dead && n > 0) follow(n);
        })
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };
    pull();
    const priceId = window.setInterval(pull, 1000);
    return () => {
      dead = true;
      window.clearInterval(id);
      window.clearInterval(priceId);
      stop();
    };
  }, [tick, follow]);
  return null;
}

function BannerToast() {
  const banner = useExchange((s) => s.banner);
  const clear = useExchange((s) => s.clearBanner);
  const lang = useExchange((s) => s.lang);
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => clear(), 2800);
    return () => window.clearTimeout(id);
  }, [banner, clear]);
  if (!banner || banner.key === "liq") return null;
  const text = copy[lang].banners[banner.key] ?? banner.key;
  return (
    <p className="fixed inset-x-3 top-4 z-50 mx-auto max-w-md border border-gold bg-card px-3 py-2 text-center text-sm shadow-plate">
      {text}
    </p>
  );
}

function FuseFlash() {
  const liqSeq = useExchange((s) => s.liqSeq);
  const lang = useExchange((s) => s.lang);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (liqSeq === 0) return;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), 1800);
    return () => window.clearTimeout(id);
  }, [liqSeq]);
  if (!on) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div className="sweep h-1 bg-sell" />
      <p className="mx-auto mt-3 w-fit bg-sell px-4 py-2 text-sm text-paper">{copy[lang].banners.liq}</p>
    </div>
  );
}

function Header({ pane, setPane }: { pane: Pane; setPane: (pane: Pane) => void }) {
  const lang = useExchange((s) => s.lang);
  const setLang = useExchange((s) => s.setLang);
  const reset = useExchange((s) => s.reset);
  const c = copy[lang];
  const [arm, setArm] = useState(false);
  useEffect(() => {
    if (!arm) return;
    const id = window.setTimeout(() => setArm(false), 2800);
    return () => window.clearTimeout(id);
  }, [arm]);
  const tabs = [
    ["spot", c.deskSpot, c.chainSpot],
    ["paper", c.deskPaper, c.chainPaper],
    ["perp", c.deskPerp, c.chainPerp],
    ["gate", c.deskGate, c.chainGate],
    ["wafer", c.deskWafer, c.chainWafer],
    ["brief", c.deskBrief, c.chainBrief],
  ] as const;
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/mark.jpg" alt="" className="size-14 shrink-0 border border-gold object-cover" />
          <div className="min-w-0">
            <p className="text-xs tracking-widest text-gold">{c.kicker}</p>
            <h1 className="font-display text-4xl italic leading-none">TAPELIQUID</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="min-h-11 border border-gold px-3" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang === "zh" ? "EN" : "中文"}
          </button>
          <ConnectButton />
          {pane === "paper" ? (
            <button
              type="button"
              className={`min-h-11 border px-3 ${arm ? "border-sell text-sell" : "border-gold"}`}
              onClick={() => {
                if (!arm) setArm(true);
                else {
                  reset();
                  setArm(false);
                }
              }}
            >
              {arm ? c.resetArm : c.reset}
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-3 border border-gold sm:grid-cols-6">
        {tabs.map(([id, label, hint]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPane(id)}
            className={`min-h-14 px-3 text-left ${pane === id ? "bg-ink text-paper" : "bg-card"}`}
          >
            <span className="block text-sm">{label}</span>
            <span className={`block text-xs ${pane === id ? "text-paper/70" : "text-gold"}`}>{hint}</span>
          </button>
        ))}
      </div>
    </header>
  );
}

function NextStep({ pane, setPane }: { pane: Pane; setPane: (pane: Pane) => void }) {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const order: Pane[] = ["spot", "paper", "perp", "gate", "wafer", "brief"];
  const labels = [c.deskSpot, c.deskPaper, c.deskPerp, c.deskGate, c.deskWafer, c.deskBrief];
  const index = order.indexOf(pane);
  const next = order[(index + 1) % order.length];
  return (
    <button type="button" className="min-h-12 border border-gold px-3 text-left" onClick={() => setPane(next)}>
      <span className="block text-xs tracking-widest text-gold">{c.nextStep}</span>
      <span className="text-sm">{labels[(index + 1) % order.length]}</span>
    </button>
  );
}

function SiteFoot() {
  const lang = useExchange((s) => s.lang);
  return (
    <footer className="border border-gold/40 px-3 py-3 text-xs leading-relaxed text-ink/70">
      <p>{copy[lang].sharedBook}</p>
      <p className="mt-1 break-all font-mono">BSC {KNOWN_PERP}</p>
      <p className="mt-3">{copy[lang].sharedBookX}</p>
      <p className="mt-1 break-all font-mono">{KNOWN_XPERP ? `X Layer ${KNOWN_XPERP}` : copy[lang].xOpen}</p>
      {KNOWN_XPERP ? (
        <a className="mt-1 inline-block underline decoration-gold underline-offset-4" href={`${XLAYER.explorer}/address/${KNOWN_XPERP}`} target="_blank" rel="noreferrer">
          OKLink
        </a>
      ) : null}
    </footer>
  );
}

function PaperFloor() {
  const lang = useExchange((s) => s.lang);
  return (
    <>
      <p className="text-sm text-ink/70">{copy[lang].paperNote}</p>
      <div className="grid items-start gap-4 lg:grid-cols-12">
        <aside className="hidden lg:col-span-4 lg:block">
          <div className="lg:sticky lg:top-4">
            <DiePanel />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          <MarketBar />
          <TraceChart />
          <Tape />
          <div className="hidden gap-4 lg:grid lg:grid-cols-2">
            <Ticket />
            <Book />
          </div>
          <div className="hidden lg:block">
            <Blotter />
          </div>
          <div className="lg:hidden">
            <MobilePane />
          </div>
        </div>
      </div>
    </>
  );
}

function WaferFloor() {
  return (
    <>
      <WalletBar />
      <LiveBoard />
      <DiePanel />
    </>
  );
}

function MarketBar() {
  const lang = useExchange((s) => s.lang);
  const market = useExchange((s) => s.market);
  const setMarket = useExchange((s) => s.setMarket);
  const engine = useExchange((s) => s.engine);
  const c = copy[lang];
  const change = sessionChange(engine);
  const text = engine.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [whole, frac = "00"] = text.split(".");
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMarket("spot")}
          className={`min-h-14 border border-gold px-3 text-left ${market === "spot" ? "bg-foil" : "bg-card"}`}
        >
          <span className="block text-xs tracking-widest">{c.spotSub}</span>
          <span className="font-display text-2xl italic">{c.spot}</span>
        </button>
        <button
          type="button"
          onClick={() => setMarket("perp")}
          className={`min-h-14 border border-gold px-3 text-left ${market === "perp" ? "bg-foil" : "bg-card"}`}
        >
          <span className="block text-xs tracking-widest">
            {c.perpSub} · 20×
          </span>
          <span className="font-display text-2xl italic">{c.perp}</span>
        </button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-gold">{c.mark}</p>
          <p className="font-mono leading-none tabular-nums text-ink">
            <span className="text-4xl">{whole}</span>
            <span className="text-lg">.{frac}</span>
          </p>
          <p className={`mt-1 font-mono text-sm tabular-nums ${change >= 0 ? "text-gold" : "text-sell"}`}>{fmtPct(change)}</p>
        </div>
        <div className="text-right font-mono text-xs tabular-nums">
          <p>
            {c.equity} {fmtUsd(equity(engine))}
          </p>
          <p className="mt-1">
            {c.funding} {fmtPct(engine.funding)}
          </p>
          <p className="mt-1 text-ink/60">{c.fundingHint}</p>
        </div>
      </div>
    </section>
  );
}

function Tape() {
  const prints = useExchange((s) => s.engine.prints);
  return (
    <div className="flex gap-4 overflow-hidden border border-gold/40 bg-card px-3 py-2">
      {prints.map((p) => (
        <span key={p.id} className={`shrink-0 font-mono text-xs tabular-nums ${p.side === "buy" ? "text-gold" : "text-sell"} ${p.mine ? "underline" : ""}`}>
          {fmtPx(p.price)}
        </span>
      ))}
    </div>
  );
}

function MobilePane() {
  const pane = useExchange((s) => s.pane);
  if (pane === "book") return <Book />;
  if (pane === "holds") return <Blotter />;
  if (pane === "die") return <DiePanel />;
  return <Ticket />;
}

function MobileNav() {
  const pane = useExchange((s) => s.pane);
  const setPane = useExchange((s) => s.setPane);
  const lang = useExchange((s) => s.lang);
  const pos = useExchange((s) => s.engine.position);
  const c = copy[lang];
  const items = [
    ["trade", c.trade],
    ["book", c.book],
    ["holds", c.holds],
    ["die", c.die],
  ] as const;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-gold bg-paper lg:hidden">
      {items.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setPane(id)}
          className={`relative min-h-12 text-sm ${pane === id ? "bg-foil text-ink" : "text-ink"}`}
        >
          {label}
          {id === "holds" && pos && pos.size !== 0 ? <span className="absolute top-2 right-5 size-2 bg-sell" /> : null}
        </button>
      ))}
    </nav>
  );
}
