import { createPublicClient, encodeFunctionData, encodePacked, formatUnits, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { FEE_TO, TxPending, type PoolPrint, units, pretty } from "@/lib/bsc";
import { deskParts } from "@/lib/invite-cut";
import { ensureProvider, rememberAccount } from "@/lib/wallet";
import { XLAYER } from "@/lib/xlayer";

export const OKB = {
  router: "0x881fB2f98c13d521009464e7D1CBf16E1b394e8E" as const,
  pool: "0xc71f9e1de80eb505c0cb3bbf90ae6593130e5d25" as const,
  wokb: "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const,
  usdt: "0x1E4a5963aBFD975d8c9021ce480b42188849D41d" as const,
  usdtDecimals: 6,
  gasReserve: 2_000_000_000_000_000n,
};

const xClient = createPublicClient({ transport: http(XLAYER.rpc, { batch: { batchSize: 20, wait: 16 }, timeout: 8_000 }) });

let okbOut: { at: number; out: bigint } | null = null;

export async function xCap(token: Hex): Promise<number> {
  const abi = parseAbi(["function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)"]);
  const [raw, decimals] = await Promise.all([
    xClient.readContract({ address: token, abi, functionName: "totalSupply" }),
    xClient.readContract({ address: token, abi, functionName: "decimals" }),
  ]);
  const n = Number(formatUnits(raw, decimals));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
  "function swapETHForExactTokens(uint256 amountOut, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const swapV2 = parseAbiItem(
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
);

async function ensureX(): Promise<void> {
  const eth = await ensureProvider();
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER.hex }] });
  } catch (err) {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (code === 4902 || message.includes("Unrecognized")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: XLAYER.hex,
            chainName: XLAYER.name,
            rpcUrls: [XLAYER.rpc],
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            blockExplorerUrls: [XLAYER.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  await ensureX();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

async function waitX(hash: Hex) {
  return xClient.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 2_000 });
}

async function waitOkX(hash: Hex) {
  try {
    const receipt = await waitX(hash);
    if (receipt.status !== "success") throw new Error("reverted");
  } catch (err) {
    if (err instanceof Error && err.message === "reverted") throw err;
    throw new TxPending(hash);
  }
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
    /* ignore */
  }
}

function forget(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function stepX(key: string, sendHash: () => Promise<Hex>) {
  const prior = recall(key);
  if (prior) {
    try {
      await waitOkX(prior);
      return;
    } catch (err) {
      if (err instanceof TxPending) throw err;
      forget(key);
    }
  }
  const hash = await sendHash();
  remember(key, hash);
  try {
    await waitOkX(hash);
  } catch (err) {
    if (err instanceof Error && err.message === "reverted") forget(key);
    throw err;
  }
}

async function resumeX(key: string): Promise<Hex | null> {
  const prior = recall(key);
  if (!prior) return null;
  try {
    await waitOkX(prior);
    forget(key);
    return prior;
  } catch (err) {
    if (err instanceof TxPending) throw err;
    forget(key);
    return null;
  }
}

async function approveUsdt(from: string, need: bigint) {
  const allowance = await xClient.readContract({
    address: OKB.usdt,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, OKB.router],
  });
  if (allowance >= need) return;
  if (allowance > 0n) await waitOkX(await send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OKB.router, 0n] })));
  await waitOkX(await send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OKB.router, need] })));
}

export async function quoteOkb(side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  const cached = side === "sell" && amountIn === 10n ** 18n ? okbOut : null;
  if (cached && Date.now() - cached.at < 20_000) return cached.out;
  const path = side === "buy" ? [OKB.usdt, OKB.wokb] : [OKB.wokb, OKB.usdt];
  const amounts = await xClient.readContract({
    address: OKB.router,
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [amountIn, path],
  });
  const out = amounts[amounts.length - 1] ?? 0n;
  if (side === "sell" && amountIn === 10n ** 18n && out > 0n) okbOut = { at: Date.now(), out };
  return out;
}

const BOOK_USDT = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;

export async function bookOkbRate(): Promise<bigint> {
  const amounts = await xClient.readContract({
    address: OKB.router,
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [10n ** 18n, [OKB.wokb, BOOK_USDT]],
  });
  return amounts[amounts.length - 1] ?? 0n;
}

export async function okbForBookUsdt(usdtOut: bigint): Promise<bigint> {
  if (usdtOut <= 0n) return 0n;
  const amounts = await xClient.readContract({
    address: OKB.router,
    abi: routerAbi,
    functionName: "getAmountsIn",
    args: [usdtOut, [OKB.wokb, BOOK_USDT]],
  });
  return amounts[0] ?? 0n;
}

export async function okbOutOfBookUsdt(usdtIn: bigint): Promise<bigint> {
  if (usdtIn <= 0n) return 0n;
  const amounts = await xClient.readContract({
    address: OKB.router,
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [usdtIn, [BOOK_USDT, OKB.wokb]],
  });
  return amounts[amounts.length - 1] ?? 0n;
}

export async function readNativeOkb(account: string): Promise<bigint> {
  return xClient.getBalance({ address: account as Hex });
}

async function approveBookUsdt(from: string, need: bigint) {
  const allowance = await xClient.readContract({
    address: BOOK_USDT,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, OKB.router],
  });
  if (allowance >= need) return;
  await waitOkX(await send(from, BOOK_USDT, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OKB.router, need] })));
}

export async function buyExactBookUsdt(from: string, usdtOut: bigint, okbMax: bigint) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapETHForExactTokens",
    args: [usdtOut, [OKB.wokb, BOOK_USDT], from as Hex, deadline],
  });
  await waitOkX(await send(from, OKB.router, data, okbMax));
}

export async function sellBookUsdtForOkb(from: string, usdtIn: bigint, minOkb: bigint) {
  await approveBookUsdt(from, usdtIn);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactTokensForETH",
    args: [usdtIn, minOkb, [BOOK_USDT, OKB.wokb], from as Hex, deadline],
  });
  await waitOkX(await send(from, OKB.router, data));
}

export async function okbPrice(): Promise<string> {
  const out = await quoteOkb("sell", 10n ** 18n);
  return pretty(out, OKB.usdtDecimals, 2);
}

export const X_BEM = {
  token: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as const,
  decimals: 8,
  router: "0x4f0C28f5926AFDA16bf2506D5D9e57Ea190f9bcA" as const,
  quoter: "0xD1b797D92d87B688193A2B976eFc8D577D204343" as const,
  pool: "0x2ccf8aa17f5df9fb5d51c9de12135a913ff29f7a" as const,
  usdt: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const,
} as const;

const xBemQuoterAbi = parseAbi([
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossed, uint256 gasEstimate)",
]);
const xBemRouterAbi = parseAbi([
  "function exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) payable returns (uint256 amountOut)",
]);
const swapV3 = parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)");

function xBemPath(side: "buy" | "sell"): Hex {
  return side === "buy"
    ? encodePacked(["address", "uint24", "address", "uint24", "address"], [X_BEM.usdt, 500, OKB.wokb, 10000, X_BEM.token])
    : encodePacked(["address", "uint24", "address", "uint24", "address"], [X_BEM.token, 10000, OKB.wokb, 500, X_BEM.usdt]);
}

export async function quoteXBem(side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const quoted = await xClient.simulateContract({
    address: X_BEM.quoter,
    abi: xBemQuoterAbi,
    functionName: "quoteExactInput",
    args: [xBemPath(side), amountIn],
  });
  return quoted.result[0] ?? 0n;
}

export async function xBemPrice(): Promise<string> {
  const out = await quoteXBem("sell", 10n ** BigInt(X_BEM.decimals));
  return pretty(out, 6, 2);
}

export async function readXBemPurse(account: string): Promise<{ bem: bigint; usdt: bigint }> {
  const [bem, usdt] = await Promise.all([
    xClient.readContract({ address: X_BEM.token, abi: erc20, functionName: "balanceOf", args: [account as Hex] }),
    xClient.readContract({ address: X_BEM.usdt, abi: erc20, functionName: "balanceOf", args: [account as Hex] }),
  ]);
  return { bem, usdt };
}

async function approveToken(from: string, token: Hex, spender: Hex, need: bigint) {
  const allowance = await xClient.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, spender],
  });
  if (allowance >= need) return;
  if (allowance > 0n) await waitOkX(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] })));
  await waitOkX(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, need] })));
}

export async function swapXBem(from: string, side: "buy" | "sell", amount: string, floor?: bigint): Promise<Hex> {
  const owner = from as Hex;
  const decimals = side === "buy" ? 6 : X_BEM.decimals;
  const amountIn = units(amount, decimals);
  if (amountIn <= 0n) throw new Error("amount");
  const parts = await deskParts("xlayer", from, amountIn);
  const swapIn = parts.swapIn;
  if (swapIn <= 0n) throw new Error("amount");
  const who = from.toLowerCase();
  const swapKey = `tl-swap:${who}:xbem-${side}:${amountIn}`;
  const feeKey = `tl-fee:${who}:xbem-${side}:${amountIn}`;
  const already = await resumeX(swapKey);
  if (already) {
    forget(feeKey);
    return already;
  }
  const quoted = await quoteXBem(side, swapIn);
  const fresh = (quoted * BigInt(10_000 - 100)) / 10_000n;
  if (floor != null && fresh < floor) throw new Error("quote-moved");
  const minOut = floor ?? fresh;
  const token = side === "buy" ? X_BEM.usdt : X_BEM.token;
  await approveToken(from, token, X_BEM.router, swapIn);
  let paid = false;
  const ref = parts.referrer;
  if (parts.reward > 0n && ref) {
    await stepX(`${feeKey}:ref`, () => send(from, token, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [ref, parts.reward] })));
    paid = true;
  }
  if (parts.desk > 0n) {
    await stepX(feeKey, () => send(from, token, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, parts.desk] })));
    paid = true;
  }
  const data = encodeFunctionData({
    abi: xBemRouterAbi,
    functionName: "exactInput",
    args: [{ path: xBemPath(side), recipient: owner, amountIn: swapIn, amountOutMinimum: minOut }],
  });
  let hash: Hex;
  try {
    hash = await send(from, X_BEM.router, data);
  } catch (err) {
    if (paid) throw new Error("fee-kept");
    throw err;
  }
  remember(swapKey, hash);
  try {
    await waitOkX(hash);
    forget(swapKey);
    forget(feeKey);
    return hash;
  } catch (err) {
    if (err instanceof TxPending) {
      err.paid = paid;
      throw err;
    }
    if (err instanceof Error && err.message === "reverted") {
      forget(swapKey);
      throw new Error(paid ? "fee-kept" : "reverted");
    }
    if (paid) throw new Error("fee-kept");
    throw err;
  }
}

export async function xBemPrints(): Promise<PoolPrint[]> {
  const head = await xClient.getBlockNumber();
  let logs: Awaited<ReturnType<typeof xClient.getLogs<typeof swapV3>>> = [];
  for (const span of [90n, 40n]) {
    try {
      logs = await xClient.getLogs({ address: X_BEM.pool, event: swapV3, fromBlock: head > span ? head - span : 0n, toBlock: head });
      break;
    } catch {
      logs = [];
    }
  }
  const rows = logs.slice(-8).reverse();
  let rate = 0n;
  try {
    rate = await bookOkbRate();
  } catch {
    rate = 0n;
  }
  const signers = await Promise.all(rows.map(async (log) => {
    try {
      const tx = await xClient.getTransaction({ hash: log.transactionHash });
      return tx.from ?? "";
    } catch {
      return "";
    }
  }));
  return rows.flatMap((log, index) => {
    const amount0 = log.args.amount0 ?? 0n;
    const amount1 = log.args.amount1 ?? 0n;
    const bem = amount0 < 0n ? -amount0 : amount0;
    const wokb = amount1 < 0n ? -amount1 : amount1;
    if (bem === 0n) return [];
    const usdt = rate > 0n ? (wokb * rate) / 10n ** 18n : 0n;
    return [{
      id: `${log.transactionHash}-${log.logIndex}`,
      side: amount0 < 0n ? "buy" as const : "sell" as const,
      bem: pretty(bem, X_BEM.decimals, 4),
      usdt: pretty(usdt, 6, 2),
      tx: log.transactionHash,
      who: signers[index] ?? "",
    }];
  });
}

export async function readOkbPurse(account: string): Promise<{ okb: bigint; usdt: bigint }> {
  const [okb, usdt] = await Promise.all([
    xClient.getBalance({ address: account as Hex }),
    xClient.readContract({ address: OKB.usdt, abi: erc20, functionName: "balanceOf", args: [account as Hex] }),
  ]);
  return { okb, usdt };
}

export async function connectX(): Promise<string> {
  const eth = await ensureProvider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  rememberAccount(next);
  await ensureX();
  return next;
}

export async function swapOkb(from: string, side: "buy" | "sell", amount: string, floor?: bigint): Promise<Hex> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  const owner = from as Hex;
  const slip = (quoted: bigint) => {
    const fresh = (quoted * BigInt(10_000 - 100)) / 10_000n;
    if (floor != null && fresh < floor) throw new Error("quote-moved");
    return floor ?? fresh;
  };
  if (side === "buy") {
    const amountIn = units(amount, OKB.usdtDecimals);
    if (amountIn <= 0n) throw new Error("amount");
    const parts = await deskParts("xlayer", from, amountIn);
    const swapIn = parts.swapIn;
    if (swapIn <= 0n) throw new Error("amount");
    const who = from.toLowerCase();
    const swapKey = `tl-swap:${who}:okb-buy:${amountIn}`;
    const feeKey = `tl-fee:${who}:okb-buy:${amountIn}`;
    const already = await resumeX(swapKey);
    if (already) {
      forget(feeKey);
      return already;
    }
    const minOut = slip(await quoteOkb("buy", swapIn));
    await approveUsdt(from, swapIn);
    let paid = false;
    const ref = parts.referrer;
    if (parts.reward > 0n && ref) {
      await stepX(`${feeKey}:ref`, () => send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [ref, parts.reward] })));
      paid = true;
    }
    if (parts.desk > 0n) {
      await stepX(feeKey, () => send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, parts.desk] })));
      paid = true;
    }
    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: "swapExactTokensForETH",
      args: [swapIn, minOut, [OKB.usdt, OKB.wokb], owner, deadline],
    });
    let hash: Hex;
    try {
      hash = await send(from, OKB.router, data);
    } catch (err) {
      if (paid) throw new Error("fee-kept");
      throw err;
    }
    remember(swapKey, hash);
    try {
      await waitOkX(hash);
      forget(swapKey);
      forget(feeKey);
      return hash;
    } catch (err) {
      if (err instanceof TxPending) {
        err.paid = paid;
        throw err;
      }
      if (err instanceof Error && err.message === "reverted") {
        forget(swapKey);
        throw new Error(paid ? "fee-kept" : "reverted");
      }
      if (paid) throw new Error("fee-kept");
      throw err;
    }
  }
  const bal = await xClient.getBalance({ address: owner });
  const maxSpend = bal > OKB.gasReserve ? bal - OKB.gasReserve : 0n;
  let amountIn = units(amount, 18);
  if (amountIn > maxSpend) amountIn = maxSpend;
  if (amountIn <= 0n) throw new Error("amount");
  const parts = await deskParts("xlayer", from, amountIn);
  const swapIn = parts.swapIn;
  if (swapIn <= 0n) throw new Error("amount");
  const who = from.toLowerCase();
  const swapKey = `tl-swap:${who}:okb-sell:${amountIn}`;
  const feeKey = `tl-fee:${who}:okb-sell:${amountIn}`;
  const already = await resumeX(swapKey);
  if (already) {
    forget(feeKey);
    return already;
  }
  const minOut = slip(await quoteOkb("sell", swapIn));
  let paid = false;
  const ref = parts.referrer;
  if (parts.reward > 0n && ref) {
    await stepX(`${feeKey}:ref`, () => send(from, ref, "0x", parts.reward));
    paid = true;
  }
  if (parts.desk > 0n) {
    await stepX(feeKey, () => send(from, FEE_TO, "0x", parts.desk));
    paid = true;
  }
  const data = encodeFunctionData({
    abi: routerAbi,
    functionName: "swapExactETHForTokens",
    args: [minOut, [OKB.wokb, OKB.usdt], owner, deadline],
  });
  let hash: Hex;
  try {
    hash = await send(from, OKB.router, data, swapIn);
  } catch (err) {
    if (paid) throw new Error("fee-kept");
    throw err;
  }
  remember(swapKey, hash);
  try {
    await waitOkX(hash);
    forget(swapKey);
    forget(feeKey);
    return hash;
  } catch (err) {
    if (err instanceof TxPending) {
      err.paid = paid;
      throw err;
    }
    if (err instanceof Error && err.message === "reverted") {
      forget(swapKey);
      throw new Error(paid ? "fee-kept" : "reverted");
    }
    if (paid) throw new Error("fee-kept");
    throw err;
  }
}

export async function okbPrints(): Promise<PoolPrint[]> {
  const head = await xClient.getBlockNumber();
  let logs: Awaited<ReturnType<typeof xClient.getLogs<typeof swapV2>>> = [];
  for (const span of [400n, 120n, 40n]) {
    try {
      logs = await xClient.getLogs({ address: OKB.pool, event: swapV2, fromBlock: head > span ? head - span : 0n, toBlock: head });
      break;
    } catch {
      logs = [];
    }
  }
  const rows = logs.slice(-8).reverse();
  const signers = await Promise.all(
    rows.map(async (log) => {
      try {
        const tx = await xClient.getTransaction({ hash: log.transactionHash });
        return tx.from ?? "";
      } catch {
        return log.args.to ?? "";
      }
    }),
  );
  return rows.map((log, index) => {
    const in0 = log.args.amount0In ?? 0n;
    const out1 = log.args.amount1Out ?? 0n;
    const buy = in0 > 0n && out1 > 0n;
    return {
      id: `${log.transactionHash}-${log.logIndex}`,
      side: buy ? "buy" : "sell",
      bem: pretty(buy ? out1 : (log.args.amount1In ?? 0n), 18, 5),
      usdt: pretty(buy ? in0 : (log.args.amount0Out ?? 0n), OKB.usdtDecimals, 2),
      tx: log.transactionHash,
      who: signers[index] ?? "",
    } satisfies PoolPrint;
  });
}

export function okbTxUrl(hash: string): string {
  return `${XLAYER.explorer}/tx/${hash}`;
}

export function okbAddressUrl(address: string): string {
  return `${XLAYER.explorer}/address/${address}`;
}
