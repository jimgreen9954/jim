import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { copy, type Copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { fmtFlex, fmtInt, fmtPct, fmtUsd } from "@/lib/format";
import { getTapeoutLive, type LiveTransistor, type TapeoutLive } from "@/lib/tapeout-live";

type BoardView = "hot" | "all" | "bids";

function fmtTs(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function LiveBoard() {
  const lang = useExchange((s) => s.lang);
  const fills = useExchange((s) => s.engine.fills.length);
  const orders = useExchange((s) => s.engine.orders.length);
  const position = useExchange((s) => s.engine.position);
  const c = copy[lang];
  const [data, setData] = useState<TapeoutLive | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [view, setView] = useState<BoardView>("hot");
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    let timer = 0;
    let tries = 0;
    const pull = () => {
      getTapeoutLive()
        .then((live) => {
          if (dead) return;
          setData(live);
          setFailed(!live.ok);
          if ((!live.ok || !live.bem) && tries < 3) {
            tries += 1;
            timer = window.setTimeout(pull, 4000);
          }
        })
        .catch(() => {
          if (dead) return;
          setFailed(true);
          if (tries < 3) {
            tries += 1;
            timer = window.setTimeout(pull, 4000);
          }
        });
    };
    pull();
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, []);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const query = q.trim().toLowerCase();
    if (query) return all.filter((row) => row.name.toLowerCase().includes(query));
    if (view === "bids") return all.filter((row) => row.trades === 0 && row.bidBnb != null);
    const traded = all.filter((row) => row.trades > 0);
    return view === "all" ? traded : traded.slice(0, 12);
  }, [data, q, view]);

  const held = fills > 0 || orders > 0 || Boolean(position);
  const toggle = (id: string) => setPick((cur) => (cur === id ? null : id));

  return (
    <section className="border border-gold bg-card shadow-plate">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/40 px-3 py-3">
        <div>
          <h2 className="font-display text-2xl italic">{c.liveTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink/80">{c.liveNote}</p>
        </div>
        <a
          className="min-h-11 underline decoration-gold underline-offset-4"
          href="https://tapeout.net/market.json"
          target="_blank"
          rel="noreferrer"
        >
          market.json
        </a>
      </header>

      {!data && !failed ? <p className="px-3 py-4 text-sm">{c.loading}</p> : null}
      {failed && !data?.ok ? <p className="px-3 py-4 text-sm text-sell">{c.liveFail}</p> : null}

      {data?.ok ? (
        <div className="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label={c.bemChain}
              value={data.bem ? fmtUsd(data.bem.usd) : "—"}
              hint={data.bem?.change24 != null ? fmtPct(data.bem.change24) : data.bem ? `$${fmtInt(data.bem.vol24)}` : ""}
              hot={Boolean(data.bem && data.bem.change24 != null && data.bem.change24 < 0)}
            />
            <Stat label="BNB" value={data.bnbUsd ? fmtUsd(data.bnbUsd) : "—"} />
            <Stat
              label={c.miners}
              value={data.pod ? fmtInt(data.pod.miners) : "—"}
              hint={data.pod ? `${fmtInt(data.pod.verified)}` : ""}
            />
            <Stat
              label={c.emission}
              value={data.pod ? `${fmtFlex(data.pod.dailyBem)} BEM` : "—"}
              hint={data.pod ? `BSC ${fmtInt(data.pod.block)}` : ""}
            />
          </div>
          <p className="text-xs text-ink/70">
            {held ? c.heldNote : c.following} {data.traded} {c.withTrades} / {data.listed} · {data.bidding} {c.onlyBids}
          </p>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={c.filter}
            className="w-full border-b border-gold bg-transparent py-2 font-mono outline-none"
            aria-label={c.filter}
          />
          <div className="grid grid-cols-3 gap-2">
            <ViewButton on={view === "hot"} onClick={() => setView("hot")}>
              {c.showLess}
            </ViewButton>
            <ViewButton on={view === "all"} onClick={() => setView("all")}>
              {c.showAll} ({data.traded})
            </ViewButton>
            <ViewButton on={view === "bids"} onClick={() => setView("bids")}>
              {c.onlyBids} ({data.bidding})
            </ViewButton>
          </div>
          <ul className="flex flex-col gap-2 lg:hidden">
            {rows.map((row) => (
              <li key={row.id} className="border border-gold/40">
                <button type="button" className="w-full px-2 py-2 text-left" onClick={() => toggle(row.id)}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-display text-lg italic">{row.name}</span>
                    <span className="text-xs tracking-widest text-gold">{row.kind}</span>
                  </div>
                  <p className="font-mono text-xs tabular-nums">
                    {row.bem != null ? `${fmtFlex(row.bem)} BEM` : "—"} · {row.lastBnb != null ? fmtFlex(row.lastBnb) : "—"} BNB
                    · {c.vol24} {fmtFlex(row.volBnb24)}
                  </p>
                  {row.bidBnb != null ? (
                    <p className="font-mono text-xs tabular-nums text-gold">
                      {c.bid} {fmtFlex(row.bidBnb)} BNB{row.bidBem != null ? ` · ${fmtFlex(row.bidBem)} BEM` : ""}
                    </p>
                  ) : null}
                </button>
                {pick === row.id ? <Tape row={row} c={c} /> : null}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead className="text-gold">
                <tr>
                  <th className="py-2 pr-3 font-normal">{c.filter}</th>
                  <th className="py-2 pr-3 font-normal">{c.kind}</th>
                  <th className="py-2 pr-3 font-normal">{c.lastPx}</th>
                  <th className="py-2 pr-3 font-normal">{c.inBem}</th>
                  <th className="py-2 pr-3 font-normal">USD</th>
                  <th className="py-2 pr-3 font-normal">{c.bid}</th>
                  <th className="py-2 pr-3 font-normal">{c.trades}</th>
                  <th className="py-2 pr-3 font-normal">{c.qty}</th>
                  <th className="py-2 font-normal">{c.volBnb} 24h</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className="border-t border-gold/20">
                      <td className="max-w-48 truncate py-2 pr-3">
                        <button
                          type="button"
                          className="max-w-full truncate text-left font-display text-sm italic"
                          onClick={() => toggle(row.id)}
                          aria-expanded={pick === row.id}
                        >
                          {row.name}
                        </button>
                      </td>
                      <td className="py-2 pr-3">{row.kind}</td>
                      <td className="py-2 pr-3">{row.lastBnb != null ? fmtFlex(row.lastBnb) : "—"}</td>
                      <td className="py-2 pr-3">{row.bem != null ? fmtFlex(row.bem) : "—"}</td>
                      <td className="py-2 pr-3">{row.usd != null ? fmtUsd(row.usd) : "—"}</td>
                      <td className="py-2 pr-3">{row.bidBem != null ? fmtFlex(row.bidBem) : "—"}</td>
                      <td className="py-2 pr-3">{fmtInt(row.trades)}</td>
                      <td className="py-2 pr-3">{fmtInt(row.qty)}</td>
                      <td className="py-2">{fmtFlex(row.volBnb24)}</td>
                    </tr>
                    {pick === row.id ? (
                      <tr className="border-t border-gold/20">
                        <td colSpan={9}>
                          <Tape row={row} c={c} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ViewButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`min-h-11 border border-gold px-2 ${on ? "bg-foil" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function Tape({ row, c }: { row: LiveTransistor; c: Copy }) {
  return (
    <div className="border-t border-gold/30 bg-paper px-2 py-2">
      {row.bidBnb != null ? (
        <p className="font-mono text-xs tabular-nums">
          {c.bid} {fmtFlex(row.bidBnb)} BNB
          {row.bidBem != null ? ` · ${fmtFlex(row.bidBem)} BEM` : ""} · {c.bidLeft} {fmtInt(row.bidQty)}
        </p>
      ) : (
        <p className="text-xs text-ink/70">{c.noBid}</p>
      )}
      <p className="mt-2 text-xs tracking-widest text-gold">{c.prints}</p>
      {row.prints.length === 0 ? (
        <p className="text-xs">{c.noPrints}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {row.prints.map((print) => (
            <li
              key={`${print.ts}-${print.bnb}-${print.qty}`}
              className="flex flex-wrap justify-between gap-x-3 font-mono text-xs tabular-nums"
            >
              <span>{fmtTs(print.ts)}</span>
              <span>
                {fmtFlex(print.bnb)} BNB{print.bem != null ? ` · ${fmtFlex(print.bem)} BEM` : ""} · ×{fmtInt(print.qty)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-ink/60">{c.bidNote}</p>
    </div>
  );
}

function Stat({ label, value, hint, hot }: { label: string; value: string; hint?: string; hot?: boolean }) {
  return (
    <div className="border border-gold/40 px-3 py-2">
      <p className="text-xs tracking-widest text-gold">{label}</p>
      <p className="font-mono text-lg tabular-nums">{value}</p>
      {hint ? <p className={`font-mono text-xs tabular-nums ${hot ? "text-sell" : "text-ink/70"}`}>{hint}</p> : null}
    </div>
  );
}
