import { createServerFn } from "@tanstack/react-start";

export type CircuitSigned = {
  exchange: `0x${string}`;
  maker: `0x${string}`;
  collection: `0x${string}`;
  tokenId: string;
  nonce: string;
  price: string;
  expiry: string;
  payout: `0x${string}`;
  feeBps: number;
  feeEpoch: string | null;
  schemaVersion: number;
  signature: `0x${string}`;
  buyerCost: string;
};

export type CircuitRow = {
  key: string;
  name: string;
  tokenId: string;
  nand: number;
  latch: number;
  nIn: number;
  nOut: number;
  nState: number;
  gates: number;
  status: string;
  hash: number;
  crystal: number | null;
  hashPx: number | null;
  dayBem: number | null;
  dayPx: number | null;
  ask: number | null;
  askWei: string | null;
  bid: number | null;
  officialId: number | null;
  signed: CircuitSigned | null;
  seller: string;
  collection: string;
  listedAt: number;
  paybackDays: number | null;
};

export type CircuitPrint = {
  ts: number;
  name: string;
  tokenId: string;
  nand: number;
  latch: number;
  nIn: number;
  nOut: number;
  nState: number;
  status: string;
  hash: number;
  crystal: number | null;
  hashPx: number | null;
  dayBem: number | null;
  dayPx: number | null;
  price: number;
  buyer: string;
  seller: string;
  tx: string;
};

export type CircuitBar = { t: number; o: number; h: number; l: number; c: number; v: number };

export type CircuitBoard = {
  ok: boolean;
  error: string | null;
  asOf: string | null;
  refDayPx: number | null;
  vol24h: number | null;
  trades24h: number | null;
  listed: number | null;
  circuits: number | null;
  holders: number | null;
  listedHash: number | null;
  official: CircuitRow[];
  other: CircuitRow[];
  mine: CircuitRow[];
  prints: CircuitPrint[];
  bars: CircuitBar[];
};

export type CapacityBid = {
  orderId: string;
  maker: string;
  dailyCapacityPriceWei: string;
  remainingBudgetWei: string;
  minCircuitH: string;
  maxCircuitH: string;
  feeBps: number;
};

export type CapacityBook = {
  ok: boolean;
  exchange: string;
  rateAtomic: string;
  verifiedWeight: string;
  unverifiedBps: number;
  bids: CapacityBid[];
};

export const getCapacityBook = createServerFn({ method: "GET" }).handler(async (): Promise<CapacityBook> => {
  const { loadCapacityBook } = await import("./circuit-board.server");
  return loadCapacityBook();
});

export const getCircuitBoard = createServerFn({ method: "GET" })
  .validator((input: { account?: string } | undefined) => ({
    account: typeof input?.account === "string" && /^0x[a-fA-F0-9]{40}$/.test(input.account) ? input.account : "",
  }))
  .handler(async ({ data }) => {
    const { loadCircuitBoard } = await import("./circuit-board.server");
    return loadCircuitBoard(data.account);
  });
