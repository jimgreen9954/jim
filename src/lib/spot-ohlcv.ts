import type { Candle } from "@/lib/bem-ohlcv";

export type SpotFrame = "1m" | "5m" | "15m" | "1h" | "1d";
export type SpotPair = "bem" | "bnb" | "okb" | "btc" | "xau";

const POOLS: Record<SpotPair, { network: string; pool: string }> = {
  bem: { network: "bsc", pool: "0x3098d7a051045000d68ec0360753a40c8cabea31" },
  bnb: { network: "bsc", pool: "0x172fcd41e0913e95784454622d1c3724f546f849" },
  okb: { network: "x-layer", pool: "0xc71f9e1de80eb505c0cb3bbf90ae6593130e5d25" },
  btc: { network: "bsc", pool: "0x247f51881d1e3ae0f759afb801413a6c948ef442" },
  xau: { network: "bsc", pool: "0x83a0a8a723262651ae9c54bbba929f167443bc59" },
};

const SPEC: Record<SpotFrame, { path: string; aggregate: number }> = {
  "1m": { path: "minute", aggregate: 1 },
  "5m": { path: "minute", aggregate: 5 },
  "15m": { path: "minute", aggregate: 15 },
  "1h": { path: "hour", aggregate: 1 },
  "1d": { path: "day", aggregate: 1 },
};

const cache = new Map<string, { at: number; rows: Candle[] }>();

export async function pullSpot(pair: SpotPair, frame: SpotFrame): Promise<Candle[]> {
  const key = `${pair}:${frame}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 45_000 && hit.rows.length > 0) return hit.rows;
  const pool = POOLS[pair];
  const spec = SPEC[frame];
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${pool.network}/pools/${pool.pool}/ohlcv/${spec.path}?aggregate=${spec.aggregate}&limit=120&currency=usd`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return hit?.rows ?? [];
    const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    const rows = (body.data?.attributes?.ohlcv_list ?? [])
      .slice(0, 120)
      .reverse()
      .flatMap((row) => {
        const candle = { t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5] ?? 0) };
        return candle.c > 0 ? [candle] : [];
      });
    if (rows.length === 0) return hit?.rows ?? [];
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
}
