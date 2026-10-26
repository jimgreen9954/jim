import { useEffect, useState } from "react";
import { MarketSheet, type DeskView } from "@/components/exchange/desk-chrome";
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
    return () => {
      window.removeEventListener("tape-home", onHome);
      window.removeEventListener("tape-lp", onLp);
    };
  }, []);

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
  };

  const showPerp = desk === "perp" || view.kind === "perp";
  const pool = !showPerp && view.kind === "tape" && view.market === 0;
  const book = !showPerp && (view.kind === "otc" || (view.kind === "tape" && view.market !== 0));
  const showCake = !showPerp && view.kind === "pancake";
  const launch = view.kind === "perp" ? view : { kind: "perp" as const, chain: "xlayer" as const, coin: "tape" as const };

  return (
    <>
      {showPerp ? (
        <RealPerp
          key={`${launch.chain}-${launch.coin}`}
          launch={{ chain: launch.chain, coin: launch.coin }}
          onMarkets={() => { setSheet("perp"); setOpen(true); }}
        />
      ) : null}
      {pool ? (
        <PoolSpot
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
