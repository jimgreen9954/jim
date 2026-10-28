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

export class TxPending extends Error {
  hash: Hex;
  paid = false;
  constructor(hash: Hex) {
    super("pending");
    this.hash = hash;
  }
}
