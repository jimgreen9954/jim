import { createPublicClient, encodeFunctionData, http, parseAbi, parseUnits, type Hex } from "viem";
import { DEPLOYED, xClient } from "@/lib/xlayer";
import { TAPE_USDT } from "@/lib/tape-pool";
import { ensureProvider } from "@/lib/wallet";

export const CIRCUIT_SPLIT = "0x08bd11220b6a87f1d16b54b5521d4e90bb0d1b1b" as Hex;

const abi = parseAbi([
  "function split(uint256 tokenId)",
  "function join(uint256 tokenId)",
  "function claim(uint256 tokenId)",
  "function shares(uint256 tokenId, address account) view returns (uint256)",
  "function pending(uint256 tokenId, address account) view returns (uint256)",
  "function piece(uint256 tokenId) view returns (uint256 supply, uint256 listed, uint256 open)",
  "function FEE_BPS() view returns (uint256)",
  "function book(uint256 tokenId, bool bid, uint256 limit) view returns (uint256 count, uint128[] price, uint128[] size, uint32[] lots)",
  "function myOrders(address account) view returns (uint64[])",
  "function place(uint256 tokenId, bool bid, uint128 price, uint128 size) returns (uint64)",
  "function cancel(uint64 id)",
  "function transfer(uint256 tokenId, address to, uint256 amount)",
]);

const nftAbi = parseAbi([
  "function getApproved(uint256 tokenId) view returns (address)",
  "function approve(address to, uint256 tokenId)",
  "function nextId() view returns (uint256)",
]);

const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const client = createPublicClient({
  transport: http("https://rpc.xlayer.tech", { timeout: 8_000, retryCount: 0 }),
});

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  const eth = await ensureProvider();
  const chain = (await eth.request({ method: "eth_chainId" })) as string;
  if (chain.toLowerCase() !== "0xc4") {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xc4" }],
    });
  }
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: "0x0" }],
  })) as Hex;
}

export async function readSplit(tokenId: bigint, account: string) {
  const who = account as Hex;
  const [shares, pending, feeBps] = await Promise.all([
    client.readContract({
      address: CIRCUIT_SPLIT,
      abi,
      functionName: "shares",
      args: [tokenId, who],
    }),
    client.readContract({
      address: CIRCUIT_SPLIT,
      abi,
      functionName: "pending",
      args: [tokenId, who],
    }),
    client.readContract({ address: CIRCUIT_SPLIT, abi, functionName: "FEE_BPS" }),
  ]);
  return { shares, pending, feeBps };
}

export type SplitPiece = { id: string; supply: bigint };

let pieceCache: { at: number; rows: SplitPiece[] } | null = null;
let pieceFlight: Promise<SplitPiece[]> | null = null;
const PIECE_MS = 90_000;
const PIECE_KEY = "tape-split-pieces-v1";

export function forgetSplitPieces() {
  pieceCache = null;
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PIECE_KEY);
}

export function peekSplitPieces(): SplitPiece[] {
  if (pieceCache?.rows.length) return pieceCache.rows;
  if (typeof sessionStorage === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(PIECE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { rows?: { id: string; supply: string }[] };
    const rows = (parsed.rows ?? [])
      .filter((row) => row && /^\d+$/.test(row.id))
      .map((row) => ({ id: row.id, supply: BigInt(row.supply) }));
    if (rows.length) pieceCache = { at: 0, rows };
    return rows;
  } catch {
    return [];
  }
}

function rememberPieces(rows: SplitPiece[]) {
  pieceCache = { at: Date.now(), rows };
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      PIECE_KEY,
      JSON.stringify({
        at: pieceCache.at,
        rows: rows.map((row) => ({ id: row.id, supply: row.supply.toString() })),
      }),
    );
  } catch {
    /* storage full or blocked */
  }
}

export async function listSplitPieces(): Promise<SplitPiece[]> {
  if (pieceCache && pieceCache.at > 0 && Date.now() - pieceCache.at < PIECE_MS) return pieceCache.rows;
  if (pieceFlight) return pieceFlight;
  pieceFlight = scanSplitPieces()
    .then((rows) => {
      rememberPieces(rows);
      return rows;
    })
    .catch((error) => {
      if (pieceCache?.rows.length) return pieceCache.rows;
      throw error;
    })
    .finally(() => {
      pieceFlight = null;
    });
  return pieceFlight;
}

async function scanSplitPieces(): Promise<SplitPiece[]> {
  const next = await xClient.readContract({
    address: DEPLOYED.circuits,
    abi: nftAbi,
    functionName: "nextId",
  });
  const last = Number(next) - 1;
  if (!(last > 0)) return [];
  const chunks: bigint[][] = [];
  for (let start = 1; start <= last; start += 400) {
    const ids: bigint[] = [];
    for (let id = start; id < start + 400 && id <= last; id += 1) ids.push(BigInt(id));
    chunks.push(ids);
  }
  const parts = await Promise.all(
    chunks.map(async (ids) => {
      const rows = await xClient.multicall({
        contracts: ids.map((id) => ({
          address: CIRCUIT_SPLIT,
          abi,
          functionName: "piece" as const,
          args: [id] as const,
        })),
        allowFailure: true,
      });
      return { ids, rows };
    }),
  );
  const found: SplitPiece[] = [];
  for (const part of parts) {
    part.rows.forEach((row, index) => {
      if (row.status !== "success") return;
      const supply = row.result[0];
      if (supply > 0n) found.push({ id: part.ids[index].toString(), supply });
    });
  }
  found.sort((a, b) => Number(a.id) - Number(b.id));
  return found;
}

export type ShareLevel = { price: bigint; size: bigint; lots: number; id: string };

function levels(
  row: readonly [bigint, readonly bigint[], readonly bigint[], readonly number[]],
  id: string,
): ShareLevel[] {
  const count = Number(row[0]);
  const out: ShareLevel[] = [];
  const n = Number.isFinite(count) ? Math.min(count, 12) : 0;
  for (let i = 0; i < n; i += 1) {
    const price = row[1][i] ?? 0n;
    const size = row[2][i] ?? 0n;
    if (price <= 0n || size <= 0n) continue;
    out.push({ price, size, lots: Number(row[3][i] ?? 0), id });
  }
  return out;
}

export type ShareSeat = { id: string; supply: bigint; shares: bigint; pending: bigint };

export async function readShareSeats(account: string, pieces: SplitPiece[]): Promise<ShareSeat[]> {
  if (!account || pieces.length === 0) return [];
  const who = account as Hex;
  const rows = await xClient.multicall({
    contracts: pieces.flatMap((piece) => {
      const id = BigInt(piece.id);
      return [
        { address: CIRCUIT_SPLIT, abi, functionName: "shares" as const, args: [id, who] as const },
        { address: CIRCUIT_SPLIT, abi, functionName: "pending" as const, args: [id, who] as const },
      ];
    }),
    allowFailure: true,
  });
  const found: ShareSeat[] = [];
  pieces.forEach((piece, index) => {
    const shareRow = rows[index * 2];
    const dueRow = rows[index * 2 + 1];
    const shares = shareRow?.status === "success" ? shareRow.result : 0n;
    const pending = dueRow?.status === "success" ? dueRow.result : 0n;
    if (shares > 0n || pending > 0n) found.push({ id: piece.id, supply: piece.supply, shares, pending });
  });
  return found;
}

export async function readShareBook(tokenId: bigint): Promise<{ bids: ShareLevel[]; asks: ShareLevel[] }> {
  const id = tokenId.toString();
  const [bids, asks] = await Promise.all([
    client.readContract({ address: CIRCUIT_SPLIT, abi, functionName: "book", args: [tokenId, true, 12n] }),
    client.readContract({ address: CIRCUIT_SPLIT, abi, functionName: "book", args: [tokenId, false, 12n] }),
  ]);
  return { bids: levels(bids, id), asks: levels(asks, id) };
}

/** Every split circuit on one book. A fill still settles on the circuit of the row you take. */
export async function readAllShareBooks(pieces: SplitPiece[]): Promise<{ bids: ShareLevel[]; asks: ShareLevel[] }> {
  if (pieces.length === 0) return { bids: [], asks: [] };
  const rows = await xClient.multicall({
    contracts: pieces.flatMap((piece) => {
      const id = BigInt(piece.id);
      return [
        { address: CIRCUIT_SPLIT, abi, functionName: "book" as const, args: [id, true, 12n] as const },
        { address: CIRCUIT_SPLIT, abi, functionName: "book" as const, args: [id, false, 12n] as const },
      ];
    }),
    allowFailure: true,
  });
  const bids: ShareLevel[] = [];
  const asks: ShareLevel[] = [];
  pieces.forEach((piece, index) => {
    const bidRow = rows[index * 2];
    const askRow = rows[index * 2 + 1];
    if (bidRow?.status === "success") bids.push(...levels(bidRow.result, piece.id));
    if (askRow?.status === "success") asks.push(...levels(askRow.result, piece.id));
  });
  bids.sort((a, b) => (a.price === b.price ? 0 : a.price > b.price ? -1 : 1));
  asks.sort((a, b) => (a.price === b.price ? 0 : a.price < b.price ? -1 : 1));
  return { bids, asks };
}

export async function readShareOrders(account: string): Promise<bigint[]> {
  const ids = await client.readContract({
    address: CIRCUIT_SPLIT,
    abi,
    functionName: "myOrders",
    args: [account as Hex],
  });
  return [...ids];
}

/** Reference TAPE price, 6 decimals: 0.185 USD. */
export const TAPE_USD_6 = 185_000n;
/** One NAND, in OKB. One hashrate point is minted from one NAND. */
export const NAND_OKB = 4_000_000_000_000_000n;

export function hashDayUsd(daily: bigint, weight: bigint): bigint {
  if (weight <= 0n || daily <= 0n) return 0n;
  return (daily * TAPE_USD_6) / (100_000_000n * weight);
}

export function nandCostUsdt(okb6: bigint): bigint {
  if (okb6 <= 0n) return 0n;
  return (okb6 * 4n) / 1000n;
}

export function hashYield(price: bigint, dayUsd: bigint): { apy: bigint; days: bigint } | null {
  if (price <= 0n || dayUsd <= 0n) return null;
  return { apy: (dayUsd * 365n * 100n) / price, days: price / dayUsd };
}

export function sharePrice(text: string): bigint {
  const raw = text.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) throw new Error("price");
  return parseUnits(raw, 6);
}

export function shareSize(text: string): bigint {
  if (!/^[1-9]\d*$/.test(text.trim())) throw new Error("amount");
  return BigInt(text.trim());
}

async function approveUsdt(from: string, need: bigint) {
  const allow = await client.readContract({
    address: TAPE_USDT,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, CIRCUIT_SPLIT],
  });
  if (allow >= need) return;
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [CIRCUIT_SPLIT, need] });
  const hash = await send(from, TAPE_USDT, data);
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
}

export async function placeShare(from: string, tokenId: bigint, bid: boolean, price: bigint, size: bigint): Promise<Hex> {
  const need = price * size;
  const fee = (need * 20n) / 10_000n;
  if (fee === 0n) throw new Error("fee");
  if (bid) await approveUsdt(from, need + fee);
  const data = encodeFunctionData({ abi, functionName: "place", args: [tokenId, bid, price, size] });
  return send(from, CIRCUIT_SPLIT, data);
}

export async function cancelShare(from: string, id: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "cancel", args: [id] });
  return send(from, CIRCUIT_SPLIT, data);
}

export async function transferShare(from: string, tokenId: bigint, to: string, amount: bigint): Promise<Hex> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("address");
  if (to.toLowerCase() === from.toLowerCase()) throw new Error("self");
  if (amount <= 0n) throw new Error("amount");
  const data = encodeFunctionData({
    abi,
    functionName: "transfer",
    args: [tokenId, to as Hex, amount],
  });
  return send(from, CIRCUIT_SPLIT, data);
}

export async function splitCircuit(from: string, tokenId: bigint): Promise<Hex> {
  const approved = await client.readContract({
    address: DEPLOYED.circuits,
    abi: nftAbi,
    functionName: "getApproved",
    args: [tokenId],
  });
  if (approved.toLowerCase() !== CIRCUIT_SPLIT.toLowerCase()) {
    const allow = encodeFunctionData({
      abi: nftAbi,
      functionName: "approve",
      args: [CIRCUIT_SPLIT, tokenId],
    });
    const hash = await send(from, DEPLOYED.circuits, allow);
    await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  }
  const data = encodeFunctionData({ abi, functionName: "split", args: [tokenId] });
  const hash = await send(from, CIRCUIT_SPLIT, data);
  await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  forgetSplitPieces();
  return hash;
}

export async function joinCircuit(from: string, tokenId: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "join", args: [tokenId] });
  return send(from, CIRCUIT_SPLIT, data);
}

export async function claimSplitTape(from: string, tokenId: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "claim", args: [tokenId] });
  return send(from, CIRCUIT_SPLIT, data);
}

/** One claim per circuit. The next signature waits until the previous receipt. */
export async function claimSplitMany(from: string, ids: bigint[]): Promise<Hex> {
  if (ids.length === 0) throw new Error("empty");
  let hash: Hex = "0x";
  let done = 0;
  for (const id of ids) {
    try {
      hash = await claimSplitTape(from, id);
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
      if (receipt.status !== "success") throw new Error("revert");
      done += 1;
    } catch (err) {
      const error = err instanceof Error ? err : new Error("claim");
      (error as Error & { done?: number }).done = done;
      throw error;
    }
  }
  return hash;
}
