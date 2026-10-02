import { encodeAbiParameters, encodeFunctionData, type Hex } from "viem";
import { BSC, connectBsc, pretty, readBalances, units, waitReceipt } from "@/lib/bsc";
import { PERP_BYTECODE } from "@/lib/perp-artifact";
import { MARK_BYTECODE } from "@/lib/mark-artifact";
import { getProvider } from "@/lib/wallet";
import { XLAYER, connectXLayer } from "@/lib/xlayer";

export const PERP_KEY = "tapeliquid-perp-v1";
const TX_KEY = "tapeliquid-perp-tx";
export const REBATE_KEY = "tapeliquid-rebate-v1";
const DESK_KEY = "tapeliquid-desk-v1";
const XPERP_KEY = "tapeliquid-xperp-v1";
const XMARK_KEY = "tapeliquid-xmark-v1";
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
export const KNOWN_XPERP = "0xa0344f5B0518D31B7CFa6CaC266b4eDd289821ce";
export const KNOWN_XMARK = "0xc35C8cB9FFaC92F25cAFaEdC82F03144b24bCb1d";
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

async function client() {
  const { createPublicClient, http } = await import("viem");
  const rpc = desk === "xlayer" ? XLAYER.rpc : BSC.rpc;
  return createPublicClient({ transport: http(rpc) });
}

async function send(from: string, to: Hex | undefined, data: Hex): Promise<Hex> {
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
  const gas = (to ? 800_000n : 2_200_000n).toString(16);
  if (desk === "xlayer") {
    const plain: {
      from: string;
      data: Hex;
      value: "0x0";
      chainId: string;
      gas: string;
      to?: Hex;
    } = {
      from,
      data,
      value: "0x0",
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
    value: "0x0";
    chainId: string;
    gas: string;
    maxFeePerGas: Hex;
    maxPriorityFeePerGas: Hex;
    to?: Hex;
  } = {
    from,
    data,
    value: "0x0",
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

export function bookOf(which: Desk = desk): string {
  if (which !== "xlayer") return KNOWN_PERP;
  return /^0x[a-fA-F0-9]{40}$/.test(KNOWN_XPERP) ? KNOWN_XPERP : savedXPerp();
}

export async function activeBook(): Promise<string> {
  return bookOf();
}

export async function readBoard(): Promise<{ perp: string; quote: BookQuote }[]> {
  const addr = bookOf();
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return [];
  try {
    const view = await readPerp(addr, null);
    return view.quotes.map((quote) => ({ perp: addr, quote }));
  } catch {
    return [];
  }
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
    const quotes: BookQuote[] = [];
    const startQ = nextQuote > 24n ? nextQuote - 23n : 1n;
    for (let id = nextQuote; id >= startQ && id > 0n; id -= 1n) {
      let user = empty;
      let long = false;
      let margin = 0n;
      let lev = 0;
      let open = false;
      let price = 0n;
      try {
        const row = await c.readContract({ address: addr, abi: quoteWideAbi, functionName: "quotes", args: [id] });
        user = row[0];
        long = row[1];
        margin = row[2];
        lev = Number(row[3]);
        open = row[4];
        price = row[5];
      } catch {
        const row = await c.readContract({ address: addr, abi, functionName: "quotes", args: [id] });
        user = row[0];
        long = row[1];
        margin = row[2];
        lev = Number(row[3]);
        open = row[4];
      }
      if (!open) continue;
      quotes.push({ id, user, long, margin, lev, price });
    }
    const liveDeals: LiveDeal[] = [];
    const startD = nextDeal > 16n ? nextDeal - 15n : 1n;
    for (let id = nextDeal; id >= startD && id > 0n; id -= 1n) {
      let long = empty;
      let short = empty;
      let marginL = 0n;
      let marginS = 0n;
      let base = 0n;
      let entry = 0n;
      let open = false;
      let levL = 0;
      let levS = 0;
      try {
        const wide = await c.readContract({ address: addr, abi: dealWideAbi, functionName: "deals", args: [id] });
        long = wide[0];
        short = wide[1];
        marginL = wide[2];
        marginS = wide[3];
        base = wide[4];
        entry = wide[5];
        open = wide[6];
        levL = Number(wide[7]);
        levS = Number(wide[8]);
      } catch {
        const row = await c.readContract({ address: addr, abi, functionName: "deals", args: [id] });
        long = row[0];
        short = row[1];
        marginL = row[2];
        marginS = row[3];
        base = row[4];
        entry = row[5];
        open = row[6];
      }
      if (!open) continue;
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
      });
    }
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
    };
  } catch {
    // The contract already on chain has one shared quote, not an order book.
  }
  const pending = await c.readContract({ address: addr, abi, functionName: "pending" });
  const nextId = await c.readContract({ address: addr, abi, functionName: "nextId" });
  let found: readonly [string, string, bigint, bigint, bigint, bigint, boolean] | null = null;
  for (let id = nextId; id > 0n && nextId - id < 6n; id -= 1n) {
    const row = await c.readContract({ address: addr, abi, functionName: "deals", args: [id] });
    if (row[6]) {
      found = row;
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
  if (allowance >= amount) return;
  if (allowance > 0n) {
    const reset = encodeFunctionData({ abi: erc20, functionName: "approve", args: [perp as Hex, 0n] });
    const resetHash = await send(from, token, reset);
    if (desk === "bsc") await waitReceipt(resetHash);
  }
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [perp as Hex, amount] });
  const hash = await send(from, token, data);
  if (desk === "bsc") await waitReceipt(hash);
}

export async function openPerp(from: string, perp: string, long: boolean, margin: string, lev: number, price: string): Promise<Hex> {
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  const px = units(price, BSC.usdtDecimals);
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > 1000) throw new Error("lev");
  if (px < 10n ** 16n || px > 100_000n * 10n ** 18n) throw new Error("price");
  const balances = desk === "xlayer" ? { usdt: await readDeskUsdt(from) } : await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  await ensureAllowance(from, perp, amount);
  const data = encodeFunctionData({
    abi: openAtAbi,
    functionName: "open",
    args: [long, amount, lev, px],
  });
  return send(from, perp as Hex, data);
}

export async function takePerp(from: string, perp: string, quoteId: bigint, margin: string, lev: number, priced: boolean): Promise<Hex> {
  const unit = tokenUnit();
  const amount = units(margin, tokenDecimals());
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  if (lev < 1 || lev > 1000) throw new Error("lev");
  const balances = desk === "xlayer" ? { usdt: await readDeskUsdt(from) } : await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  await ensureAllowance(from, perp, amount);
  const data = encodeFunctionData({
    abi: priced ? takeWideAbi : abi,
    functionName: "take",
    args: [quoteId, amount, lev],
  });
  return send(from, perp as Hex, data);
}

export async function cancelPerp(from: string, perp: string, quoteId?: bigint): Promise<Hex> {
  const data =
    quoteId === undefined
      ? encodeFunctionData({ abi, functionName: "cancel" })
      : encodeFunctionData({ abi, functionName: "cancel", args: [quoteId] });
  return send(from, perp as Hex, data);
}

export async function closePerp(from: string, perp: string, dealId?: bigint): Promise<Hex> {
  const data =
    dealId === undefined
      ? encodeFunctionData({ abi, functionName: "close" })
      : encodeFunctionData({ abi, functionName: "close", args: [dealId] });
  return send(from, perp as Hex, data);
}

export async function liquidatePerp(from: string, perp: string, id: string | bigint): Promise<Hex> {
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
  const { createPublicClient, http } = await import("viem");
  const rpc = which === "xlayer" ? XLAYER.rpc : BSC.rpc;
  const c = createPublicClient({ transport: http(rpc) });
  const token = which === "xlayer" ? X_USDT : BSC.usdt;
  const [gas, usdt] = await Promise.all([
    c.getBalance({ address: account as Hex }),
    c.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account as Hex] }),
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
  const c = createPublicClient({ transport: http(BSC.rpc) });
  const row = await c.readContract({ address: BSC.pool, abi: slotAbi, functionName: "slot0" });
  return row[1];
}

export async function pushMark(from: string): Promise<void> {
  const saved = typeof window !== "undefined" ? window.localStorage.getItem(XMARK_KEY) ?? "" : "";
  const mark = /^0x[a-fA-F0-9]{40}$/.test(KNOWN_XMARK) ? KNOWN_XMARK : saved;
  if (!/^0x[a-fA-F0-9]{40}$/.test(mark)) return;
  const was = desk;
  desk = "xlayer";
  try {
    const tick = await bscTick();
    const data = encodeFunctionData({ abi: pushAbi, functionName: "push", args: [tick] });
    await send(from, mark as Hex, data);
  } catch {
    desk = was;
    return;
  }
  desk = was;
}

export async function deployXLayer(from: string, onStep?: (step: 1 | 2 | 3) => void): Promise<string> {
  const was = desk;
  desk = "xlayer";
  try {
    const rpc = await client();
    let mark = typeof window !== "undefined" ? window.localStorage.getItem(XMARK_KEY) ?? "" : "";
    const fresh = !/^0x[a-fA-F0-9]{40}$/.test(mark);
    if (!/^0x[a-fA-F0-9]{40}$/.test(mark)) {
      onStep?.(1);
      const markHash = await send(from, undefined, MARK_BYTECODE);
      const markReceipt = await rpc.waitForTransactionReceipt({ hash: markHash, timeout: 90_000 });
      mark = markReceipt.contractAddress ?? "";
      if (!mark) throw new Error("revert");
      window.localStorage.setItem(XMARK_KEY, mark);
    }
    onStep?.(2);
    try {
      const tick = await bscTick();
      const push = encodeFunctionData({ abi: pushAbi, functionName: "push", args: [tick] });
      await send(from, mark as Hex, push);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (fresh || message !== "revert") throw err;
    }
    const existing = savedXPerp();
    if (/^0x[a-fA-F0-9]{40}$/.test(existing)) return existing;
    onStep?.(3);
    const args = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint256" }],
      [X_USDT, mark as Hex, 1_000_000n],
    );
    const data = (PERP_BYTECODE + args.slice(2)) as Hex;
    const perpHash = await send(from, undefined, data);
    const perpReceipt = await rpc.waitForTransactionReceipt({ hash: perpHash, timeout: 90_000 });
    if (perpReceipt.status !== "success" || !perpReceipt.contractAddress) throw new Error("revert");
    window.localStorage.setItem(XPERP_KEY, perpReceipt.contractAddress);
    return perpReceipt.contractAddress;
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

export async function hasRebates(addr: string): Promise<boolean> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return false;
  try {
    return await (await client()).readContract({ address: addr as Hex, abi: rebateAbi, functionName: "rebates" });
  } catch {
    return false;
  }
}

export async function readRebate(addr: string, account: string): Promise<{ accrued: bigint; referrer: string; code: Hex }> {
  const c = await client();
  const [accrued, referrer, code] = await Promise.all([
    c.readContract({ address: addr as Hex, abi: rebateAbi, functionName: "accrued", args: [account as Hex] }),
    c.readContract({ address: addr as Hex, abi: rebateAbi, functionName: "referrerOf", args: [account as Hex] }),
    c.readContract({ address: addr as Hex, abi: rebateAbi, functionName: "codeOf", args: [account as Hex] }),
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

export async function registerCode(from: string, perp: string, text: string): Promise<Hex> {
  const data = encodeFunctionData({ abi: rebateAbi, functionName: "register", args: [asCode(text)] });
  return send(from, perp as Hex, data);
}

export async function bindCode(from: string, perp: string, text: string): Promise<Hex> {
  const data = encodeFunctionData({ abi: rebateAbi, functionName: "bind", args: [asCode(text)] });
  return send(from, perp as Hex, data);
}

export function usdtUnits(dollars: number): bigint {
  return BigInt(dollars) * tokenUnit();
}

export async function lookupCode(perp: string, text: string): Promise<string> {
  const c = await client();
  return c.readContract({ address: perp as Hex, abi: rebateAbi, functionName: "codeOwner", args: [asCode(text)] });
}

export async function claimTier(addr: string): Promise<number> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return 1;
  try {
    const tier = await (await client()).readContract({ address: addr as Hex, abi: rebateAbi, functionName: "tierSet" });
    return Number(tier);
  } catch {
    return 1;
  }
}

export const CLAIM_STEPS = [1, 10, 20, 50, 100, 300, 500] as const;
export const OLD_CLAIM_STEPS = [1, 10, 100, 1000] as const;
export type ClaimStep = (typeof CLAIM_STEPS)[number] | (typeof OLD_CLAIM_STEPS)[number];

export async function claimRebate(from: string, perp: string, dollars: ClaimStep): Promise<Hex> {
  const amount = usdtUnits(dollars);
  const data = encodeFunctionData({ abi: rebateAbi, functionName: "claim", args: [amount] });
  return send(from, perp as Hex, data);
}

export { readBalances };
