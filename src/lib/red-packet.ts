import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  type Hex,
} from "viem";
import { BSC, connectBsc } from "@/lib/bsc";
import { BSC_SAFE, TxPending, XLAYER_SAFE } from "@/lib/chain-marks";
import { RED_PACKET_ABI, RED_PACKET_BYTECODE } from "@/lib/red-packet-artifact";
import { STOCKS } from "@/lib/stocks";
import { connectXLayer } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";

export type GiftChain = "xlayer" | "bsc";

const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const SALT_TEXT = new TextEncoder().encode("TAPELIQUID-red-v1");
const saltHex = keccak256(`0x${[...SALT_TEXT].map((b) => b.toString(16).padStart(2, "0")).join("")}`);

const USDT0 = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Hex;
const TAPE = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as Hex;
const X_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as Hex;

export type GiftAsset = { id: string; zh: string; en: string; token: Hex; decimals: number };

export const GIFT_ASSETS: Record<GiftChain, GiftAsset[]> = {
  xlayer: [
    { id: "okb", zh: "OKB", en: "OKB", token: ZERO, decimals: 18 },
    { id: "tape", zh: "TAPE", en: "TAPE", token: TAPE, decimals: 8 },
    { id: "bem", zh: "BEM", en: "BEM", token: X_BEM, decimals: 8 },
    { id: "usdt", zh: "USDT0", en: "USDT0", token: USDT0, decimals: 6 },
  ],
  bsc: [
    { id: "bnb", zh: "BNB", en: "BNB", token: ZERO, decimals: 18 },
    { id: "bem", zh: "BEM", en: "BEM", token: BSC.bem, decimals: 8 },
    { id: "usdt", zh: "USDT", en: "USDT", token: BSC.usdt, decimals: 18 },
    { id: "btc", zh: "比特币", en: "BTC", token: BSC.btcb, decimals: 18 },
    { id: "xau", zh: "黄金", en: "Gold", token: BSC.xaut, decimals: 6 },
    { id: "spy", zh: "标普500", en: "S&P 500", token: STOCKS.spy.token as Hex, decimals: 18 },
    { id: "eth", zh: "ETH", en: "ETH", token: BSC.eth, decimals: 18 },
  ],
};

const xClient = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 20_000 }) });
const bscClient = createPublicClient({ transport: http("https://bsc-dataseed.binance.org", { timeout: 20_000 }) });
const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

export function giftDeployer(chain: GiftChain): Hex {
  return chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE;
}

function initOf(chain: GiftChain): Hex {
  const args = encodeAbiParameters([{ type: "address" }], [giftDeployer(chain)]);
  return `${RED_PACKET_BYTECODE}${args.slice(2)}`;
}

function predict(chain: GiftChain): Hex {
  const hash = keccak256(concat(["0xff", FACTORY, saltHex, keccak256(initOf(chain))]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export const RED_PACKET: Record<GiftChain, Hex> = {
  xlayer: predict("xlayer"),
  bsc: predict("bsc"),
};

function client(chain: GiftChain) {
  return chain === "xlayer" ? xClient : bscClient;
}

export function sgDay(ts = Math.floor(Date.now() / 1000)): number {
  return Math.floor((ts + 8 * 3600) / 86400);
}

export function markDeskFill(chain: GiftChain) {
  try {
    localStorage.setItem(`tl-red-fill:${chain}:${sgDay()}`, "1");
  } catch {
    /* ignore */
  }
}

export function filledToday(chain: GiftChain): boolean {
  try {
    return localStorage.getItem(`tl-red-fill:${chain}:${sgDay()}`) === "1";
  } catch {
    return false;
  }
}

export function rememberClaim() {
  try {
    localStorage.setItem("tl-red-claimed", String(sgDay()));
  } catch {
    /* ignore */
  }
}

export function claimedHere(): boolean {
  try {
    return localStorage.getItem("tl-red-claimed") === String(sgDay());
  } catch {
    return false;
  }
}

async function send(chain: GiftChain, from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  if (chain === "xlayer") await connectXLayer();
  else await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

async function wait(chain: GiftChain, hash: Hex) {
  try {
    const receipt = await client(chain).waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("revert");
  } catch (err) {
    if (err instanceof Error && err.message === "revert") throw err;
    throw new TxPending(hash);
  }
}

export async function redCode(chain: GiftChain): Promise<boolean> {
  const code = await client(chain).getBytecode({ address: RED_PACKET[chain] });
  return Boolean(code && code !== "0x");
}

export async function deployRed(chain: GiftChain): Promise<Hex> {
  if (await redCode(chain)) return RED_PACKET[chain];
  const from = chain === "xlayer" ? await connectXLayer() : await connectBsc();
  if (from.toLowerCase() !== giftDeployer(chain).toLowerCase()) throw new Error("safe");
  const hash = await send(chain, from, FACTORY, concat([saltHex, initOf(chain)]));
  await wait(chain, hash);
  if (!(await redCode(chain))) throw new Error("deploy");
  return RED_PACKET[chain];
}

export type RedRule = {
  chain: GiftChain;
  address: Hex;
  deployed: boolean;
  token: Hex;
  mode: number;
  fixedAmt: bigint;
  lo: bigint;
  hi: bigint;
  packetsLeft: bigint;
  dayCap: bigint;
  claimedToday: bigint;
  balance: bigint;
  lastDay: bigint;
  asset: GiftAsset | null;
};

const emptyAsset = (chain: GiftChain): RedRule => ({
  chain,
  address: RED_PACKET[chain],
  deployed: false,
  token: ZERO,
  mode: 0,
  fixedAmt: 0n,
  lo: 0n,
  hi: 0n,
  packetsLeft: 0n,
  dayCap: 0n,
  claimedToday: 0n,
  balance: 0n,
  lastDay: 0n,
  asset: null,
});

export async function readRed(chain: GiftChain, account: string | null): Promise<RedRule> {
  if (!(await redCode(chain))) return emptyAsset(chain);
  const pool = RED_PACKET[chain];
  const c = client(chain);
  const [token, mode, fixedAmt, lo, hi, packetsLeft, dayCap, claimedToday, lastDay] = await Promise.all([
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "token" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "mode" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "fixedAmt" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "lo" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "hi" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "packetsLeft" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "dayCap" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "claimedToday" }),
    account
      ? c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "lastDay", args: [account as Hex] })
      : Promise.resolve(0n),
  ]);
  const asset = GIFT_ASSETS[chain].find((row) => row.token.toLowerCase() === token.toLowerCase()) ?? null;
  const balance = token === ZERO
    ? await c.getBalance({ address: pool })
    : await c.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [pool] });
  return {
    chain,
    address: pool,
    deployed: true,
    token,
    mode: Number(mode),
    fixedAmt,
    lo,
    hi,
    packetsLeft,
    dayCap,
    claimedToday,
    balance,
    lastDay,
    asset,
  };
}

async function approve(chain: GiftChain, from: string, token: Hex, need: bigint) {
  const pool = RED_PACKET[chain];
  const current = await client(chain).readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, pool] });
  if (current >= need) return;
  if (current > 0n) {
    const cleared = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [pool, 0n] }));
    await wait(chain, cleared);
  }
  const hash = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [pool, need] }));
  await wait(chain, hash);
}

export async function fundRed(chain: GiftChain, from: string, text: string, asset: GiftAsset): Promise<Hex> {
  const amount = parseUnits(text.trim(), asset.decimals);
  if (amount <= 0n) throw new Error("amount");
  const pool = RED_PACKET[chain];
  if (asset.token === ZERO) {
    const hash = await send(chain, from, pool, encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "depositNative" }), amount);
    await wait(chain, hash);
    return hash;
  }
  await approve(chain, from, asset.token, amount);
  const hash = await send(chain, from, pool, encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "deposit", args: [amount] }));
  await wait(chain, hash);
  return hash;
}

export async function claimRed(chain: GiftChain, from: string): Promise<Hex> {
  const hash = await send(chain, from, RED_PACKET[chain], encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "claim" }));
  await wait(chain, hash);
  rememberClaim();
  return hash;
}

export async function setRedRule(
  chain: GiftChain,
  from: string,
  asset: GiftAsset,
  mode: number,
  fixedText: string,
  loText: string,
  hiText: string,
  packets: string,
  dayCap: string,
): Promise<Hex> {
  const fixedAmt = parseUnits(fixedText.trim() || "0", asset.decimals);
  const lo = parseUnits(loText.trim() || "0", asset.decimals);
  const hi = parseUnits(hiText.trim() || "0", asset.decimals);
  const hash = await send(
    chain,
    from,
    RED_PACKET[chain],
    encodeFunctionData({
      abi: RED_PACKET_ABI,
      functionName: "setRule",
      args: [asset.token, mode, fixedAmt, lo, hi, BigInt(packets.trim() || "0"), BigInt(dayCap.trim() || "0")],
    }),
  );
  await wait(chain, hash);
  return hash;
}

export function giftText(amount: bigint, asset: GiftAsset | null): string {
  if (!asset) return "—";
  const n = Number(formatUnits(amount, asset.decimals));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
