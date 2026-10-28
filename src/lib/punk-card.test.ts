import assert from "node:assert/strict";
import test from "node:test";
import { punk } from "./circuit-punk.ts";
import { bestHeld, deskFeeBps, forge } from "./punk-card.ts";

function take(where: (id: number) => boolean, n: number, skip = new Set<number>()): number[] {
  const ids: number[] = [];
  for (let id = 1; id <= 10_000 && ids.length < n; id += 1) {
    if (skip.has(id) || !where(id)) continue;
    ids.push(id);
  }
  assert.equal(ids.length, n);
  return ids;
}

test("two different commons forge copper, not a higher card", () => {
  const portrait = take((id) => punk(id).tier === "普通" && punk(id).type === "晶圆人像", 1)[0];
  const mascot = take((id) => punk(id).tier === "普通" && punk(id).type === "吉祥晶粒", 1)[0];
  const made = forge([portrait, mascot]);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  assert.equal(made.card.kind, "copper");
  assert.equal(made.card.feeAll, 16);
  assert.equal(made.card.feeMain, 14);
  assert.equal(deskFeeBps(made.card, made.card.main ?? "spot"), 14);
});

test("twenty commons never become the real ultraviolet card", () => {
  const ids = [
    ...take((id) => punk(id).tier === "普通" && punk(id).type === "晶圆人像", 10),
    ...take((id) => punk(id).tier === "普通" && punk(id).type === "吉祥晶粒", 10),
  ];
  const made = forge(ids);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  assert.equal(made.card.kind, "faux");
  assert.equal(made.card.feeAll, 8);
  assert.equal(made.card.feeMain, 8);
  assert.equal(made.card.main, null);
  assert.equal(made.card.edge, null);
});

test("a legend plus two others is the real ultraviolet card", () => {
  const legend = take((id) => punk(id).tier === "传说", 1)[0];
  const others = take((id) => punk(id).tier === "普通", 2);
  const made = forge([legend, ...others]);
  assert.equal(made.ok, true);
  if (!made.ok) return;
  assert.equal(made.card.kind, "euv");
  assert.equal(made.card.edge, "#3DDEA2");
  assert.equal(made.card.feeAll, 6);
  assert.equal(made.card.feeMain, 4);
});

test("an epic needs three uncommon-or-better companions", () => {
  const epic = take((id) => punk(id).tier === "史诗", 1)[0];
  const uncommon = take((id) => punk(id).tier === "少见", 3);
  const common = take((id) => punk(id).tier === "普通", 1)[0];
  const made = forge([epic, ...uncommon]);
  assert.equal(made.ok, true);
  if (made.ok) assert.equal(made.card.kind, "euv");
  const rejected = forge([epic, uncommon[0], uncommon[1], common]);
  assert.equal(rejected.ok, false);
});

test("the same punk cannot be used twice", () => {
  const one = take((id) => punk(id).tier === "普通", 1)[0];
  const made = forge([one, one]);
  assert.equal(made.ok, false);
});

test("a wallet is recognized as its highest card", () => {
  const portrait = take((id) => punk(id).tier === "普通" && punk(id).type === "晶圆人像", 1)[0];
  const mascot = take((id) => punk(id).tier === "普通" && punk(id).type === "吉祥晶粒", 1)[0];
  const legend = take((id) => punk(id).tier === "传说", 1)[0];
  assert.equal(bestHeld([portrait, mascot])?.kind, "copper");
  assert.equal(bestHeld([legend, portrait, mascot])?.kind, "euv");
  assert.equal(bestHeld([portrait]), null);
});
