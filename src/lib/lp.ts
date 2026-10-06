import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { BSC, DESK_FEE_BPS, ERC_BOOKS, FEE_TO, pretty, readAsset, splitDeskFee, units, waitReceipt, type ErcKey } from "@/lib/bsc";
import { STOCKS, STOCK_KEYS, type StockKey } from "@/lib/stocks";
import { ensureProvider } from "@/lib/wallet";

export const NPM = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Hex;

const Q192 = 2n ** 192n;
const MAX128 = (1n << 128n) - 1n;

const client = createPublicClient({ transport: http(BSC.rpc) });

const erc20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
]);

const npmAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
]);

const wbnbAbi = parseAbi(["function deposit() payable"]);

export type LpKey = "bem" | "bnb" | ErcKey;

export type LpBook = {
  key: LpKey;
  zh: string;
  en: string;
  token: Hex;
  decimals: number;
  fee: number;
  pool: Hex;
  assetIsToken0: boolean;
  native: boolean;
};

const bemBook: LpBook = {
  key: "bem",
  zh: "BEM",
  en: "BEM",
  token: BSC.bem,
  decimals: BSC.bemDecimals,
  fee: BSC.fee,
  pool: BSC.pool,
  assetIsToken0: true,
  native: false,
};

const bnbBook: LpBook = {
  key: "bnb",
  zh: "BNB",
  en: "BNB",
  token: BSC.wbnb,
  decimals: 18,
  fee: BSC.bnbFee,
  pool: BSC.bnbPool,
  assetIsToken0: false,
  native: true,
};

function fromErc(key: ErcKey, zh: string, en: string): LpBook {
  const book = ERC_BOOKS[key];
  return {
    key,
    zh,
    en,
    token: book.token,
    decimals: book.decimals,
    fee: book.fee,
    pool: book.pool,
    assetIsToken0: book.assetIsToken0,
    native: false,
  };
}

export const LP_CRYPTO: LpBook[] = [
  bemBook,
  bnbBook,
  fromErc("btc", "BTC", "BTC"),
  fromErc("xau", "黄金", "Gold"),
];

export const LP_STOCKS: LpBook[] = STOCK_KEYS.map((key) => fromErc(key, STOCKS[key as StockKey].zh, STOCKS[key as StockKey].en));

const ALL = [...LP_CRYPTO, ...LP_STOCKS];

export function lpBook(key: LpKey): LpBook {
  const found = ALL.find((book) => book.key === key);
  if (!found) throw new Error("pair");
  return found;
}

function spacing(fee: number): number {
  if (fee === 100) return 1;
  if (fee === 500) return 10;
  if (fee === 2500) return 50;
  if (fee === 10000) return 200;
  throw new Error("fee");
}

function fullRange(fee: number): { lower: number; upper: number } {
  const step = spacing(fee);
  return { lower: Math.ceil(-887272 / step) * step, upper: Math.floor(887272 / step) * step };
}

function slip(amount: bigint): bigint {
  return (amount * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
}

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

async function approve(from: string, token: Hex, spender: Hex, need: bigint): Promise<void> {
  const allowance = await client.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, spender],
  });
  if (allowance >= need) return;
  if (allowance > 0n) {
    await waitReceipt(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] })));
  }
  await waitReceipt(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, need] })));
}

export type LpQuote = {
  asset: bigint;
  feeUsdt: bigint;
  feeAsset: bigint;
  poolUsdt: bigint;
  poolAsset: bigint;
};

export async function quoteLp(key: LpKey, usdtText: string): Promise<LpQuote> {
  const book = lpBook(key);
  const usdtIn = units(usdtText, BSC.usdtDecimals);
  if (usdtIn <= 0n) throw new Error("amount");
  const slot = await client.readContract({ address: book.pool, abi: poolAbi, functionName: "slot0" });
  const sqrt = slot[0];
  if (sqrt === 0n) throw new Error("empty");
  const { fee: feeUsdt, swapIn: poolUsdt } = splitDeskFee(usdtIn);
  if (poolUsdt <= 0n) throw new Error("amount");
  const priceX192 = sqrt * sqrt;
  const poolAsset = book.assetIsToken0 ? (poolUsdt * Q192) / priceX192 : (poolUsdt * priceX192) / Q192;
  if (poolAsset <= 0n) throw new Error("empty");
  const totalAsset = (poolAsset * 10_000n) / BigInt(10_000 - DESK_FEE_BPS);
  return { asset: totalAsset, feeUsdt, feeAsset: totalAsset - poolAsset, poolUsdt, poolAsset };
}

export function formatLp(book: LpBook, quote: LpQuote): { asset: string; usdt: string; feeAsset: string; feeUsdt: string } {
  return {
    asset: pretty(quote.asset, book.decimals, 4),
    usdt: pretty(quote.poolUsdt + quote.feeUsdt, BSC.usdtDecimals, 2),
    feeAsset: pretty(quote.feeAsset, book.decimals, 4),
    feeUsdt: pretty(quote.feeUsdt, BSC.usdtDecimals, 2),
  };
}

export async function addLp(from: string, key: LpKey, usdtText: string): Promise<Hex> {
  const book = lpBook(key);
  const quote = await quoteLp(key, usdtText);
  const usdtBal = await readAsset(from, BSC.usdt);
  if (usdtBal < quote.poolUsdt + quote.feeUsdt) throw new Error("usdt");
  if (book.native) {
    const gas = await client.getBalance({ address: from as Hex });
    if (gas < quote.asset + 3_000_000_000_000_000n) throw new Error("bnb");
  } else {
    const assetBal = await readAsset(from, book.token);
    if (assetBal < quote.asset) throw new Error("asset");
  }
  if (quote.feeUsdt > 0n) {
    await waitReceipt(await send(from, BSC.usdt, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, quote.feeUsdt] })));
  }
  if (book.native) {
    if (quote.feeAsset > 0n) await waitReceipt(await send(from, FEE_TO, "0x", quote.feeAsset));
    await waitReceipt(await send(from, BSC.wbnb, encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }), quote.poolAsset));
  } else if (quote.feeAsset > 0n) {
    await waitReceipt(await send(from, book.token, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, quote.feeAsset] })));
  }
  await approve(from, BSC.usdt, NPM, quote.poolUsdt);
  await approve(from, book.token, NPM, quote.poolAsset);
  const range = fullRange(book.fee);
  const token0 = book.assetIsToken0 ? book.token : BSC.usdt;
  const token1 = book.assetIsToken0 ? BSC.usdt : book.token;
  const amount0 = book.assetIsToken0 ? quote.poolAsset : quote.poolUsdt;
  const amount1 = book.assetIsToken0 ? quote.poolUsdt : quote.poolAsset;
  const data = encodeFunctionData({
    abi: npmAbi,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        fee: book.fee,
        tickLower: range.lower,
        tickUpper: range.upper,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: slip(amount0),
        amount1Min: slip(amount1),
        recipient: from as Hex,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 20),
      },
    ],
  });
  const hash = await send(from, NPM, data);
  const receipt = await waitReceipt(hash);
  if (receipt.status !== "success") throw new Error("reverted");
  return hash;
}

export type LpPosition = {
  id: bigint;
  key: LpKey;
  labelZh: string;
  labelEn: string;
  liquidity: bigint;
};

function match(token0: string, token1: string, fee: number): LpBook | null {
  return (
    ALL.find(
      (book) =>
        book.fee === fee &&
        (book.assetIsToken0
          ? token0.toLowerCase() === book.token.toLowerCase() && token1.toLowerCase() === BSC.usdt.toLowerCase()
          : token0.toLowerCase() === BSC.usdt.toLowerCase() && token1.toLowerCase() === book.token.toLowerCase()),
    ) ?? null
  );
}

export async function listLp(owner: string): Promise<LpPosition[]> {
  const count = await client.readContract({ address: NPM, abi: npmAbi, functionName: "balanceOf", args: [owner as Hex] });
  const take = count > 24n ? 24n : count;
  const rows: LpPosition[] = [];
  for (let i = 0n; i < take; i += 1n) {
    const id = await client.readContract({ address: NPM, abi: npmAbi, functionName: "tokenOfOwnerByIndex", args: [owner as Hex, i] });
    const pos = await client.readContract({ address: NPM, abi: npmAbi, functionName: "positions", args: [id] });
    const book = match(pos[2], pos[3], pos[4]);
    if (!book || pos[7] === 0n) continue;
    rows.push({ id, key: book.key, labelZh: book.zh, labelEn: book.en, liquidity: pos[7] });
  }
  return rows;
}

export async function removeLp(from: string, id: bigint): Promise<Hex> {
  const pos = await client.readContract({ address: NPM, abi: npmAbi, functionName: "positions", args: [id] });
  const book = match(pos[2], pos[3], pos[4]);
  if (!book) throw new Error("pair");
  const liquidity = pos[7];
  if (liquidity === 0n) throw new Error("empty");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  const sim = await client.simulateContract({
    address: NPM,
    abi: npmAbi,
    functionName: "decreaseLiquidity",
    args: [{ tokenId: id, liquidity, amount0Min: 0n, amount1Min: 0n, deadline }],
    account: from as Hex,
  });
  const out0 = sim.result[0];
  const out1 = sim.result[1];
  const min0 = slip(out0);
  const min1 = slip(out1);
  const decrease = encodeFunctionData({
    abi: npmAbi,
    functionName: "decreaseLiquidity",
    args: [{ tokenId: id, liquidity, amount0Min: min0, amount1Min: min1, deadline }],
  });
  const owner = from as Hex;
  let calls: Hex[];
  if (book.native) {
    const usdtMin = book.assetIsToken0 ? min1 : min0;
    const bnbMin = book.assetIsToken0 ? min0 : min1;
    calls = [
      decrease,
      encodeFunctionData({
        abi: npmAbi,
        functionName: "collect",
        args: [{ tokenId: id, recipient: NPM, amount0Max: MAX128, amount1Max: MAX128 }],
      }),
      encodeFunctionData({ abi: npmAbi, functionName: "unwrapWETH9", args: [bnbMin, owner] }),
      encodeFunctionData({ abi: npmAbi, functionName: "sweepToken", args: [BSC.usdt, usdtMin, owner] }),
    ];
  } else {
    calls = [
      decrease,
      encodeFunctionData({
        abi: npmAbi,
        functionName: "collect",
        args: [{ tokenId: id, recipient: owner, amount0Max: MAX128, amount1Max: MAX128 }],
      }),
    ];
  }
  const data = encodeFunctionData({ abi: npmAbi, functionName: "multicall", args: [calls] });
  const hash = await send(from, NPM, data);
  const receipt = await waitReceipt(hash);
  if (receipt.status !== "success") throw new Error("reverted");
  const fee0 = (out0 * BigInt(DESK_FEE_BPS)) / 10_000n;
  const fee1 = (out1 * BigInt(DESK_FEE_BPS)) / 10_000n;
  const token0 = pos[2];
  const token1 = pos[3];
  if (book.native) {
    const feeUsdt = book.assetIsToken0 ? fee1 : fee0;
    const feeBnb = book.assetIsToken0 ? fee0 : fee1;
    if (feeUsdt > 0n) await waitReceipt(await send(from, BSC.usdt, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, feeUsdt] })));
    if (feeBnb > 0n) await waitReceipt(await send(from, FEE_TO, "0x", feeBnb));
  } else {
    if (fee0 > 0n) await waitReceipt(await send(from, token0, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, fee0] })));
    if (fee1 > 0n) await waitReceipt(await send(from, token1, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, fee1] })));
  }
  return hash;
}
