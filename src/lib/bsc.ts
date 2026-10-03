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
  bemDecimals: 8,
  usdtDecimals: 18,
  slippageBps: 100,
};

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const routerAbi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

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

export async function quoteExact(tokenIn: Hex, tokenOut: Hex, amountIn: bigint): Promise<bigint> {
  const result = await client.readContract({
    address: BSC.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: BSC.fee, sqrtPriceLimitX96: 0n }],
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
};

export async function recentPrints(): Promise<PoolPrint[]> {
  const head = await client.getBlockNumber();
  let logs: Awaited<ReturnType<typeof client.getLogs<typeof swapEvent>>> = [];
  for (const span of [400n, 120n, 40n]) {
    const from = head > span ? head - span : 0n;
    try {
      logs = await client.getLogs({ address: BSC.pool, event: swapEvent, fromBlock: from, toBlock: head });
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
        bem: pretty(a1 < 0n ? -a1 : a1, BSC.bemDecimals, 4),
        usdt: pretty(a0 < 0n ? -a0 : a0, BSC.usdtDecimals, 2),
        tx: log.transactionHash,
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

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  const eth = await ensureProvider();
  await ensureBsc();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: "0x0" }],
  })) as Hex;
}

export async function swapBem(from: string, side: "buy" | "sell", amount: string): Promise<Hex> {
  const tokenIn = side === "buy" ? BSC.usdt : BSC.bem;
  const tokenOut = side === "buy" ? BSC.bem : BSC.usdt;
  const decimalsIn = side === "buy" ? BSC.usdtDecimals : BSC.bemDecimals;
  const amountIn = units(amount, decimalsIn);
  if (amountIn <= 0n) throw new Error("amount");
  const quoted = await quoteExact(tokenIn, tokenOut, amountIn);
  const minOut = (quoted * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
  const owner = from as Hex;
  const allowance = await client.readContract({
    address: tokenIn,
    abi: erc20,
    functionName: "allowance",
    args: [owner, BSC.router],
  });
  if (allowance < amountIn) {
    if (allowance > 0n) {
      const reset = encodeFunctionData({ abi: erc20, functionName: "approve", args: [BSC.router, 0n] });
      const resetHash = await send(from, tokenIn, reset);
      await waitReceipt(resetHash);
    }
    const approveData = encodeFunctionData({ abi: erc20, functionName: "approve", args: [BSC.router, amountIn] });
    const approveHash = await send(from, tokenIn, approveData);
    await waitReceipt(approveHash);
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
        amountIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return send(from, BSC.router, data);
}

export function txUrl(hash: string): string {
  return `${BSC.explorer}/tx/${hash}`;
}
