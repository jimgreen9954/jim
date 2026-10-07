import { createPublicClient, defineChain, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { claimTape, TAPE } from "@/lib/tape-mine";
import { getProvider } from "@/lib/wallet";
import { connectXLayer, DEPLOYED, transferCircuit, transferTransistor, transistorHeld, XLAYER } from "@/lib/xlayer";

export const ASH = "0x000000000000000000000000000000000000dEaD" as const;

const tokenAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function CAP() view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

const circuitAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
]);

const xlayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER.rpc] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const client = createPublicClient({ chain: xlayer, transport: http(XLAYER.rpc) });

export type AshBoard = {
  tape: bigint;
  tapeSupply: bigint;
  tapeCap: bigint;
  nand: bigint;
  latch: bigint;
  circuits: number;
  taped: number;
  scanOk: boolean;
};

export async function readAsh(): Promise<AshBoard> {
  const [tape, tapeSupply, tapeCap, held, next] = await Promise.all([
    client.readContract({ address: TAPE, abi: tokenAbi, functionName: "balanceOf", args: [ASH] }),
    client.readContract({ address: TAPE, abi: tokenAbi, functionName: "totalSupply" }),
    client.readContract({ address: TAPE, abi: tokenAbi, functionName: "CAP" }),
    transistorHeld(ASH),
    client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "nextId" }),
  ]);
  const last = Number(next) - 1;
  const ids = Array.from({ length: Math.max(0, Math.min(last, 2000)) }, (_, i) => i + 1);
  let circuits = 0;
  let scanOk = true;
  try {
    for (let i = 0; i < ids.length; i += 80) {
      const slice = ids.slice(i, i + 80);
      const rows = await client.multicall({
        contracts: slice.map((id) => ({
          address: DEPLOYED.circuits,
          abi: circuitAbi,
          functionName: "ownerOf" as const,
          args: [BigInt(id)] as const,
        })),
        allowFailure: true,
      });
      for (const row of rows) {
        if (row.status === "success" && typeof row.result === "string" && row.result.toLowerCase() === ASH.toLowerCase()) circuits += 1;
      }
    }
  } catch {
    scanOk = false;
  }
  return { tape, tapeSupply, tapeCap, nand: held.nand, latch: held.latch, circuits, taped: Math.max(0, last), scanOk };
}

async function sendTape(from: string, amount: bigint): Promise<Hex> {
  if (amount < 1n) throw new Error("amount");
  const data = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [ASH, amount] });
  await client.call({ account: from as Hex, to: TAPE, data });
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [{ from, to: TAPE, data }] })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export function ashTape(from: string, amount: bigint): Promise<Hex> {
  return sendTape(from, amount);
}

export function ashWafer(from: string, id: 0 | 1, amount: bigint): Promise<Hex> {
  return transferTransistor(from, ASH, id, amount);
}

export async function ashCircuit(from: string, id: bigint, live: boolean): Promise<void> {
  if (live) await claimTape(from, [id]);
  await transferCircuit(from, ASH, id);
  if (live) await claimTape(from, [id]);
}
