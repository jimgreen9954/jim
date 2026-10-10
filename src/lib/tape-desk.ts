import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { TAPE_DESK_BYTECODE } from "@/lib/tape-desk-artifact";
import { TAPE_BEM, TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { getProvider } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

/** The one deployed desk. Bytecode matches contracts/TapeDesk.sol. No admin. */
export const TAPE_DESK = "0x72e28d564A90eF3E76f599bC210454f5360E200C" as const;

const KEY = "tapeliquid-desk";
const abi = parseAbi([
  "function fundUsdt(uint256)",
  "function withdrawUsdt(uint256)",
  "function withdrawTape(uint256)",
  "function sell(uint256)",
  "function bidOf(address) view returns (uint256 usdtLeft, uint256 tapeOwed)",
  "function usdtPool() view returns (uint256)",
]);
const erc20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const client = createPublicClient({ transport: http(XLAYER.rpc) });

export function deskAddress(): Hex | null {
  const fixed = TAPE_DESK as string;
  if (/^0x[a-fA-F0-9]{40}$/.test(fixed)) return fixed as Hex;
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(KEY) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved as Hex : null;
}

export type DeskState = {
  usdtPool: bigint;
  usdtLeft: bigint;
  tapeOwed: bigint;
  tapeBal: bigint;
  usdtBal: bigint;
  bemBal: bigint;
};

const empty: DeskState = {
  usdtPool: 0n, usdtLeft: 0n, tapeOwed: 0n, tapeBal: 0n, usdtBal: 0n, bemBal: 0n,
};

export async function readDesk(account: string | null): Promise<DeskState | null> {
  const desk = deskAddress();
  if (!desk) return null;
  const who = (account ?? "0x0000000000000000000000000000000000000000") as Hex;
  const [usdtPool, bid, tapeBal, usdtBal, bemBal] = await Promise.all([
    client.readContract({ address: desk, abi, functionName: "usdtPool" }),
    client.readContract({ address: desk, abi, functionName: "bidOf", args: [who] }),
    account ? client.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
    account ? client.readContract({ address: TAPE_USDT, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
    account ? client.readContract({ address: TAPE_BEM, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
  ]);
  return {
    ...empty,
    usdtPool, usdtLeft: bid[0], tapeOwed: bid[1], tapeBal, usdtBal, bemBal,
  };
}

async function send(from: string, to: Hex | undefined, data: Hex): Promise<Hex> {
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const tx: { from: string; to?: Hex; data: Hex; chainId: string; gas?: Hex } = { from, data, chainId: XLAYER.hex };
  if (to) tx.to = to;
  else tx.gas = "0x4c4b40";
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

async function probe(from: string, to: Hex, data: Hex) {
  try {
    await client.call({ account: from as Hex, to, data });
  } catch (err) {
    const text = err instanceof Error ? `${err.name} ${err.message}` : "";
    if (/revert|invalid opcode|execution/i.test(text)) throw err;
  }
}

async function approve(from: string, token: Hex, amount: bigint) {
  const desk = deskAddress();
  if (!desk) throw new Error("desk");
  const allowance = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, desk] });
  if (allowance >= amount) return;
  if (allowance > 0n) {
    const zero = encodeFunctionData({ abi: erc20, functionName: "approve", args: [desk, 0n] });
    await probe(from, token, zero);
    await send(from, token, zero);
  }
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [desk, amount] });
  await probe(from, token, data);
  await send(from, token, data);
}

async function call(from: string, data: Hex) {
  const desk = deskAddress();
  if (!desk) throw new Error("desk");
  await probe(from, desk, data);
  return send(from, desk, data);
}

export async function deployDesk(from: string): Promise<string> {
  const hash = await send(from, undefined, TAPE_DESK_BYTECODE);
  const receipt = await client.getTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("revert");
  window.localStorage.setItem(KEY, receipt.contractAddress);
  return receipt.contractAddress;
}

export function wholeTape(text: string): bigint {
  const trimmed = text.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) throw new Error("integer");
  return parseUnits(trimmed, 8);
}

export function units(text: string, decimals: number): bigint {
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error("amount");
  const amount = parseUnits(cleaned, decimals);
  if (amount <= 0n) throw new Error("amount");
  return amount;
}

export const deskText = (amount: bigint, decimals: number, digits = 4) => {
  const raw = formatUnits(amount, decimals);
  const [whole, frac = ""] = raw.split(".");
  const cut = frac.slice(0, digits).replace(/0+$/, "");
  return cut ? `${Number(whole).toLocaleString("en-US")}.${cut}` : Number(whole).toLocaleString("en-US");
};

export async function fundUsdt(from: string, amount: bigint) {
  await approve(from, TAPE_USDT, amount);
  return call(from, encodeFunctionData({ abi, functionName: "fundUsdt", args: [amount] }));
}
export async function withdrawUsdt(from: string, amount: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "withdrawUsdt", args: [amount] }));
}
export async function withdrawBought(from: string, amount: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "withdrawTape", args: [amount] }));
}
export async function sellTape(from: string, amount: bigint) {
  await approve(from, TAPE_TOKEN, amount);
  return call(from, encodeFunctionData({ abi, functionName: "sell", args: [amount] }));
}
