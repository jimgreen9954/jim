import { formatUnits, type Address } from "viem";

export type SgClock = { y: number; m: number; d: number };

export function sgClock(now = new Date()): SgClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { y: pick("year"), m: pick("month"), d: pick("day") };
}

/** Day 1 00:00 inclusive through day 8 00:00 exclusive, Singapore. */
export function claimWindowOpen(clock = sgClock()): boolean {
  return clock.d >= 1 && clock.d < 8;
}

export type MonthFee = { spotUsdt0: bigint; spotUsdt: bigint; partial: boolean };

/** Public nodes cap log queries near 100 blocks. A month is not readable here, so the page must not print 0. */
export async function readSpotDeskFee(_who: Address, _y: number, _m: number): Promise<MonthFee> {
  return { spotUsdt0: 0n, spotUsdt: 0n, partial: true };
}

export function rebateOf(paid: bigint, bps: number): bigint {
  if (paid <= 0n || bps >= 20) return 0n;
  return (paid * BigInt(20 - bps)) / 20n;
}

export function feeText(amount: bigint, decimals: number): string {
  const n = Number(formatUnits(amount, decimals));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
