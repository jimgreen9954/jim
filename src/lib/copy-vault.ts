import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import { BSC, pretty, units } from "@/lib/bsc";
import { BSC_SAFE, BSC_VAULT, XLAYER, XLAYER_SAFE, XLAYER_VAULT } from "@/lib/chain-marks";
import { BSC_REBATE, KNOWN_XPERP } from "@/lib/perp";
import { TAPE_USDT } from "@/lib/tape-pool";
import { ensureProvider, switchDeskChain } from "@/lib/wallet";

export type VaultChain = "xlayer" | "bsc";

const DEAD = 1_000_000n;
const DUST = 1_000n;

const vaultAbi = parseAbi([
  "function equity() view returns (uint256)",
  "function idle() view returns (uint256)",
  "function locked() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function shares(address) view returns (uint256)",
  "function quoteCount() view returns (uint256)",
  "function dealCount() view returns (uint256)",
  "function quoteIds(uint256) view returns (uint256)",
  "function dealIds(uint256) view returns (uint256)",
  "function deposit(uint256)",
  "function withdraw(uint256)",
  "function open(bool,uint256,uint16,uint256)",
  "function take(uint256,uint256,uint16)",
  "function cancel(uint256)",
  "function close(uint256)",
  "function sync()",
]);

const bookAbi = parseAbi([
  "function nextQuote() view returns (uint256)",
  "function mark() view returns (uint256)",
  "function quotes(uint256) view returns (address user, bool long, uint96 margin, uint16 lev, bool open, uint128 price)",
  "function deals(uint256) view returns (address long, address short, uint96 marginL, uint96 marginS, uint128 base, uint128 entry, bool open, uint16 levL, uint16 levS)",
]);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

export function vaultAddress(chain: VaultChain): Hex {
  return chain === "bsc" ? BSC_VAULT : XLAYER_VAULT;
}

export function vaultLeader(chain: VaultChain): string {
  return chain === "bsc" ? BSC_SAFE : XLAYER_SAFE;
}

export function vaultUnit(chain: VaultChain): { token: Hex; decimals: number; symbol: string; book: Hex } {
  return chain === "bsc"
    ? { token: BSC.usdt, decimals: 18, symbol: "USDT", book: BSC_REBATE as Hex }
    : { token: TAPE_USDT, decimals: 6, symbol: "USDT0", book: KNOWN_XPERP as Hex };
}

export type VaultQuote = {
  id: bigint;
  long: boolean;
  margin: bigint;
  lev: number;
  price: bigint;
  ours: boolean;
};

export type VaultDeal = {
  id: bigint;
  long: boolean;
  margin: bigint;
  entry: bigint;
};

export type VaultView = {
  equity: bigint;
  idle: bigint;
  locked: bigint;
  total: bigint;
  mine: bigint;
  claim: bigint;
  withdrawable: bigint;
  wallet: bigint;
  mark: bigint | null;
  quotes: VaultQuote[];
  deals: VaultDeal[];
};

const rpcs: Record<VaultChain, string[]> = {
  xlayer: [XLAYER.rpc, "https://xlayer.drpc.org"],
  bsc: [BSC.rpc, "https://bsc.publicnode.com"],
};

async function call(chain: VaultChain, to: Hex, data: Hex): Promise<Hex> {
  let last = "rpc";
  for (const url of rpcs[chain]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      });
      const json = (await res.json()) as { result?: Hex; error?: { message?: string } };
      if (json.result) return json.result;
      last = json.error?.message || "rpc";
    } catch (err) {
      last = err instanceof Error ? err.message : "rpc";
    }
  }
  throw new Error(last);
}

function view<T>(chain: VaultChain, to: Hex, abi: readonly unknown[], fn: string, args: readonly unknown[] = []): Promise<T> {
  const data = (encodeFunctionData as (spec: { abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => Hex)({
    abi,
    functionName: fn,
    args,
  });
  return call(chain, to, data).then(
    (raw) =>
      (decodeFunctionResult as (spec: { abi: readonly unknown[]; functionName: string; data: Hex }) => T)({
        abi,
        functionName: fn,
        data: raw,
      }),
  );
}

function assetsFor(shares: bigint, total: bigint, equity: bigint): bigint {
  if (shares === 0n || total === 0n) return 0n;
  return (shares * (equity + DUST)) / (total + DEAD);
}

function sharesFor(amount: bigint, total: bigint, equity: bigint): bigint {
  if (amount === 0n) return 0n;
  return (amount * (total + DEAD) + equity + DUST - 1n) / (equity + DUST);
}

export function maxShares(shares: bigint, total: bigint, equity: bigint, idle: bigint): bigint {
  if (shares === 0n || total === 0n || idle === 0n) return 0n;
  const cap = (idle * (total + DEAD)) / (equity + DUST);
  return cap < shares ? cap : shares;
}

export async function readCopyVault(chain: VaultChain, account: string | null): Promise<VaultView> {
  const vault = vaultAddress(chain);
  const book = vaultUnit(chain).book;
  const who = (account || "0x0000000000000000000000000000000000000000") as Hex;
  const [equity, idle, locked, total, mine, wallet, quoteCount, dealCount] = await Promise.all([
    view<bigint>(chain, vault, vaultAbi, "equity"),
    view<bigint>(chain, vault, vaultAbi, "idle"),
    view<bigint>(chain, vault, vaultAbi, "locked"),
    view<bigint>(chain, vault, vaultAbi, "totalShares"),
    view<bigint>(chain, vault, vaultAbi, "shares", [who]),
    view<bigint>(chain, vaultUnit(chain).token, erc20, "balanceOf", [who]),
    view<bigint>(chain, vault, vaultAbi, "quoteCount"),
    view<bigint>(chain, vault, vaultAbi, "dealCount"),
  ]);
  let mark: bigint | null = null;
  try {
    mark = await view<bigint>(chain, book, bookAbi, "mark");
  } catch {
    mark = null;
  }
  const quoteIds = await Promise.all(
    Array.from({ length: Number(quoteCount) }, (_, i) => view<bigint>(chain, vault, vaultAbi, "quoteIds", [BigInt(i)])),
  );
  const dealIds = await Promise.all(
    Array.from({ length: Number(dealCount) }, (_, i) => view<bigint>(chain, vault, vaultAbi, "dealIds", [BigInt(i)])),
  );
  let tip = 0n;
  try {
    tip = await view<bigint>(chain, book, bookAbi, "nextQuote");
  } catch {
    tip = 0n;
  }
  const scanFrom = tip > 16n ? tip - 16n : 0n;
  const scan: bigint[] = [];
  for (let id = tip; id > scanFrom; id -= 1n) scan.push(id);
  const seen = new Set(quoteIds.map((id) => id.toString()));
  const quotes: VaultQuote[] = [];
  for (const id of quoteIds) {
    try {
      const row = await view<[Hex, boolean, bigint, number, boolean, bigint]>(chain, book, bookAbi, "quotes", [id]);
      if (!row[4]) continue;
      quotes.push({ id, long: row[1], margin: row[2], lev: Number(row[3]), price: row[5], ours: true });
    } catch {
      /* a missing quote is skipped, not shown as zero */
    }
  }
  for (const id of scan) {
    if (seen.has(id.toString())) continue;
    try {
      const row = await view<[Hex, boolean, bigint, number, boolean, bigint]>(chain, book, bookAbi, "quotes", [id]);
      if (!row[4] || row[0].toLowerCase() === vault.toLowerCase()) continue;
      quotes.push({ id, long: row[1], margin: row[2], lev: Number(row[3]), price: row[5], ours: false });
    } catch {
      /* skip */
    }
  }
  const deals: VaultDeal[] = [];
  for (const id of dealIds) {
    try {
      const row = await view<[Hex, Hex, bigint, bigint, bigint, bigint, boolean, number, number]>(chain, book, bookAbi, "deals", [id]);
      if (!row[6]) continue;
      const long = row[0].toLowerCase() === vault.toLowerCase();
      deals.push({ id, long, margin: long ? row[2] : row[3], entry: row[5] });
    } catch {
      /* skip */
    }
  }
  const room = maxShares(mine, total, equity, idle);
  return {
    equity,
    idle,
    locked,
    total,
    mine,
    claim: assetsFor(mine, total, equity),
    withdrawable: assetsFor(room, total, equity),
    wallet,
    mark,
    quotes,
    deals,
  };
}

async function signer(chain: VaultChain): Promise<string> {
  await switchDeskChain(chain === "bsc" ? 56 : 196);
  const eth = await ensureProvider();
  const rows = (await eth.request({ method: "eth_accounts" })) as string[];
  const from = rows?.[0];
  if (!from) throw new Error("nowallet");
  return from;
}

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  const eth = await ensureProvider();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  })) as Hex;
}

async function wait(chain: VaultChain, hash: Hex): Promise<void> {
  for (const url of rpcs[chain]) {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const json = (await res.json()) as { result?: { status?: string } | null };
        if (!json.result) continue;
        if (json.result.status === "0x0") throw new Error("revert");
        return;
      } catch (err) {
        if (err instanceof Error && err.message === "revert") throw err;
      }
    }
  }
  throw new Error("pending");
}

async function allow(chain: VaultChain, from: string, amount: bigint): Promise<void> {
  const { token } = vaultUnit(chain);
  const vault = vaultAddress(chain);
  const allowance = await view<bigint>(chain, token, erc20, "allowance", [from as Hex, vault]);
  if (allowance >= amount) return;
  if (allowance > 0n) {
    const reset = encodeFunctionData({ abi: erc20, functionName: "approve", args: [vault, 0n] });
    await wait(chain, await send(from, token, reset));
  }
  const data = encodeFunctionData({
    abi: erc20,
    functionName: "approve",
    args: [vault, 2n ** 256n - 1n],
  });
  await wait(chain, await send(from, token, data));
}

export async function depositVault(chain: VaultChain, amount: string): Promise<void> {
  const { decimals } = vaultUnit(chain);
  const qty = units(amount, decimals);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  const wallet = await view<bigint>(chain, vaultUnit(chain).token, erc20, "balanceOf", [from as Hex]);
  if (wallet < qty) throw new Error("usdt");
  await allow(chain, from, qty);
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "deposit", args: [qty] });
  await wait(chain, await send(from, vaultAddress(chain), data));
}

export async function withdrawVault(chain: VaultChain, amount: string): Promise<void> {
  const { decimals } = vaultUnit(chain);
  const qty = units(amount, decimals);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  const viewRow = await readCopyVault(chain, from);
  const room = maxShares(viewRow.mine, viewRow.total, viewRow.equity, viewRow.idle);
  let shares = sharesFor(qty, viewRow.total, viewRow.equity);
  if (shares > room) shares = room;
  if (shares === 0n || shares > viewRow.mine) throw new Error("idle");
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "withdraw", args: [shares] });
  await wait(chain, await send(from, vaultAddress(chain), data));
}

function marginOf(chain: VaultChain, margin: string): bigint {
  const { decimals } = vaultUnit(chain);
  const amount = units(margin, decimals);
  const unit = 10n ** BigInt(decimals);
  if (amount < unit || amount > unit * 500n) throw new Error("margin");
  return amount;
}

export async function openVault(chain: VaultChain, long: boolean, margin: string, lev: number, price: string): Promise<void> {
  if (lev < 1 || lev > 1000) throw new Error("lev");
  const amount = marginOf(chain, margin);
  const px = units(price, 18);
  if (px < 10n ** 16n || px > 100_000n * 10n ** 18n) throw new Error("price");
  const from = await signer(chain);
  if (from.toLowerCase() !== vaultLeader(chain).toLowerCase()) throw new Error("leader");
  const data = encodeFunctionData({
    abi: vaultAbi,
    functionName: "open",
    args: [long, amount, lev, px],
  });
  await wait(chain, await send(from, vaultAddress(chain), data));
}

export async function takeVault(chain: VaultChain, quoteId: bigint, margin: string, lev: number): Promise<void> {
  if (lev < 1 || lev > 1000) throw new Error("lev");
  const amount = marginOf(chain, margin);
  const from = await signer(chain);
  if (from.toLowerCase() !== vaultLeader(chain).toLowerCase()) throw new Error("leader");
  const data = encodeFunctionData({
    abi: vaultAbi,
    functionName: "take",
    args: [quoteId, amount, lev],
  });
  await wait(chain, await send(from, vaultAddress(chain), data));
}

export async function cancelVault(chain: VaultChain, quoteId: bigint): Promise<void> {
  const from = await signer(chain);
  if (from.toLowerCase() !== vaultLeader(chain).toLowerCase()) throw new Error("leader");
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "cancel", args: [quoteId] });
  await wait(chain, await send(from, vaultAddress(chain), data));
}

export async function closeVault(chain: VaultChain, dealId: bigint): Promise<void> {
  const from = await signer(chain);
  if (from.toLowerCase() !== vaultLeader(chain).toLowerCase()) throw new Error("leader");
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "close", args: [dealId] });
  await wait(chain, await send(from, vaultAddress(chain), data));
}

export async function syncVault(chain: VaultChain): Promise<void> {
  const from = await signer(chain);
  const data = encodeFunctionData({ abi: vaultAbi, functionName: "sync" });
  await wait(chain, await send(from, vaultAddress(chain), data));
}

export function showAmt(amount: bigint, decimals: number): string {
  return pretty(amount, decimals, 4);
}
