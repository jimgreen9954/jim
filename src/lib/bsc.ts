import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  http,
  parseAbi,
  parseAbiItem,
  parseUnits,
  type Hex,
} from "viem";

export const BSC = {
  chainId: 56,
  hex: "0x38",
  name: "BNB Smart Chain",
  rpc: "https://bsc-dataseed.binance.org",
  explorer: "https://bscscan.com",
  bem: "0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a" as const,
  usdt: "0x55d398326f99059fF775485246999027B3197955" as const,
  router: "0x1b81D678ffb9C0263b24A97847620C99d213eB14" as const,
  quoter: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as const,
  pool: "0x3098D7A051045000d68eC0360753A40C8cABEa31" as const,
  fee: 10000,
  wbnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const,
  bnbPool: "0x172fcD41E0913e95784454622d1c3724f546f849" as const,
  bnbFee: 100,
  bemDecimals: 8,
  usdtDecimals: 18,
  slippageBps: 100,
};

export const FEE_TO = "0x823b9F6A93Ac44Ce5A469823A336c15b6117054D" as const;
export const DESK_FEE_BPS = 20;
export const BNB_GAS_RESERVE = 3_000_000_000_000_000n;

export function splitDeskFee(amountIn: bigint): { fee: bigint; swapIn: bigint } {
  const fee = (amountIn * BigInt(DESK_FEE_BPS)) / 10_000n;
  return { fee, swapIn: amountIn - fee };
}

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

const wbnbAbi = parseAbi(["function deposit() payable"]);

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint128 protocolFeesToken0, uint128 protocolFeesToken1)",
);

import { ensureProvider, getProvider, rememberAccount } from "@/lib/wallet";

export function hasWallet(): boolean {
  return Boolean(getProvider());
}

function ethereum() {
  return getProvider();
}

const client = createPublicClient({ transport: http(BSC.rpc) });

const receiptRpcs = [
  BSC.rpc,
  "https://bsc-dataseed1.defibit.io",
  "https://bsc-dataseed1.ninicoin.io",
  "https://rpc.48.club",
];

export async function waitReceipt(hash: Hex) {
  let last: unknown;
  for (const url of receiptRpcs) {
    try {
      const reader = createPublicClient({ transport: http(url, { timeout: 12_000 }) });
      return await reader.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 2_000 });
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("receipt");
}

export function units(amount: string, decimals: number): bigint {
  const trimmed = amount.trim().replace(/\.$/, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("amount");
  return parseUnits(trimmed, decimals);
}

export function pretty(amount: bigint, decimals: number, digits = 4): string {
  const raw = formatUnits(amount, decimals);
  const [whole, frac = ""] = raw.split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  return cut ? `${Number(whole).toLocaleString("en-US")}.${cut}` : Number(whole).toLocaleString("en-US");
}

export async function bemPrice(): Promise<string> {
  const out = await quoteExact(BSC.bem, BSC.usdt, 10n ** BigInt(BSC.bemDecimals));
  return pretty(out, BSC.usdtDecimals, 4);
}

export async function bnbPrice(): Promise<string> {
  const out = await quoteExact(BSC.wbnb, BSC.usdt, 10n ** 18n, BSC.bnbFee);
  return pretty(out, BSC.usdtDecimals, 2);
}

export async function quoteExact(tokenIn: Hex, tokenOut: Hex, amountIn: bigint, fee = BSC.fee): Promise<bigint> {
  const result = await client.readContract({
    address: BSC.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

export type Balances = { bnb: bigint; usdt: bigint; bem: bigint };

export async function readBalances(account: string): Promise<Balances> {
  const [bnb, usdt, bem] = await Promise.all([
    client.getBalance({ address: account as Hex }),
    client.readContract({ address: BSC.usdt, abi: erc20, functionName: "balanceOf", args: [account as Hex] }),
    client.readContract({ address: BSC.bem, abi: erc20, functionName: "balanceOf", args: [account as Hex] }),
  ]);
  return { bnb, usdt, bem };
}

export type PoolPrint = {
  id: string;
  side: "buy" | "sell";
  bem: string;
  usdt: string;
  tx: Hex;
  who: string;
};

export async function recentPrints(market: "bem" | "bnb" = "bem"): Promise<PoolPrint[]> {
  const pool = market === "bnb" ? BSC.bnbPool : BSC.pool;
  const assetDecimals = market === "bnb" ? 18 : BSC.bemDecimals;
  const spans = market === "bnb" ? [30n, 10n, 3n] : [400n, 120n, 40n];
  const head = await client.getBlockNumber();
  let logs: Awaited<ReturnType<typeof client.getLogs<typeof swapEvent>>> = [];
  for (const span of spans) {
    const from = head > span ? head - span : 0n;
    try {
      logs = await client.getLogs({ address: pool, event: swapEvent, fromBlock: from, toBlock: head });
      break;
    } catch {
      logs = [];
    }
  }
  return logs
    .slice(-12)
    .reverse()
    .map((log) => {
      const a0 = log.args.amount0 ?? 0n;
      const a1 = log.args.amount1 ?? 0n;
      return {
        id: `${log.transactionHash}-${log.logIndex}`,
        side: a1 < 0n ? "buy" : "sell",
        bem: pretty(a1 < 0n ? -a1 : a1, assetDecimals, market === "bnb" ? 5 : 4),
        usdt: pretty(a0 < 0n ? -a0 : a0, BSC.usdtDecimals, 2),
        tx: log.transactionHash,
        who: log.args.recipient ?? log.args.sender ?? "",
      };
    });
}

async function ensureBsc(): Promise<void> {
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC.hex }] });
  } catch (err) {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (code === 4902 || message.includes("Unrecognized")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BSC.hex,
            chainName: BSC.name,
            rpcUrls: [BSC.rpc],
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            blockExplorerUrls: [BSC.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

export async function connectBsc(): Promise<string> {
  const eth = await ensureProvider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  rememberAccount(next);
  await ensureBsc();
  return next;
}

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  await ensureBsc();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

async function approveIfNeeded(from: string, token: Hex, need: bigint): Promise<void> {
  const allowance = await client.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, BSC.router],
  });
  if (allowance >= need) return;
  if (allowance > 0n) {
    const reset = encodeFunctionData({ abi: erc20, functionName: "approve", args: [BSC.router, 0n] });
    await waitReceipt(await send(from, token, reset));
  }
  const approveData = encodeFunctionData({ abi: erc20, functionName: "approve", args: [BSC.router, need] });
  await waitReceipt(await send(from, token, approveData));
}

async function finishSwap(from: string, data: Hex, paid: boolean): Promise<Hex> {
  try {
    const hash = await send(from, BSC.router, data);
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "success") throw new Error("reverted");
    return hash;
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "reverted") throw new Error(paid ? "fee-kept" : "reverted");
    if (/slippage|Too little|STF/i.test(message)) throw new Error(paid ? "fee-kept-slip" : "slip");
    if (paid) throw new Error("fee-kept");
    throw err;
  }
}

export async function swapBem(from: string, side: "buy" | "sell", amount: string): Promise<Hex> {
  const tokenIn = side === "buy" ? BSC.usdt : BSC.bem;
  const tokenOut = side === "buy" ? BSC.bem : BSC.usdt;
  const decimalsIn = side === "buy" ? BSC.usdtDecimals : BSC.bemDecimals;
  const amountIn = units(amount, decimalsIn);
  if (amountIn <= 0n) throw new Error("amount");
  const { fee, swapIn } = splitDeskFee(amountIn);
  if (swapIn <= 0n) throw new Error("amount");
  const quoted = await quoteExact(tokenIn, tokenOut, swapIn);
  const minOut = (quoted * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
  const owner = from as Hex;
  await approveIfNeeded(from, tokenIn, swapIn);
  let paid = false;
  if (fee > 0n) {
    const feeData = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, fee] });
    const feeHash = await send(from, tokenIn, feeData);
    await waitReceipt(feeHash);
    paid = true;
  }
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        fee: BSC.fee,
        recipient: owner,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 20),
        amountIn: swapIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return finishSwap(from, data, paid);
}

export async function swapBnb(from: string, side: "buy" | "sell", amount: string): Promise<Hex> {
  const owner = from as Hex;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  if (side === "buy") {
    const amountIn = units(amount, BSC.usdtDecimals);
    if (amountIn <= 0n) throw new Error("amount");
    const { fee, swapIn } = splitDeskFee(amountIn);
    if (swapIn <= 0n) throw new Error("amount");
    const quoted = await quoteExact(BSC.usdt, BSC.wbnb, swapIn, BSC.bnbFee);
    const minOut = (quoted * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
    await approveIfNeeded(from, BSC.usdt, swapIn);
    let paid = false;
    if (fee > 0n) {
      const feeData = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, fee] });
      await waitReceipt(await send(from, BSC.usdt, feeData));
      paid = true;
    }
    const swapData = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: BSC.usdt,
          tokenOut: BSC.wbnb,
          fee: BSC.bnbFee,
          recipient: BSC.router,
          deadline,
          amountIn: swapIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const unwrapData = encodeFunctionData({
      abi: routerAbi,
      functionName: "unwrapWETH9",
      args: [minOut, owner],
    });
    const data = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[swapData, unwrapData]] });
    return finishSwap(from, data, paid);
  }
  const bal = await client.getBalance({ address: owner });
  const maxSpend = bal > BNB_GAS_RESERVE ? bal - BNB_GAS_RESERVE : 0n;
  let amountIn = units(amount, 18);
  if (amountIn > maxSpend) amountIn = maxSpend;
  if (amountIn <= 0n) throw new Error("amount");
  const { fee, swapIn } = splitDeskFee(amountIn);
  if (swapIn <= 0n) throw new Error("amount");
  const quoted = await quoteExact(BSC.wbnb, BSC.usdt, swapIn, BSC.bnbFee);
  const minOut = (quoted * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
  let paid = false;
  if (fee > 0n) {
    await waitReceipt(await send(from, FEE_TO, "0x", fee));
    paid = true;
  }
  try {
    const deposit = encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" });
    await waitReceipt(await send(from, BSC.wbnb, deposit, swapIn));
    await approveIfNeeded(from, BSC.wbnb, swapIn);
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: BSC.wbnb,
          tokenOut: BSC.usdt,
          fee: BSC.bnbFee,
          recipient: owner,
          deadline,
          amountIn: swapIn,
          amountOutMinimum: minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    return await finishSwap(from, data, paid);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (paid && message !== "fee-kept" && message !== "fee-kept-slip") throw new Error("fee-kept");
    throw err;
  }
}

export function txUrl(hash: string): string {
  return `${BSC.explorer}/tx/${hash}`;
}
