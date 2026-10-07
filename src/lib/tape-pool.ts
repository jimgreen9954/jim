import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { connectXLayer, XLAYER } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";

export const TAPE_POOL = "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641" as const;
export const TAPE_TOKEN = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as const;
export const TAPE_USDT = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;
export const TAPE_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as const;
export const TAPE_FEE = "0x823b9F6A93Ac44Ce5A469823A336c15b6117054D" as const;
export const OPEN_USDT = 5_000n * 10n ** 6n;

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

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const client = createPublicClient({ transport: http(XLAYER.rpc) });

export type PoolSide = { tape: bigint; quote: bigint; shares: bigint };
export type TapePosition = { id: string; quote: number; term: number; unlock: number; shares: bigint };

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

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

async function approve(from: string, token: Hex, need: bigint) {
  const allowance = await client.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, TAPE_POOL],
  });
  if (allowance >= need) return;
  if (allowance > 0n) {
    await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [TAPE_POOL, 0n] }));
  }
  await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [TAPE_POOL, need] }));
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
