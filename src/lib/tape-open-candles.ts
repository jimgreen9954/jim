import { createPublicClient, formatUnits, http, parseAbiItem, type Hex } from "viem";
import type { Candle, CandleFrame } from "@/lib/bem-ohlcv";
import { quoteOkb } from "@/lib/okb";

const POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as const;
const OPEN_BLOCK = 73721116n;
const swapped = parseAbiItem("event Swapped(address indexed sender, uint8 quote, bool tapeIn, uint256 amountIn, uint256 amountOut)");
const poolAbi = [
  { type: "function", name: "bemPool", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "okbPool", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
] as const;

const SPAN: Record<CandleFrame, number> = {
  "15s": 15, "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800, "1M": 2592000, "3M": 7776000, "1y": 31536000,
};

type Print = { t: number; quote: 0 | 1; tapeIn: boolean; amountIn: string; amountOut: string; tx: Hex; sender?: string };

const drpc = createPublicClient({ transport: http("https://xlayer.drpc.org", { timeout: 12_000 }) });
const official = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 12_000 }) });

let prints: Print[] = [];
let cursor = 0n;
let openAt = 0;
let loaded = false;
let scanning = false;

function store() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem("tapeliquid-open-pool-log", JSON.stringify({
      to: cursor.toString(),
      openAt,
      rows: prints.slice(-400),
    }));
  } catch {
    /* The in-memory book still draws this session. */
  }
}

function restore() {
  if (loaded) return;
  loaded = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = JSON.parse(localStorage.getItem("tapeliquid-open-pool-log") || "null") as { to?: string; openAt?: number; rows?: Print[] } | null;
    if (!raw) return;
    if (raw.to && /^\d+$/.test(raw.to)) cursor = BigInt(raw.to);
    if (raw.openAt && raw.openAt > 1e9) openAt = raw.openAt;
    if (Array.isArray(raw.rows)) prints = raw.rows.filter((row) => row && row.t > 0 && (row.quote === 0 || row.quote === 1));
  } catch {
    prints = [];
  }
}

async function stamp(block: bigint): Promise<number> {
  try {
    const row = await official.getBlock({ blockNumber: block });
    return Number(row.timestamp);
  } catch {
    return 0;
  }
}

async function readWindow(from: bigint, to: bigint): Promise<{ logs: Awaited<ReturnType<typeof official.getLogs>>; to: bigint }> {
  if (to - from < 8000n) {
    try {
      const logs = await drpc.getLogs({ address: POOL, event: swapped, fromBlock: from, toBlock: to });
      return { logs, to };
    } catch {
      /* Free dRPC often refuses a wide window. The public RPC takes 90 blocks. */
    }
  }
  const end = from + 89n > to ? to : from + 89n;
  const logs = await official.getLogs({ address: POOL, event: swapped, fromBlock: from, toBlock: end });
  return { logs, to: end };
}

function kick() {
  if (scanning) return;
  scanning = true;
  void (async () => {
    restore();
    if (!openAt) {
      openAt = await stamp(OPEN_BLOCK);
      if (openAt) store();
    }
    while (true) {
      try {
        const tip = await official.getBlockNumber();
        let from = cursor > 0n ? cursor + 1n : OPEN_BLOCK;
        if (from < OPEN_BLOCK) from = OPEN_BLOCK;
        if (from > tip) {
          await new Promise((resolve) => setTimeout(resolve, 12_000));
          continue;
        }
        const want = from + 7999n > tip ? tip : from + 7999n;
        const got = await readWindow(from, want);
        const seen = new Map<string, number>();
        for (const log of got.logs) {
          if (!("args" in log) || log.blockNumber == null || log.transactionHash == null) continue;
          const args = log.args as { sender?: string; quote?: number | bigint; tapeIn?: boolean; amountIn?: bigint; amountOut?: bigint };
          if (!args.sender || args.amountIn == null || args.amountOut == null || args.quote == null) continue;
          const key = log.blockNumber.toString();
          if (!seen.has(key)) seen.set(key, await stamp(log.blockNumber));
          const t = seen.get(key) ?? 0;
          if (!t) continue;
          const id = `${log.transactionHash}:${args.amountIn}`;
          if (prints.some((row) => `${row.tx}:${row.amountIn}` === id)) continue;
          prints.push({
            t,
            quote: Number(args.quote) === 1 ? 1 : 0,
            tapeIn: Boolean(args.tapeIn),
            amountIn: args.amountIn.toString(),
            amountOut: args.amountOut.toString(),
            tx: log.transactionHash,
            sender: args.sender,
          });
        }
        prints.sort((a, b) => a.t - b.t);
        cursor = got.to;
        store();
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
  })();
}

function usdOf(row: Print, bemUsd: number, okbUsd: number): number {
  const quoteUsd = row.quote === 0 ? bemUsd : okbUsd;
  if (!(quoteUsd > 0)) return 0;
  const quoteDec = row.quote === 0 ? 8 : 18;
  const quoteAmt = Number(formatUnits(BigInt(row.tapeIn ? row.amountOut : row.amountIn), quoteDec));
  const tapeAmt = Number(formatUnits(BigInt(row.tapeIn ? row.amountIn : row.amountOut), 8));
  return tapeAmt > 0 ? (quoteAmt * quoteUsd) / tapeAmt : 0;
}

function fold(frame: CandleFrame, price: number, bemUsd: number, okbUsd: number): Candle[] {
  if (!(price > 0)) return [];
  const span = SPAN[frame] || 3600;
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(Math.max(openAt > 0 ? openAt : now, now - span * 119) / span) * span;
  const bars: Candle[] = [];
  for (let t = start; t <= now; t += span) bars.push({ t, o: price, h: price, l: price, c: price, v: 0 });
  for (const row of prints) {
    if (row.t < start) continue;
    const bucket = Math.floor(row.t / span) * span;
    const bar = bars.find((item) => item.t === bucket);
    const px = usdOf(row, bemUsd, okbUsd);
    if (!bar || !(px > 0)) continue;
    if ((bar.v ?? 0) === 0) bar.o = px;
    bar.h = Math.max(bar.h, px);
    bar.l = Math.min(bar.l, px);
    bar.c = px;
    const quoteDec = row.quote === 0 ? 8 : 18;
    const quoteUsd = row.quote === 0 ? bemUsd : okbUsd;
    const quoteAmt = Number(formatUnits(BigInt(row.tapeIn ? row.amountOut : row.amountIn), quoteDec));
    bar.v = (bar.v ?? 0) + quoteAmt * quoteUsd;
  }
  const last = bars.at(-1);
  if (last) {
    last.c = price;
    last.h = Math.max(last.h, price);
    last.l = Math.min(last.l, price);
  }
  return bars;
}

export type OpenPrint = {
  t: number;
  quote: 0 | 1;
  tapeIn: boolean;
  tape: number;
  usd: number;
  tx: string;
  sender: string;
};

export type OpenBook = {
  price: number;
  change: number;
  volume: number;
  bemUsd: number;
  okbUsd: number;
  bemTape: bigint;
  bemQuote: bigint;
  okbTape: bigint;
  okbQuote: bigint;
  prints: OpenPrint[];
};

/** Reserves, dollar mid, and the swaps already read. The book is this pool, not the workshop. */
export async function readOpenBook(): Promise<OpenBook> {
  kick();
  restore();
  const [bem, okb, bemPx, okbRaw] = await Promise.all([
    official.readContract({ address: POOL, abi: poolAbi, functionName: "bemPool" }),
    official.readContract({ address: POOL, abi: poolAbi, functionName: "okbPool" }),
    bemUsd(),
    quoteOkb("sell", 10n ** 18n).catch(() => 0n),
  ]);
  const okbPx = Number(formatUnits(okbRaw, 6));
  const bemQuote = bemPx > 0 ? bemPx : okbPx > 0 && okb[0] > 0n && bem[0] > 0n && bem[1] > 0n
    ? okbPx * (Number(formatUnits(okb[1], 18)) / Number(formatUnits(okb[0], 8))) / (Number(formatUnits(bem[1], 8)) / Number(formatUnits(bem[0], 8)))
    : 0;
  const tape = Number(formatUnits(bem[0] + okb[0], 8));
  const usd = Number(formatUnits(bem[1], 8)) * bemQuote + Number(formatUnits(okb[1], 18)) * okbPx;
  const price = tape > 0 && usd > 0 ? usd / tape : 0;
  const now = Math.floor(Date.now() / 1000);
  let volume = 0;
  let open = 0;
  const shown: OpenPrint[] = [];
  for (const row of prints) {
    const px = usdOf(row, bemQuote, okbPx);
    const tapeAmt = Number(formatUnits(BigInt(row.tapeIn ? row.amountIn : row.amountOut), 8));
    const quoteDec = row.quote === 0 ? 8 : 18;
    const quoteUsd = row.quote === 0 ? bemQuote : okbPx;
    const quoteAmt = Number(formatUnits(BigInt(row.tapeIn ? row.amountOut : row.amountIn), quoteDec));
    if (row.t >= now - 86_400) {
      volume += quoteAmt * quoteUsd;
      if (!(open > 0) && px > 0) open = px;
    }
    if (px > 0 && tapeAmt > 0) shown.push({ t: row.t, quote: row.quote, tapeIn: row.tapeIn, tape: tapeAmt, usd: px, tx: row.tx, sender: row.sender ?? "" });
  }
  return {
    price,
    change: open > 0 && price > 0 ? (price - open) / open : 0,
    volume,
    bemUsd: bemQuote,
    okbUsd: okbPx,
    bemTape: bem[0],
    bemQuote: bem[1],
    okbTape: okb[0],
    okbQuote: okb[1],
    prints: shown.slice(-40).reverse(),
  };
}

async function bemUsd(): Promise<number> {
  try {
    const { geckoFetch } = await import("@/lib/gecko-pace");
    const res = await geckoFetch("https://api.geckoterminal.com/api/v2/networks/x-layer/tokens/0x60e62Efa9405d6873C5deaBD4E6CC91c25363952");
    if (!res.ok) return 0;
    const body = (await res.json()) as { data?: { attributes?: { price_usd?: string } } };
    const n = Number(body.data?.attributes?.price_usd);
    return n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Candles from the open TAPE pool, not a Gecko listing of the old lock. */
export async function tapePoolCandles(frame: CandleFrame): Promise<Candle[]> {
  kick();
  const [bem, okb, bemPx, okbRaw] = await Promise.all([
    official.readContract({ address: POOL, abi: poolAbi, functionName: "bemPool" }),
    official.readContract({ address: POOL, abi: poolAbi, functionName: "okbPool" }),
    bemUsd(),
    quoteOkb("sell", 10n ** 18n).catch(() => 0n),
  ]);
  const okbPx = Number(formatUnits(okbRaw, 6));
  const bemQuote = bemPx > 0 ? bemPx : okbPx > 0 && okb[0] > 0n && bem[0] > 0n && bem[1] > 0n
    ? okbPx * (Number(formatUnits(okb[1], 18)) / Number(formatUnits(okb[0], 8))) / (Number(formatUnits(bem[1], 8)) / Number(formatUnits(bem[0], 8)))
    : 0;
  const tape = Number(formatUnits(bem[0] + okb[0], 8));
  const usd = Number(formatUnits(bem[1], 8)) * bemQuote + Number(formatUnits(okb[1], 18)) * okbPx;
  const price = tape > 0 && usd > 0 ? usd / tape : 0;
  return fold(frame, price, bemQuote, okbPx);
}
