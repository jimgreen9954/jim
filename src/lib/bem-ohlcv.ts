import { geckoFetch } from "@/lib/gecko-pace";
import { tapePoolCandles } from "@/lib/tape-open-candles";

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
  const res = await geckoFetch(`${base}/${path}?aggregate=${aggregate}&limit=${limit}&currency=usd${extra}`);
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

export async function pullXBem(frame: CandleFrame): Promise<Candle[]> {
  const key = `x:${frame in direct || frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y" ? frame : "1m"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 45_000 && hit.rows.length > 0) return hit.rows;
  try {
    const rows = await loadX(key.slice(2) as CandleFrame);
    if (rows.length === 0) return hit?.rows ?? [];
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
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

/** Same frames as the BEM book: 15s through 1y, from that coin's Pancake pool. */
export async function pullCoin(coin: keyof typeof COIN_POOL, frame: CandleFrame): Promise<Candle[]> {
  const safe = frame in direct || frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y" ? frame : "1m";
  const key = `${coin}:${safe}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 45_000 && hit.rows.length > 0) return hit.rows;
  try {
    const rows = await loadPool(COIN_POOL[coin], safe);
    if (rows.length === 0) return hit?.rows ?? [];
    cache.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
}

/** TAPE spot. Candles come from the open pool's own swaps, priced off its reserves. */
export async function pullTape(frame: CandleFrame): Promise<Candle[]> {
  const safe = frame in direct || frame === "1w" || frame === "1M" || frame === "3M" || frame === "1y" ? frame : "1m";
  try {
    return await tapePoolCandles(safe);
  } catch {
    return [];
  }
}

const BUCKET: Record<CandleFrame, number> = {
  "15s": 15,
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "4h": 4 * 3600,
  "1d": 86400,
  "1w": 7 * 86400,
  "1M": 30 * 86400,
  "3M": 90 * 86400,
  "1y": 365 * 86400,
};

function secOf(t: number): number {
  return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
}

/** Fold a finer series into `frame`. Empty when the source is already coarser. */
export function resample(rows: Candle[], frame: CandleFrame): Candle[] {
  const span = BUCKET[frame];
  const timed = rows.filter((row) => row.t && row.t > 1e8 && row.o > 0 && row.c > 0);
  if (timed.length < 2 || !span) return [];
  const step = Math.abs(secOf(timed[1].t!) - secOf(timed[0].t!)) || span;
  if (step > span * 1.25) return [];
  const groups = new Map<number, Candle>();
  for (const row of timed) {
    const key = Math.floor(secOf(row.t!) / span) * span;
    const prev = groups.get(key);
    if (!prev) {
      groups.set(key, { t: key, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v ?? 0 });
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

const FINE_ORDER: CandleFrame[] = ["15s", "1m", "5m", "15m", "1h", "4h", "1d", "1w", "1M", "3M", "1y"];

/** Instant series for a frame: exact cache, else a fold of the finest series already loaded. */
export function previewFrame(cache: Map<string, Candle[]>, frame: CandleFrame): Candle[] {
  const hit = cache.get(frame);
  if (hit?.length) return hit;
  for (const key of FINE_ORDER) {
    const rows = cache.get(key);
    if (!rows?.length) continue;
    const folded = resample(rows, frame);
    if (folded.length) return folded;
  }
  return [];
}

/** Give print-built bars a clock so the axis moves when the frame changes. Real candles keep their time. */
export function stampBars<T extends Candle>(rows: T[], frame: CandleFrame): T[] {
  if (!rows.length || rows.some((row) => row.t && row.t > 1e8)) return rows;
  const span = BUCKET[frame] || 60;
  const end = Math.floor(Date.now() / 1000);
  return rows.map((row, i) => ({ ...row, t: end - (rows.length - 1 - i) * span }));
}

const CANDLE_MEM = "tapeliquid-candle-book-v2";

function memKey(prefix: string): string {
  return prefix.endsWith(":") ? prefix : `${prefix}:`;
}

/** Last good candles for this book, so a rate-limited pool still switches frames. */
export function readCandleBook(prefix: string): Map<string, Candle[]> {
  const map = new Map<string, Candle[]>();
  if (typeof window === "undefined") return map;
  try {
    const raw = JSON.parse(window.localStorage.getItem(CANDLE_MEM) || "{}") as Record<string, Candle[]>;
    const head = memKey(prefix);
    for (const [key, rows] of Object.entries(raw)) {
      if (!key.startsWith(head) || !Array.isArray(rows) || rows.length < 2) continue;
      map.set(key.slice(head.length), rows);
    }
  } catch {
    /* Storage can be blocked. The live fetch still fills the chart. */
  }
  return map;
}

export function writeCandleBook(prefix: string, book: Map<string, Candle[]>) {
  if (typeof window === "undefined") return;
  const head = memKey(prefix);
  let raw: Record<string, Candle[]> = {};
  try {
    raw = JSON.parse(window.localStorage.getItem(CANDLE_MEM) || "{}") as Record<string, Candle[]>;
  } catch {
    raw = {};
  }
  for (const key of Object.keys(raw)) if (key.startsWith(head)) delete raw[key];
  for (const [frame, rows] of book) if (rows.length > 1) raw[`${head}${frame}`] = rows.slice(-300);
  try {
    window.localStorage.setItem(CANDLE_MEM, JSON.stringify(raw));
  } catch {
    /* Ignore a full store. The chart still has this session. */
  }
}
