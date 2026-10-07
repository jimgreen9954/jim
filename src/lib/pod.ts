import { createServerFn } from "@tanstack/react-start";
import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, type Hex } from "viem";
import { bsc } from "viem/chains";
import { BSC, connectBsc } from "@/lib/bsc";
import { getProvider } from "@/lib/wallet";

export const POD = "0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46" as const;

const abi = parseAbi([
  "function dailyEmission() view returns (uint256)",
  "function currentRate() view returns (uint256)",
  "function totalMined() view returns (uint256)",
  "function totalForgone() view returns (uint256)",
  "function totalVerifWeight() view returns (uint256)",
  "function totalUnverWeight() view returns (uint256)",
  "function minerCount() view returns (uint256)",
  "function verifMinerCount() view returns (uint256)",
  "function minerKey(address,uint256) pure returns (bytes32)",
  "function pendingLive(bytes32) view returns (uint256)",
  "function claimMany(bytes32[])",
]);

const client = createPublicClient({ chain: bsc, transport: http(BSC.rpc) });

export type PodStats = {
  daily: string;
  mined: string;
  forgone: string;
  verifWeight: string;
  unverWeight: string;
  miners: string;
  verified: string;
};

export async function readPodStats(): Promise<PodStats> {
  const [rate, mined, forgone, verif, unver, count, verified] = await Promise.all([
    client.readContract({ address: POD, abi, functionName: "currentRate" }),
    client.readContract({ address: POD, abi, functionName: "totalMined" }),
    client.readContract({ address: POD, abi, functionName: "totalForgone" }),
    client.readContract({ address: POD, abi, functionName: "totalVerifWeight" }),
    client.readContract({ address: POD, abi, functionName: "totalUnverWeight" }),
    client.readContract({ address: POD, abi, functionName: "minerCount" }),
    client.readContract({ address: POD, abi, functionName: "verifMinerCount" }),
  ]);
  return {
    daily: formatUnits(rate * 86400n, 8),
    mined: formatUnits(mined, 8),
    forgone: formatUnits(forgone, 8),
    verifWeight: verif.toString(),
    unverWeight: unver.toString(),
    miners: count.toString(),
    verified: verified.toString(),
  };
}

export async function readPodPending(rows: { circuits: string; circuitId: number }[]): Promise<{ key: Hex; pending: bigint }[]> {
  return Promise.all(rows.map(async (row) => {
    const key = await client.readContract({
      address: POD,
      abi,
      functionName: "minerKey",
      args: [row.circuits as Hex, BigInt(row.circuitId)],
    });
    const pending = await client.readContract({ address: POD, abi, functionName: "pendingLive", args: [key] });
    return { key, pending };
  }));
}

export function bemText(amount: bigint): string {
  return formatUnits(amount, 8);
}

export async function claimPod(from: string, keys: Hex[]): Promise<Hex> {
  if (keys.length === 0) throw new Error("empty");
  const data = encodeFunctionData({ abi, functionName: "claimMany", args: [keys] });
  await client.call({ account: from as Hex, to: POD, data });
  await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: POD, data }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export const getPodMiners = createServerFn({ method: "POST" })
  .validator((input: { account?: string }) => {
    const account = (input?.account ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(account)) throw new Error("address");
    return { account };
  })
  .handler(async ({ data }) => {
    const { loadPodMiners } = await import("./pod.server");
    return loadPodMiners(data.account);
  });
