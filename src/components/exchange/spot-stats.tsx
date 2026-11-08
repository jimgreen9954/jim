function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 2 : 4 });
}

function show(n: number | null, unit: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n === 0) return `0 ${unit}`;
  return `${compact(n)} ${unit}`;
}

/** Market cap and traded volume, same two figures on every spot desk. */
export function SpotStats({
  zh,
  cap,
  vol,
  capUnit,
  volUnit,
}: {
  zh: boolean;
  cap: number | null;
  vol: number | null;
  capUnit: string;
  volUnit: string;
}) {
  return (
    <div className="hl-stats">
      <p className="hl-stat">
        <span>{zh ? "市值" : "Market cap"}</span>
        <b>{show(cap, capUnit)}</b>
      </p>
      <p className="hl-stat">
        <span>{zh ? "成交量" : "Volume"}</span>
        <b>{show(vol, volUnit)}</b>
      </p>
    </div>
  );
}

/** Quote volume on candles whose time falls in the last day. Null when the book has no volume. */
export function dayVolume(rows: { t?: number; v?: number }[]): number | null {
  if (rows.length === 0) return null;
  const cut = Math.floor(Date.now() / 1000) - 86_400;
  let sum = 0;
  let seen = false;
  for (const row of rows) {
    if (row.t != null && row.t < cut) continue;
    const v = row.v ?? 0;
    if (!(v > 0)) continue;
    sum += v;
    seen = true;
  }
  return seen ? sum : 0;
}
