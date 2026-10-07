import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { connectXLayer, DEPLOYED, XLAYER } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";
import { TAPE_MINE } from "@/lib/tape-mine";

export const TAPE_LOCK = "0xA28390924607F08aaD8d03F512B41b6a1c012Ace" as const;

export const LOCK_TERMS = [
  { id: 0, zh: "180 天", en: "180 days", sec: 180 * 86400 },
  { id: 1, zh: "365 天", en: "365 days", sec: 365 * 86400 },
  { id: 2, zh: "3 年", en: "3 years", sec: 1095 * 86400 },
  { id: 3, zh: "4 年", en: "4 years", sec: 1460 * 86400 },
  { id: 4, zh: "5 年", en: "5 years", sec: 1825 * 86400 },
] as const;

const abi = parseAbi([
  "function seat(uint256) view returns (address owner, uint8 kind, uint8 term, uint64 start, uint64 unlock, uint256 amount, uint256 ref, uint256 gates, uint256 tape)",
  "function ownedCount(address) view returns (uint256)",
  "function ownedId(address,uint256) view returns (uint256)",
  "function lockWafer(uint8,uint256,uint8) returns (uint256)",
  "function lockCircuit(uint256,uint8) returns (uint256)",
  "function harvest(uint256)",
  "function release(uint256)",
  "function fan(uint256[],address[])",
]);

const approveAbi = parseAbi([
  "function isApprovedForAll(address,address) view returns (bool)",
  "function setApprovalForAll(address,bool)",
]);

const mineAbi = parseAbi([
  "function totalWeight() view returns (uint256)",
  "function pendingOf(uint256) view returns (uint256)",
]);

const client = createPublicClient({ transport: http(XLAYER.rpc) });

export type LockSeat = {
  id: string;
  kind: number;
  term: number;
  start: number;
  unlock: number;
  amount: bigint;
  ref: string;
  gates: bigint;
  tape: bigint;
  pending: bigint;
};

export async function readLocks(account: string | null): Promise<{ weight: bigint; seats: LockSeat[] }> {
  const weight = await client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "totalWeight" });
  if (!account) return { weight, seats: [] };
  const count = await client.readContract({ address: TAPE_LOCK, abi, functionName: "ownedCount", args: [account as Hex] });
  const n = Number(count);
  if (n === 0) return { weight, seats: [] };
  const start = Math.max(0, n - 30);
  const ids = await Promise.all(
    Array.from({ length: n - start }, (_, i) =>
      client.readContract({ address: TAPE_LOCK, abi, functionName: "ownedId", args: [account as Hex, BigInt(start + i)] }),
    ),
  );
  const rows = await Promise.all(ids.map((id) => client.readContract({ address: TAPE_LOCK, abi, functionName: "seat", args: [id] })));
  const seats: LockSeat[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row[0] === "0x0000000000000000000000000000000000000000") continue;
    const kind = Number(row[1]);
    const ref = row[6];
    const pending = kind === 2
      ? await client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "pendingOf", args: [ref] }).catch(() => 0n)
      : 0n;
    seats.push({
      id: ids[i].toString(),
      kind,
      term: Number(row[2]),
      start: Number(row[3]),
      unlock: Number(row[4]),
      amount: row[5],
      ref: ref.toString(),
      gates: row[7],
      tape: row[8],
      pending,
    });
  }
  return { weight, seats };
}

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to, data }] })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

async function ensureApproved(from: string, token: Hex) {
  const ok = await client.readContract({
    address: token,
    abi: approveAbi,
    functionName: "isApprovedForAll",
    args: [from as Hex, TAPE_LOCK],
  });
  if (ok) return;
  await send(from, token, encodeFunctionData({ abi: approveAbi, functionName: "setApprovalForAll", args: [TAPE_LOCK, true] }));
}

export async function lockWafer(from: string, kind: 0 | 1, amount: bigint, term: number): Promise<Hex> {
  if (amount < 1n) throw new Error("amount");
  await ensureApproved(from, DEPLOYED.transistors);
  const data = encodeFunctionData({ abi, functionName: "lockWafer", args: [kind, amount, term] });
  await client.call({ account: from as Hex, to: TAPE_LOCK, data });
  return send(from, TAPE_LOCK, data);
}

export async function lockCircuit(from: string, circuitId: bigint, term: number): Promise<Hex> {
  await ensureApproved(from, DEPLOYED.circuits);
  const data = encodeFunctionData({ abi, functionName: "lockCircuit", args: [circuitId, term] });
  await client.call({ account: from as Hex, to: TAPE_LOCK, data });
  return send(from, TAPE_LOCK, data);
}

export async function harvestLock(from: string, id: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "harvest", args: [id] });
  await client.call({ account: from as Hex, to: TAPE_LOCK, data });
  return send(from, TAPE_LOCK, data);
}

export async function releaseLock(from: string, id: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "release", args: [id] });
  await client.call({ account: from as Hex, to: TAPE_LOCK, data });
  return send(from, TAPE_LOCK, data);
}

export async function fanCircuits(from: string, ids: bigint[], tos: Hex[]): Promise<Hex> {
  if (ids.length === 0 || ids.length !== tos.length || ids.length > 30) throw new Error("len");
  await ensureApproved(from, DEPLOYED.circuits);
  const data = encodeFunctionData({ abi, functionName: "fan", args: [ids, tos] });
  await client.call({ account: from as Hex, to: TAPE_LOCK, data });
  return send(from, TAPE_LOCK, data);
}
