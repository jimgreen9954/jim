import { parseAbi, type PublicClient } from "viem";

const abi = parseAbi(["function ownerOf(uint256) view returns (address)"]);

/** Highest circuit id that exists. nextId on this processor is the latest mint, but a count that is one short, one long, or a few behind still resolves to the real tip. */
export async function circuitTip(node: PublicClient, circuits: `0x${string}`, next: number): Promise<number> {
  const reported = Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0;
  if (reported < 1) return 0;
  const start = Math.max(1, reported - 1);
  const end = reported + 32;
  const ids = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  try {
    const rows = await node.multicall({
      contracts: ids.map((id) => ({
        address: circuits,
        abi,
        functionName: "ownerOf" as const,
        args: [BigInt(id)] as const,
      })),
      allowFailure: true,
    });
    let last = 0;
    rows.forEach((row, index) => {
      if (row.status === "success") last = ids[index];
    });
    return last > 0 ? last : reported;
  } catch {
    return reported;
  }
}
