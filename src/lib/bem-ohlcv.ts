export type Candle = { t?: number; o: number; h: number; l: number; c: number; v?: number };
export type CandleFrame = "15s" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w" | "1M" | "3M" | "1y";

const POOL = "https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x3098d7a051045000d68ec0360753a40c8cabea31/ohlcv";
const XPOOL = "https://api.geckoterminal.com/api/v2/networks/x-layer/pools/0x24e2c7d83a298c388872b77619cf654941222db5b9f342e788b218b3f485b6a4/ohlcv";

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
  return fetchBook(POOL, path, aggregate, limit, "");
}

async function fetchXOhlcv(path: string, aggregate: number, limit: number): Promise<Candle[]> {
  return fetchBook(XPOOL, path, aggregate, limit, "&token=quote");
}

async function fetchBook(base: string, path: string, aggregate: number, limit: number, extra: string): Promise<Candle[]> {
  const res = await fetch(`${base}/${path}?aggregate=${aggregate}&limit=${limit}&currency=usd${extra}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2_500),
  });
  if (!res.ok) {
    if (limit > 300) return fetchBook(base, path, aggregate, 300, extra);
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

export function pullXBem(frame: CandleFrame): Promise<Candle[]> {
  const key = `x:${frame in direct || frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y" ? frame : "1m"}`;
  return remembered(key, () => loadX(key.slice(2) as CandleFrame));
}

async function loadX(frame: CandleFrame): Promise<Candle[]> {
  if (frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y") {
    const days = await fetchXOhlcv("day", 1, 1000);
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
  return fetchXOhlcv(spec.path, spec.aggregate, spec.limit);
}

export function pullBem(frame: CandleFrame): Promise<Candle[]> {
  const key = frame in direct || frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y" ? frame : "1m";
  return remembered(key, () => load(key));
}

const COIN_POOL = {
  btc: "https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x247f51881d1e3ae0f759afb801413a6c948ef442/ohlcv",
  eth: "https://api.geckoterminal.com/api/v2/networks/bsc/pools/0xbe141893e4c6ad9272e8c04bab7e6a10604501a5/ohlcv",
  zec: "https://api.geckoterminal.com/api/v2/networks/bsc/pools/0x6701b287c8170d6c290c6f4ef426782bd61ae310/ohlcv",
} as const;

async function loadPool(base: string, frame: CandleFrame): Promise<Candle[]> {
  if (frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y") {
    const days = await fetchBook(base, "day", 1, 1000, "");
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
  return fetchBook(base, spec.path, spec.aggregate, spec.limit, "");
}

/** Pool candles and the exchange print race. The first one with bars wins. */
export function pullCoin(coin: keyof typeof COIN_POOL, frame: CandleFrame): Promise<Candle[]> {
  const safe = frame in direct || frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y" ? frame : "1m";
  const key = `${coin}:${safe}`;
  return remembered(key, () => firstRows([loadPool(COIN_POOL[coin], safe), loadOkx(coin, safe)]));
}

const flights = new Map<string, Promise<Candle[]>>();

function remembered(key: string, loadRows: () => Promise<Candle[]>): Promise<Candle[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 20_000 && hit.rows.length > 0) return Promise.resolve(hit.rows);
  let job = flights.get(key);
  if (!job) {
    job = loadRows()
      .then((rows) => {
        if (rows.length > 0) cache.set(key, { at: Date.now(), rows });
        return rows.length > 0 ? rows : hit?.rows ?? [];
      })
      .catch(() => hit?.rows ?? [])
      .finally(() => {
        flights.delete(key);
      });
    flights.set(key, job);
  }
  if (hit?.rows.length) return Promise.resolve(hit.rows);
  return job;
}

function firstRows(tasks: Promise<Candle[]>[]): Promise<Candle[]> {
  return new Promise((resolve) => {
    let pending = tasks.length;
    let best: Candle[] = [];
    let done = false;
    const finish = (rows: Candle[]) => {
      if (done) return;
      done = true;
      resolve(rows);
    };
    if (pending === 0) finish([]);
    for (const task of tasks) {
      task
        .then((rows) => {
          if (rows.length > best.length) best = rows;
          if (rows.length > 0) finish(rows);
        })
        .catch(() => undefined)
        .finally(() => {
          pending -= 1;
          if (pending === 0) finish(best);
        });
    }
  });
}

const OKX_INST = { btc: "BTC-USDT", eth: "ETH-USDT", zec: "ZEC-USDT" } as const;
const OKX_BAR: Record<CandleFrame, string> = {
  "15s": "1m",
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
  "3M": "3M",
  "1y": "1D",
};

async function fetchOkx(inst: string, bar: string): Promise<Candle[]> {
  const res = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${inst}&bar=${bar}&limit=300`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2_500),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: string[][] };
  return (body.data ?? []).slice().reverse().flatMap((row) => {
    const candle = { t: Math.floor(Number(row[0]) / 1000), o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]), v: Number(row[5] ?? 0) };
    return candle.o > 0 && candle.h > 0 && candle.l > 0 && candle.c > 0 ? [candle] : [];
  });
}

async function loadOkx(coin: keyof typeof OKX_INST, frame: CandleFrame): Promise<Candle[]> {
  const rows = await fetchOkx(OKX_INST[coin], OKX_BAR[frame]);
  return frame === "1y" ? fold(rows, (t) => String(sgtDate(t).y)) : rows;
}
