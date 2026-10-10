import { createPublicClient, defineChain, fallback, http, parseAbi, type Hex } from "viem";

const CIRCUITS = "0x69F663931209096037474d7C20402232E5C762cA" as const;

const mineAbi = parseAbi([
  "function totalWeight() view returns (uint256)",
  "function start() view returns (uint256)",
  "function pendingOf(uint256) view returns (uint256)",
  "function seat(uint256) view returns (address owner, uint256 weight, uint256 paid, bool on)",
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

const TAPE = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as const;
const MINE = "0x60b1b7cae1bbd0e84ac3e1e43f933712f3ab67e8" as const;
const ASH = "0x000000000000000000000000000000000000dEaD" as const;
const POOL = "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641" as const;
const CIRCUIT_LOCK = "0x06c877cc158d9ca3547220f9fc156f39bce7013c" as const;
const WAFER_LOCK = "0xA28390924607F08aaD8d03F512B41b6a1c012Ace" as const;
const CAP = 21_000_000n * 10n ** 8n;
const DAY = 7200n * 10n ** 8n;
const HALVING = 210_000n * 600n;

const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://xlayerrpc.okx.com"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const client = createPublicClient({
  chain: xlayer,
  transport: fallback(
    ["https://xlayerrpc.okx.com", "https://rpc.xlayer.tech", "https://xlayer.drpc.org"].map((url) => http(url, { timeout: 8_000, retryCount: 0 })),
    { rank: false },
  ),
});

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
  pendingNet: string;
  pendingStaked: string;
  staked: number;
  stakedWeight: string;
  scanOk: boolean;
  scanning: boolean;
  seats: { id: string; gates: string; on: boolean; pending: string; share: string }[];
};

const cache = new Map<string, { at: number; body: TapeWire }>();

function dailyAt(start: bigint): bigint {
  const era = (BigInt(Math.floor(Date.now() / 1000)) - start) / HALVING;
  if (era < 0n || era >= 64n) return 0n;
  return DAY >> era;
}

function text(amount: bigint): string {
  const neg = amount < 0n;
  const v = neg ? -amount : amount;
  const whole = v / 10n ** 8n;
  const frac = (v % 10n ** 8n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? `.${frac}` : ""}`;
}

async function headOf(account: string | null) {
  const who = (account ?? "") as Hex;
  const calls = [
    { address: TAPE, abi: tokenAbi, functionName: "totalSupply" as const },
    { address: TAPE, abi: tokenAbi, functionName: "CAP" as const },
    { address: MINE, abi: mineAbi, functionName: "totalWeight" as const },
    { address: MINE, abi: mineAbi, functionName: "start" as const },
    { address: CIRCUITS, abi: circuitAbi, functionName: "nextId" as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [ASH] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [POOL] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [CIRCUIT_LOCK] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [WAFER_LOCK] as const },
    ...(account ? [{ address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [who] as const }] : []),
  ];
  const head = await client.multicall({ contracts: calls, allowFailure: false });
  const cap = head[1] as bigint;
  if (cap !== CAP) throw new Error("cap");
  const start = head[3] as bigint;
  const next = head[4] as bigint;
  return {
    supply: head[0] as bigint,
    cap,
    weight: head[2] as bigint,
    balance: account ? (head[9] as bigint) : 0n,
    start,
    daily: dailyAt(start),
    last: Number(next) - 1,
    burned: head[5] as bigint,
    pooled: head[6] as bigint,
    locked: (head[7] as bigint) + (head[8] as bigint),
  };
}

function pack(
  row: Awaited<ReturnType<typeof headOf>>,
  open: number,
  seats: TapeWire["seats"],
  scanOk: boolean,
  scanning: boolean,
  net: { pendingNet: bigint; pendingStaked: bigint; staked: number; stakedWeight: bigint } = { pendingNet: 0n, pendingStaked: 0n, staked: 0, stakedWeight: 0n },
): TapeWire {
  return {
    supply: row.supply.toString(),
    cap: row.cap.toString(),
    weight: row.weight.toString(),
    balance: row.balance.toString(),
    start: row.start.toString(),
    daily: row.daily.toString(),
    circuits: Math.max(0, row.last),
    open,
    burned: row.burned.toString(),
    pooled: row.pooled.toString(),
    locked: row.locked.toString(),
    pendingNet: net.pendingNet.toString(),
    pendingStaked: net.pendingStaked.toString(),
    staked: net.staked,
    stakedWeight: net.stakedWeight.toString(),
    scanOk,
    scanning,
    seats,
  };
}

export async function loadTapeHead(account: string | null): Promise<TapeWire> {
  const key = `h:${(account ?? "").toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 12_000) return hit.body;
  const row = await headOf(account);
  const body = pack(row, 0, [], false, true);
  cache.set(key, { at: Date.now(), body });
  return body;
}

type Census = {
  at: number;
  last: number;
  open: number;
  staked: number;
  stakedWeight: bigint;
  pendingNet: bigint;
  pendingStaked: bigint;
  owners: Map<string, number[]>;
};
let census: Census | null = null;
let censusFlight: Promise<Census> | null = null;

async function ownerCensus(last: number): Promise<Census> {
  if (census && census.last === last && Date.now() - census.at < 45_000) return census;
  if (censusFlight) return censusFlight;
  censusFlight = (async () => {
    const ids: number[] = [];
    for (let id = 1; id <= last && ids.length < 8000; id += 1) ids.push(id);
    const calls = ids.flatMap((id) => [
      { address: CIRCUITS, abi: circuitAbi, functionName: "ownerOf" as const, args: [BigInt(id)] as const },
      { address: MINE, abi: mineAbi, functionName: "seat" as const, args: [BigInt(id)] as const },
    ]);
    const owned: { status: string; result?: unknown }[] = [];
    for (let i = 0; i < calls.length; i += 240) {
      const part = await client.multicall({ contracts: calls.slice(i, i + 240) as never, allowFailure: true, batchSize: 240 });
      owned.push(...(part as { status: string; result?: unknown }[]));
    }
    const owners = new Map<string, number[]>();
    let open = 0;
    let staked = 0;
    let stakedWeight = 0n;
    let missed = 0;
    const openIds: number[] = [];
    const stakedOn = new Set<number>();
    const lock = CIRCUIT_LOCK.toLowerCase();
    for (let i = 0; i < ids.length; i += 1) {
      const owner = owned[i * 2];
      const seat = owned[i * 2 + 1];
      const seatRow = seat?.status === "success" && Array.isArray(seat.result) ? seat.result : null;
      const ownerAddr = owner?.status === "success" && typeof owner.result === "string" ? owner.result.toLowerCase() : "";
      if (!ownerAddr) missed += 1;
      const seatOwner = seatRow && typeof seatRow[0] === "string" ? seatRow[0].toLowerCase() : "";
      const locked = seatOwner === lock || ownerAddr === lock;
      if (locked) staked += 1;
      if (seatRow && seatRow[3]) {
        open += 1;
        openIds.push(ids[i]);
        if (locked) {
          stakedWeight += typeof seatRow[1] === "bigint" ? seatRow[1] : 0n;
          stakedOn.add(ids[i]);
        }
      }
      for (const who of new Set([ownerAddr, seatOwner].filter((item) => item && item !== "0x0000000000000000000000000000000000000000"))) {
        const list = owners.get(who) ?? [];
        list.push(ids[i]);
        owners.set(who, list);
      }
    }
    if (missed > Math.max(8, Math.floor(ids.length / 20))) throw new Error("scan");
    let pendingNet = 0n;
    let pendingStaked = 0n;
    for (let i = 0; i < openIds.length; i += 180) {
      const slice = openIds.slice(i, i + 180);
      const part = await client.multicall({
        contracts: slice.map((id) => ({ address: MINE, abi: mineAbi, functionName: "pendingOf" as const, args: [BigInt(id)] as const })),
        allowFailure: true,
        batchSize: 180,
      });
      part.forEach((row, index) => {
        const amt = row.status === "success" && typeof row.result === "bigint" ? row.result : 0n;
        pendingNet += amt;
        if (stakedOn.has(slice[index])) pendingStaked += amt;
      });
    }
    census = { at: Date.now(), last, open, staked, stakedWeight, pendingNet, pendingStaked, owners };
    return census;
  })().finally(() => {
    censusFlight = null;
  });
  return censusFlight;
}

export async function loadTapeSeats(account: string | null): Promise<TapeWire> {
  const key = `s:${(account ?? "").toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 20_000) return hit.body;
  const row = await headOf(account);
  const found = await ownerCensus(row.last);
  const who = account?.toLowerCase() ?? "";
  const mineIds = who ? (found.owners.get(who) ?? []) : [];
  const detailCalls = mineIds.flatMap((id) => [
    { address: CIRCUITS, abi: circuitAbi, functionName: "circuitInfo" as const, args: [BigInt(id)] as const },
    { address: MINE, abi: mineAbi, functionName: "pendingOf" as const, args: [BigInt(id)] as const },
    { address: MINE, abi: mineAbi, functionName: "seat" as const, args: [BigInt(id)] as const },
  ]);
  const detail: { status: string; result?: unknown }[] = [];
  for (let i = 0; i < detailCalls.length; i += 180) {
    const part = await client.multicall({ contracts: detailCalls.slice(i, i + 180) as never, allowFailure: true, batchSize: 180 });
    detail.push(...(part as { status: string; result?: unknown }[]));
  }
  const seats: TapeWire["seats"] = [];
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
    const share = on && row.weight > 0n ? (row.daily * gates) / row.weight : 0n;
    seats.push({ id: String(mineIds[i]), gates: gates.toString(), on, pending: pendingAmt.toString(), share: text(share) });
  }
  seats.sort((a, b) => Number(a.on) - Number(b.on) || Number(b.id) - Number(a.id));
  const body = pack(row, found.open, seats, true, false, found);
  cache.set(key, { at: Date.now(), body });
  return body;
}
