import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { BSC, connectBsc, FEE_TO } from "@/lib/bsc";
import { GATE as LIVE_GATE } from "@/lib/gate-chain";
import { BEM_GIFT_BYTECODE, NAND_GIFT_BYTECODE } from "@/lib/newbie-artifact";
import { KNOWN_XPERP } from "@/lib/perp";
import { getProvider } from "@/lib/wallet";
import { connectXLayer, DEPLOYED, XLAYER } from "@/lib/xlayer";

export const NAND_GIFT = "0x5374DFfD3186FfEDAC46Cc6c9545B9e9e2CEF45b" as const;
export const BEM_GIFT = "0xa29f86319E66DAdF1e30548bcC593fa91CBB7278" as const;

const nandAbi = parseAbi([
  "function balance() view returns (uint256)",
  "function mine(address) view returns (uint256)",
  "function trades(address) view returns (uint256)",
  "function claimed(address) view returns (uint256)",
  "function deposit(uint256)",
  "function withdraw(uint256)",
  "function stamp(uint256)",
  "function claim()",
]);

const bemAbi = parseAbi([
  "function balance() view returns (uint256)",
  "function mine(address) view returns (uint256)",
  "function trades(address) view returns (uint256)",
  "function claimed(address) view returns (bool)",
  "function deposit(uint256)",
  "function withdraw(uint256)",
  "function stampPerp(uint256)",
  "function stampGate(uint256)",
  "function claim()",
]);

const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);
const erc1155 = parseAbi(["function setApprovalForAll(address,bool)", "function isApprovedForAll(address,address) view returns (bool)"]);

const x = createPublicClient({ transport: http(XLAYER.rpc) });
const b = createPublicClient({ transport: http(BSC.rpc) });

export function nandGiftReady(): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(NAND_GIFT);
}

export function bemGiftReady(): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(BEM_GIFT);
}

function nandGift(): Hex {
  return NAND_GIFT;
}

function bemGift(): Hex {
  return BEM_GIFT;
}

export function giftMoved(): { nand: boolean; bem: boolean } {
  return { nand: nandGiftReady(), bem: bemGiftReady() };
}

export type GiftState = {
  nandPool: bigint;
  nandMine: bigint;
  nandTrades: bigint;
  nandClaimed: bigint;
  bemPool: bigint;
  bemMine: bigint;
  bemTrades: bigint;
  bemClaimed: boolean;
};

export async function readGift(account: string | null): Promise<GiftState> {
  const empty: GiftState = { nandPool: 0n, nandMine: 0n, nandTrades: 0n, nandClaimed: 0n, bemPool: 0n, bemMine: 0n, bemTrades: 0n, bemClaimed: false };
  if (nandGiftReady()) {
    const gift = nandGift();
    const [pool, mine, trades, claimed] = await Promise.all([
      x.readContract({ address: gift, abi: nandAbi, functionName: "balance" }),
      account ? x.readContract({ address: gift, abi: nandAbi, functionName: "mine", args: [account as Hex] }) : 0n,
      account ? x.readContract({ address: gift, abi: nandAbi, functionName: "trades", args: [account as Hex] }) : 0n,
      account ? x.readContract({ address: gift, abi: nandAbi, functionName: "claimed", args: [account as Hex] }) : 0n,
    ]);
    empty.nandPool = pool;
    empty.nandMine = mine;
    empty.nandTrades = trades;
    empty.nandClaimed = claimed;
  }
  if (bemGiftReady()) {
    const gift = bemGift();
    const [pool, mine, trades, claimed] = await Promise.all([
      b.readContract({ address: gift, abi: bemAbi, functionName: "balance" }),
      account ? b.readContract({ address: gift, abi: bemAbi, functionName: "mine", args: [account as Hex] }) : 0n,
      account ? b.readContract({ address: gift, abi: bemAbi, functionName: "trades", args: [account as Hex] }) : 0n,
      account ? b.readContract({ address: gift, abi: bemAbi, functionName: "claimed", args: [account as Hex] }) : false,
    ]);
    empty.bemPool = pool;
    empty.bemMine = mine;
    empty.bemTrades = trades;
    empty.bemClaimed = claimed;
  }
  return empty;
}

async function send(chain: "x" | "b", from: string, to: Hex | undefined, data: Hex, gas?: bigint): Promise<Hex> {
  if (chain === "x") await connectXLayer();
  else await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const tx: { from: string; to?: Hex; data: Hex; gas?: Hex } = { from, data };
  if (to) tx.to = to;
  if (gas) tx.gas = `0x${gas.toString(16)}`;
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  const client = chain === "x" ? x : b;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export async function deployNandGift(from: string): Promise<string> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const hash = await send("x", from, undefined, NAND_GIFT_BYTECODE, 3_000_000n);
  const receipt = await x.getTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("revert");
  window.localStorage.setItem("tapeliquid-nand-gift-v2", receipt.contractAddress);
  return receipt.contractAddress;
}

export async function deployBemGift(from: string): Promise<string> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const hash = await send("b", from, undefined, BEM_GIFT_BYTECODE, 3_000_000n);
  const receipt = await b.getTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("revert");
  window.localStorage.setItem("tapeliquid-bem-gift-v2", receipt.contractAddress);
  return receipt.contractAddress;
}

async function approveNand(from: string) {
  const gift = nandGift();
  const ok = await x.readContract({ address: DEPLOYED.transistors, abi: erc1155, functionName: "isApprovedForAll", args: [from as Hex, gift] });
  if (ok) return;
  await send("x", from, DEPLOYED.transistors, encodeFunctionData({ abi: erc1155, functionName: "setApprovalForAll", args: [gift, true] }));
}

async function approveBem(from: string, amount: bigint) {
  const gift = bemGift();
  const allowance = await b.readContract({ address: BSC.bem, abi: erc20, functionName: "allowance", args: [from as Hex, gift] });
  if (allowance >= amount) return;
  await send("b", from, BSC.bem, encodeFunctionData({ abi: erc20, functionName: "approve", args: [gift, amount] }));
}

export async function depositNand(from: string, amount: bigint): Promise<Hex> {
  if (amount < 1n) throw new Error("amount");
  await approveNand(from);
  const gift = nandGift();
  const data = encodeFunctionData({ abi: nandAbi, functionName: "deposit", args: [amount] });
  await x.call({ account: from as Hex, to: gift, data });
  return send("x", from, gift, data);
}

export async function withdrawNand(from: string, amount: bigint): Promise<Hex> {
  const gift = nandGift();
  const data = encodeFunctionData({ abi: nandAbi, functionName: "withdraw", args: [amount] });
  await x.call({ account: from as Hex, to: gift, data });
  return send("x", from, gift, data);
}

export async function stampNand(from: string, id: bigint): Promise<Hex> {
  const gift = nandGift();
  const data = encodeFunctionData({ abi: nandAbi, functionName: "stamp", args: [id] });
  await x.call({ account: from as Hex, to: gift, data });
  return send("x", from, gift, data);
}

export async function claimNand(from: string): Promise<Hex> {
  const gift = nandGift();
  const data = encodeFunctionData({ abi: nandAbi, functionName: "claim" });
  await x.call({ account: from as Hex, to: gift, data });
  return send("x", from, gift, data);
}

export async function depositBem(from: string, amount: bigint): Promise<Hex> {
  if (amount < 1n) throw new Error("amount");
  await approveBem(from, amount);
  const gift = bemGift();
  const data = encodeFunctionData({ abi: bemAbi, functionName: "deposit", args: [amount] });
  await b.call({ account: from as Hex, to: gift, data });
  return send("b", from, gift, data);
}

export async function withdrawBem(from: string, amount: bigint): Promise<Hex> {
  const gift = bemGift();
  const data = encodeFunctionData({ abi: bemAbi, functionName: "withdraw", args: [amount] });
  await b.call({ account: from as Hex, to: gift, data });
  return send("b", from, gift, data);
}

export async function stampBem(from: string, id: bigint, gate: boolean): Promise<Hex> {
  const gift = bemGift();
  const data = encodeFunctionData({ abi: bemAbi, functionName: gate ? "stampGate" : "stampPerp", args: [id] });
  await b.call({ account: from as Hex, to: gift, data });
  return send("b", from, gift, data);
}

export async function claimBem(from: string): Promise<Hex> {
  const gift = bemGift();
  const data = encodeFunctionData({ abi: bemAbi, functionName: "claim" });
  await b.call({ account: from as Hex, to: gift, data });
  return send("b", from, gift, data);
}

export type GiftFill = {
  id: string;
  kind: "nand" | "bem" | "gate";
  side: "long" | "short";
  margin: string;
  ok: boolean;
  open: boolean;
};

export type GiftBooks = {
  nandLive: boolean;
  gateLive: boolean;
};

export type GiftScan = {
  fills: GiftFill[];
  seen: number;
  small: number;
  books: GiftBooks;
};

const bookOfAbi = parseAbi([
  "function BOOK() view returns (address)",
  "function PERP() view returns (address)",
  "function GATE() view returns (address)",
  "function nextDeal() view returns (uint256)",
  "function nextQuote() view returns (uint256)",
  "function deals(uint256) view returns (address,address,uint96,uint96,uint128,uint128,bool,uint16,uint16)",
  "function quotes(uint256) view returns (address,bool,uint96,uint16,bool,uint128)",
]);

const gateDealAbi = parseAbi([
  "function nextDeal() view returns (uint256)",
  "function nextQuote() view returns (uint256)",
  "function deals(uint256) view returns (address,address,uint8,uint96,uint96,uint128,uint128,bool,uint16,uint16)",
  "function quotes(uint256) view returns (address,uint8,bool,uint96,uint16,bool,uint128)",
]);

function dollars(amount: bigint, decimals: number): string {
  const n = Number(amount) / 10 ** decimals;
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : amount.toString();
}

async function qualifying(
  client: typeof x,
  book: Hex,
  who: string,
  min: bigint,
  kind: GiftFill["kind"],
  gate: boolean,
): Promise<{ found: GiftFill[]; seen: number; small: number }> {
  const abi = gate ? gateDealAbi : bookOfAbi;
  let last = 0n;
  let quotes = 0n;
  try {
    [last, quotes] = await Promise.all([
      client.readContract({ address: book, abi, functionName: "nextDeal" }),
      client.readContract({ address: book, abi, functionName: "nextQuote" }),
    ]);
  } catch {
    return { found: [], seen: 0, small: 0 };
  }
  const dealIds: bigint[] = [];
  const from = last > 40n ? last - 39n : 1n;
  for (let id = from; id <= last; id += 1n) dealIds.push(id);
  const quoteFrom = quotes > 20n ? quotes - 19n : 1n;
  const quoteIds: bigint[] = [];
  for (let id = quoteFrom; id <= quotes; id += 1n) quoteIds.push(id);
  const [dealRows, quoteRows] = await Promise.all([
    Promise.all(dealIds.map(async (id) => {
      try {
        return await client.readContract({ address: book, abi, functionName: "deals", args: [id] });
      } catch {
        return null;
      }
    })),
    Promise.all(quoteIds.map(async (id) => {
      try {
        return await client.readContract({ address: book, abi, functionName: "quotes", args: [id] });
      } catch {
        return null;
      }
    })),
  ]);
  const found: GiftFill[] = [];
  let seen = 0;
  let small = 0;
  const decimals = kind === "nand" ? 6 : 18;
  for (let i = 0; i < dealIds.length; i += 1) {
    const row = dealRows[i];
    if (!row) continue;
    const long = String(row[0]).toLowerCase();
    const short = String(row[1]).toLowerCase();
    const marginL = BigInt(gate ? row[3] : row[2]);
    const marginS = BigInt(gate ? row[4] : row[3]);
    const side = long === who ? "long" : short === who ? "short" : "";
    if (!side || short === "0x0000000000000000000000000000000000000000") continue;
    const margin = side === "long" ? marginL : marginS;
    const ok = margin >= min;
    seen += 1;
    if (!ok) small += 1;
    found.push({ id: dealIds[i].toString(), kind, side, margin: dollars(margin, decimals), ok, open: false });
  }
  for (let i = 0; i < quoteIds.length; i += 1) {
    const row = quoteRows[i];
    if (!row) continue;
    const user = String(row[0]).toLowerCase();
    const live = Boolean(gate ? row[5] : row[4]);
    if (!live || user !== who) continue;
    const long = Boolean(gate ? row[2] : row[1]);
    const margin = BigInt(gate ? row[3] : row[2]);
    found.push({
      id: `q${quoteIds[i].toString()}`,
      kind,
      side: long ? "long" : "short",
      margin: dollars(margin, decimals),
      ok: false,
      open: true,
    });
  }
  return { found: found.reverse(), seen, small };
}

export async function readGiftFills(account: string): Promise<GiftScan> {
  const who = account.toLowerCase();
  const [nandBook, bemPerp, bemGate] = await Promise.all([
    x.readContract({ address: nandGift(), abi: bookOfAbi, functionName: "BOOK" }),
    b.readContract({ address: bemGift(), abi: bookOfAbi, functionName: "PERP" }),
    b.readContract({ address: bemGift(), abi: bookOfAbi, functionName: "GATE" }),
  ]);
  const [nand, bem, gate] = await Promise.all([
    qualifying(x, nandBook, who, 5_000_000n, "nand", false),
    qualifying(b, bemPerp, who, 5n * 10n ** 18n, "bem", false),
    qualifying(b, bemGate, who, 5n * 10n ** 18n, "gate", true),
  ]);
  return {
    fills: [...nand.found, ...bem.found, ...gate.found],
    seen: nand.seen + bem.seen + gate.seen,
    small: nand.small + bem.small + gate.small,
    books: {
      nandLive: nandBook.toLowerCase() === KNOWN_XPERP.toLowerCase(),
      gateLive: bemGate.toLowerCase() === LIVE_GATE.toLowerCase(),
    },
  };
}
