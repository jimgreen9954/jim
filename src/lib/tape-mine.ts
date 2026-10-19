import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, defineChain, encodeFunctionData, fallback, formatUnits, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { connectXLayer, DEPLOYED, myCircuits, XLAYER } from "@/lib/xlayer";
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

export type TapeClaim = { tx: string; amount: bigint; ts: number };

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

type ClaimIndex = { tip: number; covered: number; rows: { tx: string; to: string; amount: string; ts: number }[] };

async function pullMints(from: bigint, to: bigint, account: string): Promise<{ tx: string; amount: bigint; block: bigint }[]> {
  const logs = await client.getLogs({
    address: TAPE,
    event: transferEvent,
    args: { from: "0x0000000000000000000000000000000000000000", to: account as Hex },
    fromBlock: from,
    toBlock: to,
  }).catch(() => null);
  if (!logs) return [];
  return logs.map((log) => ({ tx: log.transactionHash ?? "", amount: log.args.value ?? 0n, block: log.blockNumber ?? 0n }));
}

export async function readTapeClaims(account: string): Promise<TapeClaim[]> {
  const who = account.toLowerCase();
  const byTx = new Map<string, TapeClaim>();
  try {
    const index = await loadClaimIndex();
    for (const row of index?.rows ?? []) {
      if (row.to.toLowerCase() !== who) continue;
      const prev = byTx.get(row.tx);
      const amount = BigInt(row.amount);
      if (prev) prev.amount += amount;
      else byTx.set(row.tx, { tx: row.tx, amount, ts: row.ts });
    }
  } catch { /* Cached claims still show. */ }
  try {
    const tip = await client.getBlockNumber();
    const start = tip > 240n ? tip - 240n : 0n;
    const cuts = [start, start + 80n, start + 160n].filter((from) => from <= tip);
    const parts = await Promise.all(cuts.map((from, i) => {
      const to = i === cuts.length - 1 ? tip : cuts[i + 1] - 1n;
      return pullMints(from, to > tip ? tip : to, account);
    }));
    const fresh = parts.flat().filter((row) => row.tx && !byTx.has(row.tx));
    if (fresh.length) {
      const anchor = await client.getBlock({ blockNumber: tip }).then((block) => ({ tip: Number(tip), ts: Number(block.timestamp) })).catch(() => null);
      for (const row of fresh) {
        const prev = byTx.get(row.tx);
        const ts = anchor ? anchor.ts - (anchor.tip - Number(row.block)) : 0;
        if (prev) prev.amount += row.amount;
        else byTx.set(row.tx, { tx: row.tx, amount: row.amount, ts });
      }
    }
  } catch { /* The saved list is already on screen. */ }
  return [...byTx.values()].sort((a, b) => b.ts - a.ts);
}

let claimIndex: ClaimIndex | null = null;
let claimIndexFlight: Promise<ClaimIndex | null> | null = null;

function loadClaimIndex(): Promise<ClaimIndex | null> {
  if (claimIndex) return Promise.resolve(claimIndex);
  if (!claimIndexFlight) {
    claimIndexFlight = fetch("/tape-claims.json")
      .then((res) => (res.ok ? res.json() as Promise<ClaimIndex> : null))
      .catch(() => null)
      .then((row) => {
        claimIndex = row;
        return row;
      });
  }
  return claimIndexFlight;
}

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
  burned: bigint;
  pooled: bigint;
  locked: bigint;
  circuitHeld: bigint;
  waferHeld: bigint;
  termPrincipal: bigint;
  termReward: bigint;
  termHeld: bigint;
  pendingNet: bigint;
  pendingStaked: bigint;
  staked: number;
  stakedLive: number;
  stakedWeight: bigint;
  seats: TapeSeat[];
  scanOk: boolean;
  scanning: boolean;
};

const LOCKS = [
  "0x06c877cc158d9ca3547220f9fc156f39bce7013c",
  "0xA28390924607F08aaD8d03F512B41b6a1c012Ace",
] as const;
const POOL = "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641";
const ASH = "0x000000000000000000000000000000000000dEaD";
const CIRCUIT_LOCK = LOCKS[0].toLowerCase();
const CIRCUIT_BOOK = "0x154e82c6a2ac121906d29af0ee81131e93b57860";
const HALVING = 210_000n * 600n;
const CAP = 21_000_000n * 10n ** 8n;
const DAY = 7200n * 10n ** 8n;
export const TAPE_BOOK = {
  ash: ASH,
  pool: POOL,
  circuit: LOCKS[0],
  wafer: LOCKS[1],
} as const;

export function tapeEra(start: bigint): { era: bigint; next: bigint } {
  const now = BigInt(Math.floor(Date.now() / 1000));
  const era = now <= start ? 0n : (now - start) / HALVING;
  return { era, next: start + (era + 1n) * HALVING };
}

function dailyAt(start: bigint): bigint {
  const era = (BigInt(Math.floor(Date.now() / 1000)) - start) / HALVING;
  if (era < 0n || era >= 64n) return 0n;
  return DAY >> era;
}

export async function readTapePace(): Promise<{ daily: bigint; weight: bigint } | null> {
  try {
    const [weight, start] = await client.multicall({
      contracts: [
        { address: TAPE_MINE, abi: mineAbi, functionName: "totalWeight" },
        { address: TAPE_MINE, abi: mineAbi, functionName: "start" },
      ],
      allowFailure: false,
    });
    return { daily: dailyAt(start), weight };
  } catch {
    return null;
  }
}

export async function readSeatFlags(ids: string[]): Promise<Record<string, boolean>> {
  const unique = [...new Set(ids.filter((id) => /^\d+$/.test(id)))].slice(0, 48);
  if (!unique.length) return {};
  const rows = await client.multicall({
    contracts: unique.map((id) => ({
      address: TAPE_MINE,
      abi: mineAbi,
      functionName: "seat" as const,
      args: [BigInt(id)] as const,
    })),
    allowFailure: true,
  });
  const out: Record<string, boolean> = {};
  unique.forEach((id, index) => {
    const row = rows[index];
    if (!row || row.status !== "success") return;
    const result = row.result as readonly [string, bigint, bigint, boolean];
    out[id] = Boolean(result[3]);
  });
  return out;
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
  burned: string;
  pooled: string;
  locked: string;
  circuitHeld: string;
  waferHeld: string;
  termPrincipal: string;
  termReward: string;
  termHeld: string;
  pendingNet: string;
  pendingStaked: string;
  staked: number;
  stakedLive: number;
  stakedWeight: string;
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
    burned: BigInt(wire.burned ?? "0"),
    pooled: BigInt(wire.pooled ?? "0"),
    locked: BigInt(wire.locked ?? "0"),
    circuitHeld: BigInt(wire.circuitHeld ?? "0"),
    waferHeld: BigInt(wire.waferHeld ?? "0"),
    termPrincipal: BigInt(wire.termPrincipal ?? "0"),
    termReward: BigInt(wire.termReward ?? "0"),
    termHeld: BigInt(wire.termHeld ?? "0"),
    pendingNet: BigInt(wire.pendingNet ?? "0"),
    pendingStaked: BigInt(wire.pendingStaked ?? "0"),
    staked: wire.staked ?? 0,
    stakedLive: wire.stakedLive ?? 0,
    stakedWeight: BigInt(wire.stakedWeight ?? "0"),
    scanOk: wire.scanOk,
    scanning: wire.scanning,
    seats: wire.seats.map((row) => ({ ...row, pending: BigInt(row.pending) })),
  };
}

let mineFlight: Promise<TapeBoard> | null = null;
let mineKey = "";
const MINE_KEY = "tapeliquid-mine-board-v1";

export function peekTapeMine(account: string | null): TapeBoard | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(window.localStorage.getItem(MINE_KEY) ?? "") as { account?: string; board?: TapeWire };
    if (!saved?.board || (saved.account ?? "") !== (account ?? "").toLowerCase()) return null;
    return boardFrom(saved.board);
  } catch {
    return null;
  }
}

function rememberTapeMine(account: string | null, board: TapeBoard) {
  if (typeof window === "undefined" || !board.scanOk) return;
  const wire: TapeWire = {
    supply: board.supply.toString(), cap: board.cap.toString(), weight: board.weight.toString(), balance: board.balance.toString(),
    start: board.start.toString(), daily: board.daily.toString(), circuits: board.circuits, open: board.open,
    burned: board.burned.toString(), pooled: board.pooled.toString(), locked: board.locked.toString(),
    circuitHeld: board.circuitHeld.toString(), waferHeld: board.waferHeld.toString(),
    termPrincipal: board.termPrincipal.toString(), termReward: board.termReward.toString(), termHeld: board.termHeld.toString(),
    pendingNet: board.pendingNet.toString(), pendingStaked: board.pendingStaked.toString(),
    staked: board.staked, stakedLive: board.stakedLive, stakedWeight: board.stakedWeight.toString(),
    seats: board.seats.map((row) => ({ ...row, pending: row.pending.toString() })),
    scanOk: true, scanning: false,
  };
  try { window.localStorage.setItem(MINE_KEY, JSON.stringify({ account: (account ?? "").toLowerCase(), board: wire })); } catch { /* The next read still hits the chain. */ }
}

export function readTapeMine(account: string | null, onHead?: (board: TapeBoard) => void): Promise<TapeBoard> {
  const key = (account ?? "").toLowerCase();
  const cached = peekTapeMine(account);
  if (cached) onHead?.({ ...cached, scanning: true });
  if (mineFlight && mineKey === key) return mineFlight;
  mineKey = key;
  mineFlight = readThroughSite(account, onHead).then((board) => {
    rememberTapeMine(account, board);
    return board;
  }).finally(() => {
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

async function withHeld(account: string | null, board: TapeBoard): Promise<TapeBoard> {
  if (!account) return board;
  try {
    const held = await myCircuits(account);
    const seen = new Set(board.seats.map((row) => row.id));
    const extra = held.filter((row) => !seen.has(row.id)).map((row) => ({ id: row.id, gates: row.gates, on: false, pending: 0n, share: "0" }));
    if (!extra.length) return board;
    const seats = [...extra, ...board.seats].sort((a, b) => Number(a.on) - Number(b.on) || Number(b.id) - Number(a.id));
    return { ...board, seats, scanOk: true, scanning: false };
  } catch {
    return board;
  }
}

async function readThroughSite(account: string | null, onHead?: (board: TapeBoard) => void): Promise<TapeBoard> {
  if (import.meta.env.VITE_TAPE_STATIC === "1") return withHeld(account, await loadTapeMine(account, onHead, true));
  try {
    const head = boardFrom(await until(getTapeHead({ data: { account: account ?? "" } }), 8_000));
    onHead?.({ ...head, scanning: true, seats: [], scanOk: false });
    try {
      const full = boardFrom(await until(getTapeSeats({ data: { account: account ?? "" } }), 20_000));
      return full.scanOk ? full : withHeld(account, full);
    } catch {
      return withHeld(account, { ...head, scanning: false });
    }
  } catch {
    return withHeld(account, await loadTapeMine(account, onHead, false));
  }
}

async function readChunk(contracts: readonly unknown[]) {
  const size = 400;
  const jobs = [];
  for (let i = 0; i < contracts.length; i += size) {
    const slice = contracts.slice(i, i + size);
    jobs.push(client.multicall({ contracts: slice as never, allowFailure: true }));
  }
  const parts = await Promise.all(jobs);
  return parts.flat() as { status: string; result?: unknown }[];
}

const termAbi = parseAbi([
  "function tapeStakePot() view returns (uint256 staked, uint256 pot)",
  "function bemStakePot() view returns (uint256 staked, uint256 pot)",
]);
const TAPE_TERM = "0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A" as const;

function pair(value: unknown): readonly [bigint, bigint] {
  if (Array.isArray(value)) return [typeof value[0] === "bigint" ? value[0] : 0n, typeof value[1] === "bigint" ? value[1] : 0n];
  const row = value as { staked?: bigint; pot?: bigint };
  return [row?.staked ?? 0n, row?.pot ?? 0n];
}

async function loadTapeMine(account: string | null, onHead?: (board: TapeBoard) => void, scan = true): Promise<TapeBoard> {
  const who = (account ?? "") as Hex;
  const headCalls = [
    { address: TAPE, abi: tokenAbi, functionName: "totalSupply" as const },
    { address: TAPE, abi: tokenAbi, functionName: "CAP" as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "totalWeight" as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "start" as const },
    { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "nextId" as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [ASH as Hex] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [POOL as Hex] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [LOCKS[0] as Hex] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [LOCKS[1] as Hex] as const },
    { address: TAPE_TERM, abi: termAbi, functionName: "tapeStakePot" as const },
    { address: TAPE_TERM, abi: termAbi, functionName: "bemStakePot" as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [TAPE_TERM] as const },
    ...(account ? [{ address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [who] as const }] : []),
  ];
  const head = await client.multicall({ contracts: headCalls, allowFailure: false });
  const supply = head[0] as bigint;
  const cap = head[1] as bigint;
  const weight = head[2] as bigint;
  const start = head[3] as bigint;
  const next = head[4] as bigint;
  const burned = head[5] as bigint;
  const pooled = head[6] as bigint;
  const circuitHeld = head[7] as bigint;
  const waferHeld = head[8] as bigint;
  const termPrincipal = pair(head[9])[0];
  const termReward = pair(head[10])[1];
  const termHeld = head[11] as bigint;
  const locked = circuitHeld + waferHeld + (termHeld > 0n ? termHeld : termPrincipal + termReward);
  const balance = account ? (head[12] as bigint) : 0n;
  if (cap !== CAP) throw new Error("cap");
  const daily = dailyAt(start);
  const last = Number(next) - 1;
  const partial: TapeBoard = {
    supply, cap, weight, balance, start, daily,
    circuits: Math.max(0, last),
    open: 0,
    burned,
    pooled,
    locked,
    circuitHeld,
    waferHeld,
    termPrincipal,
    termReward,
    termHeld,
    pendingNet: 0n,
    pendingStaked: 0n,
    staked: 0,
    stakedLive: 0,
    stakedWeight: 0n,
    seats: [],
    scanOk: false,
    scanning: true,
  };
  onHead?.(partial);
  if (!scan) return { ...partial, scanning: false };
  const ids: number[] = [];
  for (let id = 1; id <= last && ids.length < 8000; id += 1) ids.push(id);
  const ownedCalls = ids.flatMap((id) => [
    { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf" as const, args: [BigInt(id)] as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "seat" as const, args: [BigInt(id)] as const },
  ]);
  let open = 0;
  let staked = 0;
  let stakedLive = 0;
  let stakedWeight = 0n;
  let missed = 0;
  const mineIds: number[] = [];
  const openIds: number[] = [];
  const stakedOn = new Set<number>();
  let scanOk = true;
  const seats: TapeSeat[] = [];
  const mine = account?.toLowerCase() ?? "";
  let pendingNet = 0n;
  let pendingStaked = 0n;
  try {
    const owned = ownedCalls.length ? await readChunk(ownedCalls) : [];
    for (let i = 0; i < ids.length; i += 1) {
      const owner = owned[i * 2];
      const seat = owned[i * 2 + 1];
      const seatRow = seat?.status === "success" && Array.isArray(seat.result) ? seat.result : null;
      const ownerAddr = owner?.status === "success" && typeof owner.result === "string" ? owner.result : null;
      if (!ownerAddr) missed += 1;
      const seatOwner = seatRow && typeof seatRow[0] === "string" ? seatRow[0].toLowerCase() : "";
      const locked = seatOwner === CIRCUIT_LOCK || ownerAddr?.toLowerCase() === CIRCUIT_LOCK;
      if (locked) staked += 1;
      if (seatRow && seatRow[3]) {
        open += 1;
        openIds.push(ids[i]);
        if (locked) {
          stakedLive += 1;
          stakedWeight += typeof seatRow[1] === "bigint" ? seatRow[1] : 0n;
          stakedOn.add(ids[i]);
        }
      }
      const holds = Boolean(ownerAddr && mine && ownerAddr.toLowerCase() === mine);
      const mining = Boolean(seatRow && seatRow[3] && seatOwner === mine);
      if (holds || mining) mineIds.push(ids[i]);
    }
    if (missed > Math.max(8, Math.floor(ids.length / 20))) throw new Error("scan");
    const pendingCalls = openIds.map((id) => ({ address: TAPE_MINE, abi: mineAbi, functionName: "pendingOf" as const, args: [BigInt(id)] as const }));
    const pendingRows = pendingCalls.length ? await readChunk(pendingCalls) : [];
    openIds.forEach((id, index) => {
      const row = pendingRows[index];
      const amt = row?.status === "success" && typeof row.result === "bigint" ? row.result : 0n;
      pendingNet += amt;
      if (stakedOn.has(id)) pendingStaked += amt;
    });
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
  return { supply, cap, weight, balance, start, daily, circuits: Math.max(0, last), open, burned, pooled, locked, circuitHeld, waferHeld, termPrincipal, termReward, termHeld, pendingNet, pendingStaked, staked, stakedLive, stakedWeight, seats, scanOk, scanning: false };
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
    if (/revert|execution reverted/i.test(message)) throw new Error("revert");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function send(from: string, data: Hex): Promise<Hex> {
  const signer = await connectXLayer();
  if (signer.toLowerCase() !== from.toLowerCase()) throw new Error("account");
  await preflight(TAPE_MINE, signer, data);
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const reported = await eth.request({ method: "eth_chainId" }).catch(() => "");
  const text = typeof reported === "string" ? reported : String(reported ?? "");
  if (Number.parseInt(text, text.startsWith("0x") ? 16 : 10) !== 196) throw new Error("chain");
  let hash: Hex;
  try {
    hash = (await eth.request({
      method: "eth_sendTransaction",
      params: [{ from: signer, to: TAPE_MINE, data }],
    })) as Hex;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    const code = typeof err === "object" && err && "code" in err ? Number((err as { code?: number }).code) : NaN;
    if (code === 4001 || /rejected|denied|cancel|取消/i.test(message)) throw new Error("rejected");
    if (/insufficient|funds|余额/i.test(message)) throw new Error("gas");
    if (/chain|网络/i.test(message)) throw new Error("chain");
    throw new Error("revert");
  }
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export async function openTape(from: string, id: bigint): Promise<Hex> {
  const signer = await connectXLayer();
  void from;
  const owner = (await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "ownerOf",
    args: [id],
  })).toLowerCase();
  if (owner === CIRCUIT_BOOK) throw new Error("listed");
  if (owner === CIRCUIT_LOCK) throw new Error("locked");
  if (owner !== signer.toLowerCase()) throw new Error("owner");
  const seat = await client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "seat", args: [id] });
  if (seat[3]) throw new Error("open");
  return send(signer, encodeFunctionData({ abi: mineAbi, functionName: "open", args: [id] }));
}

export function claimTape(from: string, ids: bigint[]): Promise<Hex> {
  if (ids.length === 0) throw new Error("empty");
  return send(from, encodeFunctionData({ abi: mineAbi, functionName: "claimMany", args: [ids] }));
}