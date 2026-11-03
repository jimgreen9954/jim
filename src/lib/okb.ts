import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { TxPending, XLAYER_SAFE, type PoolPrint, units, pretty } from "@/lib/bsc";
import { deskParts } from "@/lib/invite-cut";
import { ensureProvider, grantedAccount, rememberAccount } from "@/lib/wallet";
import { XLAYER } from "@/lib/xlayer";

export const OKB = {
  router: "0x881fB2f98c13d521009464e7D1CBf16E1b394e8E" as const,
  pool: "0xd352a852a328D7ECCC8BBF63E2e1dD73C68527Cd" as const,
  wokb: "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const,
  usdt: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const,
  usdtDecimals: 6,
  gasReserve: 2_000_000_000_000_000n,
};

const xClient = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 12_000 }) });

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
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

const v3Quoter = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const V3_ROUTER = "0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca" as Hex;
const X_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as Hex;

const v3Router = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)",
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
    const id = await eth.request({ method: "eth_chainId" });
    const text = typeof id === "string" ? id : String(id ?? "");
    const n = Number.parseInt(text, text.startsWith("0x") ? 16 : 10);
    if (n === XLAYER.chainId) return;
  } catch {
    /* read failed, ask the wallet */
  }
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
  const max = (1n << 256n) - 1n;
  if (allowance > 0n)
    await waitOkX(
      await send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OKB.router, 0n] })),
    );
  await waitOkX(
    await send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OKB.router, max] })),
  );
}

export async function quoteOkb(side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  const path = side === "buy" ? [OKB.usdt, OKB.wokb] : [OKB.wokb, OKB.usdt];
  const amounts = await xClient.readContract({
    address: OKB.router,
    abi: routerAbi,
    functionName: "getAmountsOut",
    args: [amountIn, path],
  });
  return amounts[amounts.length - 1] ?? 0n;
}

export async function okbPrice(): Promise<string> {
  const out = await quoteOkb("sell", 10n ** 18n);
  return pretty(out, OKB.usdtDecimals, 2);
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
  let next = await grantedAccount(eth);
  if (!next) {
    const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    next = accounts[0];
  }
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
      let routed = false;
      try {
        const { routeDeskFee } = await import("@/lib/card-pool");
        routed = await routeDeskFee("xlayer", from, parts.desk, 0);
      } catch (err) {
        if (err instanceof TxPending) throw err;
        routed = false;
      }
      if (!routed) {
        await stepX(feeKey, () => send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [XLAYER_SAFE, parts.desk] })));
      }
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
    await stepX(feeKey, () => send(from, XLAYER_SAFE, "0x", parts.desk));
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
  const span = 80n;
  const found: Awaited<ReturnType<typeof xClient.getLogs<typeof swapV2>>> = [];
  for (let end = head; found.length < 12 && end + span > head - span * 16n; end -= span) {
    const start = end > span ? end - span + 1n : 0n;
    try {
      const rows = await xClient.getLogs({ address: OKB.pool, event: swapV2, fromBlock: start, toBlock: end });
      found.unshift(...rows);
    } catch {
      /* This RPC refuses a wider window. The next shorter one still runs. */
    }
    if (start === 0n) break;
  }
  const rows = found.slice(-8).reverse();
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

export async function quoteBemOkb(side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  const tokenIn = side === "buy" ? OKB.wokb : X_BEM;
  const tokenOut = side === "buy" ? X_BEM : OKB.wokb;
  const quoted = await xClient.readContract({
    address: "0x976183ac3d09840d243a88c0268badb3b3e3259f",
    abi: v3Quoter,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn, fee: 10000, sqrtPriceLimitX96: 0n }],
  });
  return quoted[0];
}

export async function readXBem(account: string): Promise<bigint> {
  return xClient.readContract({ address: X_BEM, abi: erc20, functionName: "balanceOf", args: [account as Hex] });
}

export async function swapBemOkb(from: string, side: "buy" | "sell", amount: string): Promise<Hex> {
  const owner = from as Hex;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  if (side === "buy") {
    const amountIn = units(amount, 18);
    if (amountIn <= 0n) throw new Error("amount");
    const bal = await xClient.getBalance({ address: owner });
    if (bal < amountIn + OKB.gasReserve) throw new Error("gas");
    const parts = await deskParts("xlayer", from, amountIn);
    if (parts.swapIn <= 0n) throw new Error("amount");
    const minOut = ((await quoteBemOkb("buy", parts.swapIn)) * 9900n) / 10_000n;
    if (minOut <= 0n) throw new Error("tiny");
    const data = encodeFunctionData({
      abi: v3Router,
      functionName: "exactInputSingle",
      args: [{ tokenIn: OKB.wokb, tokenOut: X_BEM, fee: 10000, recipient: owner, amountIn: parts.swapIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
    });
    const hash = await send(from, V3_ROUTER, data, parts.swapIn);
    await waitOkX(hash);
    try {
      if (parts.reward > 0n && parts.referrer) await send(from, parts.referrer as Hex, "0x", parts.reward);
      if (parts.desk > 0n) await send(from, XLAYER_SAFE, "0x", parts.desk);
    } catch {
      /* The pool swap is already in. */
    }
    return hash;
  }
  const amountIn = units(amount, 8);
  if (amountIn <= 0n) throw new Error("amount");
  const held = await xClient.readContract({ address: X_BEM, abi: erc20, functionName: "balanceOf", args: [owner] });
  if (held < amountIn) throw new Error("balance");
  const parts = await deskParts("xlayer", from, amountIn);
  if (parts.swapIn <= 0n) throw new Error("amount");
  const allowance = await xClient.readContract({ address: X_BEM, abi: erc20, functionName: "allowance", args: [owner, V3_ROUTER] });
  if (allowance < parts.swapIn) {
    await stepX(`tl-approve:bemokb:${from.toLowerCase()}`, () =>
      send(from, X_BEM, encodeFunctionData({ abi: erc20, functionName: "approve", args: [V3_ROUTER, parts.swapIn] })),
    );
  }
  const minOut = ((await quoteBemOkb("sell", parts.swapIn)) * 9900n) / 10_000n;
  if (minOut <= 0n) throw new Error("tiny");
  const swapData = encodeFunctionData({
    abi: v3Router,
    functionName: "exactInputSingle",
    args: [{ tokenIn: X_BEM, tokenOut: OKB.wokb, fee: 10000, recipient: V3_ROUTER, amountIn: parts.swapIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0n }],
  });
  const data = encodeFunctionData({
    abi: v3Router,
    functionName: "multicall",
    args: [deadline, [swapData, encodeFunctionData({ abi: v3Router, functionName: "unwrapWETH9", args: [minOut, owner] })]],
  });
  const hash = await send(from, V3_ROUTER, data);
  await waitOkX(hash);
  try {
    if (parts.reward > 0n && parts.referrer) {
      await send(from, X_BEM, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [parts.referrer as Hex, parts.reward] }));
    }
    if (parts.desk > 0n) {
      await send(from, X_BEM, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [XLAYER_SAFE, parts.desk] }));
    }
  } catch {
    /* The pool swap is already in. */
  }
  return hash;
}
