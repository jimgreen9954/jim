/** A fee lock is held until the page that asked the wallet lets go. The clock does not release it. */

export type FeeLockRow = { holder: string; hash: string; nonce: string };

export function parseFeeLock(raw: string | null, now: number): FeeLockRow | null {
  if (!raw) return null;
  try {
    const row = JSON.parse(raw) as { holder?: string; hash?: string; nonce?: string; exp?: number };
    if (!row?.holder) return null;
    if (row.nonce) return { holder: row.holder, hash: row.hash || "", nonce: row.nonce };
    if (typeof row.exp === "number" && row.exp > now) return { holder: row.holder, hash: row.hash || "", nonce: "" };
    return null;
  } catch {
    return null;
  }
}

/**
 * Another tab may start a payment only when nobody holds the lock, or the holder is this tab,
 * or the holding page did not answer. A live wallet prompt answers, so age never makes it free.
 */
export function mayStartFee(lock: FeeLockRow | null, me: string, holderAlive: boolean): boolean {
  if (!lock || lock.holder === me) return true;
  return !holderAlive;
}
