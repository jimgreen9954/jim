import { createPublicClient, formatUnits, http, isAddress, type Hex } from "viem";
import { BSC, connectBsc, FEE_TO } from "@/lib/bsc";
import { deskParts } from "@/lib/invite-cut";
import { connectXLayer, XLAYER } from "@/lib/xlayer";
import { getProvider, walletKind } from "@/lib/wallet";

const SLIPPAGE = 300;

export type GasQuote = {
  out: bigint;
  min: bigint;
  seconds: number;
};

type RawTx = { to: Hex; data: Hex; value: bigint; chainId: number };

function native(chainId: number) {
  return { address: "", amount: "0", chainId, decimals: 18 };
}

export async function readGasBalances(account: string): Promise<{ bnb: bigint; okb: bigint }> {
  const bsc = createPublicClient({ transport: http(BSC.rpc) });
  const x = createPublicClient({ transport: http(XLAYER.rpc) });
  const [bnb, okb] = await Promise.all([
    bsc.getBalance({ address: account as Hex }),
    x.getBalance({ address: account as Hex }),
  ]);
  return { bnb, okb };
}

export async function quoteGasSwap(toOkb: boolean, from: string, amount: bigint): Promise<GasQuote & { tx: RawTx }> {
  const body = {
    tokenAmountIn: { ...native(toOkb ? 56 : 196), amount: amount.toString() },
    tokenOut: native(toOkb ? 196 : 56),
    from,
    to: from,
    slippage: SLIPPAGE,
  };
  const response = await fetch("https://api.symbiosis.finance/crosschain/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as {
    message?: string;
    tokenAmountOut?: { amount?: string; chainId?: number };
    tokenAmountOutMin?: { amount?: string };
    estimatedTime?: number;
    tx?: { to?: string; data?: string; value?: string; chainId?: number };
  };
  if (!response.ok) throw new Error(json.message || "quote");
  const tx = json.tx;
  const out = BigInt(json.tokenAmountOut?.amount || "0");
  const min = BigInt(json.tokenAmountOutMin?.amount || "0");
  const value = BigInt(tx?.value || "0");
  const chainId = Number(tx?.chainId);
  if (!tx || !isAddress(tx.to || "") || !tx.data?.startsWith("0x") || value !== amount || out <= 0n || min <= 0n) throw new Error("quote");
  if (toOkb && chainId !== 56) throw new Error("quote");
  if (!toOkb && chainId !== 196) throw new Error("quote");
  if (json.tokenAmountOut?.chainId !== (toOkb ? 196 : 56)) throw new Error("quote");
  return {
    out,
    min,
    seconds: Number(json.estimatedTime) || 0,
    tx: { to: tx.to as Hex, data: tx.data as Hex, value, chainId },
  };
}

export function showGas(amount: bigint): string {
  const n = Number(formatUnits(amount, 18));
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 6 }) : formatUnits(amount, 18);
}

export async function sendGasSwap(toOkb: boolean, from: string, amount: bigint): Promise<Hex> {
  const parts = await deskParts(toOkb ? "bsc" : "xlayer", from, amount);
  if (parts.swapIn <= 0n) throw new Error("amount");
  if (toOkb) await connectBsc();
  else await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const chainId = toOkb ? BSC.hex : XLAYER.hex;
  const client = createPublicClient({ transport: http(toOkb ? BSC.rpc : XLAYER.rpc) });
  const pay = async (to: Hex, value: bigint) => {
    if (value <= 0n) return;
    const row: { from: string; to: Hex; data: Hex; value: string; chainId?: string } = {
      from,
      to,
      data: "0x",
      value: `0x${value.toString(16)}`,
    };
    if (walletKind() !== "binance") row.chainId = chainId;
    const hash = (await eth.request({ method: "eth_sendTransaction", params: [row] })) as Hex;
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error("revert");
  };
  if (parts.reward > 0n && parts.referrer) await pay(parts.referrer, parts.reward);
  if (parts.desk > 0n) await pay(FEE_TO, parts.desk);
  let quote: GasQuote & { tx: RawTx };
  try {
    quote = await quoteGasSwap(toOkb, from, parts.swapIn);
  } catch (error) {
    if (parts.reward > 0n || parts.desk > 0n) throw new Error("fee-kept");
    throw error;
  }
  const tx: { from: string; to: Hex; data: Hex; value: string; chainId?: string } = {
    from,
    to: quote.tx.to,
    data: quote.tx.data,
    value: `0x${quote.tx.value.toString(16)}`,
  };
  if (walletKind() !== "binance") tx.chainId = chainId;
  try {
    return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  } catch (error) {
    if (parts.reward > 0n || parts.desk > 0n) throw new Error("fee-kept");
    throw error;
  }
}
