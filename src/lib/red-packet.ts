import {
  concat,
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  fallback,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseUnits,
  type Hex,
} from "viem";
import { BSC, connectBsc, quoteExact } from "@/lib/bsc";
import { BSC_SAFE, TxPending, XLAYER_SAFE } from "@/lib/chain-marks";
import { OKB } from "@/lib/okb";
import { RED_PACKET_ABI, RED_PACKET_BYTECODE } from "@/lib/red-packet-artifact";
import { RED_OPEN_ABI, RED_OPEN_BYTECODE } from "@/lib/red-packet-open-artifact";
import { STOCKS } from "@/lib/stocks";
import { TAPE_BEM, TAPE_POOL, TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { connectXLayer } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";

export type GiftChain = "xlayer" | "bsc";
export type GiftLane = "official" | "volunteer";

const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const SALT_TEXT = new TextEncoder().encode("TAPELIQUID-red-v3");
const saltHex = keccak256(`0x${[...SALT_TEXT].map((b) => b.toString(16).padStart(2, "0")).join("")}`);

function saltFor(lane: GiftLane): Hex {
  if (lane === "official") return saltHex;
  const text = new TextEncoder().encode("TAPELIQUID-red-volunteer-v3");
  return keccak256(`0x${[...text].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
}

const DESK = {
  bsc: { router: BSC.router, quote: BSC.usdt, wrapped: BSC.wbnb, tapePool: ZERO, tapeQuote: ZERO, tapeToken: ZERO, tapeBem: ZERO, scale: 10n ** 12n, kind: 0 },
  xlayer: { router: OKB.router, quote: OKB.usdt, wrapped: OKB.wokb, tapePool: TAPE_POOL, tapeQuote: TAPE_USDT, tapeToken: TAPE_TOKEN, tapeBem: TAPE_BEM, scale: 1n, kind: 1 },
} as const;

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

const xClient = createPublicClient({
  transport: fallback([
    http("https://rpc.xlayer.tech", { timeout: 12_000 }),
    http("https://xlayerrpc.okx.com", { timeout: 12_000 }),
  ]),
});
const bscClient = createPublicClient({
  transport: fallback([
    http("https://bsc-dataseed.binance.org", { timeout: 12_000 }),
    http("https://bsc.publicnode.com", { timeout: 12_000 }),
  ]),
});
const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
]);

export function giftDeployer(chain: GiftChain): Hex {
  return chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE;
}

function initOf(chain: GiftChain, lane: GiftLane = "official"): Hex {
  const cfg = DESK[chain];
  if (lane === "volunteer") {
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }],
      [cfg.router, cfg.quote, cfg.wrapped, cfg.tapePool, cfg.tapeQuote, cfg.tapeToken, cfg.tapeBem, cfg.scale, cfg.kind],
    );
    return `${RED_OPEN_BYTECODE}${args.slice(2)}`;
  }
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }],
    [giftDeployer(chain), cfg.router, cfg.quote, cfg.wrapped, cfg.tapePool, cfg.tapeQuote, cfg.tapeToken, cfg.tapeBem, cfg.scale, cfg.kind],
  );
  return `${RED_PACKET_BYTECODE}${args.slice(2)}`;
}

function predict(chain: GiftChain, lane: GiftLane = "official"): Hex {
  const hash = keccak256(concat(["0xff", FACTORY, saltFor(lane), keccak256(initOf(chain, lane))]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export function packetOf(chain: GiftChain, lane: GiftLane = "official"): Hex {
  return predict(chain, lane);
}

export const RED_PACKET: Record<GiftChain, Hex> = {
  xlayer: predict("xlayer", "official"),
  bsc: predict("bsc", "official"),
};

function client(chain: GiftChain) {
  return chain === "xlayer" ? xClient : bscClient;
}

export function sgDay(ts = Math.floor(Date.now() / 1000)): number {
  return Math.floor((ts + 8 * 3600) / 86400);
}

export function sgLeft(now = Date.now()): number {
  const next = (Math.floor((now + 8 * 3600_000) / 86_400_000) + 1) * 86_400_000 - 8 * 3600_000;
  return Math.max(0, next - now);
}

export function sgClock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

export function markDeskFill(chain: GiftChain, account?: string, leg?: "spot" | "perp", usd?: number, assetId?: string) {
  try {
    localStorage.setItem(`tl-red-fill:${chain}:${sgDay()}`, "1");
    if (account && leg && usd && usd > 0 && assetId) addAssetVolume(chain, account, assetId, leg, usd);
  } catch {
    /* ignore */
  }
}

export function addAssetVolume(chain: GiftChain, account: string, assetId: string, leg: "spot" | "perp", usd: number) {
  if (!account || !assetId || !(usd > 0)) return;
  const book = readAssetBook(chain, account);
  const row = book[assetId] ?? { spot: 0, perp: 0 };
  row[leg] = Math.round((row[leg] + usd) * 100) / 100;
  book[assetId] = row;
  localStorage.setItem(assetKey(chain, account), JSON.stringify(book));
}

export function readAssetVolume(chain: GiftChain, account: string | null, assetId: string): { spot: number; perp: number } {
  if (!account || !assetId) return { spot: 0, perp: 0 };
  const row = readAssetBook(chain, account)[assetId];
  return { spot: Number(row?.spot) || 0, perp: Number(row?.perp) || 0 };
}

function readAssetBook(chain: GiftChain, account: string): Record<string, { spot: number; perp: number }> {
  try {
    const raw = localStorage.getItem(assetKey(chain, account));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, { spot?: number; perp?: number }>;
    const book: Record<string, { spot: number; perp: number }> = {};
    for (const [id, row] of Object.entries(parsed)) book[id] = { spot: Number(row?.spot) || 0, perp: Number(row?.perp) || 0 };
    return book;
  } catch {
    return {};
  }
}

function assetKey(chain: GiftChain, account: string) {
  return `tl-red-asset:${chain}:${sgDay()}:${account.toLowerCase()}`;
}

export function taskAsset(chain: GiftChain, hi: bigint): GiftAsset | null {
  if (hi === 1n) return GIFT_ASSETS[chain].find((row) => row.token === ZERO) ?? null;
  if (hi <= 1n) return null;
  try {
    const addr = getAddress(`0x${hi.toString(16).padStart(40, "0")}`);
    return GIFT_ASSETS[chain].find((row) => row.token.toLowerCase() === addr.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

export function taskLine(chain: GiftChain, hi: bigint, spotNeed: bigint, perpNeed: bigint, gate: number, zh: boolean): string {
  const task = taskAsset(chain, hi);
  const spot = needUsd(spotNeed);
  const perp = needUsd(perpNeed);
  const buy = Math.max(spot, perp);
  const name = task ? (zh ? task.zh : task.en) : "";
  if (!name || !(buy > 0)) return zh ? "没有指定资产" : "No asset";
  return zh ? `打开时买入 ${name}，至少 ${buy} USDT` : `Opening buys at least ${buy} USDT of ${name}`;
}

export function addDeskVolume(chain: GiftChain, account: string, leg: "spot" | "perp", usd: number) {
  if (!account || !(usd > 0)) return;
  const prev = readDeskVolume(chain, account);
  prev[leg] = Math.round((prev[leg] + usd) * 100) / 100;
  localStorage.setItem(volKey(chain, account), JSON.stringify(prev));
}

export function readDeskVolume(chain: GiftChain, account: string | null): { spot: number; perp: number } {
  if (!account) return { spot: 0, perp: 0 };
  try {
    const raw = localStorage.getItem(volKey(chain, account));
    if (!raw) return { spot: 0, perp: 0 };
    const parsed = JSON.parse(raw) as { spot?: number; perp?: number };
    return { spot: Number(parsed.spot) || 0, perp: Number(parsed.perp) || 0 };
  } catch {
    return { spot: 0, perp: 0 };
  }
}

function volKey(chain: GiftChain, account: string) {
  return `tl-red-vol:${chain}:${sgDay()}:${account.toLowerCase()}`;
}

export function needUsd(raw: bigint): number {
  return Number(raw) / 1e6;
}

export function meetsVolume(gate: number, spotNeed: bigint, perpNeed: bigint, vol: { spot: number; perp: number }): boolean {
  const spot = needUsd(spotNeed);
  const perp = needUsd(perpNeed);
  if (spot <= 0 && perp <= 0) return false;
  const spotOk = spot <= 0 || vol.spot + 1e-9 >= spot;
  const perpOk = perp <= 0 || vol.perp + 1e-9 >= perp;
  if (gate === 1) return spotOk && perpOk;
  return (spot > 0 && vol.spot + 1e-9 >= spot) || (perp > 0 && vol.perp + 1e-9 >= perp);
}

export function filledToday(chain: GiftChain): boolean {
  try {
    return localStorage.getItem(`tl-red-fill:${chain}:${sgDay()}`) === "1";
  } catch {
    return false;
  }
}

export function rememberClaim(lane: GiftLane = "official") {
  try {
    localStorage.setItem(lane === "official" ? "tl-red-claimed" : "tl-red-claimed:volunteer", String(sgDay()));
  } catch {
    /* ignore */
  }
}

export function claimedHere(lane: GiftLane = "official"): boolean {
  try {
    const key = lane === "official" ? "tl-red-claimed" : "tl-red-claimed:volunteer";
    return localStorage.getItem(key) === String(sgDay());
  } catch {
    return false;
  }
}

async function send(chain: GiftChain, from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const live = chain === "xlayer" ? await connectXLayer() : await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const account = live || from;
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from: account, to, data, value: `0x${value.toString(16)}`, chainId: chain === "bsc" ? "0x38" : "0xc4" }],
  })) as Hex;
}

async function preflight(chain: GiftChain, from: string, to: Hex, data: Hex) {
  try {
    await client(chain).call({ to, data, account: from as Hex });
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    const known = ["deployer", "creator", "amount", "life", "mode", "range", "packets", "dust", "rule", "late", "empty", "day", "cap", "early", "credit", "token", "native", "bot", "pace", "task", "buy", "fee", "pull"];
    const hit = known.find((item) => text.includes(item));
    throw new Error(hit ?? "revert");
  }
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

export async function redCode(chain: GiftChain, lane: GiftLane = "official"): Promise<boolean> {
  const code = await client(chain).getBytecode({ address: packetOf(chain, lane) });
  return Boolean(code && code !== "0x");
}

export async function deployRed(chain: GiftChain, lane: GiftLane = "official"): Promise<Hex> {
  if (await redCode(chain, lane)) return packetOf(chain, lane);
  const from = chain === "xlayer" ? await connectXLayer() : await connectBsc();
  if (lane === "official" && from.toLowerCase() !== giftDeployer(chain).toLowerCase()) throw new Error("safe");
  if (lane === "volunteer" && from.toLowerCase() !== giftDeployer(chain).toLowerCase()) throw new Error("safe");
  const hash = await send(chain, from, FACTORY, concat([saltFor(lane), initOf(chain, lane)]));
  await wait(chain, hash);
  if (!(await redCode(chain, lane))) throw new Error("deploy");
  return packetOf(chain, lane);
}

export type RedRule = {
  chain: GiftChain;
  lane: GiftLane;
  address: Hex;
  deployed: boolean;
  token: Hex;
  mode: number;
  fixedAmt: bigint;
  lo: bigint;
  hi: bigint;
  packetsLeft: bigint;
  dayCap: bigint;
  spotNeed: bigint;
  perpNeed: bigint;
  gate: number;
  endsAt: bigint;
  credit: bigint;
  maker: Hex;
  claimedToday: bigint;
  balance: bigint;
  lastDay: bigint;
  ready: boolean;
  asset: GiftAsset | null;
};

const emptyAsset = (chain: GiftChain, lane: GiftLane = "official"): RedRule => ({
  chain,
  lane,
  address: packetOf(chain, lane),
  deployed: false,
  token: ZERO,
  mode: 0,
  fixedAmt: 0n,
  lo: 0n,
  hi: 0n,
  packetsLeft: 0n,
  dayCap: 0n,
  spotNeed: 0n,
  perpNeed: 0n,
  gate: 0,
  endsAt: 0n,
  credit: 0n,
  maker: ZERO,
  claimedToday: 0n,
  balance: 0n,
  lastDay: 0n,
  ready: false,
  asset: null,
});

export async function readRed(chain: GiftChain, account: string | null, lane: GiftLane = "official"): Promise<RedRule> {
  if (!(await redCode(chain, lane))) return emptyAsset(chain, lane);
  const pool = packetOf(chain, lane);
  try {
    return await readLive(chain, account, pool, lane);
  } catch {
    const row = emptyAsset(chain, lane);
    row.deployed = true;
    return row;
  }
}

async function readLive(chain: GiftChain, account: string | null, pool: Hex, lane: GiftLane): Promise<RedRule> {
  const c = client(chain);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const [token, mode, fixedAmt, lo, hi, packetsLeft, dayCap, claimedToday, lastDay, ready, spotNeed, perpNeed, gate, endsAt, credit] = await Promise.all([
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "token" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "mode" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "fixedAmt" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "lo" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "hi" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "packetsLeft" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "dayCap" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "claimsToday", args: [now] }),
    account
      ? c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "lastDay", args: [account as Hex] })
      : Promise.resolve(0n),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "ready" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "spotNeed" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "perpNeed" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "gate" }),
    c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "endsAt" }),
    account
      ? c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "credit", args: [account as Hex] })
      : Promise.resolve(0n),
  ]);
  const maker = lane === "volunteer"
    ? await c.readContract({ address: pool, abi: RED_OPEN_ABI, functionName: "creator" })
    : await c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "deployer" });
  const asset = ready ? GIFT_ASSETS[chain].find((row) => row.token.toLowerCase() === token.toLowerCase()) ?? null : null;
  const balance = token === ZERO
    ? await c.getBalance({ address: pool })
    : await c.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [pool] });
  return {
    chain,
    lane,
    address: pool,
    deployed: true,
    token,
    mode: Number(mode),
    fixedAmt,
    lo,
    hi,
    packetsLeft,
    dayCap,
    spotNeed,
    perpNeed,
    gate: Number(gate),
    endsAt,
    credit,
    maker,
    claimedToday,
    balance,
    lastDay,
    ready,
    asset,
  };
}

async function approve(chain: GiftChain, from: string, token: Hex, need: bigint, lane: GiftLane) {
  const pool = packetOf(chain, lane);
  const current = await client(chain).readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, pool] });
  if (current >= need) return;
  if (current > 0n) {
    const cleared = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [pool, 0n] }));
    await wait(chain, cleared);
  }
  const hash = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [pool, need] }));
  await wait(chain, hash);
}

export async function fundRed(chain: GiftChain, from: string, text: string, asset: GiftAsset, lane: GiftLane = "official"): Promise<Hex> {
  const amount = parseUnits(text.trim(), asset.decimals);
  if (amount <= 0n) throw new Error("amount");
  const pool = packetOf(chain, lane);
  if (asset.token === ZERO) {
    const hash = await send(chain, from, pool, encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "depositNative" }), amount);
    await wait(chain, hash);
    return hash;
  }
  await approve(chain, from, asset.token, amount, lane);
  const hash = await send(chain, from, pool, encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "deposit", args: [amount] }));
  await wait(chain, hash);
  return hash;
}

export async function withdrawRed(chain: GiftChain, from: string, text: string, asset: GiftAsset, lane: GiftLane = "official"): Promise<Hex> {
  const amount = parseUnits(text.trim(), asset.decimals);
  if (amount <= 0n) throw new Error("amount");
  const hash = await send(chain, from, packetOf(chain, lane), encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "withdraw", args: [amount] }));
  await wait(chain, hash);
  return hash;
}

export function swapFeeOf(chain: GiftChain, hi: bigint): number {
  const task = taskAsset(chain, hi);
  if (chain !== "bsc" || !task) return 0;
  if (task.id === "bem") return 10000;
  if (task.id === "bnb" || task.id === "btc" || task.id === "spy") return 100;
  if (task.id === "eth" || task.id === "xau") return 500;
  return 2500;
}

const previewAbi = parseAbi(["function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) view returns (uint256 fee, uint256 out)"]);
const v2QuoteAbi = parseAbi(["function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"]);

async function buyMin(chain: GiftChain, hi: bigint, amountIn: bigint): Promise<bigint> {
  const task = taskAsset(chain, hi);
  if (!task) throw new Error("task");
  let quoted = 0n;
  if (chain === "xlayer" && (task.id === "tape" || task.id === "bem")) {
    const first = await xClient.readContract({ address: TAPE_POOL, abi: previewAbi, functionName: "previewSwap", args: [0, false, amountIn] });
    quoted = first[1];
    if (task.id === "bem") {
      const second = await xClient.readContract({ address: TAPE_POOL, abi: previewAbi, functionName: "previewSwap", args: [1, true, quoted] });
      quoted = second[1];
    }
  } else if (chain === "bsc") {
    const out = task.token === ZERO ? BSC.wbnb : task.token;
    quoted = await quoteExact(BSC.usdt, out, amountIn, swapFeeOf(chain, hi));
  } else {
    const out = task.token === ZERO ? OKB.wokb : task.token;
    const amounts = await xClient.readContract({ address: OKB.router, abi: v2QuoteAbi, functionName: "getAmountsOut", args: [amountIn, [OKB.usdt, out]] });
    quoted = amounts[amounts.length - 1] ?? 0n;
  }
  if (quoted <= 0n) throw new Error("buy");
  return quoted * 95n / 100n;
}

async function approveSpend(chain: GiftChain, from: string, token: Hex, spender: Hex, amount: bigint) {
  const allowance = await client(chain).readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, spender] });
  if (allowance >= amount) return;
  if (allowance > 0n) {
    const cleared = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] }));
    await wait(chain, cleared);
  }
  const hash = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, amount] }));
  await wait(chain, hash);
}

export async function claimRed(chain: GiftChain, from: string, lane: GiftLane = "official"): Promise<{ hash: Hex; amount: bigint }> {
  const day = sgDay();
  const here = await readRed(chain, from, lane);
  if (here.lastDay === BigInt(day)) throw new Error("day");
  const need = here.spotNeed > here.perpNeed ? here.spotNeed : here.perpNeed;
  if (need <= 0n || here.hi === 0n) throw new Error("task");
  const amountIn = need * DESK[chain].scale;
  const minOut = await buyMin(chain, here.hi, amountIn);
  const task = taskAsset(chain, here.hi);
  const spend = chain === "xlayer" && (task?.id === "tape" || task?.id === "bem") ? TAPE_USDT : DESK[chain].quote;
  await approveSpend(chain, from, spend, packetOf(chain, lane), amountIn);
  const data = encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "claim", args: [amountIn, minOut] });
  await preflight(chain, from, packetOf(chain, lane), data);
  const hash = await send(chain, from, packetOf(chain, lane), data);
  let receipt;
  try {
    receipt = await client(chain).waitForTransactionReceipt({ hash, timeout: 120_000 });
  } catch {
    throw new TxPending(hash);
  }
  if (receipt.status !== "success") throw new Error("revert");
  rememberClaim(lane);
  let amount = 0n;
  for (const log of receipt.logs) {
    try {
      const parsed = decodeEventLog({ abi: RED_PACKET_ABI, data: log.data, topics: log.topics });
      if (parsed.eventName === "Claimed") amount = parsed.args.amount;
    } catch {
      /* not this event */
    }
  }
  return { hash, amount };
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
  spotText: string,
  perpText: string,
  gate: number,
  life: number,
  lane: GiftLane = "official",
  taskHi?: bigint,
): Promise<Hex> {
  const fixedAmt = parseUnits(fixedText.trim() || "0", asset.decimals);
  const lo = parseUnits(loText.trim() || "0", asset.decimals);
  const hi = taskHi ?? parseUnits(hiText.trim() || "0", asset.decimals);
  const data = encodeFunctionData({
    abi: RED_PACKET_ABI,
    functionName: "setRule",
    args: [
      asset.token,
      mode,
      fixedAmt,
      lo,
      hi,
      BigInt(packets.trim() || "0"),
      BigInt(dayCap.trim() || "0"),
      parseUnits(spotText.trim() || "0", 6),
      parseUnits(perpText.trim() || "0", 6),
      gate,
      BigInt(life),
      swapFeeOf(chain, hi),
    ],
  });
  await preflight(chain, from, packetOf(chain, lane), data);
  const hash = await send(chain, from, packetOf(chain, lane), data);
  await wait(chain, hash);
  return hash;
}

export function giftText(amount: bigint, asset: GiftAsset | null): string {
  if (!asset) return "—";
  const n = Number(formatUnits(amount, asset.decimals));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export type ClaimRow = { chain: GiftChain; lane: GiftLane; amount: string; name: string; at: number; tx: string };

function claimKey(account: string) {
  return `tl-red-log:${account.toLowerCase()}`;
}

export function noteClaim(account: string, row: ClaimRow) {
  try {
    const prev = readSavedClaims(account).filter((item) => item.tx.toLowerCase() !== row.tx.toLowerCase());
    prev.unshift(row);
    localStorage.setItem(claimKey(account), JSON.stringify(prev.slice(0, 40)));
  } catch {
    /* ignore */
  }
}

function readSavedClaims(account: string): ClaimRow[] {
  try {
    const raw = localStorage.getItem(claimKey(account));
    if (!raw) return [];
    const rows = JSON.parse(raw) as ClaimRow[];
    return Array.isArray(rows) ? rows.filter((row) => row && row.tx) : [];
  } catch {
    return [];
  }
}

const claimedEvent = parseAbiItem("event Claimed(address indexed who, uint256 indexed day, uint256 amount)");
const ruleEvent = parseAbiItem("event RuleSet(address token, uint8 mode, uint256 fixedAmt, uint256 lo, uint256 hi, uint256 packets, uint256 dayCap, uint256 spotNeed, uint256 perpNeed, uint8 gate, uint256 life)");

const bscLogs = createPublicClient({ transport: http("https://bsc.publicnode.com", { timeout: 20_000 }) });

export async function readPaid(chain: GiftChain, lane: GiftLane = "official"): Promise<bigint | null> {
  try {
    if (!(await redCode(chain, lane))) return 0n;
    const pool = packetOf(chain, lane);
    const live = chain === "bsc" ? bscLogs : client(chain);
    const ready = await live.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "ready" });
    if (!ready) return 0n;
    const c = live;
    const tip = await c.getBlockNumber();
    const span = chain === "bsc" ? 12_000n : 100n;
    const steps = chain === "bsc" ? 24 : 30;
    let cursor = tip;
    let ruleAt: bigint | null = null;
    let paid = 0n;
    for (let i = 0; i < steps && cursor > 0n; i++) {
      const from = cursor > span ? cursor - span + 1n : 0n;
      const [rules, logs] = await Promise.all([
        c.getLogs({ address: pool, event: ruleEvent, fromBlock: from, toBlock: cursor }),
        c.getLogs({ address: pool, event: claimedEvent, fromBlock: from, toBlock: cursor }),
      ]);
      if (rules.length) {
        ruleAt = rules[rules.length - 1]?.blockNumber ?? from;
        for (const log of logs) {
          if (log.blockNumber != null && log.blockNumber >= ruleAt) paid += log.args.amount ?? 0n;
        }
        break;
      }
      for (const log of logs) paid += log.args.amount ?? 0n;
      if (from === 0n) break;
      cursor = from - 1n;
    }
    return ruleAt == null ? null : paid;
  } catch {
    return null;
  }
}

export async function readMyClaims(account: string): Promise<ClaimRow[]> {
  const saved = readSavedClaims(account);
  const found: ClaimRow[] = [];
  const jobs: Promise<void>[] = [];
  for (const chain of ["xlayer", "bsc"] as const) {
    for (const lane of ["official", "volunteer"] as const) {
      jobs.push((async () => {
        if (!(await redCode(chain, lane))) return;
        const pool = packetOf(chain, lane);
        const c = client(chain);
        const tip = await c.getBlockNumber();
        const from = tip > 80_000n ? tip - 80_000n : 0n;
        const logs = await c.getLogs({ address: pool, event: claimedEvent, args: { who: getAddress(account) }, fromBlock: from, toBlock: tip });
        if (!logs.length) return;
        const book = await readRed(chain, null, lane);
        const name = book.asset?.zh ?? "";
        const blocks = new Map<bigint, number>();
        await Promise.all([...new Set(logs.map((log) => log.blockNumber).filter((n): n is bigint => n != null))].map(async (block) => {
          const row = await c.getBlock({ blockNumber: block });
          blocks.set(block, Number(row.timestamp) * 1000);
        }));
        for (const log of logs) {
          if (!log.transactionHash || log.blockNumber == null) continue;
          found.push({
            chain,
            lane,
            amount: giftText(log.args.amount ?? 0n, book.asset),
            name,
            at: blocks.get(log.blockNumber) ?? 0,
            tx: log.transactionHash,
          });
        }
      })().catch(() => undefined));
    }
  }
  await Promise.all(jobs);
  const map = new Map<string, ClaimRow>();
  for (const row of found) map.set(row.tx.toLowerCase(), row);
  for (const row of saved) {
    const key = row.tx.toLowerCase();
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, amount: row.amount || prev.amount, name: row.name || prev.name, at: row.at || prev.at } : row);
  }
  return [...map.values()].sort((a, b) => b.at - a.at);
}
