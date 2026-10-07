import { createServerFn } from "@tanstack/react-start";

/** Official BSC markets. askMarket is null on tapeout.net, so this app does not invent asks. */
export const OFFICIAL = {
  transistorMarket: "0xA6a80C1919a8326022d7c601a488888C13aA16E4",
  circuitMarket: "0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f",
  feeTo: "0x823b9F6A93Ac44Ce5A469823A336c15b6117054D",
  feeBps: 20,
  chips: [
    { name: "TapeOut", transistors: "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087" },
    { name: "Behemoth", transistors: "0xE2DfD802081C7a05341E20b6582b04b908e8550c" },
    { name: "Genesis CPU", transistors: "0x1d23Bf70ec6bAAD95f396Ea38f8A8415119dFDE6" },
  ],
} as const;

export type OfficialBid = {
  id: number;
  buyer: string;
  transistors: string;
  tokenId: number;
  name: string;
  kind: "NAND" | "LATCH";
  priceBnb: number;
  priceWei: string;
  remaining: number;
};

export type OfficialList = {
  id: number;
  seller: string;
  circuits: string;
  circuitId: string;
  name: string;
  priceBnb: number;
  priceWei: string;
  gates: number;
  nIn: number;
  nOut: number;
};

export type OfficialBooks = {
  ok: boolean;
  error: string | null;
  asOf: string | null;
  block: number | null;
  bids: OfficialBid[];
  lists: OfficialList[];
};

export const getOfficialBooks = createServerFn({ method: "GET" }).handler(async (): Promise<OfficialBooks> => {
  const { loadOfficialBooks } = await import("./official-books.server");
  return loadOfficialBooks();
});
