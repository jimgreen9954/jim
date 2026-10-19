import { createServerFn } from "@tanstack/react-start";

export type Invitee = {
  user: string;
  margin: string;
  notional: string;
  reward: string;
};

export type RebateBook = {
  live: boolean;
  caughtUp: boolean;
  head: string;
  scanned: string;
  invitees: Invitee[];
  counted: string;
};

export const getRebateBook = createServerFn({ method: "GET" })
  .validator((input: { account?: string }) => {
    const account = input?.account ?? "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(account)) throw new Error("account");
    return { account };
  })
  .handler(async ({ data }): Promise<RebateBook> => {
    const { loadRebateBook } = await import("./rebate-index.server");
    return loadRebateBook(data.account);
  });
