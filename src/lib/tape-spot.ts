import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseAbiItem, parseUnits, type Hex } from "viem";
import { TAPE_SPOT_BYTECODE } from "@/lib/tape-spot-artifact";
import { FEE_TO } from "@/lib/bsc";
import { TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { getProvider } from "@/lib/wallet";
import { DEPLOYED, connectXLayer, XLAYER } from "@/lib/xlayer";

/** X Layer order book. Creation bytecode matches contracts/TapeSpot.sol. No admin. */
export const TAPE_SPOT = "0x154E82c6a2ac121906D29af0EE81131E93B57860" as const;
export const SPOT_FEE = FEE_TO;

const KEY = "tapeliquid-spot";
const BLOCK_KEY = "tapeliquid-spot-block";

const takeEvent = parseAbiItem("event Take(uint64 indexed id, address indexed taker, address indexed maker, uint8 market, uint128 price, uint128 base, uint128 quote, uint128 fee)");
const abi = parseAbi([
  "function place(uint8,bool,uint128,uint128) returns (uint64)",
  "function cancel(uint64)",
  "function listCircuit(uint256,uint128)",
  "function cancelCircuit(uint256)",
  "function buyCircuit(uint256)",
  "function book(uint8,bool,uint256) view returns (uint256 count, uint128[] price, uint128[] size, uint32[] lots)",
  "function myOrders(address) view returns (uint64[] ids, uint8[] markets, bool[] bids, uint128[] prices, uint128[] lefts)",
  "function listingCount() view returns (uint256)",
  "function listings(uint256,uint256) view returns (uint256[] ids, address[] sellers, uint128[] prices)",
  "event Take(uint64 indexed id, address indexed taker, address indexed maker, uint8 market, uint128 price, uint128 base, uint128 quote, uint128 fee)",
]);
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);
const erc1155 = parseAbi([
  "function balanceOf(address,uint256) view returns (uint256)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)",
]);
const erc721 = parseAbi([
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)",
]);

const client = createPublicClient({ transport: http(XLAYER.rpc) });

export type SpotMarket = 0 | 1 | 2;

export function spotAddress(): Hex | null {
  const fixed = TAPE_SPOT as string;
  if (/^0x[a-fA-F0-9]{40}$/.test(fixed)) return fixed as Hex;
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(KEY) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved as Hex : null;
}

export async function spotReady(): Promise<boolean> {
  const spot = spotAddress();
  if (!spot) return false;
  const code = await client.getBytecode({ address: spot });
  return !!code && code !== "0x";
}

export async function rememberSpot(address: string): Promise<Hex> {
  const spot = address.trim() as Hex;
  if (!/^0x[a-fA-F0-9]{40}$/.test(spot)) throw new Error("address");
  const code = await client.getBytecode({ address: spot });
  if (!code || code === "0x") throw new Error("empty");
  await client.readContract({ address: spot, abi, functionName: "book", args: [0, true, 1n] });
  window.localStorage.setItem(KEY, spot);
  return spot;
}

export type Level = { price: bigint; size: bigint; lots: number };
export type OpenOrder = { id: bigint; market: number; bid: boolean; price: bigint; left: bigint };
export type CircuitAsk = { id: bigint; seller: string; price: bigint };
export type SpotPrint = { tx: string; market: number; price: bigint; base: bigint; quote: bigint; fee: bigint; taker: string; maker: string };
export type SpotPurse = { usdt: bigint; tape: bigint; nand: bigint; latch: bigint };

function levels(row: unknown): Level[] {
  const tuple = Array.isArray(row) ? row : null;
  const named = row as { count?: bigint; price?: readonly bigint[]; size?: readonly bigint[]; lots?: readonly number[] };
  const count = Number(tuple ? tuple[0] : named.count ?? 0);
  const price = (tuple ? tuple[1] : named.price) as readonly bigint[] | undefined;
  const size = (tuple ? tuple[2] : named.size) as readonly bigint[] | undefined;
  const lots = (tuple ? tuple[3] : named.lots) as readonly number[] | undefined;
  const out: Level[] = [];
  const n = Number.isFinite(count) ? Math.min(count, 24) : 0;
  for (let i = 0; i < n; i += 1) {
    const px = price?.[i] ?? 0n;
    const sz = size?.[i] ?? 0n;
    if (px <= 0n || sz <= 0n) continue;
    out.push({ price: px, size: sz, lots: Number(lots?.[i] ?? 0) });
  }
  return out;
}

export function spotCost(market: SpotMarket, base: bigint, price: bigint): bigint {
  if (base <= 0n || price <= 0n) return 0n;
  return market === 0 ? base * price / 100_000_000n : base * price;
}

export async function readSpotBook(market: SpotMarket): Promise<{ bids: Level[]; asks: Level[] } | null> {
  const spot = spotAddress();
  if (!spot) return null;
  const [bids, asks] = await Promise.all([
    client.readContract({ address: spot, abi, functionName: "book", args: [market, true, 24n] }),
    client.readContract({ address: spot, abi, functionName: "book", args: [market, false, 24n] }),
  ]);
  return { bids: levels(bids), asks: levels(asks) };
}

export async function readMyOrders(account: string): Promise<OpenOrder[]> {
  const spot = spotAddress();
  if (!spot) return [];
  const row = await client.readContract({ address: spot, abi, functionName: "myOrders", args: [account as Hex] });
  return row[0].map((id, i) => ({ id, market: row[1][i] ?? 0, bid: row[2][i] ?? false, price: row[3][i] ?? 0n, left: row[4][i] ?? 0n }));
}

export async function readListings(): Promise<CircuitAsk[]> {
  const spot = spotAddress();
  if (!spot) return [];
  const count = await client.readContract({ address: spot, abi, functionName: "listingCount" });
  if (count === 0n) return [];
  const n = count > 40n ? 40n : count;
  const row = await client.readContract({ address: spot, abi, functionName: "listings", args: [0n, n] });
  return row[0].map((id, i) => ({ id, seller: row[1][i] ?? "", price: row[2][i] ?? 0n }));
}

const boughtEvent = parseAbiItem("event CircuitBought(uint256 indexed id, address indexed buyer, address indexed seller, uint128 price, uint128 fee)");

export type CircuitPrint = { tx: string; id: string; buyer: string; seller: string; price: bigint; fee: bigint; ts: number };

export async function readCircuitPrints(): Promise<CircuitPrint[]> {
  const spot = spotAddress();
  if (!spot) return [];
  try {
    const tip = await client.getBlockNumber();
    const from = tip > 4_000n ? tip - 4_000n : 0n;
    const logs = await client.getLogs({ address: spot, event: boughtEvent, fromBlock: from, toBlock: tip });
    const rows = logs.slice(-24);
    const stamps = await Promise.all(rows.map((log) => (log.blockNumber == null ? 0 : client.getBlock({ blockNumber: log.blockNumber }).then((block) => Number(block.timestamp)).catch(() => 0))));
    return rows.map((log, i) => ({
      tx: log.transactionHash ?? "",
      id: (log.args.id ?? 0n).toString(),
      buyer: log.args.buyer ?? "",
      seller: log.args.seller ?? "",
      price: log.args.price ?? 0n,
      fee: log.args.fee ?? 0n,
      ts: stamps[i] ?? 0,
    })).reverse();
  } catch {
    return [];
  }
}

export async function readSpotPrints(market: SpotMarket | null): Promise<SpotPrint[]> {
  const spot = spotAddress();
  if (!spot) return [];
  const tip = await client.getBlockNumber();
  const saved = typeof window === "undefined" ? 0n : BigInt(window.localStorage.getItem(BLOCK_KEY) || "0");
  const from = saved > 0n && tip - saved < 200_000n ? saved : tip > 20_000n ? tip - 20_000n : 0n;
  const logs = await client.getLogs({ address: spot, event: takeEvent, fromBlock: from, toBlock: tip });
  return logs
    .map((log) => ({
      tx: log.transactionHash ?? "",
      market: Number(log.args.market ?? 0),
      price: log.args.price ?? 0n,
      base: log.args.base ?? 0n,
      quote: log.args.quote ?? 0n,
      fee: log.args.fee ?? 0n,
      taker: log.args.taker ?? "",
      maker: log.args.maker ?? "",
    }))
    .filter((row) => market == null || row.market === market)
    .reverse()
    .slice(0, 24);
}

export async function readSpotPurse(account: string | null): Promise<SpotPurse | null> {
  if (!account) return null;
  const who = account as Hex;
  const [usdt, tape, nand, latch] = await Promise.all([
    client.readContract({ address: TAPE_USDT, abi: erc20, functionName: "balanceOf", args: [who] }),
    client.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] }),
    client.readContract({ address: DEPLOYED.transistors, abi: erc1155, functionName: "balanceOf", args: [who, 0n] }),
    client.readContract({ address: DEPLOYED.transistors, abi: erc1155, functionName: "balanceOf", args: [who, 1n] }),
  ]);
  return { usdt, tape, nand, latch };
}

async function send(from: string, to: Hex | undefined, data: Hex): Promise<Hex> {
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const tx: { from: string; to?: Hex; data: Hex; chainId: string; gas?: Hex } = { from, data, chainId: XLAYER.hex };
  if (to) tx.to = to;
  else tx.gas = "0x4c4b40";
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

async function probe(from: string, to: Hex, data: Hex) {
  try {
    await client.call({ account: from as Hex, to, data });
  } catch (err) {
    const text = err instanceof Error ? `${err.name} ${err.message}` : "";
    if (/revert|invalid opcode|execution/i.test(text)) throw err;
  }
}

async function approveErc20(from: string, token: Hex, amount: bigint) {
  const spot = spotAddress();
  if (!spot) throw new Error("spot");
  const allowance = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, spot] });
  if (allowance >= amount) return;
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [spot, amount] });
  await probe(from, token, data);
  await send(from, token, data);
}

async function approveAll(from: string, token: Hex, kind: "wafer" | "circuit") {
  const spot = spotAddress();
  if (!spot) throw new Error("spot");
  const table = kind === "wafer" ? erc1155 : erc721;
  const ok = await client.readContract({ address: token, abi: table, functionName: "isApprovedForAll", args: [from as Hex, spot] });
  if (ok) return;
  const data = encodeFunctionData({ abi: table, functionName: "setApprovalForAll", args: [spot, true] });
  await probe(from, token, data);
  await send(from, token, data);
}

async function call(from: string, data: Hex) {
  const spot = spotAddress();
  if (!spot) throw new Error("spot");
  await probe(from, spot, data);
  return send(from, spot, data);
}

export async function deploySpot(from: string): Promise<string> {
  if (from.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("onlyfee");
  const hash = await send(from, undefined, TAPE_SPOT_BYTECODE);
  const receipt = await client.getTransactionReceipt({ hash });
  const landed = receipt.contractAddress ?? "";
  if (!landed) throw new Error("revert");
  if (TAPE_SPOT && landed.toLowerCase() !== TAPE_SPOT.toLowerCase()) throw new Error("nonce");
  window.localStorage.setItem(KEY, landed);
  window.localStorage.setItem(BLOCK_KEY, receipt.blockNumber.toString());
  return landed;
}

export function spotBase(market: SpotMarket, amount: string): bigint {
  const text = amount.trim();
  if (market === 0) {
    if (!/^\d+(\.\d{1,8})?$/.test(text)) throw new Error("amount");
    return parseUnits(text, 8);
  }
  if (!/^[1-9]\d*$/.test(text)) throw new Error("amount");
  return BigInt(text);
}

export function spotPrice(text: string): bigint {
  const raw = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) throw new Error("price");
  return parseUnits(raw, 6);
}

export async function placeSpot(from: string, market: SpotMarket, bid: boolean, price: bigint, amount: bigint) {
  const need = spotCost(market, amount, price);
  if (need * 20n / 10000n === 0n) throw new Error("fee");
  if (bid) await approveErc20(from, TAPE_USDT, need);
  else if (market === 0) await approveErc20(from, TAPE_TOKEN, amount);
  else await approveAll(from, DEPLOYED.transistors, "wafer");
  return call(from, encodeFunctionData({ abi, functionName: "place", args: [market, bid, price, amount] }));
}

export async function cancelSpot(from: string, id: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "cancel", args: [id] }));
}

export async function listSpotCircuit(from: string, id: bigint, price: bigint) {
  await approveAll(from, DEPLOYED.circuits, "circuit");
  return call(from, encodeFunctionData({ abi, functionName: "listCircuit", args: [id, price] }));
}

export async function cancelSpotCircuit(from: string, id: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "cancelCircuit", args: [id] }));
}

export async function buySpotCircuit(from: string, id: bigint, price: bigint) {
  await approveErc20(from, TAPE_USDT, price);
  return call(from, encodeFunctionData({ abi, functionName: "buyCircuit", args: [id] }));
}

export function usdtText(amount: bigint, digits = 4): string {
  const [whole, frac = ""] = formatUnits(amount, 6).split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
}

export function baseText(market: number, amount: bigint): string {
  if (market !== 0) return amount.toLocaleString("en-US");
  const [whole, frac = ""] = formatUnits(amount, 8).split(".");
  const cut = frac.slice(0, 4).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
}
