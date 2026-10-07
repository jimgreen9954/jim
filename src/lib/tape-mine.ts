import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, type Hex } from "viem";
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

const client = createPublicClient({ transport: http(XLAYER.rpc) });

export function tapeText(amount: bigint): string {
  return formatUnits(amount, 8);
}

export async function readTapeMine(account: string | null): Promise<{
  supply: bigint;
  cap: bigint;
  weight: bigint;
  balance: bigint;
  start: bigint;
}> {
  const [supply, cap, weight, balance, start] = await Promise.all([
    client.readContract({ address: TAPE, abi: tokenAbi, functionName: "totalSupply" }),
    client.readContract({ address: TAPE, abi: tokenAbi, functionName: "CAP" }),
    client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "totalWeight" }),
    account
      ? client.readContract({ address: TAPE, abi: tokenAbi, functionName: "balanceOf", args: [account as Hex] })
      : Promise.resolve(0n),
    client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "start" }),
  ]);
  if (cap !== 21_000_000n * 10n ** 8n) throw new Error("cap");
  return { supply, cap, weight, balance, start };
}

export type TapeSeat = { id: string; gates: string; on: boolean; pending: bigint };

export async function readTapeSeats(account: string): Promise<TapeSeat[]> {
  const next = await client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "nextId" });
  const last = Number(next) - 1;
  if (last < 1) return [];
  const start = Math.max(1, last - 39);
  const ids: number[] = [];
  for (let id = last; id >= start; id -= 1) ids.push(id);
  const rows = await Promise.all(ids.map(async (id) => {
    try {
      const owner = await client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf", args: [BigInt(id)] });
      if (owner.toLowerCase() !== account.toLowerCase()) return null;
      const info = await client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo", args: [BigInt(id)] });
      const seat = await client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "seat", args: [BigInt(id)] });
      const pending = await client.readContract({ address: TAPE_MINE, abi: mineAbi, functionName: "pendingOf", args: [BigInt(id)] });
      return { id: String(id), gates: info[3].toString(), on: Boolean(seat[3]), pending };
    } catch {
      return null;
    }
  }));
  return rows.filter((row): row is TapeSeat => row != null);
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
