import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { TAPE_TERM_BYTECODE } from "@/lib/tape-term-artifact";
import { TAPE_BEM, TAPE_TOKEN } from "@/lib/tape-pool";
import { getProvider } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

/** Deployed timed stake. Creation bytecode matches contracts/TapeTerm.sol. No admin. */
export const TAPE_TERM = "0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A" as const;

const KEY = "tapeliquid-term";
const abi = parseAbi([
  "function stakeTape(uint256,uint8)",
  "function unstakeTape(uint256)",
  "function claimBem()",
  "function fundBem(uint256)",
  "function withdrawBem(uint256)",
  "function stakeBem(uint256,uint8)",
  "function unstakeBem(uint256)",
  "function claimTape()",
  "function fundTape(uint256)",
  "function withdrawTapeReward(uint256)",
  "function tapeLockCount(address) view returns (uint256)",
  "function bemLockCount(address) view returns (uint256)",
  "function tapeLock(address,uint256) view returns (uint128 amount, uint64 unlock, uint8 term, bool open)",
  "function bemLock(address,uint256) view returns (uint128 amount, uint64 unlock, uint8 term, bool open)",
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

export const TERM_IDS = [0, 1, 2, 3, 4, 5] as const;
export type TermId = (typeof TERM_IDS)[number];

export function termAddress(): Hex | null {
  const fixed = TAPE_TERM as string;
  if (/^0x[a-fA-F0-9]{40}$/.test(fixed)) return fixed as Hex;
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(KEY) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? saved as Hex : null;
}

export type TermLock = {
  index: number;
  amount: bigint;
  unlock: bigint;
  term: number;
  open: boolean;
};

export type TermState = {
  tapeBal: bigint;
  bemBal: bigint;
  tapeStaked: bigint;
  bemOwed: bigint;
  bemStaked: bigint;
  tapeOwed: bigint;
  bemPot: bigint;
  tapePot: bigint;
  tapeStakedTotal: bigint;
  bemStakedTotal: bigint;
  bemSponsor: bigint;
  tapeSponsor: bigint;
  tapeLocks: TermLock[];
  bemLocks: TermLock[];
};

async function locksOf(term: Hex, who: Hex, countName: "tapeLockCount" | "bemLockCount", rowName: "tapeLock" | "bemLock"): Promise<TermLock[]> {
  const count = await client.readContract({ address: term, abi, functionName: countName, args: [who] });
  const n = Number(count);
  if (!Number.isSafeInteger(n) || n <= 0) return [];
  const rows = await Promise.all(Array.from({ length: n }, (_, index) =>
    client.readContract({ address: term, abi, functionName: rowName, args: [who, BigInt(index)] }),
  ));
  return rows.map((row, index) => ({
    index,
    amount: row[0],
    unlock: row[1],
    term: row[2],
    open: row[3],
  }));
}

export async function readTerm(account: string | null): Promise<TermState | null> {
  const term = termAddress();
  if (!term) return null;
  const who = (account ?? "0x0000000000000000000000000000000000000000") as Hex;
  const [tapeBal, bemBal, tapeSeat, bemSeat, tapePot, bemPot, bemSponsor, tapeSponsor, tapeLocks, bemLocks] = await Promise.all([
    account ? client.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
    account ? client.readContract({ address: TAPE_BEM, abi: erc20, functionName: "balanceOf", args: [who] }) : 0n,
    client.readContract({ address: term, abi, functionName: "tapeStakeOf", args: [who] }),
    client.readContract({ address: term, abi, functionName: "bemStakeOf", args: [who] }),
    client.readContract({ address: term, abi, functionName: "tapeStakePot" }),
    client.readContract({ address: term, abi, functionName: "bemStakePot" }),
    client.readContract({ address: term, abi, functionName: "bemSponsorOf", args: [who] }),
    client.readContract({ address: term, abi, functionName: "tapeSponsorOf", args: [who] }),
    locksOf(term, who, "tapeLockCount", "tapeLock"),
    locksOf(term, who, "bemLockCount", "bemLock"),
  ]);
  return {
    tapeBal, bemBal,
    tapeStaked: tapeSeat[0], bemOwed: tapeSeat[1], bemStaked: bemSeat[0], tapeOwed: bemSeat[1],
    bemPot: tapePot[1], tapePot: bemPot[1], tapeStakedTotal: tapePot[0], bemStakedTotal: bemPot[0],
    bemSponsor, tapeSponsor, tapeLocks, bemLocks,
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
  const term = termAddress();
  if (!term) throw new Error("term");
  const allowance = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [from as Hex, term] });
  if (allowance >= amount) return;
  const data = encodeFunctionData({ abi: erc20, functionName: "approve", args: [term, amount] });
  await probe(from, token, data);
  await send(from, token, data);
}

async function call(from: string, data: Hex) {
  const term = termAddress();
  if (!term) throw new Error("term");
  await probe(from, term, data);
  return send(from, term, data);
}

export async function deployTerm(from: string): Promise<string> {
  const hash = await send(from, undefined, TAPE_TERM_BYTECODE);
  const receipt = await client.getTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error("revert");
  window.localStorage.setItem(KEY, receipt.contractAddress);
  return receipt.contractAddress;
}

export function asTerm(id: number): TermId {
  if (id === 0 || id === 1 || id === 2 || id === 3 || id === 4 || id === 5) return id;
  throw new Error("term");
}

export async function stakeTermTape(from: string, amount: bigint, term: TermId) {
  await approve(from, TAPE_TOKEN, amount);
  return call(from, encodeFunctionData({ abi, functionName: "stakeTape", args: [amount, term] }));
}
export async function unstakeTermTape(from: string, index: number) {
  return call(from, encodeFunctionData({ abi, functionName: "unstakeTape", args: [BigInt(index)] }));
}
export async function claimTermBem(from: string) {
  return call(from, encodeFunctionData({ abi, functionName: "claimBem" }));
}
export async function fundTermBem(from: string, amount: bigint) {
  await approve(from, TAPE_BEM, amount);
  return call(from, encodeFunctionData({ abi, functionName: "fundBem", args: [amount] }));
}
const YEAR = 365n * 24n * 60n * 60n;

async function rewardThatFits(from: string, kind: "bem" | "tape"): Promise<bigint> {
  const fresh = await readTerm(from);
  if (!fresh) throw new Error("term");
  const cap = kind === "bem"
    ? (fresh.bemSponsor < fresh.bemPot ? fresh.bemSponsor : fresh.bemPot)
    : (fresh.tapeSponsor < fresh.tapePot ? fresh.tapeSponsor : fresh.tapePot);
  const slip = cap * 180n / YEAR + 1n;
  const amount = cap > slip ? cap - slip : cap;
  if (amount <= 0n) throw new Error("amount");
  return amount;
}

export async function withdrawTermBem(from: string, _amount: bigint) {
  const amount = await rewardThatFits(from, "bem");
  return call(from, encodeFunctionData({ abi, functionName: "withdrawBem", args: [amount] }));
}
export async function stakeTermBem(from: string, amount: bigint, term: TermId) {
  await approve(from, TAPE_BEM, amount);
  return call(from, encodeFunctionData({ abi, functionName: "stakeBem", args: [amount, term] }));
}
export async function unstakeTermBem(from: string, index: number) {
  return call(from, encodeFunctionData({ abi, functionName: "unstakeBem", args: [BigInt(index)] }));
}
export async function claimTermTape(from: string) {
  return call(from, encodeFunctionData({ abi, functionName: "claimTape" }));
}
export async function fundTermTape(from: string, amount: bigint) {
  await approve(from, TAPE_TOKEN, amount);
  return call(from, encodeFunctionData({ abi, functionName: "fundTape", args: [amount] }));
}
export async function withdrawTermTape(from: string, _amount: bigint) {
  const amount = await rewardThatFits(from, "tape");
  return call(from, encodeFunctionData({ abi, functionName: "withdrawTapeReward", args: [amount] }));
}
