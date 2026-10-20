import {
  encodeFunctionData,
  formatUnits,
  pad,
  parseAbi,
  type Hex,
} from "viem";
import { BSC, bscClient, connectBsc, pretty, quoteExact, quoteBemBnb, swapBem, swapBemBnb, txUrl as bscTx, units } from "@/lib/bsc";
import { connectXLayer, txUrl as xTx, xClient } from "@/lib/xlayer";
import { previewTapeSwap, swapTapePool, TAPE_POOL, TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { ensureProvider } from "@/lib/wallet";

export type SwapPair = "bsc-bem" | "xl-bem" | "xl-tape";
export type SwapSide = "buy" | "sell";
export type SwapQuoteToken = "USDT" | "OKB" | "BNB" | "BEM";
export type SwapQuote = { amount: string; unit: string; venue: "bsc" | "xlayer"; live: boolean; note: string };
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

const xl = xClient;
const bsc = bscClient;

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

const poolAbi = parseAbi(["function live() view returns (bool)", "function usdtPool() view returns (uint256 tape, uint256 quote, uint256 shares)", "function bemPool() view returns (uint256 tape, uint256 quote, uint256 shares)"]);

const NO_POOL: Record<string, string> = {
  "xl-bem:USDT": "X Layer 上没有 BEM 对 USDT 的池。点了也不会发交易。",
  "xl-tape:OKB": "没有 TAPE 对 OKB 的池。点了也不会发交易。",
};

export async function quoteSwap(pair: SwapPair, side: SwapSide, raw: string, quote: SwapQuoteToken = "USDT"): Promise<SwapQuote> {
  const missing = NO_POOL[`${pair}:${quote}`];
  if (missing) return { amount: "—", unit: quote === "USDT" ? "BEM" : "TAPE", venue: pair === "bsc-bem" ? "bsc" : "xlayer", live: false, note: missing };
  if (pair === "bsc-bem" && quote === "BNB") {
    const decimalsIn = side === "buy" ? 18 : BSC.bemDecimals;
    const quoted = await quoteBemBnb(side, amountOf(raw, decimalsIn));
    const decimalsOut = side === "buy" ? BSC.bemDecimals : 18;
    return { amount: pretty(quoted.out, decimalsOut, 4), unit: side === "buy" ? "BEM" : "BNB", venue: "bsc", live: true, note: "" };
  }
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
    const bem = quote === "BEM";
    const buy = side === "buy";
    const amountIn = amountOf(raw, bem || !buy ? 8 : 6);
    const [preview, live, pool] = await Promise.all([
      previewTapeSwap(bem ? 1 : 0, !buy, amountIn),
      xl.readContract({ address: TAPE_POOL, abi: poolAbi, functionName: "live" }),
      xl.readContract({ address: TAPE_POOL, abi: poolAbi, functionName: bem ? "bemPool" : "usdtPool" }),
    ]);
    if (preview.out <= 0n || !live) {
      const emptyBem = bem && pool[1] === 0n;
      return {
        amount: preview.out > 0n ? show(preview.out, buy ? 8 : bem ? 8 : 6) : "—",
        unit: buy ? "TAPE" : bem ? "BEM" : "USDT",
        venue: "xlayer",
        live: false,
        note: emptyBem
          ? "官方池的 BEM 一边还没有存货，池子也没开。点了也不会发交易。"
          : bem
            ? `官方池大约 ${show(pool[1], 8)} BEM 对 ${show(pool[0], 8)} TAPE。池子没开或没有存货，不会放行。`
            : `官方池大约 ${show(pool[1], 6)} USDT 对 ${show(pool[0], 8)} TAPE。未到 5,000 USDT 不会放行。流动性很小。`,
      };
    }
    const unit = buy ? "TAPE" : bem ? "BEM" : "USDT";
    return {
      amount: show(preview.out, buy ? 8 : bem ? 8 : 6),
      unit,
      venue: "xlayer",
      live,
      note: bem
        ? `官方池大约 ${show(pool[1], 8)} BEM 对 ${show(pool[0], 8)} TAPE。流动性很小。`
        : `官方池大约 ${show(pool[1], 6)} USDT 对 ${show(pool[0], 8)} TAPE。流动性很小。`,
    };
  }
  const decimalsIn = side === "buy" ? 18 : 8;
  const out = await midOut(side === "sell", amountOf(raw, decimalsIn));
  if (out <= 0n) throw new Error("tiny");
  const unit = side === "buy" ? "BEM" : "OKB";
  const decimalsOut = side === "buy" ? 8 : 18;
  return { amount: show(out, decimalsOut), unit, venue: "xlayer", live: true, note: "" };
}

async function send(from: string, to: Hex, data: Hex, value = 0n, chainId = "0xc4"): Promise<Hex> {
  const eth = await ensureProvider();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}`, chainId }],
  })) as Hex;
}

export async function runSwap(pair: SwapPair, side: SwapSide, raw: string, quote: SwapQuoteToken = "USDT"): Promise<{ hash: string; url: string }> {
  if (NO_POOL[`${pair}:${quote}`]) throw new Error("nopool");
  if (pair === "bsc-bem" && quote === "BNB") {
    const from = await connectBsc();
    const hash = await swapBemBnb(from, side, raw.trim());
    return { hash, url: bscTx(hash) };
  }
  if (pair === "bsc-bem") {
    const from = await connectBsc();
    const hash = await swapBem(from, side, raw.trim());
    return { hash, url: bscTx(hash) };
  }
  if (pair === "xl-tape") return runTapeSwap(side, raw, quote === "BEM" ? 1 : 0);
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

export async function runTapeSwap(side: SwapSide, raw: string, quote: 0 | 1 = 0): Promise<{ hash: string; url: string }> {
  const from = await connectXLayer();
  const buy = side === "buy";
  const amountIn = amountOf(raw, quote === 1 || !buy ? 8 : 6);
  const live = await xl.readContract({ address: TAPE_POOL, abi: poolAbi, functionName: "live" });
  if (!live) throw new Error("closed");
  const hash = await swapTapePool(from, quote, !buy, amountIn);
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

function bridgePlan(dir: BridgeDir, from: string, raw: string) {
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
      const approveHash = await send(from, BSC.bem, approveData, 0n, "0x38");
      await bsc.waitForTransactionReceipt({ hash: approveHash, timeout: 90_000 });
    }
  }
  const data = encodeFunctionData({
    abi: oftAbi,
    functionName: "send",
    args: [plan.param, { nativeFee: fee, lzTokenFee: 0n }, from as Hex],
  });
  const hash = await send(from, plan.oft, data, fee, dir === "to-xlayer" ? "0x38" : "0xc4");
  return { hash, url: dir === "to-xlayer" ? bscTx(hash) : xTx(hash) };
}

export type CoinBals = {
  usdtBsc: string;
  usdtXl: string;
  okb: string;
  bnb: string;
  bemBsc: string;
  bemXl: string;
  tape: string;
};

const emptyBals = (): CoinBals => ({ usdtBsc: "0", usdtXl: "0", okb: "0", bnb: "0", bemBsc: "0", bemXl: "0", tape: "0" });

export async function readSwapBalances(account: string): Promise<CoinBals> {
  const who = account as Hex;
  const read = async (task: Promise<bigint>) => {
    try {
      return await task;
    } catch {
      return null;
    }
  };
  const [usdtBsc, bemBsc, bnb, okb, usdtXl, bemXl, tape] = await Promise.all([
    read(bsc.readContract({ address: BSC.usdt, abi: erc20, functionName: "balanceOf", args: [who] })),
    read(bsc.readContract({ address: BSC.bem, abi: erc20, functionName: "balanceOf", args: [who] })),
    read(bsc.getBalance({ address: who })),
    read(xl.getBalance({ address: who })),
    read(xl.readContract({ address: TAPE_USDT, abi: erc20, functionName: "balanceOf", args: [who] })),
    read(xl.readContract({ address: XL.bem, abi: erc20, functionName: "balanceOf", args: [who] })),
    read(xl.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] })),
  ]);
  const text = (raw: bigint | null, decimals: number) => (raw == null ? "—" : show(raw, decimals));
  return {
    usdtBsc: text(usdtBsc, 18),
    usdtXl: text(usdtXl, 6),
    okb: text(okb, 18),
    bnb: text(bnb, 18),
    bemBsc: text(bemBsc, BSC.bemDecimals),
    bemXl: text(bemXl, 8),
    tape: text(tape, 8),
  };
}

export { emptyBals };

export function deskError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : 0;
  if (code === 4001 || /user rejected|denied|cancel/i.test(text)) return "你在钱包里取消了，没有成交。";
  if (text === "amount" || /invalid|parse/i.test(text)) return "数量要写成大于 0 的数字。";
  if (text === "tiny") return "数量太小，报价是 0，没有发出去。";
  if (text === "nopool") return "这条没有池子，没有发出去。";
  if (text === "closed") return "TAPE 官方池还没开。要到 5,000 USDT 才放行，现在流动性很小，没有发出去。";
  if (text === "xlayer") return "币安钱包没有停在 X Layer。打开钱包，手动选 X Layer，再铸造或成交。";
  if (text === "bsc") return "钱包没有停在 BSC。打开钱包，手动选 BNB Smart Chain。";
  if (text === "nowallet") return "没有连上钱包。";
  if (/insufficient funds/i.test(text)) return "余额或 gas 不够。";
  if (text === "wallet") return "这个钱包已经铸满十次。一次一张，不能再铸。";
  if (text === "sold") return "公开的三千张已经铸完。";
  if (text === "closed") return "铸造还没打开，或已经收盘。";
  if (/HTTP request failed|Failed to fetch|network|timeout|Load failed/i.test(text)) return "节点没连上，没有发出去。再点一次。";
  return text ? `没发出去：${text.slice(0, 160)}` : "没发出去。";
}
