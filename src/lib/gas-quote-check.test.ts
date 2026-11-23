import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertGasQuote, type RawGasQuote } from "./gas-quote-check.ts";

const user = "0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd";
const who = "0x7fa7193115a481067af731499c551c5571071528";
const samples = dirname(fileURLToPath(import.meta.url));

function load(name: string): RawGasQuote {
  return JSON.parse(readFileSync(join(samples, "gas-quote-samples", name), "utf8")) as RawGasQuote;
}

const xIntent = { sourceChain: 196 as const, targetChain: 56 as const, user, amountIn: 10n ** 18n, symbolOut: "BNB" as const };
const bscIntent = { sourceChain: 56 as const, targetChain: 196 as const, user: who, amountIn: 2000000000000000n, symbolOut: "OKB" as const };

test("xlayer to bnb quote matches the router, portal, and user", async () => {
  const json = load("xlayer-bnb.json");
  const quote = await assertGasQuote(xIntent, json);
  assert.equal(quote.chainId, 196);
  assert.equal(quote.to.toLowerCase(), "0xce8f24a58d85ed5c5a6824f7be1f8d4711a0eb4c");
  assert.equal(quote.value, 10n ** 18n);
  assert.ok(quote.amountOut > quote.amountOutMin);
});

test("a non-196 chain id is not treated as xlayer", async () => {
  const json = load("xlayer-bnb.json");
  json.tx = { ...json.tx, chainId: 1 };
  await assert.rejects(() => assertGasQuote(xIntent, json), /quote/);
});

test("an arbitrary router is rejected", async () => {
  const json = load("xlayer-bnb.json");
  json.tx = { ...json.tx, to: "0x0000000000000000000000000000000000000001" };
  await assert.rejects(() => assertGasQuote(xIntent, json), /quote/);
});

test("a changed bridge recipient is rejected", async () => {
  const json = load("xlayer-bnb.json");
  const data = json.tx?.data || "";
  json.tx = { ...json.tx, data: data.replace(user.slice(2).toLowerCase(), "1111111111111111111111111111111111111111") };
  await assert.rejects(() => assertGasQuote(xIntent, json), /quote/);
});

test("a settler quote that names an unpinned pool is rejected", async () => {
  const json = load("bsc-okb.json");
  await assert.rejects(
    () => assertGasQuote({ sourceChain: 56, targetChain: 196, user, amountIn: 10n ** 18n, symbolOut: "OKB" }, json),
    /quote/,
  );
});

function saved() {
  return load("bsc-okb-exec.json");
}

test("a small settler quote is accepted after the bridge fee", async () => {
  const quote = await assertGasQuote(bscIntent, saved());
  assert.equal(quote.value, bscIntent.amountIn);
  assert.ok(quote.amountOutMin > 0n);
});

test("a replaced pancake pool in the settler path is rejected", async () => {
  const json = saved();
  const data = json.tx?.data || "";
  json.tx = {
    ...json.tx,
    data: data.replace(/fffd8963efd1fc6a506488495d951d5263988d25/i, "1111111111111111111111111111111111111111"),
  };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("a replaced pancake fee tier is rejected", async () => {
  const json = saved();
  const data = json.tx?.data || "";
  json.tx = {
    ...json.tx,
    data: data.replace(/bc095c00000064fffd/i, "bc095c00fffffffffd"),
  };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("a zero settler buy minimum is rejected", async () => {
  const json = saved();
  const data = json.tx?.data || "";
  json.tx = {
    ...json.tx,
    data: data.replace(/105acb0ffb724c16/i, "0000000000000000"),
  };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("a one-wei OKB minimum is rejected", async () => {
  const json = saved();
  json.tokenAmountOutMin = { ...json.tokenAmountOutMin, amount: "1" };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("settler steps out of order are rejected", async () => {
  const json = saved();
  const data = json.tx?.data || "";
  const native = data.toLowerCase().indexOf("bd01c226");
  const uni = data.toLowerCase().indexOf("8d68a156");
  assert.ok(native > 0 && uni > native);
  const chars = data.split("");
  const a = data.slice(native, native + 8);
  const b = data.slice(uni, uni + 8);
  chars.splice(native, 8, ...b);
  chars.splice(uni, 8, ...a);
  json.tx = { ...json.tx, data: chars.join("") };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("a live infinity bnb to okb quote is accepted", async () => {
  const quote = await assertGasQuote(bscIntent, load("bsc-okb-infinity.json"));
  assert.equal(quote.chainId, 56);
  assert.equal(quote.value, bscIntent.amountIn);
  assert.ok(quote.amountOutMin > 0n);
});

test("an infinity single-hop bnb to okb quote is accepted", async () => {
  const quote = await assertGasQuote(bscIntent, load("bsc-okb-infinity-single.json"));
  assert.equal(quote.to.toLowerCase(), "0x851b43189de721dd94aba767aad9e6f6d6a95cca");
  assert.ok(quote.amountOut > quote.amountOutMin);
});

test("an infinity quote with a different router is rejected", async () => {
  const json = load("bsc-okb-infinity.json");
  const data = json.tx?.data || "";
  json.tx = {
    ...json.tx,
    data: data.replace(/91bf3bfaef8d771a74e1a8fe460b3ee646b2e588/i, "1111111111111111111111111111111111111111"),
  };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("an infinity take to another address is rejected", async () => {
  const json = load("bsc-okb-infinity.json");
  const data = json.tx?.data || "";
  json.tx = {
    ...json.tx,
    data: data.replace(/980447ddcef79a7499da4538da8fc59bacad6997/i, "2222222222222222222222222222222222222222"),
  };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("an infinity hop with a hook is rejected", async () => {
  const json = load("bsc-okb-infinity-single.json");
  const data = json.tx?.data || "";
  const hook = "000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000";
  assert.ok(data.toLowerCase().includes(hook));
  json.tx = { ...json.tx, data: data.toLowerCase().replace(hook, hook.slice(0, 64) + "0000000000000000000000001111111111111111111111111111111111111111") };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});

test("a settler quote that hops through USDT then USDC is accepted", async () => {
  const quote = await assertGasQuote(
    { sourceChain: 56, targetChain: 196, user: who, amountIn: 100000000000000000n, symbolOut: "OKB" },
    load("bsc-okb-usdt.json"),
  );
  assert.equal(quote.value, 100000000000000000n);
  assert.ok(quote.amountOutMin > 0n);
});

test("half of an infinity okb minimum is rejected", async () => {
  const json = load("bsc-okb-infinity.json");
  const min = BigInt(json.tokenAmountOutMin?.amount || "0") / 2n;
  json.tokenAmountOutMin = { ...json.tokenAmountOutMin, amount: min.toString() };
  await assert.rejects(() => assertGasQuote(bscIntent, json), /quote/);
});
