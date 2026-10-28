import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { FEE_TO, TxPending, XLAYER, XLAYER_SAFE } from "@/lib/chain-marks";
import { deskParts } from "@/lib/invite-cut";
import { ensureProvider } from "@/lib/wallet";

export const OPEN_POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as const;
const TAPE = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as const;
const BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as const;
const USDT = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;
const ROUTER = "0x881fB2f98c13d521009464e7D1CBf16E1b394e8E" as const;
const WOKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
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
  "function transfer(address,uint256) returns (bool)",
]);
const v2 = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
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

export async function poolBalances(owner: Hex): Promise<{ bem: bigint; okb: bigint; tape: bigint; usdt: bigint }> {
  const [bem, okb, tape, usdt] = await Promise.all([
    client.readContract({ address: BEM, abi: erc20, functionName: "balanceOf", args: [owner] }),
    client.getBalance({ address: owner }),
    client.readContract({ address: TAPE, abi: erc20, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [owner] }),
  ]);
  return { bem, okb, tape, usdt };
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

async function approveToken(from: string, token: Hex, need: bigint) {
  const allowance = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, ROUTER] });
  if (allowance >= need) return;
  if (allowance > 0n) await wait(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [ROUTER, 0n] })));
  await wait(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [ROUTER, need] })));
}

/** USDT0 on X Layer. This is the balance the ticket shows, not the other USDT. */
export async function quoteUsdt0Okb(side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const path = side === "buy" ? [USDT, WOKB] : [WOKB, USDT];
  const amounts = await client.readContract({ address: ROUTER, abi: v2, functionName: "getAmountsOut", args: [amountIn, path] });
  return amounts[amounts.length - 1] ?? 0n;
}

export async function buyOkbWithUsdt0(from: string, usdtIn: bigint): Promise<bigint> {
  const parts = await deskParts("xlayer", from, usdtIn);
  if (parts.swapIn <= 0n) throw new Error("amount");
  const out = await quoteUsdt0Okb("buy", parts.swapIn);
  if (out <= 0n) throw new Error("empty");
  if (parts.reward > 0n && parts.referrer) {
    await wait(await send(from, USDT, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [parts.referrer, parts.reward] })));
  }
  if (parts.desk > 0n) {
    let routed = false;
    try {
      const { routeDeskFee } = await import("@/lib/card-pool");
      routed = await routeDeskFee("xlayer", from, parts.desk, 0);
    } catch (err) {
      if (err instanceof TxPending) throw err;
      routed = false;
    }
    if (!routed) {
      await wait(await send(from, USDT, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [XLAYER_SAFE, parts.desk] })));
    }
  }
  await approveToken(from, USDT, parts.swapIn);
  const minOut = out * 99n / 100n;
  const data = encodeFunctionData({
    abi: v2,
    functionName: "swapExactTokensForETH",
    args: [parts.swapIn, minOut, [USDT, WOKB], from as Hex, BigInt(Math.floor(Date.now() / 1000) + 60 * 20)],
  });
  await wait(await send(from, ROUTER, data));
  return minOut;
}

const HOP_KEY = "tl-tape-usdt-hop";

function readHop(from: string): bigint | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(HOP_KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as { from?: string; okb?: string };
    if (!row.from || row.from.toLowerCase() !== from.toLowerCase() || !row.okb) return null;
    const n = BigInt(row.okb);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

function writeHop(from: string, okb: bigint) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(HOP_KEY, JSON.stringify({ from, okb: okb.toString() }));
}

function clearHop() {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(HOP_KEY);
}

async function unwindOkb(from: string, want: bigint): Promise<Hex> {
  const bal = await client.getBalance({ address: from as Hex });
  const room = bal > OKB_RESERVE ? bal - OKB_RESERVE : 0n;
  const spend = want < room ? want : room;
  if (spend <= 10n ** 14n) throw new Error("leg");
  const out = await quoteUsdt0Okb("sell", spend);
  if (out <= 0n) throw new Error("leg");
  const data = encodeFunctionData({
    abi: v2,
    functionName: "swapExactETHForTokens",
    args: [out * 97n / 100n, [WOKB, USDT], from as Hex, BigInt(Math.floor(Date.now() / 1000) + 60 * 20)],
  });
  const hash = await send(from, ROUTER, data, spend);
  await wait(hash);
  clearHop();
  return hash;
}

/** Sell TAPE into the OKB pool, then turn that OKB into USDT0. The wallet shows OKB on the first signature. */
export async function sellTapeForUsdt0(from: string, tapeIn: bigint): Promise<Hex> {
  const pending = readHop(from);
  if (pending) return unwindOkb(from, pending);
  const before = await client.getBalance({ address: from as Hex });
  await swapPool(from, 1, true, tapeIn);
  const after = await client.getBalance({ address: from as Hex });
  const gained = after > before ? after - before : 0n;
  if (gained <= 10n ** 14n) throw new Error("leg");
  writeHop(from, gained);
  return unwindOkb(from, gained);
}
