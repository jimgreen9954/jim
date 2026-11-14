import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { FEE_TO, TxPending, XLAYER } from "@/lib/chain-marks";
import { deskParts } from "@/lib/invite-cut";
import { ensureProvider } from "@/lib/wallet";
import { rememberOpenPrint } from "@/lib/tape-open-candles";

export const OPEN_POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484" as const;
const TAPE = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" as const;
const BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as const;
const USDT = "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as const;
const ROUTER = "0x881fB2f98c13d521009464e7D1CBf16E1b394e8E" as const;
const WOKB = "0xe538905cf8410324e03A5A23C1c177a474D59b2b" as const;
const OKB_RESERVE = 2_000_000_000_000_000n;
const MAX = (1n << 256n) - 1n;

const client = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 12_000 }) });
const poolAbi = parseAbi([
  "function FEE_TO() view returns (address)",
  "function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) view returns (uint256 fee, uint256 out)",
  "function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) payable",
]);
const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);
const v2 = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)",
]);

export type PoolQuote = 0 | 1;

function chainNum(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return Number.parseInt(text, text.startsWith("0x") || text.startsWith("0X") ? 16 : 10);
}

async function ensureX() {
  const eth = await ensureProvider();
  const chain = await eth.request({ method: "eth_chainId" });
  if (chainNum(chain) === XLAYER.chainId) return;
  await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER.hex }] });
}

function hexWei(n: bigint): Hex {
  let body = n.toString(16);
  if (body.length % 2) body = `0${body}`;
  return `0x${body}`;
}

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  await ensureX();
  const tx: { from: string; to: Hex; data: Hex; chainId: Hex; value?: Hex } = {
    from,
    to,
    data,
    chainId: XLAYER.hex,
  };
  if (value > 0n) tx.value = hexWei(value);
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [tx],
  })) as Hex;
}

async function wait(hash: Hex) {
  try {
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 45_000, pollingInterval: 2_000 });
    if (receipt.status !== "success") throw new Error("reverted");
  } catch (err) {
    if (err instanceof Error && err.message === "reverted") throw err;
    throw new TxPending(hash);
  }
}

export async function poolBalances(owner: Hex): Promise<{ bem: bigint; okb: bigint; tape: bigint; usdt: bigint }> {
  const [bem, okb, tape, usdt] = await Promise.all([
    client.readContract({ address: BEM, abi: erc20, functionName: "balanceOf", args: [owner] }),
    client.getBalance({ address: owner }),
    client.readContract({ address: TAPE, abi: erc20, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: USDT, abi: erc20, functionName: "balanceOf", args: [owner] }),
  ]);
  return { bem, okb, tape, usdt };
}

export async function previewPool(quote: PoolQuote, tapeIn: boolean, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const row = await client.readContract({
    address: OPEN_POOL,
    abi: poolAbi,
    functionName: "previewSwap",
    args: [quote, tapeIn, amountIn],
  });
  return row[1];
}

export function poolAmount(text: string, decimals: number): bigint {
  const clean = text.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("amount");
  return parseUnits(clean, decimals);
}

export function poolText(amount: bigint, decimals: number): string {
  const [whole, frac = ""] = formatUnits(amount, decimals).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function walletRejected(err: unknown): boolean {
  const code = typeof err === "object" && err ? Number((err as { code?: number }).code) : NaN;
  if (code === 4001) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /reject|denied|cancel/i.test(message);
}

async function allow(from: string, token: Hex, spender: Hex, need: bigint) {
  const allowance = await client.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, spender],
  });
  if (allowance >= need) return;
  const grant = encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, MAX] });
  try {
    await wait(await send(from, token, grant));
  } catch (err) {
    if (walletRejected(err) || err instanceof TxPending) throw err;
    if (!(err instanceof Error) || err.message !== "reverted") throw err;
    await wait(await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] })));
    await wait(await send(from, token, grant));
  }
}

/** Swap against the open TAPE pool. Limit orders stay on the workshop book. */
export async function swapPool(from: string, quote: PoolQuote, tapeIn: boolean, amountIn: bigint, hold = false): Promise<Hex> {
  const feeTo = await client.readContract({ address: OPEN_POOL, abi: poolAbi, functionName: "FEE_TO" });
  if (feeTo.toLowerCase() !== FEE_TO.toLowerCase()) throw new Error("fee");
  const out = await previewPool(quote, tapeIn, amountIn);
  if (out <= 0n) throw new Error("empty");
  const minOut = out * 99n / 100n;
  const token = tapeIn ? TAPE : quote === 0 ? BEM : null;
  if (token) await allow(from, token, OPEN_POOL, amountIn);
  const value = quote === 1 && !tapeIn ? amountIn : 0n;
  if (value > 0n) {
    const okb = await client.getBalance({ address: from as Hex });
    if (okb <= value) throw new Error("gas");
  }
  const hash = await send(
    from,
    OPEN_POOL,
    encodeFunctionData({ abi: poolAbi, functionName: "swap", args: [quote, tapeIn, amountIn, minOut] }),
    value,
  );
  if (hold) return hash;
  await wait(hash);
  rememberOpenPrint({
    t: Math.floor(Date.now() / 1000),
    quote,
    tapeIn,
    amountIn: amountIn.toString(),
    amountOut: out.toString(),
    tx: hash,
    sender: from,
  });
  return hash;
}

/** USDT0 on X Layer. This is the balance the ticket shows, not the other USDT. */
export async function quoteUsdt0Okb(side: "buy" | "sell", amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const path = side === "buy" ? [USDT, WOKB] : [WOKB, USDT];
  const amounts = await client.readContract({ address: ROUTER, abi: v2, functionName: "getAmountsOut", args: [amountIn, path] });
  return amounts[amounts.length - 1] ?? 0n;
}

export async function buyOkbWithUsdt0(from: string, usdtIn: bigint): Promise<bigint> {
  const parts = await deskParts("xlayer", from, usdtIn);
  if (parts.swapIn <= 0n) throw new Error("amount");
  const out = await quoteUsdt0Okb("buy", parts.swapIn);
  if (out <= 0n) throw new Error("empty");
  const minOut = (out * 99n) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);
  const before = await client.getBalance({ address: from as Hex });
  const hash = await send(
    from,
    ROUTER,
    encodeFunctionData({
      abi: v2,
      functionName: "swapExactTokensForETH",
      args: [parts.swapIn, minOut, [USDT, WOKB], from as Hex, deadline],
    }),
  );
  writeHop(BUY_HOP, { from, hash, before: before.toString() });
  await wait(hash);
  const after = await client.getBalance({ address: from as Hex });
  const gained = after > before ? after - before : 0n;
  const okb = gained > 10n ** 14n ? gained : out;
  writeHop(BUY_HOP, { from, okb: okb.toString() });
  return okb;
}

const SELL_HOP = "tl-tape-usdt-hop";
const BUY_HOP = "tl-tape-usdt-buy";

type Hop = { from: string; hash?: string; before?: string; okb?: string; unwind?: string };

function readHop(key: string, from: string): Hop | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const row = JSON.parse(raw) as Hop;
    if (!row.from || row.from.toLowerCase() !== from.toLowerCase()) return null;
    return row;
  } catch {
    return null;
  }
}

function writeHop(key: string, row: Hop) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(key, JSON.stringify(row));
}

function clearHop(key: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(key);
}

async function unwindOkb(from: string, want: bigint): Promise<Hex> {
  const bal = await client.getBalance({ address: from as Hex });
  const room = bal > OKB_RESERVE ? bal - OKB_RESERVE : 0n;
  const spend = want < room ? want : room;
  if (spend <= 10n ** 14n) throw new Error("leg");
  const out = await quoteUsdt0Okb("sell", spend);
  if (out <= 0n) throw new Error("leg");
  const data = encodeFunctionData({
    abi: v2,
    functionName: "swapExactETHForTokens",
    args: [out * 97n / 100n, [WOKB, USDT], from as Hex, BigInt(Math.floor(Date.now() / 1000) + 60 * 20)],
  });
  const hash = await send(from, ROUTER, data, spend);
  writeHop(SELL_HOP, { from, unwind: hash, okb: want.toString() });
  await wait(hash);
  clearHop(SELL_HOP);
  return hash;
}

/** One wallet confirmation per tap. OKX on a phone drops the later signatures if they are sent together. */
export async function buyTapeWithUsdt0(from: string, usdtIn: bigint, okbIn: bigint): Promise<Hex> {
  const pending = readHop(BUY_HOP, from);
  if (pending) {
    let okb = pending.okb ? BigInt(pending.okb) : 0n;
    if (pending.hash && okb <= 0n) {
      try {
        await wait(pending.hash as Hex);
      } catch (err) {
        if (err instanceof Error && err.message === "reverted") clearHop(BUY_HOP);
        throw err;
      }
      const after = await client.getBalance({ address: from as Hex });
      const before = BigInt(pending.before ?? "0");
      const gained = after > before ? after - before : 0n;
      if (gained <= 10n ** 14n) {
        clearHop(BUY_HOP);
        throw new Error("leg");
      }
      okb = gained;
      writeHop(BUY_HOP, { from, okb: okb.toString() });
    }
    const bal = await client.getBalance({ address: from as Hex });
    const hold = 50_000_000_000_000n;
    const room = bal > hold ? bal - hold : 0n;
    const spend = okb < okbIn ? okb : okbIn;
    const capped = spend < room ? spend : room;
    if (capped <= 10n ** 14n) throw new Error("leg");
    const hash = await swapPool(from, 1, false, capped);
    clearHop(BUY_HOP);
    return hash;
  }
  const parts = await deskParts("xlayer", from, usdtIn);
  if (parts.swapIn <= 0n) throw new Error("amount");
  const allowance = await client.readContract({
    address: USDT,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, ROUTER],
  });
  if (allowance < parts.swapIn) {
    await allow(from, USDT, ROUTER, parts.swapIn);
    throw new Error("next");
  }
  const got = await buyOkbWithUsdt0(from, usdtIn);
  if (got <= 10n ** 14n) throw new Error("leg");
  writeHop(BUY_HOP, { from, okb: got.toString() });
  throw new Error("leg");
}

/** Sell TAPE into the OKB pool, then turn that OKB into USDT0. The wallet shows OKB on the first signature. */
export async function sellTapeForUsdt0(from: string, tapeIn: bigint): Promise<Hex> {
  const pending = readHop(SELL_HOP, from);
  if (pending?.unwind) {
    await wait(pending.unwind as Hex);
    clearHop(SELL_HOP);
    return pending.unwind as Hex;
  }
  if (pending?.okb) return unwindOkb(from, BigInt(pending.okb));
  if (pending?.hash) {
    try {
      await wait(pending.hash as Hex);
    } catch (err) {
      if (err instanceof Error && err.message === "reverted") clearHop(SELL_HOP);
      throw err;
    }
    const after = await client.getBalance({ address: from as Hex });
    const before = BigInt(pending.before ?? "0");
    const gained = after > before ? after - before : 0n;
    if (gained <= 10n ** 14n) {
      clearHop(SELL_HOP);
      throw new Error("leg");
    }
    writeHop(SELL_HOP, { from, okb: gained.toString() });
    return unwindOkb(from, gained);
  }
  const before = await client.getBalance({ address: from as Hex });
  const hash = await swapPool(from, 1, true, tapeIn, true);
  writeHop(SELL_HOP, { from, hash, before: before.toString() });
  await wait(hash);
  const after = await client.getBalance({ address: from as Hex });
  const gained = after > before ? after - before : 0n;
  if (gained <= 10n ** 14n) throw new Error("leg");
  writeHop(SELL_HOP, { from, okb: gained.toString() });
  return unwindOkb(from, gained);
}
