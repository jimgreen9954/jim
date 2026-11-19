import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertGasQuote, type RawGasQuote } from "./gas-quote-check.ts";

const user = "0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd";
const samples = dirname(fileURLToPath(import.meta.url));

function load(name: string): RawGasQuote {
  return JSON.parse(readFileSync(join(samples, "gas-quote-samples", name), "utf8")) as RawGasQuote;
}

test("xlayer to bnb quote matches the router, portal, and user", () => {
  const json = load("xlayer-bnb.json");
  const quote = assertGasQuote(
    { sourceChain: 196, targetChain: 56, user, amountIn: 10n ** 18n, symbolOut: "BNB" },
    json,
  );
  assert.equal(quote.chainId, 196);
  assert.equal(quote.to.toLowerCase(), "0xce8f24a58d85ed5c5a6824f7be1f8d4711a0eb4c");
  assert.equal(quote.value, 10n ** 18n);
  assert.ok(quote.amountOut > quote.amountOutMin);
});

test("a non-196 chain id is not treated as xlayer", () => {
  const json = load("xlayer-bnb.json");
  json.tx = { ...json.tx, chainId: 1 };
  assert.throws(
    () => assertGasQuote({ sourceChain: 196, targetChain: 56, user, amountIn: 10n ** 18n, symbolOut: "BNB" }, json),
    /quote/,
  );
});

test("an arbitrary router is rejected", () => {
  const json = load("xlayer-bnb.json");
  json.tx = { ...json.tx, to: "0x0000000000000000000000000000000000000001" };
  assert.throws(
    () => assertGasQuote({ sourceChain: 196, targetChain: 56, user, amountIn: 10n ** 18n, symbolOut: "BNB" }, json),
    /quote/,
  );
});

test("a changed bridge recipient is rejected", () => {
  const json = load("xlayer-bnb.json");
  const data = json.tx?.data || "";
  const userWord = user.slice(2).toLowerCase();
  const swapped = data.replace(userWord, "1111111111111111111111111111111111111111");
  json.tx = { ...json.tx, data: swapped };
  assert.throws(
    () => assertGasQuote({ sourceChain: 196, targetChain: 56, user, amountIn: 10n ** 18n, symbolOut: "BNB" }, json),
    /quote/,
  );
});

test("an unrecognized aggregator call is not given to the wallet", () => {
  const json = load("bsc-okb.json");
  assert.throws(
    () => assertGasQuote({ sourceChain: 56, targetChain: 196, user, amountIn: 10n ** 18n, symbolOut: "OKB" }, json),
    /quote/,
  );
});
