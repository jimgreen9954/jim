import { encodeAbiParameters, encodeFunctionData, formatUnits, parseAbi, parseUnits, type Hex } from "viem";
import { BSC, connectBsc, readBalances } from "@/lib/bsc";
import { GATE_BYTECODE } from "@/lib/gate-artifact";
import { getProvider } from "@/lib/wallet";

const KEY = "tapeliquid-gate-perp";
export const GATE = "0xc075443ab7ebef86fe044be2c93a4ff4376ffe0b";
const USDT = BSC.usdt;

const abi = parseAbi([
  "function nextQuote() view returns (uint256)",
  "function nextDeal() view returns (uint256)",
  "function marks(uint8) view returns (uint256)",
  "function markedAt(uint8) view returns (uint256)",
  "function quotes(uint256) view returns (address user, uint8 market, bool long, uint96 margin, uint16 lev, bool open, uint128 price)",
  "function deals(uint256) view returns (address long, address short, uint8 market, uint96 marginL, uint96 marginS, uint128 base, uint128 entry, bool open, uint16 levL, uint16 levS)",
  "function push(uint8 market, uint256 px)",
  "function open(uint8 market, bool long, uint256 margin, uint16 lev, uint256 price)",
  "function take(uint256 quoteId, uint256 margin, uint16 lev)",
  "function cancel(uint256 quoteId)",
  "function close(uint256 id)",
  "function register(bytes32 code)",
  "function bind(bytes32 code)",
  "function claim(uint256 amount)",
  "function accrued(address) view returns (uint256)",
  "function codeOf(address) view returns (bytes32)",
  "function referrerOf(address) view returns (address)",
  "function codeOwner(bytes32) view returns (address)",
]);

const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

export type ChainOrder = { id: string; market: number; user: string; long: boolean; price: number; margin: number; lev: number };
export type ChainDeal = { id: string; market: number; longUser: string; shortUser: string; entry: number; marginL: number; marginS: number; base: number; levL: number; levS: number };

export function gateAddress(): string {
  return GATE;
}

function priceWei(price: number): bigint {
  if (!(price > 0)) throw new Error("price");
  return parseUnits(price.toFixed(18), 18);
}

async function client() {
  const { createPublicClient, http } = await import("viem");
  return createPublicClient({ transport: http(BSC.rpc) });
}

async function send(from: string, to: Hex | undefined, data: Hex, gasLimit: bigint): Promise<Hex> {
  await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const rpc = await client();
  let price = 50_000_000n;
  try {
    price = await rpc.getGasPrice();
  } catch {
    price = 50_000_000n;
  }
  if (price < 50_000_000n) price = 50_000_000n;
  const fee = `0x${(price * 2n).toString(16)}` as Hex;
  const tx: Record<string, string> = {
    from,
    data,
    value: "0x0",
    chainId: BSC.hex,
    gas: `0x${gasLimit.toString(16)}`,
    maxFeePerGas: fee,
    maxPriorityFeePerGas: fee,
  };
  if (to) tx.to = to;
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  const receipt = await rpc.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export async function deployGate(from: string): Promise<string> {
  const args = encodeAbiParameters([{ type: "address" }], [USDT]);
  const data = (GATE_BYTECODE + args.slice(2)) as Hex;
  const hash = await send(from, undefined, data, 6_000_000n);
  const receipt = await (await client()).getTransactionReceipt({ hash });
  const addr = receipt.contractAddress ?? "";
  if (!addr) throw new Error("revert");
  window.localStorage.setItem(KEY, addr);
  return addr;
}

async function approve(from: string, perp: string, amount: bigint) {
  const c = await client();
  const allowance = await c.readContract({ address: USDT, abi: erc20, functionName: "allowance", args: [from as Hex, perp as Hex] });
  if (allowance >= amount) return;
  if (allowance > 0n) {
    const reset = encodeFunctionData({ abi: erc20, functionName: "approve", args: [perp as Hex, 0n] });
    await send(from, USDT, reset, 80_000n);
  }
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [perp as Hex, amount] });
  await send(from, USDT, data, 80_000n);
}

function diverge(stored: number, official: number): boolean {
  if (!(official > 0) || !(stored > 0)) return true;
  const ratio = stored / official;
  return ratio < 0.97 || ratio > 1.03;
}

export async function gateMark(perp: string, market: number): Promise<number> {
  const c = await client();
  const prev = await c.readContract({ address: perp as Hex, abi, functionName: "marks", args: [market] });
  return Number(formatUnits(prev, 18));
}

async function alignMark(from: string, perp: string, market: number, official: number) {
  if (!(official > 0)) throw new Error("mark");
  const stored = await gateMark(perp, market);
  if (diverge(stored, official)) await pushMark(from, perp, market, official);
  const next = await gateMark(perp, market);
  if (diverge(next, official)) throw new Error("mark");
}

export async function pushMark(from: string, perp: string, market: number, price: number) {
  const c = await client();
  const [prev, at] = await Promise.all([
    c.readContract({ address: perp as Hex, abi, functionName: "marks", args: [market] }),
    c.readContract({ address: perp as Hex, abi, functionName: "markedAt", args: [market] }),
  ]);
  const px = priceWei(price);
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (prev !== 0n && now < at + 10n) return;
  if (prev !== 0n && (px * 2n > prev * 3n || prev * 2n > px * 3n)) return;
  const data = encodeFunctionData({ abi, functionName: "push", args: [market, px] });
  await send(from, perp as Hex, data, 120_000n);
}

export async function openGate(from: string, perp: string, market: number, long: boolean, margin: string, lev: number, limit: number, mark: number) {
  const amount = parseUnits(margin, 18);
  if (amount < parseUnits("1", 18) || amount > parseUnits("500", 18)) throw new Error("margin");
  const balances = await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  await alignMark(from, perp, market, mark);
  await approve(from, perp, amount);
  const px = priceWei(limit);
  const data = encodeFunctionData({ abi, functionName: "open", args: [market, long, amount, lev, px] });
  return send(from, perp as Hex, data, 350_000n);
}

export async function takeGateChain(from: string, perp: string, id: bigint, margin: string, lev: number, market: number, official: number) {
  const amount = parseUnits(margin, 18);
  if (amount < parseUnits("1", 18)) throw new Error("margin");
  const balances = await readBalances(from);
  if (balances.usdt < amount) throw new Error("usdt");
  await alignMark(from, perp, market, official);
  await approve(from, perp, amount);
  const data = encodeFunctionData({ abi, functionName: "take", args: [id, amount, lev] });
  return send(from, perp as Hex, data, 400_000n);
}

export async function cancelGateChain(from: string, perp: string, id: bigint) {
  const data = encodeFunctionData({ abi, functionName: "cancel", args: [id] });
  return send(from, perp as Hex, data, 200_000n);
}

export async function closeGateChain(from: string, perp: string, id: bigint, market: number, official: number) {
  await alignMark(from, perp, market, official);
  const data = encodeFunctionData({ abi, functionName: "close", args: [id] });
  return send(from, perp as Hex, data, 250_000n);
}

function asCode(text: string): Hex {
  const bytes = new TextEncoder().encode(text.trim());
  if (bytes.length < 1 || bytes.length > 16) throw new Error("code");
  const hex = `0x${Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  return (hex + "0".repeat(66 - hex.length)) as Hex;
}

export async function registerGate(from: string, text: string) {
  const data = encodeFunctionData({ abi, functionName: "register", args: [asCode(text)] });
  return send(from, GATE as Hex, data, 150_000n);
}

export async function bindGate(from: string, text: string) {
  const data = encodeFunctionData({ abi, functionName: "bind", args: [asCode(text)] });
  return send(from, GATE as Hex, data, 120_000n);
}

export async function claimGate(from: string, amount: bigint) {
  const data = encodeFunctionData({ abi, functionName: "claim", args: [amount] });
  return send(from, GATE as Hex, data, 180_000n);
}

export async function readGateRebate(account: string): Promise<{ accrued: number; code: string; referrer: string }> {
  const c = await client();
  const [accrued, code, referrer] = await Promise.all([
    c.readContract({ address: GATE as Hex, abi, functionName: "accrued", args: [account as Hex] }),
    c.readContract({ address: GATE as Hex, abi, functionName: "codeOf", args: [account as Hex] }),
    c.readContract({ address: GATE as Hex, abi, functionName: "referrerOf", args: [account as Hex] }),
  ]);
  const raw = code.replace(/^0x/, "").replace(/(00)+$/, "");
  const text = raw ? new TextDecoder().decode(Uint8Array.from(raw.match(/.{2}/g)?.map((b) => Number.parseInt(b, 16)) ?? [])) : "";
  return { accrued: num(accrued), code: text, referrer };
}

function num(value: bigint): number {
  return Number(formatUnits(value, 18));
}

export async function readGateChain(perp: string): Promise<{ orders: ChainOrder[]; deals: ChainDeal[] }> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) return { orders: [], deals: [] };
  const c = await client();
  const [quotes, deals] = await Promise.all([
    c.readContract({ address: perp as Hex, abi, functionName: "nextQuote" }),
    c.readContract({ address: perp as Hex, abi, functionName: "nextDeal" }),
  ]);
  const orders: ChainOrder[] = [];
  const startQ = quotes > 40n ? quotes - 40n : 0n;
  for (let id = quotes; id > startQ; id--) {
    const row = await c.readContract({ address: perp as Hex, abi, functionName: "quotes", args: [id] });
    if (!row[5]) continue;
    orders.push({ id: id.toString(), market: row[1], user: row[0], long: row[2], margin: num(row[3]), lev: row[4], price: num(row[6]) });
  }
  const live: ChainDeal[] = [];
  const startD = deals > 40n ? deals - 40n : 0n;
  for (let id = deals; id > startD; id--) {
    const row = await c.readContract({ address: perp as Hex, abi, functionName: "deals", args: [id] });
    if (!row[7]) continue;
    live.push({
      id: id.toString(),
      longUser: row[0],
      shortUser: row[1],
      market: row[2],
      marginL: num(row[3]),
      marginS: num(row[4]),
      base: num(row[5]),
      entry: num(row[6]),
      levL: row[8],
      levS: row[9],
    });
  }
  return { orders, deals: live };
}
