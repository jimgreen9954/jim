import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { DEPLOYED } from "@/lib/xlayer";
import { ensureProvider } from "@/lib/wallet";

export const CIRCUIT_SPLIT = "0x08bd11220b6a87f1d16b54b5521d4e90bb0d1b1b" as Hex;

const abi = parseAbi([
  "function split(uint256 tokenId)",
  "function join(uint256 tokenId)",
  "function claim(uint256 tokenId)",
  "function shares(uint256 tokenId, address account) view returns (uint256)",
  "function pending(uint256 tokenId, address account) view returns (uint256)",
  "function FEE_BPS() view returns (uint256)",
]);

const nftAbi = parseAbi([
  "function getApproved(uint256 tokenId) view returns (address)",
  "function approve(address to, uint256 tokenId)",
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
  return send(from, CIRCUIT_SPLIT, data);
}

export async function joinCircuit(from: string, tokenId: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "join", args: [tokenId] });
  return send(from, CIRCUIT_SPLIT, data);
}

export async function claimSplitTape(from: string, tokenId: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "claim", args: [tokenId] });
  return send(from, CIRCUIT_SPLIT, data);
}
