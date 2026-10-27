import { Component, type ReactNode, useEffect, useState } from "react";
import { MarketSheet, type DeskView } from "@/components/exchange/desk-chrome";
import { ArriveHint } from "@/components/exchange/phone-desk";
import { RealPerp } from "@/components/exchange/real-perp";
import { SpotDesk } from "@/components/exchange/spot-desk";
import { PoolSpot } from "@/components/exchange/pool-spot";
import { TapeTerminal } from "@/components/exchange/tape-terminal";
import { useExchange } from "@/lib/exchange-store";

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
        ? { kind: "perp", chain: "xlayer", coin: "tape" }
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
  const launch = view.kind === "perp" ? view : { kind: "perp" as const, chain: "xlayer" as const, coin: "tape" as const };

  return (
    <>
      <ArriveHint zh={zh} />
      {showPerp ? (
        <DeskGuard key={`${launch.chain}-${launch.coin}`} reset={`${launch.chain}-${launch.coin}`}>
        <RealPerp
          key={`${launch.chain}-${launch.coin}`}
          launch={{ chain: launch.chain, coin: launch.coin }}
          onMarkets={() => { setSheet("perp"); setOpen(true); }}
        />
        </DeskGuard>
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
        />
      ) : null}
      {book ? (
        <TapeTerminal
          market={view.kind === "otc" || view.kind === "tape" ? view.market : 0}
          otc={view.kind === "otc"}
          onMarkets={() => { setSheet("spot"); setOpen(true); }}
        />
      ) : null}
      {showCake ? (
        <SpotDesk focus={view.kind === "pancake" ? view.pair : "bem"} openLp={lp} onMarkets={() => { setSheet("spot"); setOpen(true); }} />
      ) : null}
      {open ? <MarketSheet zh={zh} initial={sheet} onClose={() => setOpen(false)} onPick={pick} /> : null}
    </>
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
        <p className="text-sm">这一张合约没有打开。行情还在，页面不再停在空白。</p>
        <button type="button" className="mt-3 h-10 bg-ink px-3 text-sm" onClick={() => this.setState({ bad: false })}>再打开</button>
      </section>
    );
  }
}
