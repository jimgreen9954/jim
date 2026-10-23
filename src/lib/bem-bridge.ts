import { createPublicClient, encodeFunctionData, http, pad, parseAbi, type Hex } from "viem";
import { BSC, connectBsc, FEE_TO } from "@/lib/bsc";
import { deskParts } from "@/lib/invite-cut";
import { TAPE_BEM } from "@/lib/tape-pool";
import { getProvider, walletKind } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

export const BSC_BRIDGE = "0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72" as const;
export const X_EID = 30274;
export const BSC_EID = 30102;
const OPTIONS = "0x000301001101000000000000000000000000000249f0" as Hex;

const abi = parseAbi([
  "function quoteOFT((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam) view returns ((uint256 minAmountLD, uint256 maxAmountLD) oftLimit, (int256 feeAmountLD, string description)[] oftFeeDetails, (uint256 amountSentLD, uint256 amountReceivedLD) oftReceipt)",
  "function quoteSend((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, bool _payInLzToken) view returns ((uint256 nativeFee, uint256 lzTokenFee))",
  "function send((uint32 dstEid, bytes32 to, uint256 amountLD, uint256 minAmountLD, bytes extraOptions, bytes composeMsg, bytes oftCmd) _sendParam, (uint256 nativeFee, uint256 lzTokenFee) _fee, address _refundAddress) payable",
]);
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

const bsc = createPublicClient({ transport: http(BSC.rpc) });
const xlayer = createPublicClient({ transport: http(XLAYER.rpc) });

export type BridgeQuote = { sent: bigint; received: bigint; nativeFee: bigint };

function param(toX: boolean, account: string, amount: bigint, min: bigint) {
  return {
    dstEid: toX ? X_EID : BSC_EID,
    to: pad(account as Hex),
    amountLD: amount,
    minAmountLD: min,
    extraOptions: OPTIONS,
    composeMsg: "0x" as Hex,
    oftCmd: "0x" as Hex,
  };
}

export async function quoteBridge(toX: boolean, account: string, amount: bigint): Promise<BridgeQuote> {
  const client = toX ? bsc : xlayer;
  const bridge = (toX ? BSC_BRIDGE : TAPE_BEM) as Hex;
  const oft = await client.readContract({ address: bridge, abi, functionName: "quoteOFT", args: [param(toX, account, amount, 0n)] });
  const received = oft[2].amountReceivedLD;
  if (received <= 0n || received > amount) throw new Error("quote");
  const fee = await client.readContract({ address: bridge, abi, functionName: "quoteSend", args: [param(toX, account, amount, received), false] });
  if (fee.nativeFee <= 0n) throw new Error("quote");
  return { sent: oft[2].amountSentLD, received, nativeFee: fee.nativeFee };
}

export async function bscBemBalance(account: string): Promise<bigint> {
  return bsc.readContract({ address: BSC.bem, abi: erc20, functionName: "balanceOf", args: [account as Hex] });
}

export async function payBridgeFee(toX: boolean, from: string, amount: bigint): Promise<void> {
  const parts = await deskParts(toX ? "bsc" : "xlayer", from, amount);
  if (parts.reward <= 0n && parts.desk <= 0n) return;
  const token = (toX ? BSC.bem : TAPE_BEM) as Hex;
  const client = toX ? bsc : xlayer;
  const chainId = toX ? BSC.hex : XLAYER.hex;
  if (toX) await connectBsc();
  else await connectXLayer();
  if (parts.reward > 0n && parts.referrer) {
    const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [parts.referrer, parts.reward] });
    await tx(from, token, data, 0n, chainId, client);
  }
  if (parts.desk > 0n) {
    const data = encodeFunctionData({ abi: erc20, functionName: "transfer", args: [FEE_TO, parts.desk] });
    await tx(from, token, data, 0n, chainId, client);
  }
}

export async function sendBridge(toX: boolean, from: string, amount: bigint): Promise<Hex> {
  const quote = await quoteBridge(toX, from, amount);
  const bridge = (toX ? BSC_BRIDGE : TAPE_BEM) as Hex;
  const client = toX ? bsc : xlayer;
  if (toX) {
    await connectBsc();
    const allowance = await bsc.readContract({ address: BSC.bem, abi: erc20, functionName: "allowance", args: [from as Hex, BSC_BRIDGE] });
    if (allowance < amount) {
      const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [BSC_BRIDGE, amount] });
      await bsc.call({ account: from as Hex, to: BSC.bem, data });
      await tx(from, BSC.bem, data, 0n, BSC.hex, bsc);
    }
  } else {
    await connectXLayer();
  }
  const fresh = await quoteBridge(toX, from, amount);
  const data = encodeFunctionData({
    abi,
    functionName: "send",
    args: [param(toX, from, amount, fresh.received), { nativeFee: fresh.nativeFee, lzTokenFee: 0n }, from as Hex],
  });
  let failed: unknown = null;
  for (let i = 0; i < 4; i += 1) {
    try {
      await client.call({ account: from as Hex, to: bridge, data, value: fresh.nativeFee });
      failed = null;
      break;
    } catch (error) {
      failed = error;
      const text = error instanceof Error ? error.message : "";
      if (!/allow|allowance/i.test(text) || i === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  if (failed) throw failed;
  return tx(from, bridge, data, fresh.nativeFee, toX ? BSC.hex : XLAYER.hex, client);
}

async function tx(from: string, to: Hex, data: Hex, value: bigint, chainId: string, client: typeof bsc): Promise<Hex> {
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const row: { from: string; to: Hex; data: Hex; value: string; chainId?: string; gas?: Hex } = { from, to, data, value: `0x${value.toString(16)}` };
  if (walletKind() !== "binance") row.chainId = chainId;
  try {
    const gas = await client.estimateGas({ account: from as Hex, to, data, value });
    row.gas = `0x${((gas * 3n) / 2n).toString(16)}`;
  } catch {
    /* The wallet estimates when this RPC cannot see the new allowance yet. */
  }
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [row],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}
