import { createPublicClient, http, type Hex } from "viem";

const XPERP = "0xE8Ed0fE7a7aaEF822b2e5Ce9679ccACcF3aEFF56";
const GATE = "0x2b909Ecc36a24D3dD3695a38B11Cb40302454899";
const abi = [{ name: "referrerOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] }] as const;
const bsc = createPublicClient({ transport: http("https://bsc-dataseed.binance.org") });
const xlayer = createPublicClient({ transport: http("https://rpc.xlayer.tech") });
const zero = "0x0000000000000000000000000000000000000000";

export type DeskParts = { swapIn: bigint; reward: bigint; desk: bigint; referrer: Hex | null };

export function inviteCut(fee: bigint, referred: boolean): { charge: bigint; reward: bigint; desk: bigint } {
  if (!referred || fee <= 0n) return { charge: fee, reward: 0n, desk: fee };
  const discount = (fee * 4n) / 100n;
  const reward = (fee * 6n) / 100n;
  const charge = fee - discount;
  return { charge, reward, desk: charge - reward };
}

export async function referrerOf(chain: "bsc" | "xlayer", from: string): Promise<Hex | null> {
  try {
    const who = await (chain === "xlayer" ? xlayer : bsc).readContract({
      address: (chain === "xlayer" ? XPERP : GATE) as Hex,
      abi,
      functionName: "referrerOf",
      args: [from as Hex],
    });
    return who.toLowerCase() === zero ? null : who;
  } catch {
    return null;
  }
}

export async function deskParts(chain: "bsc" | "xlayer", from: string, amountIn: bigint): Promise<DeskParts> {
  const fee = (amountIn * 20n) / 10_000n;
  const referrer = await referrerOf(chain, from);
  const cut = inviteCut(fee, referrer != null);
  return { swapIn: amountIn - cut.charge, reward: cut.reward, desk: cut.desk, referrer };
}
