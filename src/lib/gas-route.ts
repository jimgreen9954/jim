import type { Hex } from "viem";
import { assertGasQuote } from "@/lib/gas-quote-check";
import { BSC, BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { sendFeeAndSwap } from "@/lib/fee-pack";
import { deskParts } from "@/lib/invite-cut";
import { TxPending } from "@/lib/chain-marks";
import { switchDeskChain } from "@/lib/wallet";
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
  const sourceChain = toBnb ? 196 : 56;
  const targetChain = toBnb ? 56 : 196;
  const res = await fetch(SWAP, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tokenAmountIn: { chainId: sourceChain, address: "", amount: amount.toString(), decimals: 18 },
      tokenOut: { chainId: targetChain, address: "", symbol: toBnb ? "BNB" : "OKB", decimals: 18 },
      from,
      to: from,
      slippage: 100,
    }),
  });
  if (!res.ok) throw new Error("quote");
  const json = (await res.json()) as {
    tokenAmountOut?: { amount?: string; chainId?: number | string; address?: string; symbol?: string };
    tokenAmountOutMin?: { amount?: string; chainId?: number | string; address?: string; symbol?: string };
    approveTo?: string;
    tx?: { to?: Hex; data?: Hex; value?: string; chainId?: number | string };
  };
  const checked = await assertGasQuote(
    { sourceChain, targetChain, user: from, amountIn: amount, symbolOut: toBnb ? "BNB" : "OKB" },
    json,
  );
  return {
    toBnb,
    amountIn: amount,
    amountOut: checked.amountOut,
    amountOutMin: checked.amountOutMin,
    to: checked.to,
    data: checked.data,
    value: checked.value,
    chainId: checked.chainId,
  };
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
  const key = gasKey(from, amount);
  let prior = "";
  try {
    prior = sessionStorage.getItem(key) ?? "";
  } catch {
    prior = "";
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(prior)) {
    const state = await mined(chain, prior as Hex);
    if (state === "ok") return prior as Hex;
    if (state === "wait") throw new Error("pending");
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  let hash: Hex;
  try {
    hash = await sendFeeAndSwap({
      from,
      chainId: quote.chainId,
      token: null,
      safe,
      parts,
      swapTo: quote.to,
      data: quote.data,
      value: quote.value,
      pull: 0n,
      spender: quote.to,
      lock: false,
      mark: key,
    });
  } catch (err) {
    if (err instanceof TxPending) throw new Error("pending");
    throw err;
  }
  try {
    sessionStorage.setItem(key, hash);
  } catch {
    /* ignore */
  }
  const state = await mined(chain, hash);
  if (state === "wait") throw new Error("pending");
  if (state === "bad") {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    throw new Error("reverted");
  }
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  return hash;
}
