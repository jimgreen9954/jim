import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { BSC, connectBsc, FEE_TO } from "@/lib/bsc";
import { GATE as LIVE_GATE } from "@/lib/gate-chain";
import { BEM_GIFT_BYTECODE, NAND_GIFT_BYTECODE } from "@/lib/newbie-artifact";
import { KNOWN_XPERP } from "@/lib/perp";
import { getProvider } from "@/lib/wallet";
import { connectXLayer, DEPLOYED, XLAYER } from "@/lib/xlayer";

export const NAND_GIFT = "0xfb05bf0472ab9c27b063b314a704516b086ea7d3" as const;
export const BEM_GIFT = "0xcac69f02c06bfca3bfdb1eaf1f4a60e17e718081" as const;

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
  if (!nandGiftReady()) throw new Error("nodeploy");
  return activeGift("tapeliquid-nand-gift", NAND_GIFT);
}

function bemGift(): Hex {
  if (!bemGiftReady()) throw new Error("nodeploy");
  return activeGift("tapeliquid-bem-gift", BEM_GIFT);
}

export function giftMoved(): { nand: boolean; bem: boolean } {
  if (typeof window === "undefined") return { nand: false, bem: false };
  const ok = (key: string) => /^0x[a-fA-F0-9]{40}$/.test(window.localStorage.getItem(key) ?? "");
  return { nand: ok("tapeliquid-nand-gift"), bem: ok("tapeliquid-bem-gift") };
}

function activeGift(key: string, fallback: string): Hex {
  if (typeof window === "undefined") return fallback as Hex;
  const saved = window.localStorage.getItem(key) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved as Hex : fallback as Hex;
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
  window.localStorage.setItem("tapeliquid-nand-gift", receipt.contractAddress);
  return receipt.contractAddress;
}

export async function deployBemGift(from: string): Promise<string> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const hash = await send("b", from, undefined, BEM_GIFT_BYTECODE, 3_000_000n);
  const receipt = await b.getTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("revert");
  window.localStorage.setItem("tapeliquid-bem-gift", receipt.contractAddress);
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
};

export type GiftBooks = {
  nandLive: boolean;
  gateLive: boolean;
};

const bookOfAbi = parseAbi([
  "function BOOK() view returns (address)",
  "function PERP() view returns (address)",
  "function GATE() view returns (address)",
  "function nextDeal() view returns (uint256)",
  "function deals(uint256) view returns (address,address,uint96,uint96,uint128,uint128,bool,uint16,uint16)",
]);

const gateDealAbi = parseAbi([
  "function nextDeal() view returns (uint256)",
  "function deals(uint256) view returns (address,address,uint8,uint96,uint96,uint128,uint128,bool,uint16,uint16)",
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
  gift: Hex,
  from: string,
): Promise<GiftFill[]> {
  const abi = gate ? gateDealAbi : bookOfAbi;
  let last = 0n;
  try {
    last = await client.readContract({ address: book, abi, functionName: "nextDeal" });
  } catch {
    return [];
  }
  if (last < 1n) return [];
  const start = last > 40n ? last - 39n : 1n;
  const ids: bigint[] = [];
  for (let id = start; id <= last; id += 1n) ids.push(id);
  const rows = await client.multicall({
    contracts: ids.map((id) => ({ address: book, abi, functionName: "deals" as const, args: [id] as const })),
    allowFailure: true,
  });
  const found: GiftFill[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const row = rows[i];
    if (!row || row.status !== "success" || !Array.isArray(row.result)) continue;
    const long = String(row.result[0]).toLowerCase();
    const short = String(row.result[1]).toLowerCase();
    const marginL = BigInt(gate ? row.result[3] : row.result[2]);
    const marginS = BigInt(gate ? row.result[4] : row.result[3]);
    const side = long === who ? "long" : short === who ? "short" : "";
    const margin = side === "long" ? marginL : marginS;
    if (!side || margin < min) continue;
    const data = encodeFunctionData({
      abi: kind === "nand" ? nandAbi : bemAbi,
      functionName: kind === "nand" ? "stamp" : kind === "gate" ? "stampGate" : "stampPerp",
      args: [ids[i]],
    });
    try {
      await client.call({ account: from as Hex, to: gift, data });
    } catch {
      continue;
    }
    found.push({ id: ids[i].toString(), kind, side, margin: dollars(margin, kind === "nand" ? 6 : 18) });
  }
  return found.reverse();
}

export async function readGiftFills(account: string): Promise<{ fills: GiftFill[]; books: GiftBooks }> {
  const who = account.toLowerCase();
  const [nandBook, bemPerp, bemGate] = await Promise.all([
    x.readContract({ address: nandGift(), abi: bookOfAbi, functionName: "BOOK" }),
    b.readContract({ address: bemGift(), abi: bookOfAbi, functionName: "PERP" }),
    b.readContract({ address: bemGift(), abi: bookOfAbi, functionName: "GATE" }),
  ]);
  const [nand, bem, gate] = await Promise.all([
    qualifying(x, nandBook, who, 5_000_000n, "nand", false, nandGift(), account),
    qualifying(b, bemPerp, who, 5n * 10n ** 18n, "bem", false, bemGift(), account),
    qualifying(b, bemGate, who, 5n * 10n ** 18n, "gate", true, bemGift(), account),
  ]);
  return {
    fills: [...nand, ...bem, ...gate],
    books: {
      nandLive: nandBook.toLowerCase() === KNOWN_XPERP.toLowerCase(),
      gateLive: bemGate.toLowerCase() === LIVE_GATE.toLowerCase(),
    },
  };
}
