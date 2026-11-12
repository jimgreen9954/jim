import { Component, lazy, Suspense, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArriveHint } from "@/components/exchange/phone-desk";
import { HomeBooks } from "@/components/exchange/home-books";
import { PoolSpot } from "@/components/exchange/pool-spot";
import { useExchange } from "@/lib/exchange-store";
import type { DeskView } from "@/components/exchange/desk-chrome";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectBsc } from "@/lib/bsc";
import { LOCK_TOKENS, lockLeft, revokeLock } from "@/lib/fee-pack";
import { selectDesk, type Desk } from "@/lib/perp";

const RedGift = lazy(() =>
  import("@/components/exchange/red-gift").then((mod) => ({ default: mod.RedGift })),
);

const MarketSheet = lazy(() =>
  import("@/components/exchange/desk-chrome").then((mod) => ({ default: mod.MarketSheet })),
);

const RealPerp = lazy(() =>
  import("@/components/exchange/real-perp").then((mod) => ({ default: mod.RealPerp })),
);
const SpotDesk = lazy(() =>
  import("@/components/exchange/spot-desk").then((mod) => ({ default: mod.SpotDesk })),
);
const TapeTerminal = lazy(() =>
  import("@/components/exchange/tape-terminal").then((mod) => ({ default: mod.TapeTerminal })),
);
const HashSpot = lazy(() =>
  import("@/components/exchange/share-spot").then((mod) => ({ default: mod.HashSpot })),
);

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

export function openOtcDesk() {
  held = { kind: "otc", market: 0 };
  wantLp = false;
}

export function deskChain(view: DeskView): Desk {
  if (view.kind === "perp") return view.chain;
  if (view.kind === "tape" || view.kind === "otc" || view.kind === "hash") return "xlayer";
  if (view.kind === "pancake" && (view.pair === "okb" || view.pair === "bemokb" || view.pair === "fab")) return "xlayer";
  return "bsc";
}

export function sisterView(view: DeskView, side: "spot" | "perp"): DeskView {
  if (side === "perp") {
    if (view.kind === "perp") return view;
    if (view.kind === "pancake" && view.pair === "fab") return { kind: "perp", chain: "xlayer", coin: "fab" };
    return { kind: "perp", chain: "xlayer", coin: "bem" };
  }
  if (view.kind === "perp" && view.coin === "fab") return { kind: "pancake", pair: "fab" };
  if (view.kind === "perp") return { kind: "tape", market: 0 };
  return view;
}

export function viewOnChain(view: DeskView, chain: Desk): DeskView {
  if (deskChain(view) === chain) return view;
  if (view.kind === "perp") {
    if (view.coin === "bem") return { kind: "perp", chain, coin: "bem" };
    if (view.coin === "fab" || view.coin === "tape")
      return chain === "xlayer" ? { kind: "perp", chain: "xlayer", coin: view.coin } : { kind: "perp", chain: "bsc", coin: "bem" };
    if (chain === "xlayer") return { kind: "perp", chain: "xlayer", coin: "bem" };
    if (view.coin === "btc" || view.coin === "eth" || view.coin === "zec" || view.coin === "up")
      return { kind: "perp", chain: "bsc", coin: view.coin };
    return { kind: "perp", chain: "bsc", coin: "bem" };
  }
  if (chain === "xlayer") {
    if (view.kind === "hash") return view;
    if (view.kind === "pancake" && view.pair === "fab") return { kind: "pancake", pair: "fab" };
    if (view.kind === "pancake" && (view.pair === "bem" || view.pair === "bembnb"))
      return { kind: "pancake", pair: "bemokb" };
    if (view.kind === "pancake" && view.pair === "bnb") return { kind: "pancake", pair: "okb" };
    return { kind: "tape", market: 0, pair: "usdt" };
  }
  if (view.kind === "pancake" && view.pair === "fab") return { kind: "pancake", pair: "bem" };
  if (view.kind === "pancake" && view.pair === "bemokb") return { kind: "pancake", pair: "bem" };
  if (view.kind === "pancake" && view.pair === "okb") return { kind: "pancake", pair: "bnb" };
  return { kind: "pancake", pair: "bem" };
}

export function jumpChain(chain: Desk): DeskView {
  const next = viewOnChain(held, chain);
  held = next;
  wantLp = false;
  selectDesk(chain);
  window.dispatchEvent(new CustomEvent("tape-chain", { detail: next }));
  window.dispatchEvent(new CustomEvent("tape-desk-chain", { detail: chain }));
  return next;
}

function announceChain(view: DeskView) {
  const chain = deskChain(view);
  selectDesk(chain);
  window.dispatchEvent(new CustomEvent("tape-desk-chain", { detail: chain }));
}

export function RevokeLocks({ zh }: { zh: boolean }) {
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [open, setOpen] = useState<number[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    if (!account) return;
    let dead = false;
    Promise.all(LOCK_TOKENS.map((row) => lockLeft(row.chainId, account, row.token).catch(() => 0n))).then((rows) => {
      if (!dead) setOpen(rows.flatMap((n, i) => (n > 0n ? [i] : [])));
    });
    return () => {
      dead = true;
    };
  }, [account]);
  if (account && open.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border border-sell px-3 py-2 text-xs">
      <span className="text-sell">{zh ? "取消这个合约的授权" : "Revoke this contract"}</span>
      {account
        ? open.map((i) => {
            const row = LOCK_TOKENS[i];
            const chain = row.chainId === 56 ? "BSC" : "X";
            return (
              <button
                key={`${row.chainId}-${row.token}`}
                type="button"
                className="min-h-9 border border-sell px-2 text-sell"
                disabled={busy !== null}
                onClick={() => {
                  setBusy(i);
                  setNote(null);
                  void (async () => {
                    try {
                      await revokeLock(account, row.chainId, row.token);
                      setOpen((rows) => rows.filter((n) => n !== i));
                      setNote(zh ? "已取消" : "Revoked");
                    } catch {
                      setNote(zh ? "没取消" : "Not revoked");
                    } finally {
                      setBusy(null);
                    }
                  })();
                }}
              >
                {busy === i ? "…" : `${chain} ${row.name}`}
              </button>
            );
          })
        : (
          <button
            type="button"
            className="min-h-9 border border-sell px-2 text-sell"
            onClick={() => {
              void connectBsc().then(setAccount).catch(() => setNote(zh ? "没连上" : "Not connected"));
            }}
          >
            {zh ? "连接钱包" : "Connect"}
          </button>
        )}
      {note ? <span>{note}</span> : null}
    </div>
  );
}

export function DeskHome({
  desk,
  onDesk,
}: {
  desk: "spot" | "perp";
  onDesk: (next: "spot" | "perp") => void;
}) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [view, setView] = useState<DeskView>(held);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<"all" | "perp" | "spot">("spot");
  const [lp, setLp] = useState(wantLp);

  useEffect(() => {
    const onHome = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      const next = sisterView(held, detail === "tape-perp" || detail === "perp" ? "perp" : "spot");
      held = next;
      wantLp = false;
      setView(next);
      setLp(false);
      setOpen(false);
      announceChain(next);
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
    const onChain = (event: Event) => {
      const next = (event as CustomEvent<DeskView>).detail;
      if (!next || typeof next !== "object" || !("kind" in next)) return;
      held = next;
      wantLp = false;
      setView(next);
      setLp(false);
      setOpen(false);
      onDesk(next.kind === "perp" ? "perp" : "spot");
    };
    window.addEventListener("tape-chain", onChain);
    const onOtc = () => {
      const next: DeskView = { kind: "otc", market: 0 };
      held = next;
      wantLp = false;
      setView(next);
      setLp(false);
      setOpen(false);
      announceChain(next);
    };
    window.addEventListener("tape-otc", onOtc);
    if (desk === "perp" && held.kind !== "perp") {
      held = sisterView(held, "perp");
      setView(held);
    }
    if (desk === "spot" && held.kind === "perp") {
      held = sisterView(held, "spot");
      wantLp = false;
      setView(held);
      setLp(false);
    }
    announceChain(held);
    return () => {
      window.removeEventListener("tape-home", onHome);
      window.removeEventListener("tape-lp", onLp);
      window.removeEventListener("tape-markets", onMarkets);
      window.removeEventListener("tape-chain", onChain);
      window.removeEventListener("tape-otc", onOtc);
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
    window.dispatchEvent(new CustomEvent("tape-trade"));
    announceChain(next);
  };

  const showPerp = desk === "perp";
  const pool = !showPerp && view.kind === "tape" && view.market === 0;
  const book = !showPerp && (view.kind === "otc" || (view.kind === "tape" && view.market !== 0));
  const hash = !showPerp && view.kind === "hash";
  const launch =
    view.kind === "perp"
      ? view
      : { kind: "perp" as const, chain: "bsc" as const, coin: "bem" as const };

  return (
    <>
      <HomeBooks zh={zh} />
      <ArriveHint zh={zh} />
      {showPerp ? (
        <Suspense fallback={null}>
          <DeskGuard
            key={`${launch.chain}-${launch.coin}`}
            reset={`${launch.chain}-${launch.coin}`}
          >
            <RealPerp
              key={`${launch.chain}-${launch.coin}`}
              launch={{ chain: launch.chain, coin: launch.coin }}
              onJump={pick}
              onMarkets={() => {
                setSheet("perp");
                setOpen(true);
              }}
            />
          </DeskGuard>
        </Suspense>
      ) : null}
      {pool ? (
        <PoolSpot
          pair={view.kind === "tape" ? (view.pair ?? "usdt") : "usdt"}
          onPair={(next) => {
            const picked: DeskView = { kind: "tape", market: 0, pair: next };
            held = picked;
            setView(picked);
          }}
          onMarkets={() => {
            setSheet("spot");
            setOpen(true);
          }}
          onOtc={() => setView({ kind: "otc", market: 0 })}
          onJump={pick}
        />
      ) : null}
      {book ? (
        <Suspense fallback={null}>
          <TapeTerminal
            market={view.kind === "otc" || view.kind === "tape" ? view.market : 0}
            otc={view.kind === "otc"}
            onMarkets={() => {
              setSheet("spot");
              setOpen(true);
            }}
          />
        </Suspense>
      ) : null}
      {hash ? (
        <Suspense fallback={null}>
          <HashSpot
            zh={zh}
            onJump={pick}
            onMarkets={() => {
              setSheet("spot");
              setOpen(true);
            }}
          />
        </Suspense>
      ) : null}
      {!showPerp && view.kind === "pancake" ? (
        <Suspense fallback={null}>
          <SpotDesk
            focus={view.kind === "pancake" ? view.pair : "bem"}
            openLp={lp}
            onJump={pick}
            onMarkets={() => {
              setSheet("spot");
              setOpen(true);
            }}
          />
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
    const openIt = () => setOpen(true);
    window.addEventListener("tape-open-red", openIt);
    return () => window.removeEventListener("tape-open-red", openIt);
  }, []);
  useEffect(() => {
    let stop = false;
    const look = () => {
      void import("@/lib/red-packet")
        .then(({ readRed }) =>
          Promise.all([
            readRed("xlayer", null, "official"),
            readRed("bsc", null, "official"),
            readRed("xlayer", null, "volunteer"),
            readRed("bsc", null, "volunteer"),
          ]),
        )
        .then((rows) => {
          if (stop) return;
          const next =
            rows
              .map((row) => Number(row.endsAt))
              .filter((t) => t * 1000 > Date.now())
              .sort((a, b) => a - b)[0] ?? 0;
          setUntil(next);
          setLive(next > 0);
        })
        .catch(() => undefined);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const [sheetH, setSheetH] = useState<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    const fit = () => setSheetH(Math.max(280, (vv?.height ?? window.innerHeight) - 8));
    fit();
    vv?.addEventListener("resize", fit);
    window.addEventListener("resize", fit);
    return () => {
      vv?.removeEventListener("resize", fit);
      window.removeEventListener("resize", fit);
    };
  }, [open]);
  const openedAt = useRef(0);
  return (
    <>
      <PacketMark
        zh={zh}
        live={live}
        until={until}
        onOpen={() => {
          openedAt.current = Date.now();
          setOpen(true);
        }}
      />
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[130] flex items-end justify-center bg-black/70 sm:items-center"
              onClick={() => {
                if (Date.now() - openedAt.current < 700) return;
                setOpen(false);
              }}
            >
              <div
                className="gift-sheet flex w-full max-w-md flex-col overflow-hidden text-ink"
                style={{
                  height: sheetH ? Math.min(sheetH, 720) : "92dvh",
                  paddingBottom: "env(safe-area-inset-bottom)",
                }}
                onClick={(event) => event.stopPropagation()}
              >
            <div className="flex shrink-0 flex-col items-center px-4 pt-2">
              <span className="mb-2 h-1 w-10 rounded-full bg-gold" />
              <div className="flex w-full items-center justify-between">
                <span className="flex items-center gap-2 text-sm tracking-[0.22em] text-ink">
                  <span className="gift-mark" aria-hidden />
                  {zh ? "红包" : "PACKET"}
                </span>
                <button
                  type="button"
                  className="grid h-11 w-11 place-items-center text-xl leading-none text-ink/70"
                  aria-label={zh ? "关闭" : "Close"}
                  onClick={() => setOpen(false)}
                >
                  ×
                </button>
              </div>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-0 pb-4"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              <Suspense fallback={null}>
                <RedGift account={account} zh={zh} forceOpen onIdle={() => setOpen(false)} />
              </Suspense>
            </div>
          </div>
            </div>,
            document.body,
          )
        : null}
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

function pouchBox(x: number, y: number) {
  const view = window.visualViewport;
  const w = view?.width ?? window.innerWidth;
  const h = view?.height ?? window.innerHeight;
  return {
    x: Math.min(Math.max(4, x), Math.max(4, w - 72)),
    y: Math.min(Math.max(8, y), Math.max(8, h - 108)),
  };
}

function PacketMark({
  zh,
  live,
  until,
  onOpen,
}: {
  zh: boolean;
  live: boolean;
  until: number;
  onOpen: () => void;
}) {
  const [at, setAt] = useState(() => {
    try {
      const raw = localStorage.getItem("tl-pouch-pos");
      if (raw) {
        const saved = JSON.parse(raw) as { x?: number; y?: number };
        if (typeof saved.x === "number" && typeof saved.y === "number")
          return { x: saved.x, y: saved.y };
      }
    } catch {
      /* ignore */
    }
    return { x: 8, y: 58 };
  });
  const [left, setLeft] = useState(0);
  const drag = useRef<{ x: number; y: number; px: number; py: number; at: number } | null>(null);
  const moved = useRef(false);
  const dragged = useRef(false);
  const tapped = useRef(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!live) return;
    const tick = () => setLeft(Math.max(0, until * 1000 - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [live, until]);
  useEffect(() => {
    setReady(true);
    const fit = () => setAt((now) => pouchBox(now.x, now.y));
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, []);

  const openOnce = () => {
    const now = Date.now();
    if (now - tapped.current < 500) return;
    tapped.current = now;
    onOpen();
  };
  const finish = () => {
    const hold = drag.current;
    drag.current = null;
    if (!hold) return;
    if (moved.current) {
      dragged.current = true;
      moved.current = false;
      setAt((now) => {
        const next = pouchBox(now.x, now.y);
        try {
          localStorage.setItem("tl-pouch-pos", JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
      return;
    }
    openOnce();
  };
  const follow = (px: number, py: number) => {
    const hold = drag.current;
    if (!hold) return;
    const dx = px - hold.px;
    const dy = py - hold.py;
    if (Math.hypot(dx, dy) < 8) return;
    moved.current = true;
    setAt(pouchBox(hold.x + dx, hold.y + dy));
  };
  const down = (px: number, py: number) => {
    moved.current = false;
    dragged.current = false;
    drag.current = { x: at.x, y: at.y, px, py, at: Date.now() };
  };

  const mark = (
    <button
      type="button"
      aria-label={zh ? "红包锦囊" : "Red packet"}
      className="pouch-mark fixed z-[120] hidden h-14 w-14 place-items-center lg:grid"
      style={{ left: at.x, top: at.y, touchAction: "none" }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (!drag.current) down(event.clientX, event.clientY);
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* capture can fail if the pointer already ended */
        }
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        event.preventDefault();
        follow(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        finish();
      }}
      onPointerCancel={finish}
      onTouchStart={(event) => {
        if (drag.current) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        down(touch.clientX, touch.clientY);
      }}
      onTouchMove={(event) => {
        const touch = event.changedTouches[0];
        if (!touch || !drag.current) return;
        event.preventDefault();
        follow(touch.clientX, touch.clientY);
      }}
      onTouchEnd={(event) => {
        if (!drag.current) return;
        event.preventDefault();
        finish();
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        openOnce();
      }}
    >
      <svg viewBox="0 0 32 36" className="h-8 w-8 drop-shadow" aria-hidden="true">
        <rect x="4" y="8" width="24" height="24" rx="2" fill="#8c1c1c" />
        <path d="M4 16h24" stroke="#e6c36a" strokeWidth="2" />
        <path d="M16 8v24" stroke="#e6c36a" strokeWidth="2" />
        <path d="M8 8c3-5 13-5 16 0" fill="#6e1212" stroke="#e6c36a" strokeWidth="1.4" />
      </svg>
      {live ? (
        <span className="absolute bottom-1 font-mono text-[10px] leading-none text-[#e6c36a]">
          {clock(left)}
        </span>
      ) : null}
    </button>
  );
  if (!ready || typeof document === "undefined") return mark;
  return createPortal(mark, document.body);
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
        <button
          type="button"
          className="mt-3 h-10 bg-ink px-3 text-sm"
          onClick={() => this.setState({ bad: false })}
        >
          再打开
        </button>
      </section>
    );
  }
}
