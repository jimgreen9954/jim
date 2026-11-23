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
/** Pancake Infinity Universal Router `execute(bytes,bytes[],uint256)`. */
const INFINITY = "3593564c";
/** BSC Infinity router seen on the live BNB to OKB quote, and confirmed to have code. */
const INFINITY_DEX = "0x91bf3bfaef8d771a74e1a8fe460b3ee646b2e588";
/** The swap output is taken to this contract, which forwards USDC into the Symbiosis portal. */
const INFINITY_TAKE = "0x980447ddcef79a7499da4538da8fc59bacad6997";
/** Settler `execute((address,address,uint256),bytes[],bytes32)`. */
const SETTLEMENT = "1fff991f";
const NATIVE_CHECK = "bd01c226";
const BASIC = "38c9c147";
const UNI_V3 = "8d68a156";
const POSITIVE_SLIPPAGE = "5f80abae";
const SETTLER: Partial<Record<56 | 196, Hex>> = {
  56: "0xd52e8e422a352ac1afdc2bd6ec533d41b20acb7b",
};
/** 0x Allowance Holder. The meta router calls this, and the calldata names the settler. */
const ZERO_EX = "0x0000000000001ff3684f28c67538d4d072c22734";
/** Settler `UNISWAPV4`, used for the USDT to USDC hop. */
const UNI_V4 = "68f5ee25";
const PPM = 1_000_000n;
/** PancakeSwap V3 WBNB/USDC, fee 100. Factory getPool returns this pool. */
const PANCAKE_BNB_USDC = "0xf2688Fb5B81049DFB7703aDa5e770543770612C4";
/** WOKB/USDT0 pool used to price the OKB that must arrive. */
const OKB_USDT = "0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082";
const USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const ZERO = `0x${"0".repeat(40)}`;
const MAX_U256 = (1n << 256n) - 1n;
const WBNB = "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c";
const ALLOWANCE_HOLDER = "0x980447ddcef79a7499da4538da8fc59bacad6997";
const SLIP_RECIPIENT = "0xf5c4f3dc02c3fb9279495a8fef7b0741da956157";
/**
 * One Pancake hop: WBNB, fork 0, fee 100, the sqrt limit from the checked quote, USDC.
 * The 20 bytes after the fee are a sqrt-price limit, not a pool. The pool for fee 100 is PANCAKE_BNB_USDC.
 */
const PANCAKE_PATH =
  "bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c00000064fffd8963efd1fc6a506488495d951d5263988d258ac76a51cc950d9822d68b83fe1ad97b32cd580d";
/** BASIC that only wraps BNB into WBNB. */
const WRAP =
  "38c9c147000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee00000000000000000000000000000000000000000000000000000000000f4240000000000000000000000000bb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000024d0e30db0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
const BSC_RPC = ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com"];
const XLAYER_RPC = ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"];

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

function hopPays(calldata: string, source: 56 | 196, router: string, amountIn: bigint, dex: string): bigint {
  if (calldata.length === 0) return 0n;
  const sel = calldata.slice(0, 8);
  if (sel === EXACT_INPUT_SINGLE) {
    const recipient = addr(calldata, 4 + 96);
    const gateway = GATEWAY[source];
    if (same(recipient, router)) return 0n;
    if (gateway && same(recipient, gateway)) return 0n;
    throw new Error("quote");
  }
  if (sel === EXEC) {
    if (!same(dex, ZERO_EX)) throw new Error("quote");
    return allowExec(calldata, source, router, amountIn);
  }
  if (sel === INFINITY) return allowInfinity(calldata, source, amountIn, dex);
  throw new Error("quote");
}

function allowExec(calldata: string, source: 56 | 196, router: string, amountIn: bigint): bigint {
  const settler = SETTLER[source];
  if (!settler) throw new Error("quote");
  const args = calldata.slice(8);
  if (word(args, 64) !== amountIn) throw new Error("quote");
  if (!same(addr(args, 0), settler)) throw new Error("quote");
  if (addr(args, 32) !== `0x${"0".repeat(40)}`) throw new Error("quote");
  const paid = addr(args, 96);
  if (!same(paid, settler) && !same(paid, router) && !same(paid, PORTAL[source])) throw new Error("quote");
  const bytesOff = Number(word(args, 128));
  if (!Number.isSafeInteger(bytesOff)) throw new Error("quote");
  const blobLen = Number(word(args, bytesOff));
  if (!Number.isSafeInteger(blobLen) || blobLen < 4) throw new Error("quote");
  const start = bytesOff + 32;
  if ((start + blobLen) * 2 > args.length) throw new Error("quote");
  return readSettlement(args.slice(start * 2, (start + blobLen) * 2), amountIn, settler);
}

function readSettlement(blob: string, amountIn: bigint, settler: string): bigint {
  if (!blob.startsWith(SETTLEMENT)) throw new Error("quote");
  const inner = blob.slice(8);
  if (!same(addr(inner, 0), ALLOWANCE_HOLDER)) throw new Error("quote");
  if (!same(addr(inner, 32), USDC)) throw new Error("quote");
  const minBuy = word(inner, 64);
  if (minBuy <= 0n) throw new Error("quote");
  const arrayAt = Number(word(inner, 96));
  if (!Number.isSafeInteger(arrayAt)) throw new Error("quote");
  const count = Number(word(inner, arrayAt));
  if (count < 4 || count > 6) throw new Error("quote");
  let wrapped = false;
  let boughtUsdc = false;
  for (let i = 0; i < count; i += 1) {
    const rel = Number(word(inner, arrayAt + 32 + i * 32));
    if (!Number.isSafeInteger(rel)) throw new Error("quote");
    const at = arrayAt + 32 + rel;
    const len = Number(word(inner, at));
    if (!Number.isSafeInteger(len) || len < 4) throw new Error("quote");
    const action = inner.slice((at + 32) * 2, (at + 32 + len) * 2);
    if (action.length !== len * 2) throw new Error("quote");
    const sel = action.slice(0, 8);
    if (i === 0) {
      if (sel !== NATIVE_CHECK) throw new Error("quote");
      readStep(action, amountIn, settler, minBuy);
      continue;
    }
    if (i === count - 1) {
      if (sel !== POSITIVE_SLIPPAGE) throw new Error("quote");
      readStep(action, amountIn, settler, minBuy);
      continue;
    }
    if (action === WRAP) {
      wrapped = true;
      continue;
    }
    if (sel === UNI_V3) {
      const out = readUni(action, settler);
      if (out === "usdc") boughtUsdc = true;
      continue;
    }
    if (sel === UNI_V4) {
      readV4(action, settler);
      boughtUsdc = true;
      continue;
    }
    if (sel === BASIC) {
      const sell = readBasicPool(action);
      if (same(sell, USDT) || same(sell, USDC)) boughtUsdc = true;
      continue;
    }
    throw new Error("quote");
  }
  if (!wrapped || !boughtUsdc) throw new Error("quote");
  return minBuy;
}

function readUni(action: string, settler: string): "usdc" | "usdt" {
  if (!same(addr(action, 4), settler)) throw new Error("quote");
  const pathAt = 4 + Number(word(action, 4 + 64));
  if (!Number.isSafeInteger(pathAt)) throw new Error("quote");
  const pathLen = Number(word(action, pathAt));
  if (pathLen !== 64) throw new Error("quote");
  const path = action.slice((pathAt + 32) * 2, (pathAt + 96) * 2);
  const fork = path.slice(40, 42);
  const fee = path.slice(42, 48);
  const sqrt = path.slice(48, 88);
  const out = path.slice(88, 128);
  if (path.slice(0, 40) !== WBNB.slice(2)) throw new Error("quote");
  if (fork !== "00" && fork !== "01") throw new Error("quote");
  if (fee !== "000064") throw new Error("quote");
  if (sqrt !== "fffd8963efd1fc6a506488495d951d5263988d25") throw new Error("quote");
  if (out === USDC.slice(2)) return "usdc";
  if (out === USDT.slice(2)) return "usdt";
  throw new Error("quote");
}

function readV4(action: string, settler: string): void {
  const args = action.slice(8);
  if (!same(addr(args, 0), settler)) throw new Error("quote");
  const sell = addr(args, 32);
  if (!same(sell, USDT) && !same(sell, USDC) && !same(sell, WBNB)) throw new Error("quote");
  if (word(args, 64) !== PPM || word(args, 96) !== 0n || word(args, 128) !== 0n) throw new Error("quote");
  const fillsAt = Number(word(args, 224));
  if (!Number.isSafeInteger(fillsAt)) throw new Error("quote");
  const fills = bytesAt(args, fillsAt);
  if (fills.length !== 146) throw new Error("quote");
  if (fills.slice(0, 6) !== "0f4240") throw new Error("quote");
  const sqrt = BigInt(`0x${fills.slice(6, 46)}`);
  // Uniswap v4 no-limit prices: minimum sqrt plus one, or maximum sqrt minus one.
  if (sqrt !== 4_295_128_740n && sqrt !== 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341n) throw new Error("quote");
  if (fills.slice(46, 48) !== "01") throw new Error("quote");
  if (fills.slice(48, 88) !== USDC.slice(2)) throw new Error("quote");
  const fee = BigInt(`0x${fills.slice(88, 94)}`);
  const tick = BigInt(`0x${fills.slice(94, 100)}`);
  if (fee <= 0n || fee > 1_000_000n || tick <= 0n || tick > 32_767n) throw new Error("quote");
  if (fills.slice(100, 140) !== "0".repeat(40) || fills.slice(140) !== "000000") throw new Error("quote");
}

function readBasicPool(action: string): string {
  const args = action.slice(8);
  const sell = addr(args, 0);
  const ppm = word(args, 32);
  const pool = addr(args, 64);
  if (ppm <= 0n || ppm > PPM || pool === ZERO || same(pool, sell)) throw new Error("quote");
  if (!same(sell, WBNB) && !same(sell, USDT) && !same(sell, USDC)) throw new Error("quote");
  return sell;
}

function readStep(action: string, amountIn: bigint, settler: string, minBuy: bigint): void {
  const sel = action.slice(0, 8);
  if (sel === NATIVE_CHECK) {
    if (word(action, 4 + 32) !== amountIn) throw new Error("quote");
    return;
  }
  if (sel === BASIC) {
    if (action !== WRAP) throw new Error("quote");
    if (!same(addr(action, 4), "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")) throw new Error("quote");
    if (!same(addr(action, 4 + 64), WBNB)) throw new Error("quote");
    return;
  }
  if (sel === UNI_V3) {
    if (!same(addr(action, 4), settler)) throw new Error("quote");
    const pathAt = 4 + Number(word(action, 4 + 64));
    if (!Number.isSafeInteger(pathAt)) throw new Error("quote");
    const pathLen = Number(word(action, pathAt));
    if (pathLen !== 64) throw new Error("quote");
    const path = action.slice((pathAt + 32) * 2, (pathAt + 96) * 2);
    if (path !== PANCAKE_PATH) throw new Error("quote");
    return;
  }
  if (sel === POSITIVE_SLIPPAGE) {
    if (!same(addr(action, 4), SLIP_RECIPIENT)) throw new Error("quote");
    if (!same(addr(action, 4 + 32), USDC)) throw new Error("quote");
    if (word(action, 4 + 64) < minBuy) throw new Error("quote");
    return;
  }
  throw new Error("quote");
}

/** Pancake Infinity `execute`: one INFI_SWAP, then settle native and take USDC to the pinned forwarder. */
function allowInfinity(calldata: string, source: 56 | 196, amountIn: bigint, dex: string): bigint {
  if (source !== 56 || !same(dex, INFINITY_DEX)) throw new Error("quote");
  const args = calldata.slice(8);
  const commandsAt = Number(word(args, 0));
  const inputsAt = Number(word(args, 32));
  if (!Number.isSafeInteger(commandsAt) || !Number.isSafeInteger(inputsAt)) throw new Error("quote");
  if (bytesAt(args, commandsAt) !== "10") throw new Error("quote");
  if (word(args, inputsAt) !== 1n) throw new Error("quote");
  const rel = Number(word(args, inputsAt + 32));
  if (!Number.isSafeInteger(rel)) throw new Error("quote");
  const plan = bytesAt(args, inputsAt + 32 + rel);
  const actionsAt = Number(word(plan, 0));
  const paramsAt = Number(word(plan, 32));
  if (!Number.isSafeInteger(actionsAt) || !Number.isSafeInteger(paramsAt)) throw new Error("quote");
  const actions = bytesAt(plan, actionsAt);
  if (actions !== "060c0e" && actions !== "070c0e") throw new Error("quote");
  if (word(plan, paramsAt) !== 3n) throw new Error("quote");
  const params = [0, 1, 2].map((i) => {
    const off = Number(word(plan, paramsAt + 32 + i * 32));
    if (!Number.isSafeInteger(off)) throw new Error("quote");
    return bytesAt(plan, paramsAt + 32 + off);
  });
  const minBuy = actions === "060c0e" ? readSingle(params[0], amountIn) : readPath(params[0], amountIn);
  readSettle(params[1]);
  readTake(params[2]);
  return minBuy;
}

function readSingle(blob: string, amountIn: bigint): bigint {
  if (word(blob, 0) !== 32n) throw new Error("quote");
  const body = blob.slice(64);
  if (addr(body, 0) !== ZERO || !same(addr(body, 32), USDC)) throw new Error("quote");
  if (addr(body, 128) !== ZERO || word(body, 160) !== 1n) throw new Error("quote");
  const fee = word(body, 64);
  const tick = word(body, 96);
  if (fee <= 0n || fee > 1_000_000n || tick <= 0n || tick > 32_767n) throw new Error("quote");
  if (word(body, 192) !== amountIn) throw new Error("quote");
  const minBuy = word(body, 224);
  if (minBuy <= 0n) throw new Error("quote");
  const hookAt = Number(word(body, 256));
  if (!Number.isSafeInteger(hookAt) || bytesAt(body, hookAt) !== "") throw new Error("quote");
  return minBuy;
}

function readPath(blob: string, amountIn: bigint): bigint {
  if (word(blob, 0) !== 32n) throw new Error("quote");
  const body = blob.slice(64);
  if (addr(body, 0) !== ZERO) throw new Error("quote");
  const pathAt = Number(word(body, 32));
  const extraAt = Number(word(body, 64));
  if (!Number.isSafeInteger(pathAt) || !Number.isSafeInteger(extraAt)) throw new Error("quote");
  if (word(body, 96) !== amountIn) throw new Error("quote");
  const minBuy = word(body, 128);
  if (minBuy <= 0n) throw new Error("quote");
  if (bytesAt(body, extraAt) !== "") throw new Error("quote");
  const hops = Number(word(body, pathAt));
  if (!Number.isSafeInteger(hops) || hops < 1 || hops > 3) throw new Error("quote");
  let last = "";
  for (let i = 0; i < hops; i += 1) {
    const rel = Number(word(body, pathAt + 32 + i * 32));
    if (!Number.isSafeInteger(rel)) throw new Error("quote");
    const keyAt = pathAt + 32 + rel;
    const currency = addr(body, keyAt);
    if (!same(currency, USDT) && !same(currency, USDC)) throw new Error("quote");
    const fee = word(body, keyAt + 32);
    const tick = word(body, keyAt + 64);
    if (fee <= 0n || fee > 1_000_000n || tick <= 0n || tick > 32_767n) throw new Error("quote");
    if (addr(body, keyAt + 96) !== ZERO) throw new Error("quote");
    const hookAt = Number(word(body, keyAt + 128));
    if (!Number.isSafeInteger(hookAt) || bytesAt(body, keyAt + hookAt) !== "") throw new Error("quote");
    last = currency;
  }
  if (!same(last, USDC)) throw new Error("quote");
  return minBuy;
}

function readSettle(blob: string): void {
  if (addr(blob, 0) !== ZERO || word(blob, 32) !== MAX_U256) throw new Error("quote");
}

function readTake(blob: string): void {
  if (!same(addr(blob, 0), USDC) || !same(addr(blob, 32), INFINITY_TAKE) || word(blob, 64) !== 0n) throw new Error("quote");
}

function metaRoute(data: string, source: 56 | 196, router: string, user: string, amountIn: bigint): bigint {
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
  const firstDex = addr(st, 96);
  const secondDex = addr(st, 128);
  const left = hopPays(first, source, router, amountIn, firstDex);
  const right = hopPays(second, source, router, amountIn, secondDex);
  const other = bytesAt(st, Number(word(st, 256)));
  if (!other.startsWith(META_SYNTH)) throw new Error("quote");
  const otherBody = other.slice(8);
  if (word(otherBody, 0) !== 32n) throw new Error("quote");
  const synth = otherBody.slice(64);
  if (!same(addr(synth, 96), user)) throw new Error("quote");
  return left > right ? left : right;
}

async function ethCall(urls: string[], to: string, data: string): Promise<bigint> {
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      });
      const json = (await res.json()) as { result?: string };
      if (json.result && json.result.startsWith("0x") && json.result.length >= 66) return BigInt(json.result.slice(0, 66));
    } catch {
      /* next */
    }
  }
  throw new Error("quote");
}

/** USDC (18) out for `bnb` wei, from the fee-100 pool. token0 is USDC and token1 is WBNB. */
async function usdcForBnb(bnb: bigint): Promise<bigint> {
  const sqrt = await ethCall(BSC_RPC, PANCAKE_BNB_USDC, "0x3850c7bd");
  if (sqrt <= 0n) throw new Error("quote");
  return (bnb * (1n << 192n)) / (sqrt * sqrt);
}

/** OKB wei bought by `usdc` (18) at the WOKB/USDT0 pool. token0 is USDT0 (6) and token1 is WOKB. */
async function okbForUsdc(usdc: bigint): Promise<bigint> {
  const sqrt = await ethCall(XLAYER_RPC, OKB_USDT, "0x3850c7bd");
  if (sqrt <= 0n) throw new Error("quote");
  const wokbPerUsdtRaw = (sqrt * sqrt) / (1n << 192n);
  return (usdc / 1_000_000_000_000n) * wokbPerUsdtRaw;
}

/** Reject a quote that is not the exact native bridge the user asked for. */
export async function assertGasQuote(intent: GasIntent, json: RawGasQuote): Promise<{
  to: Hex;
  data: Hex;
  value: bigint;
  chainId: 56 | 196;
  amountOut: bigint;
  amountOutMin: bigint;
}> {
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
  const minBuy = metaRoute(tx.data, intent.sourceChain, router, intent.user, intent.amountIn);
  if (minBuy > 0n) {
    const usdc = await usdcForBnb(intent.amountIn);
    if (usdc <= 0n || minBuy * 100n < usdc * 99n) throw new Error("quote");
  }
  if (intent.sourceChain === 56) {
    const usdc = await usdcForBnb(intent.amountIn);
    const okb = await okbForUsdc(usdc);
    // The bridge keeps about 0.006 OKB. A small gas top-up is therefore under
    // 98% of the pool. Allow 0.008 OKB for that fee, and still reject a quote
    // that returns less than half of the pool.
    const bridgeFee = 8_000_000_000_000_000n;
    if (okb <= 0n || amountOutMin * 2n < okb || amountOutMin + bridgeFee < (okb * 98n) / 100n) throw new Error("quote");
  }
  return { to: router, data: tx.data as Hex, value, chainId, amountOut, amountOutMin };
}
