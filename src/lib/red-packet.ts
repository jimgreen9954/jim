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
import { BSC, connectBsc, quoteExact, quoteWithBnb } from "@/lib/bsc";
import { BSC_SAFE, TxPending, XLAYER_SAFE } from "@/lib/chain-marks";
import { OKB } from "@/lib/okb";
import { RED_PACKET_ABI, RED_PACKET_BYTECODE } from "@/lib/red-packet-artifact";
import { RED_OPEN_ABI, RED_OPEN_BYTECODE } from "@/lib/red-packet-open-artifact";
import { RED_NEXT_ABI, RED_NEXT_BYTECODE } from "@/lib/red-packet-next-artifact";
import { RED_BOOTH_ABI, RED_BOOTH_BYTECODE } from "@/lib/red-booth-artifact";
import { STOCKS } from "@/lib/stocks";
import { TAPE_BEM, TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { OPEN_POOL } from "@/lib/tape-open-swap";
import { connectXLayer } from "@/lib/xlayer";
import { ensureProvider, parseChainId, switchDeskChain } from "@/lib/wallet";

export type GiftChain = "xlayer" | "bsc";
export type GiftLane = "official" | "volunteer";

const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const SALT_TEXT = new TextEncoder().encode("TAPELIQUID-red-v8");
const saltHex = keccak256(`0x${[...SALT_TEXT].map((b) => b.toString(16).padStart(2, "0")).join("")}`);

function saltFor(lane: GiftLane): Hex {
  if (lane === "official") return saltHex;
  const text = new TextEncoder().encode("TAPELIQUID-red-volunteer-v8");
  return keccak256(`0x${[...text].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
}

const DESK = {
  bsc: { router: BSC.router, quote: BSC.usdt, wrapped: BSC.wbnb, tapePool: ZERO, tapeQuote: ZERO, tapeToken: ZERO, tapeBem: ZERO, scale: 10n ** 12n, kind: 0 },
  xlayer: { router: OKB.router, quote: OKB.usdt, wrapped: OKB.wokb, tapePool: OPEN_POOL, tapeQuote: TAPE_USDT, tapeToken: TAPE_TOKEN, tapeBem: TAPE_BEM, scale: 1n, kind: 1 },
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
  const raw = spotNeed > perpNeed ? spotNeed : perpNeed;
  const buy = Number(formatUnits(raw, 18));
  const name = task ? (zh ? task.zh : task.en) : "";
  const verbBuy = gate !== 1;
  const unit = chain === "bsc" ? "BNB" : "OKB";
  if (!name || !(buy > 0)) return zh ? "还没选币" : "No coin yet";
  const shown = buy.toLocaleString("en-US", { maximumFractionDigits: 6 });
  if (!verbBuy) return zh ? `卖出 ${name}，换回 ${unit}。卖出的币会离开你的钱包。` : `Sell ${name} for ${unit}. The coin leaves your wallet.`;
  return zh ? `买入 ${name}，需要支付 ${shown} ${unit}。这笔钱会离开你的钱包。` : `Buy ${name}. You pay ${shown} ${unit}. The money leaves your wallet.`;
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
  const eth = await ensureProvider();
  const want = chain === "bsc" ? 56 : 196;
  let id: number | null = null;
  try {
    id = parseChainId(await eth.request({ method: "eth_chainId" }));
  } catch {
    id = null;
  }
  if (id !== want) {
    try {
      await switchDeskChain(want);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "nowallet") throw err;
      const again = parseChainId(await eth.request({ method: "eth_chainId" }).catch(() => null));
      if (again !== want) throw new Error(want === 196 ? "xlayer" : "bsc");
    }
    throw new Error("switched");
  }
  let gas: Hex;
  try {
    const est = await client(chain).estimateGas({ account: from as Hex, to, data, value });
    gas = `0x${((est * 12n) / 10n).toString(16)}`;
  } catch (err) {
    const text = err instanceof Error ? err.message : "";
    if (/exceeds the balance|insufficient funds/i.test(text)) throw new Error("funds");
    const known = ["deployer", "creator", "amount", "life", "mode", "range", "packets", "dust", "rule", "late", "empty", "day", "cap", "early", "credit", "token", "native", "bot", "pace", "task", "buy", "fee", "pull", "prize", "closed", "begun"];
    const hit = known.find((item) => text === item || text.includes(`: ${item}`) || text.includes(`"${item}"`));
    if (hit) throw new Error(hit);
    throw new Error("net");
  }
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}`, gas }],
  })) as Hex;
}

async function preflight(chain: GiftChain, from: string, to: Hex, data: Hex, value = 0n) {
  let timer = 0;
  const slow = new Promise<"slow">((resolve) => {
    timer = window.setTimeout(() => resolve("slow"), 250);
  });
  const call = client(chain).call({ to, data, account: from as Hex, value }).then(() => "ok" as const).catch((err: unknown) => err);
  try {
    const which = await Promise.race([call, slow]);
    if (which === "ok" || which === "slow") return;
    const text = which instanceof Error ? which.message : "";
    if (/exceeds the balance|insufficient funds/i.test(text)) throw new Error("funds");
    const known = ["deployer", "creator", "amount", "life", "mode", "range", "packets", "dust", "rule", "late", "empty", "day", "cap", "early", "credit", "token", "native", "bot", "pace", "task", "buy", "fee", "pull", "prize", "closed"];
    const hit = known.find((item) => text === item || text.includes(`: ${item}`) || text.includes(`"${item}"`));
    throw new Error(hit ?? "revert");
  } finally {
    window.clearTimeout(timer);
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

const BOOTH_SALT = keccak256(`0x${[...new TextEncoder().encode("TAPELIQUID-booth-v1")].map((b) => b.toString(16).padStart(2, "0")).join("")}`);

export function boothOf(chain: GiftChain): Hex {
  const hash = keccak256(concat(["0xff", FACTORY, BOOTH_SALT, keccak256(RED_BOOTH_BYTECODE)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

function nextInit(chain: GiftChain): Hex {
  const cfg = DESK[chain];
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint8" }],
    [cfg.router, cfg.quote, cfg.wrapped, cfg.tapePool, cfg.tapeQuote, cfg.tapeToken, cfg.tapeBem, cfg.scale, cfg.kind],
  );
  return `${RED_NEXT_BYTECODE}${args.slice(2)}`;
}

function predictSpawn(chain: GiftChain, index: bigint): Hex {
  const salt = keccak256(encodeAbiParameters([{ type: "uint256" }], [index]));
  const hash = keccak256(concat(["0xff", boothOf(chain), salt, keccak256(nextInit(chain))]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export async function readSpawned(chain: GiftChain, account: string | null): Promise<RedRule[]> {
  const booth = boothOf(chain);
  const code = await client(chain).getBytecode({ address: booth });
  if (!code || code === "0x") return [];
  const count = await client(chain).readContract({ address: booth, abi: RED_BOOTH_ABI, functionName: "count" });
  const rows: RedRule[] = [];
  for (let i = 0n; i < count; i++) {
    const pool = await client(chain).readContract({ address: booth, abi: RED_BOOTH_ABI, functionName: "packets", args: [i] });
    try {
      const row = await readLive(chain, account, pool, "volunteer");
      if (row.ready) rows.push(row);
    } catch {
      /* skip a packet that cannot be read */
    }
  }
  return rows;
}

export async function openAnother(
  chain: GiftChain,
  from: string,
  asset: GiftAsset,
  eachText: string,
  totalText: string,
  spotText: string,
  gate: number,
  life: number,
  taskHi: bigint,
): Promise<Hex> {
  const booth = boothOf(chain);
  const code = await client(chain).getBytecode({ address: booth });
  if (!code || code === "0x") {
    const hash = await send(chain, from, FACTORY, concat([BOOTH_SALT, RED_BOOTH_BYTECODE]));
    await wait(chain, hash);
    throw new Error("booth");
  }
  const count = await client(chain).readContract({ address: booth, abi: RED_BOOTH_ABI, functionName: "count" });
  const packet = predictSpawn(chain, count);
  const fixedAmt = parseUnits(eachText.trim() || "0", asset.decimals);
  const fundAmt = parseUnits(totalText.trim() || "0", asset.decimals);
  if (fixedAmt <= 0n || fundAmt <= 0n) throw new Error("amount");
  if (asset.token !== ZERO) await approveSpend(chain, from, asset.token, packet, fundAmt);
  const beginData = encodeFunctionData({
    abi: RED_NEXT_ABI,
    functionName: "begin",
    args: [asset.token, fixedAmt, taskHi, parseUnits(spotText.trim() || "0", 18), gate, BigInt(life), swapFeeOf(chain, taskHi), fundAmt],
  });
  const data = encodeFunctionData({ abi: RED_BOOTH_ABI, functionName: "open", args: [nextInit(chain), beginData] });
  const value = asset.token === ZERO ? fundAmt : 0n;
  await preflight(chain, from, booth, data, value);
  const hash = await send(chain, from, booth, data, value);
  await wait(chain, hash);
  return packet;
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
  tradedDay: bigint;
  ready: boolean;
  asset: GiftAsset | null;
  legacy?: boolean;
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
  tradedDay: 0n,
  ready: false,
  asset: null,
});

export const OLD_PACKETS: { chain: GiftChain; lane: GiftLane; address: Hex }[] = [
  { chain: "xlayer", lane: "official", address: "0x4E7D233227764041b18664E30cf349a322A8504E" },
  { chain: "xlayer", lane: "volunteer", address: "0x1A0567219e796Df983Fe584d44E7245B69E72836" },
  { chain: "bsc", lane: "official", address: "0x4F1e48B248c261fdbA6B802CdB7150b48e106A22" },
  { chain: "bsc", lane: "volunteer", address: "0x2F0E6F04E7ABeF8140f98c5d8cCDbdc47BA94cD2" },
];

export async function readLegacy(account: string | null): Promise<RedRule[]> {
  const rows = await Promise.all(OLD_PACKETS.map(async (slot) => {
    const code = await client(slot.chain).getBytecode({ address: slot.address });
    if (!code || code === "0x") return null;
    try {
      const row = await readLive(slot.chain, account, slot.address, slot.lane);
      if (!row.ready || row.balance <= 0n) return null;
      return { ...row, legacy: true };
    } catch {
      return null;
    }
  }));
  return rows.filter((row) => row != null);
}

export async function readRed(chain: GiftChain, account: string | null, lane: GiftLane = "official"): Promise<RedRule> {
  const pool = packetOf(chain, lane);
  try {
    return await readLive(chain, account, pool, lane);
  } catch {
    return emptyAsset(chain, lane);
  }
}

async function readLive(chain: GiftChain, account: string | null, pool: Hex, lane: GiftLane): Promise<RedRule> {
  const c = client(chain);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const who = (account ?? ZERO) as Hex;
  const makerAbi = lane === "volunteer" ? RED_OPEN_ABI : RED_PACKET_ABI;
  const makerName = lane === "volunteer" ? "creator" : "deployer";
  let token: Hex = ZERO;
  let mode = 0;
  let fixedAmt = 0n;
  let lo = 0n;
  let hi = 0n;
  let packetsLeft = 0n;
  let dayCap = 0n;
  let claimedToday = 0n;
  let lastDay = 0n;
  let tradedDay = 0n;
  let ready = false;
  let spotNeed = 0n;
  let perpNeed = 0n;
  let gate = 0;
  let endsAt = 0n;
  let credit = 0n;
  let maker: Hex = ZERO;
  try {
    const packed = await c.multicall({
      allowFailure: false,
      contracts: [
        { address: pool, abi: RED_PACKET_ABI, functionName: "token" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "mode" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "fixedAmt" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "lo" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "hi" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "packetsLeft" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "dayCap" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "claimsToday", args: [now] },
        { address: pool, abi: RED_PACKET_ABI, functionName: "lastDay", args: [who] },
        { address: pool, abi: RED_PACKET_ABI, functionName: "tradedDay", args: [who] },
        { address: pool, abi: RED_PACKET_ABI, functionName: "ready" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "spotNeed" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "perpNeed" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "gate" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "endsAt" },
        { address: pool, abi: RED_PACKET_ABI, functionName: "credit", args: [who] },
        { address: pool, abi: makerAbi, functionName: makerName },
      ],
    });
    [token, mode, fixedAmt, lo, hi, packetsLeft, dayCap, claimedToday, lastDay, tradedDay, ready, spotNeed, perpNeed, gate, endsAt, credit, maker] = packed as unknown as [Hex, number, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, bigint, bigint, number, bigint, bigint, Hex];
  } catch {
    const [a, b, c1, d, e, f, g, h, i, traded, j, k, l, m, n, o, p] = await Promise.all([
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "token" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "mode" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "fixedAmt" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "lo" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "hi" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "packetsLeft" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "dayCap" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "claimsToday", args: [now] }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "lastDay", args: [who] }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "tradedDay", args: [who] }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "ready" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "spotNeed" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "perpNeed" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "gate" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "endsAt" }),
      c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "credit", args: [who] }),
      lane === "volunteer"
        ? c.readContract({ address: pool, abi: RED_OPEN_ABI, functionName: "creator" })
        : c.readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "deployer" }),
    ]);
    token = a; mode = Number(b); fixedAmt = c1; lo = d; hi = e; packetsLeft = f; dayCap = g; claimedToday = h; lastDay = i; tradedDay = traded; ready = j; spotNeed = k; perpNeed = l; gate = Number(m); endsAt = n; credit = o; maker = p;
  }
  const asset = ready ? GIFT_ASSETS[chain].find((row) => row.token.toLowerCase() === token.toLowerCase()) ?? null : null;
  const balance = !ready ? 0n : token === ZERO
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
    tradedDay,
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

export async function withdrawRed(chain: GiftChain, from: string, text: string, asset: GiftAsset, lane: GiftLane = "official", pool: Hex = packetOf(chain, lane)): Promise<Hex> {
  const amount = parseUnits(text.trim(), asset.decimals);
  if (amount <= 0n) throw new Error("amount");
  const hash = await send(chain, from, pool, encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "withdraw", args: [amount] }));
  await wait(chain, hash);
  return hash;
}

export function swapFeeOf(chain: GiftChain, hi: bigint): number {
  const task = taskAsset(chain, hi);
  if (chain !== "bsc" || !task) return 0;
  if (task.id === "bem") return 10000;
  if (task.id === "eth" || task.id === "xau") return 500;
  return 100;
}

const previewAbi = parseAbi(["function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) view returns (uint256 fee, uint256 out)"]);
const v2QuoteAbi = parseAbi(["function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)"]);
const spotAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)"]);
const BEM_POOL = "0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A" as Hex;
const Q96 = 1n << 96n;

async function spotOut(zeroForOne: boolean, amountIn: bigint): Promise<bigint> {
  const row = await xClient.readContract({ address: BEM_POOL, abi: spotAbi, functionName: "slot0" });
  const sqrt = row[0];
  if (sqrt <= 0n || amountIn <= 0n) return 0n;
  if (zeroForOne) {
    const step = (amountIn * sqrt) / Q96;
    return (step * sqrt) / Q96;
  }
  const step = (amountIn * Q96) / sqrt;
  return (step * Q96) / sqrt;
}

async function buyMin(chain: GiftChain, hi: bigint, amountIn: bigint): Promise<bigint> {
  const task = taskAsset(chain, hi);
  if (!task) throw new Error("task");
  let quoted = 0n;
  if (chain === "xlayer" && task.id === "bem") {
    quoted = await spotOut(false, amountIn);
  } else if (chain === "xlayer" && task.id === "tape") {
    const first = await xClient.readContract({ address: OPEN_POOL, abi: previewAbi, functionName: "previewSwap", args: [1, false, amountIn] });
    quoted = first[1];
  } else if (chain === "bsc") {
    const out = task.token === ZERO ? BSC.wbnb : task.token;
    quoted = out.toLowerCase() === BSC.usdt.toLowerCase()
      ? await quoteExact(BSC.wbnb, BSC.usdt, amountIn, 100)
      : await quoteWithBnb(out, swapFeeOf(chain, hi), "buy", amountIn);
  } else {
    const out = task.token === ZERO ? OKB.wokb : task.token;
    const amounts = await xClient.readContract({ address: OKB.router, abi: v2QuoteAbi, functionName: "getAmountsOut", args: [amountIn, [OKB.wokb, out]] });
    quoted = amounts[amounts.length - 1] ?? 0n;
  }
  if (quoted <= 0n) throw new Error("buy");
  return quoted * 95n / 100n;
}

async function approveSpend(chain: GiftChain, from: string, token: Hex, spender: Hex, amount: bigint) {
  const allowance = await client(chain).readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, spender] });
  if (allowance >= amount) return;
  const hash = await send(chain, from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, allowance > 0n ? 0n : amount] }));
  await wait(chain, hash);
  throw new Error("approve");
}

export async function openBlock(chain: GiftChain, from: string, lane: GiftLane = "official", pool: Hex = packetOf(chain, lane)): Promise<"day" | "funds" | null> {
  const here = pool.toLowerCase() === packetOf(chain, lane).toLowerCase() ? await readRed(chain, from, lane) : await readLive(chain, from, pool, lane);
  if (here.lastDay === BigInt(sgDay())) return "day";
  const need = here.spotNeed > here.perpNeed ? here.spotNeed : here.perpNeed;
  if (need <= 0n) return null;
  if (here.gate === 1) return null;
  const bal = await client(chain).getBalance({ address: from as Hex });
  if (bal < need) return "funds";
  return null;
}

export async function walletHold(chain: GiftChain, from: string, token: Hex): Promise<bigint> {
  if (token === ZERO) return client(chain).getBalance({ address: from as Hex });
  return client(chain).readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [from as Hex] });
}

export async function tradedNow(chain: GiftChain, from: string, lane: GiftLane = "volunteer", pool: Hex = packetOf(chain, lane)): Promise<boolean> {
  const day = await client(chain).readContract({ address: pool, abi: RED_PACKET_ABI, functionName: "tradedDay", args: [from as Hex] });
  return day === BigInt(sgDay());
}

const outQuoteAbi = parseAbi([
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160, uint32, uint256)",
]);
const v2InAbi = parseAbi(["function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)"]);

async function sellSearch(need: bigint, quote: (amount: bigint) => Promise<bigint>, probe = 10n ** 15n): Promise<bigint> {
  let size = probe > 0n ? probe : 1n;
  let probed = 0n;
  for (let i = 0; i < 8; i++) {
    try { probed = await quote(size); } catch { probed = 0n; }
    if (probed > 0n) break;
    size /= 10n;
    if (size <= 0n) throw new Error("buy");
  }
  if (probed <= 0n) throw new Error("buy");
  const guess = need * size / probed;
  let lo = guess > 2n ? guess / 2n : 1n;
  let hiAmt = guess > 0n ? guess * 3n : size;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hiAmt) / 2n;
    const out = await quote(mid);
    if (out >= need) hiAmt = mid;
    else lo = mid + 1n;
  }
  if (hiAmt <= 1n) throw new Error("buy");
  return hiAmt * 103n / 100n;
}

async function sellAmount(chain: GiftChain, hi: bigint, need: bigint): Promise<bigint> {
  const task = taskAsset(chain, hi);
  if (!task || task.token === ZERO) throw new Error("task");
  if (chain === "bsc") {
    if (task.token.toLowerCase() === BSC.usdt.toLowerCase()) {
      const quoted = await bscClient.readContract({
        address: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
        abi: outQuoteAbi,
        functionName: "quoteExactOutputSingle",
        args: [{ tokenIn: BSC.usdt, tokenOut: BSC.wbnb, amount: need, fee: 100, sqrtPriceLimitX96: 0n }],
      });
      const amountIn = quoted[0];
      if (amountIn <= 0n) throw new Error("buy");
      return amountIn * 103n / 100n;
    }
    return sellSearch(need, (amount) => quoteWithBnb(task.token, swapFeeOf(chain, hi), "sell", amount), 10n ** BigInt(task.decimals) / 100n);
  }
  if (chain === "xlayer" && task.id === "bem") return sellSearch(need, (amount) => spotOut(true, amount), 10n ** 6n);
  if (task.id === "tape") {
    return sellSearch(need, async (amount) => {
      const row = await xClient.readContract({ address: OPEN_POOL, abi: previewAbi, functionName: "previewSwap", args: [1, true, amount] });
      return row[1];
    }, 10n ** 8n);
  }
  const amounts = await xClient.readContract({ address: OKB.router, abi: v2InAbi, functionName: "getAmountsIn", args: [need, [task.token, OKB.wokb]] });
  const amountIn = amounts[0];
  if (amountIn <= 0n) throw new Error("buy");
  return amountIn * 103n / 100n;
}

function shownAmount(raw: bigint, decimals: number): string {
  const n = Number(formatUnits(raw, decimals));
  if (!(n > 0)) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export async function sellPreview(chain: GiftChain, hi: bigint, need: bigint): Promise<{ sold: string; back: string }> {
  const task = taskAsset(chain, hi);
  if (!task || task.token === ZERO || need <= 0n) return { sold: "", back: "" };
  const amountIn = await sellAmount(chain, hi, need);
  let native = 0n;
  try {
    if (chain === "bsc") native = task.token.toLowerCase() === BSC.usdt.toLowerCase()
      ? await quoteExact(BSC.usdt, BSC.wbnb, amountIn, 100)
      : await quoteWithBnb(task.token, swapFeeOf(chain, hi), "sell", amountIn);
    else if (task.id === "bem") native = await spotOut(true, amountIn);
    else if (task.id === "tape") {
      const row = await xClient.readContract({ address: OPEN_POOL, abi: previewAbi, functionName: "previewSwap", args: [1, true, amountIn] });
      native = row[1];
    } else {
      const amounts = await xClient.readContract({ address: OKB.router, abi: v2QuoteAbi, functionName: "getAmountsOut", args: [amountIn, [task.token, OKB.wokb]] });
      native = amounts[amounts.length - 1];
    }
  } catch {
    native = 0n;
  }
  return { sold: shownAmount(amountIn, task.decimals), back: native > 0n ? shownAmount(native, 18) : "" };
}

export async function tradeRed(chain: GiftChain, from: string, lane: GiftLane = "volunteer", pool: Hex = packetOf(chain, lane)): Promise<Hex> {
  const here = pool.toLowerCase() === packetOf(chain, lane).toLowerCase() ? await readRed(chain, from, lane) : await readLive(chain, from, pool, lane);
  if (here.lastDay === BigInt(sgDay())) throw new Error("day");
  if (await tradedNow(chain, from, lane, pool)) throw new Error("traded");
  const need = here.spotNeed > here.perpNeed ? here.spotNeed : here.perpNeed;
  if (need <= 0n || here.hi === 0n) throw new Error("task");
  if (here.gate === 0) {
    const bal = await client(chain).getBalance({ address: from as Hex });
    if (bal < need) throw new Error("funds");
    const minOut = await buyMin(chain, here.hi, need);
    const data = encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "trade", args: [0n, minOut] });
    await preflight(chain, from, pool, data, need);
    const hash = await send(chain, from, pool, data, need);
    await wait(chain, hash);
    return hash;
  }
  const amountIn = await sellAmount(chain, here.hi, need);
  const task = taskAsset(chain, here.hi);
  if (!task || task.token === ZERO) throw new Error("task");
  await approveSpend(chain, from, task.token, pool, amountIn);
  const data = encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "trade", args: [amountIn, need] });
  await preflight(chain, from, pool, data);
  const hash = await send(chain, from, pool, data);
  await wait(chain, hash);
  return hash;
}

export async function claimRed(chain: GiftChain, from: string, lane: GiftLane = "volunteer", pool: Hex = packetOf(chain, lane)): Promise<{ hash: Hex; amount: bigint }> {
  const day = sgDay();
  const here = pool.toLowerCase() === packetOf(chain, lane).toLowerCase() ? await readRed(chain, from, lane) : await readLive(chain, from, pool, lane);
  if (here.lastDay === BigInt(day)) throw new Error("day");
  const need = here.spotNeed > here.perpNeed ? here.spotNeed : here.perpNeed;
  if (need <= 0n || here.hi === 0n) throw new Error("task");
  if (!(await tradedNow(chain, from, lane, pool))) throw new Error("task");
  const data = encodeFunctionData({ abi: RED_PACKET_ABI, functionName: "claim" });
  await preflight(chain, from, pool, data);
  const hash = await send(chain, from, pool, data);
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
      parseUnits(spotText.trim() || "0", 18),
      0n,
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
