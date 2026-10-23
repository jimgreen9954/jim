import { createPublicClient, formatUnits, http, toHex, type Hex } from "viem";
import { BSC, FEE_TO } from "@/lib/bsc";
import { OKB } from "@/lib/okb";
import { TAPE_BEM, TAPE_USDT } from "@/lib/tape-pool";
import { TAPE } from "@/lib/tape-mine";
import { XLAYER } from "@/lib/xlayer";

export const FEE = FEE_TO;
const PAD = `0x${"0".repeat(24)}${FEE.slice(2).toLowerCase()}` as Hex;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;

const xClient = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 12_000 }) });
const bscClient = createPublicClient({ transport: http("https://bsc.publicnode.com", { timeout: 12_000 }) });

export type FeeChain = "x" | "bsc";

export type FeeRow = {
  chain: FeeChain;
  block: number;
  ts: number;
  tx: string;
  i: number;
  dir: "in" | "out";
  token: string;
  amount: string;
  other: string;
};

type Known = { symbol: string; decimals: number };

export const KNOWN: Record<string, Known> = {
  [TAPE_USDT.toLowerCase()]: { symbol: "USDT", decimals: 6 },
  [OKB.usdt.toLowerCase()]: { symbol: "USDT", decimals: 6 },
  [TAPE.toLowerCase()]: { symbol: "TAPE", decimals: 8 },
  [TAPE_BEM.toLowerCase()]: { symbol: "BEM", decimals: 8 },
  [OKB.wokb.toLowerCase()]: { symbol: "WOKB", decimals: 18 },
  [BSC.usdt.toLowerCase()]: { symbol: "USDT", decimals: 18 },
  [BSC.bem.toLowerCase()]: { symbol: "BEM", decimals: 8 },
  [BSC.wbnb.toLowerCase()]: { symbol: "WBNB", decimals: 18 },
  [BSC.btcb.toLowerCase()]: { symbol: "BTCB", decimals: 18 },
  [BSC.eth.toLowerCase()]: { symbol: "ETH", decimals: 18 },
  [BSC.zec.toLowerCase()]: { symbol: "ZEC", decimals: 18 },
  [BSC.xaut.toLowerCase()]: { symbol: "XAUT", decimals: 6 },
  ["0x39b58c3930d4352b2e4d8697ea6188c864455555"]: { symbol: "DAGOU", decimals: 18 },
  ["0x18d0e455b3491e09210292d3953157a4bf104444"]: { symbol: "比特币", decimals: 18 },
};

export const BSC_FEE_TOKENS: { token: Hex; symbol: string; decimals: number }[] = [
  { token: BSC.usdt, symbol: "USDT", decimals: 18 },
  { token: BSC.bem, symbol: "BEM", decimals: 8 },
  { token: BSC.wbnb, symbol: "WBNB", decimals: 18 },
  { token: BSC.btcb, symbol: "BTCB", decimals: 18 },
  { token: BSC.eth, symbol: "ETH", decimals: 18 },
  { token: BSC.zec, symbol: "ZEC", decimals: 18 },
  { token: BSC.xaut, symbol: "XAUT", decimals: 6 },
];

const X_BAL: { token: Hex; symbol: string; decimals: number }[] = [
  { token: TAPE_USDT, symbol: "USDT", decimals: 6 },
  { token: OKB.usdt, symbol: "USDT", decimals: 6 },
  { token: TAPE, symbol: "TAPE", decimals: 8 },
  { token: TAPE_BEM, symbol: "BEM", decimals: 8 },
  { token: OKB.wokb, symbol: "WOKB", decimals: 18 },
];

export type FeeBalance = { chain: FeeChain; symbol: string; token: string; amount: bigint; decimals: number };

const erc20 = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export function feeDecimals(token: string): number {
  return KNOWN[token.toLowerCase()]?.decimals ?? 18;
}

export function feeLabel(token: string): string {
  const key = token.toLowerCase();
  const known = KNOWN[key];
  if (!known) return `${token.slice(0, 6)}…${token.slice(-4)}`;
  const main = key === TAPE_USDT.toLowerCase() || key === BSC.usdt.toLowerCase();
  if (known.symbol === "USDT" && !main) return `USDT·${token.slice(2, 6)}`;
  return known.symbol;
}

export function feeText(amount: bigint, decimals: number): string {
  const text = formatUnits(amount, decimals);
  const [whole, frac = ""] = text.split(".");
  const cut = frac.slice(0, decimals > 8 ? 6 : 4).replace(/0+$/, "");
  const body = cut ? `${whole}.${cut}` : whole;
  const n = Number(body);
  if (!Number.isFinite(n)) return body;
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals > 8 ? 6 : 4 });
}

export function sgtStamp(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Singapore",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function sgtBounds(now: number): { day: number; month: number } {
  const sgt = new Date(now * 1000 + 8 * 3600 * 1000);
  const day = Math.floor(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) / 1000) - 8 * 3600;
  const month = Math.floor(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), 1) / 1000) - 8 * 3600;
  return { day, month };
}

type RpcLog = {
  address: Hex;
  blockNumber: Hex;
  data: Hex;
  logIndex: Hex;
  transactionHash: Hex;
  topics: Hex[];
  blockTimestamp?: Hex;
};

function addr(topic: Hex | undefined): string {
  if (!topic) return "";
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function parseLog(chain: FeeChain, log: RpcLog, sec: number, headBlock: number, headTs: number): FeeRow | null {
  const from = addr(log.topics[1]);
  const to = addr(log.topics[2]);
  const fee = FEE.toLowerCase();
  const dir = to === fee ? "in" : from === fee ? "out" : null;
  if (!dir) return null;
  const block = Number(BigInt(log.blockNumber));
  const stamped = log.blockTimestamp ? Number(BigInt(log.blockTimestamp)) : 0;
  const ts = stamped > 0 ? stamped : headTs > 0 ? headTs - Math.round((headBlock - block) * sec) : 0;
  let amount = 0n;
  try { amount = BigInt(log.data); } catch { return null; }
  if (amount <= 0n) return null;
  const other = dir === "in" ? from : to;
  return {
    chain,
    block,
    ts,
    tx: log.transactionHash,
    i: Number(BigInt(log.logIndex)),
    dir,
    token: log.address.toLowerCase(),
    amount: amount.toString(),
    other,
  };
}

async function logs(client: typeof xClient, from: bigint, to: bigint, topics: (Hex | null)[], address?: Hex): Promise<RpcLog[]> {
  const params: Record<string, unknown> = { fromBlock: toHex(from), toBlock: toHex(to), topics };
  if (address) params.address = address;
  const rows = await client.request({ method: "eth_getLogs", params: [params] });
  return rows as RpcLog[];
}

export async function feeHead(): Promise<{ x: { tip: bigint; ts: number }; bsc: { tip: bigint; ts: number } }> {
  const [xTip, bscTip] = await Promise.all([
    xClient.getBlockNumber(),
    bscClient.getBlockNumber(),
  ]);
  const [xBlock, bscBlock] = await Promise.all([
    xClient.getBlock({ blockNumber: xTip }),
    bscClient.getBlock({ blockNumber: bscTip }),
  ]);
  return {
    x: { tip: xTip, ts: Number(xBlock.timestamp) },
    bsc: { tip: bscTip, ts: Number(bscBlock.timestamp) },
  };
}

export async function pullX(from: bigint, to: bigint, headBlock: number, headTs: number): Promise<FeeRow[]> {
  const [inn, out] = await Promise.all([
    logs(xClient, from, to, [TRANSFER, null, PAD]),
    logs(xClient, from, to, [TRANSFER, PAD, null]),
  ]);
  const rows = [...inn, ...out].map((row) => parseLog("x", row, 1, headBlock, headTs)).filter((row): row is FeeRow => Boolean(row));
  return rows;
}

export async function pullBsc(token: Hex, from: bigint, to: bigint, headBlock: number, headTs: number): Promise<FeeRow[]> {
  const [inn, out] = await Promise.all([
    logs(bscClient, from, to, [TRANSFER, null, PAD], token),
    logs(bscClient, from, to, [TRANSFER, PAD, null], token),
  ]);
  return [...inn, ...out].map((row) => parseLog("bsc", row, 0.45, headBlock, headTs)).filter((row): row is FeeRow => Boolean(row));
}

async function balanceOf(client: typeof xClient, token: Hex): Promise<bigint> {
  try {
    return await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [FEE] });
  } catch {
    return 0n;
  }
}

export async function feeBalances(): Promise<FeeBalance[]> {
  const [okb, bnb, xTokens, bscTokens] = await Promise.all([
    xClient.getBalance({ address: FEE }).catch(() => 0n),
    bscClient.getBalance({ address: FEE }).catch(() => 0n),
    Promise.all(X_BAL.map(async (row) => ({ ...row, amount: await balanceOf(xClient, row.token) }))),
    Promise.all(BSC_FEE_TOKENS.map(async (row) => ({ ...row, amount: await balanceOf(bscClient, row.token) }))),
  ]);
  const rows: FeeBalance[] = [
    { chain: "x", symbol: "OKB", token: "native", amount: okb, decimals: 18 },
    { chain: "bsc", symbol: "BNB", token: "native", amount: bnb, decimals: 18 },
  ];
  for (const row of xTokens) rows.push({ chain: "x", symbol: feeLabel(row.token), token: row.token, amount: row.amount, decimals: row.decimals });
  for (const row of bscTokens) rows.push({ chain: "bsc", symbol: feeLabel(row.token), token: row.token, amount: row.amount, decimals: row.decimals });
  return rows;
}

export function rowKey(row: FeeRow): string {
  return `${row.chain}-${row.tx}-${row.i}`;
}
