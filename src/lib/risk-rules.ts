/** Rules for the next perpetual book. The books already deployed do not charge these. */

export const FUND_CAP = 0.0005;

export function fundingPreview(mark: number, last: number): { raw: number; capped: number } | null {
  if (!(mark > 0) || !(last > 0)) return null;
  const raw = (last - mark) / mark;
  if (!Number.isFinite(raw)) return null;
  return { raw, capped: Math.max(-FUND_CAP, Math.min(FUND_CAP, raw)) };
}

export function fundClock(now = Date.now()): { left: string; at: string } {
  const step = 8 * 60 * 60 * 1000;
  const next = Math.ceil(now / step) * step;
  const ms = Math.max(0, next - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const at = new Date(next).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "numeric", day: "numeric" });
  return { left: `${h}时${m}分`, at };
}

export function pct(n: number, digits = 4): string {
  const v = n * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}
