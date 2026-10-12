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

const PRINT_KEY = "tapeliquid-spot-prints-v2";
const LOG_SPAN = 100n;

type PrintWire = { tx: string; market: number; price: string; base: string; quote: string; fee: string; taker: string; maker: string };
type PrintCache = { born: string; tip: string; rows: PrintWire[] };

let printMemory: { born: bigint; tip: bigint; rows: SpotPrint[] } | null = null;
let printFlight: Promise<void> | null = null;

function packPrint(row: SpotPrint): PrintWire {
  return { tx: row.tx, market: row.market, price: row.price.toString(), base: row.base.toString(), quote: row.quote.toString(), fee: row.fee.toString(), taker: row.taker, maker: row.maker };
}

function unpackPrint(row: PrintWire): SpotPrint {
  return { tx: row.tx, market: row.market, price: BigInt(row.price), base: BigInt(row.base), quote: BigInt(row.quote), fee: BigInt(row.fee), taker: row.taker, maker: row.maker };
}

function printKey(row: SpotPrint): string {
  return `${row.tx}:${row.market}:${row.price}:${row.base}:${row.quote}`;
}

function readPrintCache(): { born: bigint; tip: bigint; rows: SpotPrint[] } | null {
  if (printMemory) return printMemory;
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(PRINT_KEY) ?? "") as PrintCache;
    if (!saved || !Array.isArray(saved.rows)) return null;
    printMemory = { born: BigInt(saved.born), tip: BigInt(saved.tip), rows: saved.rows.map(unpackPrint) };
    return printMemory;
  } catch {
    return null;
  }
}

function writePrintCache(born: bigint, tip: bigint, rows: SpotPrint[]) {
  printMemory = { born, tip, rows };
  if (typeof window === "undefined") return;
  try {
    const body: PrintCache = { born: born.toString(), tip: tip.toString(), rows: rows.map(packPrint) };
    window.localStorage.setItem(PRINT_KEY, JSON.stringify(body));
  } catch {
    /* The tape viewer has no storage. The list still stays for this open. */
  }
}

async function findSpotBirth(spot: Hex, tip: bigint): Promise<bigint> {
  let lo = 1n;
  let hi = tip;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await client.getBytecode({ address: spot, blockNumber: mid });
    if (code && code !== "0x") hi = mid;
    else lo = mid + 1n;
  }
  return lo;
}

async function logsBetween(spot: Hex, from: bigint, to: bigint) {
  const jobs: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += LOG_SPAN) {
    const end = start + LOG_SPAN - 1n > to ? to : start + LOG_SPAN - 1n;
    jobs.push([start, end]);
  }
  const out: SpotPrint[] = [];
  for (let i = 0; i < jobs.length; i += 2) {
    const batch = jobs.slice(i, i + 2);
    const parts = await Promise.all(batch.map(async ([start, end]) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          return await client.getLogs({ address: spot, event: takeEvent, fromBlock: start, toBlock: end });
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
      return null;
    }));
    for (let j = 0; j < parts.length; j += 1) {
      const logs = parts[j];
      if (!logs) return { rows: out, tip: batch[j][0] - 1n };
      for (const log of logs) {
        out.push({
          tx: log.transactionHash ?? "",
          market: Number(log.args.market ?? 0),
          price: log.args.price ?? 0n,
          base: log.args.base ?? 0n,
          quote: log.args.quote ?? 0n,
          fee: log.args.fee ?? 0n,
          taker: log.args.taker ?? "",
          maker: log.args.maker ?? "",
        });
      }
    }
  }
  return { rows: out, tip: to };
}

async function fillPrints() {
  const spot = spotAddress();
  if (!spot) return;
  const tip = await client.getBlockNumber();
  const cached = readPrintCache();
  let born = cached?.born ?? 0n;
  let rows = cached?.rows ?? [];
  let from = cached && cached.tip > 0n ? cached.tip + 1n : 0n;
  if (born === 0n || from === 0n) {
    born = await findSpotBirth(spot, tip);
    from = born;
    rows = [];
  }
  if (from > tip) return;
  const found = await logsBetween(spot, from, tip);
  const seen = new Set(rows.map(printKey));
  for (const row of found.rows) {
    const key = printKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  writePrintCache(born, found.tip > 0n ? found.tip : from - 1n, rows);
}

export async function readSpotPrints(market: SpotMarket | null): Promise<SpotPrint[]> {
  if (!printFlight) {
    printFlight = fillPrints().finally(() => {
      printFlight = null;
    });
  }
  await printFlight;
  const rows = readPrintCache()?.rows ?? [];
  return rows.filter((row) => market == null || row.market === market).reverse();
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
