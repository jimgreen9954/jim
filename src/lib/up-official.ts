import { createPublicClient, encodeFunctionData, fallback, http, parseAbi, type Hex } from "viem";
import { ensureProvider } from "@/lib/wallet";

/** tapeup.io 官方 PoB。买入 30% 马上成交，70% 按 25 天释放。 */
export const UP_POOL = "0xDf40529fa3E797c992272e27B811E59E5f1827Ae" as Hex;
export const UP_INSTANT_BPS = 3000;
export const UP_UNLOCK_DAYS = 25;

const abi = parseAbi([
  "function quoteBuy(uint256 amountIn) view returns (uint256 instantIn, uint256 reservoir, uint256 fee, uint256 gross, uint256 tax, uint256 net)",
  "function quoteSell(uint256 amountIn) view returns (uint256 wad, uint256 rest, uint256 gross, uint256 fee, uint256 net)",
  "function quoteBuyWithUSDT(uint256 amountIn) view returns (uint256 bemIn)",
  "function releasable(address account) view returns (uint256)",
  "function pendingRelease(address account) view returns (uint256)",
  "function position(address account) view returns (uint256 budget, uint256 spent, uint256 opened, uint256 updated)",
  "function buy(uint256 amountIn, uint256 minOut)",
  "function sell(uint256 amountIn, uint256 minOut)",
  "function buyWithUSDT(uint256 amountIn, uint256 minOut, uint256 minBem)",
  "function buyWithReleased(uint256 amount, uint256 minOut)",
  "function redeem(uint256 amount)",
]);

const client = createPublicClient({
  transport: fallback(
    [
      http("https://bsc-dataseed.binance.org", { timeout: 8_000, retryCount: 0 }),
      http("https://bsc.publicnode.com", { timeout: 8_000, retryCount: 0 }),
    ],
    { rank: false },
  ),
});

export async function quoteUpPoolBuy(bemIn: bigint) {
  const row = await client.readContract({
    address: UP_POOL,
    abi,
    functionName: "quoteBuy",
    args: [bemIn],
  });
  return { instantIn: row[0], reservoir: row[1], fee: row[2], gross: row[3], tax: row[4], net: row[5] };
}

export async function quoteUpPoolSell(upIn: bigint): Promise<bigint> {
  const row = await client.readContract({
    address: UP_POOL,
    abi,
    functionName: "quoteSell",
    args: [upIn],
  });
  return row[4];
}

export async function quoteUpPoolUsdt(usdtIn: bigint) {
  const bemIn = await client.readContract({
    address: UP_POOL,
    abi,
    functionName: "quoteBuyWithUSDT",
    args: [usdtIn],
  });
  const bought = await quoteUpPoolBuy(bemIn);
  return { bemIn, ...bought };
}

export async function readUpRelease(account: string) {
  const who = account as Hex;
  const [released, pending, position] = await Promise.all([
    client.readContract({ address: UP_POOL, abi, functionName: "releasable", args: [who] }),
    client.readContract({ address: UP_POOL, abi, functionName: "pendingRelease", args: [who] }),
    client.readContract({ address: UP_POOL, abi, functionName: "position", args: [who] }),
  ]);
  return { released, pending, up: position[0] };
}

async function sendPool(from: string, data: Hex): Promise<Hex> {
  const eth = await ensureProvider();
  try {
    await client.call({ account: from as Hex, to: UP_POOL, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    throw new Error(message || "revert");
  }
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: UP_POOL, data, value: "0x0" }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export async function buyReleasedUp(from: string, amount: bigint): Promise<Hex> {
  if (amount <= 0n) throw new Error("empty");
  const quoted = await quoteUpPoolBuy(amount);
  const minOut = (quoted.net * 99n) / 100n;
  const data = encodeFunctionData({ abi, functionName: "buyWithReleased", args: [amount, minOut] });
  return sendPool(from, data);
}

export function upBuyData(amountIn: bigint, minOut: bigint): Hex {
  return encodeFunctionData({ abi, functionName: "buy", args: [amountIn, minOut] });
}

export function upSellData(amountIn: bigint, minOut: bigint): Hex {
  return encodeFunctionData({ abi, functionName: "sell", args: [amountIn, minOut] });
}

export function upUsdtBuyData(amountIn: bigint, minOut: bigint, minBem: bigint): Hex {
  return encodeFunctionData({ abi, functionName: "buyWithUSDT", args: [amountIn, minOut, minBem] });
}

export async function redeemUp(from: string, amount: bigint): Promise<Hex> {
  if (amount <= 0n) throw new Error("empty");
  const data = encodeFunctionData({ abi, functionName: "redeem", args: [amount] });
  return sendPool(from, data);
}
