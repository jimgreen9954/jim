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

function hopPays(calldata: string, source: 56 | 196, router: string): void {
  if (calldata.length === 0) return;
  const sel = calldata.slice(0, 8);
  if (sel !== EXACT_INPUT_SINGLE) throw new Error("quote");
  const recipient = addr(calldata, 4 + 96);
  const gateway = GATEWAY[source];
  if (same(recipient, router)) return;
  if (gateway && same(recipient, gateway)) return;
  throw new Error("quote");
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
  hopPays(first, source, router);
  hopPays(second, source, router);
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
