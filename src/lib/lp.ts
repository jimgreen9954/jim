import { createPublicClient, encodeFunctionData, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { BSC, DESK_FEE_BPS, ERC_BOOKS, FEE_TO, pretty, quoteExact, readAsset, splitDeskFee, units, waitOk, waitReceipt, type ErcKey } from "@/lib/bsc";
import { STOCKS, STOCK_KEYS, type StockKey } from "@/lib/stocks";
import { ensureProvider } from "@/lib/wallet";

export const NPM = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Hex;

const Q192 = 2n ** 192n;
const MAX128 = (1n << 128n) - 1n;

const client = createPublicClient({ transport: http(BSC.rpc) });
const logClient = createPublicClient({ transport: http("https://bsc.publicnode.com", { timeout: 20_000 }) });

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
const factoryAbi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
  "function createPool(address,address,uint24) returns (address)",
]);
const initAbi = parseAbi(["function initialize(uint160 sqrtPriceX96)"]);
const FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Hex;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;

export type LpKey = "bem" | "bnb" | "bnb-bem" | "btc-bem" | "xau-bem" | `${StockKey}-bem` | ErcKey;

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
  quoteToken: Hex;
  quoteDecimals: number;
  quoteZh: string;
  usdtFee: number;
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
  quoteToken: BSC.usdt,
  quoteDecimals: BSC.usdtDecimals,
  quoteZh: "USDT",
  usdtFee: BSC.fee,
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
  quoteToken: BSC.usdt,
  quoteDecimals: BSC.usdtDecimals,
  quoteZh: "USDT",
  usdtFee: BSC.bnbFee,
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
    quoteToken: BSC.usdt,
    quoteDecimals: BSC.usdtDecimals,
    quoteZh: "USDT",
    usdtFee: book.fee,
  };
}

export const LP_CRYPTO: LpBook[] = [
  bemBook,
  bnbBook,
  fromErc("btc", "BTC", "BTC"),
  fromErc("xau", "黄金", "Gold"),
];

export const LP_STOCKS: LpBook[] = STOCK_KEYS.map((key) => fromErc(key, STOCKS[key as StockKey].zh, STOCKS[key as StockKey].en));

export const LP_BEM: LpBook[] = [
  {
    key: "bnb-bem",
    zh: "BNB",
    en: "BNB",
    token: BSC.wbnb,
    decimals: 18,
    fee: 10000,
    pool: "0x28B12792F9D81Bd529Bc5572434E861C9EDbBBC2",
    assetIsToken0: false,
    native: true,
    quoteToken: BSC.bem,
    quoteDecimals: BSC.bemDecimals,
    quoteZh: "BEM",
    usdtFee: BSC.bnbFee,
  },
  {
    key: "btc-bem",
    zh: "BTC",
    en: "BTC",
    token: BSC.btcb,
    decimals: 18,
    fee: 10000,
    pool: ZERO,
    assetIsToken0: false,
    native: false,
    quoteToken: BSC.bem,
    quoteDecimals: BSC.bemDecimals,
    quoteZh: "BEM",
    usdtFee: BSC.btcFee,
  },
  {
    key: "xau-bem",
    zh: "黄金",
    en: "Gold",
    token: BSC.xaut,
    decimals: BSC.xauDecimals,
    fee: 10000,
    pool: ZERO,
    assetIsToken0: true,
    native: false,
    quoteToken: BSC.bem,
    quoteDecimals: BSC.bemDecimals,
    quoteZh: "BEM",
    usdtFee: BSC.xauFee,
  },
  ...STOCK_KEYS.map((key): LpBook => {
    const stock = STOCKS[key];
    return {
      key: `${key}-bem`,
      zh: stock.zh,
      en: stock.en,
      token: stock.token as Hex,
      decimals: 18,
      fee: 10000,
      pool: ZERO,
      assetIsToken0: stock.token.toLowerCase() < BSC.bem.toLowerCase(),
      native: false,
      quoteToken: BSC.bem,
      quoteDecimals: BSC.bemDecimals,
      quoteZh: "BEM",
      usdtFee: stock.fee,
    };
  }),
];

const ALL = [...LP_CRYPTO, ...LP_BEM, ...LP_STOCKS];

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
    await waitOk(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] })));
  }
  await waitOk(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, need] })));
}

export type LpQuote = {
  asset: bigint;
  feeQuote: bigint;
  feeAsset: bigint;
  poolQuote: bigint;
  poolAsset: bigint;
  creating: boolean;
};

function sqrtBig(value: bigint): bigint {
  if (value < 2n) return value;
  let x0 = value;
  let x1 = (x0 + 1n) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}

async function poolOf(book: LpBook): Promise<Hex> {
  if (book.pool !== ZERO) return book.pool;
  return client.readContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "getPool",
    args: [book.token, book.quoteToken, book.fee],
  });
}

const swapEvent = parseAbiItem(
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint128 protocolFeesToken0, uint128 protocolFeesToken1)",
);
const balAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

function human(amount: bigint, decimals: number): number {
  const neg = amount < 0n;
  const value = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const n = Number(value / base) + Number(value % base) / 10 ** decimals;
  return neg ? -n : n;
}

async function usdPerToken(token: Hex, decimals: number, fee: number): Promise<number> {
  if (token.toLowerCase() === BSC.usdt.toLowerCase()) return 1;
  const out = await quoteExact(token, BSC.usdt, 10n ** BigInt(decimals), fee);
  return Number(out) / 10 ** BSC.usdtDecimals;
}

export type LpYield = {
  apr: number | null;
  feesUsd: number;
  tvlUsd: number;
  hours: number;
  empty: boolean;
  thin: boolean;
};

export async function poolYield(key: LpKey): Promise<LpYield> {
  const book = lpBook(key);
  const pool = await poolOf(book);
  if (pool === ZERO) return { apr: null, feesUsd: 0, tvlUsd: 0, hours: 0, empty: true, thin: false };
  const latest = await client.getBlockNumber();
  const span = 5000n;
  const fromBlock = latest > span ? latest - span : 0n;
  const [head, start, slot, bal0, bal1] = await Promise.all([
    client.getBlock({ blockNumber: latest }),
    client.getBlock({ blockNumber: fromBlock }),
    client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }),
    client.readContract({ address: book.assetIsToken0 ? book.token : book.quoteToken, abi: balAbi, functionName: "balanceOf", args: [pool] }),
    client.readContract({ address: book.assetIsToken0 ? book.quoteToken : book.token, abi: balAbi, functionName: "balanceOf", args: [pool] }),
  ]);
  let windowStart = start;
  let logs;
  try {
    logs = await logClient.getLogs({ address: pool, event: swapEvent, fromBlock, toBlock: latest });
  } catch {
    const short = latest > 500n ? latest - 500n : 0n;
    windowStart = await client.getBlock({ blockNumber: short });
    try {
      logs = await logClient.getLogs({ address: pool, event: swapEvent, fromBlock: short, toBlock: latest });
    } catch {
      return { apr: null, feesUsd: 0, tvlUsd: 0, hours: 0, empty: false, thin: false };
    }
  }
  const hours = Math.max(0.25, (Number(head.timestamp) - Number(windowStart.timestamp)) / 3600);
  const token0 = book.assetIsToken0 ? book.token : book.quoteToken;
  const dec0 = book.assetIsToken0 ? book.decimals : book.quoteDecimals;
  const token1 = book.assetIsToken0 ? book.quoteToken : book.token;
  const dec1 = book.assetIsToken0 ? book.quoteDecimals : book.decimals;
  const fee0 = token0.toLowerCase() === BSC.bem.toLowerCase() ? BSC.fee : token0.toLowerCase() === BSC.usdt.toLowerCase() ? 100 : book.usdtFee;
  const fee1 = token1.toLowerCase() === BSC.bem.toLowerCase() ? BSC.fee : token1.toLowerCase() === BSC.usdt.toLowerCase() ? 100 : book.usdtFee;
  const [px0, px1] = await Promise.all([usdPerToken(token0, dec0, fee0), usdPerToken(token1, dec1, fee1)]);
  const tvlUsd = human(bal0, dec0) * px0 + human(bal1, dec1) * px1;
  const proto = Number(slot[5]);
  const keep = (side: number) => (side === 0 ? 1 : (side - 1) / side);
  const keep0 = keep(proto & 0xf);
  const keep1 = keep((proto >> 4) & 0xf);
  let feesUsd = 0;
  for (const log of logs) {
    const amount0 = log.args.amount0 ?? 0n;
    const amount1 = log.args.amount1 ?? 0n;
    if (amount0 > 0n) feesUsd += human(amount0, dec0) * (book.fee / 1_000_000) * keep0 * px0;
    else if (amount1 > 0n) feesUsd += human(amount1, dec1) * (book.fee / 1_000_000) * keep1 * px1;
  }
  const thin = tvlUsd < 20;
  const apr = !thin && tvlUsd > 0 ? (feesUsd / tvlUsd) * ((365 * 24) / hours) * 100 : feesUsd === 0 ? 0 : null;
  return { apr, feesUsd, tvlUsd, hours, empty: false, thin };
}

async function crossSqrt(book: LpBook): Promise<bigint> {
  const quoteUsdt =
    book.quoteToken.toLowerCase() === BSC.usdt.toLowerCase()
      ? 10n ** BigInt(book.quoteDecimals)
      : await quoteExact(book.quoteToken, BSC.usdt, 10n ** BigInt(book.quoteDecimals), BSC.fee);
  const assetUsdt = await quoteExact(book.native ? BSC.wbnb : book.token, BSC.usdt, 10n ** BigInt(book.decimals), book.usdtFee);
  const usdt0 = book.assetIsToken0 ? assetUsdt : quoteUsdt;
  const dec0 = book.assetIsToken0 ? book.decimals : book.quoteDecimals;
  const usdt1 = book.assetIsToken0 ? quoteUsdt : assetUsdt;
  const dec1 = book.assetIsToken0 ? book.quoteDecimals : book.decimals;
  const num = usdt0 * 10n ** BigInt(dec1) * Q192;
  const den = usdt1 * 10n ** BigInt(dec0);
  if (den === 0n || num === 0n) throw new Error("empty");
  return sqrtBig((num << 256n) / den) >> 128n;
}

async function sqrtOf(book: LpBook): Promise<{ sqrt: bigint; creating: boolean }> {
  const pool = await poolOf(book);
  if (pool !== ZERO) {
    try {
      const slot = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" });
      if (slot[0] > 0n) return { sqrt: slot[0], creating: false };
    } catch {
      /* pool not initialized */
    }
  }
  return { sqrt: await crossSqrt(book), creating: true };
}

async function ensurePool(from: string, book: LpBook): Promise<void> {
  let pool = await poolOf(book);
  if (pool === ZERO) {
    const hash = await send(
      from,
      FACTORY,
      encodeFunctionData({ abi: factoryAbi, functionName: "createPool", args: [book.token, book.quoteToken, book.fee] }),
    );
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "success") throw new Error("reverted");
    pool = await poolOf(book);
    if (pool === ZERO) throw new Error("empty");
  }
  const slot = await client.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }).catch(() => null);
  if (!slot || slot[0] === 0n) {
    const price = await crossSqrt(book);
    const hash = await send(from, pool, encodeFunctionData({ abi: initAbi, functionName: "initialize", args: [price] }));
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "success") throw new Error("reverted");
  }
  book.pool = pool;
}

export async function quoteLp(key: LpKey, amountText: string): Promise<LpQuote> {
  const book = lpBook(key);
  const quoteIn = units(amountText, book.quoteDecimals);
  if (quoteIn <= 0n) throw new Error("amount");
  const { sqrt, creating } = await sqrtOf(book);
  if (sqrt === 0n) throw new Error("empty");
  const { fee: feeQuote, swapIn: poolQuote } = splitDeskFee(quoteIn);
  if (poolQuote <= 0n) throw new Error("amount");
  const priceX192 = sqrt * sqrt;
  const poolAsset = book.assetIsToken0 ? (poolQuote * Q192) / priceX192 : (poolQuote * priceX192) / Q192;
  if (poolAsset <= 0n) throw new Error("empty");
  const totalAsset = (poolAsset * 10_000n) / BigInt(10_000 - DESK_FEE_BPS);
  return { asset: totalAsset, feeQuote, feeAsset: totalAsset - poolAsset, poolQuote, poolAsset, creating };
}

export function formatLp(book: LpBook, quote: LpQuote): { asset: string; quote: string; feeAsset: string; feeQuote: string } {
  return {
    asset: pretty(quote.asset, book.decimals, 4),
    quote: pretty(quote.poolQuote + quote.feeQuote, book.quoteDecimals, book.quoteZh === "USDT" ? 2 : 4),
    feeAsset: pretty(quote.feeAsset, book.decimals, 4),
    feeQuote: pretty(quote.feeQuote, book.quoteDecimals, book.quoteZh === "USDT" ? 2 : 4),
  };
}

export async function addLp(from: string, key: LpKey, amountText: string): Promise<Hex> {
  const book = lpBook(key);
  await ensurePool(from, book);
  const quote = await quoteLp(key, amountText);
  const quoteBal = await readAsset(from, book.quoteToken);
  if (quoteBal < quote.poolQuote + quote.feeQuote) throw new Error("quote");
  if (book.native) {
    const gas = await client.getBalance({ address: from as Hex });
    if (gas < quote.asset + 3_000_000_000_000_000n) throw new Error("bnb");
  } else {
    const assetBal = await readAsset(from, book.token);
    if (assetBal < quote.asset) throw new Error("asset");
  }
  if (quote.feeQuote > 0n) {
    await waitOk(await send(from, book.quoteToken, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, quote.feeQuote] })));
  }
  if (book.native) {
    if (quote.feeAsset > 0n) await waitOk(await send(from, FEE_TO, "0x", quote.feeAsset));
    await waitOk(await send(from, BSC.wbnb, encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }), quote.poolAsset));
  } else if (quote.feeAsset > 0n) {
    await waitOk(await send(from, book.token, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, quote.feeAsset] })));
  }
  await approve(from, book.quoteToken, NPM, quote.poolQuote);
  await approve(from, book.token, NPM, quote.poolAsset);
  const range = fullRange(book.fee);
  const token0 = book.assetIsToken0 ? book.token : book.quoteToken;
  const token1 = book.assetIsToken0 ? book.quoteToken : book.token;
  const amount0 = book.assetIsToken0 ? quote.poolAsset : quote.poolQuote;
  const amount1 = book.assetIsToken0 ? quote.poolQuote : quote.poolAsset;
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
  const a = token0.toLowerCase();
  const b = token1.toLowerCase();
  return (
    ALL.find((book) => {
      const token = book.token.toLowerCase();
      const quote = book.quoteToken.toLowerCase();
      const left = book.assetIsToken0 ? token : quote;
      const right = book.assetIsToken0 ? quote : token;
      return book.fee === fee && a === left && b === right;
    }) ?? null
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
    rows.push({ id, key: book.key, labelZh: `${book.zh} / ${book.quoteZh}`, labelEn: `${book.en} / ${book.quoteZh}`, liquidity: pos[7] });
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
  const token0 = pos[2];
  const token1 = pos[3];
  const wbnbIs0 = token0.toLowerCase() === BSC.wbnb.toLowerCase();
  let calls: Hex[];
  if (book.native) {
    const other = wbnbIs0 ? token1 : token0;
    const otherMin = wbnbIs0 ? min1 : min0;
    const bnbMin = wbnbIs0 ? min0 : min1;
    calls = [
      decrease,
      encodeFunctionData({
        abi: npmAbi,
        functionName: "collect",
        args: [{ tokenId: id, recipient: NPM, amount0Max: MAX128, amount1Max: MAX128 }],
      }),
      encodeFunctionData({ abi: npmAbi, functionName: "unwrapWETH9", args: [bnbMin, owner] }),
      encodeFunctionData({ abi: npmAbi, functionName: "sweepToken", args: [other, otherMin, owner] }),
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
  if (book.native) {
    const feeOther = wbnbIs0 ? fee1 : fee0;
    const feeBnb = wbnbIs0 ? fee0 : fee1;
    const other = wbnbIs0 ? token1 : token0;
    if (feeOther > 0n) await waitOk(await send(from, other, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, feeOther] })));
    if (feeBnb > 0n) await waitOk(await send(from, FEE_TO, "0x", feeBnb));
  } else {
    if (fee0 > 0n) await waitOk(await send(from, token0, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, fee0] })));
    if (fee1 > 0n) await waitOk(await send(from, token1, encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, fee1] })));
  }
  return hash;
}

