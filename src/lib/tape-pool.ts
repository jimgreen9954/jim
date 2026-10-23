import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { connectXLayer, quoteGas, XLAYER } from "@/lib/xlayer";
import { getProvider, walletKind } from "@/lib/wallet";
import { TAPE_POOL_BYTECODE } from "@/lib/tape-pool-artifact";
import { quoteXBem } from "@/lib/okb";

export const TAPE_POOL = "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641" as const;
export const TAPE_TOKEN = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as const;
export const TAPE_USDT = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;
export const TAPE_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as const;
export const TAPE_FEE = "0x823b9F6A93Ac44Ce5A469823A336c15b6117054D" as const;
export const OPEN_USDT = 5_000n * 10n ** 6n;
export const OPEN_BEM = 100n * 10n ** 8n;
export const OPEN_OKB = 61n * 10n ** 18n;
export const OPEN_TAPE = 27_800n * 10n ** 8n;
export const TAPE_POOL_V2 = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as Hex;
const OPEN_KEY = "tapeliquid-tape-pool-v2";

export const TAPE_TERMS = [
  { id: 0, zh: "三个月", en: "3 months", days: 90 },
  { id: 1, zh: "六个月", en: "6 months", days: 180 },
  { id: 2, zh: "一年", en: "1 year", days: 365 },
  { id: 3, zh: "两年", en: "2 years", days: 730 },
  { id: 4, zh: "三年", en: "3 years", days: 1095 },
] as const;

const abi = parseAbi([
  "function usdtPool() view returns (uint256 tape, uint256 quote, uint256 shares)",
  "function bemPool() view returns (uint256 tape, uint256 quote, uint256 shares)",
  "function live() view returns (bool)",
  "function position(uint256) view returns (address owner, uint8 quote, uint8 term, uint64 unlock, uint256 shares)",
  "function ownedCount(address) view returns (uint256)",
  "function ownedId(address,uint256) view returns (uint256)",
  "function previewSwap(uint8,bool,uint256) view returns (uint256 fee, uint256 out)",
  "function add(uint8,uint8,uint256,uint256) returns (uint256)",
  "function remove(uint256)",
  "function swap(uint8,bool,uint256,uint256) returns (uint256)",
]);

const openAbi = parseAbi([
  "function bemPool() view returns (uint256 tape, uint256 quote, uint256 shares)",
  "function okbPool() view returns (uint256 tape, uint256 quote, uint256 shares)",
  "function live() view returns (bool)",
  "function nextId() view returns (uint256)",
  "function position(uint256) view returns (address owner, uint8 quote, uint8 term, uint64 unlock, uint256 shares)",
  "function ownedCount(address) view returns (uint256)",
  "function ownedId(address,uint256) view returns (uint256)",
  "function previewSwap(uint8,bool,uint256) view returns (uint256 fee, uint256 out)",
  "function add(uint8,uint8,uint256,uint256) payable returns (uint256)",
  "function remove(uint256)",
  "function swap(uint8,bool,uint256,uint256) payable returns (uint256)",
]);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const client = createPublicClient({ transport: http(XLAYER.rpc) });

export type PoolSide = { tape: bigint; quote: bigint; shares: bigint };
export type TapePosition = { id: string; quote: number; term: number; unlock: number; shares: bigint };
export type PoolLock = { id: string; quote: number; term: number; unlock: number };

export async function readTapePool(account: string | null): Promise<{
  live: boolean;
  usdt: PoolSide;
  bem: PoolSide;
  tape: bigint;
  usdtBal: bigint;
  bemBal: bigint;
  positions: TapePosition[];
}> {
  const [live, usdt, bem, tape, usdtBal, bemBal, count] = await Promise.all([
    client.readContract({ address: TAPE_POOL, abi, functionName: "live" }),
    client.readContract({ address: TAPE_POOL, abi, functionName: "usdtPool" }),
    client.readContract({ address: TAPE_POOL, abi, functionName: "bemPool" }),
    account ? client.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [account as Hex] }) : Promise.resolve(0n),
    account ? client.readContract({ address: TAPE_USDT, abi: erc20, functionName: "balanceOf", args: [account as Hex] }) : Promise.resolve(0n),
    account ? client.readContract({ address: TAPE_BEM, abi: erc20, functionName: "balanceOf", args: [account as Hex] }) : Promise.resolve(0n),
    account ? client.readContract({ address: TAPE_POOL, abi, functionName: "ownedCount", args: [account as Hex] }) : Promise.resolve(0n),
  ]);
  const positions: TapePosition[] = [];
  const n = Number(count);
  if (account && n > 0) {
    const start = Math.max(0, n - 20);
    const ids = await Promise.all(
      Array.from({ length: n - start }, (_, i) =>
        client.readContract({ address: TAPE_POOL, abi, functionName: "ownedId", args: [account as Hex, BigInt(start + i)] }),
      ),
    );
    const rows = await Promise.all(ids.map((id) => client.readContract({ address: TAPE_POOL, abi, functionName: "position", args: [id] })));
    rows.forEach((row, i) => {
      const shares = row[4];
      if (typeof shares !== "bigint" || shares === 0n) return;
      positions.push({ id: ids[i].toString(), quote: Number(row[1]), term: Number(row[2]), unlock: Number(row[3]), shares });
    });
  }
  return {
    live,
    usdt: { tape: usdt[0], quote: usdt[1], shares: usdt[2] },
    bem: { tape: bem[0], quote: bem[1], shares: bem[2] },
    tape,
    usdtBal,
    bemBal,
    positions,
  };
}

export function tapeUnits(text: string): bigint {
  return parseUnits(text.trim() || "0", 8);
}

export function quoteUnits(quote: 0 | 1, text: string): bigint {
  return parseUnits(text.trim() || "0", quote === 0 ? 6 : 8);
}

export function showTape(amount: bigint, digits = 4): string {
  const n = Number(formatUnits(amount, 8));
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits }) : formatUnits(amount, 8);
}

export function showQuote(quote: 0 | 1, amount: bigint): string {
  const n = Number(formatUnits(amount, quote === 0 ? 6 : 8));
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: quote === 0 ? 2 : 4 }) : formatUnits(amount, quote === 0 ? 6 : 8);
}

async function send(from: string, to: Hex | undefined, data: Hex, value = 0n): Promise<Hex> {
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const tx: { from: string; to?: Hex; data: Hex; value: string; chainId?: string; gas?: Hex } = { from, data, value: `0x${value.toString(16)}` };
  if (walletKind() !== "binance") tx.chainId = XLAYER.hex;
  if (to) {
    tx.to = to;
    const gas = await quoteGas(from, to, data, value);
    if (gas) tx.gas = gas;
  }
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [tx],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

async function approve(from: string, token: Hex, need: bigint, spender: Hex = TAPE_POOL) {
  const allowance = await client.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, spender],
  });
  if (allowance >= need) return;
  if (allowance > 0n) {
    await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] }));
  }
  await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, need] }));
}

export async function addTapePool(from: string, quote: 0 | 1, term: number, tapeIn: bigint, quoteIn: bigint): Promise<Hex> {
  await approve(from, TAPE_TOKEN, tapeIn);
  await approve(from, quote === 0 ? TAPE_USDT : TAPE_BEM, quoteIn);
  const data = encodeFunctionData({ abi, functionName: "add", args: [quote, term, tapeIn, quoteIn] });
  await client.call({ account: from as Hex, to: TAPE_POOL, data });
  return send(from, TAPE_POOL, data);
}

export async function removeTapePool(from: string, id: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "remove", args: [id] });
  await client.call({ account: from as Hex, to: TAPE_POOL, data });
  return send(from, TAPE_POOL, data);
}

export async function swapTapePool(from: string, quote: 0 | 1, tapeIn: boolean, amountIn: bigint): Promise<Hex> {
  const preview = await client.readContract({
    address: TAPE_POOL,
    abi,
    functionName: "previewSwap",
    args: [quote, tapeIn, amountIn],
  });
  const minOut = (preview[1] * 99n) / 100n;
  const data = encodeFunctionData({ abi, functionName: "swap", args: [quote, tapeIn, amountIn, minOut] });
  await approve(from, tapeIn ? TAPE_TOKEN : quote === 0 ? TAPE_USDT : TAPE_BEM, amountIn);
  await client.call({ account: from as Hex, to: TAPE_POOL, data });
  return send(from, TAPE_POOL, data);
}

export async function previewTapeSwap(quote: 0 | 1, tapeIn: boolean, amountIn: bigint): Promise<{ fee: bigint; out: bigint }> {
  const row = await client.readContract({
    address: TAPE_POOL,
    abi,
    functionName: "previewSwap",
    args: [quote, tapeIn, amountIn],
  });
  return { fee: row[0], out: row[1] };
}

export function openPoolAddress(): Hex | null {
  if (TAPE_POOL_V2) return TAPE_POOL_V2;
  if (typeof window === "undefined") return null;
  try {
    const saved = window.localStorage.getItem(OPEN_KEY);
    return saved && /^0x[a-fA-F0-9]{40}$/.test(saved) ? (saved as Hex) : null;
  } catch {
    return null;
  }
}

export function openSplit(bemPx: number, okbPx: number): { vb: number; vo: number; usd: number; px: number; tapeBem: number; tapeOkb: number } | null {
  if (!(bemPx > 0) || !(okbPx > 0)) return null;
  const vb = 100 * bemPx;
  const vo = 61 * okbPx;
  const usd = vb + vo;
  if (!(usd > 0)) return null;
  const tapeBem = (27_800 * vb) / usd;
  return { vb, vo, usd, px: usd / 27_800, tapeBem, tapeOkb: 27_800 - tapeBem };
}

function trimNum(n: number, digits: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function openQuoteUnits(quote: 0 | 1, text: string): bigint {
  return parseUnits(text.trim() || "0", quote === 0 ? 8 : 18);
}

export function showOpenQuote(quote: 0 | 1, amount: bigint): string {
  return trimNum(Number(formatUnits(amount, quote === 0 ? 8 : 18)), quote === 0 ? 4 : 4);
}

async function positionsOf(pool: Hex, account: string): Promise<TapePosition[]> {
  const count = await client.readContract({ address: pool, abi: openAbi, functionName: "ownedCount", args: [account as Hex] });
  const n = Number(count);
  if (n <= 0) return [];
  const start = Math.max(0, n - 20);
  const ids = await Promise.all(
    Array.from({ length: n - start }, (_, i) =>
      client.readContract({ address: pool, abi: openAbi, functionName: "ownedId", args: [account as Hex, BigInt(start + i)] }),
    ),
  );
  const rows = await Promise.all(ids.map((id) => client.readContract({ address: pool, abi: openAbi, functionName: "position", args: [id] })));
  const positions: TapePosition[] = [];
  rows.forEach((row, i) => {
    const shares = row[4];
    if (typeof shares !== "bigint" || shares === 0n) return;
    positions.push({ id: ids[i].toString(), quote: Number(row[1]), term: Number(row[2]), unlock: Number(row[3]), shares });
  });
  return positions;
}

export async function readPoolLocks(): Promise<PoolLock[]> {
  const address = openPoolAddress();
  if (!address) return [];
  const next = await client.readContract({ address, abi: openAbi, functionName: "nextId" });
  const n = Math.min(Math.max(Number(next) - 1, 0), 8);
  if (n < 1) return [];
  const rows = await Promise.all(
    Array.from({ length: n }, (_, i) => client.readContract({ address, abi: openAbi, functionName: "position", args: [BigInt(i + 1)] })),
  );
  const locks: PoolLock[] = [];
  rows.forEach((row, i) => {
    const shares = row[4];
    if (typeof shares !== "bigint" || shares === 0n) return;
    locks.push({ id: String(i + 1), quote: Number(row[1]), term: Number(row[2]), unlock: Number(row[3]) });
  });
  return locks;
}

export async function readOpenPool(account: string | null): Promise<{
  address: Hex | null;
  live: boolean;
  bem: PoolSide;
  okb: PoolSide;
  tape: bigint;
  bemBal: bigint;
  okbBal: bigint;
  positions: TapePosition[];
}> {
  const empty = { tape: 0n, quote: 0n, shares: 0n };
  const address = openPoolAddress();
  if (!address) return { address: null, live: false, bem: empty, okb: empty, tape: 0n, bemBal: 0n, okbBal: 0n, positions: [] };
  const [live, bem, okb, tape, bemBal, okbBal, positions] = await Promise.all([
    client.readContract({ address, abi: openAbi, functionName: "live" }),
    client.readContract({ address, abi: openAbi, functionName: "bemPool" }),
    client.readContract({ address, abi: openAbi, functionName: "okbPool" }),
    account ? client.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [account as Hex] }) : Promise.resolve(0n),
    account ? client.readContract({ address: TAPE_BEM, abi: erc20, functionName: "balanceOf", args: [account as Hex] }) : Promise.resolve(0n),
    account ? client.getBalance({ address: account as Hex }) : Promise.resolve(0n),
    account ? positionsOf(address, account) : Promise.resolve([] as TapePosition[]),
  ]);
  return {
    address,
    live,
    bem: { tape: bem[0], quote: bem[1], shares: bem[2] },
    okb: { tape: okb[0], quote: okb[1], shares: okb[2] },
    tape,
    bemBal,
    okbBal,
    positions,
  };
}

export async function openTapePrice(): Promise<number | null> {
  const address = openPoolAddress();
  if (!address) return null;
  const [bem, bemOut] = await Promise.all([
    client.readContract({ address, abi: openAbi, functionName: "bemPool" }),
    quoteXBem("sell", 10n ** 8n),
  ]);
  const tape = Number(formatUnits(bem[0], 8));
  const usd = Number(formatUnits(bem[1], 8)) * Number(formatUnits(bemOut, 6));
  return tape > 0 && usd > 0 ? usd / tape : null;
}

export async function deployOpenPool(from: string): Promise<Hex> {
  if (from.toLowerCase() !== TAPE_FEE.toLowerCase()) throw new Error("onlyfee");
  const hash = await send(from, undefined, TAPE_POOL_BYTECODE);
  const receipt = await client.getTransactionReceipt({ hash });
  const landed = receipt.contractAddress;
  if (!landed) throw new Error("revert");
  try {
    window.localStorage.setItem(OPEN_KEY, landed);
  } catch {
    /* The receipt still has the address. */
  }
  return landed;
}

export async function addOpenPool(from: string, quote: 0 | 1, term: number, tapeIn: bigint, quoteIn: bigint): Promise<Hex> {
  const pool = openPoolAddress();
  if (!pool) throw new Error("pool");
  await approve(from, TAPE_TOKEN, tapeIn, pool);
  const value = quote === 1 ? quoteIn : 0n;
  if (quote === 0) await approve(from, TAPE_BEM, quoteIn, pool);
  const data = encodeFunctionData({ abi: openAbi, functionName: "add", args: [quote, term, tapeIn, quoteIn] });
  await client.call({ account: from as Hex, to: pool, data, value });
  return send(from, pool, data, value);
}

export async function removeOpenPool(from: string, id: bigint): Promise<Hex> {
  const pool = openPoolAddress();
  if (!pool) throw new Error("pool");
  const data = encodeFunctionData({ abi: openAbi, functionName: "remove", args: [id] });
  await client.call({ account: from as Hex, to: pool, data });
  return send(from, pool, data);
}

function revertText(error: unknown): string {
  const parts: string[] = [];
  let cur: unknown = error;
  for (let i = 0; cur && i < 5; i += 1) {
    if (cur instanceof Error) parts.push(cur.message);
    const extra = cur as { shortMessage?: string; details?: string; cause?: unknown };
    if (extra.shortMessage) parts.push(extra.shortMessage);
    if (typeof extra.details === "string") parts.push(extra.details);
    cur = extra.cause;
  }
  return parts.join(" ");
}

export async function swapOpenPool(from: string, quote: 0 | 1, tapeIn: boolean, amountIn: bigint, minFloor?: bigint): Promise<Hex> {
  const pool = openPoolAddress();
  if (!pool) throw new Error("pool");
  const preview = await client.readContract({
    address: pool,
    abi: openAbi,
    functionName: "previewSwap",
    args: [quote, tapeIn, amountIn],
  });
  const quoted = (preview[1] * 99n) / 100n;
  const minOut = minFloor != null && minFloor > 0n ? minFloor : quoted;
  if (preview[1] < minOut) throw new Error("quote-moved");
  const data = encodeFunctionData({ abi: openAbi, functionName: "swap", args: [quote, tapeIn, amountIn, minOut] });
  const value = !tapeIn && quote === 1 ? amountIn : 0n;
  if (tapeIn) await approve(from, TAPE_TOKEN, amountIn, pool);
  else if (quote === 0) await approve(from, TAPE_BEM, amountIn, pool);
  let failed: unknown = null;
  for (let i = 0; i < 4; i += 1) {
    try {
      await client.call({ account: from as Hex, to: pool, data, value });
      failed = null;
      break;
    } catch (error) {
      failed = error;
      const text = revertText(error);
      if (!/allow|allowance/i.test(text) || i === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
  if (failed) throw failed;
  return send(from, pool, data, value);
}

export async function previewOpenSwap(quote: 0 | 1, tapeIn: boolean, amountIn: bigint): Promise<{ fee: bigint; out: bigint }> {
  const pool = openPoolAddress();
  if (!pool) return { fee: 0n, out: 0n };
  const row = await client.readContract({
    address: pool,
    abi: openAbi,
    functionName: "previewSwap",
    args: [quote, tapeIn, amountIn],
  });
  return { fee: row[0], out: row[1] };
}
