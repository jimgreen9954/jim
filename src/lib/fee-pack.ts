import { createPublicClient, encodeFunctionData, encodePacked, http, keccak256, parseAbi, type Hex } from "viem";
import { TxPending } from "@/lib/chain-marks";
import type { DeskParts } from "@/lib/invite-cut";
import { rejected, sendAsMulticall, sendUserBatch, type SignedCall } from "@/lib/one-sign";
import { sayTradeStep } from "@/lib/trade-step";
import { ensureProvider, armChain, remoteWallet, switchDeskChain } from "@/lib/wallet";

/** Old desk contract. Kept only so a wallet can cancel its leftover approval. Nobody deploys it again. */
export const DESK_LOCK = "0xC5A63E4c37c23F97558673731196abC30FBFa659" as Hex;

const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);

const RPC: Record<number, string[]> = {
  56: ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com"],
  196: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
};

function pub(chainId: number) {
  return createPublicClient({ transport: http(RPC[chainId][0], { timeout: 12_000 }) });
}

async function sendTx(from: string, chainId: 56 | 196, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  if (remoteWallet()) await armChain(chainId);
  else await switchDeskChain(chainId);
  const tx: { from: string; to: Hex; data: Hex; chainId: Hex; value?: Hex } = {
    from,
    to,
    data,
    chainId: chainId === 56 ? "0x38" : "0xc4",
  };
  if (value > 0n) tx.value = `0x${value.toString(16)}`;
  return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
}

async function mined(chainId: number, hash: Hex): Promise<void> {
  for (let i = 0; i < 40; i++) {
    for (const url of RPC[chainId]) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const json = (await res.json()) as { result?: { status?: string } | null };
        const status = json.result?.status;
        if (status === "0x1") return;
        if (status === "0x0") throw new Error("reverted");
      } catch (err) {
        if (err instanceof Error && err.message === "reverted") throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new TxPending(hash);
}

function feeCalls(token: Hex | null, safe: Hex, parts: DeskParts): SignedCall[] {
  const calls: SignedCall[] = [];
  if (token) {
    if (parts.reward > 0n && parts.referrer) {
      calls.push({
        to: token,
        data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [parts.referrer, parts.reward] }),
      });
    }
    if (parts.desk > 0n) {
      calls.push({
        to: token,
        data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [safe, parts.desk] }),
      });
    }
  } else {
    if (parts.reward > 0n && parts.referrer) calls.push({ to: parts.referrer, data: "0x", value: parts.reward });
    if (parts.desk > 0n) calls.push({ to: safe, data: "0x", value: parts.desk });
  }
  return calls;
}

export type FeeSwap = {
  from: string;
  chainId: 56 | 196;
  token: Hex | null;
  safe: Hex;
  parts: DeskParts;
  swapTo: Hex;
  data: Hex;
  value: bigint;
  pull: bigint;
  spender: Hex;
  /** False for a bridge call that might pay msg.sender. Those stay on the wallet batch or Multicall3. */
  lock?: boolean;
  /** Stable id for this fill. Kept so an older page can still find a fill that was saved before the fee record moved to the account. */
  mark?: string;
};

/** Batch the fee and the fill when the wallet can. Otherwise the fill is signed first, and only after that fill succeeds is the fee asked. A rejected fill does not take the fee. A fill that is already on chain is not sent again. Paying the missing fee is a separate call. */
export async function sendFeeAndSwap(args: FeeSwap): Promise<Hex> {
  const { from, chainId, token, safe, parts, swapTo, data, value } = args;
  const calls = feeCalls(token, safe, parts);
  await blockIfOpen(args, calls);
  const swap: SignedCall = { to: swapTo, data, value };
  const together = [...calls, swap];
  if (!remoteWallet()) {
    try {
      sayTradeStep(calls.length ? "both" : "fill");
      return await sendUserBatch(from, chainId, together);
    } catch (err) {
      if (rejected(err) || err instanceof TxPending || err instanceof FeeOpen) throw err;
      const message = err instanceof Error ? err.message : "";
      if (message !== "no-batch") throw err;
    }
    if (!token) {
      try {
        sayTradeStep(calls.length ? "both" : "fill");
        return await sendAsMulticall(from, together, chainId);
      } catch (err) {
        if (rejected(err) || err instanceof TxPending || err instanceof FeeOpen) throw err;
        const message = err instanceof Error ? err.message : "";
        if (message !== "no-batch") throw err;
      }
      if (args.lock === false) throw new Error("no-batch");
    }
  }
  if (calls.length > 0 && !storageReady()) throw new Error("no-store");
  sayTradeStep("fill");
  const hash = await sendTx(from, chainId, swapTo, data, value);
  const saved: OpenFill = { hash, from, chainId, calls: pack(calls), paid: [] };
  if (calls.length > 0) writeStore(feeKey(chainId, from), saved);
  const filled = await settle(chainId, hash);
  if (filled === "wait") throw new TxPending(hash);
  if (filled === "bad") {
    clearStore(feeKey(chainId, from));
    throw new Error("reverted");
  }
  if (calls.length === 0) return hash;
  await payFees(from, chainId, saved);
  clearStore(feeKey(chainId, from));
  return hash;
}

export class FeeOpen extends Error {
  hash: Hex;
  chainId: 56 | 196;
  constructor(hash: Hex, chainId: 56 | 196) {
    super("fee-open");
    this.name = "FeeOpen";
    this.hash = hash;
    this.chainId = chainId;
  }
}

export type OpenFeeView = { hash: Hex; chainId: 56 | 196; from: string };

type SavedCall = { to: Hex; data: Hex; value: string };
type OpenFill = { hash: Hex; from: string; chainId: 56 | 196; calls: SavedCall[]; paid: Hex[] };
type LegacyFill = { hash: Hex; fees?: Hex[] };

const memory = new Map<string, OpenFill>();
const paying = new Set<string>();
const listeners = new Set<() => void>();

function feeKey(chainId: number, from: string): string {
  return `tl-open-fee:${chainId}:${from.toLowerCase()}`;
}

function pack(calls: SignedCall[]): SavedCall[] {
  return calls.map((call) => ({ to: call.to, data: call.data, value: (call.value ?? 0n).toString() }));
}

function unpack(calls: SavedCall[]): SignedCall[] {
  return calls.map((call) => ({ to: call.to, data: call.data, value: BigInt(call.value || "0") }));
}

export function subscribeOpenFees(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) cb();
}

function storageReady(): boolean {
  const key = "tl-open-probe";
  try {
    localStorage.setItem(key, "1");
    const ok = localStorage.getItem(key) === "1";
    localStorage.removeItem(key);
    return ok;
  } catch {
    return false;
  }
}

function parseOpen(raw: string | null): OpenFill | null {
  if (!raw) return null;
  try {
    const row = JSON.parse(raw) as OpenFill;
    if (!row || !/^0x[0-9a-fA-F]{64}$/.test(row.hash)) return null;
    if (row.chainId !== 56 && row.chainId !== 196) return null;
    if (!row.from || !Array.isArray(row.calls) || !Array.isArray(row.paid)) return null;
    return row;
  } catch {
    return null;
  }
}

function readStore(key: string): OpenFill | null {
  const held = memory.get(key);
  if (held) return held;
  try {
    const row = parseOpen(localStorage.getItem(key));
    if (!row) return null;
    memory.set(key, row);
    return row;
  } catch {
    return null;
  }
}

function writeStore(key: string, row: OpenFill) {
  memory.set(key, row);
  try {
    localStorage.setItem(key, JSON.stringify(row));
  } catch {
    /* the hash stays in memory for this page */
  }
  notify();
}

function clearStore(key: string) {
  memory.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  notify();
}

export function openFees(from: string | null): OpenFeeView[] {
  if (!from) return [];
  const rows: OpenFeeView[] = [];
  for (const chainId of [56, 196] as const) {
    const row = readStore(feeKey(chainId, from));
    if (row && row.from.toLowerCase() === from.toLowerCase()) rows.push({ hash: row.hash, chainId, from: row.from });
  }
  return rows;
}

function openKey(args: FeeSwap): string {
  if (args.mark) return `tl-open-fill:${args.mark}`;
  const id = keccak256(
    encodePacked(
      ["uint256", "address", "address", "uint256", "bytes"],
      [BigInt(args.chainId), args.from as Hex, args.swapTo, args.value, args.data],
    ),
  );
  return `tl-open-fill:${id}`;
}

function readLegacy(key: string): LegacyFill | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const row = JSON.parse(raw) as LegacyFill;
    return row && /^0x[0-9a-fA-F]{64}$/.test(row.hash) ? row : null;
  } catch {
    return null;
  }
}

function dropLegacy(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function blockIfOpen(args: FeeSwap, calls: SignedCall[]) {
  const key = feeKey(args.chainId, args.from);
  let open = readStore(key);
  if (!open) {
    const legacy = readLegacy(openKey(args));
    if (legacy) {
      open = { hash: legacy.hash, from: args.from, chainId: args.chainId, calls: pack(calls), paid: legacy.fees ?? [] };
      writeStore(key, open);
      dropLegacy(openKey(args));
    }
  }
  if (!open) return;
  const state = await settle(args.chainId, open.hash);
  if (state === "wait") throw new TxPending(open.hash);
  if (state === "bad") {
    clearStore(key);
    return;
  }
  throw new FeeOpen(open.hash, args.chainId);
}

async function settle(chainId: number, hash: Hex): Promise<"ok" | "bad" | "wait"> {
  try {
    await mined(chainId, hash);
    return "ok";
  } catch (err) {
    if (err instanceof Error && err.message === "reverted") return "bad";
    return "wait";
  }
}

async function payFees(from: string, chainId: 56 | 196, saved: OpenFill) {
  const key = feeKey(chainId, from);
  if (paying.has(key)) throw new FeeOpen(saved.hash, chainId);
  paying.add(key);
  try {
    const calls = unpack(saved.calls);
    for (let i = 0; i < calls.length; i += 1) {
      const prior = saved.paid[i];
      if (prior) {
        const state = await settle(chainId, prior);
        if (state === "ok") continue;
        if (state === "wait") throw new TxPending(prior);
      }
      const call = calls[i];
      let hash: Hex;
      try {
        sayTradeStep("fee");
        hash = await sendTx(from, chainId, call.to, call.data, call.value ?? 0n);
      } catch (err) {
        if (rejected(err)) throw new FeeOpen(saved.hash, chainId);
        throw err;
      }
      saved.paid[i] = hash;
      writeStore(key, saved);
      const state = await settle(chainId, hash);
      if (state === "wait") throw new TxPending(hash);
      if (state === "bad") throw new FeeOpen(saved.hash, chainId);
    }
  } finally {
    paying.delete(key);
  }
}

/** Pay the fee that was left behind by a fill. Does not send the swap again. */
export async function payOpenFee(from: string, chainId: 56 | 196): Promise<Hex> {
  const key = feeKey(chainId, from);
  const open = readStore(key);
  if (!open || open.from.toLowerCase() !== from.toLowerCase()) throw new Error("no-fee");
  const state = await settle(chainId, open.hash);
  if (state === "wait") throw new TxPending(open.hash);
  if (state === "bad") {
    clearStore(key);
    throw new Error("reverted");
  }
  await payFees(from, chainId, open);
  clearStore(key);
  return open.hash;
}

export const LOCK_TOKENS: { chainId: 56 | 196; name: string; token: Hex }[] = [
  { chainId: 56, name: "BEM", token: "0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a" },
  { chainId: 56, name: "USDT", token: "0x55d398326f99059fF775485246999027B3197955" },
  { chainId: 56, name: "WBNB", token: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" },
  { chainId: 56, name: "BTCB", token: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c" },
  { chainId: 56, name: "ETH", token: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8" },
  { chainId: 56, name: "ZEC", token: "0x1Ba42e5193dfA8B03D15dd1B86a3113bbBEF8Eeb" },
  { chainId: 56, name: "XAU", token: "0x21cAef8A43163Eea865baeE23b9C2E327696A3bf" },
  { chainId: 56, name: "UP", token: "0xEd99445d72787Adb627cD8588586984DF548CD2F" },
  { chainId: 56, name: "SPY", token: "0x7138b48df7D98D7e3cc221BfE7192D0a178182D8" },
  { chainId: 56, name: "QQQ", token: "0x205812CdBed920aFf76C6580abD681a46D11efc7" },
  { chainId: 56, name: "AAPL", token: "0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A" },
  { chainId: 56, name: "NVDA", token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436" },
  { chainId: 56, name: "INTC", token: "0xe614E2fc6C787035FF51f452e8E826Bfd32D5283" },
  { chainId: 56, name: "MSFT", token: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0" },
  { chainId: 56, name: "TSLA", token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f" },
  { chainId: 56, name: "SPCX", token: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1" },
  { chainId: 56, name: "GOOGL", token: "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238" },
  { chainId: 196, name: "USDT", token: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" },
  { chainId: 196, name: "WOKB", token: "0xe538905cf8410324e03A5A23C1c177a474D59b2b" },
  { chainId: 196, name: "BEM", token: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" },
  { chainId: 196, name: "TAPE", token: "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3" },
  { chainId: 196, name: "FAB", token: "0x72f349b1eee7833b26f8c81a8410775a4e231ed2" },
];

export async function lockLeft(chainId: 56 | 196, owner: string, token: Hex): Promise<bigint> {
  return pub(chainId).readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [owner as Hex, DESK_LOCK],
  });
}

export async function revokeLock(from: string, chainId: 56 | 196, token: Hex): Promise<Hex> {
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [DESK_LOCK, 0n] });
  const hash = await sendTx(from, chainId, token, data);
  await mined(chainId, hash);
  return hash;
}
