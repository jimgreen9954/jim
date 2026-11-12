import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, stringToBytes, type Hex } from "viem";
import { BSC, BSC_SAFE, FEE_TO, XLAYER_SAFE, bscClient, connectBsc, pretty, readBalances, units, waitReceipt } from "@/lib/bsc";
import { CREATE_CALL, createCallData, createdAddress } from "@/lib/create-call";
import { PERP_BYTECODE } from "@/lib/perp-artifact";
import { RISK_BYTECODE } from "@/lib/risk-artifact";
import { DESK_MARK_BYTECODE } from "@/lib/desk-mark-artifact";
import { FAB_PERP_SHIP_BYTECODE, FAB_VIEW_QUOTER_BYTECODE } from "@/lib/fab-ship-artifact";
import { MARK_BYTECODE } from "@/lib/mark-artifact";
import { UP_MARK_BYTECODE } from "@/lib/up-mark-artifact";
import { UP_SHIP_BYTECODE } from "@/lib/up-ship-artifact";
import { FAB_QUOTER } from "@/lib/fab";
import { getProvider } from "@/lib/wallet";
import { XLAYER, connectXLayer } from "@/lib/xlayer";

export const PERP_KEY = "tapeliquid-perp-v1";
const TX_KEY = "tapeliquid-perp-tx";
export const REBATE_KEY = "tapeliquid-rebate-v1";
const DESK_KEY = "tapeliquid-desk-v1";
const XPERP_KEY = "tapeliquid-xperp-v1";
const XMARK_KEY = "tapeliquid-xmark-v1";
const XPERP_FIXED = "tapeliquid-xperp-fixed";
const XPERP_HOLD = "tapeliquid-xperp-hold";
const XMARK_FIXED = "tapeliquid-xmark-fixed";
const XMARK_HOLD = "tapeliquid-xmark-hold";
const XBEM_MARK_KEY = "tapeliquid-xbem-mark";
const XBEM_PERP_KEY = "tapeliquid-xbem-perp";
export const X_USDT = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;

export type Desk = "bsc" | "xlayer";

export function savedDesk(): Desk {
  if (typeof window === "undefined") return "bsc";
  return window.localStorage.getItem(DESK_KEY) === "xlayer" ? "xlayer" : "bsc";
}

let desk: Desk = savedDesk();

export function currentDesk(): Desk {
  return desk;
}

export function selectDesk(next: Desk) {
  desk = next;
  if (typeof window !== "undefined") window.localStorage.setItem(DESK_KEY, next);
}

function tokenAddress(): Hex {
  return desk === "xlayer" ? X_USDT : BSC.usdt;
}

function tokenDecimals(): number {
  return desk === "xlayer" ? 6 : 18;
}

function tokenUnit(): bigint {
  return 10n ** BigInt(tokenDecimals());
}
export const KNOWN_PERP = "0xB98D14333a93D49a4E05478d002FC3944D88A3b7";
export const BSC_REBATE = "0xdA4aA9E0aaad6F91835cD19345D49a8fcA8d019A";
export const PREV_BSC = "0xce3511b6e909c9694826cfd5dbe434d457920eba";
export const KNOWN_XPERP = "0xE8Ed0fE7a7aaEF822b2e5Ce9679ccACcF3aEFF56";
export const KNOWN_XMARK = "0xb4B2ee90D10ECfC7ed36A58e96e03074fA8731Eb";
export const PREV_XPERP = "0xCAC69F02c06bfCa3bFDb1eaF1F4a60e17e718081";
export const PREV_XMARK = "0xba5234cd46ec5eB0DFdf4ac329FF42EB3062B4eA";
export const NEXT_XMARK = KNOWN_XMARK;
export const BOARD = [KNOWN_PERP];

const abi = [
  {
    name: "mark",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "pending",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "user", type: "address" },
      { name: "long", type: "bool" },
      { name: "margin", type: "uint96" },
      { name: "lev", type: "uint8" },
    ],
  },
  {
    name: "status",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "kind", type: "uint8" },
      { name: "long", type: "bool" },
      { name: "margin", type: "uint256" },
      { name: "base", type: "uint256" },
      { name: "entry", type: "uint256" },
      { name: "equity", type: "uint256" },
      { name: "underwater", type: "bool" },
      { name: "other", type: "address" },
    ],
  },
  {
    name: "open",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "long", type: "bool" },
      { name: "margin", type: "uint256" },
      { name: "lev", type: "uint8" },
    ],
    outputs: [],
  },
  { name: "cancel", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "close", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    name: "liquidate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    name: "MIN_MARGIN",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "nextId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "deals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "long", type: "address" },
      { name: "short", type: "address" },
      { name: "marginL", type: "uint96" },
      { name: "marginS", type: "uint96" },
      { name: "base", type: "uint128" },
      { name: "entry", type: "uint128" },
      { name: "open", type: "bool" },
    ],
  },
  {
    name: "nextQuote",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "nextDeal",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "quotes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "long", type: "bool" },
      { name: "margin", type: "uint96" },
      { name: "lev", type: "uint8" },
      { name: "open", type: "bool" },
    ],
  },
  {
    name: "take",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "quoteId", type: "uint256" },
      { name: "margin", type: "uint256" },
      { name: "lev", type: "uint8" },
    ],
    outputs: [],
  },
  {
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "quoteId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "close",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    name: "liquidate",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
] as const;

const erc20 = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

async function deskClient(which: Desk) {
  if (which !== "xlayer") return bscClient;
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ transport: http(XLAYER.rpc, { timeout: 8_000 }) });
}

async function client() {
  if (desk !== "xlayer") return bscClient;
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ transport: http(XLAYER.rpc, { timeout: 8_000 }) });
}

async function send(from: string, to: Hex | undefined, data: Hex, gasLimit?: bigint): Promise<Hex> {
  if (desk === "xlayer") await connectXLayer();
  else await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const rpc = await client();
  let price = desk === "xlayer" ? 1_000_000n : 50_000_000n;
  try {
    price = await rpc.getGasPrice();
  } catch {
    price = desk === "xlayer" ? 1_000_000n : 50_000_000n;
  }
  if (desk === "bsc" && price < 50_000_000n) price = 50_000_000n;
  const gas = (gasLimit ?? (to ? 800_000n : 2_200_000n)).toString(16);
  if (desk === "xlayer") {
    const plain: {
      from: string;
      data: Hex;
      chainId: string;
      gas: string;
      to?: Hex;
    } = {
      from,
      data,
      chainId: XLAYER.hex,
      gas: `0x${gas}`,
    };
    if (to) plain.to = to;
    const hash = (await eth.request({ method: "eth_sendTransaction", params: [plain] })) as Hex;
    const receipt = await rpc.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 2_000 });
    if (receipt.status !== "success") throw new Error("revert");
    return hash;
  }
  const fee = `0x${(price * 2n).toString(16)}` as Hex;
  const tx: {
    from: string;
    data: Hex;
    chainId: string;
    gas: string;
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
    to?: Hex;
  } = {
    from,
    data,
    chainId: BSC.hex,
    gas: `0x${gas}`,
    maxFeePerGas: fee,
    maxPriorityFeePerGas: fee,
  };
  if (to) tx.to = to;
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  if (!to && typeof hash === "string" && hash.startsWith("0x")) window.localStorage.setItem(TX_KEY, hash);
  const receipt = await waitReceipt(hash);
  if (receipt.status !== "success") {
    if (!to) window.localStorage.removeItem(TX_KEY);
    throw new Error("revert");
  }
  return hash;
}

export function savedPerp(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(PERP_KEY) || KNOWN_PERP;
}

export function rememberPerp(address: string) {
  window.localStorage.setItem(PERP_KEY, address);
}

const pricedAbi = [
  {
    name: "priced",
    type: "function",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
] as const;

const openAtAbi = [
  {
    name: "open",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "long", type: "bool" },
      { name: "margin", type: "uint256" },
      { name: "lev", type: "uint16" },
      { name: "price", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const quoteWideAbi = [
  {
    name: "quotes",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "user", type: "address" },
      { name: "long", type: "bool" },
      { name: "margin", type: "uint96" },
      { name: "lev", type: "uint16" },
      { name: "open", type: "bool" },
      { name: "price", type: "uint128" },
    ],
  },
] as const;

const takeWideAbi = [
  {
    name: "take",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "quoteId", type: "uint256" },
      { name: "margin", type: "uint256" },
      { name: "lev", type: "uint16" },
    ],
    outputs: [],
  },
] as const;

const dealWideAbi = [
  {
    name: "deals",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "long", type: "address" },
      { name: "short", type: "address" },
      { name: "marginL", type: "uint96" },
      { name: "marginS", type: "uint96" },
      { name: "base", type: "uint128" },
      { name: "entry", type: "uint128" },
      { name: "open", type: "bool" },
      { name: "levL", type: "uint16" },
      { name: "levS", type: "uint16" },
    ],
  },
] as const;

const empty = "0x0000000000000000000000000000000000000000";

export function savedXPerp(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(XPERP_KEY) ?? "";
}

const BSC_BOOK_KEY = "tapeliquid-bsc-book";

export function savedXBemPerp(): string {
  if (typeof window === "undefined") return "";
  const saved = window.localStorage.getItem(XBEM_PERP_KEY) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved : "";
}

const FRESH_X_BOOK = "tapeliquid-xbook-19";
const FRESH_X_MARK = "tapeliquid-xmark-19";

export function freshXBook(): string {
  if (typeof window === "undefined") return "";
  const saved = window.localStorage.getItem(FRESH_X_BOOK) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved : "";
}

export function revertXBook(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(FRESH_X_BOOK);
  window.localStorage.removeItem(FRESH_X_MARK);
}

export function bookOf(which: Desk = desk): string {
  if (which === "xlayer") return freshXBook() || KNOWN_XPERP;
  return BSC_REBATE;
}

const RISK_BSC = "tapeliquid-risk-bsc";
const RISK_X = "tapeliquid-risk-x";

export function priorBook(which: Desk): string {
  return bookOf(which);
}

export function riskOf(which: Desk): string {
  if (typeof window === "undefined") return "";
  const saved = window.localStorage.getItem(which === "xlayer" ? RISK_X : RISK_BSC) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved : "";
}

export type CoinBook = "btc" | "eth" | "zec" | "up" | "tape" | "fab";

const TAPE_POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as Hex;

/** Marks the multisig already created. Books are separate. */
const COIN_MARK: Record<Exclude<CoinBook, "fab">, Hex> = {
  btc: "0xCA0a236452fB2cE9257DCb976211E09A95769bd0",
  eth: "0xcA755b4202Bfa5419c73019Eb889a5F884F7A337",
  zec: "0x3a84F7df202C2d76a5435D467619D1a8d4815d21",
  up: "0xD18Ec3c8d37D4954974EB217361C11b80E6545E3",
  tape: "0x5EF3db885b1E3D254a192887965ed514187089A3",
};

export const BTC_COIN_BOOK = "0x81A35fDaaEe7dE3dcDa195F312279Bb2aDc0b8B4" as Hex;
export const ETH_COIN_BOOK = "0x564C9f5aa89430ca4f2945b466e34BE8705ee0B8" as Hex;
export const ZEC_COIN_BOOK = "0xdAd8E211ec6c8b43eCe19Da2519C9505CDCbF229" as Hex;
export const UP_COIN_BOOK = "0x7aaf00Dab91e0e6dDDb6093323D0140c11C55aD3" as Hex;
export const TAPE_COIN_BOOK = "0x9b17D0F6431957661AdD30051de2615cb08A3886" as Hex;
export const FAB_COIN_BOOK = "0x6Bd480BF658FaB7A2cb758c0408A7b3B5B94B431" as Hex;

const COIN_LIVE: Partial<Record<CoinBook, { chain: Desk; book: Hex }>> = {
  btc: { chain: "bsc", book: BTC_COIN_BOOK },
  eth: { chain: "bsc", book: ETH_COIN_BOOK },
  zec: { chain: "bsc", book: ZEC_COIN_BOOK },
  up: { chain: "bsc", book: UP_COIN_BOOK },
  tape: { chain: "xlayer", book: TAPE_COIN_BOOK },
  fab: { chain: "xlayer", book: FAB_COIN_BOOK },
};

function coinStore(which: Desk, coin: string): string {
  return `tl-coin-book:${which}:${coin}`;
}

function pendingStore(which: Desk, coin: string): string {
  return `tl-coin-book-pending:${which}:${coin}`;
}

export function coinBook(which: Desk, coin: string): string {
  const live = COIN_LIVE[coin as CoinBook];
  if (live && live.chain === which) return live.book;
  if (typeof window === "undefined") return "";
  const saved = window.localStorage.getItem(coinStore(which, coin)) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved : "";
}

export function pickBook(which: Desk, coin: string): string {
  if (coin === "tape" || coin === "fab") return coinBook("xlayer", coin);
  if (coin === "btc" || coin === "eth" || coin === "zec" || coin === "up") return coinBook("bsc", coin);
  return bookOf(which);
}

/** Deploys the funding book. Stake, mine and the old perp are not called. */
export async function deployRisk(from: string, which: Desk): Promise<string> {
  const safe = which === "xlayer" ? XLAYER_SAFE : BSC_SAFE;
  if (from.toLowerCase() !== safe.toLowerCase() && from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const was = desk;
  desk = which;
  try {
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
      [which === "xlayer" ? X_USDT : BSC.usdt, which === "xlayer" ? KNOWN_XMARK : BSC.pool, which === "xlayer" ? 1_000_000n : 10n ** 18n, safe],
    );
    const hash = await send(from, CREATE_CALL, createCallData((RISK_BYTECODE + args.slice(2)) as Hex), 8_000_000n);
    const receipt = await (await client()).waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
    const addr = receipt.status === "success" ? createdAddress(receipt.logs) : "";
    if (!addr) throw new Error("revert");
    window.localStorage.setItem(which === "xlayer" ? RISK_X : RISK_BSC, addr);
    return addr;
  } finally {
    desk = was;
  }
}

function pinned(perp: string): void {
  const want = perp.toLowerCase();
  const rows = [bookOf("bsc"), bookOf("xlayer"), coinBook("bsc", "btc"), coinBook("bsc", "eth"), coinBook("bsc", "zec"), coinBook("bsc", "up"), coinBook("xlayer", "tape"), coinBook("xlayer", "fab")];
  if (!rows.some((row) => row.length === 42 && row.toLowerCase() === want)) throw new Error("book");
}

export async function rememberXBem(address: string): Promise<string> {
  const perp = address.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) throw new Error("address");
  const state = await xBookState(perp);
  if (state === "down") throw new Error("empty");
  window.localStorage.setItem(XBEM_PERP_KEY, perp);
  return perp;
}

export async function xBookState(perp: string): Promise<"ready" | "scale" | "down"> {
  try {
    const c = await deskClient("xlayer");
    const px = await c.readContract({
      address: perp as Hex,
      abi: [{ name: "mark", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
      functionName: "mark",
    });
    if (px < 10n ** 15n) return "scale";
    return "ready";
  } catch {
    return "down";
  }
}

export function xHolds(): boolean {
  return typeof window !== "undefined" && /^0x[a-fA-F0-9]{40}$/.test(window.localStorage.getItem(XMARK_HOLD) ?? "");
}

export async function xReady(perp: string): Promise<boolean> {
  return (await xBookState(perp)) === "ready";
}

export async function deployBscBook(from: string): Promise<string> {
  const was = desk;
  desk = "bsc";
  try {
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [BSC.usdt, BSC.pool, 10n ** 18n],
    );
    const data = (PERP_BYTECODE + args.slice(2)) as Hex;
    const hash = await send(from, undefined, data, 6_000_000n);
    const rpc = await client();
    const receipt = await rpc.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
    const addr = receipt.contractAddress ?? "";
    if (!addr) throw new Error("revert");
    window.localStorage.setItem(BSC_BOOK_KEY, addr);
    return addr;
  } finally {
    desk = was;
  }
}

export async function activeBook(): Promise<string> {
  return bookOf();
}

export async function readBoard(): Promise<{ perp: string; quote: BookQuote }[]> {
  const addrs = [bookOf(desk)];
  const rows: { perp: string; quote: BookQuote }[] = [];
  for (const addr of addrs) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) continue;
    try {
      const view = await readPerp(addr, null);
      rows.push(...view.quotes.map((quote) => ({ perp: addr, quote })));
    } catch {
      continue;
    }
  }
  return rows;
}

export type MineRow = {
  chain: Desk;
  coin: string;
  book: string;
  kind: "quote" | "deal";
  quote?: BookQuote;
  deal?: LiveDeal;
};

/** Every open quote and deal this wallet has, on every live book. */
export async function readMine(account: string): Promise<MineRow[]> {
  const who = account.toLowerCase();
  const books = [
    ["bsc", "bem", BSC_REBATE],
    ["xlayer", "bem", KNOWN_XPERP],
    ["bsc", "btc", BTC_COIN_BOOK],
    ["bsc", "eth", ETH_COIN_BOOK],
    ["bsc", "zec", ZEC_COIN_BOOK],
    ["bsc", "up", UP_COIN_BOOK],
    ["xlayer", "tape", TAPE_COIN_BOOK],
    ["xlayer", "fab", FAB_COIN_BOOK],
  ] as const;
  const out: MineRow[] = [];
  const was = desk;
  try {
    for (const [chain, coin, book] of books) {
      desk = chain;
      try {
        const view = await readPerp(book, account);
        for (const quote of view.quotes) {
          if (quote.user.toLowerCase() === who) out.push({ chain, coin, book, kind: "quote", quote });
        }
        for (const deal of view.liveDeals) {
          if (deal.long.toLowerCase() === who || deal.short.toLowerCase() === who)
            out.push({ chain, coin, book, kind: "deal", deal });
        }
      } catch {
        /* one quiet book does not hide the others */
      }
    }
  } finally {
    desk = was;
  }
  return out;
}

export async function resumeDeploy(): Promise<{ address: string; hash: string }> {
  const address = savedPerp();
  const hash = window.localStorage.getItem(TX_KEY) ?? "";
  if (address) return { address, hash: "" };
  if (!hash) return { address: "", hash: "" };
  try {
    const receipt = await (await client()).getTransactionReceipt({ hash: hash as Hex });
    if (receipt?.status === "success" && receipt.contractAddress) {
      rememberPerp(receipt.contractAddress);
      window.localStorage.removeItem(TX_KEY);
      return { address: receipt.contractAddress, hash };
    }
    if (receipt) window.localStorage.removeItem(TX_KEY);
  } catch {
    return { address: "", hash };
  }
  return { address: "", hash: "" };
}

export async function deployPerp(from: string): Promise<string> {
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint256" }],
    [BSC.usdt, BSC.pool, 10n ** 18n],
  );
  const data = (PERP_BYTECODE + args.slice(2)) as Hex;
  const hash = await send(from, undefined, data);
  const receipt = await (await client()).getTransactionReceipt({ hash });
  if (receipt?.status !== "success" || !receipt.contractAddress) throw new Error("revert");
  window.localStorage.setItem(REBATE_KEY, receipt.contractAddress);
  window.localStorage.removeItem(TX_KEY);
  return receipt.contractAddress;
}

export type BookQuote = {
  id: bigint;
  user: string;
  long: boolean;
  margin: bigint;
  lev: number;
  price: bigint;
};

export type LiveDeal = {
  id: bigint;
  long: string;
  short: string;
  marginL: bigint;
  marginS: bigint;
  base: bigint;
  entry: bigint;
  eqL: bigint;
  eqS: bigint;
  weakL: boolean;
  weakS: boolean;
  levL: number;
  levS: number;
};

export type PerpView = {
  book: boolean;
  priced: boolean;
  mark: bigint;
  min: bigint;
  quotes: BookQuote[];
  liveDeals: LiveDeal[];
  pendingUser: string;
  pendingLong: boolean;
  pendingMargin: bigint;
  pendingLev: number;
  kind: number;
  long: boolean;
  margin: bigint;
  base: bigint;
  entry: bigint;
  equity: bigint;
  underwater: boolean;
  other: string;
  dealOpen: boolean;
  longAddr: string;
  shortAddr: string;
  marginL: bigint;
  marginS: bigint;
  dealBase: bigint;
  dealEntry: bigint;
  myDeal: bigint;
};

export function splitEquity(base: bigint, entry: bigint, px: bigint, marginL: bigint, marginS: bigint) {
  if (base === 0n || px === 0n) return { eqL: marginL, eqS: marginS };
  const pnl = (base * (px - entry)) / 10n ** 18n;
  let left = marginL + pnl;
  let right = marginS - pnl;
  if (left < 0n) {
    right += left;
    left = 0n;
  }
  if (right < 0n) {
    left += right;
    right = 0n;
  }
  if (left < 0n) left = 0n;
  if (right < 0n) right = 0n;
  return { eqL: left, eqS: right };
}

const MULTI = "0xcA11bde05977b3631167028862bE2a173976CA11" as Hex;

async function packed(
  c: { multicall: Function; readContract: Function },
  contracts: readonly { address: Hex; abi: readonly unknown[]; functionName: string; args: readonly [bigint] }[],
) {
  if (!contracts.length) return [] as { status: "success" | "failure"; result?: readonly unknown[] }[];
  try {
    return (await c.multicall({
      contracts,
      allowFailure: true,
      multicallAddress: MULTI,
    })) as { status: "success" | "failure"; result?: readonly unknown[] }[];
  } catch {
    const rows = [];
    for (const item of contracts) {
      try {
        rows.push({ status: "success" as const, result: await c.readContract(item) });
      } catch {
        rows.push({ status: "failure" as const });
      }
    }
    return rows;
  }
}

export async function readPerp(perp: string, account: string | null): Promise<PerpView> {
  const c = await client();
  const addr = perp as Hex;
  const code = await c.getBytecode({ address: addr });
  if (!code || code === "0x") throw new Error("nochain");
  const empty = "0x0000000000000000000000000000000000000000";
  let mark = 0n;
  let min = 10n * 10n ** 18n;
  try {
    mark = await c.readContract({ address: addr, abi, functionName: "mark" });
  } catch {
    mark = 0n;
  }
  try {
    min = await c.readContract({ address: addr, abi, functionName: "MIN_MARGIN" });
  } catch {
    min = 10n * 10n ** 18n;
  }
  try {
    const nextQuote = await c.readContract({ address: addr, abi, functionName: "nextQuote" });
    const nextDeal = await c.readContract({ address: addr, abi, functionName: "nextDeal" });
    const quoteIds: bigint[] = [];
    const startQ = nextQuote > 80n ? nextQuote - 79n : 1n;
    for (let id = nextQuote; id >= startQ && id > 0n; id -= 1n) quoteIds.push(id);
    const dealIds: bigint[] = [];
    const startD = nextDeal > 48n ? nextDeal - 47n : 1n;
    for (let id = nextDeal; id >= startD && id > 0n; id -= 1n) dealIds.push(id);
    const quotePacked = await packed(c, quoteIds.map((id) => ({ address: addr, abi: quoteWideAbi, functionName: "quotes" as const, args: [id] as const })));
    const dealPacked = await packed(c, dealIds.map((id) => ({ address: addr, abi: dealWideAbi, functionName: "deals" as const, args: [id] as const })));
    const quotes: BookQuote[] = [];
    quoteIds.forEach((id, index) => {
      const row = quotePacked[index];
      if (!row || row.status !== "success" || row.result == null) return;
      const raw = row.result as {
        user?: string;
        long?: boolean;
        margin?: bigint;
        lev?: number | bigint;
        open?: boolean;
        price?: bigint;
        0?: string;
        1?: boolean;
        2?: bigint;
        3?: number | bigint;
        4?: boolean;
        5?: bigint;
      };
      const user = raw.user ?? raw[0];
      const long = Boolean(raw.long ?? raw[1]);
      const margin = raw.margin ?? raw[2] ?? 0n;
      const levRaw = raw.lev ?? raw[3] ?? 0;
      const open = Boolean(raw.open ?? raw[4]);
      const price = raw.price ?? raw[5] ?? 0n;
      if (!user || !open) return;
      quotes.push({ id, user, long, margin, lev: Number(levRaw), price });
    });
    const liveDeals: LiveDeal[] = [];
    dealIds.forEach((id, index) => {
      const row = dealPacked[index];
      if (!row || row.status !== "success" || row.result == null) return;
      const raw = row.result as {
        long?: string;
        short?: string;
        marginL?: bigint;
        marginS?: bigint;
        base?: bigint;
        entry?: bigint;
        open?: boolean;
        levL?: number | bigint;
        levS?: number | bigint;
        0?: string;
        1?: string;
        2?: bigint;
        3?: bigint;
        4?: bigint;
        5?: bigint;
        6?: boolean;
        7?: number | bigint;
        8?: number | bigint;
      };
      const long = raw.long ?? raw[0];
      const short = raw.short ?? raw[1];
      const marginL = raw.marginL ?? raw[2] ?? 0n;
      const marginS = raw.marginS ?? raw[3] ?? 0n;
      const base = raw.base ?? raw[4] ?? 0n;
      const entry = raw.entry ?? raw[5] ?? 0n;
      const open = Boolean(raw.open ?? raw[6]);
      const levL = Number(raw.levL ?? raw[7] ?? 0);
      const levS = Number(raw.levS ?? raw[8] ?? 0);
      if (!open || !long || !short) return;
      const eq = splitEquity(base, entry, mark, marginL, marginS);
      const notional = mark > 0n ? (base * mark) / 10n ** 18n : 0n;
      const weak = (eqSide: bigint, levSide: number) =>
        notional > 0n && (levSide > 0 ? eqSide * BigInt(levSide) * 2n <= notional : eqSide * 10n <= notional);
      liveDeals.push({
        id,
        long,
        short,
        marginL,
        marginS,
        base,
        entry,
        eqL: eq.eqL,
        eqS: eq.eqS,
        weakL: weak(eq.eqL, levL),
        weakS: weak(eq.eqS, levS),
        levL,
        levS,
      });
    });
    const first = liveDeals[0];
    const mine = account
      ? liveDeals.find((deal) => deal.long.toLowerCase() === account.toLowerCase() || deal.short.toLowerCase() === account.toLowerCase())
      : undefined;
    const sideLong = Boolean(mine && account && mine.long.toLowerCase() === account.toLowerCase());
    return {
      book: true,
      priced: quotes.some((quote) => quote.price > 0n) || (await c.readContract({ address: addr, abi: pricedAbi, functionName: "priced" }).catch(() => false)),
      mark,
      min,
      quotes,
      liveDeals,
      pendingUser: empty,
      pendingLong: false,
      pendingMargin: 0n,
      pendingLev: 0,
      kind: mine ? 2 : 0,
      long: sideLong,
      margin: mine ? (sideLong ? mine.marginL : mine.marginS) : 0n,
      base: mine?.base ?? 0n,
      entry: mine?.entry ?? 0n,
      equity: mine ? (sideLong ? mine.eqL : mine.eqS) : 0n,
      underwater: Boolean(mine && ((sideLong && mine.weakL) || (!sideLong && mine.weakS))),
      other: mine ? (sideLong ? mine.short : mine.long) : empty,
      dealOpen: Boolean(first),
      longAddr: first?.long ?? empty,
      shortAddr: first?.short ?? empty,
      marginL: first?.marginL ?? 0n,
      marginS: first?.marginS ?? 0n,
      dealBase: first?.base ?? 0n,
      dealEntry: first?.entry ?? 0n,
      myDeal: mine?.id ?? 0n,
    };
  } catch {
    // The contract already on chain has one shared quote, not an order book.
  }
  const pending = await c.readContract({ address: addr, abi, functionName: "pending" });
  const nextId = await c.readContract({ address: addr, abi, functionName: "nextId" });
  let found: readonly [string, string, bigint, bigint, bigint, bigint, boolean] | null = null;
  let foundId = 0n;
  for (let id = nextId; id > 0n && nextId - id < 6n; id -= 1n) {
    const row = await c.readContract({ address: addr, abi, functionName: "deals", args: [id] });
    if (row[6]) {
      found = row;
      foundId = id;
      break;
    }
  }
  const status = account
    ? await c.readContract({ address: addr, abi, functionName: "status", args: [account as Hex] })
    : ([0, false, 0n, 0n, 0n, 0n, false, empty] as const);
  return {
    book: false,
    priced: false,
    mark,
    min,
    quotes: [],
    liveDeals: [],
    pendingUser: pending[0],
    pendingLong: pending[1],
    pendingMargin: pending[2],
    pendingLev: pending[3],
    kind: status[0],
    long: status[1],
    margin: status[2],
    base: status[3],
    entry: status[4],
    equity: status[5],
    underwater: status[6],
    other: status[7],
    dealOpen: Boolean(found),
    longAddr: found ? found[0] : empty,
    shortAddr: found ? found[1] : empty,
    marginL: found ? found[2] : 0n,
    marginS: found ? found[3] : 0n,
    dealBase: found ? found[4] : 0n,
    dealEntry: found ? found[5] : 0n,
    myDeal: foundId,
  };
}

async function ensureAllowance(from: string, perp: string, amount: bigint) {
  const c = await client();
  const token = tokenAddress();
  const allowance = await c.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, perp as Hex],
  });
  const max = (1n << 256n) - 1n;
  if (allowance > max / 2n) return;
  if (allowance > 0n) {
    const reset = encodeFunctionData({ abi: erc20, functionName: "approve", args: [perp as Hex, 0n] });
    const resetHash = await send(from, token, reset);
    await (await client()).waitForTransactionReceipt({ hash: resetHash, timeout: 60_000 });
  }
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [perp as Hex, max] });
  const hash = await send(from, token, data);
  await (await client()).waitForTransactionReceipt({ hash, timeout: 60_000 });
}

async function openWouldRevert(from: string, perp: Hex, data: Hex): Promise<boolean> {
  const c = await client();
  try {
    await c.call({ account: from as Hex, to: perp, data });
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/revert|execution|Bad\(|0xe143a034/i.test(message)) return true;
    return false;
  }
}

async function sendOpen(from: string, perp: string, amount: bigint, data: Hex): Promise<Hex> {
  const c = await client();
  const token = tokenAddress();
  const allowance = await c.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, perp as Hex],
  });
  if (allowance < amount) await ensureAllowance(from, perp, amount);
  if (await openWouldRevert(from, perp as Hex, data)) {
    const held = desk === "xlayer" ? await readDeskUsdt(from) : (await readBalances(from)).usdt;
    throw new Error(held < amount ? "usdt" : "revert");
  }
  return send(from, perp as Hex, data);
}

export async function bookIsRisk(perp: string): Promise<boolean> {
  try {
    const on = await (await client()).readContract({
      address: perp as Hex,
      abi: [{ name: "riskBook", type: "function", stateMutability: "pure", inputs: [], outputs: [{ type: "bool" }] }] as const,
      functionName: "riskBook",
    });
    return Boolean(on);
  } catch {
    return false;
  }
}

async function pullMargin(from: string, perp: string, margin: string, lev: number) {
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > 1000) throw new Error("lev");
  const balances = desk === "xlayer" ? { usdt: await readDeskUsdt(from) } : await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  return amount;
}

/** Post-only on the risk book. On the live book, a crossing price is refused and the rest uses open. */
export async function openPostPerp(from: string, perp: string, long: boolean, margin: string, lev: number, price: string): Promise<Hex> {
  pinned(perp);
  const amount = await pullMargin(from, perp, margin, lev);
  const px = units(price, BSC.usdtDecimals);
  if (px < 10n ** 16n || px > 100_000n * 10n ** 18n) throw new Error("price");
  if (await bookIsRisk(perp)) {
    const data = encodeFunctionData({
      abi: [{ name: "openPost", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bool" }, { type: "uint256" }, { type: "uint16" }, { type: "uint256" }], outputs: [] }] as const,
      functionName: "openPost",
      args: [long, amount, lev, px],
    });
    return sendOpen(from, perp, amount, data);
  }
  const view = await readPerp(perp, null);
  const cross = view.quotes.some((quote) => quote.long !== long && quote.price > 0n && (long ? quote.price <= px : quote.price >= px));
  if (cross) throw new Error("cross");
  return openPerp(from, perp, long, margin, lev, price);
}

/** One transaction on the risk book. On the live book, one signature per slice. */
export async function openScalePerp(from: string, perp: string, long: boolean, margin: string, lev: number, start: string, end: string, count: number): Promise<Hex> {
  pinned(perp);
  if (count < 2 || count > 5) throw new Error("amount");
  const amount = await pullMargin(from, perp, margin, lev);
  const lo = units(start, BSC.usdtDecimals);
  const hi = units(end, BSC.usdtDecimals);
  if (await bookIsRisk(perp)) {
    const data = encodeFunctionData({
      abi: [{ name: "openScale", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bool" }, { type: "uint256" }, { type: "uint16" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }], outputs: [] }] as const,
      functionName: "openScale",
      args: [long, amount, lev, lo, hi, count],
    });
    return sendOpen(from, perp, amount, data);
  }
  const each = Number(margin) / count;
  if (!Number.isFinite(each) || each <= 0) throw new Error("amount");
  let last: Hex = "0x";
  for (let i = 0; i < count; i++) {
    const px = Number(start) + ((Number(end) - Number(start)) * i) / (count - 1);
    last = await openPerp(from, perp, long, String(each), lev, px.toFixed(4));
  }
  return last;
}

export async function openStopPerp(from: string, perp: string, long: boolean, margin: string, lev: number, trigger: string): Promise<Hex> {
  pinned(perp);
  if (!(await bookIsRisk(perp))) throw new Error("local");
  const amount = await pullMargin(from, perp, margin, lev);
  const px = units(trigger, BSC.usdtDecimals);
  if (px < 10n ** 16n || px > 100_000n * 10n ** 18n) throw new Error("price");
  const data = encodeFunctionData({
    abi: [{ name: "openStop", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bool" }, { type: "uint256" }, { type: "uint16" }, { type: "uint256" }], outputs: [] }] as const,
    functionName: "openStop",
    args: [long, amount, lev, px],
  });
  return sendOpen(from, perp, amount, data);
}

export async function openTwapPerp(from: string, perp: string, long: boolean, margin: string, lev: number, slices: number, gap: number): Promise<Hex> {
  pinned(perp);
  if (!(await bookIsRisk(perp))) throw new Error("risk");
  if (slices < 2 || slices > 12 || gap < 30) throw new Error("amount");
  const amount = await pullMargin(from, perp, margin, lev);
  const data = encodeFunctionData({
    abi: [{ name: "openTwap", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bool" }, { type: "uint256" }, { type: "uint16" }, { type: "uint8" }, { type: "uint32" }], outputs: [] }] as const,
    functionName: "openTwap",
    args: [long, amount, lev, slices, gap],
  });
  return sendOpen(from, perp, amount, data);
}

export async function armTrailPerp(from: string, perp: string, dealId: bigint, bps: number): Promise<Hex> {
  pinned(perp);
  if (!(await bookIsRisk(perp))) throw new Error("local");
  if (bps < 10 || bps > 5000) throw new Error("price");
  const data = encodeFunctionData({
    abi: [{ name: "armTrail", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint32" }], outputs: [] }] as const,
    functionName: "armTrail",
    args: [dealId, bps],
  });
  return send(from, perp as Hex, data);
}

export async function openPerp(from: string, perp: string, long: boolean, margin: string, lev: number, price: string): Promise<Hex> {
  pinned(perp);
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  const px = units(price, BSC.usdtDecimals);
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > 1000) throw new Error("lev");
  if (px < 10n ** 16n || px > 100_000n * 10n ** 18n) throw new Error("price");
  const balances = desk === "xlayer" ? { usdt: await readDeskUsdt(from) } : await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  const data = encodeFunctionData({
    abi: openAtAbi,
    functionName: "open",
    args: [long, amount, lev, px],
  });
  return sendOpen(from, perp, amount, data);
}

export async function takePerp(from: string, perp: string, quoteId: bigint, margin: string, lev: number, priced: boolean): Promise<Hex> {
  pinned(perp);
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > 1000) throw new Error("lev");
  const balances = desk === "xlayer" ? { usdt: await readDeskUsdt(from) } : await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  const data = encodeFunctionData({
    abi: priced ? takeWideAbi : abi,
    functionName: "take",
    args: [quoteId, amount, lev],
  });
  return sendOpen(from, perp, amount, data);
}

export async function cancelPerp(from: string, perp: string, quoteId?: bigint): Promise<Hex> {
  pinned(perp);
  const data =
    quoteId === undefined
      ? encodeFunctionData({ abi, functionName: "cancel" })
      : encodeFunctionData({ abi, functionName: "cancel", args: [quoteId] });
  return send(from, perp as Hex, data);
}

export async function closePerp(from: string, perp: string, dealId?: bigint): Promise<Hex> {
  pinned(perp);
  const data =
    dealId === undefined
      ? encodeFunctionData({ abi, functionName: "close" })
      : encodeFunctionData({ abi, functionName: "close", args: [dealId] });
  return send(from, perp as Hex, data);
}

export async function liquidatePerp(from: string, perp: string, id: string | bigint): Promise<Hex> {
  pinned(perp);
  const data =
    typeof id === "bigint"
      ? encodeFunctionData({ abi, functionName: "liquidate", args: [id] })
      : encodeFunctionData({ abi, functionName: "liquidate", args: [id as Hex] });
  return send(from, perp as Hex, data);
}

export function usdtText(amount: bigint): string {
  return pretty(amount, tokenDecimals(), 2);
}

export function pxText(amount: bigint): string {
  return pretty(amount, 18, 2);
}

export async function readDeskUsdt(account: string): Promise<bigint> {
  const c = await client();
  return c.readContract({ address: tokenAddress(), abi: erc20, functionName: "balanceOf", args: [account as Hex] });
}

export async function readChainPurse(which: Desk, account: string): Promise<{ gas: bigint; usdt: bigint }> {
  if (which !== "xlayer") {
    const row = await readBalances(account);
    return { gas: row.bnb, usdt: row.usdt };
  }
  const { createPublicClient, http } = await import("viem");
  const c = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 8_000 }) });
  const [gas, usdt] = await Promise.all([
    c.getBalance({ address: account as Hex }),
    c.readContract({ address: X_USDT, abi: erc20, functionName: "balanceOf", args: [account as Hex] }),
  ]);
  return { gas, usdt };
}

const slotAbi = [
  {
    name: "slot0",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint160" },
      { type: "int24" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint16" },
      { type: "uint8" },
      { type: "bool" },
    ],
  },
] as const;

const pushAbi = [
  { name: "push", type: "function", stateMutability: "nonpayable", inputs: [{ type: "int24" }], outputs: [] },
] as const;

async function bscTick(): Promise<number> {
  const { createPublicClient, http } = await import("viem");
  const c = createPublicClient({ transport: http(BSC.rpc, { timeout: 8_000 }) });
  const row = await c.readContract({ address: BSC.pool, abi: slotAbi, functionName: "slot0" });
  return row[1];
}

const pokeAbi = [
  { name: "poke", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

export async function xPoolPrice(): Promise<number> {
  const { createPublicClient, http } = await import("viem");
  const c = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 8_000 }) });
  const abi = [
    { name: "slot0", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }] },
  ] as const;
  const [bem, okb] = await Promise.all([
    c.readContract({ address: "0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A", abi, functionName: "slot0" }),
    c.readContract({ address: "0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082", abi, functionName: "slot0" }),
  ]);
  const raw = (sqrt: bigint) => (sqrt * sqrt * 10n ** 18n) / (1n << 192n);
  const bemRaw = raw(bem[0]);
  const okbRaw = raw(okb[0]);
  if (bemRaw === 0n || okbRaw === 0n) return 0;
  const usdt = (bemRaw * 100n * 10n ** 18n) / okbRaw;
  return Number(usdt) / 1e18;
}

/** The X Layer book cannot change its oracle. Anyone can poke it. After 30 quiet minutes it jumps to the pools. */
export async function pokeXMark(from: string): Promise<Hex> {
  const was = desk;
  desk = "xlayer";
  try {
    const book = bookOf("xlayer");
    const rpc = await client();
    const pool = await rpc.readContract({
      address: book as Hex,
      abi: [{ name: "pool", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const,
      functionName: "pool",
    });
    const data = encodeFunctionData({ abi: pokeAbi, functionName: "poke" });
    return send(from, pool, data, 500_000n);
  } finally {
    desk = was;
  }
}

const poolAbi = [
  { name: "pool", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

const COIN_SPEC = {
  btc: { chain: "bsc" as Desk, src: BSC.btcPool, kind: 0, quoteIsToken0: true, baseDec: 18, quoteDec: 18, lo: 1_000, hi: 100_000 },
  eth: { chain: "bsc" as Desk, src: BSC.ethPool, kind: 0, quoteIsToken0: false, baseDec: 18, quoteDec: 18, lo: 50, hi: 100_000 },
  zec: { chain: "bsc" as Desk, src: BSC.zecPool, kind: 0, quoteIsToken0: false, baseDec: 18, quoteDec: 18, lo: 20, hi: 20_000 },
  up: { chain: "bsc" as Desk, src: BSC.upWbnb, kind: 2, quoteIsToken0: true, baseDec: 18, quoteDec: 18, lo: 0.02, hi: 50 },
  tape: { chain: "xlayer" as Desk, src: TAPE_POOL, kind: 1, quoteIsToken0: false, baseDec: 8, quoteDec: 6, lo: 0.05, hi: 100 },
  fab: { chain: "xlayer" as Desk, src: FAB_QUOTER, kind: 3, quoteIsToken0: false, baseDec: 8, quoteDec: 8, lo: 0.01, hi: 50 },
};

async function readMark(which: Desk, perp: string): Promise<bigint | null> {
  try {
    const px = await (await deskClient(which)).readContract({
      address: perp as Hex,
      abi: [{ name: "mark", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
      functionName: "mark",
    });
    return px;
  } catch {
    return null;
  }
}

function markSane(coin: CoinBook, px: bigint): boolean {
  const n = Number(px) / 1e18;
  const spec = COIN_SPEC[coin];
  return n >= spec.lo && n <= spec.hi;
}

const FAB_BOOK_TOPIC = keccak256(stringToBytes("Book(address,uint256)"));

function shippedFabBook(logs: readonly { data: Hex; topics: readonly Hex[] }[]): string {
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== FAB_BOOK_TOPIC.toLowerCase()) continue;
    const indexed = log.topics[1];
    if (indexed && indexed.length === 66) return getAddress(`0x${indexed.slice(26)}`);
  }
  throw new Error("revert");
}

/** One mark and one TapeRisk book for BTC, ETH, ZEC, UP, or TAPE. Not the BEM book. */
export async function deployCoin(
  from: string,
  coin: CoinBook,
  onStep?: (step: 1 | 2 | 3) => void,
): Promise<{ book: string; hash: Hex }> {
  const spec = COIN_SPEC[coin];
  const safe = spec.chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE;
  if (from.toLowerCase() !== safe.toLowerCase() && from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const was = desk;
  desk = spec.chain;
  try {
    const have = coinBook(spec.chain, coin);
    const pending = typeof window !== "undefined" ? window.localStorage.getItem(pendingStore(spec.chain, coin)) ?? "" : "";
    const known = have || (/^0x[a-fA-F0-9]{40}$/.test(pending) ? pending : "");
    const rpc = await client();
    if (known) {
      const px = await readMark(spec.chain, known);
      if (px !== null && markSane(coin, px)) {
        window.localStorage.setItem(coinStore(spec.chain, coin), known);
        return { book: known, hash: "0x" };
      }
      const pool = await rpc.readContract({ address: known as Hex, abi: poolAbi, functionName: "pool" });
      onStep?.(1);
      const pokeHash = await send(from, pool, encodeFunctionData({ abi: pokeAbi, functionName: "poke" }), 1_200_000n);
      const again = await readMark(spec.chain, known);
      if (again !== null && markSane(coin, again)) {
        window.localStorage.setItem(coinStore(spec.chain, coin), known);
        return { book: known, hash: pokeHash };
      }
      throw new Error("price");
    }
    if (coin === "fab") {
      // The live mark staticcalls the v4 quoter, which has to write state, so poke always reverts.
      // Ship a view quoter, retarget the mark, poke, and open the book in one transaction.
      const shipArgs = encodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes" }, { type: "bytes" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
        [FAB_VIEW_QUOTER_BYTECODE, DESK_MARK_BYTECODE, RISK_BYTECODE, X_USDT, 1_000_000n, safe],
      );
      onStep?.(2);
      const bookHash = await send(from, CREATE_CALL, createCallData((FAB_PERP_SHIP_BYTECODE + shipArgs.slice(2)) as Hex), 16_000_000n);
      const book = shippedFabBook((await rpc.getTransactionReceipt({ hash: bookHash })).logs);
      window.localStorage.setItem(pendingStore(spec.chain, coin), book);
      const px = await readMark(spec.chain, book);
      if (px === null || !markSane(coin, px)) throw new Error("price");
      window.localStorage.setItem(coinStore(spec.chain, coin), book);
      return { book, hash: bookHash };
    }
    const mark = COIN_MARK[coin];
    const poked = await rpc
      .readContract({
        address: mark,
        abi: [{ name: "count", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const,
        functionName: "count",
      })
      .catch(() => 0);
    if (!poked) {
      onStep?.(1);
      await send(from, mark, encodeFunctionData({ abi: pokeAbi, functionName: "poke" }), 1_200_000n);
    }
    const bookArgs = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
      [spec.chain === "xlayer" ? X_USDT : BSC.usdt, mark as Hex, spec.chain === "xlayer" ? 1_000_000n : 10n ** 18n, safe],
    );
    onStep?.(poked ? 1 : 2);
    const bookHash = await send(from, CREATE_CALL, createCallData((RISK_BYTECODE + bookArgs.slice(2)) as Hex), 8_000_000n);
    const book = createdAddress((await rpc.getTransactionReceipt({ hash: bookHash })).logs);
    window.localStorage.setItem(pendingStore(spec.chain, coin), book);
    const px = await readMark(spec.chain, book);
    if (px === null || !markSane(coin, px)) throw new Error("price");
    window.localStorage.setItem(coinStore(spec.chain, coin), book);
    return { book, hash: bookHash };
  } finally {
    desk = was;
  }
}

/** One signature. The mark reads the official UP pool, then the book is opened on that mark. */
export async function deployUpOfficial(from: string): Promise<{ mark: string; book: string }> {
  const safe = BSC_SAFE;
  if (from.toLowerCase() !== safe.toLowerCase() && from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const was = desk;
  desk = "bsc";
  try {
    const rpc = await client();
    const args = encodeAbiParameters(
      [{ type: "bytes" }, { type: "bytes" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
      [UP_MARK_BYTECODE as Hex, RISK_BYTECODE as Hex, BSC.usdt, 10n ** 18n, safe],
    );
    const hash = await send(from, CREATE_CALL, createCallData((UP_SHIP_BYTECODE + args.slice(2)) as Hex), 14_000_000n);
    const receipt = await rpc.getTransactionReceipt({ hash });
    const topic = keccak256(stringToBytes("Book(address)"));
    const log = receipt.logs.find((row) => row.topics[0]?.toLowerCase() === topic.toLowerCase());
    const indexed = log?.topics[1];
    if (!indexed || indexed.length !== 66) throw new Error("revert");
    const book = getAddress(`0x${indexed.slice(26)}`);
    const px = await readMark("bsc", book);
    if (px === null || !markSane("up", px)) throw new Error("price");
    if (typeof window !== "undefined") window.localStorage.setItem("tl-up-official-book", book);
    const pool = await rpc.readContract({ address: book, abi: poolAbi, functionName: "pool" });
    return { mark: pool, book };
  } finally {
    desk = was;
  }
}

export async function pokeBook(from: string, perp: string): Promise<Hex> {
  pinned(perp);
  const pool = await (await client()).readContract({ address: perp as Hex, abi: poolAbi, functionName: "pool" });
  return send(from, pool, encodeFunctionData({ abi: pokeAbi, functionName: "poke" }), 1_200_000n);
}

/** New mark from the BEM/WOKB 1% pool, then a new book. The old book cannot change its mark. */
export async function shipXBook(from: string): Promise<{ mark: string; book: string }> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase() && from.toLowerCase() !== XLAYER_SAFE.toLowerCase()) throw new Error("fee");
  const was = desk;
  desk = "xlayer";
  try {
    const have = freshXBook();
    const savedMark = typeof window !== "undefined" ? window.localStorage.getItem(FRESH_X_MARK) ?? "" : "";
    if (have && (await xBookState(have)) === "ready") return { mark: savedMark, book: have };
    const rpc = await client();
    const markHash = await send(from, CREATE_CALL, createCallData(MARK_BYTECODE as Hex), 3_000_000n);
    const markReceipt = await rpc.getTransactionReceipt({ hash: markHash });
    const mark = createdAddress(markReceipt.logs);
    const poke = encodeFunctionData({ abi: pokeAbi, functionName: "poke" });
    await send(from, mark as Hex, poke, 500_000n);
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }, { type: "address" }],
      [X_USDT, mark as Hex, 1_000_000n, XLAYER_SAFE],
    );
    const bookHash = await send(from, CREATE_CALL, createCallData((RISK_BYTECODE + args.slice(2)) as Hex), 8_000_000n);
    const bookReceipt = await rpc.getTransactionReceipt({ hash: bookHash });
    const book = createdAddress(bookReceipt.logs);
    if ((await xBookState(book)) !== "ready") throw new Error("revert");
    window.localStorage.setItem(FRESH_X_MARK, mark);
    window.localStorage.setItem(FRESH_X_BOOK, book);
    return { mark, book };
  } finally {
    desk = was;
  }
}

export async function readStops(perp: string): Promise<{ id: bigint; user: string; long: boolean; margin: bigint; lev: number; trigger: bigint }[]> {
  const c = await client();
  const addr = perp as Hex;
  let next = 0n;
  try {
    next = await c.readContract({ address: addr, abi: [{ name: "nextStop", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const, functionName: "nextStop" });
  } catch {
    return [];
  }
  const stopAbi = [{ name: "stops", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }, { type: "bool" }, { type: "uint96" }, { type: "uint16" }, { type: "uint128" }, { type: "bool" }] }] as const;
  const rows = [];
  const start = next > 12n ? next - 11n : 1n;
  for (let id = next; id >= start && id > 0n; id -= 1n) {
    const row = await c.readContract({ address: addr, abi: stopAbi, functionName: "stops", args: [id] });
    if (!row[5]) continue;
    rows.push({ id, user: row[0], long: row[1], margin: row[2], lev: Number(row[3]), trigger: row[4] });
  }
  return rows;
}

export async function readTwaps(perp: string): Promise<{ id: bigint; user: string; long: boolean; each: bigint; lev: number; left: number }[]> {
  const c = await client();
  const addr = perp as Hex;
  let next = 0n;
  try {
    next = await c.readContract({ address: addr, abi: [{ name: "nextTwap", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const, functionName: "nextTwap" });
  } catch {
    return [];
  }
  const twapAbi = [{ name: "twaps", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }, { type: "bool" }, { type: "uint96" }, { type: "uint16" }, { type: "uint8" }, { type: "uint32" }, { type: "uint32" }, { type: "bool" }] }] as const;
  const rows = [];
  const start = next > 8n ? next - 7n : 1n;
  for (let id = next; id >= start && id > 0n; id -= 1n) {
    const row = await c.readContract({ address: addr, abi: twapAbi, functionName: "twaps", args: [id] });
    if (!row[7] || row[4] === 0) continue;
    rows.push({ id, user: row[0], long: row[1], each: row[2], lev: Number(row[3]), left: Number(row[4]) });
  }
  return rows;
}

async function riskCall(from: string, perp: string, name: "fireStop" | "cancelStop" | "pokeTwap" | "cancelTwap" | "pokeTrail", id: bigint): Promise<Hex> {
  pinned(perp);
  const data = encodeFunctionData({
    abi: [{ name, type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] }] as const,
    functionName: name,
    args: [id],
  });
  return send(from, perp as Hex, data);
}

export const fireStopPerp = (from: string, perp: string, id: bigint) => riskCall(from, perp, "fireStop", id);
export const cancelStopPerp = (from: string, perp: string, id: bigint) => riskCall(from, perp, "cancelStop", id);
export const pokeTwapPerp = (from: string, perp: string, id: bigint) => riskCall(from, perp, "pokeTwap", id);
export const cancelTwapPerp = (from: string, perp: string, id: bigint) => riskCall(from, perp, "cancelTwap", id);
export const pokeTrailPerp = (from: string, perp: string, id: bigint) => riskCall(from, perp, "pokeTrail", id);

export async function deployXLayer(from: string, onStep?: (step: 1 | 2 | 3) => void): Promise<string> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("oracle");
  const was = desk;
  desk = "xlayer";
  try {
    const rpc = await client();
    let mark = typeof window !== "undefined" ? window.localStorage.getItem(XBEM_MARK_KEY) ?? "" : "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(mark)) {
      onStep?.(1);
      const markHash = await send(from, undefined, MARK_BYTECODE, 6_000_000n);
      const markReceipt = await rpc.waitForTransactionReceipt({ hash: markHash, timeout: 120_000 });
      mark = markReceipt.contractAddress ?? "";
      if (markReceipt.status !== "success" || !mark) throw new Error("revert");
      window.localStorage.setItem(XBEM_MARK_KEY, mark);
    }
    onStep?.(2);
    const poke = encodeFunctionData({ abi: pokeAbi, functionName: "poke" });
    await send(from, mark as Hex, poke, 400_000n);
    const existing = typeof window !== "undefined" ? window.localStorage.getItem(XBEM_PERP_KEY) ?? "" : "";
    if (/^0x[a-fA-F0-9]{40}$/.test(existing) && (await xBookState(existing)) === "ready") return existing;
    onStep?.(3);
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [X_USDT, mark as Hex, 1_000_000n],
    );
    const data = (PERP_BYTECODE + args.slice(2)) as Hex;
    const perpHash = await send(from, undefined, data, 8_000_000n);
    const perpReceipt = await rpc.waitForTransactionReceipt({ hash: perpHash, timeout: 180_000 });
    if (perpReceipt.status !== "success" || !perpReceipt.contractAddress) throw new Error("revert");
    window.localStorage.setItem(XBEM_PERP_KEY, perpReceipt.contractAddress);
    return perpReceipt.contractAddress;
  } finally {
    desk = was;
  }
}

/** Deploy a mark that keeps the last price, then the X Layer book on it. */
export async function deployFixedX(from: string): Promise<string> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("oracle");
  const was = desk;
  desk = "xlayer";
  try {
    const rpc = await client();
    let mark = window.localStorage.getItem(XMARK_HOLD) ?? "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(mark)) {
      const markHash = await send(from, undefined, MARK_BYTECODE, 2_000_000n);
      const markReceipt = await rpc.waitForTransactionReceipt({ hash: markHash, timeout: 120_000 });
      mark = markReceipt.contractAddress ?? "";
      if (markReceipt.status !== "success" || !mark) throw new Error("revert");
      window.localStorage.setItem(XMARK_HOLD, mark);
      window.localStorage.setItem(XMARK_FIXED, mark);
    }
    const poke = encodeFunctionData({ abi: pokeAbi, functionName: "poke" });
    await send(from, mark as Hex, poke, 400_000n);
    const existing = window.localStorage.getItem(XPERP_HOLD) ?? "";
    if (/^0x[a-fA-F0-9]{40}$/.test(existing) && (await xBookState(existing)) === "ready") return existing;
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [X_USDT, mark as Hex, 1_000_000n],
    );
    const data = (PERP_BYTECODE + args.slice(2)) as Hex;
    const perpHash = await send(from, undefined, data, 8_000_000n);
    const perpReceipt = await rpc.waitForTransactionReceipt({ hash: perpHash, timeout: 180_000 });
    const perp = perpReceipt.contractAddress ?? "";
    if (perpReceipt.status !== "success" || !perp) throw new Error("revert");
    window.localStorage.setItem(XPERP_HOLD, perp);
    window.localStorage.setItem(XPERP_FIXED, perp);
    return perp;
  } finally {
    desk = was;
  }
}
export async function deployLockedPair(from: string): Promise<{ mark: string; perp: string }> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("oracle");
  const was = desk;
  desk = "xlayer";
  try {
    const rpc = await client();
    const mark = NEXT_XMARK;
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [X_USDT, mark, 1_000_000n],
    );
    const data = (PERP_BYTECODE + args.slice(2)) as Hex;
    const perpHash = await send(from, undefined, data, 3_000_000n);
    const perpReceipt = await rpc.waitForTransactionReceipt({ hash: perpHash, timeout: 120_000 });
    const perp = perpReceipt.contractAddress ?? "";
    if (perpReceipt.status !== "success" || !perp) throw new Error("revert");
    return { mark, perp };
  } finally {
    desk = was;
  }
}

const rebateAbi = [
  { name: "rebates", type: "function", stateMutability: "pure", inputs: [], outputs: [{ type: "bool" }] },
  { name: "accrued", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "referrerOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
  { name: "codeOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "bytes32" }] },
  { name: "codeOwner", type: "function", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { name: "tierSet", type: "function", stateMutability: "pure", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "register", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { name: "bind", type: "function", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { name: "claim", type: "function", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
] as const;

export function savedRebate(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(REBATE_KEY) ?? "";
}

function rebateTarget(which: Desk): { desk: Desk; addr: Hex } {
  return { desk: which, addr: bookOf(which) as Hex };
}

export async function hasRebates(which: Desk = "bsc"): Promise<boolean> {
  const target = rebateTarget(which);
  try {
    return await (await deskClient(target.desk)).readContract({ address: target.addr, abi: rebateAbi, functionName: "rebates" });
  } catch {
    return false;
  }
}

export async function readRebate(which: Desk, account: string): Promise<{ accrued: bigint; referrer: string; code: Hex }> {
  const target = rebateTarget(which);
  const c = await deskClient(target.desk);
  const [accrued, referrer, code] = await Promise.all([
    c.readContract({ address: target.addr, abi: rebateAbi, functionName: "accrued", args: [account as Hex] }),
    c.readContract({ address: target.addr, abi: rebateAbi, functionName: "referrerOf", args: [account as Hex] }),
    c.readContract({ address: target.addr, abi: rebateAbi, functionName: "codeOf", args: [account as Hex] }),
  ]);
  return { accrued, referrer, code };
}

function asCode(text: string): Hex {
  const trimmed = text.trim();
  const bytes = new TextEncoder().encode(trimmed);
  if (bytes.length < 1 || bytes.length > 16) throw new Error("code");
  const hex = `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return (hex + "0".repeat(66 - hex.length)) as Hex;
}

export async function registerCode(from: string, which: Desk, text: string): Promise<Hex> {
  const was = desk;
  const target = rebateTarget(which);
  desk = target.desk;
  try {
    const trimmed = text.trim();
    if (new TextEncoder().encode(trimmed).length < 1 || new TextEncoder().encode(trimmed).length > 16) throw new Error("code");
    const row = await readRebate(which, from);
    if (codeText(row.code)) throw new Error("have");
    const owner = await lookupCode(which, trimmed);
    if (owner && owner !== "0x0000000000000000000000000000000000000000") throw new Error("taken");
    const data = encodeFunctionData({ abi: rebateAbi, functionName: "register", args: [asCode(trimmed)] });
    return await send(from, target.addr, data);
  } finally {
    desk = was;
  }
}

export async function bindCode(from: string, which: Desk, text: string): Promise<Hex> {
  const was = desk;
  const target = rebateTarget(which);
  desk = target.desk;
  try {
    const data = encodeFunctionData({ abi: rebateAbi, functionName: "bind", args: [asCode(text)] });
    return await send(from, target.addr, data);
  } finally {
    desk = was;
  }
}

export function usdtUnits(dollars: number): bigint {
  return BigInt(dollars) * tokenUnit();
}

export async function lookupCode(which: Desk, text: string): Promise<string> {
  const target = rebateTarget(which);
  const c = await deskClient(target.desk);
  return c.readContract({ address: target.addr, abi: rebateAbi, functionName: "codeOwner", args: [asCode(text)] });
}

export async function claimTier(which: Desk = "bsc"): Promise<number> {
  const target = rebateTarget(which);
  try {
    const tier = await (await deskClient(target.desk)).readContract({ address: target.addr, abi: rebateAbi, functionName: "tierSet" });
    return Number(tier);
  } catch {
    return 1;
  }
}

export const CLAIM_STEPS = [1, 10, 20, 50, 100, 300, 500] as const;
export const OLD_CLAIM_STEPS = [1, 10, 100, 1000] as const;
export type ClaimStep = (typeof CLAIM_STEPS)[number] | (typeof OLD_CLAIM_STEPS)[number];

export async function claimRebate(from: string, which: Desk, dollars: ClaimStep): Promise<Hex> {
  const was = desk;
  const target = rebateTarget(which);
  desk = target.desk;
  try {
    const amount = usdtUnits(dollars);
    const data = encodeFunctionData({ abi: rebateAbi, functionName: "claim", args: [amount] });
    return await send(from, target.addr, data);
  } finally {
    desk = was;
  }
}

export function codeText(code: string): string {
  if (!code || /^0x0+$/i.test(code)) return "";
  const raw = code.slice(2).replace(/(00)+$/i, "");
  if (raw.length % 2 !== 0) return "";
  const bytes = raw.match(/.{2}/g)?.map((h) => Number.parseInt(h, 16)) ?? [];
  if (bytes.some((n) => Number.isNaN(n))) return "";
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}
