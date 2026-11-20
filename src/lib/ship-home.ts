import { encodeAbiParameters, type Hex } from "viem";
import { BSC, BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { CREATE_CALL, createCallData, createdAddress } from "@/lib/create-call";
import { BSC_REBATE, KNOWN_XPERP, X_USDT } from "@/lib/perp";
import { VAULT_BYTECODE } from "@/lib/vault-artifact";
import { armChain, ensureProvider, remoteWallet, switchDeskChain } from "@/lib/wallet";

const RPC: Record<56 | 196, string[]> = {
  56: ["https://bsc-dataseed.binance.org", "https://bsc-dataseed.bnbchain.org"],
  196: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
};

export async function deployExitVault(chain: "bsc" | "xlayer", from: string): Promise<string> {
  const chainId: 56 | 196 = chain === "bsc" ? 56 : 196;
  const safe = chain === "bsc" ? BSC_SAFE : XLAYER_SAFE;
  if (from.toLowerCase() !== safe.toLowerCase()) throw new Error("safe");
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint16" }],
    [chain === "bsc" ? BSC.usdt : X_USDT, (chain === "bsc" ? BSC_REBATE : KNOWN_XPERP) as Hex, safe, 1000],
  );
  const init = `${VAULT_BYTECODE}${args.slice(2)}` as Hex;
  const eth = await ensureProvider();
  if (remoteWallet()) await armChain(chainId);
  else await switchDeskChain(chainId);
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: CREATE_CALL, data: createCallData(init), chainId: chainId === 56 ? "0x38" : "0xc4" }],
  })) as Hex;
  const logs = await mined(chainId, hash);
  return createdAddress(logs);
}

async function mined(chainId: 56 | 196, hash: Hex): Promise<{ data: Hex; topics: Hex[] }[]> {
  for (let i = 0; i < 40; i++) {
    for (const url of RPC[chainId]) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const json = (await res.json()) as { result?: { status?: string; logs?: { data: Hex; topics: Hex[] }[] } | null };
        if (json.result?.status === "0x1") return json.result.logs ?? [];
        if (json.result?.status === "0x0") throw new Error("revert");
      } catch (err) {
        if (err instanceof Error && err.message === "revert") throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("pending");
}
