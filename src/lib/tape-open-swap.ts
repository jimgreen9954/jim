import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { FEE_TO, TxPending } from "@/lib/bsc";
import { ensureProvider } from "@/lib/wallet";
import { XLAYER } from "@/lib/xlayer";

export const OPEN_POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as const;
const TAPE = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as const;
const BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as const;
const OKB_RESERVE = 2_000_000_000_000_000n;

const client = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 12_000 }) });
const poolAbi = parseAbi([
  "function FEE_TO() view returns (address)",
  "function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) view returns (uint256 fee, uint256 out)",
  "function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) payable",
]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

export type PoolQuote = 0 | 1;

async function ensureX() {
  const eth = await ensureProvider();
  const chain = await eth.request({ method: "eth_chainId" }) as string;
  if (Number(chain) === XLAYER.chainId) return;
  await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER.hex }] });
}

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  await ensureX();
  return await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  }) as Hex;
}

async function wait(hash: Hex) {
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 2_000 });
    if (receipt.status !== "success") throw new Error("reverted");
  } catch (err) {
    if (err instanceof Error && err.message === "reverted") throw err;
    throw new TxPending(hash);
  }
}

export async function poolBalances(owner: Hex): Promise<{ bem: bigint; okb: bigint; tape: bigint }> {
  const [bem, okb, tape] = await Promise.all([
    client.readContract({ address: BEM, abi: erc20, functionName: "balanceOf", args: [owner] }),
    client.getBalance({ address: owner }),
    client.readContract({ address: TAPE, abi: erc20, functionName: "balanceOf", args: [owner] }),
  ]);
  return { bem, okb, tape };
}

export async function previewPool(quote: PoolQuote, tapeIn: boolean, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const row = await client.readContract({
    address: OPEN_POOL,
    abi: poolAbi,
    functionName: "previewSwap",
    args: [quote, tapeIn, amountIn],
  });
  return row[1];
}

export function poolAmount(text: string, decimals: number): bigint {
  const clean = text.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("amount");
  return parseUnits(clean, decimals);
}

export function poolText(amount: bigint, decimals: number): string {
  const [whole, frac = ""] = formatUnits(amount, decimals).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

/** Swap against the open TAPE pool. Limit orders stay on the workshop book. */
export async function swapPool(from: string, quote: PoolQuote, tapeIn: boolean, amountIn: bigint): Promise<Hex> {
  const feeTo = await client.readContract({ address: OPEN_POOL, abi: poolAbi, functionName: "FEE_TO" });
  if (feeTo.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const out = await previewPool(quote, tapeIn, amountIn);
  if (out <= 0n) throw new Error("empty");
  const minOut = out * 99n / 100n;
  const token = tapeIn ? TAPE : quote === 0 ? BEM : null;
  if (token) {
    const allowance = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, OPEN_POOL] });
    if (allowance < amountIn) {
      if (allowance > 0n) await wait(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OPEN_POOL, 0n] })));
      await wait(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OPEN_POOL, amountIn] })));
    }
  }
  const value = quote === 1 && !tapeIn ? amountIn : 0n;
  if (value > 0n) {
    const okb = await client.getBalance({ address: from as Hex });
    if (okb < value + OKB_RESERVE) throw new Error("gas");
  }
  const hash = await send(
    from,
    OPEN_POOL,
    encodeFunctionData({ abi: poolAbi, functionName: "swap", args: [quote, tapeIn, amountIn, minOut] }),
    value,
  );
  await wait(hash);
  return hash;
}
