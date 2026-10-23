import type { Candle } from "@/lib/bem-ohlcv";
import { STOCKS, type StockKey } from "@/lib/stocks";

export type SpotFrame = "1m" | "5m" | "15m" | "1h" | "1d";
export type SpotPair = "bem" | "xbem" | "bnb" | "okb" | StockKey | "btc" | "eth" | "zec" | "xau" | "btccn" | "dagou";

const POOLS: Record<SpotPair, { network: string; pool: string }> = {
  bem: { network: "bsc", pool: "0x3098d7a051045000d68ec0360753a40c8cabea31" },
  xbem: { network: "x-layer", pool: "0x2ccf8aa17f5df9fb5d51c9de12135a913ff29f7a" },
  bnb: { network: "bsc", pool: "0x172fcd41e0913e95784454622d1c3724f546f849" },
  okb: { network: "x-layer", pool: "0xc71f9e1de80eb505c0cb3bbf90ae6593130e5d25" },
  btc: { network: "bsc", pool: "0x247f51881d1e3ae0f759afb801413a6c948ef442" },
  eth: { network: "bsc", pool: "0xbe141893e4c6ad9272e8c04bab7e6a10604501a5" },
  zec: { network: "bsc", pool: "0x6701b287c8170d6c290c6f4ef426782bd61ae310" },
  xau: { network: "bsc", pool: "0x83a0a8a723262651ae9c54bbba929f167443bc59" },
  btccn: { network: "bsc", pool: "0x64a289684b85b55b87fcf3287329c7e710ef465d" },
  dagou: { network: "bsc", pool: "0x32df7ebbff443425555cb0e22d673e7e34e07a41" },
  spy: { network: "bsc", pool: STOCKS.spy.pool },
  qqq: { network: "bsc", pool: STOCKS.qqq.pool },
  aapl: { network: "bsc", pool: STOCKS.aapl.pool },
  nvda: { network: "bsc", pool: STOCKS.nvda.pool },
  intc: { network: "bsc", pool: STOCKS.intc.pool },
  msft: { network: "bsc", pool: STOCKS.msft.pool },
  tsla: { network: "bsc", pool: STOCKS.tsla.pool },
  spcx: { network: "bsc", pool: STOCKS.spcx.pool },
  googl: { network: "bsc", pool: STOCKS.googl.pool },
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
  if (hit && Date.now() - hit.at < 60_000 && hit.rows.length > 0) return hit.rows;
  const pool = POOLS[pair];
  const spec = SPEC[frame];
  const okxInst = pair === "btc" ? "BTC-USDT" : pair === "bnb" ? "BNB-USDT" : "";
  const okxBar = frame === "1m" ? "1m" : frame === "5m" ? "5m" : frame === "15m" ? "15m" : frame === "1h" ? "1H" : "1D";
  const fromPool = (async () => {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${pool.network}/pools/${pool.pool}/ohlcv/${spec.path}?aggregate=${spec.aggregate}&limit=120&currency=usd`,
      { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000) },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
    return (body.data?.attributes?.ohlcv_list ?? [])
      .slice(0, 120)
      .reverse()
      .flatMap((row) => {
        const candle = { t: Number(row[0]), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5] ?? 0) };
        return candle.c > 0 ? [candle] : [];
      });
  })();
  const fromOkx = okxInst
    ? fetch(`https://www.okx.com/api/v5/market/candles?instId=${okxInst}&bar=${okxBar}&limit=120`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(2_500),
      })
        .then(async (res) => {
          if (!res.ok) return [] as Candle[];
          const body = (await res.json()) as { data?: string[][] };
          return (body.data ?? []).slice().reverse().flatMap((row) => {
            const candle = { t: Math.floor(Number(row[0]) / 1000), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5] ?? 0) };
            return candle.c > 0 ? [candle] : [];
          });
        })
        .catch(() => [] as Candle[])
    : Promise.resolve([] as Candle[]);
  try {
    const rows = await new Promise<Candle[]>((resolve) => {
      const tasks = [fromPool.catch(() => [] as Candle[]), fromOkx];
      let pending = tasks.length;
      let best: Candle[] = [];
      let done = false;
      const finish = (next: Candle[]) => {
        if (done) return;
        done = true;
        resolve(next);
      };
      for (const task of tasks) {
        task
          .then((next) => {
            if (next.length > best.length) best = next;
            if (next.length > 0) finish(next);
          })
          .finally(() => {
            pending -= 1;
            if (pending === 0) finish(best);
          });
      }
    });
    if (rows.length === 0) return hit?.rows ?? [];
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
}
