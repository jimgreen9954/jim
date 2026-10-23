import { createPublicClient, formatUnits, http, parseAbiItem, type Hex } from "viem";
import type { Candle } from "@/lib/bem-ohlcv";
import { pretty, type PoolPrint } from "@/lib/bsc";
import { bookOkbRate, quoteXBem } from "@/lib/okb";
import { openPoolAddress, TAPE_POOL_V2 } from "@/lib/tape-pool";

export type TapeFrame = "1m" | "5m" | "15m" | "1h" | "1d";

const LIVE_BLOCK = 73721116n;
const POOL = TAPE_POOL_V2;
const KEY = "tapeliquid-tape-spot-log";
const STEP: Record<TapeFrame, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };
const swapped = parseAbiItem("event Swapped(address indexed sender, uint8 quote, bool tapeIn, uint256 amountIn, uint256 amountOut)");

type Row = {
  t: number;
  quote: 0 | 1;
  tapeIn: boolean;
  amountIn: string;
  amountOut: string;
  who: string;
  tx: string;
};

const drpc = createPublicClient({ transport: http("https://xlayer.drpc.org", { timeout: 12_000 }) });
const official = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 12_000 }) });

let rows: Row[] = [];
let scanned = 0n;
let openAt = 0;
let loaded = false;
let chain: Promise<void> = Promise.resolve();

function remember() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ to: scanned.toString(), openAt, rows: rows.slice(-400) }));
  } catch {
    /* The chart still has this session. */
  }
}

function recall() {
  if (loaded) return;
  loaded = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as { to?: string; openAt?: number; rows?: Row[] } | null;
    if (!raw) return;
    if (raw.to && /^\d+$/.test(raw.to)) scanned = BigInt(raw.to);
    if (raw.openAt && raw.openAt > 1_000_000_000) openAt = raw.openAt;
    if (Array.isArray(raw.rows)) rows = raw.rows.filter((row) => row && Number(row.t) > 0 && (row.quote === 0 || row.quote === 1));
  } catch {
    rows = [];
  }
}

async function pullChunk(from: bigint, to: bigint): Promise<{ logs: Awaited<ReturnType<typeof drpc.getLogs<typeof swapped>>>; to: bigint }> {
  if (to - from < 8_000n) {
    try {
      return { logs: await drpc.getLogs({ address: POOL, event: swapped, fromBlock: from, toBlock: to }), to };
    } catch {
      /* A wide free-plan range is refused. Ninety blocks still fit. */
    }
  }
  const end = from + 89n > to ? to : from + 89n;
  return { logs: await official.getLogs({ address: POOL, event: swapped, fromBlock: from, toBlock: end }), to: end };
}

async function stamp(block: bigint): Promise<number> {
  try {
    const row = await official.getBlock({ blockNumber: block });
    return Number(row.timestamp);
  } catch {
    return 0;
  }
}

async function scanOnce() {
  recall();
  if (!openPoolAddress()) return;
  if (!openAt) {
    openAt = await stamp(LIVE_BLOCK);
    if (openAt) remember();
  }
  const head = await official.getBlockNumber();
  let cursor = scanned > 0n ? scanned + 1n : LIVE_BLOCK;
  if (cursor < LIVE_BLOCK) cursor = LIVE_BLOCK;
  for (let step = 0; step < 6 && cursor <= head; step += 1) {
    const wide = cursor + 7999n > head ? head : cursor + 7999n;
    let got: Awaited<ReturnType<typeof pullChunk>>;
    try {
      got = await pullChunk(cursor, wide);
    } catch {
      break;
    }
    const { logs } = got;
    const times = new Map<string, number>();
    for (const log of logs) {
      const key = log.blockNumber.toString();
      if (!times.has(key)) times.set(key, await stamp(log.blockNumber));
      const when = times.get(key) ?? 0;
      if (!when || !log.args.sender || log.args.amountIn == null || log.args.amountOut == null) continue;
      const tx = log.transactionHash;
      if (rows.some((row) => row.tx === tx && row.amountIn === log.args.amountIn!.toString())) continue;
      rows.push({
        t: when,
        quote: log.args.quote === 1 ? 1 : 0,
        tapeIn: Boolean(log.args.tapeIn),
        amountIn: log.args.amountIn.toString(),
        amountOut: log.args.amountOut.toString(),
        who: log.args.sender,
        tx,
      });
    }
    cursor = got.to + 1n;
    scanned = got.to;
  }
  rows.sort((a, b) => a.t - b.t);
  remember();
}

function sync() {
  chain = chain.then(scanOnce, scanOnce);
  return chain;
}

function quotePx(quote: 0 | 1, bemPx: number, okbPx: number) {
  return quote === 0 ? bemPx : okbPx;
}

function quoteDecimals(quote: 0 | 1) {
  return quote === 0 ? 8 : 18;
}

function tradePx(row: Row, bemPx: number, okbPx: number): number {
  const px = quotePx(row.quote, bemPx, okbPx);
  if (!(px > 0)) return 0;
  const quote = Number(formatUnits(BigInt(row.tapeIn ? row.amountOut : row.amountIn), quoteDecimals(row.quote)));
  const tape = Number(formatUnits(BigInt(row.tapeIn ? row.amountIn : row.amountOut), 8));
  return tape > 0 ? (quote * px) / tape : 0;
}

function tradeUsd(row: Row, bemPx: number, okbPx: number): number {
  const px = quotePx(row.quote, bemPx, okbPx);
  const quote = Number(formatUnits(BigInt(row.tapeIn ? row.amountOut : row.amountIn), quoteDecimals(row.quote)));
  return quote > 0 && px > 0 ? quote * px : 0;
}

function candles(frame: TapeFrame, mark: number, bemPx: number, okbPx: number): Candle[] {
  if (!(mark > 0)) return [];
  const step = STEP[frame];
  const now = Math.floor(Date.now() / 1000);
  const born = openAt > 0 ? openAt : now;
  const first = Math.floor(Math.max(born, now - step * 119) / step) * step;
  const bars: Candle[] = [];
  for (let t = first; t <= now; t += step) bars.push({ t, o: mark, h: mark, l: mark, c: mark, v: 0 });
  for (const row of rows) {
    if (row.t < first) continue;
    const bucket = Math.floor(row.t / step) * step;
    const bar = bars.find((item) => item.t === bucket);
    const px = tradePx(row, bemPx, okbPx);
    if (!bar || !(px > 0)) continue;
    if ((bar.v ?? 0) === 0) bar.o = px;
    bar.h = Math.max(bar.h, px);
    bar.l = Math.min(bar.l, px);
    bar.c = px;
    bar.v = (bar.v ?? 0) + tradeUsd(row, bemPx, okbPx);
  }
  const last = bars[bars.length - 1];
  if (last) {
    last.c = mark;
    last.h = Math.max(last.h, mark);
    last.l = Math.min(last.l, mark);
  }
  return bars;
}

function printsOf(bemPx: number, okbPx: number): PoolPrint[] {
  return rows.slice(-16).reverse().map((row) => {
    const tape = BigInt(row.tapeIn ? row.amountIn : row.amountOut);
    const usd = tradeUsd(row, bemPx, okbPx);
    return {
      id: `${row.tx}:${row.amountIn}`,
      side: row.tapeIn ? "sell" : "buy",
      bem: pretty(tape, 8, 4),
      usdt: usd > 0 ? usd.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—",
      tx: row.tx as Hex,
      who: row.who,
    };
  });
}

export async function pullTapeBoard(frame: TapeFrame): Promise<{ price: number | null; bars: Candle[]; prints: PoolPrint[] }> {
  const pool = openPoolAddress();
  if (!pool) return { price: null, bars: [], prints: [] };
  const [bem, okb, bemOut, okbOut] = await Promise.all([
    official.readContract({
      address: pool,
      abi: [parseAbiItem("function bemPool() view returns (uint256 tape, uint256 quote, uint256 shares)")],
      functionName: "bemPool",
    }),
    official.readContract({
      address: pool,
      abi: [parseAbiItem("function okbPool() view returns (uint256 tape, uint256 quote, uint256 shares)")],
      functionName: "okbPool",
    }),
    quoteXBem("sell", 10n ** 8n),
    bookOkbRate(),
  ]);
  const bemPx = Number(formatUnits(bemOut, 6));
  const okbPx = Number(formatUnits(okbOut, 6));
  const tape = Number(formatUnits(bem[0] + okb[0], 8));
  const usd = Number(formatUnits(bem[1], 8)) * bemPx + Number(formatUnits(okb[1], 18)) * okbPx;
  const price = tape > 0 && usd > 0 ? usd / tape : null;
  const pending = sync().catch(() => undefined);
  if (rows.length === 0) await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 1200))]);
  return {
    price,
    bars: price ? candles(frame, price, bemPx, okbPx) : [],
    prints: printsOf(bemPx, okbPx),
  };
}
