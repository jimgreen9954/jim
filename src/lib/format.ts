export function fmt(n: number, d: number): string {
  if (!Number.isFinite(n)) return "—";
  const neg = n < 0;
  const [a, b] = Math.abs(n).toFixed(d).split(".");
  const whole = (a ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${whole}${b ? `.${b}` : ""}`;
}

export function fmtPx(n: number): string {
  return fmt(n, 4);
}

export function fmtSz(n: number): string {
  return fmt(n, 2);
}

export function fmtUsd(n: number): string {
  return fmt(n, 2);
}

export function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(2)}%`;
}

export function fmtInt(n: number): string {
  return fmt(n, 0);
}

export function fmtFlex(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1000) return fmt(n, 2);
  if (a >= 1) return fmt(n, 4);
  if (a >= 0.0001) return fmt(n, 6);
  return n.toExponential(2);
}
