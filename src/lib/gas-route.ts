import type { Hex } from "viem";
import { BSC, BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { deskParts } from "@/lib/invite-cut";
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
  let paid = false;
  if (parts.reward > 0n && parts.referrer) {
    await sendValue(from, parts.referrer, parts.reward);
    paid = true;
  }
  if (parts.desk > 0n) {
    await sendValue(from, safe, parts.desk);
    paid = true;
  }
  try {
    return await sendValue(from, quote.to, quote.value, quote.data);
  } catch (err) {
    if (paid) throw new Error("fee-kept");
    throw err;
  }
}
