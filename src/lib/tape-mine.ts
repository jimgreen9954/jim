import { createPublicClient, defineChain, encodeFunctionData, formatUnits, http, parseAbi, type Hex } from "viem";
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

const client = createPublicClient({ chain: xlayer, transport: http(XLAYER.rpc) });

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
};

const DAY = 7200n * 10n ** 8n;
const HALVING = 210_000n * 600n;

function dailyAt(start: bigint): bigint {
  const era = (BigInt(Math.floor(Date.now() / 1000)) - start) / HALVING;
  if (era < 0n || era >= 64n) return 0n;
  return DAY >> era;
}

export async function readTapeMine(account: string | null): Promise<TapeBoard> {
  const [supply, cap, weight, balance, start, next] = await Promise.all([
    client.readContract({ address: TAPE, abi: tokenAbi, functionName: "totalSupply" }),
    client.readContract({ address: TAPE, abi: tokenAbi, functionName: "CAP" }),
    client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "totalWeight" }),
    account
      ? client.readContract({ address: TAPE, abi: tokenAbi, functionName: "balanceOf", args: [account as Hex] })
      : Promise.resolve(0n),
    client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "start" }),
    client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "nextId" }),
  ]);
  if (cap !== 21_000_000n * 10n ** 8n) throw new Error("cap");
  const last = Number(next) - 1;
  const ids: number[] = [];
  for (let id = last; id >= 1 && ids.length < 300; id -= 1) ids.push(id);
  const calls = ids.flatMap((id) => [
    { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf" as const, args: [BigInt(id)] as const },
    { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo" as const, args: [BigInt(id)] as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "seat" as const, args: [BigInt(id)] as const },
    { address: TAPE_MINE, abi: mineAbi, functionName: "pendingOf" as const, args: [BigInt(id)] as const },
  ]);
  const read = calls.length
    ? await client.multicall({ contracts: calls, allowFailure: true, batchSize: 120 })
    : [];
  let open = 0;
  const seats: TapeSeat[] = [];
  const who = account?.toLowerCase() ?? "";
  const daily = dailyAt(start);
  for (let i = 0; i < ids.length; i += 1) {
    const owner = read[i * 4];
    const info = read[i * 4 + 1];
    const seat = read[i * 4 + 2];
    const pending = read[i * 4 + 3];
    if (seat?.status === "success" && seat.result[3]) open += 1;
    if (!who || owner?.status !== "success" || owner.result.toLowerCase() !== who) continue;
    if (info?.status !== "success" || pending?.status !== "success" || seat?.status !== "success") continue;
    const gates = info.result[3];
    const on = Boolean(seat.result[3]);
    const share = on && weight > 0n ? (daily * gates) / weight : 0n;
    seats.push({
      id: String(ids[i]),
      gates: gates.toString(),
      on,
      pending: pending.result,
      share: tapeText(share),
    });
  }
  seats.sort((a, b) => Number(b.on) - Number(a.on) || Number(b.id) - Number(a.id));
  return { supply, cap, weight, balance, start, daily, circuits: Math.max(0, last), open, seats };
}

async function send(from: string, data: Hex): Promise<Hex> {
  await client.call({ account: from as Hex, to: TAPE_MINE, data });
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: TAPE_MINE, data }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export function openTape(from: string, id: bigint): Promise<Hex> {
  return send(from, encodeFunctionData({ abi: mineAbi, functionName: "open", args: [id] }));
}

export function claimTape(from: string, ids: bigint[]): Promise<Hex> {
  if (ids.length === 0) throw new Error("empty");
  return send(from, encodeFunctionData({ abi: mineAbi, functionName: "claimMany", args: [ids] }));
}
