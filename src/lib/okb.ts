import { createPublicClient, encodeFunctionData, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { FEE_TO, splitDeskFee, TxPending, type PoolPrint, units, pretty } from "@/lib/bsc";
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

const xClient = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 12_000 }) });

const routerAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
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
    const { fee, swapIn } = splitDeskFee(amountIn);
    if (swapIn <= 0n) throw new Error("amount");
    const who = from.toLowerCase();
    const swapKey = `tl-swap:${who}:okb-buy:${amountIn}`;
    const feeKey = `tl-fee:${who}:okb-buy:${fee}`;
    const already = await resumeX(swapKey);
    if (already) {
      forget(feeKey);
      return already;
    }
    const minOut = slip(await quoteOkb("buy", swapIn));
    await approveUsdt(from, swapIn);
    let paid = false;
    if (fee > 0n) {
      await stepX(feeKey, () => send(from, OKB.usdt, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, fee] })));
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
  const { fee, swapIn } = splitDeskFee(amountIn);
  if (swapIn <= 0n) throw new Error("amount");
  const who = from.toLowerCase();
  const swapKey = `tl-swap:${who}:okb-sell:${amountIn}`;
  const feeKey = `tl-fee:${who}:okb-sell:${fee}`;
  const already = await resumeX(swapKey);
  if (already) {
    forget(feeKey);
    return already;
  }
  const minOut = slip(await quoteOkb("sell", swapIn));
  let paid = false;
  if (fee > 0n) {
    await stepX(feeKey, () => send(from, FEE_TO, "0x", fee));
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
