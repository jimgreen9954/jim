import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  toHex,
  type Hex,
} from "viem";
import { BSC, connectBsc } from "@/lib/bsc";
import { BSC_SAFE, TxPending, XLAYER_SAFE } from "@/lib/chain-marks";
import { CARD_POOL_ABI, CARD_POOL_BYTECODE } from "@/lib/card-pool-artifact";
import { connectXLayer } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";

export type PoolChain = "bsc" | "xlayer";
export type DeskBps = [number, number, number, number];

const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Hex;
const PUNK = "0xB5ac1dddc158a639D4499aad2d8F393989D4bD34" as Hex;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const SALT = keccak256(toHex("TAPELIQUID-card-pool-v1"));

const xClient = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 20_000 }) });
const bscClient = createPublicClient({ transport: http("https://bsc-dataseed.binance.org", { timeout: 20_000 }) });
const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

export function poolToken(chain: PoolChain): Hex {
  return chain === "xlayer" ? USDT0 : BSC.usdt;
}

export function poolSafe(chain: PoolChain): Hex {
  return chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE;
}

export function poolDecimals(chain: PoolChain): number {
  return chain === "xlayer" ? 6 : BSC.usdtDecimals;
}

export function poolSymbol(chain: PoolChain): string {
  return chain === "xlayer" ? "USDT0" : "USDT";
}

function initOf(chain: PoolChain): Hex {
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [poolToken(chain), poolSafe(chain), chain === "xlayer" ? PUNK : ZERO],
  );
  return `${CARD_POOL_BYTECODE}${args.slice(2)}`;
}

function predict(chain: PoolChain): Hex {
  const hash = keccak256(concat(["0xff", FACTORY, SALT, keccak256(initOf(chain))]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export const CARD_POOL: Record<PoolChain, Hex> = {
  xlayer: predict("xlayer"),
  bsc: predict("bsc"),
};

function client(chain: PoolChain) {
  return chain === "xlayer" ? xClient : bscClient;
}

export function civilMonth(ts = Math.floor(Date.now() / 1000)): { y: number; m: number; d: number; id: number } {
  const z = Math.floor((ts + 8 * 3600) / 86400) + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  let m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y += 1;
  return { y, m, d, id: y * 12 + m };
}

async function send(chain: PoolChain, from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  if (chain === "xlayer") await connectXLayer();
  else await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

async function wait(chain: PoolChain, hash: Hex) {
  try {
    const receipt = await client(chain).waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("revert");
  } catch (err) {
    if (err instanceof Error && err.message === "revert") throw err;
    throw new TxPending(hash);
  }
}

export async function poolCode(chain: PoolChain): Promise<boolean> {
  const code = await client(chain).getBytecode({ address: CARD_POOL[chain] });
  return Boolean(code && code !== "0x");
}

export async function deployCardPool(chain: PoolChain): Promise<Hex> {
  if (await poolCode(chain)) return CARD_POOL[chain];
  const from = chain === "xlayer" ? await connectXLayer() : await connectBsc();
  if (from.toLowerCase() !== poolSafe(chain).toLowerCase()) throw new Error("safe");
  const hash = await send(chain, from, FACTORY, concat([SALT, initOf(chain)]));
  await wait(chain, hash);
  if (!(await poolCode(chain))) throw new Error("deploy");
  return CARD_POOL[chain];
}

async function approve(chain: PoolChain, from: string, token: Hex, spender: Hex, need: bigint) {
  const current = await client(chain).readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, spender] });
  if (current >= need) return;
  if (current > 0n) {
    const cleared = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] }));
    await wait(chain, cleared);
  }
  const hash = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, need] }));
  await wait(chain, hash);
}

export async function depositPool(chain: PoolChain, from: string, text: string): Promise<Hex> {
  const amount = parseUnits(text.trim(), poolDecimals(chain));
  if (amount <= 0n) throw new Error("amount");
  const pool = CARD_POOL[chain];
  if (!(await poolCode(chain))) throw new Error("deploy");
  await approve(chain, from, poolToken(chain), pool, amount);
  const hash = await send(chain, from, pool, encodeFunctionData({ abi: CARD_POOL_ABI, functionName: "deposit", args: [amount] }));
  await wait(chain, hash);
  return hash;
}

export async function withdrawPool(chain: PoolChain, from: string, text: string): Promise<Hex> {
  const amount = parseUnits(text.trim(), poolDecimals(chain));
  if (amount <= 0n) throw new Error("amount");
  const pool = CARD_POOL[chain];
  const credit = await client(chain).readContract({ address: pool, abi: CARD_POOL_ABI, functionName: "credit", args: [from as Hex] });
  if (credit < amount) throw new Error("credit");
  const hash = await send(chain, from, pool, encodeFunctionData({ abi: CARD_POOL_ABI, functionName: "withdraw", args: [amount] }));
  await wait(chain, hash);
  return hash;
}

export async function claimPool(chain: PoolChain, from: string, month: number, bps: DeskBps): Promise<Hex> {
  const pool = CARD_POOL[chain];
  if (!(await poolCode(chain))) throw new Error("deploy");
  const args = bps.map((n) => n) as DeskBps;
  const hash = await send(
    chain,
    from,
    pool,
    encodeFunctionData({ abi: CARD_POOL_ABI, functionName: "claim", args: [BigInt(month), args] }),
  );
  await wait(chain, hash);
  return hash;
}

/** Pulls the multisig share, records that amount, forwards all of it. Returns false if this pool is not deployed. */
export async function routeDeskFee(chain: PoolChain, from: string, amount: bigint, desk: 0 | 1 | 2 | 3): Promise<boolean> {
  if (amount <= 0n) return false;
  if (!(await poolCode(chain))) return false;
  const pool = CARD_POOL[chain];
  const key = `tl-pool-pay:${chain}:${from.toLowerCase()}:${desk}:${amount}`;
  const prior = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key);
  if (prior) {
    await wait(chain, prior as Hex);
    sessionStorage.removeItem(key);
    return true;
  }
  await approve(chain, from, poolToken(chain), pool, amount);
  const hash = await send(chain, from, pool, encodeFunctionData({ abi: CARD_POOL_ABI, functionName: "pay", args: [desk, amount] }));
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, hash);
  await wait(chain, hash);
  sessionStorage.removeItem(key);
  return true;
}

export type PoolBooks = {
  chain: PoolChain;
  address: Hex;
  deployed: boolean;
  credit: bigint;
  balance: bigint;
  paid: bigint[];
  claimed: bigint;
  prevPaid: bigint[];
  prevClaimed: bigint;
  prevDid: boolean;
  month: number;
  prev: number;
};

export async function readPool(chain: PoolChain, account: string | null): Promise<PoolBooks> {
  const now = civilMonth();
  const prevDate = civilMonth(Math.floor(Date.UTC(now.y, now.m - 1, 1) / 1000) - 8 * 3600 - 1);
  const empty = [0n, 0n, 0n, 0n];
  const address = CARD_POOL[chain];
  const deployed = await poolCode(chain);
  if (!deployed || !account) {
    return { chain, address, deployed, credit: 0n, balance: 0n, paid: empty, claimed: 0n, prevPaid: empty, prevClaimed: 0n, prevDid: false, month: now.id, prev: prevDate.id };
  }
  const pool = address;
  const who = account as Hex;
  const c = client(chain);
  const pullPaid = async (month: number) => Promise.all([0, 1, 2, 3].map((desk) => c.readContract({
    address: pool,
    abi: CARD_POOL_ABI,
    functionName: "paid",
    args: [who, BigInt(month), desk],
  })));
  const [credit, balance, paid, claimed, prevPaid, prevClaimed, prevDid] = await Promise.all([
    c.readContract({ address: pool, abi: CARD_POOL_ABI, functionName: "credit", args: [who] }),
    c.readContract({ address: poolToken(chain), abi: erc20, functionName: "balanceOf", args: [pool] }),
    pullPaid(now.id),
    c.readContract({ address: pool, abi: CARD_POOL_ABI, functionName: "claimed", args: [who, BigInt(now.id)] }),
    pullPaid(prevDate.id),
    c.readContract({ address: pool, abi: CARD_POOL_ABI, functionName: "claimed", args: [who, BigInt(prevDate.id)] }),
    c.readContract({ address: pool, abi: CARD_POOL_ABI, functionName: "didClaim", args: [who, BigInt(prevDate.id)] }),
  ]);
  return { chain, address, deployed, credit, balance, paid, claimed, prevPaid, prevClaimed, prevDid, month: now.id, prev: prevDate.id };
}
