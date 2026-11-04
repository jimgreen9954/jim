export type MarginMode = "cross" | "iso";
export type AcctMode = "unified" | "port" | "manual";
export type NetStep = "open" | "close" | "flip" | "reject";

const KEY = "tl-margin-mode";

export function readModes(): { margin: MarginMode; acct: AcctMode } {
  if (typeof window === "undefined") return { margin: "iso", acct: "manual" };
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || "{}") as { margin?: string; acct?: string };
    return {
      margin: raw.margin === "cross" ? "cross" : "iso",
      acct: raw.acct === "unified" || raw.acct === "port" ? raw.acct : "manual",
    };
  } catch {
    return { margin: "iso", acct: "manual" };
  }
}

export function saveModes(margin: MarginMode, acct: AcctMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify({ margin, acct }));
}

export type MarginPlan = {
  lock: number;
  lev: number;
  notional: number;
  liq: number;
  spotUsdt: number;
  net: NetStep;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function sizeLock(notional: number, lev: number) {
  const typed = notional / lev;
  if (!(notional > 0) || !(typed > 0)) return { lock: 0, lev };
  return { lock: round2(Math.min(500, typed)), lev };
}

export function planMargin(input: {
  marginMode: MarginMode;
  acctMode: AcctMode;
  margin: number;
  lev: number;
  price: number;
  freeUsdt: number;
  spotQuote: number;
  intentLong: boolean;
  mine: { long: boolean; notional: number } | null;
}): MarginPlan {
  const lev0 = input.lev > 0 ? input.lev : 1;
  const typed = Number.isFinite(input.margin) ? input.margin : 0;
  const notional = typed > 0 ? typed * lev0 : 0;
  let net: NetStep = "open";
  let work = notional;
  const mine = input.mine;
  if (input.acctMode === "port" && mine && mine.long !== input.intentLong && mine.notional > 0 && notional > 0) {
    if (notional < mine.notional * 0.98) net = "reject";
    else if (notional <= mine.notional * 1.02) net = "close";
    else {
      net = "flip";
      work = notional - mine.notional;
    }
  }
  const sized = sizeLock(work, lev0);
  const spotUsdt = 0;
  const price = input.price > 0 ? input.price : 0;
  const liq =
    net === "close" || !(price > 0) || !(sized.lev > 0)
      ? 0
      : input.intentLong
        ? price * (1 - 0.5 / sized.lev)
        : price * (1 + 0.5 / sized.lev);
  return { lock: sized.lock, lev: sized.lev, notional: work, liq, spotUsdt, net };
}

export function modeLine(zh: boolean, plan: MarginPlan, typed: number, marginMode: MarginMode): string {
  const bits: string[] = [];
  if (plan.net === "close") bits.push(zh ? "这一笔只平掉现在的反向仓。" : "This only closes the opposite position.");
  else if (plan.net === "flip")
    bits.push(zh ? "先平掉现在的仓，再开剩下的。" : "The open position is closed first. Only the remainder is opened.");
  if (plan.net !== "close" && marginMode === "cross" && plan.lock > typed + 0.01)
    bits.push(
      zh
        ? `全仓锁进 ${plan.lock.toFixed(2)}，倍数改成 ${plan.lev}。`
        : `Cross locks ${plan.lock.toFixed(2)} at ${plan.lev}×.`,
    );
  if (plan.spotUsdt > 0)
    bits.push(zh ? "钱包 USDT 不够。现货不会自动卖掉。" : "Wallet USDT is short. Spot is not sold automatically.");
  return bits.join(" ");
}

export async function fundMargin(chain: "bsc" | "xlayer", from: string, usdtShort: number, bemPx: number) {
  if (!(usdtShort > 0) || !(bemPx > 0)) throw new Error("usdt");
  const bem = ((usdtShort / bemPx) * 1.04).toFixed(4);
  if (chain === "bsc") {
    const { swapBem } = await import("@/lib/bsc");
    await swapBem(from, "sell", bem);
    return;
  }
  const { formatUnits } = await import("viem");
  const { readOkbPurse, swapBemOkb, swapOkb } = await import("@/lib/okb");
  const before = await readOkbPurse(from);
  await swapBemOkb(from, "sell", bem);
  const after = await readOkbPurse(from);
  const got = after.okb > before.okb ? after.okb - before.okb : 0n;
  if (got <= 0n) throw new Error("usdt");
  await swapOkb(from, "sell", formatUnits(got, 18));
}
