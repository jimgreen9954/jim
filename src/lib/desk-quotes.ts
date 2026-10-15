import { createPublicClient, http } from "viem";
import { BSC } from "@/lib/bsc";

export type DeskQuote = { id: "bem" | "btc" | "eth" | "zec" | "bnb"; px: number; chg: number | null };

const MAJORS = [
  ["btc", "BTC-USDT"],
  ["eth", "ETH-USDT"],
  ["zec", "ZEC-USDT"],
  ["bnb", "BNB-USDT"],
] as const;

const slotAbi = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint160" },
      { type: "int24" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint8" },
      { type: "bool" },
    ],
  },
] as const;

function num(text: string | undefined): number {
  const n = Number(String(text ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** USDT is token0, BEM is token1 with 8 decimals. One slot0 read, not a swap quote. */
function bemFromSqrt(sqrt: bigint): number {
  if (sqrt <= 0n) return 0;
  const scaled = ((1n << 192n) * 1_000_000_000_000n) / (sqrt * sqrt) / 10n ** 10n;
  return Number(scaled) / 1e12;
}

async function bemMark(): Promise<number> {
  const client = createPublicClient({ transport: http(BSC.rpc, { timeout: 2_500 }) });
  const row = await client.readContract({ address: BSC.pool, abi: slotAbi, functionName: "slot0" });
  return bemFromSqrt(row[0]);
}

async function one(id: DeskQuote["id"], inst: string): Promise<DeskQuote | null> {
  const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${inst}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(2_500),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: { last?: string; open24h?: string }[] };
  const row = body.data?.[0];
  const px = num(row?.last);
  if (!px) return null;
  const open = num(row?.open24h);
  return { id, px, chg: open > 0 ? ((px - open) / open) * 100 : null };
}

async function majors(): Promise<DeskQuote[]> {
  const rows = await Promise.all(MAJORS.map(([id, inst]) => one(id, inst).catch(() => null)));
  return rows.flatMap((row) => (row ? [row] : []));
}

let held: { at: number; rows: DeskQuote[] } | null = null;
let flight: Promise<DeskQuote[]> | null = null;

async function load(): Promise<DeskQuote[]> {
  const [bem, rest] = await Promise.all([bemMark().catch(() => 0), majors().catch(() => [])]);
  const rows: DeskQuote[] = [...(bem > 0 ? [{ id: "bem" as const, px: bem, chg: null }] : []), ...rest];
  if (rows.length > 0) held = { at: Date.now(), rows };
  return rows.length > 0 ? rows : held?.rows ?? [];
}

/** Cached marks. A stale row is returned at once while the next read runs. */
export function pullDeskQuotes(): Promise<DeskQuote[]> {
  if (held && Date.now() - held.at < 8_000) return Promise.resolve(held.rows);
  if (!flight) {
    flight = load().finally(() => {
      flight = null;
    });
  }
  if (held?.rows.length) return Promise.resolve(held.rows);
  return flight;
}
