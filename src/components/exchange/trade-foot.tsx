import { useEffect, useState } from "react";

const KEY = "tapeliquid-trade-log";

export type FillRow = { t: number; text: string; href?: string };

export function rememberFill(text: string, href?: string) {
  if (typeof window === "undefined" || !text.trim()) return;
  try {
    const prev = JSON.parse(localStorage.getItem(KEY) || "[]") as FillRow[];
    const rows = Array.isArray(prev) ? prev : [];
    const next = [{ t: Date.now(), text: text.slice(0, 160), href }, ...rows].slice(0, 40);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("tape-fills"));
  } catch {
    /* a full store does not block the trade */
  }
}

export function TradeQuota({ zh, buy, sell }: { zh: boolean; buy: string; sell: string }) {
  return (
    <div className="mt-2 grid grid-cols-2 border border-gold/40">
      <p className="min-w-0 px-2 py-2">
        <span className="block text-[10px] tracking-wide text-ink/45">{zh ? "可买入" : "Can buy"}</span>
        <span className="block truncate font-mono text-sm">{buy}</span>
      </p>
      <p className="min-w-0 border-l border-gold/40 px-2 py-2">
        <span className="block text-[10px] tracking-wide text-ink/45">{zh ? "可卖出" : "Can sell"}</span>
        <span className="block truncate font-mono text-sm">{sell}</span>
      </p>
    </div>
  );
}

export function TradeLog({ zh }: { zh: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<FillRow[]>([]);
  useEffect(() => {
    const read = () => {
      try {
        const parsed = JSON.parse(localStorage.getItem(KEY) || "[]") as FillRow[];
        setRows(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRows([]);
      }
    };
    read();
    window.addEventListener("tape-fills", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("tape-fills", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return (
    <div className="mt-2 border border-gold/40">
      <button type="button" className="flex h-8 w-full items-center justify-between px-2 text-xs" onClick={() => setOpen((on) => !on)}>
        <span>{zh ? "交易记录" : "Trades"}</span>
        <span className="text-ink/45">{open ? (zh ? "收起" : "Hide") : rows.length}</span>
      </button>
      {open ? (
        <div className="max-h-36 overflow-auto border-t border-gold/30 px-2 py-1 font-mono text-[11px]">
          {rows.length === 0 ? <p className="py-2 text-ink/45">{zh ? "还没有" : "None yet"}</p> : rows.map((row) => (
            <p key={row.t} className="flex justify-between gap-2 py-1">
              <span className="shrink-0 text-ink/45">{new Date(row.t).toLocaleString()}</span>
              {row.href ? <a className="min-w-0 truncate underline" href={row.href} target="_blank" rel="noreferrer">{row.text}</a> : <span className="min-w-0 truncate">{row.text}</span>}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
