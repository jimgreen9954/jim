import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
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
};

/** One signature. The phone wallet sees the same router call as the desktop, not a chain switch plus a fee plus a swap. */
export async function sendFeeAndSwap(args: FeeSwap): Promise<Hex> {
  const { from, chainId, token, safe, parts, swapTo, data, value } = args;
  if (remoteWallet()) {
    sayTradeStep("fill");
    return sendTx(from, chainId, swapTo, data, value);
  }
  const calls = feeCalls(token, safe, parts);
  calls.push({ to: swapTo, data, value });
  if (parts.desk <= 0n && parts.reward <= 0n) {
    sayTradeStep("both");
    return sendUserBatch(from, chainId, calls);
  }
  try {
    sayTradeStep("both");
    return await sendUserBatch(from, chainId, calls);
  } catch (err) {
    if (rejected(err) || err instanceof TxPending) throw err;
    const message = err instanceof Error ? err.message : "";
    if (message !== "no-batch") throw err;
  }
  if (!token) {
    try {
      sayTradeStep("both");
      return await sendAsMulticall(from, calls, chainId);
    } catch (err) {
      if (rejected(err) || err instanceof TxPending) throw err;
      const message = err instanceof Error ? err.message : "";
      if (message !== "no-batch") throw err;
    }
    if (args.lock === false) throw new Error("no-batch");
  }
  const fees = feeCalls(token, safe, parts);
  for (const call of fees) {
    sayTradeStep("fee");
    await mined(chainId, await sendTx(from, chainId, call.to, call.data, call.value ?? 0n));
  }
  sayTradeStep("fill");
  return sendTx(from, chainId, swapTo, data, value);
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
