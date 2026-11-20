import type { Hex } from "viem";

export const XLAYER = {
  chainId: 196,
  hex: "0xc4",
  name: "X Layer",
  rpc: "https://rpc.xlayer.tech",
  explorer: "https://www.oklink.com/xlayer",
} as const;

export const FEE_TO = "0x823b9F6A93Ac44Ce5A469823A336c15b6117054D" as const;
export const BSC_SAFE = "0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd" as const;
export const XLAYER_SAFE = "0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c" as const;

export function safeFor(chain: 56 | 196 | "bsc" | "xlayer"): Hex {
  return chain === 56 || chain === "bsc" ? BSC_SAFE : XLAYER_SAFE;
}

export function assertSafeDeployer(chain: 56 | 196 | "bsc" | "xlayer", from: string) {
  if (from.toLowerCase() !== safeFor(chain).toLowerCase()) throw new Error("safe");
}
export const PREV_BSC_VAULT = "0x138524b76E10b1c60060CD11e8946d24D861Fe23" as const;
export const PREV_XLAYER_VAULT = "0x721f32Efae0276B3C77652a192A14c3a5Da20aCd" as const;
export const BSC_VAULT = "0xdB9B6B6180480869DC2183C289480261F8E9Cd5A" as const;
export const XLAYER_VAULT = "0xe895122Ba5aF841704730B999a73F9562F5bd46E" as const;

export class TxPending extends Error {
  hash: Hex;
  paid = false;
  constructor(hash: Hex) {
    super("pending");
    this.hash = hash;
  }
}
