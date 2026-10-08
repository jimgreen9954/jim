import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { BSC, connectBsc, FEE_TO } from "@/lib/bsc";
import { BEM_GIFT_BYTECODE, NAND_GIFT_BYTECODE } from "@/lib/newbie-artifact";
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
  return NAND_GIFT as Hex;
}

function bemGift(): Hex {
  if (!bemGiftReady()) throw new Error("nodeploy");
  return BEM_GIFT as Hex;
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
  return receipt.contractAddress;
}

export async function deployBemGift(from: string): Promise<string> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const hash = await send("b", from, undefined, BEM_GIFT_BYTECODE, 3_000_000n);
  const receipt = await b.getTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("revert");
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
