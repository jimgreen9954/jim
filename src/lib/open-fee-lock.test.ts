import assert from "node:assert/strict";
import test from "node:test";
import { mayStartFee, parseFeeLock, type FeeLockRow } from "./open-fee-lock.ts";

const hash = "0x" + "ab".repeat(32);

test("a live wallet wait is not released by the clock or by a confirmation", () => {
  const lock: FeeLockRow = { holder: "page-a", hash, nonce: "1" };
  assert.equal(mayStartFee(lock, "page-b", true, false), false);
  assert.equal(mayStartFee(lock, "page-b", true, true), false);
  assert.equal(mayStartFee(lock, "page-a", true, false), true);
});

test("silence does not release the lock until the user confirms that page is closed", () => {
  const lock: FeeLockRow = { holder: "page-a", hash, nonce: "1" };
  assert.equal(mayStartFee(lock, "page-b", false, false), false);
  assert.equal(mayStartFee(lock, "page-b", false, true), true);
});

test("an old timed lock is still busy until it expires, and a nonce lock has no expiry", () => {
  const now = 1_700_000_000_000;
  const stale = JSON.stringify({ holder: "page-a", hash, exp: now - 1 });
  assert.equal(parseFeeLock(stale, now), null);
  const pending = JSON.stringify({ holder: "page-a", hash, exp: now + 60_000 });
  assert.equal(parseFeeLock(pending, now + 10 * 60_000), null);
  const held = JSON.stringify({ holder: "page-a", hash, nonce: "1" });
  assert.deepEqual(parseFeeLock(held, now + 24 * 60 * 60_000), { holder: "page-a", hash, nonce: "1" });
  assert.equal(mayStartFee(parseFeeLock(held, now + 24 * 60 * 60_000), "page-b", true, true), false);
});
