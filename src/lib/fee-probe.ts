import { createPublicClient, http, parseAbi, type Address } from "viem";
import { BSC, FEE_TO, BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { GATE } from "@/lib/gate-chain";
import { BSC_REBATE, KNOWN_XPERP } from "@/lib/perp";
import { XLAYER } from "@/lib/xlayer";
import type { FeeRow } from "@/lib/fee-lock";

const abi = parseAbi(["function FEE_TO() view returns (address)"]);

async function readOne(rpc: string, address: Address, name: string): Promise<FeeRow> {
  try {
    const client = createPublicClient({ transport: http(rpc, { timeout: 12_000 }) });
    const got = await client.readContract({ address, abi, functionName: "FEE_TO" });
    return { name, got, ok: [FEE_TO, BSC_SAFE, XLAYER_SAFE].some((fee) => got.toLowerCase() === fee.toLowerCase()) };
  } catch {
    return { name, got: null, ok: false };
  }
}

export function probeFees(): Promise<FeeRow[]> {
  return Promise.all([
    readOne(BSC.rpc, BSC_REBATE, "BSC 永续"),
    readOne(XLAYER.rpc, KNOWN_XPERP, "X Layer 永续"),
    readOne(BSC.rpc, GATE, "晶体管永续"),
  ]);
}
