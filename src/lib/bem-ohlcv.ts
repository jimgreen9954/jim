export type Candle = { t?: number; o: number; h: number; l: number; c: number; v?: number };
export type CandleFrame = "15s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M" | "3M" | "1y";

const POOL = "https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x3098d7a051045000d68ec0360753a40c8cabea31/ohlcv";

const direct: Record<Exclude<CandleFrame, "1w" | "1M" | "3M" | "1y">, { path: string; aggregate: number; limit: number }> = {
  "15s": { path: "second", aggregate: 15, limit: 300 },
  "1m": { path: "minute", aggregate: 1, limit: 300 },
  "5m": { path: "minute", aggregate: 5, limit: 300 },
  "15m": { path: "minute", aggregate: 15, limit: 300 },
  "1h": { path: "hour", aggregate: 1, limit: 300 },
  "4h": { path: "hour", aggregate: 4, limit: 300 },
  "1d": { path: "day", aggregate: 1, limit: 300 },
};

const cache = new Map<string, { at: number; rows: Candle[] }>();

function parse(rows: number[][] | undefined): Candle[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .slice(0, 1000)
    .reverse()
    .flatMap((row) => {
      const candle = { t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5] ?? 0) };
      return candle.o > 0 && candle.h > 0 && candle.l > 0 && candle.c > 0 ? [candle] : [];
    });
}

async function fetchOhlcv(path: string, aggregate: number, limit: number): Promise<Candle[]> {
  const res = await fetch(`${POOL}/${path}?aggregate=${aggregate}&limit=${limit}&currency=usd`, { headers: { accept: "application/json" } });
  if (!res.ok) {
    if (limit > 300) return fetchOhlcv(path, aggregate, 300);
    return [];
  }
  const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
  return parse(body.data?.attributes?.ohlcv_list);
}

function sgtDate(t: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t * 1000));
  const bit = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { y: bit("year"), m: bit("month"), d: bit("day") };
}

function weekKey(t: number): string {
  const { y, m, d } = sgtDate(t);
  const utc = Date.UTC(y, m - 1, d);
  const day = new Date(utc).getUTCDay();
  const back = day === 0 ? 6 : day - 1;
  return new Date(utc - back * 86400000).toISOString().slice(0, 10);
}

function fold(rows: Candle[], keyOf: (t: number) => string): Candle[] {
  const groups = new Map<string, Candle>();
  for (const row of rows) {
    if (!row.t) continue;
    const key = keyOf(row.t);
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { ...row });
      continue;
    }
    groups.set(key, {
      t: prev.t,
      o: prev.o,
      c: row.c,
      h: Math.max(prev.h, row.h),
      l: Math.min(prev.l, row.l),
      v: (prev.v ?? 0) + (row.v ?? 0),
    });
  }
  return [...groups.values()];
}

async function load(frame: CandleFrame): Promise<Candle[]> {
  if (frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y") {
    const days = await fetchOhlcv("day", 1, 1000);
    if (frame === "1w") return fold(days, weekKey);
    if (frame === "1M") return fold(days, (t) => {
      const { y, m } = sgtDate(t);
      return `${y}-${String(m).padStart(2, "0")}`;
    });
    if (frame === "3M") return fold(days, (t) => {
      const { y, m } = sgtDate(t);
      return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    });
    return fold(days, (t) => String(sgtDate(t).y));
  }
  const spec = direct[frame];
  return fetchOhlcv(spec.path, spec.aggregate, spec.limit);
}

export async function pullBem(frame: CandleFrame): Promise<Candle[]> {
  const key = frame in direct || frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y" ? frame : "1m";
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 45_000 && hit.rows.length > 0) return hit.rows;
  try {
    const rows = await load(key);
    if (rows.length === 0) return hit?.rows ?? [];
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
}
