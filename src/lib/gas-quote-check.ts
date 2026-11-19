import type { Hex } from "viem";

/** Routers checked with eth_getCode: code on the source chain, none on the other chain. */
const ROUTER: Record<56 | 196, Hex> = {
  56: "0x851B43189de721dD94AbA767AAd9E6F6d6a95CCA",
  196: "0xcE8f24A58D85eD5c5A6824f7be1F8d4711A0eb4C",
};

/**
 * X Layer metaRouterGateway published beside 0xcE8f24… and confirmed to have code there.
 * A Uniswap hop is accepted only when it pays this gateway or the router itself.
 */
const GATEWAY: Partial<Record<56 | 196, Hex>> = {
  196: "0xAdB2d3b711Bb8d8Ea92ff70292c466140432c278",
};

/** Portals from the Symbiosis config that matched a live quote and have code on that chain. */
const PORTAL: Record<56 | 196, Hex> = {
  56: "0x5Aa5f7f84eD0E5db0a4a85C3947eA16B53352FD4",
  196: "0x292fC50e4eB66C3f6514b9E402dBc25961824D62",
};

const META_ROUTE = "a11b1198";
const META_SYNTH = "ce654c17";
const EXACT_INPUT_SINGLE = "04e45aaf";
/** 0x Settler `exec(address,address,uint256,address,bytes)`, seen on the live BSC BNB to OKB quote. */
const EXEC = "2213bc0b";
/** Settler `execute((address,address,uint256),bytes[],bytes32)`. */
const SETTLEMENT = "1fff991f";
const NATIVE_CHECK = "bd01c226";
const BASIC = "38c9c147";
const UNI_V3 = "8d68a156";
const POSITIVE_SLIPPAGE = "5f80abae";
const SETTLER: Partial<Record<56 | 196, Hex>> = {
  56: "0xd52e8e422a352ac1afdc2bd6ec533d41b20acb7b",
};

/**
 * Addresses a BSC settler hop may name. The Uniswap step must pay the settler itself.
 * Anything else, including a recipient tucked into a later action, is rejected.
 */
const HOP_TOKEN: Record<56 | 196, readonly Hex[]> = {
  56: [
    "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "0x55d398326f99059fF775485246999027B3197955",
    "0x980447ddcef79a7499da4538da8fc59bacad6997",
    "0xf5c4f3dc02c3fb9279495a8fef7b0741da956157",
    "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  ],
  196: [],
};

export type GasIntent = {
  sourceChain: 56 | 196;
  targetChain: 56 | 196;
  user: string;
  amountIn: bigint;
  symbolOut: "BNB" | "OKB";
};

type Amount = { amount?: string; chainId?: number | string; address?: string; symbol?: string; decimals?: number | string };

export type RawGasQuote = {
  tokenAmountOut?: Amount;
  tokenAmountOutMin?: Amount;
  approveTo?: string;
  tx?: { to?: string; data?: string; value?: string; chainId?: number | string };
};

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function hex(data: string): string {
  const body = data.toLowerCase();
  if (!body.startsWith("0x")) throw new Error("quote");
  return body.slice(2);
}

function word(data: string, byte: number): bigint {
  const start = byte * 2;
  const slice = data.slice(start, start + 64);
  if (slice.length !== 64) throw new Error("quote");
  return BigInt(`0x${slice}`);
}

function addr(data: string, byte: number): string {
  return `0x${data.slice(byte * 2 + 24, byte * 2 + 64)}`;
}

function chainOf(value: number | string | undefined): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  throw new Error("quote");
}

function nativeOut(row: Amount | undefined, chain: 56 | 196, symbol: "BNB" | "OKB"): bigint {
  if (!row) throw new Error("quote");
  if (chainOf(row.chainId) !== chain) throw new Error("quote");
  if ((row.symbol || "").toUpperCase() !== symbol) throw new Error("quote");
  const token = (row.address || "").toLowerCase();
  if (token !== "" && token !== "0x" && token !== `0x${"0".repeat(40)}`) throw new Error("quote");
  if (!row.amount || !/^\d+$/.test(row.amount)) throw new Error("quote");
  const amount = BigInt(row.amount);
  if (amount <= 0n) throw new Error("quote");
  return amount;
}

function bytesAt(data: string, offset: number): string {
  const len = Number(word(data, offset));
  if (!Number.isSafeInteger(len)) throw new Error("quote");
  const start = (offset + 32) * 2;
  const slice = data.slice(start, start + len * 2);
  if (slice.length !== len * 2) throw new Error("quote");
  return slice;
}

function hopPays(calldata: string, source: 56 | 196, router: string, amountIn: bigint): void {
  if (calldata.length === 0) return;
  const sel = calldata.slice(0, 8);
  if (sel === EXACT_INPUT_SINGLE) {
    const recipient = addr(calldata, 4 + 96);
    const gateway = GATEWAY[source];
    if (same(recipient, router)) return;
    if (gateway && same(recipient, gateway)) return;
    throw new Error("quote");
  }
  if (sel === EXEC) {
    allowExec(calldata, source, router, amountIn);
    return;
  }
  throw new Error("quote");
}

function allowExec(calldata: string, source: 56 | 196, router: string, amountIn: bigint): void {
  const settler = SETTLER[source];
  if (!settler) throw new Error("quote");
  const args = calldata.slice(8);
  if (word(args, 64) !== amountIn) throw new Error("quote");
  const operator = addr(args, 0);
  const token = addr(args, 32);
  const recipient = addr(args, 96);
  if (!same(operator, settler)) throw new Error("quote");
  if (token !== `0x${"0".repeat(40)}`) throw new Error("quote");
  if (!same(recipient, settler) && !same(recipient, router) && !same(recipient, PORTAL[source])) throw new Error("quote");
  const allow = new Set(
    [settler, router, PORTAL[source], ...HOP_TOKEN[source]].map((item) => item.toLowerCase()),
  );
  const bytesOff = Number(word(args, 128));
  if (!Number.isSafeInteger(bytesOff)) throw new Error("quote");
  const blobLen = Number(word(args, bytesOff));
  if (!Number.isSafeInteger(blobLen) || blobLen < 4) throw new Error("quote");
  const start = bytesOff + 32;
  if ((start + blobLen) * 2 > args.length) throw new Error("quote");
  readSettlement(args.slice(start * 2, (start + blobLen) * 2), source, allow, settler);
}

function readSettlement(blob: string, source: 56 | 196, allow: Set<string>, settler: string): void {
  if (!blob.startsWith(SETTLEMENT)) throw new Error("quote");
  const inner = blob.slice(8);
  const buy = addr(inner, 32);
  const usdc = HOP_TOKEN[source][0];
  if (!usdc || !same(buy, usdc)) throw new Error("quote");
  note(addr(inner, 0), allow);
  const arrayAt = Number(word(inner, 96));
  if (!Number.isSafeInteger(arrayAt)) throw new Error("quote");
  const count = Number(word(inner, arrayAt));
  if (!Number.isSafeInteger(count) || count < 1 || count > 8) throw new Error("quote");
  for (let i = 0; i < count; i += 1) {
    const rel = Number(word(inner, arrayAt + 32 + i * 32));
    if (!Number.isSafeInteger(rel)) throw new Error("quote");
    const at = arrayAt + 32 + rel;
    const len = Number(word(inner, at));
    if (!Number.isSafeInteger(len) || len < 4) throw new Error("quote");
    const action = inner.slice((at + 32) * 2, (at + 32 + len) * 2);
    if (action.length !== len * 2) throw new Error("quote");
    readAction(action, allow, settler);
  }
}

function readAction(action: string, allow: Set<string>, settler: string): void {
  const sel = action.slice(0, 8);
  if (sel !== NATIVE_CHECK && sel !== BASIC && sel !== UNI_V3 && sel !== POSITIVE_SLIPPAGE) throw new Error("quote");
  for (let byte = 4; byte + 32 <= action.length / 2; byte += 32) {
    const value = word(action, byte);
    if (value <= 1n << 80n || value >= 1n << 160n) continue;
    note(`0x${value.toString(16).padStart(40, "0")}`, allow);
  }
  if (sel === UNI_V3) {
    if (!same(addr(action, 4), settler)) throw new Error("quote");
    const pathAt = 4 + Number(word(action, 4 + 64));
    if (!Number.isSafeInteger(pathAt)) throw new Error("quote");
    const pathLen = Number(word(action, pathAt));
    if (pathLen !== 64) throw new Error("quote");
    const path = action.slice((pathAt + 32) * 2, (pathAt + 32 + 64) * 2);
    if (path.length !== 128) throw new Error("quote");
    note(`0x${path.slice(0, 40)}`, allow);
    note(`0x${path.slice(88, 128)}`, allow);
  }
}

function note(found: string, allow: Set<string>): void {
  if (!allow.has(found.toLowerCase())) throw new Error("quote");
}

function metaRoute(data: string, source: 56 | 196, router: string, user: string, amountIn: bigint): void {
  const raw = hex(data);
  if (!raw.startsWith(META_ROUTE)) throw new Error("quote");
  const body = raw.slice(8);
  if (word(body, 0) !== 32n) throw new Error("quote");
  const st = body.slice(64);
  const first = bytesAt(st, Number(word(st, 0)));
  const second = bytesAt(st, Number(word(st, 32)));
  if (word(st, 160) !== amountIn) throw new Error("quote");
  if (word(st, 192) !== 1n) throw new Error("quote");
  const relay = addr(st, 224);
  if (!same(relay, PORTAL[source])) throw new Error("quote");
  hopPays(first, source, router, amountIn);
  hopPays(second, source, router, amountIn);
  const other = bytesAt(st, Number(word(st, 256)));
  if (!other.startsWith(META_SYNTH)) throw new Error("quote");
  const otherBody = other.slice(8);
  if (word(otherBody, 0) !== 32n) throw new Error("quote");
  const synth = otherBody.slice(64);
  if (!same(addr(synth, 96), user)) throw new Error("quote");
}

/** Reject a quote that is not the exact native bridge the user asked for. */
export function assertGasQuote(intent: GasIntent, json: RawGasQuote): {
  to: Hex;
  data: Hex;
  value: bigint;
  chainId: 56 | 196;
  amountOut: bigint;
  amountOutMin: bigint;
} {
  if (intent.amountIn <= 0n) throw new Error("quote");
  if (intent.sourceChain === intent.targetChain) throw new Error("quote");
  const tx = json.tx;
  if (!tx?.to || !tx.data) throw new Error("quote");
  const chainId = chainOf(tx.chainId);
  if (chainId !== intent.sourceChain) throw new Error("quote");
  const router = ROUTER[intent.sourceChain];
  if (!same(tx.to, router)) throw new Error("quote");
  if (json.approveTo && !same(json.approveTo, router)) throw new Error("quote");
  const value = BigInt(tx.value || "0");
  if (value !== intent.amountIn) throw new Error("quote");
  const amountOut = nativeOut(json.tokenAmountOut, intent.targetChain, intent.symbolOut);
  const amountOutMin = nativeOut(json.tokenAmountOutMin, intent.targetChain, intent.symbolOut);
  if (amountOutMin > amountOut) throw new Error("quote");
  metaRoute(tx.data, intent.sourceChain, router, intent.user, intent.amountIn);
  return { to: router, data: tx.data as Hex, value, chainId, amountOut, amountOutMin };
}
