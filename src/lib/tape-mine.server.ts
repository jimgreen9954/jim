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
const OPEN_POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as const;
const SPOT = "0x68F66fAf7b29E30D0740934F81EB266F6ff17428" as const;
const OLD_SPOT = "0x154E82c6a2ac121906D29af0EE81131E93B57860" as const;
const BUYBACK = "0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF" as const;
const TAPE_LEND = "0x425285da21ed3eabe64550d1be7dcabcf6f9e851" as const;
const CIRCUIT_LOCK = "0x06c877cc158d9ca3547220f9fc156f39bce7013c" as const;
const WAFER_LOCK = "0xA28390924607F08aaD8d03F512B41b6a1c012Ace" as const;
const termAbi = parseAbi([
  "function tapeStakePot() view returns (uint256 staked, uint256 pot)",
  "function bemStakePot() view returns (uint256 staked, uint256 pot)",
]);
const lockAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function seat(uint256) view returns (address owner, uint8 term, uint64 start, uint64 unlock, uint256 circuitId, uint256 gates)",
]);
const TAPE_TERM = "0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A" as const;
const TAPE_TERM_NEW = "0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833" as const;

function pair(value: unknown): readonly [bigint, bigint] {
  if (Array.isArray(value)) return [typeof value[0] === "bigint" ? value[0] : 0n, typeof value[1] === "bigint" ? value[1] : 0n];
  const row = value as { staked?: bigint; pot?: bigint };
  return [row?.staked ?? 0n, row?.pot ?? 0n];
}
const DAY = 7200n * 10n ** 8n;
const HALVING = 210_000n * 600n;
const CAP = 21_000_000n * 10n ** 8n;

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
  circuitHeld: string;
  waferHeld: string;
  termPrincipal: string;
  termReward: string;
  termHeld: string;
  spotHeld: string;
  buybackHeld: string;
  lendHeld: string;
  pendingNet: string;
  pendingStaked: string;
  staked: number;
  stakedLive: number;
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

async function lockStakeCount(): Promise<number> {
  try {
    const next = await client.readContract({ address: CIRCUIT_LOCK, abi: lockAbi, functionName: "nextId" });
    const n = Number(next) - 1;
    if (!Number.isFinite(n) || n < 1) return 0;
    const rows = await client.multicall({
      contracts: Array.from({ length: n }, (_, index) => ({
        address: CIRCUIT_LOCK,
        abi: lockAbi,
        functionName: "seat" as const,
        args: [BigInt(index + 1)] as const,
      })),
      allowFailure: true,
    });
    let live = 0;
    for (const row of rows) {
      if (row.status !== "success" || !Array.isArray(row.result)) continue;
      const owner = row.result[0];
      if (typeof owner === "string" && !/^0x0{40}$/i.test(owner)) live += 1;
    }
    return live;
  } catch {
    return 0;
  }
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
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [OPEN_POOL] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [CIRCUIT_LOCK] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [WAFER_LOCK] as const },
    { address: TAPE_TERM, abi: termAbi, functionName: "tapeStakePot" as const },
    { address: TAPE_TERM, abi: termAbi, functionName: "bemStakePot" as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [TAPE_TERM] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [SPOT] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [OLD_SPOT] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [BUYBACK] as const },
    { address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [TAPE_LEND] as const },
    ...(account ? [{ address: TAPE, abi: tokenAbi, functionName: "balanceOf" as const, args: [who] as const }] : []),
  ];
  const head = await client.multicall({ contracts: calls, allowFailure: false });
  const cap = head[1] as bigint;
  if (cap !== CAP) throw new Error("cap");
  const start = head[3] as bigint;
  const next = head[4] as bigint;
  let termPrincipal = pair(head[10])[0];
  let termReward = pair(head[11])[1];
  let termHeld = head[12] as bigint;
  try {
    const more = await client.multicall({
      contracts: [
        { address: TAPE_TERM_NEW, abi: termAbi, functionName: "tapeStakePot" },
        { address: TAPE_TERM_NEW, abi: termAbi, functionName: "bemStakePot" },
        { address: TAPE, abi: tokenAbi, functionName: "balanceOf", args: [TAPE_TERM_NEW] },
      ],
      allowFailure: true,
    });
    if (more[0].status === "success") termPrincipal += pair(more[0].result)[0];
    if (more[1].status === "success") termReward += pair(more[1].result)[1];
    if (more[2].status === "success" && typeof more[2].result === "bigint") termHeld += more[2].result;
  } catch { /* new book */ }
  return {
    supply: head[0] as bigint,
    cap,
    weight: head[2] as bigint,
    balance: account ? (head[17] as bigint) : 0n,
    start,
    daily: dailyAt(start),
    last: Number(next) - 1,
    burned: head[5] as bigint,
    pooled: (head[6] as bigint) + (head[7] as bigint),
    circuitHeld: head[8] as bigint,
    waferHeld: head[9] as bigint,
    termPrincipal,
    termReward,
    termHeld,
    spotHeld: (head[13] as bigint) + (head[14] as bigint),
    buybackHeld: head[15] as bigint,
    lendHeld: head[16] as bigint,
    locked: (head[8] as bigint) + (head[9] as bigint) + ((head[13] as bigint) + (head[14] as bigint)) + (head[15] as bigint) + (head[16] as bigint) + (termHeld > 0n ? termHeld : termPrincipal + termReward),
    stakedLocks: await lockStakeCount(),
  };
}

function pack(
  row: Awaited<ReturnType<typeof headOf>>,
  open: number,
  seats: TapeWire["seats"],
  scanOk: boolean,
  scanning: boolean,
  net: { pendingNet: bigint; pendingStaked: bigint; staked: number; stakedLive: number; stakedWeight: bigint } = { pendingNet: 0n, pendingStaked: 0n, staked: 0, stakedLive: 0, stakedWeight: 0n },
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
    circuitHeld: row.circuitHeld.toString(),
    waferHeld: row.waferHeld.toString(),
    termPrincipal: row.termPrincipal.toString(),
    termReward: row.termReward.toString(),
    termHeld: row.termHeld.toString(),
    spotHeld: row.spotHeld.toString(),
    buybackHeld: row.buybackHeld.toString(),
    lendHeld: row.lendHeld.toString(),
    pendingNet: net.pendingNet.toString(),
    pendingStaked: net.pendingStaked.toString(),
    staked: net.staked,
    stakedLive: net.stakedLive,
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
  const body = pack(row, 0, [], false, true, {
    pendingNet: 0n,
    pendingStaked: 0n,
    staked: row.stakedLocks,
    stakedLive: 0,
    stakedWeight: 0n,
  });
  cache.set(key, { at: Date.now(), body });
  return body;
}

type Census = {
  at: number;
  last: number;
  open: number;
  staked: number;
  stakedLive: number;
  stakedWeight: bigint;
  pendingNet: bigint;
  pendingStaked: bigint;
  owners: Map<string, number[]>;
};
let census: Census | null = null;
let censusFlight: Promise<Census> | null = null;

async function ownerCensus(last: number): Promise<Census> {
  if (census && census.last === last && Date.now() - census.at < 300_000) return census;
  if (censusFlight) return censusFlight;
  censusFlight = (async () => {
    const ids: number[] = [];
    for (let id = 1; id <= last && ids.length < 8000; id += 1) ids.push(id);
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400));
    const parts = await Promise.all(chunks.map((slice) => client.multicall({
      contracts: slice.flatMap((id) => [
        { address: CIRCUITS, abi: circuitAbi, functionName: "ownerOf" as const, args: [BigInt(id)] as const },
        { address: MINE, abi: mineAbi, functionName: "seat" as const, args: [BigInt(id)] as const },
      ]),
      allowFailure: true,
      batchSize: 1024,
    })));
    const owned = parts.flat() as { status: string; result?: unknown }[];
    const owners = new Map<string, number[]>();
    let open = 0;
    let staked = 0;
    let stakedLive = 0;
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
          stakedLive += 1;
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
    census = { at: Date.now(), last, open, staked, stakedLive, stakedWeight, pendingNet, pendingStaked, owners };
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
