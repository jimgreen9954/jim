import { createPublicClient, encodeFunctionData, http, pad, parseAbi, type Hex } from "viem";
import { BSC, connectBsc } from "@/lib/bsc";
import { TAPE_BEM } from "@/lib/tape-pool";
import { ensureProvider } from "@/lib/wallet";
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

function optionsFor(toX: boolean): Hex {
  return toX ? OPTIONS : "0x";
}

function param(toX: boolean, account: string, amount: bigint, min: bigint) {
  return {
    dstEid: toX ? X_EID : BSC_EID,
    to: pad(account as Hex),
    amountLD: amount,
    minAmountLD: min,
    extraOptions: optionsFor(toX),
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

export async function sendBridge(toX: boolean, from: string, amount: bigint): Promise<Hex> {
  const signer = toX ? await connectBsc() : await connectXLayer();
  const who = (signer || from) as Hex;
  if (amount <= 0n) throw new Error("amount");
  const token = (toX ? BSC.bem : TAPE_BEM) as Hex;
  const bridge = (toX ? BSC_BRIDGE : TAPE_BEM) as Hex;
  const client = toX ? bsc : xlayer;
  const held = await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
  if (held < amount) throw new Error("balance");
  if (toX) {
    const allowance = await client.readContract({
      address: token,
      abi: erc20,
      functionName: "allowance",
      args: [who, bridge],
    });
    if (allowance < amount) {
      const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [bridge, amount] });
      await tx(who, token, data, 0n, client);
    }
  }
  const fresh = await quoteBridge(toX, who, amount);
  const data = encodeFunctionData({
    abi,
    functionName: "send",
    args: [param(toX, who, amount, fresh.received), { nativeFee: fresh.nativeFee, lzTokenFee: 0n }, who],
  });
  return tx(who, bridge, data, fresh.nativeFee, client);
}

async function tx(from: string, to: Hex, data: Hex, value: bigint, client: typeof bsc): Promise<Hex> {
  const eth = await ensureProvider();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}
