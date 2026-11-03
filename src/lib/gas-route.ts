import type { Hex } from "viem";
import { BSC, BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { deskParts } from "@/lib/invite-cut";
import { sayTradeStep } from "@/lib/trade-step";
import { rejected, sendUserBatch, type SignedCall } from "@/lib/one-sign";
import { ensureProvider, switchDeskChain } from "@/lib/wallet";
import { XLAYER } from "@/lib/xlayer";

const SWAP = "https://api.symbiosis.finance/crosschain/v1/swap";
const RPC = {
  xlayer: ["https://xlayerrpc.okx.com", XLAYER.rpc],
  bsc: ["https://bsc.publicnode.com", BSC.rpc],
} as const;

export type GasQuote = {
  toBnb: boolean;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  to: Hex;
  data: Hex;
  value: bigint;
  chainId: 56 | 196;
};

async function nativeBalance(chain: "xlayer" | "bsc", who: Hex): Promise<bigint> {
  for (const url of RPC[chain]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [who, "latest"] }),
      });
      const json = (await res.json()) as { result?: string };
      if (json.result) return BigInt(json.result);
    } catch {
      /* next */
    }
  }
  return 0n;
}

export async function payBalance(toBnb: boolean, account: string | null): Promise<bigint> {
  if (!account) return 0n;
  return nativeBalance(toBnb ? "xlayer" : "bsc", account as Hex);
}

export async function quoteGasRoute(toBnb: boolean, from: string, amount: bigint): Promise<GasQuote> {
  if (amount <= 0n) throw new Error("amount");
  const res = await fetch(SWAP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tokenAmountIn: { chainId: toBnb ? 196 : 56, address: "", amount: amount.toString(), decimals: 18 },
      tokenOut: { chainId: toBnb ? 56 : 196, address: "", symbol: toBnb ? "BNB" : "OKB", decimals: 18 },
      from,
      to: from,
      slippage: 100,
    }),
  });
  if (!res.ok) throw new Error("quote");
  const json = (await res.json()) as {
    tokenAmountOut?: { amount?: string };
    tokenAmountOutMin?: { amount?: string };
    tx?: { to?: Hex; data?: Hex; value?: string; chainId?: number };
  };
  const tx = json.tx;
  if (!tx?.to || !tx.data || !json.tokenAmountOut?.amount || !json.tokenAmountOutMin?.amount) throw new Error("quote");
  const chainId = tx.chainId === 56 ? 56 : 196;
  return {
    toBnb,
    amountIn: amount,
    amountOut: BigInt(json.tokenAmountOut.amount),
    amountOutMin: BigInt(json.tokenAmountOutMin.amount),
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || "0"),
    chainId,
  };
}

async function sendValue(from: string, to: Hex, value: bigint, data: Hex = "0x"): Promise<Hex> {
  const eth = await ensureProvider();
  const tx: { from: string; to: Hex; data: Hex; value?: Hex } = { from, to, data };
  if (value > 0n) tx.value = `0x${value.toString(16)}`;
  return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
}

async function mined(chain: "xlayer" | "bsc", hash: Hex): Promise<"ok" | "bad" | "wait"> {
  for (let i = 0; i < 15; i++) {
    for (const url of RPC[chain]) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const json = (await res.json()) as { result?: { status?: string } | null };
        const status = json.result?.status;
        if (status === "0x1") return "ok";
        if (status === "0x0") return "bad";
      } catch {
        /* next rpc */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return "wait";
}

function gasKey(from: string, amount: bigint) {
  return `tl-gas:${from.toLowerCase()}:${amount}`;
}

export async function sendGasRoute(toBnb: boolean, from: string, amount: bigint): Promise<Hex> {
  const chain = toBnb ? "xlayer" : "bsc";
  const parts = await deskParts(chain, from, amount);
  if (parts.swapIn <= 0n) throw new Error("amount");
  const reserve = toBnb ? 2_000_000_000_000_000n : 3_000_000_000_000_000n;
  const bal = await nativeBalance(chain, from as Hex);
  if (bal < amount + reserve) throw new Error("balance");
  const quote = await quoteGasRoute(toBnb, from, parts.swapIn);
  if (quote.value !== parts.swapIn) throw new Error("quote");
  await switchDeskChain(quote.chainId);
  const safe = (toBnb ? XLAYER_SAFE : BSC_SAFE) as Hex;
  const calls: SignedCall[] = [];
  if (parts.reward > 0n && parts.referrer) calls.push({ to: parts.referrer, data: "0x", value: parts.reward });
  if (parts.desk > 0n) calls.push({ to: safe, data: "0x", value: parts.desk });
  calls.push({ to: quote.to, data: quote.data, value: quote.value });
  if (calls.length > 1) {
    try {
      sayTradeStep("both");
      return await sendUserBatch(from, quote.chainId, calls);
    } catch (err) {
      if (rejected(err)) throw err;
      const message = err instanceof Error ? err.message : "";
      if (message !== "no-batch") throw err;
    }
  }
  const key = gasKey(from, amount);
  let hash = "";
  try {
    hash = sessionStorage.getItem(key) ?? "";
  } catch {
    hash = "";
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    sayTradeStep("fill");
    hash = await sendValue(from, quote.to, quote.value, quote.data);
    try {
      sessionStorage.setItem(key, hash);
    } catch {
      /* ignore */
    }
  }
  const state = await mined(chain, hash as Hex);
  if (state === "wait") throw new Error("pending");
  if (state === "bad") {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    throw new Error("reverted");
  }
  if (parts.reward > 0n || parts.desk > 0n) sayTradeStep("fee");
  try {
    if (parts.reward > 0n && parts.referrer) await sendValue(from, parts.referrer, parts.reward);
    if (parts.desk > 0n) await sendValue(from, safe, parts.desk);
  } catch (err) {
    if (rejected(err)) throw new Error("fee-open");
    throw new Error("fee-open");
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  return hash as Hex;
}
