import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, defineChain, encodeFunctionData, fallback, formatUnits, http, parseAbi, type Hex } from "viem";
import { connectXLayer, DEPLOYED, XLAYER } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";

export const TAPE_MINE = "0x60b1b7cae1bbd0e84ac3e1e43f933712f3ab67e8" as const;
export const TAPE = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as const;

const mineAbi = parseAbi([
  "function token() view returns (address)",
  "function totalWeight() view returns (uint256)",
  "function start() view returns (uint256)",
  "function pendingOf(uint256) view returns (uint256)",
  "function seat(uint256) view returns (address owner, uint256 weight, uint256 paid, bool on)",
  "function open(uint256)",
  "function claimMany(uint256[])",
]);

const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function CAP() view returns (uint256)",
]);

const circuitAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function circuitInfo(uint256) view returns (uint256,uint256,uint256,uint256)",
]);

const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER.rpc] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const RPCS = [XLAYER.rpc, "https://xlayerrpc.okx.com", "https://xlayer.drpc.org"];

const client = createPublicClient({
  chain: xlayer,
  transport: fallback(RPCS.map((url) => http(url, { timeout: 8_000, retryCount: 0 })), { rank: false }),
});

export function tapeText(amount: bigint): string {
  return formatUnits(amount, 8);
}

export type TapeSeat = {
  id: string;
  gates: string;
  on: boolean;
  pending: bigint;
  share: string;
};

export type TapeBoard = {
  supply: bigint;
  cap: bigint;
  weight: bigint;
  balance: bigint;
  start: bigint;
  daily: bigint;
  circuits: number;
  open: number;
  seats: TapeSeat[];
  scanOk: boolean;
  scanning: boolean;
};

const DAY = 7200n * 10n ** 8n;
const HALVING = 210_000n * 600n;
const CAP = 21_000_000n * 10n ** 8n;

function dailyAt(start: bigint): bigint {
  const era = (BigInt(Math.floor(Date.now() / 1000)) - start) / HALVING;
  if (era < 0n || era >= 64n) return 0n;
  return DAY >> era;
}

export type TapeWire = {
  supply: string;
  cap: string;
  weight: string;
  balance: string;
  start: string;
  daily: string;
  circuits: number;
  open: number;
  scanOk: boolean;
  scanning: boolean;
  seats: { id: string; gates: string; on: boolean; pending: string; share: string }[];
};

function asAccount(input: { account?: string } | undefined) {
  const account = (input?.account ?? "").trim();
  if (account && !/^0x[0-9a-fA-F]{40}$/.test(account)) throw new Error("account");
  return account;
}

export const getTapeHead = createServerFn({ method: "POST" })
  .validator(asAccount)
  .handler(async ({ data }) => {
    const { loadTapeHead } = await import("./tape-mine.server");
    return loadTapeHead(data || null);
  });

export const getTapeSeats = createServerFn({ method: "POST" })
  .validator(asAccount)
  .handler(async ({ data }) => {
    const { loadTapeSeats } = await import("./tape-mine.server");
    return loadTapeSeats(data || null);
  });

function boardFrom(wire: TapeWire): TapeBoard {
  return {
    supply: BigInt(wire.supply),
    cap: BigInt(wire.cap),
    weight: BigInt(wire.weight),
    balance: BigInt(wire.balance),
    start: BigInt(wire.start),
    daily: BigInt(wire.daily),
    circuits: wire.circuits,
    open: wire.open,
    scanOk: wire.scanOk,
    scanning: wire.scanning,
    seats: wire.seats.map((row) => ({ ...row, pending: BigInt(row.pending) })),
  };
}

let mineFlight: Promise<TapeBoard> | null = null;
let mineKey = "";

export function readTapeMine(account: string | null, onHead?: (board: TapeBoard) => void): Promise<TapeBoard> {
  const key = (account ?? "").toLowerCase();
  if (mineFlight && mineKey === key) return mineFlight;
  mineKey = key;
  mineFlight = readThroughSite(account, onHead).finally(() => {
    mineFlight = null;
  });
  return mineFlight;
}

function until<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("slow")), ms);
  });
  return Promise.race([work, slow]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function readThroughSite(account: string | null, onHead?: (board: TapeBoard) => void): Promise<TapeBoard> {
  try {
    const head = boardFrom(await until(getTapeHead({ data: { account: account ?? "" } }), 8_000));
    onHead?.({ ...head, scanning: true, seats: [], scanOk: false });
    try {
      return boardFrom(await until(getTapeSeats({ data: { account: account ?? "" } }), 20_000));
    } catch {
      return loadTapeMine(account, onHead);
    }
  } catch {
    return loadTapeMine(account, onHead);
  }
}

async function readChunk(contracts: readonly unknown[]) {
  const out: { status: string; result?: unknown }[] = [];
  for (let i = 0; i < contracts.length; i += 180) {
    const part = await client.multicall({
      contracts: contracts.slice(i, i + 180) as never,
      allowFailure: true,
      batchSize: 180,
    });
    out.push(...(part as { status: string; result?: unknown }[]));
  }
  return out;
}

async function loadTapeMine(account: string | null, onHead?: (board: TapeBoard) => void): Promise<TapeBoard> {
  const who = (account ?? "") as Hex;
  const headCalls = [
    { address: TAPE, abi: tokenAbi, functionName: "totalSupply" as const },
    { address: TAPE, abi: tokenAbi, functionName: "CAP" as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "totalWeight" as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "start" as const },
    { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "nextId" as const },
    ...(account ? [{ address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [who] as const }] : []),
  ];
  const head = await client.multicall({ contracts: headCalls, allowFailure: false });
  const supply = head[0] as bigint;
  const cap = head[1] as bigint;
  const weight = head[2] as bigint;
  const start = head[3] as bigint;
  const next = head[4] as bigint;
  const balance = account ? (head[5] as bigint) : 0n;
  if (cap !== CAP) throw new Error("cap");
  const daily = dailyAt(start);
  const last = Number(next) - 1;
  const partial: TapeBoard = {
    supply, cap, weight, balance, start, daily,
    circuits: Math.max(0, last),
    open: 0,
    seats: [],
    scanOk: false,
    scanning: true,
  };
  onHead?.(partial);
  const ids: number[] = [];
  for (let id = 1; id <= last && ids.length < 8000; id += 1) ids.push(id);
  const ownedCalls = ids.flatMap((id) => [
    { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf" as const, args: [BigInt(id)] as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "seat" as const, args: [BigInt(id)] as const },
  ]);
  let open = 0;
  let missed = 0;
  const mineIds: number[] = [];
  let scanOk = true;
  const seats: TapeSeat[] = [];
  const mine = account?.toLowerCase() ?? "";
  try {
    const owned = ownedCalls.length ? await readChunk(ownedCalls) : [];
    for (let i = 0; i < ids.length; i += 1) {
      const owner = owned[i * 2];
      const seat = owned[i * 2 + 1];
      const seatRow = seat?.status === "success" && Array.isArray(seat.result) ? seat.result : null;
      if (seatRow && seatRow[3]) open += 1;
      const ownerAddr = owner?.status === "success" && typeof owner.result === "string" ? owner.result : null;
      if (!ownerAddr) missed += 1;
      const seatOwner = seatRow && typeof seatRow[0] === "string" ? seatRow[0].toLowerCase() : "";
      if (mine && ((ownerAddr && ownerAddr.toLowerCase() === mine) || seatOwner === mine)) mineIds.push(ids[i]);
    }
    if (missed > Math.max(8, Math.floor(ids.length / 20))) throw new Error("scan");
    const detailCalls = mineIds.flatMap((id) => [
      { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo" as const, args: [BigInt(id)] as const },
      { address: TAPE_MINE, abi: mineAbi, functionName: "pendingOf" as const, args: [BigInt(id)] as const },
      { address: TAPE_MINE, abi: mineAbi, functionName: "seat" as const, args: [BigInt(id)] as const },
    ]);
    const detail = detailCalls.length ? await readChunk(detailCalls) : [];
    for (let i = 0; i < mineIds.length; i += 1) {
      const info = detail[i * 3];
      const pending = detail[i * 3 + 1];
      const seat = detail[i * 3 + 2];
      const infoRow = info?.status === "success" && Array.isArray(info.result) ? info.result : null;
      const pendingAmt = pending?.status === "success" && typeof pending.result === "bigint" ? pending.result : null;
      const seatRow = seat?.status === "success" && Array.isArray(seat.result) ? seat.result : null;
      if (!infoRow || pendingAmt == null || !seatRow) continue;
      const gates = infoRow[3];
      if (typeof gates !== "bigint") continue;
      const on = Boolean(seatRow[3]);
      const share = on && weight > 0n ? (daily * gates) / weight : 0n;
      seats.push({ id: String(mineIds[i]), gates: gates.toString(), on, pending: pendingAmt, share: tapeText(share) });
    }
  } catch {
    scanOk = false;
  }
  seats.sort((a, b) => Number(a.on) - Number(b.on) || Number(b.id) - Number(a.id));
  return { supply, cap, weight, balance, start, daily, circuits: Math.max(0, last), open, seats, scanOk, scanning: false };
}

async function preflight(to: Hex, from: string, data: Hex) {
  const call = client.call({ account: from as Hex, to, data });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("slow")), 6_000);
  });
  try {
    await Promise.race([call, slow]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/revert|execution reverted/i.test(message)) throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function send(from: string, data: Hex): Promise<Hex> {
  await preflight(TAPE_MINE, from, data);
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: TAPE_MINE, data }],
  })) as Hex;
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error("revert");
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/revert|execution reverted/i.test(message)) throw err;
  }
  return hash;
}

export function openTape(from: string, id: bigint): Promise<Hex> {
  return send(from, encodeFunctionData({ abi: mineAbi, functionName: "open", args: [id] }));
}

export function claimTape(from: string, ids: bigint[]): Promise<Hex> {
  if (ids.length === 0) throw new Error("empty");
  return send(from, encodeFunctionData({ abi: mineAbi, functionName: "claimMany", args: [ids] }));
}