import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  pad,
  parseAbi,
  type Hex,
} from "viem";
import { BSC, connectBsc, pretty, quoteExact, swapBem, txUrl as bscTx, units } from "@/lib/bsc";
import { connectXLayer, txUrl as xTx } from "@/lib/xlayer";
import { previewTapeSwap, swapTapePool, TAPE_POOL, TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { ensureProvider } from "@/lib/wallet";

export type SwapPair = "bsc-bem" | "xl-bem" | "xl-tape";
export type SwapSide = "buy" | "sell";
export type BridgeDir = "to-xlayer" | "to-bsc";

const XL = {
  rpc: "https://rpc.xlayer.tech",
  bem: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as Hex,
  wokb: "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as Hex,
  pool: "0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A" as Hex,
  router: "0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca" as Hex,
  fee: 10000,
  slipBps: 500,
};

const BRIDGE = {
  bsc: "0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72" as Hex,
  xlayer: XL.bem,
  toX: 30274,
  toBsc: 30102,
};

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const slotAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
]);

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])",
]);

const oftAbi = parseAbi([
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, bool _payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee))",
  "function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable",
]);

const xl = createPublicClient({ transport: http(XL.rpc, { timeout: 12_000 }) });
const bsc = createPublicClient({ transport: http(BSC.rpc, { timeout: 12_000 }) });

const Q96 = 1n << 96n;

function trim(raw: string, digits = 6): string {
  const [whole, frac = ""] = raw.split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

function show(amount: bigint, decimals: number): string {
  return trim(formatUnits(amount, decimals));
}

function amountOf(raw: string, decimals: number): bigint {
  const amount = units(raw, decimals);
  if (amount <= 0n) throw new Error("amount");
  return amount;
}

async function midOut(zeroForOne: boolean, amountIn: bigint): Promise<bigint> {
  const row = await xl.readContract({ address: XL.pool, abi: slotAbi, functionName: "slot0" });
  const sqrt = row[0];
  if (sqrt <= 0n) throw new Error("price");
  if (zeroForOne) {
    const step = (amountIn * sqrt) / Q96;
    return (step * sqrt) / Q96;
  }
  const step = (amountIn * Q96) / sqrt;
  return (step * Q96) / sqrt;
}

const poolAbi = parseAbi(["function live() view returns (bool)", "function usdtPool() view returns (uint256 tape, uint256 quote, uint256 shares)"]);

export type SwapQuote = { amount: string; unit: string; venue: "bsc" | "xlayer"; live: boolean; note: string };

export async function quoteSwap(pair: SwapPair, side: SwapSide, raw: string): Promise<SwapQuote> {
  if (pair === "bsc-bem") {
    const tokenIn = side === "buy" ? BSC.usdt : BSC.bem;
    const tokenOut = side === "buy" ? BSC.bem : BSC.usdt;
    const decimalsIn = side === "buy" ? BSC.usdtDecimals : BSC.bemDecimals;
    const decimalsOut = side === "buy" ? BSC.bemDecimals : BSC.usdtDecimals;
    const out = await quoteExact(tokenIn, tokenOut, amountOf(raw, decimalsIn));
    const unit = side === "buy" ? "BEM" : "USDT";
    return { amount: pretty(out, decimalsOut, 4), unit, venue: "bsc", live: true, note: "" };
  }
  if (pair === "xl-tape") {
    const buy = side === "buy";
    const amountIn = amountOf(raw, buy ? 6 : 8);
    const [preview, live, pool] = await Promise.all([
      previewTapeSwap(0, !buy, amountIn),
      xl.readContract({ address: TAPE_POOL, abi: poolAbi, functionName: "live" }),
      xl.readContract({ address: TAPE_POOL, abi: poolAbi, functionName: "usdtPool" }),
    ]);
    if (preview.out <= 0n) throw new Error("tiny");
    return {
      amount: show(preview.out, buy ? 8 : 6),
      unit: buy ? "TAPE" : "USDT",
      venue: "xlayer",
      live,
      note: `官方池大约 ${show(pool[1], 6)} USDT 对 ${show(pool[0], 8)} TAPE。未到 5,000 USDT 不会放行。流动性很小。`,
    };
  }
  const decimalsIn = side === "buy" ? 18 : 8;
  const out = await midOut(side === "sell", amountOf(raw, decimalsIn));
  if (out <= 0n) throw new Error("tiny");
  const unit = side === "buy" ? "BEM" : "OKB";
  const decimalsOut = side === "buy" ? 8 : 18;
  return { amount: show(out, decimalsOut), unit, venue: "xlayer", live: true, note: "" };
}

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

export async function runSwap(pair: SwapPair, side: SwapSide, raw: string): Promise<{ hash: string; url: string }> {
  if (pair === "bsc-bem") {
    const from = await connectBsc();
    const hash = await swapBem(from, side, raw.trim());
    return { hash, url: bscTx(hash) };
  }
  if (pair === "xl-tape") return runTapeSwap(side, raw);
  const from = await connectXLayer();
  const buy = side === "buy";
  const amountIn = amountOf(raw, buy ? 18 : 8);
  const out = await midOut(!buy, amountIn);
  const minOut = (out * BigInt(10_000 - XL.slipBps)) / 10_000n;
  if (minOut <= 0n) throw new Error("tiny");
  const owner = from as Hex;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  if (!buy) {
    const allowance = await xl.readContract({
      address: XL.bem,
      abi: erc20,
      functionName: "allowance",
      args: [owner, XL.router],
    });
    if (allowance < amountIn) {
      const approveData = encodeFunctionData({ abi: erc20, functionName: "approve", args: [XL.router, amountIn] });
      const approveHash = await send(from, XL.bem, approveData);
      await xl.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 });
    }
  }
  const swapData = encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: buy ? XL.wokb : XL.bem,
        tokenOut: buy ? XL.bem : XL.wokb,
        fee: XL.fee,
        recipient: buy ? owner : XL.router,
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  const data = buy
    ? swapData
    : encodeFunctionData({
        abi: routerAbi,
        functionName: "multicall",
        args: [deadline, [swapData, encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [minOut, owner] })]],
      });
  const hash = await send(from, XL.router, data, buy ? amountIn : 0n);
  return { hash, url: xTx(hash) };
}

export async function runTapeSwap(side: SwapSide, raw: string): Promise<{ hash: string; url: string }> {
  const from = await connectXLayer();
  const buy = side === "buy";
  const amountIn = amountOf(raw, buy ? 6 : 8);
  const live = await xl.readContract({ address: TAPE_POOL, abi: poolAbi, functionName: "live" });
  if (!live) throw new Error("closed");
  const hash = await swapTapePool(from, 0, !buy, amountIn);
  return { hash, url: xTx(hash) };
}

type SendParam = {
  dstEid: number;
  to: Hex;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: Hex;
  composeMsg: Hex;
  oftCmd: Hex;
};

function bridgePlan(dir: BridgeDir, from: string, raw: string): { client: typeof bsc; oft: Hex; param: SendParam } {
  const amountLD = amountOf(raw, 8);
  const param: SendParam = {
    dstEid: dir === "to-xlayer" ? BRIDGE.toX : BRIDGE.toBsc,
    to: pad(from as Hex, { size: 32 }),
    amountLD,
    minAmountLD: (amountLD * 99n) / 100n,
    extraOptions: "0x",
    composeMsg: "0x",
    oftCmd: "0x",
  };
  if (param.minAmountLD <= 0n) throw new Error("tiny");
  return dir === "to-xlayer"
    ? { client: bsc, oft: BRIDGE.bsc, param }
    : { client: xl, oft: BRIDGE.xlayer, param };
}

async function nativeFee(dir: BridgeDir, from: string, raw: string): Promise<bigint> {
  const plan = bridgePlan(dir, from, raw);
  const quoted = await plan.client.readContract({
    address: plan.oft,
    abi: oftAbi,
    functionName: "quoteSend",
    args: [plan.param, false],
  });
  return Array.isArray(quoted) ? quoted[0] : quoted.nativeFee;
}

export async function quoteBridge(dir: BridgeDir, raw: string): Promise<string> {
  const fee = await nativeFee(dir, "0x0000000000000000000000000000000000000001", raw);
  const unit = dir === "to-xlayer" ? "BNB" : "OKB";
  return `官方桥 1:1，至少到账 99%。另付跨链费约 ${show(fee, 18)} ${unit}，外加 gas。`;
}

export async function runBridge(dir: BridgeDir, raw: string): Promise<{ hash: string; url: string }> {
  const from = dir === "to-xlayer" ? await connectBsc() : await connectXLayer();
  const plan = bridgePlan(dir, from, raw);
  const fee = await nativeFee(dir, from, raw);
  if (dir === "to-xlayer") {
    const owner = from as Hex;
    const allowance = await bsc.readContract({
      address: BSC.bem,
      abi: erc20,
      functionName: "allowance",
      args: [owner, BRIDGE.bsc],
    });
    if (allowance < plan.param.amountLD) {
      const approveData = encodeFunctionData({ abi: erc20, functionName: "approve", args: [BRIDGE.bsc, plan.param.amountLD] });
      const approveHash = await send(from, BSC.bem, approveData);
      await bsc.waitForTransactionReceipt({ hash: approveHash, timeout: 90_000 });
    }
  }
  const data = encodeFunctionData({
    abi: oftAbi,
    functionName: "send",
    args: [plan.param, { nativeFee: fee, lzTokenFee: 0n }, from as Hex],
  });
  const hash = await send(from, plan.oft, data, fee);
  return { hash, url: dir === "to-xlayer" ? bscTx(hash) : xTx(hash) };
}

export type CoinBals = {
  usdtBsc: string;
  usdtXl: string;
  okb: string;
  bemBsc: string;
  bemXl: string;
  tape: string;
};

const emptyBals = (): CoinBals => ({ usdtBsc: "0", usdtXl: "0", okb: "0", bemBsc: "0", bemXl: "0", tape: "0" });

export async function readSwapBalances(account: string): Promise<CoinBals> {
  const who = account as Hex;
  const [usdtBsc, bemBsc, okb, usdtXl, bemXl, tape] = await Promise.all([
    bsc.readContract({ address: BSC.usdt, abi: erc20, functionName: "balanceOf", args: [who] }),
    bsc.readContract({ address: BSC.bem, abi: erc20, functionName: "balanceOf", args: [who] }),
    xl.getBalance({ address: who }),
    xl.readContract({ address: TAPE_USDT, abi: erc20, functionName: "balanceOf", args: [who] }),
    xl.readContract({ address: XL.bem, abi: erc20, functionName: "balanceOf", args: [who] }),
    xl.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] }),
  ]);
  return {
    usdtBsc: show(usdtBsc, 18),
    usdtXl: show(usdtXl, 6),
    okb: show(okb, 18),
    bemBsc: show(bemBsc, BSC.bemDecimals),
    bemXl: show(bemXl, 8),
    tape: show(tape, 8),
  };
}

export { emptyBals };

export function deskError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : 0;
  if (code === 4001 || /user rejected|denied|cancel/i.test(text)) return "你在钱包里取消了，没有成交。";
  if (text === "amount" || /invalid|parse/i.test(text)) return "数量要写成大于 0 的数字。";
  if (text === "tiny") return "数量太小，报价是 0，没有发出去。";
  if (text === "closed") return "TAPE 官方池还没开。要到 5,000 USDT 才放行，现在流动性很小，没有发出去。";
  if (text === "nowallet") return "没有连上钱包。";
  if (/insufficient funds/i.test(text)) return "余额或 gas 不够。";
  return text ? `没发出去：${text.slice(0, 160)}` : "没发出去。";
}
