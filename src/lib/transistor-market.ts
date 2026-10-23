import { createServerFn } from "@tanstack/react-start";

export type Gate = {
  id: string;
  name: string;
  kind: "NAND" | "LATCH";
  tokenId: number;
  transistors: string;
  price: number;
  bid: number;
  ask: number;
  changePct: number;
  volumeBnb: number;
  capUsd: number;
};

export type Level = { price: number; qty: number; total: number; maker: string };

export type TransistorDesk = {
  ok: boolean;
  error: string | null;
  asOf: string;
  gates: Gate[];
  bids: Level[];
  asks: Level[];
};

export const getTransistorDesk = createServerFn({ method: "POST" })
  .validator((input: { token?: string; id?: number }) => ({
    token: input?.token ?? "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087",
    id: input?.id ?? 0,
  }))
  .handler(async ({ data }): Promise<TransistorDesk> => {
    const { loadTransistorDesk } = await import("./transistor-market.server");
    return loadTransistorDesk(data.token, data.id);
  });
