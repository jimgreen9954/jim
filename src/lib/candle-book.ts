export type Ohlc = { t: number; o: number; h: number; l: number; c: number; v: number };
export type PaperFrame = "1m" | "5m" | "10m" | "1h" | "4h" | "1d" | "1w";

export const PAPER_FRAMES: PaperFrame[] = ["1m", "5m", "10m", "1h", "4h", "1d", "1w"];

const spec: Record<PaperFrame, { path: string; aggregate: number; bucket: number; limit: number }> = {
  "1m": { path: "minute", aggregate: 1, bucket: 1, limit: 240 },
  "5m": { path: "minute", aggregate: 5, bucket: 1, limit: 240 },
  "10m": { path: "minute", aggregate: 5, bucket: 2, limit: 240 },
  "1h": { path: "hour", aggregate: 1, bucket: 1, limit: 240 },
  "4h": { path: "hour", aggregate: 4, bucket: 1, limit: 240 },
  "1d": { path: "day", aggregate: 1, bucket: 1, limit: 365 },
  "1w": { path: "day", aggregate: 1, bucket: 7, limit: 364 },
};

const cache = new Map<string, { at: number; rows: Ohlc[] }>();

function parse(rows: number[][] | undefined): Ohlc[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const candle = {
      t: Number(row[0]),
      o: Number(row[1]),
      h: Number(row[2]),
      l: Number(row[3]),
      c: Number(row[4]),
      v: Number(row[5] ?? 0),
    };
    return candle.o > 0 && candle.h > 0 && candle.l > 0 && candle.c > 0 ? [candle] : [];
  });
}

function bucket(rows: Ohlc[], size: number): Ohlc[] {
  if (size <= 1) return rows;
  const out: Ohlc[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last) continue;
    out.push({
      t: first.t,
      o: first.o,
      c: last.c,
      h: Math.max(...slice.map((item) => item.h)),
      l: Math.min(...slice.map((item) => item.l)),
      v: slice.reduce((sum, item) => sum + item.v, 0),
    });
  }
  return out;
}

export function paperLabel(frame: PaperFrame, lang: "zh" | "en"): string {
  const zh: Record<PaperFrame, string> = { "1m": "1分", "5m": "5分", "10m": "10分", "1h": "1时", "4h": "4时", "1d": "1日", "1w": "1周" };
  const en: Record<PaperFrame, string> = { "1m": "1m", "5m": "5m", "10m": "10m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w" };
  return lang === "zh" ? zh[frame] : en[frame];
}

export async function pullPaper(frame: PaperFrame): Promise<Ohlc[]> {
  const data = frame in spec ? frame : "1m";
  const hit = cache.get(data);
  const ttl = data === "1m" ? 15_000 : 60_000;
  if (hit && Date.now() - hit.at < ttl && hit.rows.length > 0) return hit.rows;
  const item = spec[data];
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x3098d7a051045000d68ec0360753a40c8cabea31/ohlcv/${item.path}?aggregate=${item.aggregate}&limit=${item.limit}&currency=usd`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return hit?.rows ?? [];
    const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const next = bucket(parse(body.data?.attributes?.ohlcv_list).reverse(), item.bucket);
    if (next.length === 0) return hit?.rows ?? [];
    cache.set(data, { at: Date.now(), rows: next });
    return next;
  } catch {
    return hit?.rows ?? [];
  }
}
