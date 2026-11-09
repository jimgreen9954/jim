import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  parseAbi,
  type Hex,
} from "viem";
import { pretty, units, XLAYER_SAFE } from "@/lib/bsc";
import { deskParts } from "@/lib/invite-cut";
import { quoteBemOkb, quoteOkb } from "@/lib/okb";
import { sayTradeStep } from "@/lib/trade-step";
import { connectXLayer, xClient } from "@/lib/xlayer";
import { ensureProvider } from "@/lib/wallet";

export const FAB = "0x72f349b1eee7833b26f8c81a8410775a4e231ed2" as Hex;
export const FAB_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as Hex;
export const FAB_QUOTER = "0x8928074CA1b241D8Ec02815881c1Af11E8bC5219" as Hex;

const ROUTER = "0xda00ae15d3a71466517129255255db7c0c0956d3" as Hex;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Hex;
const SLIP = 100;

const poolKey = {
  currency0: FAB_BEM,
  currency1: FAB,
  fee: 9000,
  tickSpacing: 180,
  hooks: "0x0000000000000000000000000000000000000000" as Hex,
};

const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)",
]);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);

const permitAbi = parseAbi([
  "function allowance(address,address,address) view returns (uint160 amount, uint48 expiration, uint48 nonce)",
  "function approve(address,address,uint160,uint48)",
]);

const routerAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);

async function v4Out(buy: boolean, amountIn: bigint): Promise<bigint> {
  const data = encodeFunctionData({
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey, zeroForOne: buy, exactAmount: amountIn, hookData: "0x" }],
  });
  const res = await xClient.call({ to: FAB_QUOTER, data });
  const [out] = decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", data: res.data ?? "0x" });
  return out;
}

function feeInput(token: Hex, to: Hex, amount: bigint): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint160" }], [token, to, amount]);
}

function swapCall(
  buy: boolean,
  amountIn: bigint,
  minOut: bigint,
  fees: { to: Hex; amount: bigint }[],
  feeToken: Hex,
): Hex {
  const input = buy ? FAB_BEM : FAB;
  const output = buy ? FAB : FAB_BEM;
  const swapParam = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "amountIn", type: "uint128" },
          { name: "amountOutMinimum", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    [{ poolKey, zeroForOne: buy, amountIn, amountOutMinimum: minOut, hookData: "0x" }],
  );
  const settle = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [input, amountIn]);
  const take = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [output, minOut]);
  const payload = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x060c0f", [swapParam, settle, take]]);
  const inputs: Hex[] = [];
  let commands = "0x";
  for (const fee of fees) {
    if (fee.amount <= 0n) continue;
    commands += "02";
    inputs.push(feeInput(feeToken, fee.to, fee.amount));
  }
  commands += "10";
  inputs.push(payload);
  return encodeFunctionData({
    abi: routerAbi,
    functionName: "execute",
    args: [commands as Hex, inputs, BigInt(Math.floor(Date.now() / 1000) + 20 * 60)],
  });
}

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  const eth = await ensureProvider();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: "0x0", chainId: "0xc4" }],
  })) as Hex;
}

async function allow(from: string, token: Hex, need: bigint) {
  const owner = from as Hex;
  const current = await xClient.readContract({ address: token, abi: erc20, functionName: "allowance", args: [owner, PERMIT2] });
  if (current < need) {
    if (current > 0n) {
      const zero = await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [PERMIT2, 0n] }));
      await xClient.waitForTransactionReceipt({ hash: zero, timeout: 60_000 });
    }
    const hash = await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [PERMIT2, need] }));
    await xClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  }
  const row = await xClient.readContract({
    address: PERMIT2,
    abi: permitAbi,
    functionName: "allowance",
    args: [owner, token, ROUTER],
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (row[0] < need || row[1] <= now + 60n) {
    const data = encodeFunctionData({
      abi: permitAbi,
      functionName: "approve",
      args: [token, ROUTER, (1n << 160n) - 1n, Number(now + 30n * 24n * 60n * 60n)],
    });
    const hash = await send(from, PERMIT2, data);
    await xClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  }
}

/** Buy spends BEM and receives FAB. Sell does the reverse. The pool is the deepest FAB pool: Uniswap v4 BEM/FAB 0.9%. */
export async function quoteFab(side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) throw new Error("amount");
  const out = await v4Out(side === "buy", amountIn);
  if (out <= 0n) throw new Error("tiny");
  return out;
}

export async function fabBemPrice(): Promise<string> {
  return pretty(await quoteFab("sell", 10n ** 8n), 8, 6);
}

export async function fabUsd(): Promise<number> {
  const bem = await quoteFab("sell", 10n ** 8n);
  const okb = await quoteBemOkb("sell", bem);
  const usdt = await quoteOkb("sell", okb);
  const n = Number(formatUnits(usdt, 6));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function readFab(account: string): Promise<bigint> {
  return xClient.readContract({ address: FAB, abi: erc20, functionName: "balanceOf", args: [account as Hex] });
}

export async function swapFab(from: string, side: "buy" | "sell", amount: string, floor?: bigint): Promise<Hex> {
  await connectXLayer();
  const raw = units(amount, 8);
  if (raw <= 0n) throw new Error("amount");
  const parts = await deskParts("xlayer", from, raw);
  const swapIn = parts.swapIn;
  if (swapIn <= 0n) throw new Error("amount");
  const token = side === "buy" ? FAB_BEM : FAB;
  const have = await xClient.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [from as Hex] });
  if (have < raw) throw new Error("balance");
  const quoted = await quoteFab(side, swapIn);
  const min = (quoted * BigInt(10_000 - SLIP)) / 10_000n;
  if (floor != null && min < floor) throw new Error("quote-moved");
  if (min <= 0n) throw new Error("tiny");
  await allow(from, token, raw);
  const fees: { to: Hex; amount: bigint }[] = [];
  if (parts.reward > 0n && parts.referrer) fees.push({ to: parts.referrer, amount: parts.reward });
  if (parts.desk > 0n) fees.push({ to: XLAYER_SAFE, amount: parts.desk });
  sayTradeStep("both");
  const hash = await send(from, ROUTER, swapCall(side === "buy", swapIn, floor ?? min, fees, token));
  await xClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return hash;
}
