import { createPublicClient, defineChain, encodeFunctionData, formatUnits, http, parseAbi, parseAbiItem, parseUnits, type Hex } from "viem";
import { TAPE_SPOT_BYTECODE } from "@/lib/tape-spot-artifact";
import { FEE_TO } from "@/lib/bsc";
import { TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { getProvider, walletKind } from "@/lib/wallet";
import { DEPLOYED, connectXLayer, quoteGas, XLAYER } from "@/lib/xlayer";

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

const xlayer = defineChain({
  id: XLAYER.chainId,
  name: XLAYER.name,
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER.rpc] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const client = createPublicClient({
  chain: xlayer,
  transport: http(XLAYER.rpc, { batch: { batchSize: 40, wait: 16 }, timeout: 8_000 }),
});

export type SpotMarket = 0 | 1 | 2;

export function spotAddress(): Hex | null {
  const fixed = TAPE_SPOT as string;
  if (/^0x[a-fA-F0-9]{40}$/.test(fixed)) return fixed as Hex;
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(KEY) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved as Hex : null;
}

let spotKnown = false;

export async function spotReady(): Promise<boolean> {
  if (spotKnown) return true;
  const spot = spotAddress();
  if (!spot) return false;
  const code = await client.getBytecode({ address: spot });
  spotKnown = !!code && code !== "0x";
  return spotKnown;
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
export type SpotPrint = { tx: string; market: number; price: bigint; base: bigint; quote: bigint; fee: bigint; taker: string; maker: string; block: number };
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
  const view = await readSpotView(market, null);
  return view.book;
}

export async function readSpotView(market: SpotMarket, account: string | null): Promise<{ book: { bids: Level[]; asks: Level[] } | null; purse: SpotPurse | null; orders: OpenOrder[] | null }> {
  const spot = spotAddress();
  if (!spot) return { book: null, purse: null, orders: null };
  const who = account && /^0x[a-fA-F0-9]{40}$/.test(account) ? account as Hex : null;
  const calls: { address: Hex; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }[] = [
    { address: spot, abi, functionName: "book", args: [market, true, 24n] },
    { address: spot, abi, functionName: "book", args: [market, false, 24n] },
  ];
  if (who) {
    calls.push(
      { address: TAPE_USDT, abi: erc20, functionName: "balanceOf", args: [who] },
      { address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] },
      { address: DEPLOYED.transistors, abi: erc1155, functionName: "balanceOf", args: [who, 0n] },
      { address: DEPLOYED.transistors, abi: erc1155, functionName: "balanceOf", args: [who, 1n] },
      { address: spot, abi, functionName: "myOrders", args: [who] },
    );
  }
  const rows = await client.multicall({ contracts: calls as never, allowFailure: true }) as { status: string; result?: unknown }[];
  const bid = rows[0];
  const ask = rows[1];
  if (!bid || bid.status !== "success" || !ask || ask.status !== "success") throw new Error("book");
  let purse: SpotPurse | null = null;
  let orders: OpenOrder[] | null = null;
  if (who && rows[2]?.status === "success" && rows[3]?.status === "success" && rows[4]?.status === "success" && rows[5]?.status === "success") {
    purse = { usdt: rows[2].result as bigint, tape: rows[3].result as bigint, nand: rows[4].result as bigint, latch: rows[5].result as bigint };
  }
  if (who && rows[6]?.status === "success" && Array.isArray(rows[6].result)) {
    const row = rows[6].result as [bigint[], number[], boolean[], bigint[], bigint[]];
    orders = row[0].map((id, i) => ({ id, market: row[1][i] ?? 0, bid: row[2][i] ?? false, price: row[3][i] ?? 0n, left: row[4][i] ?? 0n }));
  }
  return { book: { bids: levels(bid.result), asks: levels(ask.result) }, purse, orders };
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

export type CircuitPrint = { tx: string; id: string; buyer: string; seller: string; price: bigint; fee: bigint; ts: number; block: number };

const CIRCUIT_KEY = "tapeliquid-circuit-prints-v1";
const CIRCUIT_SPAN = 80n;

type CircuitWire = { tx: string; id: string; buyer: string; seller: string; price: string; fee: string; block: number };
type CircuitCache = { low: string; high: string; rows: CircuitWire[] };

let circuitMemory: { low: bigint; high: bigint; rows: CircuitPrint[] } | null = null;

function packCircuit(row: CircuitPrint): CircuitWire {
  return { tx: row.tx, id: row.id, buyer: row.buyer, seller: row.seller, price: row.price.toString(), fee: row.fee.toString(), block: row.block };
}

function unpackCircuit(row: CircuitWire): CircuitPrint {
  return { tx: row.tx, id: row.id, buyer: row.buyer, seller: row.seller, price: BigInt(row.price), fee: BigInt(row.fee), ts: 0, block: row.block };
}

function circuitKey(row: CircuitPrint): string {
  return `${row.tx}:${row.id}`;
}

function readCircuitCache(): { low: bigint; high: bigint; rows: CircuitPrint[] } | null {
  if (circuitMemory) return circuitMemory;
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(CIRCUIT_KEY) ?? "") as CircuitCache;
    if (!saved || !Array.isArray(saved.rows)) return null;
    circuitMemory = { low: BigInt(saved.low), high: BigInt(saved.high), rows: saved.rows.map(unpackCircuit) };
    return circuitMemory;
  } catch {
    return null;
  }
}

function writeCircuitCache(low: bigint, high: bigint, rows: CircuitPrint[]) {
  circuitMemory = { low, high, rows };
  if (typeof window === "undefined") return;
  try {
    const body: CircuitCache = { low: low.toString(), high: high.toString(), rows: rows.map(packCircuit) };
    window.localStorage.setItem(CIRCUIT_KEY, JSON.stringify(body));
  } catch {
    /* The list still stays for this open. */
  }
}

async function pullCircuitLogs(spot: Hex, start: bigint, end: bigint): Promise<CircuitPrint[] | null> {
  const once = async (from: bigint, to: bigint) => {
    try {
      const logs = await client.getLogs({ address: spot, event: boughtEvent, fromBlock: from, toBlock: to });
      return logs.map((log) => ({
        tx: log.transactionHash ?? "",
        id: (log.args.id ?? 0n).toString(),
        buyer: log.args.buyer ?? "",
        seller: log.args.seller ?? "",
        price: log.args.price ?? 0n,
        fee: log.args.fee ?? 0n,
        ts: 0,
        block: Number(log.blockNumber ?? 0),
      }));
    } catch {
      return null;
    }
  };
  const found = await once(start, end);
  if (found || end <= start + 20n) return found;
  const mid = start + (end - start) / 2n;
  const left = await once(start, mid);
  const right = await once(mid + 1n, end);
  if (!left || !right) return null;
  return [...left, ...right];
}

export async function readCircuitPrints(): Promise<{ rows: CircuitPrint[]; pending: boolean }> {
  const spot = spotAddress();
  const cached = readCircuitCache();
  if (!spot) return { rows: [], pending: false };
  let tip = 0n;
  try { tip = await client.getBlockNumber(); } catch { return { rows: stampCircuits(cached?.rows ?? []), pending: true }; }
  await touchClock(tip);
  const born = tip > SPOT_BORN ? SPOT_BORN : 0n;
  const rows = cached?.rows ?? [];
  let low = cached?.low ?? tip + 1n;
  let high = cached?.high ?? tip - 1n;
  let steps = 0;
  while (high < tip && steps < 6) {
    const start = high + 1n;
    const end = start + CIRCUIT_SPAN - 1n > tip ? tip : start + CIRCUIT_SPAN - 1n;
    const found = await pullCircuitLogs(spot, start, end);
    if (!found) break;
    for (const row of found) if (!rows.some((have) => circuitKey(have) === circuitKey(row))) rows.push(row);
    high = end;
    if (low > high) low = high + 1n;
    writeCircuitCache(low, high, rows);
    steps += 1;
  }
  while (low > born && steps < 16) {
    const end = low - 1n;
    const start = end - CIRCUIT_SPAN + 1n < born ? born : end - CIRCUIT_SPAN + 1n;
    const found = await pullCircuitLogs(spot, start, end);
    if (!found) break;
    for (const row of found) if (!rows.some((have) => circuitKey(have) === circuitKey(row))) rows.push(row);
    low = start;
    writeCircuitCache(low, high, rows);
    steps += 1;
  }
  return { rows: stampCircuits(rows), pending: low > born };
}

function stampCircuits(rows: CircuitPrint[]): CircuitPrint[] {
  return [...rows].sort((a, b) => b.block - a.block).map((row) => ({ ...row, ts: blockStamp(row.block) || row.ts }));
}

const PRINT_KEY = "tapeliquid-spot-prints-v4";
const PRINT_OLD = "tapeliquid-spot-prints-v3";
const LOG_SPAN = 2_000n;
const SPOT_BORN = 72965200n;

type PrintWire = { tx: string; market: number; price: string; base: string; quote: string; fee: string; taker: string; maker: string; block?: number };
type PrintCache = { low: string; high: string; rows: PrintWire[] };

let printMemory: { low: bigint; high: bigint; rows: SpotPrint[] } | null = null;
let printFlight: Promise<void> | null = null;

function packPrint(row: SpotPrint): PrintWire {
  return { tx: row.tx, market: row.market, price: row.price.toString(), base: row.base.toString(), quote: row.quote.toString(), fee: row.fee.toString(), taker: row.taker, maker: row.maker, block: row.block };
}

function unpackPrint(row: PrintWire): SpotPrint {
  return { tx: row.tx, market: row.market, price: BigInt(row.price), base: BigInt(row.base), quote: BigInt(row.quote), fee: BigInt(row.fee), taker: row.taker, maker: row.maker, block: row.block ?? 0 };
}

function printKey(row: SpotPrint): string {
  return `${row.tx}:${row.market}:${row.price}:${row.base}:${row.quote}`;
}

function writePrintCache(low: bigint, high: bigint, rows: SpotPrint[]) {
  printMemory = { low, high, rows };
  if (typeof window === "undefined") return;
  try {
    const body: PrintCache = { low: low.toString(), high: high.toString(), rows: rows.map(packPrint) };
    window.localStorage.setItem(PRINT_KEY, JSON.stringify(body));
  } catch {
    /* The tape viewer has no storage. The list still stays for this open. */
  }
}

function mergePrints(rows: SpotPrint[], extra: SpotPrint[]) {
  const at = new Map(rows.map((row, index) => [printKey(row), index]));
  for (const row of extra) {
    const key = printKey(row);
    const index = at.get(key);
    if (index == null) {
      at.set(key, rows.length);
      rows.push(row);
      continue;
    }
    if (rows[index].block <= 0 && row.block > 0) rows[index] = row;
  }
}

async function pullLogs(spot: Hex, start: bigint, end: bigint): Promise<SpotPrint[] | null> {
  const once = async (from: bigint, to: bigint) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const logs = await client.getLogs({ address: spot, event: takeEvent, fromBlock: from, toBlock: to });
        return logs.map((log) => ({
          tx: log.transactionHash ?? "",
          market: Number(log.args.market ?? 0),
          price: log.args.price ?? 0n,
          base: log.args.base ?? 0n,
          quote: log.args.quote ?? 0n,
          fee: log.args.fee ?? 0n,
          taker: log.args.taker ?? "",
          maker: log.args.maker ?? "",
          block: Number(log.blockNumber ?? 0),
        }));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    return null;
  };
  const found = await once(start, end);
  if (found || end <= start + 25n) return found;
  const mid = start + (end - start) / 2n;
  const left = await once(start, mid);
  const right = await once(mid + 1n, end);
  if (!left || !right) return null;
  return [...left, ...right];
}

function parseCache(raw: string | null): { low: bigint; high: bigint; rows: SpotPrint[] } | null {
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as PrintCache;
    if (!saved || !Array.isArray(saved.rows)) return null;
    return { low: BigInt(saved.low), high: BigInt(saved.high), rows: saved.rows.map(unpackPrint) };
  } catch {
    return null;
  }
}

function readPrintCache(): { low: bigint; high: bigint; rows: SpotPrint[] } | null {
  if (printMemory) return printMemory;
  if (typeof window === "undefined") return null;
  const next = parseCache(window.localStorage.getItem(PRINT_KEY));
  const saved = next ?? parseCache(window.localStorage.getItem(PRINT_OLD));
  if (!saved) return null;
  printMemory = saved;
  return saved;
}

async function attachBlocks(rows: SpotPrint[]) {
  const need = [...rows].reverse().filter((row) => row.block <= 0 && row.tx.startsWith("0x")).slice(0, 24);
  if (!need.length) return false;
  await Promise.all(need.map(async (row) => {
    try {
      const tx = await client.getTransaction({ hash: row.tx as Hex });
      if (tx.blockNumber) row.block = Number(tx.blockNumber);
    } catch {
      /* The row still shows. The time fills on the next read. */
    }
  }));
  const blocks = [...new Set(need.map((row) => row.block).filter((block) => block > 0 && !blockTime.has(block)))];
  await Promise.all(blocks.map(async (block) => {
    try {
      const stamped = await client.getBlock({ blockNumber: BigInt(block) });
      blockTime.set(block, Number(stamped.timestamp));
    } catch {
      /* Time stays blank for this block. */
    }
  }));
  return need.some((row) => row.block > 0);
}

let headCache: { at: number; tip: bigint } | null = null;
let nextBackfill = 0;

async function chainHead(): Promise<bigint> {
  if (headCache && Date.now() - headCache.at < 4_000) return headCache.tip;
  const tip = await client.getBlockNumber();
  headCache = { at: Date.now(), tip };
  return tip;
}

async function fillPrints() {
  const spot = spotAddress();
  if (!spot) return;
  const tip = await chainHead();
  void touchClock(tip);
  const born = tip > SPOT_BORN ? SPOT_BORN : 0n;
  const cached = readPrintCache();
  const rows = cached?.rows ?? [];
  let low = cached?.low ?? tip + 1n;
  let high = cached?.high ?? tip - 1n;
  if (!cached) {
    const first = 400n;
    const start = tip > first ? tip - first + 1n : born;
    const found = await pullLogs(spot, start < born ? born : start, tip);
    if (!found) return;
    mergePrints(rows, found);
    writePrintCache(start < born ? born : start, tip, rows);
    return;
  }
  let steps = 0;
  while (high < tip && steps < 2) {
    const start = high + 1n;
    const end = start + LOG_SPAN - 1n > tip ? tip : start + LOG_SPAN - 1n;
    const found = await pullLogs(spot, start, end);
    if (!found) break;
    mergePrints(rows, found);
    high = end;
    if (low > high + 1n) low = high + 1n;
    writePrintCache(low, high, rows);
    steps += 1;
  }
  if (Date.now() < nextBackfill || low <= born) return;
  nextBackfill = Date.now() + 8_000;
  const end = low - 1n;
  const start = end - LOG_SPAN + 1n < born ? born : end - LOG_SPAN + 1n;
  const found = await pullLogs(spot, start, end);
  if (!found) return;
  mergePrints(rows, found);
  writePrintCache(start, high, rows);
}

export function peekSpotPrints(market: SpotMarket | null): { rows: SpotPrint[]; pending: boolean; minutes: number } {
  if (!printFlight) {
    printFlight = fillPrints().finally(() => {
      printFlight = null;
    });
  }
  const cached = readPrintCache();
  const matched = (cached?.rows ?? []).filter((row) => market == null || row.market === market);
  const rows = matched.some((row) => row.block > 0) ? [...matched].sort((a, b) => b.block - a.block) : [...matched].reverse();
  const low = cached?.low ?? 0n;
  const high = cached?.high ?? 0n;
  const covered = high >= low ? high - low + 1n : 0n;
  const pending = rows.length === 0 && printFlight != null;
  return { rows, pending, minutes: Number(covered / 60n) };
}

const blockTime = new Map<number, number>();
let clock = { tip: 0, ts: 0 };

async function touchClock(tip: bigint) {
  if (clock.tip && Math.abs(clock.tip - Number(tip)) < 20) return;
  try {
    const block = await client.getBlock({ blockNumber: tip });
    clock = { tip: Number(tip), ts: Number(block.timestamp) };
  } catch { /* The next pass fills the clock. */ }
}

export function blockStamp(block: number): number {
  if (!block || !clock.tip || !clock.ts) return blockTime.get(block) ?? 0;
  return clock.ts - (clock.tip - block);
}

export async function readBlockTimes(blocks: number[]): Promise<Record<number, number>> {
  const missing = [...new Set(blocks.filter((block) => block > 0 && !blockTime.has(block)))].slice(0, 24);
  await Promise.all(missing.map(async (block) => {
    try {
      const row = await client.getBlock({ blockNumber: BigInt(block) });
      blockTime.set(block, Number(row.timestamp));
    } catch {
      /* A missing stamp stays blank. */
    }
  }));
  const out: Record<number, number> = {};
  for (const block of blocks) {
    const ts = blockTime.get(block);
    if (ts) out[block] = ts;
  }
  return out;
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
  const tx: { from: string; to?: Hex; data: Hex; chainId?: string; gas?: Hex; value?: Hex } = { from, data, value: "0x0" };
  if (walletKind() !== "binance") tx.chainId = XLAYER.hex;
  if (to) {
    tx.to = to;
    const gas = await quoteGas(from, to, data);
    if (gas) tx.gas = gas;
    else if (walletKind() === "binance") tx.gas = "0x7a120";
  } else tx.gas = "0x4c4b40";
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

export function usdtText(amount: bigint, digits = 2): string {
  const [whole, frac = ""] = formatUnits(amount, 6).split(".");
  const cap = Number(whole) >= 1 || amount === 0n ? Math.min(digits, 2) : Math.min(Math.max(digits, 2), 4);
  const cut = frac.slice(0, cap).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
}

export function baseText(market: number, amount: bigint): string {
  if (market !== 0) return amount.toLocaleString("en-US");
  const [whole, frac = ""] = formatUnits(amount, 8).split(".");
  const cap = Number(whole) >= 1 ? 2 : 4;
  const cut = frac.slice(0, cap).replace(/0+$/, "");
  return `${Number(whole).toLocaleString("en-US")}${cut ? `.${cut}` : ""}`;
}
