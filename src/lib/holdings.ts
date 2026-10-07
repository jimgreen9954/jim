import { createServerFn } from "@tanstack/react-start";

export type ChipRow = {
  chain: "bsc" | "xlayer";
  name: string;
  transistors: string;
  circuits: string;
  nand: string;
  latch: string;
  ours: boolean;
};

export type CircuitRow = {
  chain: "bsc" | "xlayer";
  name: string;
  circuits: string;
  id: string | null;
  count: string;
  listed: boolean;
  priceBnb: number | null;
};

export type Holdings = {
  ok: boolean;
  error: string | null;
  asOf: string;
  scanned: number;
  bnb: string;
  chips: ChipRow[];
  circuits: CircuitRow[];
};

export const getHoldings = createServerFn({ method: "POST" })
  .validator((input: { account?: string }) => {
    const account = (input?.account ?? "").trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(account)) throw new Error("address");
    return { account };
  })
  .handler(async ({ data }): Promise<Holdings> => {
    const { loadHoldings } = await import("./holdings.server");
    return loadHoldings(data.account);
  });
