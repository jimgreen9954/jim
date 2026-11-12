import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { ensureProvider, remoteWallet } from "@/lib/wallet";

export type SignedCall = { to: Hex; data: Hex; value?: bigint };

const MULTI = "0xcA11bde05977b3631167028862bE2a173976CA11" as Hex;
const multiAbi = parseAbi([
  "function aggregate3Value((address target, bool allowFailure, uint256 value, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
]);

const CHAINS: Record<number, { hex: Hex; name: string; rpc: string[]; symbol: string; explorer: string }> = {
  56: {
    hex: "0x38",
    name: "BNB Smart Chain",
    rpc: ["https://bsc-dataseed.binance.org"],
    symbol: "BNB",
    explorer: "https://bscscan.com",
  },
  196: {
    hex: "0xc4",
    name: "X Layer",
    rpc: ["https://xlayerrpc.okx.com", "https://rpc.xlayer.tech"],
    symbol: "OKB",
    explorer: "https://www.oklink.com/xlayer",
  },
};

function hexVal(value: bigint): Hex {
  return `0x${value.toString(16)}` as Hex;
}

function deskTx(from: string, chainId: number | undefined, to: Hex, data: Hex, value = 0n) {
  const tx: { from: string; to: Hex; data: Hex; value?: Hex; chainId?: Hex } = {
    from,
    to,
    data: data && data !== "0x" ? data : "0x",
  };
  if (value > 0n) tx.value = hexVal(value);
  if (chainId && CHAINS[chainId]) tx.chainId = CHAINS[chainId].hex;
  return tx;
}

export function rejected(err: unknown): boolean {
  const code = typeof err === "object" && err ? Number((err as { code?: number }).code) : NaN;
  if (code === 4001) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /user rejected|user denied|user cancelled|user canceled|rejected the request|denied transaction signature|action_rejected/i.test(msg);
}

type Eth = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

function capKey(chainId: number): string {
  return `tl-atomic:${chainId}`;
}

function readCap(chainId: number): "0" | "1" | null {
  try {
    const saved = sessionStorage.getItem(capKey(chainId));
    return saved === "0" || saved === "1" ? saved : null;
  } catch {
    return null;
  }
}

function writeCap(chainId: number, ok: boolean) {
  try {
    sessionStorage.setItem(capKey(chainId), ok ? "1" : "0");
  } catch {
    /* private mode */
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function atomicStatus(caps: unknown, chainId: number): string {
  if (!caps || typeof caps !== "object") return "";
  const bag = caps as Record<string, { atomic?: { status?: string } } | undefined>;
  const hex = `0x${chainId.toString(16)}`;
  const row = bag[hex] ?? bag[hex.toUpperCase()] ?? bag[String(chainId)];
  return row?.atomic?.status ?? "";
}

/** Only wallets that actually report atomic batches. A phone wallet gets one real transaction. */
async function atomicReady(eth: Eth, from: string, chainId: number): Promise<boolean> {
  if (remoteWallet()) return false;
  const saved = readCap(chainId);
  if (saved === "0") return false;
  if (saved === "1") return true;
  let caps: unknown;
  try {
    caps = await withTimeout(eth.request({ method: "wallet_getCapabilities", params: [from] }), 2000);
  } catch {
    try {
      caps = await withTimeout(eth.request({ method: "wallet_getCapabilities" }), 1200);
    } catch {
      writeCap(chainId, false);
      return false;
    }
  }
  const status = atomicStatus(caps, chainId);
  const ok = status === "supported" || status === "ready";
  writeCap(chainId, ok);
  return ok;
}

async function txCount(eth: Eth, from: string): Promise<string | null> {
  try {
    return String(await eth.request({ method: "eth_getTransactionCount", params: [from, "pending"] }));
  } catch {
    return null;
  }
}

async function onChain(eth: Eth, chainId: number) {
  const row = CHAINS[chainId];
  if (!row) return;
  const now = await eth.request({ method: "eth_chainId" });
  const text = typeof now === "string" ? now : String(now ?? "");
  if (Number.parseInt(text, text.startsWith("0x") ? 16 : 10) === chainId) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: row.hex }] });
  } catch (err) {
    if (rejected(err)) throw err;
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (code === 4902 || /unrecognized|not added/i.test(message)) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: row.hex,
            chainName: row.name,
            rpcUrls: row.rpc,
            nativeCurrency: { name: row.symbol, symbol: row.symbol, decimals: 18 },
            blockExplorerUrls: [row.explorer],
          },
        ],
      });
      return;
    }
    throw err;
  }
}

async function bundled(eth: Eth, from: string, chainId: number, calls: SignedCall[]): Promise<Hex> {
  const key = `0x${chainId.toString(16)}`;
  const pack = (version: string) => ({
    version,
    from,
    chainId: key,
    atomicRequired: true,
    calls: calls.map((call) => ({
      to: call.to,
      data: call.data,
      value: hexVal(call.value ?? 0n),
    })),
  });
  const before = await txCount(eth, from);
  let sent: unknown;
  for (const version of ["2.0.0", "1.0.0"]) {
    try {
      sent = await eth.request({ method: "wallet_sendCalls", params: [pack(version)] });
      break;
    } catch (err) {
      if (rejected(err)) throw err;
      sent = undefined;
    }
  }
  if (sent === undefined) {
    writeCap(chainId, false);
    throw new Error("no-batch");
  }
  const id = typeof sent === "string" ? sent : (sent as { id?: string } | null)?.id;
  if (!id) {
    writeCap(chainId, false);
    throw new Error("no-batch");
  }
  if (/^0x[a-fA-F0-9]{64}$/.test(id)) return id as Hex;
  for (let i = 0; i < 20; i++) {
    let row: { status?: number | string; receipts?: { transactionHash?: Hex }[] };
    try {
      row = (await eth.request({ method: "wallet_getCallsStatus", params: [id] })) as typeof row;
    } catch {
      const after = await txCount(eth, from);
      if (before && after && before !== after) throw new Error("pending");
      writeCap(chainId, false);
      throw new Error("no-batch");
    }
    const hash = row?.receipts?.find((receipt) => receipt.transactionHash)?.transactionHash;
    const code = Number(row?.status);
    if (hash && (!Number.isFinite(code) || code === 200 || code === 0)) return hash;
    if (Number.isFinite(code) && code >= 500) throw new Error("reverted");
    if (Number.isFinite(code) && code >= 400) {
      writeCap(chainId, false);
      throw new Error("no-batch");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const after = await txCount(eth, from);
  if (before && after && before !== after) throw new Error("pending");
  writeCap(chainId, false);
  throw new Error("no-batch");
}

/** One confirmation. The caller is Multicall3, so only use this when every call still works that way. */
export async function sendAsMulticall(from: string, calls: SignedCall[], chainId?: number): Promise<Hex> {
  const live = calls.filter((call) => (call.value ?? 0n) > 0n || (call.data && call.data !== "0x"));
  if (live.length === 0) throw new Error("amount");
  const eth = await ensureProvider();
  if (chainId) await onChain(eth, chainId);
  const value = live.reduce((sum, call) => sum + (call.value ?? 0n), 0n);
  const data = encodeFunctionData({
    abi: multiAbi,
    functionName: "aggregate3Value",
    args: [
      live.map((call) => ({
        target: call.to,
        allowFailure: false,
        value: call.value ?? 0n,
        callData: call.data && call.data !== "0x" ? call.data : "0x",
      })),
    ],
  });
  const tx = deskTx(from, chainId, MULTI, data, value);
  if (!remoteWallet()) {
    try {
      await eth.request({ method: "eth_call", params: [tx, "latest"] });
    } catch (err) {
      if (rejected(err)) throw err;
      throw new Error("no-batch");
    }
  }
  return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
}

/** Fee and the trade in one confirmation. The wallet must support atomic batches. Multicall is not used, because the router would not see the user. */
export async function sendUserBatch(from: string, chainId: number, calls: SignedCall[]): Promise<Hex> {
  const live = calls.filter((call) => (call.value ?? 0n) > 0n || (call.data && call.data !== "0x"));
  if (live.length === 0) throw new Error("amount");
  if (remoteWallet() && live.length !== 1) throw new Error("no-batch");
  const eth = await ensureProvider();
  await onChain(eth, chainId);
  if (live.length === 1) {
    const call = live[0];
    return (await eth.request({
      method: "eth_sendTransaction",
      params: [deskTx(from, chainId, call.to, call.data || "0x", call.value ?? 0n)],
    })) as Hex;
  }
  if (!(await atomicReady(eth, from, chainId))) throw new Error("no-batch");
  return bundled(eth, from, chainId, live);
}

/** One confirmation when the wallet can batch. Otherwise the caller sends the steps itself. */
export async function sendTogether(from: string, chainId: number, calls: SignedCall[]): Promise<Hex> {
  const live = calls.filter((call) => (call.value ?? 0n) > 0n || (call.data && call.data !== "0x"));
  if (live.length === 0) throw new Error("amount");
  if (remoteWallet() && live.length !== 1 && !live.every((call) => (call.value ?? 0n) > 0n)) throw new Error("no-batch");
  const eth = await ensureProvider();
  await onChain(eth, chainId);
  if (live.length === 1) {
    const call = live[0];
    return (await eth.request({
      method: "eth_sendTransaction",
      params: [deskTx(from, chainId, call.to, call.data || "0x", call.value ?? 0n)],
    })) as Hex;
  }
  if (live.every((call) => (call.value ?? 0n) > 0n)) return sendAsMulticall(from, live, chainId);
  if (!(await atomicReady(eth, from, chainId))) throw new Error("no-batch");
  return bundled(eth, from, chainId, live);
}
