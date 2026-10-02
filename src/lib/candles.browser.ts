export type Candle = { o: number; h: number; l: number; c: number };
export type CandleFrame = "15s" | "1m" | "5m" | "15m" | "1h" | "4h";

const frames: Record<CandleFrame, { path: string; aggregate: number }> = {
  "15s": { path: "second", aggregate: 15 },
  "1m": { path: "minute", aggregate: 1 },
  "5m": { path: "minute", aggregate: 5 },
  "15m": { path: "minute", aggregate: 15 },
  "1h": { path: "hour", aggregate: 1 },
  "4h": { path: "hour", aggregate: 4 },
};

const cache = new Map<string, { at: number; rows: Candle[] }>();

export async function getCandles(input: { data: CandleFrame } | CandleFrame): Promise<Candle[]> {
  const frame = typeof input === "string" ? input : input.data;
  const data = frame in frames ? frame : "1m";
  const hit = cache.get(data);
  if (hit && Date.now() - hit.at < 45_000 && hit.rows.length > 0) return hit.rows;
  const spec = frames[data];
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x3098d7a051045000d68ec0360753a40c8cabea31/ohlcv/${spec.path}?aggregate=${spec.aggregate}&limit=48&currency=usd`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return hit?.rows ?? [];
    const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const next = (body.data?.attributes?.ohlcv_list ?? [])
      .slice(0, 48)
      .reverse()
      .flatMap((row) => {
        const candle = { o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]) };
        return candle.o > 0 && candle.h > 0 && candle.l > 0 && candle.c > 0 ? [candle] : [];
      });
    if (next.length === 0) return hit?.rows ?? [];
    cache.set(data, { at: Date.now(), rows: next });
    return next;
  } catch {
    return hit?.rows ?? [];
  }
}
