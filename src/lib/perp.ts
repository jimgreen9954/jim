import { encodeFunctionData, keccak256, type Hex } from "viem";
import { BSC, bscClient, connectBsc, pretty, readBalances, units, waitReceipt } from "@/lib/bsc";
import { getProvider } from "@/lib/wallet";
import { XLAYER, connectXLayer } from "@/lib/xlayer";

export const REBATE_KEY = "tapeliquid-rebate-v1";
const DESK_KEY = "tapeliquid-desk-v1";
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
export const BSC_REBATE = "0x070c66555535e1145275df54f4eEBBfd28d98581";
/** Desk book just replaced. The BSC copy vault is still bound to this address. Close only. */
export const LAST_BSC = "0x89b2f4a2e0C07864172fB47fbDEa14411AF2e0E0";
export const PREV_BSC = "0x0a81a426b29991a777e038d9e4ecce1783804aa0";
export const OLDER_BSC = "0xdA4aA9E0aaad6F91835cD19345D49a8fcA8d019A";
/** Desk book just replaced. The X Layer copy vault is still bound to this address. Close only. */
export const LAST_XPERP = "0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2";
export const KNOWN_XPERP = "0x46cBAfCA59873E7115dF7825fdBF659BafAc3a51";
export const KNOWN_XMARK = "0xb4B2ee90D10ECfC7ed36A58e96e03074fA8731Eb";
export const PREV_XPERP = "0xE8Ed0fE7a7aaEF822b2e5Ce9679ccACcF3aEFF56";
export const OLDER_XPERP = "0xCAC69F02c06bfCa3bFDb1eaF1F4a60e17e718081";
export const PREV_XMARK = "0xba5234cd46ec5eB0DFdf4ac329FF42EB3062B4eA";
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

const guardAbi = [{ name: "guard", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }] as const;

/** True when spot and the capped average are within about 3%. Null if the read failed. */
export async function markGuard(coin: "up" | "tape" | "fab"): Promise<boolean | null> {
  const which: Desk = coin === "up" ? "bsc" : "xlayer";
  const address = coin === "up" ? UP_MARK : coin === "tape" ? TAPE_MARK : FAB_MARK;
  try {
    const on = await (await deskClient(which)).readContract({
      address,
      abi: guardAbi,
      functionName: "guard",
    });
    return Boolean(on);
  } catch {
    return null;
  }
}

async function sampleCount(mark: Hex): Promise<number | null> {
  try {
    const n = await (await deskClient("xlayer")).readContract({
      address: mark,
      abi: [{ name: "count", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const,
      functionName: "count",
    });
    return Number(n);
  } catch {
    return null;
  }
}

/** TAPE opens wait until about 10 minutes of pokes are stored. 20 samples is that window. */
export async function tapeSamples(): Promise<number | null> {
  return sampleCount(TAPE_MARK);
}

/** FAB opens wait until about 10 minutes of pokes are stored. */
export async function fabSamples(): Promise<number | null> {
  return sampleCount(FAB_MARK);
}

async function tapePoolCode(): Promise<Hex | undefined> {
  const { createPublicClient, http } = await import("viem");
  for (const url of [XLAYER.rpc, "https://xlayer.drpc.org"]) {
    try {
      const code = await createPublicClient({ transport: http(url, { timeout: 8_000 }) }).getBytecode({ address: TAPE_OFFICIAL_POOL });
      if (code && code !== "0x") return code;
    } catch {
      /* the next node */
    }
  }
  return undefined;
}

function hexQty(n: bigint): Hex {
  let body = n.toString(16);
  if (body.length % 2) body = `0${body}`;
  return `0x${body}`;
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
  const gas = hexQty(gasLimit ?? (to ? 800_000n : 2_200_000n));
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
      gas,
    };
    if (to) plain.to = to;
    const hash = (await eth.request({ method: "eth_sendTransaction", params: [plain] })) as Hex;
    const receipt = await rpc.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 2_000 });
    if (receipt.status !== "success") throw new Error("revert");
    return hash;
  }
  const fee = hexQty(price * 2n);
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
    gas,
    maxFeePerGas: fee,
    maxPriorityFeePerGas: fee,
  };
  if (to) tx.to = to;
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  const receipt = await waitReceipt(hash);
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
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

export function bookOf(which: Desk = desk): string {
  if (which === "xlayer") return KNOWN_XPERP;
  return BSC_REBATE;
}

export type CoinBook = "btc" | "eth" | "zec" | "up" | "tape" | "fab";

/** Leverage the live UP and TAPE books allow for this margin. */
export function nextTierCap(margin: string, chain: Desk): number {
  const dec = chain === "xlayer" ? 6 : 18;
  const unit = chain === "xlayer" ? 1_000_000n : 10n ** 18n;
  let raw = 0n;
  try {
    raw = units(margin || "0", dec);
  } catch {
    return 50;
  }
  if (raw <= unit * 20n) return 50;
  if (raw <= unit * 100n) return 20;
  return 5;
}

/** What this margin can actually use. UP, TAPE and FAB follow the book tiers. */
export function liveLevCap(coin: string, margin = "0", chain?: Desk): number {
  if (coin === "up" || coin === "tape" || coin === "fab") return nextTierCap(margin, chain ?? (coin === "up" ? "bsc" : "xlayer"));
  return 50;
}

/** Market list. UP, TAPE and FAB are not a flat 50×. */
export function marketLev(coin: string): string {
  if (coin === "up" || coin === "tape" || coin === "fab") return "5–50×";
  return "50×";
}

export const PREV_BTC_COIN_BOOK = "0x77E6af2fb801f8A30258aB6E3fFaC8c0b53ECbd1" as Hex;
export const PREV_ETH_COIN_BOOK = "0x33Eb07D186B25243D58e72Be51859D3f5c28545F" as Hex;
export const PREV_ZEC_COIN_BOOK = "0xE1f5a45D709F6d547FcA76F2E2E7d42AfDe0bA90" as Hex;
export const PREV_UP_COIN_BOOK = "0xB3cdB968580cE0121f613886E8f86EFFcC514d70" as Hex;
export const LAST_UP_COIN_BOOK = "0xceC1334Bc30D05e3ceab6bA19a5C0915df075552" as Hex;
export const PREV_TAPE_COIN_BOOK = "0x9b17D0F6431957661AdD30051de2615cb08A3886" as Hex;
export const LAST_TAPE_COIN_BOOK = "0xd5CaE88012A443449BE3d6efCf86A245A6972a86" as Hex;
export const PREV_FAB_COIN_BOOK = "0x6Bd480BF658FaB7A2cb758c0408A7b3B5B94B431" as Hex;
export const LAST_FAB_COIN_BOOK = "0x80318c852eE7fBDe52cE439deC3AE022Ba39A536" as Hex;
export const BTC_COIN_BOOK = "0x81060936404F7984675c3928731871032b9E8eEE" as Hex;
export const ETH_COIN_BOOK = "0xB059c8951256A5eBBf9051f7d8D19AE0A1798A82" as Hex;
export const ZEC_COIN_BOOK = "0xc2D7436047ff08afB7A8aB6fFa9cDb73Bb1EDFC6" as Hex;
export const UP_COIN_BOOK = "0x53610279d1fFaF4D211E4c3988c964A9E870007F" as Hex;
export const TAPE_COIN_BOOK = "0x76FF80D56E1be05BabeD1C4ef31fb9dEfa941d22" as Hex;
export const FAB_COIN_BOOK = "0x61eb43aa602554324701cd2b551adff5b850d9cd" as Hex;
const TAPE_OFFICIAL_POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as Hex;
const TAPE_OFFICIAL_CODE = "0xf5e304a7d79711bb3c77a1380a0e2898ee40621ff46a14ad3456e205096f9fa9" as Hex;
const UP_MARK = "0x11dCaA2ee4A6F4c437B9B6B304FFBc09B768845B" as Hex;
const TAPE_MARK = "0x86fA83c53DD77F1562543B62dFf839B7BcD0Ea99" as Hex;
const FAB_MARK = "0xb9e819e6d7db7ebdc82dc04bd0d8524dc67b3fc7" as Hex;

const COIN_LIVE: Partial<Record<CoinBook, { chain: Desk; book: Hex }>> = {
  btc: { chain: "bsc", book: BTC_COIN_BOOK },
  eth: { chain: "bsc", book: ETH_COIN_BOOK },
  zec: { chain: "bsc", book: ZEC_COIN_BOOK },
  up: { chain: "bsc", book: UP_COIN_BOOK },
  tape: { chain: "xlayer", book: TAPE_COIN_BOOK },
  fab: { chain: "xlayer", book: FAB_COIN_BOOK },
};

export function coinBook(which: Desk, coin: string): string {
  const live = COIN_LIVE[coin as CoinBook];
  if (live && live.chain === which) return live.book;
  return "";
}

export function pickBook(which: Desk, coin: string): string {
  if (coin === "tape" || coin === "fab") return coinBook("xlayer", coin);
  if (coin === "btc" || coin === "eth" || coin === "zec" || coin === "up") return coinBook("bsc", coin);
  return bookOf(which);
}

function pinned(perp: string): void {
  const want = perp.toLowerCase();
  const rows = [bookOf("bsc"), bookOf("xlayer"), LAST_BSC, PREV_BSC, OLDER_BSC, LAST_XPERP, PREV_XPERP, OLDER_XPERP, coinBook("bsc", "btc"), coinBook("bsc", "eth"), coinBook("bsc", "zec"), coinBook("bsc", "up"), coinBook("xlayer", "tape"), coinBook("xlayer", "fab"), BTC_COIN_BOOK, ETH_COIN_BOOK, ZEC_COIN_BOOK, UP_COIN_BOOK, LAST_UP_COIN_BOOK, PREV_UP_COIN_BOOK, TAPE_COIN_BOOK, LAST_TAPE_COIN_BOOK, PREV_TAPE_COIN_BOOK, FAB_COIN_BOOK, LAST_FAB_COIN_BOOK, PREV_FAB_COIN_BOOK];
  if (!rows.some((row) => row.length === 42 && row.toLowerCase() === want)) throw new Error("book");
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
    ["bsc", "bem", LAST_BSC],
    ["xlayer", "bem", bookOf("xlayer")],
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
  if (allowance !== amount) {
    const grant = encodeFunctionData({
      abi: erc20,
      functionName: "approve",
      args: [perp as Hex, allowance > 0n ? 0n : amount],
    });
    await send(from, token, grant);
    throw new Error(allowance > 0n ? "clear" : "next");
  }
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

function maxLevFor(perp: string, amount: bigint): number {
  const id = perp.toLowerCase();
  const tiered = id === UP_COIN_BOOK.toLowerCase() || id === TAPE_COIN_BOOK.toLowerCase() || id === FAB_COIN_BOOK.toLowerCase();
  if (!tiered) return 50;
  const unit = id === UP_COIN_BOOK.toLowerCase() ? 10n ** 18n : 1_000_000n;
  if (amount <= unit * 20n) return 50;
  if (amount <= unit * 100n) return 20;
  return 5;
}

async function pullMargin(from: string, perp: string, margin: string, lev: number) {
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > maxLevFor(perp, amount)) throw new Error("lev");
  const balances = desk === "xlayer" ? { usdt: await readDeskUsdt(from) } : await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  return amount;
}

const bookV2Abi = [{ name: "bookV2", type: "function", stateMutability: "pure", inputs: [], outputs: [{ type: "bool" }] }] as const;

function xBemPerp(perp: string): boolean {
  if (desk !== "xlayer") return false;
  const want = perp.toLowerCase();
  for (const coin of ["tape", "fab"] as const) {
    const row = coinBook("xlayer", coin);
    if (row && row.toLowerCase() === want) return false;
  }
  return true;
}

/** Old books stay closed. Only the books pinned as live may open. */
async function assertV2(perp: string) {
  pinned(perp);
  const id = perp.toLowerCase();
  const live = [BSC_REBATE, KNOWN_XPERP, BTC_COIN_BOOK, ETH_COIN_BOOK, ZEC_COIN_BOOK, UP_COIN_BOOK, TAPE_COIN_BOOK, FAB_COIN_BOOK];
  if (!live.some((row) => row.toLowerCase() === id)) throw new Error("halt");
  if (perp.toLowerCase() === TAPE_COIN_BOOK.toLowerCase()) {
    const code = await tapePoolCode();
    if (!code || keccak256(code) !== TAPE_OFFICIAL_CODE) throw new Error("poolhash");
    const n = await tapeSamples();
    if (n === null || n < 20) throw new Error("warm");
  }
  if (perp.toLowerCase() === FAB_COIN_BOOK.toLowerCase()) {
    const n = await fabSamples();
    if (n === null || n < 20) throw new Error("warm");
    if ((await markGuard("fab")) !== true) throw new Error("gap");
  }
  const retired = perp.toLowerCase();
  if (retired === LAST_BSC.toLowerCase() || retired === PREV_BSC.toLowerCase() || retired === OLDER_BSC.toLowerCase()) throw new Error("halt");
  let fresh = false;
  try {
    fresh = Boolean(await (await client()).readContract({ address: perp as Hex, abi: bookV2Abi, functionName: "bookV2" }));
  } catch {
    fresh = false;
  }
  if (!fresh) throw new Error("halt");
  let px = 0n;
  try {
    px = await (await client()).readContract({
      address: perp as Hex,
      abi: [{ name: "mark", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }] as const,
      functionName: "mark",
    });
  } catch {
    throw new Error("warm");
  }
  if (desk === "xlayer" && xBemPerp(perp)) {
    const pool = await (await client()).readContract({ address: perp as Hex, abi: poolAbi, functionName: "pool" });
    if (pool.toLowerCase() === KNOWN_XMARK.toLowerCase()) throw new Error("stale");
    const spot = await xPoolPrice().catch(() => 0);
    const on = Number(px) / 1e18;
    if (!(spot > 0) || on <= 0 || on / spot > 1.15 || spot / on > 1.15) throw new Error("stale");
  }
}

/** Post-only on the risk book. On the live book, a crossing price is refused and the rest uses open. */
function rejectUpOpen(perp: string) {
  const id = perp.toLowerCase();
  if (id === LAST_UP_COIN_BOOK.toLowerCase() || id === PREV_UP_COIN_BOOK.toLowerCase()) throw new Error("uphalt");
  if (
    id === LAST_TAPE_COIN_BOOK.toLowerCase() ||
    id === PREV_TAPE_COIN_BOOK.toLowerCase() ||
    id === LAST_FAB_COIN_BOOK.toLowerCase() ||
    id === PREV_FAB_COIN_BOOK.toLowerCase()
  ) {
    throw new Error("tapehalt");
  }
}

export async function openPostPerp(from: string, perp: string, long: boolean, margin: string, lev: number, price: string): Promise<Hex> {
  rejectUpOpen(perp);
  await assertV2(perp);
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
  rejectUpOpen(perp);
  await assertV2(perp);
  if (count < 2 || count > 5) throw new Error("amount");
  const whole = units(margin, tokenDecimals());
  if (whole % BigInt(count) !== 0n) throw new Error("dust");
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
  rejectUpOpen(perp);
  await assertV2(perp);
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
  rejectUpOpen(perp);
  await assertV2(perp);
  if (!(await bookIsRisk(perp))) throw new Error("risk");
  if (slices < 2 || slices > 12 || gap < 30) throw new Error("amount");
  const whole = units(margin, tokenDecimals());
  if (whole % BigInt(slices) !== 0n) throw new Error("dust");
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
  rejectUpOpen(perp);
  await assertV2(perp);
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  const px = units(price, BSC.usdtDecimals);
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > maxLevFor(perp, amount)) throw new Error("lev");
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
  rejectUpOpen(perp);
  await assertV2(perp);
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > maxLevFor(perp, amount)) throw new Error("lev");
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

const poolAbi = [
  { name: "pool", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export async function pokeBook(from: string, perp: string): Promise<Hex> {
  pinned(perp);
  const pool = await (await client()).readContract({ address: perp as Hex, abi: poolAbi, functionName: "pool" });
  return send(from, pool, encodeFunctionData({ abi: pokeAbi, functionName: "poke" }), 1_200_000n);
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
