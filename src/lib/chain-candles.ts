import type { Candle } from "@/lib/bem-ohlcv";

type Point = { t: number; px: number; v: number };
type Meta = { dec0: number; dec1: number; asset0: boolean; bnb: boolean; v2: boolean };
type Book = { points: Point[]; lo: number; hi: number };

const V3_SWAP = "0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83";
const V2_SWAP = "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const V4_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
const FAB_POOL = "0x63556b8d29b7ada6effae8b336cb806a06caf6546b33059b1e5e8b93a98cb29d";
const FAB = "0x72f349b1eee7833b26f8c81a8410775a4e231ed2";
const MANAGER = "0x360e68faccca8ca495c1b759fd9eee466db9fb32";
const BEM_POOL = "0x3098d7a051045000d68ec0360753a40c8cabea31";
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";

const GATE: Record<string, string> = {
  "0x247f51881d1e3ae0f759afb801413a6c948ef442": "BTC_USDT",
  "0xbe141893e4c6ad9272e8c04bab7e6a10604501a5": "ETH_USDT",
  "0x172fcd41e0913e95784454622d1c3724f546f849": "BNB_USDT",
  "0x6701b287c8170d6c290c6f4ef426782bd61ae310": "ZEC_USDT",
  "0xc71f9e1de80eb505c0cb3bbf90ae6593130e5d25": "OKB_USDT",
};

const books = new Map<string, Book>();
const metas = new Map<string, Meta>();
let bscStep = 0.45;
let bnbSeries: Point[] | null = null;

async function bnbUsd(t: number): Promise<number> {
  if (!bnbSeries) {
    const res = await fetch("https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=BNB_USDT&interval=5m&limit=300", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const body = res.ok ? ((await res.json()) as string[][]) : [];
    bnbSeries = body
      .map((row) => ({ t: Number(row[0]), px: Number(row[2]), v: 0 }))
      .filter((row) => row.t > 0 && row.px > 0)
      .sort((a, b) => a.t - b.t);
  }
  let px = bnbSeries[0]?.px ?? 0;
  for (const row of bnbSeries) if (row.t <= t) px = row.px;
  return px;
}

function bucket(points: Point[], span: number, limit: number): Candle[] {
  const rows = points.filter((p) => p.t > 0 && p.px > 0).sort((a, b) => a.t - b.t);
  if (!rows.length || !(span > 0)) return [];
  const end = rows[rows.length - 1]!.t;
  const start = end - span * Math.max(1, limit);
  const groups = new Map<number, Candle>();
  for (const p of rows) {
    if (p.t < start) continue;
    const key = Math.floor(p.t / span) * span;
    const prev = groups.get(key);
    if (!prev) groups.set(key, { t: key, o: p.px, h: p.px, l: p.px, c: p.px, v: p.v || 0 });
    else {
      prev.h = Math.max(prev.h, p.px);
      prev.l = Math.min(prev.l, p.px);
      prev.c = p.px;
      prev.v = (prev.v ?? 0) + (p.v || 0);
    }
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  if (!keys.length) return [];
  const out: Candle[] = [];
  let cursor = keys[0]!;
  let prev = groups.get(cursor)!;
  const last = keys[keys.length - 1]!;
  while (cursor <= last && out.length < limit + 8) {
    const bar = groups.get(cursor);
    if (bar) {
      out.push(bar);
      prev = bar;
    } else out.push({ t: cursor, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
    cursor += span;
  }
  return out.slice(-limit);
}

async function rpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message || "rpc");
  return body.result;
}

const node = (chain: "bsc" | "xlayer") => (chain === "bsc" ? "https://bsc.publicnode.com" : "https://rpc.xlayer.tech");

async function headOf(chain: "bsc" | "xlayer"): Promise<number> {
  return parseInt(String(await rpc(node(chain), "eth_blockNumber", [])), 16);
}

async function timeOf(chain: "bsc" | "xlayer", block: number): Promise<number> {
  const row = (await rpc(node(chain), "eth_getBlockByNumber", ["0x" + block.toString(16), false])) as { timestamp?: string };
  return parseInt(row.timestamp || "0", 16);
}

function pxFromSqrt(sqrt: bigint, dec0: number, dec1: number, asset0: boolean): number {
  const raw = (Number(sqrt) / 2 ** 96) ** 2;
  if (!(raw > 0)) return 0;
  const token0 = raw * 10 ** (dec0 - dec1);
  const token1 = (1 / raw) * 10 ** (dec1 - dec0);
  const px = asset0 ? token0 : token1;
  return px > 0 && Number.isFinite(px) ? px : 0;
}

function addrOf(word: string): string {
  return "0x" + word.slice(-40).toLowerCase();
}

async function call(chain: "bsc" | "xlayer", to: string, data: string): Promise<string> {
  return String(await rpc(node(chain), "eth_call", [{ to, data }, "latest"]));
}

function symbolOf(hex: string): string {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const read = (body: string) => {
    let out = "";
    for (let i = 0; i < body.length; i += 2) {
      const code = parseInt(body.slice(i, i + 2), 16);
      if (!code) break;
      out += String.fromCharCode(code);
    }
    return out;
  };
  if (raw.length === 64) return read(raw);
  if (raw.length < 128) return "";
  const len = parseInt(raw.slice(64, 128), 16);
  if (!len || len > 32) return "";
  return read(raw.slice(128, 128 + len * 2));
}

async function metaOf(chain: "bsc" | "xlayer", pool: string): Promise<Meta> {
  const key = `${chain}:${pool}`;
  const hit = metas.get(key);
  if (hit) return hit;
  const t0 = addrOf(await call(chain, pool, "0x0dfe1681"));
  const t1 = addrOf(await call(chain, pool, "0xd21220a7"));
  const d0 = parseInt(await call(chain, t0, "0x313ce567"), 16);
  const d1 = parseInt(await call(chain, t1, "0x313ce567"), 16);
  const s0 = symbolOf(await call(chain, t0, "0x95d89b41")).toUpperCase();
  const s1 = symbolOf(await call(chain, t1, "0x95d89b41")).toUpperCase();
  const stable = (s: string) => /^(USDT|USDC|USD1|BUSD|DAI|FDUSD|USDT0)$/.test(s);
  let asset0 = false;
  let bnb = false;
  if (stable(s0) && !stable(s1)) asset0 = false;
  else if (stable(s1)) asset0 = true;
  else if (t0 === WBNB) {
    asset0 = false;
    bnb = true;
  } else if (t1 === WBNB) {
    asset0 = true;
    bnb = true;
  }
  let v2 = false;
  try {
    const reserves = await call(chain, pool, "0x0902f1ac");
    v2 = reserves.length > 130;
  } catch {
    v2 = false;
  }
  const meta = { dec0: d0 || 18, dec1: d1 || 18, asset0, bnb, v2 };
  metas.set(key, meta);
  return meta;
}

async function gatePoints(pair: string, span: number, limit: number): Promise<Point[]> {
  const table: [number, string][] = [
    [60, "1m"],
    [300, "5m"],
    [900, "15m"],
    [3600, "1h"],
    [14400, "4h"],
    [86400, "1d"],
    [604800, "7d"],
  ];
  let bar = table[0]!;
  for (const item of table) if (item[0] <= span) bar = item;
  const cap = Math.min(999, Math.max(limit, Math.ceil((span * limit) / bar[0])));
  const res = await fetch(
    `https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair=${pair}&interval=${bar[1]}&limit=${cap}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) },
  );
  if (!res.ok) return [];
  const body = (await res.json()) as string[][];
  const points: Point[] = [];
  for (const row of body) {
    const t = Number(row[0]);
    const c = Number(row[2]);
    const h = Number(row[3]);
    const l = Number(row[4]);
    const o = Number(row[5]);
    const v = Number(row[6]);
    if (!(t > 0 && o > 0 && c > 0)) continue;
    const w = bar[0];
    points.push({ t, px: o, v }, { t: t + w / 3, px: h, v: 0 }, { t: t + (2 * w) / 3, px: l, v: 0 }, { t: t + w - 1, px: c, v: 0 });
  }
  return points;
}

async function logsOf(chain: "bsc" | "xlayer", filter: Record<string, unknown>): Promise<{ blockNumber: string; data: string }[]> {
  const rows = await rpc(node(chain), "eth_getLogs", [filter]);
  return Array.isArray(rows) ? (rows as { blockNumber: string; data: string }[]) : [];
}

async function v3Window(pool: string, from: number, to: number, step: number): Promise<Point[]> {
  const meta = await metaOf("bsc", pool);
  const endTs = await timeOf("bsc", to);
  const logs = await logsOf("bsc", {
    address: pool,
    topics: [meta.v2 ? V2_SWAP : V3_SWAP],
    fromBlock: "0x" + from.toString(16),
    toBlock: "0x" + to.toString(16),
  });
  const points: Point[] = [];
  for (const log of logs) {
    const words = log.data.slice(2).match(/.{64}/g);
    if (!words || words.length < 3) continue;
    let px = 0;
    if (meta.v2 && words.length >= 4) {
      const i0 = BigInt("0x" + words[0]);
      const i1 = BigInt("0x" + words[1]);
      const o0 = BigInt("0x" + words[2]);
      const o1 = BigInt("0x" + words[3]);
      const t0 = i1 > 0n && o0 > 0n ? o0 : i0;
      const t1 = i1 > 0n && o0 > 0n ? i1 : o1;
      if (t0 > 0n && t1 > 0n) {
        const token1InToken0 = (Number(t0) / Number(t1)) * 10 ** (meta.dec1 - meta.dec0);
        px = meta.asset0 ? (token1InToken0 > 0 ? 1 / token1InToken0 : 0) : token1InToken0;
      }
    } else {
      px = pxFromSqrt(BigInt("0x" + words[2]), meta.dec0, meta.dec1, meta.asset0);
    }
    if (!(px > 0)) continue;
    if (meta.bnb) {
      const usd = await bnbUsd(endTs);
      if (!(usd > 0)) continue;
      px *= usd;
    }
    const block = parseInt(log.blockNumber, 16);
    const volWord = meta.asset0 ? words[1] : words[0];
    const volDec = meta.asset0 ? meta.dec1 : meta.dec0;
    let vol = 0n;
    try {
      vol = BigInt("0x" + volWord);
      if (vol >= 2n ** 255n) vol = 2n ** 256n - vol;
    } catch {
      vol = 0n;
    }
    points.push({
      t: Math.round(endTs - (to - block) * step),
      px,
      v: Number(vol) / 10 ** volDec,
    });
  }
  return points;
}

async function bemUsd(): Promise<number> {
  const book = books.get(BEM_POOL);
  const last = book?.points.at(-1)?.px;
  if (last && last > 0) return last;
  const head = await headOf("bsc");
  const pts = await v3Window(BEM_POOL, head - 4000, head, bscStep);
  return pts.at(-1)?.px ?? 0;
}

async function fabWindow(from: number, to: number): Promise<Point[]> {
  const endTs = await timeOf("xlayer", to);
  const usd = await bemUsd();
  if (!(usd > 0)) return [];
  const logs = await logsOf("xlayer", {
    address: MANAGER,
    topics: [V4_SWAP, FAB_POOL],
    fromBlock: "0x" + from.toString(16),
    toBlock: "0x" + to.toString(16),
  });
  const points: Point[] = [];
  for (const log of logs) {
    const words = log.data.slice(2).match(/.{64}/g);
    if (!words || words.length < 3) continue;
    const bem = pxFromSqrt(BigInt("0x" + words[2]), 8, 8, false);
    if (!(bem > 0)) continue;
    const block = parseInt(log.blockNumber, 16);
    points.push({ t: endTs - (to - block), px: bem * usd, v: 0 });
  }
  return points;
}

async function mapLimited<T>(n: number, jobs: Array<() => Promise<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < jobs.length; i += n) {
    const part = await Promise.all(jobs.slice(i, i + n).map((job) => job().catch(() => null)));
    for (const row of part) if (row) out.push(row);
  }
  return out;
}

function merge(prev: Point[], next: Point[]): Point[] {
  const rows = [...prev, ...next].filter((p) => p.px > 0).sort((a, b) => a.t - b.t);
  const slim: Point[] = [];
  for (const row of rows) {
    const last = slim[slim.length - 1];
    if (last && last.t === row.t) slim[slim.length - 1] = row;
    else slim.push(row);
  }
  return slim.slice(-6000);
}

async function ensureV3(pool: string, span: number, limit: number): Promise<Point[]> {
  const book = books.get(pool) ?? { points: [], lo: 0, hi: 0 };
  const head = await headOf("bsc");
  if (bscStep === 0.45) {
    const a = await timeOf("bsc", head);
    const b = await timeOf("bsc", head - 4000);
    if (a > b) bscStep = (a - b) / 4000;
  }
  const fresh = !book.points.length || head - book.hi > 120;
  const covered = book.points.length > 2 && book.points.at(-1)!.t - book.points[0]!.t >= span * Math.min(limit, 24) * 0.7;
  if (!fresh && covered) return book.points;
  const chunk = 42000;
  const windows: Array<[number, number]> = [];
  if (fresh) {
    const want = span >= 86400 ? 6 : 3;
    const jump = span >= 86400 ? Math.round(86400 / bscStep) : chunk;
    const wide = span >= 86400 ? 16000 : chunk;
    for (let i = 0; i < want; i += 1) {
      const to = head - i * jump;
      windows.push([Math.max(1, to - wide + 1), to]);
    }
  } else if (book.lo > 1) {
    const jump = span >= 86400 ? Math.round(86400 / bscStep) : chunk;
    const to = book.lo - 1;
    windows.push([Math.max(1, to - jump + 1), to]);
  }
  const found = await mapLimited(3, windows.map(([from, to]) => () => v3Window(pool, from, to, bscStep)));
  const next = {
    points: merge(book.points, found.flat()),
    lo: windows.length ? Math.min(book.lo || head, ...windows.map((w) => w[0])) : book.lo,
    hi: head,
  };
  books.set(pool, next);
  return next.points;
}

async function ensureFab(span: number, limit: number): Promise<Point[]> {
  const key = "fab";
  const book = books.get(key) ?? { points: [], lo: 0, hi: 0 };
  const head = await headOf("xlayer");
  const fresh = !book.points.length || head - book.hi > 30;
  const covered = book.points.length > 2 && book.points.at(-1)!.t - book.points[0]!.t >= Math.min(span * Math.min(limit, 12), 6 * 3600);
  if (!fresh && covered) return book.points;
  const width = 90;
  const count = fresh ? Math.min(40, Math.max(12, Math.ceil((span * 8) / width))) : 16;
  const origin = fresh ? head : Math.max(width, book.lo - 1);
  const jobs = Array.from({ length: count }, (_, i) => {
    const to = origin - i * width;
    return () => fabWindow(Math.max(1, to - width + 1), to);
  });
  const found = await mapLimited(6, jobs);
  const next = {
    points: merge(book.points, found.flat()),
    lo: Math.max(1, origin - count * width),
    hi: fresh ? head : book.hi,
  };
  books.set(key, next);
  return next.points;
}

/** Candles when Gecko is rate-limited. Same shape the chart already draws. */
export async function fallbackCandles(base: string, span: number, limit: number): Promise<Candle[]> {
  const pool = (base.match(/0x[a-fA-F0-9]{40}/)?.[0] || "").toLowerCase();
  if (!pool) return [];
  const cap = Math.min(Math.max(limit, 8), 300);
  try {
    if (pool === "0x2ccf8aa17f5df9fb5d51c9de12135a913ff29f7a") return bucket(await ensureV3(BEM_POOL, span, cap), span, cap);
    const gate = GATE[pool];
    if (gate) return bucket(await gatePoints(gate, span, cap), span, cap);
    if (base.includes("/tokens/") && pool === FAB) return bucket(await ensureFab(span, cap), span, cap);
    if (base.includes("/tokens/")) return [];
    return bucket(await ensureV3(pool, span, cap), span, cap);
  } catch {
    return [];
  }
}
