import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi } from "viem";

const CPUNK = "0xB5ac1dddc158a639D4499aad2d8F393989D4bD34" as const;
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const client = createPublicClient({ transport: http("https://rpc.xlayer.tech", { timeout: 20_000 }) });
const coinAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ownerAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function publicMinted() view returns (uint32)",
  "function reserve() view returns (uint32)",
]);
const tryAbi = parseAbi(["function tryAggregate(bool requireSuccess,(address target,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])"]);

async function ownersOf(ids: number[]): Promise<(string | null)[]> {
  if (!ids.length) return [];
  const calls = ids.map((id) => ({
    target: CPUNK,
    callData: encodeFunctionData({ abi: ownerAbi, functionName: "ownerOf", args: [BigInt(id)] }),
  }));
  const data = encodeFunctionData({ abi: tryAbi, functionName: "tryAggregate", args: [false, calls] });
  const raw = await client.call({ to: MULTICALL, data });
  const decoded = decodeFunctionResult({ abi: tryAbi, functionName: "tryAggregate", data: raw.data ?? "0x" });
  return decoded.map((row) => (row.success && row.returnData.length >= 66 ? `0x${row.returnData.slice(-40)}`.toLowerCase() : null));
}

/** Same holder scan as readCpunkWallet. Only the ids are returned. */
export async function readHeldPunks(address: `0x${string}`): Promise<number[]> {
  const key = address.toLowerCase();
  const [count, pub, reserve] = await Promise.all([
    client.readContract({ address: CPUNK, abi: coinAbi, functionName: "balanceOf", args: [address] }),
    client.readContract({ address: CPUNK, abi: ownerAbi, functionName: "publicMinted" }),
    client.readContract({ address: CPUNK, abi: ownerAbi, functionName: "reserve" }),
  ]);
  const want = Number(count);
  const ids: number[] = [];
  if (want <= 0) return ids;
  const seen = new Set<number>();
  const bands: number[] = [];
  const push = (id: number) => {
    if (id < 1 || seen.has(id)) return;
    seen.add(id);
    bands.push(id);
  };
  const range = (from: number, to: number) => {
    for (let id = from; id <= to; id += 1) push(id);
  };
  const pubStart = Number(reserve) + 1;
  range(pubStart, pubStart + Number(pub) - 1);
  range(1, Math.min(999, Number(reserve)));
  range(6020, Number(reserve));
  range(1000, 6019);
  const take = async (slice: number[]) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await ownersOf(slice);
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    throw new Error("ids");
  };
  for (let index = 0; index < bands.length && ids.length < want; index += 400) {
    const wave = [0, 1, 2, 3, 4].map((slot) => bands.slice(index + slot * 80, index + (slot + 1) * 80)).filter((slice) => slice.length);
    const rows = await Promise.all(wave.map((slice) => take(slice)));
    rows.forEach((owners, slot) => {
      owners.forEach((owner, place) => {
        if (owner === key) ids.push(wave[slot][place]);
      });
    });
    ids.sort((a, b) => a - b);
  }
  return ids;
}
