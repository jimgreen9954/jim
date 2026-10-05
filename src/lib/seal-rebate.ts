import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  toHex,
  type Hex,
} from "viem";
import { BSC, connectBsc } from "@/lib/bsc";
import { X_USDT } from "@/lib/perp";
import { SEAL_REBATE_BYTECODE } from "@/lib/seal-rebate-artifact";
import { getProvider } from "@/lib/wallet";
import { DEPLOYED, connectXLayer, sealIds, XLAYER } from "@/lib/xlayer";

export type RebateChain = "bsc" | "xlayer";

const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const KEY = "tapeliquid-seal-rebate-v3";

export const LOCKED_REBATE = {
  xlayer: "0x62abA5CD9B6C371e7c443C79934B8644d60481d7",
  bsc: "0x0FcC922739a565804Ea57BDB44Bc2503E80Fce7A",
} as const;

const xClient = createPublicClient({ transport: http(XLAYER.rpc) });
const bscClient = createPublicClient({ transport: http(BSC.rpc) });

const rebateAbi = [
  { name: "qualify", type: "function", stateMutability: "nonpayable", inputs: [{ name: "a", type: "uint256" }, { name: "b", type: "uint256" }, { name: "c", type: "uint256" }], outputs: [] },
  { name: "pass", type: "function", stateMutability: "nonpayable", inputs: [{ name: "who", type: "address" }], outputs: [] },
  { name: "fund", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "claim", type: "function", stateMutability: "nonpayable", inputs: [{ name: "books_", type: "address[]" }, { name: "ids", type: "uint256[]" }], outputs: [] },
  { name: "preview", type: "function", stateMutability: "view", inputs: [{ name: "book", type: "address" }, { name: "dealId", type: "uint256" }, { name: "user", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "weekOf", type: "function", stateMutability: "pure", inputs: [{ name: "ts", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "claimedWeek", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "passed", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { name: "claimed", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }, { name: "", type: "uint256" }, { name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { name: "circuits", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "clerk", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { name: "usdt", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const matchedEvent = parseAbi([
  "event Matched(uint256 indexed id, uint256 indexed quoteId, address indexed long, address short, uint256 base, uint256 entry, uint256 fee)",
]);

const tapeDeal = parseAbi([
  "function nextDeal() view returns (uint256)",
  "function deals(uint256) view returns (address long, address short, uint96 marginL, uint96 marginS, uint128 base, uint128 entry, bool open, uint16 levL, uint16 levS)",
]);

const gateDeal = parseAbi([
  "function nextDeal() view returns (uint256)",
  "function deals(uint256) view returns (address long, address short, uint8 market, uint96 marginL, uint96 marginS, uint128 base, uint128 entry, bool open, uint16 levL, uint16 levS)",
]);

function client(chain: RebateChain) {
  return chain === "xlayer" ? xClient : bscClient;
}

const CLAIM_X = "0xa0344f5B0518D31B7CFa6CaC266b4eDd289821ce" as Hex;
const CLAIM_BSC_OLD = "0xB98D14333a93D49a4E05478d002FC3944D88A3b7" as Hex;
const CLAIM_BSC = "0x5753fb0ba5975a2dc0fae5bd0dcf521dbba7cc12" as Hex;
const CLAIM_GATE = "0xe380b8449280a1da46952dba0de0418e0958d668" as Hex;

function books(chain: RebateChain): { address: Hex; gate: boolean }[] {
  if (chain === "xlayer") return [{ address: CLAIM_X, gate: false }];
  return [
    { address: CLAIM_BSC_OLD, gate: false },
    { address: CLAIM_BSC, gate: false },
    { address: CLAIM_GATE, gate: true },
  ];
}

export function savedRebate(chain: RebateChain): string {
  return LOCKED_REBATE[chain];
}

async function send(chain: RebateChain, from: string, to: Hex, data: Hex, gas: bigint): Promise<Hex> {
  if (chain === "xlayer") await connectXLayer();
  else await connectBsc();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const gasPrice = await client(chain).getGasPrice();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: "0x0", gas: toHex(gas), gasPrice: toHex(gasPrice * 2n) }],
  })) as Hex;
  const receipt = await client(chain).waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

function initOf(chain: RebateChain): Hex {
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }],
    chain === "xlayer"
      ? [X_USDT, DEPLOYED.circuits, ZERO, CLAIM_X, ZERO, ZERO]
      : [BSC.usdt, ZERO, CLAIM_GATE, CLAIM_BSC_OLD, CLAIM_BSC, ZERO],
  );
  return `${SEAL_REBATE_BYTECODE}${args.slice(2)}`;
}

function predict(init: Hex): Hex {
  const salt = `0x${"00".repeat(32)}` as Hex;
  const hash = keccak256(concat(["0xff", FACTORY, salt, keccak256(init)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export async function deployRebate(chain: RebateChain): Promise<string> {
  const address = LOCKED_REBATE[chain];
  const existing = await client(chain).getBytecode({ address });
  if (existing && existing !== "0x") return address;
  throw new Error("locked");
}

export type RebateState = {
  address: string;
  clerk: string;
  circuits: string;
  passed: boolean;
  balance: bigint;
  decimals: number;
  symbol: string;
  weekly: boolean;
  claimedThisWeek: boolean;
  resetAt: number;
};

export async function readRebate(chain: RebateChain, account: string | null): Promise<RebateState | null> {
  const address = savedRebate(chain);
  if (!address) return null;
  const c = client(chain);
  const rebate = address as Hex;
  const [clerk, circuits, usdt] = await Promise.all([
    c.readContract({ address: rebate, abi: rebateAbi, functionName: "clerk" }),
    c.readContract({ address: rebate, abi: rebateAbi, functionName: "circuits" }),
    c.readContract({ address: rebate, abi: rebateAbi, functionName: "usdt" }),
  ]);
  const passed = account
    ? await c.readContract({ address: rebate, abi: rebateAbi, functionName: "passed", args: [account as Hex] })
    : false;
  const [balance, decimalsRead, symbolRead] = await Promise.all([
    c.readContract({ address: usdt, abi: erc20, functionName: "balanceOf", args: [rebate] }),
    c.readContract({ address: usdt, abi: erc20, functionName: "decimals" }).catch(() => (chain === "xlayer" ? 6 : 18)),
    c.readContract({ address: usdt, abi: erc20, functionName: "symbol" }).catch(() => (chain === "xlayer" ? "USDT0" : "USDT")),
  ]);
  const decimals = Number(decimalsRead);
  const now = await c.getBlock({ blockTag: "latest" });
  const week = sgWeek(Number(now.timestamp));
  let claimedThisWeek = false;
  let weekly = true;
  if (account) {
    try {
      const mark = await c.readContract({
        address: rebate,
        abi: rebateAbi,
        functionName: "claimedWeek",
        args: [account as Hex],
      });
      claimedThisWeek = mark === BigInt(week) + 1n;
    } catch {
      weekly = false;
    }
  }
  return {
    address,
    clerk,
    circuits,
    passed,
    balance,
    decimals,
    symbol: symbolRead,
    weekly,
    claimedThisWeek,
    resetAt: nextMondaySgt(Number(now.timestamp)),
  };
}

export async function qualifyRebate(): Promise<void> {
  const address = savedRebate("xlayer");
  if (!address) throw new Error("norebate");
  const from = await connectXLayer();
  const ids = await sealIds(from);
  if (ids.length < 3) throw new Error("seals");
  const data = encodeFunctionData({ abi: rebateAbi, functionName: "qualify", args: [ids[0], ids[1], ids[2]] });
  await send("xlayer", from, address as Hex, data, 400_000n);
}

export async function passRebate(who: string): Promise<void> {
  const address = savedRebate("bsc");
  if (!address) throw new Error("norebate");
  const from = await connectBsc();
  const data = encodeFunctionData({ abi: rebateAbi, functionName: "pass", args: [who as Hex] });
  await send("bsc", from, address as Hex, data, 200_000n);
}

export async function fundRebate(chain: RebateChain, text: string): Promise<void> {
  const address = savedRebate(chain);
  if (!address) throw new Error("norebate");
  const from = chain === "xlayer" ? await connectXLayer() : await connectBsc();
  const c = client(chain);
  const token = chain === "xlayer" ? X_USDT : BSC.usdt;
  const decimals = Number(await c.readContract({ address: token, abi: erc20, functionName: "decimals" }));
  const amount = parseUnits(text.trim(), decimals);
  if (amount <= 0n) throw new Error("amount");
  const allowance = await c.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, address as Hex],
  });
  if (allowance < amount) {
    const approve = encodeFunctionData({ abi: erc20, functionName: "approve", args: [address as Hex, amount] });
    await send(chain, from, token, approve, 80_000n);
  }
  const data = encodeFunctionData({ abi: rebateAbi, functionName: "fund", args: [amount] });
  await send(chain, from, address as Hex, data, 150_000n);
}

export async function withdrawRebate(chain: RebateChain, text: string): Promise<void> {
  const address = savedRebate(chain);
  const from = chain === "xlayer" ? await connectXLayer() : await connectBsc();
  const c = client(chain);
  const token = chain === "xlayer" ? X_USDT : BSC.usdt;
  const decimals = Number(await c.readContract({ address: token, abi: erc20, functionName: "decimals" }));
  const amount = parseUnits(text.trim(), decimals);
  if (amount <= 0n) throw new Error("amount");
  const data = encodeFunctionData({ abi: rebateAbi, functionName: "withdraw", args: [amount] });
  await send(chain, from, address as Hex, data, 150_000n);
}

export async function claimRebate(chain: RebateChain, rows: ClaimRow[]): Promise<void> {
  const address = savedRebate(chain);
  if (!address || rows.length === 0) throw new Error("norebate");
  const from = chain === "xlayer" ? await connectXLayer() : await connectBsc();
  const data = encodeFunctionData({
    abi: rebateAbi,
    functionName: "claim",
    args: [rows.map((row) => row.book as Hex), rows.map((row) => row.id)],
  });
  await send(chain, from, address as Hex, data, BigInt(250_000 + rows.length * 140_000));
}

export type ClaimRow = { book: string; id: bigint; pay: bigint };

function sgWeek(ts: number): number {
  const dayIndex = Math.floor((ts + 8 * 3600) / 86400);
  const back = (dayIndex + 3) % 7;
  return Math.floor((dayIndex - back) / 7);
}

function weekStartSgt(ts: number): number {
  const dayIndex = Math.floor((ts + 8 * 3600) / 86400);
  const back = (dayIndex + 3) % 7;
  return (dayIndex - back) * 86400 - 8 * 3600;
}

function nextMondaySgt(ts: number): number {
  return weekStartSgt(ts) + 7 * 86400;
}

async function blockAt(chain: RebateChain, ts: number): Promise<bigint> {
  const c = client(chain);
  let lo = 1n;
  let hi = await c.getBlockNumber();
  while (lo < hi) {
    const mid = (lo + hi) >> 1n;
    const block = await c.getBlock({ blockNumber: mid });
    if (Number(block.timestamp) < ts) lo = mid + 1n;
    else hi = mid;
  }
  return lo;
}

export async function claimRows(chain: RebateChain, account: string): Promise<ClaimRow[]> {
  const address = savedRebate(chain);
  if (!address) return [];
  const c = client(chain);
  const now = await c.getBlock({ blockTag: "latest" });
  const startTs = weekStartSgt(Number(now.timestamp));
  const fromBlock = await blockAt(chain, startTs);
  const head = now.number ?? fromBlock;
  const seen = new Map<string, { book: Hex; id: bigint }>();
  for (const book of books(chain)) {
    if (book.gate) continue;
    for (let cursor = fromBlock; cursor <= head; cursor += 4000n) {
      const to = cursor + 3999n > head ? head : cursor + 3999n;
      const logs = await c.getLogs({ address: book.address, event: matchedEvent[0], fromBlock: cursor, toBlock: to });
      const stamps = new Map<bigint, number>();
      await Promise.all(
        [...new Set(logs.map((log) => log.blockNumber))].map(async (blockNumber) => {
          if (blockNumber == null || stamps.has(blockNumber)) return;
          const block = await c.getBlock({ blockNumber });
          stamps.set(blockNumber, Number(block.timestamp));
        }),
      );
      for (const log of logs) {
        if (log.blockNumber == null || !log.args.id || !log.args.long || !log.args.short) continue;
        const stamp = stamps.get(log.blockNumber) ?? 0;
        if (stamp < startTs) continue;
        const who = account.toLowerCase();
        if (log.args.long.toLowerCase() !== who && log.args.short.toLowerCase() !== who) continue;
        seen.set(`${book.address}-${log.args.id}`, { book: book.address, id: log.args.id });
      }
    }
  }
  const rows: ClaimRow[] = [];
  for (const row of seen.values()) {
    const taken = await c.readContract({
      address: address as Hex,
      abi: rebateAbi,
      functionName: "claimed",
      args: [row.book, row.id, account as Hex],
    });
    if (taken) continue;
    const pay = await c.readContract({
      address: address as Hex,
      abi: rebateAbi,
      functionName: "preview",
      args: [row.book, row.id, account as Hex],
    });
    if (pay > 0n) rows.push({ book: row.book, id: row.id, pay });
  }
  return rows;
}

export function rebateText(amount: bigint, decimals: number, symbol: string): string {
  return `${formatUnits(amount, decimals)} ${symbol}`;
}

export function chainHex(chain: RebateChain): string {
  return chain === "xlayer" ? toHex(XLAYER.chainId) : toHex(BSC.chainId);
}
