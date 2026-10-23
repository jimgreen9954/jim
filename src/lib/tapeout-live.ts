import { createServerFn } from "@tanstack/react-start";

export type LivePrint = {
  ts: number;
  bnb: number;
  qty: number;
  bem: number | null;
};

export type LiveTransistor = {
  id: string;
  name: string;
  kind: "NAND" | "LATCH";
  lastBnb: number | null;
  lastTs: number;
  trades: number;
  qty: number;
  volBnb: number;
  trades24: number;
  qty24: number;
  volBnb24: number;
  bem: number | null;
  usd: number | null;
  bidBnb: number | null;
  bidBem: number | null;
  bidQty: number;
  prints: LivePrint[];
};

export type TapeoutLive = {
  ok: boolean;
  error: string | null;
  asOf: string | null;
  bem: { usd: number; change24: number | null; vol24: number; pair: string } | null;
  bnbUsd: number | null;
  pod: { miners: number; verified: number; dailyBem: number; block: number } | null;
  rows: LiveTransistor[];
  listed: number;
  traded: number;
  bidding: number;
};

export const getTapeoutLive = createServerFn({ method: "GET" }).handler(async (): Promise<TapeoutLive> => {
  const { loadTapeoutLive } = await import("./tapeout-live.server");
  return loadTapeoutLive();
});
