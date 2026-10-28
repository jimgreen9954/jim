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
import { deskParts, type DeskParts } from "@/lib/invite-cut";

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
  btcb: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" as const,
  btcPool: "0x247f51881d1E3aE0f759afB801413a6C948Ef442" as const,
  btcFee: 100,
  eth: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" as const,
  ethPool: "0xBe141893E4c6AD9272e8C04BAB7E6a10604501a5" as const,
  ethFee: 500,
  zec: "0x1Ba42e5193dfA8B03D15dd1B86a3113bbBEF8Eeb" as const,
  zecPool: "0x6701B287c8170D6c290C6f4Ef426782bD61Ae310" as const,
  zecFee: 500,
  xaut: "0x21cAef8A43163Eea865baeE23b9C2E327696A3bf" as const,
  xauPool: "0x83a0a8a723262651AE9C54bbba929f167443bc59" as const,
  xauFee: 500,
  xauDecimals: 6,
  bemDecimals: 8,
  usdtDecimals: 18,
  slippageBps: 100,
};

import { FEE_TO, BSC_SAFE, XLAYER_SAFE, TxPending } from "@/lib/chain-marks";

export { FEE_TO, BSC_SAFE, XLAYER_SAFE, TxPending };
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

import { STOCKS, type StockKey } from "@/lib/stocks";
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

export async function waitOk(hash: Hex) {
  let receipt: Awaited<ReturnType<typeof waitReceipt>>;
  try {
    receipt = await waitReceipt(hash);
  } catch {
    throw new TxPending(hash);
  }
  if (receipt.status !== "success") throw new Error("reverted");
}

function recall(key: string): Hex | null {
  try {
    const value = sessionStorage.getItem(key);
    return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as Hex) : null;
  } catch {
    return null;
  }
}

function remember(key: string, hash: Hex) {
  try {
    sessionStorage.setItem(key, hash);
  } catch {
    /* a private window can refuse storage; the hash is still returned to the page */
  }
}

function forget(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Finish a step that may already have been sent. A pending hash is never sent twice. */
async function step(key: string, sendHash: () => Promise<Hex>): Promise<void> {
  const prior = recall(key);
  if (prior) {
    try {
      await waitOk(prior);
      return;
    } catch (err) {
      if (err instanceof TxPending) throw err;
      forget(key);
    }
  }
  const hash = await sendHash();
  remember(key, hash);
  try {
    await waitOk(hash);
  } catch (err) {
    if (err instanceof Error && err.message === "reverted") forget(key);
    throw err;
  }
}

async function resumeSwap(key: string): Promise<Hex | null> {
  const prior = recall(key);
  if (!prior) return null;
  try {
    await waitOk(prior);
    forget(key);
    return prior;
  } catch (err) {
    if (err instanceof TxPending) throw err;
    forget(key);
    return null;
  }
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

export const ERC_BOOKS = {
  btc: { token: BSC.btcb, pool: BSC.btcPool, fee: BSC.btcFee, decimals: 18, assetIsToken0: false, digits: 2 },
  eth: { token: BSC.eth, pool: BSC.ethPool, fee: BSC.ethFee, decimals: 18, assetIsToken0: true, digits: 2 },
  zec: { token: BSC.zec, pool: BSC.zecPool, fee: BSC.zecFee, decimals: 18, assetIsToken0: true, digits: 2 },
  xau: { token: BSC.xaut, pool: BSC.xauPool, fee: BSC.xauFee, decimals: BSC.xauDecimals, assetIsToken0: true, digits: 4 },
  spy: { ...STOCKS.spy, decimals: 18, digits: 4 },
  qqq: { ...STOCKS.qqq, decimals: 18, digits: 4 },
  aapl: { ...STOCKS.aapl, decimals: 18, digits: 4 },
  nvda: { ...STOCKS.nvda, decimals: 18, digits: 4 },
  intc: { ...STOCKS.intc, decimals: 18, digits: 4 },
  msft: { ...STOCKS.msft, decimals: 18, digits: 4 },
  tsla: { ...STOCKS.tsla, decimals: 18, digits: 4 },
  spcx: { ...STOCKS.spcx, decimals: 18, digits: 4 },
  googl: { ...STOCKS.googl, decimals: 18, digits: 4 },
} as const;

export type ErcKey = keyof typeof ERC_BOOKS;

export function isErcKey(value: string): value is ErcKey {
  return value in ERC_BOOKS;
}

export async function ercPrice(key: ErcKey): Promise<string> {
  const book = ERC_BOOKS[key];
  const out = await quoteExact(book.token, BSC.usdt, 10n ** BigInt(book.decimals), book.fee);
  return pretty(out, BSC.usdtDecimals, 2);
}

export async function tokenCap(token: Hex): Promise<number> {
  const abi = parseAbi(["function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)"]);
  const [raw, decimals] = await Promise.all([
    client.readContract({ address: token, abi, functionName: "totalSupply" }),
    client.readContract({ address: token, abi, functionName: "decimals" }),
  ]);
  const n = Number(formatUnits(raw, decimals));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function readAsset(account: string, token: Hex): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account as Hex] });
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

export async function recentPrints(market: "bem" | "bnb" | ErcKey = "bem"): Promise<PoolPrint[]> {
  const listed = market === "bem" || market === "bnb" ? null : ERC_BOOKS[market];
  const pool = listed ? listed.pool : market === "bnb" ? BSC.bnbPool : BSC.pool;
  const assetDecimals = listed ? listed.decimals : market === "bnb" ? 18 : BSC.bemDecimals;
  const assetIsToken0 = listed ? listed.assetIsToken0 : false;
  const digits = listed ? listed.digits : market === "bnb" ? 5 : 4;
  const spans = market === "bnb" || market === "btc" ? [40n, 12n, 4n] : market === "bem" ? [400n, 120n, 40n] : [180n, 60n, 20n];
  const head = await client.getBlockNumber();
  let logs: Awaited<ReturnType<typeof client.getLogs<typeof swapEvent>>> = [];
  for (const span of spans) {
    const from = head > span ? head - span : 0n;
    try {
      logs = await client.getLogs({ address: pool, event: swapEvent, fromBlock: from, toBlock: head });
      if (logs.length > 0) break;
    } catch {
      logs = [];
    }
  }
  const rows = logs.slice(-8).reverse();
  const signers = await Promise.all(
    rows.map(async (log) => {
      try {
        const tx = await client.getTransaction({ hash: log.transactionHash });
        return tx.from ?? "";
      } catch {
        const fallback = log.args.recipient ?? "";
        return fallback.toLowerCase() === BSC.router.toLowerCase() ? "" : fallback;
      }
    }),
  );
  return rows.map((log, index) => {
    const a0 = log.args.amount0 ?? 0n;
    const a1 = log.args.amount1 ?? 0n;
    const asset = assetIsToken0 ? a0 : a1;
    const quote = assetIsToken0 ? a1 : a0;
    const buy = asset < 0n;
    return {
      id: `${log.transactionHash}-${log.logIndex}`,
      side: buy ? "buy" : "sell",
      bem: pretty(buy ? -asset : asset, assetDecimals, digits),
      usdt: pretty(quote < 0n ? -quote : quote, BSC.usdtDecimals, 2),
      tx: log.transactionHash,
      who: signers[index] ?? "",
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
    await waitOk(await send(from, token, reset));
  }
  const approveData = encodeFunctionData({ abi: erc20, functionName: "approve", args: [BSC.router, need] });
  await waitOk(await send(from, token, approveData));
}

async function finishSwap(from: string, data: Hex, paid: boolean, swapKey: string, feeKey: string): Promise<Hex> {
  const resumed = await resumeSwap(swapKey);
  if (resumed) {
    forget(feeKey);
    return resumed;
  }
  let hash: Hex;
  try {
    hash = await send(from, BSC.router, data);
  } catch (err) {
    if (paid) throw new Error("fee-kept");
    throw err;
  }
  remember(swapKey, hash);
  try {
    await waitOk(hash);
    forget(swapKey);
    forget(feeKey);
    return hash;
  } catch (err) {
    if (err instanceof TxPending) {
      err.paid = paid;
      throw err;
    }
    const message = err instanceof Error ? err.message : "";
    if (message === "reverted") {
      forget(swapKey);
      throw new Error(paid ? "fee-kept" : "reverted");
    }
    if (/slippage|Too little|STF/i.test(message)) {
      forget(swapKey);
      throw new Error(paid ? "fee-kept-slip" : "slip");
    }
    if (paid) throw new Error("fee-kept");
    throw err;
  }
}

function boundMin(quoted: bigint, floor?: bigint): bigint {
  const fresh = (quoted * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
  if (floor != null && fresh < floor) throw new Error("quote-moved");
  return floor ?? fresh;
}

async function payDeskToken(from: string, token: Hex, parts: DeskParts, feeKey: string): Promise<boolean> {
  if (parts.reward <= 0n && parts.desk <= 0n) return false;
  if (parts.reward > 0n && parts.referrer) {
    const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [parts.referrer, parts.reward] });
    await step(`${feeKey}:ref`, () => send(from, token, data));
  }
  if (parts.desk > 0n) {
    let routed = false;
    if (token.toLowerCase() === BSC.usdt.toLowerCase()) {
      try {
        const { routeDeskFee } = await import("@/lib/card-pool");
        routed = await routeDeskFee("bsc", from, parts.desk, 0);
      } catch (err) {
        if (err instanceof TxPending) throw err;
        routed = false;
      }
    }
    if (!routed) {
      const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [BSC_SAFE, parts.desk] });
      await step(feeKey, () => send(from, token, data));
    }
  }
  return true;
}

async function payDeskNative(from: string, parts: DeskParts, feeKey: string): Promise<boolean> {
  if (parts.reward <= 0n && parts.desk <= 0n) return false;
  if (parts.reward > 0n && parts.referrer) await step(`${feeKey}:ref`, () => send(from, parts.referrer as Hex, "0x", parts.reward));
  if (parts.desk > 0n) await step(feeKey, () => send(from, BSC_SAFE, "0x", parts.desk));
  return true;
}

export async function swapBem(from: string, side: "buy" | "sell", amount: string, floor?: bigint): Promise<Hex> {
  const tokenIn = side === "buy" ? BSC.usdt : BSC.bem;
  const tokenOut = side === "buy" ? BSC.bem : BSC.usdt;
  const decimalsIn = side === "buy" ? BSC.usdtDecimals : BSC.bemDecimals;
  const amountIn = units(amount, decimalsIn);
  if (amountIn <= 0n) throw new Error("amount");
  const parts = await deskParts("bsc", from, amountIn);
  const swapIn = parts.swapIn;
  if (swapIn <= 0n) throw new Error("amount");
  const who = from.toLowerCase();
  const swapKey = `tl-swap:${who}:${tokenIn}:${amountIn}`;
  const feeKey = `tl-fee:${who}:${tokenIn}:${amountIn}`;
  const already = await resumeSwap(swapKey);
  if (already) {
    forget(feeKey);
    return already;
  }
  const quoted = await quoteExact(tokenIn, tokenOut, swapIn);
  const minOut = boundMin(quoted, floor);
  const owner = from as Hex;
  await approveIfNeeded(from, tokenIn, swapIn);
  const paid = await payDeskToken(from, tokenIn, parts, feeKey);
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
  return finishSwap(from, data, paid, swapKey, feeKey);
}

export async function swapListed(from: string, key: ErcKey, side: "buy" | "sell", amount: string, floor?: bigint): Promise<Hex> {
  const book = ERC_BOOKS[key];
  const token = book.token;
  const decimals = book.decimals;
  const feeTier = book.fee;
  const tokenIn = side === "buy" ? BSC.usdt : token;
  const tokenOut = side === "buy" ? token : BSC.usdt;
  const decimalsIn = side === "buy" ? BSC.usdtDecimals : decimals;
  const amountIn = units(amount, decimalsIn);
  if (amountIn <= 0n) throw new Error("amount");
  const parts = await deskParts("bsc", from, amountIn);
  const swapIn = parts.swapIn;
  if (swapIn <= 0n) throw new Error("amount");
  const who = from.toLowerCase();
  const swapKey = `tl-swap:${who}:${tokenIn}:${amountIn}`;
  const feeKey = `tl-fee:${who}:${tokenIn}:${amountIn}`;
  const already = await resumeSwap(swapKey);
  if (already) {
    forget(feeKey);
    return already;
  }
  const quoted = await quoteExact(tokenIn, tokenOut, swapIn, feeTier);
  const minOut = boundMin(quoted, floor);
  const owner = from as Hex;
  await approveIfNeeded(from, tokenIn, swapIn);
  const paid = await payDeskToken(from, tokenIn, parts, feeKey);
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn,
        tokenOut,
        fee: feeTier,
        recipient: owner,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 20),
        amountIn: swapIn,
        amountOutMinimum: minOut,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return finishSwap(from, data, paid, swapKey, feeKey);
}

export async function swapBnb(from: string, side: "buy" | "sell", amount: string, floor?: bigint): Promise<Hex> {
  const owner = from as Hex;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  if (side === "buy") {
    const amountIn = units(amount, BSC.usdtDecimals);
    if (amountIn <= 0n) throw new Error("amount");
    const parts = await deskParts("bsc", from, amountIn);
    const swapIn = parts.swapIn;
    if (swapIn <= 0n) throw new Error("amount");
    const who = from.toLowerCase();
    const swapKey = `tl-swap:${who}:${BSC.usdt}:${amountIn}:bnb`;
    const feeKey = `tl-fee:${who}:${BSC.usdt}:${amountIn}:bnb`;
    const already = await resumeSwap(swapKey);
    if (already) {
      forget(feeKey);
      return already;
    }
    const quoted = await quoteExact(BSC.usdt, BSC.wbnb, swapIn, BSC.bnbFee);
    const minOut = boundMin(quoted, floor);
    await approveIfNeeded(from, BSC.usdt, swapIn);
    const paid = await payDeskToken(from, BSC.usdt, parts, feeKey);
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
    return finishSwap(from, data, paid, swapKey, feeKey);
  }
  const bal = await client.getBalance({ address: owner });
  const maxSpend = bal > BNB_GAS_RESERVE ? bal - BNB_GAS_RESERVE : 0n;
  let amountIn = units(amount, 18);
  if (amountIn > maxSpend) amountIn = maxSpend;
  if (amountIn <= 0n) throw new Error("amount");
  const parts = await deskParts("bsc", from, amountIn);
  const swapIn = parts.swapIn;
  if (swapIn <= 0n) throw new Error("amount");
  const who = from.toLowerCase();
  const swapKey = `tl-swap:${who}:bnb:${amountIn}`;
  const feeKey = `tl-fee:${who}:bnb:${amountIn}`;
  const already = await resumeSwap(swapKey);
  if (already) {
    forget(feeKey);
    return already;
  }
  const quoted = await quoteExact(BSC.wbnb, BSC.usdt, swapIn, BSC.bnbFee);
  const minOut = boundMin(quoted, floor);
  const paid = await payDeskNative(from, parts, feeKey);
  try {
    const deposit = encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" });
    const wrapKey = `tl-wrap:${who}:${swapIn}`;
    await step(wrapKey, () => send(from, BSC.wbnb, deposit, swapIn));
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
    const hash = await finishSwap(from, data, paid, swapKey, feeKey);
    forget(wrapKey);
    return hash;
  } catch (err) {
    if (err instanceof TxPending) throw err;
    const message = err instanceof Error ? err.message : "";
    if (message === "fee-kept" || message === "fee-kept-slip" || message === "quote-moved" || message === "pending") throw err;
    if (paid) throw new Error("fee-kept");
    throw err;
  }
}

const HOP_FEES = [100, 500, 2500, 10000] as const;

async function bestBnbFee(token: Hex, side: "buy" | "sell", amountIn: bigint, hint: number): Promise<{ out: bigint; fee: number } | null> {
  const tried = new Set<number>();
  for (const fee of [hint, ...HOP_FEES]) {
    if (tried.has(fee)) continue;
    tried.add(fee);
    try {
      const out = side === "buy"
        ? await quoteExact(BSC.wbnb, token, amountIn, fee)
        : await quoteExact(token, BSC.wbnb, amountIn, fee);
      if (out > 0n) return { out, fee };
    } catch {
      /* this fee has no pool */
    }
  }
  return null;
}

/** Buy or sell a BSC token paying or receiving BNB. Direct pool if there is one, otherwise through USDT. */
export async function quoteWithBnb(token: Hex, feeHint: number, side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n || token.toLowerCase() === BSC.wbnb.toLowerCase()) return 0n;
  const direct = await bestBnbFee(token, side, amountIn, feeHint);
  if (direct) return direct.out;
  if (side === "buy") {
    const usdt = await quoteExact(BSC.wbnb, BSC.usdt, amountIn, BSC.bnbFee);
    return quoteExact(BSC.usdt, token, usdt, feeHint);
  }
  const usdt = await quoteExact(token, BSC.usdt, amountIn, feeHint);
  return quoteExact(BSC.usdt, BSC.wbnb, usdt, BSC.bnbFee);
}

export async function swapWithBnb(from: string, token: Hex, decimals: number, feeHint: number, side: "buy" | "sell", amount: string, floor?: bigint): Promise<Hex> {
  const owner = from as Hex;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  if (side === "buy") {
    const amountIn = units(amount, 18);
    if (amountIn <= 0n) throw new Error("amount");
    const parts = await deskParts("bsc", from, amountIn);
    const swapIn = parts.swapIn;
    if (swapIn <= 0n) throw new Error("amount");
    const direct = await bestBnbFee(token, "buy", swapIn, feeHint);
    const quoted = direct?.out ?? await quoteWithBnb(token, feeHint, "buy", swapIn);
    const minOut = boundMin(quoted, floor);
    const who = from.toLowerCase();
    const swapKey = `tl-swap:${who}:bnb-in:${token}:${amountIn}`;
    const feeKey = `tl-fee:${who}:bnb-in:${token}:${amountIn}`;
    const already = await resumeSwap(swapKey);
    if (already) return already;
    const paid = await payDeskNative(from, parts, feeKey);
    try {
      const deposit = encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" });
      await step(`tl-wrap:${who}:${swapIn}`, () => send(from, BSC.wbnb, deposit, swapIn));
      await approveIfNeeded(from, BSC.wbnb, swapIn);
      if (direct) {
        const data = encodeFunctionData({
          abi: routerAbi,
          functionName: "exactInputSingle",
          args: [{ tokenIn: BSC.wbnb, tokenOut: token, fee: direct.fee, recipient: owner, deadline, amountIn: swapIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
        });
        return finishSwap(from, data, paid, swapKey, feeKey);
      }
      const usdtOut = await quoteExact(BSC.wbnb, BSC.usdt, swapIn, BSC.bnbFee);
      const leg = encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [{ tokenIn: BSC.wbnb, tokenOut: BSC.usdt, fee: BSC.bnbFee, recipient: owner, deadline, amountIn: swapIn, amountOutMinimum: (usdtOut * 99n) / 100n, sqrtPriceLimitX96: 0n }],
      });
      const first = await finishSwap(from, leg, paid, `${swapKey}:usdt`, feeKey);
      await client.waitForTransactionReceipt({ hash: first, timeout: 60_000 });
      const usdtBal = await client.readContract({ address: BSC.usdt, abi: erc20, functionName: "balanceOf", args: [owner] });
      const spend = usdtBal > usdtOut ? usdtOut : usdtBal;
      await approveIfNeeded(from, BSC.usdt, spend);
      const data = encodeFunctionData({
        abi: routerAbi,
        functionName: "exactInputSingle",
        args: [{ tokenIn: BSC.usdt, tokenOut: token, fee: feeHint, recipient: owner, deadline, amountIn: spend, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
      });
      return finishSwap(from, data, false, swapKey, feeKey);
    } catch (err) {
      if (paid && !(err instanceof TxPending)) throw new Error("fee-kept");
      throw err;
    }
  }
  const amountIn = units(amount, decimals);
  if (amountIn <= 0n) throw new Error("amount");
  const parts = await deskParts("bsc", from, amountIn);
  const swapIn = parts.swapIn;
  if (swapIn <= 0n) throw new Error("amount");
  const direct = await bestBnbFee(token, "sell", swapIn, feeHint);
  const quoted = direct?.out ?? await quoteWithBnb(token, feeHint, "sell", swapIn);
  const minOut = boundMin(quoted, floor);
  const who = from.toLowerCase();
  const swapKey = `tl-swap:${who}:bnb-out:${token}:${amountIn}`;
  const feeKey = `tl-fee:${who}:bnb-out:${token}:${amountIn}`;
  const already = await resumeSwap(swapKey);
  if (already) return already;
  await approveIfNeeded(from, token, swapIn);
  const paid = await payDeskToken(from, token, parts, feeKey);
  if (direct) {
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: token, tokenOut: BSC.wbnb, fee: direct.fee, recipient: BSC.router, deadline, amountIn: swapIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    });
    const unwrap = encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [minOut, owner] });
    const packed = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[data, unwrap]] });
    return finishSwap(from, packed, paid, swapKey, feeKey);
  }
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [{ tokenIn: token, tokenOut: BSC.usdt, fee: feeHint, recipient: owner, deadline, amountIn: swapIn, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }],
  });
  const first = await finishSwap(from, data, paid, `${swapKey}:usdt`, feeKey);
  await client.waitForTransactionReceipt({ hash: first, timeout: 60_000 });
  const usdtBal = await client.readContract({ address: BSC.usdt, abi: erc20, functionName: "balanceOf", args: [owner] });
  const spend = usdtBal > quoted ? quoted : usdtBal;
  await approveIfNeeded(from, BSC.usdt, spend);
  const bnbOut = await quoteExact(BSC.usdt, BSC.wbnb, spend, BSC.bnbFee);
  const leg = encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [{ tokenIn: BSC.usdt, tokenOut: BSC.wbnb, fee: BSC.bnbFee, recipient: BSC.router, deadline, amountIn: spend, amountOutMinimum: (bnbOut * 99n) / 100n, sqrtPriceLimitX96: 0n }],
  });
  const unwrap = encodeFunctionData({ abi: routerAbi, functionName: "unwrapWETH9", args: [(bnbOut * 99n) / 100n, owner] });
  const packed = encodeFunctionData({ abi: routerAbi, functionName: "multicall", args: [[leg, unwrap]] });
  return finishSwap(from, packed, false, swapKey, feeKey);
}

export function txUrl(hash: string): string {
  return `${BSC.explorer}/tx/${hash}`;
}
