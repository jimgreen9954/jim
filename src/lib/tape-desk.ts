import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { TAPE_DESK_BYTECODE } from "@/lib/tape-desk-artifact";
import { TAPE_BEM, TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { getProvider } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

/** Filled after the desk is deployed. Until then, only the browser that deployed it can read the address. */
export const TAPE_DESK = "" as const;

const KEY = "tapeliquid-desk";
const abi = parseAbi([
  "function fundUsdt(uint256)",
  "function withdrawUsdt(uint256)",
  "function withdrawTape(uint256)",
  "function sell(uint256)",
  "function bidOf(address) view returns (uint256 usdtLeft, uint256 tapeOwed)",
  "function usdtPool() view returns (uint256)",
  "function stakeTape(uint256)",
  "function unstakeTape(uint256)",
  "function claimBem()",
  "function fundBem(uint256)",
  "function withdrawBem(uint256)",
  "function stakeBem(uint256)",
  "function unstakeBem(uint256)",
  "function claimTape()",
  "function fundTape(uint256)",
  "function withdrawTapeReward(uint256)",
  "function tapeStakeOf(address) view returns (uint256 amount, uint256 bemOwed)",
  "function bemStakeOf(address) view returns (uint256 amount, uint256 tapeOwed)",
  "function bemSponsorOf(address) view returns (uint256)",
  "function tapeSponsorOf(address) view returns (uint256)",
  "function tapeStakePot() view returns (uint256 staked, uint256 pot)",
  "function bemStakePot() view returns (uint256 staked, uint256 pot)",
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
  tapeStaked: bigint;
  bemOwed: bigint;
  bemStaked: bigint;
  tapeOwedStake: bigint;
  bemPot: bigint;
  tapePot: bigint;
  tapeStakedTotal: bigint;
  bemStakedTotal: bigint;
  bemSponsor: bigint;
  tapeSponsor: bigint;
};

const empty: DeskState = {
  usdtPool: 0n, usdtLeft: 0n, tapeOwed: 0n, tapeBal: 0n, usdtBal: 0n, bemBal: 0n,
  tapeStaked: 0n, bemOwed: 0n, bemStaked: 0n, tapeOwedStake: 0n, bemPot: 0n, tapePot: 0n,
  tapeStakedTotal: 0n, bemStakedTotal: 0n, bemSponsor: 0n, tapeSponsor: 0n,
};

export async function readDesk(account: string | null): Promise<DeskState | null> {
  const desk = deskAddress();
  if (!desk) return null;
  const who = (account ?? "0x0000000000000000000000000000000000000000") as Hex;
  const [usdtPool, bid, tapeBal, usdtBal, bemBal, tapeSeat, bemSeat, tapePot, bemPot, bemSponsor, tapeSponsor] = await Promise.all([
    client.readContract({ address: desk, abi, functionName: "usdtPool" }),
    client.readContract({ address: desk, abi, functionName: "bidOf", args: [who] }),
    account ? client.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
    account ? client.readContract({ address: TAPE_USDT, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
    account ? client.readContract({ address: TAPE_BEM, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
    client.readContract({ address: desk, abi, functionName: "tapeStakeOf", args: [who] }),
    client.readContract({ address: desk, abi, functionName: "bemStakeOf", args: [who] }),
    client.readContract({ address: desk, abi, functionName: "tapeStakePot" }),
    client.readContract({ address: desk, abi, functionName: "bemStakePot" }),
    client.readContract({ address: desk, abi, functionName: "bemSponsorOf", args: [who] }),
    client.readContract({ address: desk, abi, functionName: "tapeSponsorOf", args: [who] }),
  ]);
  return {
    ...empty,
    usdtPool, usdtLeft: bid[0], tapeOwed: bid[1], tapeBal, usdtBal, bemBal,
    tapeStaked: tapeSeat[0], bemOwed: tapeSeat[1], bemStaked: bemSeat[0], tapeOwedStake: bemSeat[1],
    bemPot: tapePot[1], tapePot: bemPot[1], tapeStakedTotal: tapePot[0], bemStakedTotal: bemPot[0],
    bemSponsor, tapeSponsor,
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

async function approve(from: string, token: Hex, amount: bigint) {
  const desk = deskAddress();
  if (!desk) throw new Error("desk");
  const allowance = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, desk] });
  if (allowance >= amount) return;
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [desk, amount] });
  await client.call({ account: from as Hex, to: token, data });
  await send(from, token, data);
}

async function call(from: string, data: Hex) {
  const desk = deskAddress();
  if (!desk) throw new Error("desk");
  await client.call({ account: from as Hex, to: desk, data });
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
  const amount = parseUnits(text.trim(), decimals);
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
export async function stakeTape(from: string, amount: bigint) {
  await approve(from, TAPE_TOKEN, amount);
  return call(from, encodeFunctionData({ abi, functionName: "stakeTape", args: [amount] }));
}
export async function unstakeTape(from: string, amount: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "unstakeTape", args: [amount] }));
}
export async function claimStakeBem(from: string) {
  return call(from, encodeFunctionData({ abi, functionName: "claimBem" }));
}
export async function fundBemReward(from: string, amount: bigint) {
  await approve(from, TAPE_BEM, amount);
  return call(from, encodeFunctionData({ abi, functionName: "fundBem", args: [amount] }));
}
export async function withdrawBemReward(from: string, amount: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "withdrawBem", args: [amount] }));
}
export async function stakeBem(from: string, amount: bigint) {
  await approve(from, TAPE_BEM, amount);
  return call(from, encodeFunctionData({ abi, functionName: "stakeBem", args: [amount] }));
}
export async function unstakeBem(from: string, amount: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "unstakeBem", args: [amount] }));
}
export async function claimStakeTape(from: string) {
  return call(from, encodeFunctionData({ abi, functionName: "claimTape" }));
}
export async function fundTapeReward(from: string, amount: bigint) {
  await approve(from, TAPE_TOKEN, amount);
  return call(from, encodeFunctionData({ abi, functionName: "fundTape", args: [amount] }));
}
export async function withdrawTapeReward(from: string, amount: bigint) {
  return call(from, encodeFunctionData({ abi, functionName: "withdrawTapeReward", args: [amount] }));
}
