export type Arm = {
  account: string;
  perp: string;
  long: boolean;
  tp: number;
  sl: number;
  spent: boolean;
  /** Deal this arm already bound to. Empty until a new position appears. */
  deal?: string;
  /** Deal id at the moment the arm was saved. Do not fire on that same id. */
  before?: string;
  /** Close was rejected or failed. Do not pop the wallet again until the user asks. */
  hold?: boolean;
};

const KEY = "tapeliquid-stops-v1";

export function easyBand(entry: number, lev: number, long: boolean): { tp: number; sl: number } {
  const safe = Math.max(1, lev);
  const tpMove = 1 / safe;
  const slMove = 0.5 / safe;
  if (long) return { tp: entry * (1 + tpMove), sl: Math.max(entry * (1 - slMove), entry * 0.01) };
  return { tp: Math.max(entry * (1 - tpMove), entry * 0.01), sl: entry * (1 + slMove) };
}

export function readArm(account: string, perp: string): Arm | null {
  if (typeof window === "undefined") return null;
  try {
    const rows = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Arm[];
    return rows.find((row) => row.account.toLowerCase() === account.toLowerCase() && row.perp.toLowerCase() === perp.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

export function writeArm(arm: Arm) {
  const rows = (() => {
    try {
      return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Arm[];
    } catch {
      return [];
    }
  })().filter((row) => !(row.account.toLowerCase() === arm.account.toLowerCase() && row.perp.toLowerCase() === arm.perp.toLowerCase()));
  rows.unshift(arm);
  window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 20)));
}

export function clearArm(account: string, perp: string) {
  const rows = (() => {
    try {
      return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as Arm[];
    } catch {
      return [];
    }
  })().filter((row) => !(row.account.toLowerCase() === account.toLowerCase() && row.perp.toLowerCase() === perp.toLowerCase()));
  window.localStorage.setItem(KEY, JSON.stringify(rows));
}
