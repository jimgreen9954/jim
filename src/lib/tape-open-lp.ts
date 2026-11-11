import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import { OPEN_POOL } from "@/lib/tape-open-swap";
import { TAPE_BEM, TAPE_TOKEN } from "@/lib/tape-pool";
import { connectXLayer, XLAYER } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";

export const OPEN_LP_TERMS = [
  { id: 0, zh: "三个月", en: "3 months", days: 90 },
  { id: 1, zh: "六个月", en: "6 months", days: 180 },
  { id: 2, zh: "一年", en: "1 year", days: 365 },
  { id: 3, zh: "两年", en: "2 years", days: 730 },
] as const;

const TERM_DAYS = [90, 180, 365, 730, 1095] as const;

const abi = parseAbi([
  "function bemPool() view returns (uint256 tape, uint256 quote, uint256 shares)",
  "function okbPool() view returns (uint256 tape, uint256 quote, uint256 shares)",
  "function position(uint256) view returns (address owner, uint8 quote, uint8 term, uint64 unlock, uint256 shares)",
  "function ownedCount(address) view returns (uint256)",
  "function ownedId(address,uint256) view returns (uint256)",
  "function add(uint8,uint8,uint256,uint256) returns (uint256)",
  "function remove(uint256)",
]);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const client = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 12_000 }) });

export type OpenSide = { tape: bigint; quote: bigint; shares: bigint };
export type OpenLpPosition = { id: string; quote: number; term: number; unlock: number; shares: bigint };

export function openLpDays(term: number): number {
  return TERM_DAYS[term] ?? 0;
}

export function openUnits(text: string): bigint {
  const clean = text.trim();
  if (!clean) return 0n;
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("amount");
  return parseUnits(clean, 8);
}

export function openText(amount: bigint, digits = 4, decimals = 8): string {
  const n = Number(formatUnits(amount, decimals));
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: digits }) : formatUnits(amount, decimals);
}

export function openPlain(amount: bigint): string {
  const [whole, frac = ""] = formatUnits(amount, 8).split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export function matchBem(tapeIn: bigint, poolTape: bigint, poolBem: bigint): bigint {
  if (tapeIn <= 0n || poolTape <= 0n || poolBem <= 0n) return 0n;
  return (tapeIn * poolBem) / poolTape;
}

export async function readOpenLp(account: string | null): Promise<{
  bem: OpenSide;
  okb: OpenSide;
  tapeBal: bigint;
  bemBal: bigint;
  okbBal: bigint;
  positions: OpenLpPosition[];
}> {
  const who = account as Hex | null;
  const [bem, okb, tapeBal, bemBal, okbBal, count] = await Promise.all([
    client.readContract({ address: OPEN_POOL, abi, functionName: "bemPool" }),
    client.readContract({ address: OPEN_POOL, abi, functionName: "okbPool" }),
    who ? client.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who] }) : Promise.resolve(0n),
    who ? client.readContract({ address: TAPE_BEM, abi: erc20, functionName: "balanceOf", args: [who] }) : Promise.resolve(0n),
    who ? client.getBalance({ address: who }) : Promise.resolve(0n),
    who ? client.readContract({ address: OPEN_POOL, abi, functionName: "ownedCount", args: [who] }) : Promise.resolve(0n),
  ]);
  const positions: OpenLpPosition[] = [];
  const n = Number(count);
  if (who && n > 0) {
    const start = Math.max(0, n - 20);
    const ids = await Promise.all(
      Array.from({ length: n - start }, (_, i) =>
        client.readContract({ address: OPEN_POOL, abi, functionName: "ownedId", args: [who, BigInt(start + i)] }),
      ),
    );
    const rows = await Promise.all(
      ids.map((id) => client.readContract({ address: OPEN_POOL, abi, functionName: "position", args: [id] })),
    );
    rows.forEach((row, i) => {
      const quote = Number(row[1]);
      if ((quote !== 0 && quote !== 1) || row[4] === 0n) return;
      positions.push({
        id: ids[i].toString(),
        quote,
        term: Number(row[2]),
        unlock: Number(row[3]),
        shares: row[4],
      });
    });
  }
  return {
    bem: { tape: bem[0], quote: bem[1], shares: bem[2] },
    okb: { tape: okb[0], quote: okb[1], shares: okb[2] },
    tapeBal,
    bemBal,
    okbBal,
    positions,
  };
}

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

async function approve(from: string, token: Hex, need: bigint) {
  const allowance = await client.readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, OPEN_POOL],
  });
  if (allowance >= need) return;
  if (allowance > 0n) {
    await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OPEN_POOL, 0n] }));
  }
  await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [OPEN_POOL, need] }));
}

export async function addOpenLp(from: string, term: number, tapeIn: bigint, bemIn: bigint): Promise<Hex> {
  if (term < 0 || term > 3 || tapeIn <= 0n || bemIn <= 0n) throw new Error("amount");
  await approve(from, TAPE_TOKEN, tapeIn);
  await approve(from, TAPE_BEM, bemIn);
  const data = encodeFunctionData({ abi, functionName: "add", args: [0, term, tapeIn, bemIn] });
  await client.call({ account: from as Hex, to: OPEN_POOL, data });
  return send(from, OPEN_POOL, data);
}

export async function removeOpenLp(from: string, id: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi, functionName: "remove", args: [id] });
  await client.call({ account: from as Hex, to: OPEN_POOL, data });
  return send(from, OPEN_POOL, data);
}
