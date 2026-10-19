import { loadHoldings } from "./holdings.server";

export type { ChipRow, CircuitRow, Holdings } from "./holdings";

export function getHoldings(input: { data: { account: string } }) {
  return loadHoldings(input.data.account);
}
