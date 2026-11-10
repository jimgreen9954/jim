import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, formatUnits, hashTypedData, parseAbi, type Hex } from "viem";
import { BNB_GAS_RESERVE, BSC, pretty, units } from "@/lib/bsc";
import { BSC_SAFE, XLAYER, XLAYER_SAFE } from "@/lib/chain-marks";
import { CREATE_CALL, createCallData, createdAddress } from "@/lib/create-call";
import { FAB } from "@/lib/fab";
import { OKB } from "@/lib/okb";
import { TAPE_TOKEN } from "@/lib/tape-pool";
import { TERM_BYTECODE } from "@/lib/term-bytecode";
import { ensureProvider, switchDeskChain } from "@/lib/wallet";

export type TermChain = "bsc" | "xlayer";
export type TermKind = "stable" | "gas" | "coin";

export type TermAsset = {
  id: number;
  symbol: string;
  decimals: number;
  native: boolean;
  token: Hex | null;
  kind: TermKind;
};

export const TERM_ROWS = [
  { id: 0, days: 1, mul: 10000, zh: "24 小时", en: "24 hours" },
  { id: 1, days: 3, mul: 10500, zh: "3 天", en: "3 days" },
  { id: 2, days: 7, mul: 11000, zh: "7 天", en: "7 days" },
  { id: 3, days: 30, mul: 12000, zh: "30 天", en: "30 days" },
  { id: 4, days: 90, mul: 13500, zh: "90 天", en: "90 days" },
  { id: 5, days: 180, mul: 15000, zh: "180 天", en: "180 days" },
  { id: 6, days: 270, mul: 16500, zh: "270 天", en: "270 days" },
  { id: 7, days: 365, mul: 18000, zh: "365 天", en: "365 days" },
] as const;

const WAD = 10n ** 18n;
const OPEN_LTV = 5000n;
const LIQ_LTV = 7500n;
const BONUS_BPS = 500n;
const MIN_USD = 10n * WAD;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const X_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952" as Hex;

const abi = parseAbi([
  "function safe() view returns (address)",
  "function count() view returns (uint8)",
  "function edition() view returns (uint8)",
  "function tokenOf(uint8) view returns (address)",
  "function pool(uint8) view returns (uint256 cashAmt, uint256 outAmt, uint256 sharesAmt, uint256 price, uint64 at, uint8 stamp, bool ready)",
  "function account(uint8,address) view returns (uint256 supply, uint256 basis, uint256 shareAmt)",
  "function loanCount(address) view returns (uint256)",
  "function openLoans(address) view returns (uint8)",
  "function myLoan(address,uint256) view returns (uint256 id, (address user, uint8 coll, uint8 debt, uint8 term, uint64 start, uint64 marked, uint64 due, uint256 collAmt, uint256 principal, uint256 interest, uint256 collUsd0, uint256 debtUsd0, bool open) row)",
  "function activeCount() view returns (uint256)",
  "function activeLoan(uint256) view returns (uint256 id, (address user, uint8 coll, uint8 debt, uint8 term, uint64 start, uint64 marked, uint64 due, uint256 collAmt, uint256 principal, uint256 interest, uint256 collUsd0, uint256 debtUsd0, bool open) row)",
  "function deposit(uint8,uint256)",
  "function withdraw(uint8,uint256)",
  "function open(uint8,uint8,uint8,uint256,uint256)",
  "function addColl(uint256,uint256)",
  "function repay(uint256,uint256)",
  "function liquidate(uint256)",
  "function poke(uint8)",
]);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);

const BOOK = {
  bsc: { chainId: 56 as const, safe: BSC_SAFE, rpc: [BSC.rpc, "https://bsc.publicnode.com"], reserve: BNB_GAS_RESERVE },
  xlayer: { chainId: 196 as const, safe: XLAYER_SAFE, rpc: [XLAYER.rpc, "https://xlayer.drpc.org"], reserve: OKB.gasReserve },
};

export function termAssets(chain: TermChain): TermAsset[] {
  if (chain === "bsc") {
    return [
      { id: 0, symbol: "USDT", decimals: 18, native: false, token: BSC.usdt, kind: "stable" },
      { id: 1, symbol: "BNB", decimals: 18, native: true, token: null, kind: "gas" },
      { id: 2, symbol: "BEM", decimals: 8, native: false, token: BSC.bem, kind: "coin" },
      { id: 3, symbol: "UP", decimals: 18, native: false, token: BSC.up, kind: "coin" },
    ];
  }
  return [
    { id: 0, symbol: "USDT0", decimals: 6, native: false, token: OKB.usdt, kind: "stable" },
    { id: 1, symbol: "OKB", decimals: 18, native: true, token: null, kind: "gas" },
    { id: 2, symbol: "BEM", decimals: 8, native: false, token: X_BEM, kind: "coin" },
    { id: 3, symbol: "TAPE", decimals: 8, native: false, token: TAPE_TOKEN, kind: "coin" },
    { id: 4, symbol: "FAB", decimals: 8, native: false, token: FAB, kind: "coin" },
  ];
}

export function termAsset(chain: TermChain, id: number): TermAsset {
  const row = termAssets(chain).find((item) => item.id === id);
  if (!row) throw new Error("asset");
  return row;
}

function storageKey(chain: TermChain) {
  return `tapeliquid-termbook-${chain}`;
}

export function termAddress(chain: TermChain): Hex | null {
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(storageKey(chain)) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? (saved as Hex) : null;
}

export function forgetTerm(chain: TermChain) {
  window.localStorage.removeItem(storageKey(chain));
}

export type TermPool = {
  id: number;
  cash: bigint;
  out: bigint;
  shares: bigint;
  price: bigint;
  at: number;
  stamp: number;
  ready: boolean;
  supply: bigint;
  basis: bigint;
  shareAmt: bigint;
  wallet: bigint;
};

export type TermLoan = {
  id: bigint;
  user: string;
  coll: number;
  debt: number;
  term: number;
  start: number;
  marked: number;
  due: number;
  collAmt: bigint;
  principal: bigint;
  interest: bigint;
  collUsd0: bigint;
  debtUsd0: bigint;
  open: boolean;
};

export type TermSnap = {
  live: boolean;
  address: Hex | null;
  mismatch: boolean;
  pools: TermPool[];
  mine: TermLoan[];
  active: TermLoan[];
  openCount: number;
  truncated: boolean;
};

type RawLoan = {
  user: string;
  coll: number | bigint;
  debt: number | bigint;
  term: number | bigint;
  start: bigint;
  marked: bigint;
  due: bigint;
  collAmt: bigint;
  principal: bigint;
  interest: bigint;
  collUsd0: bigint;
  debtUsd0: bigint;
  open: boolean;
};

function emptySnap(chain: TermChain, address: Hex | null): TermSnap {
  return {
    live: false,
    address,
    mismatch: false,
    pools: termAssets(chain).map((asset) => ({
      id: asset.id,
      cash: 0n,
      out: 0n,
      shares: 0n,
      price: 0n,
      at: 0,
      stamp: 0,
      ready: false,
      supply: 0n,
      basis: 0n,
      shareAmt: 0n,
      wallet: 0n,
    })),
    mine: [],
    active: [],
    openCount: 0,
    truncated: false,
  };
}

async function rpc(chain: TermChain, method: string, params: unknown[]): Promise<unknown> {
  let last = "rpc";
  for (const url of BOOK[chain].rpc) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.result !== undefined) return json.result;
      last = json.error?.message || "rpc";
    } catch (err) {
      last = err instanceof Error ? err.message : "rpc";
    }
  }
  throw new Error(last);
}

async function call(chain: TermChain, to: Hex, data: Hex): Promise<Hex> {
  const result = await rpc(chain, "eth_call", [{ to, data }, "latest"]);
  if (typeof result !== "string") throw new Error("rpc");
  return result as Hex;
}

function read<T>(chain: TermChain, to: Hex, fn: string, args: readonly unknown[] = [], book: readonly unknown[] = abi): Promise<T> {
  const data = (encodeFunctionData as (spec: { abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => Hex)({
    abi: book,
    functionName: fn,
    args,
  });
  return call(chain, to, data).then(
    (raw) =>
      (decodeFunctionResult as (spec: { abi: readonly unknown[]; functionName: string; data: Hex }) => T)({
        abi: book,
        functionName: fn,
        data: raw,
      }),
  );
}

function asLoan(decoded: { id?: bigint; row?: RawLoan } & Record<number, unknown>): TermLoan {
  const id = typeof decoded.id === "bigint" ? decoded.id : (decoded[0] as bigint);
  const row = (decoded.row ?? decoded[1]) as RawLoan;
  return {
    id,
    user: row.user,
    coll: Number(row.coll),
    debt: Number(row.debt),
    term: Number(row.term),
    start: Number(row.start),
    marked: Number(row.marked),
    due: Number(row.due),
    collAmt: row.collAmt,
    principal: row.principal,
    interest: row.interest,
    collUsd0: row.collUsd0,
    debtUsd0: row.debtUsd0,
    open: Boolean(row.open),
  };
}

async function walletOf(chain: TermChain, asset: TermAsset, who: Hex | null): Promise<bigint> {
  if (!who) return 0n;
  if (asset.native) {
    const raw = await rpc(chain, "eth_getBalance", [who, "latest"]);
    return BigInt(String(raw));
  }
  return read<bigint>(chain, asset.token as Hex, "balanceOf", [who], erc20).catch(() => 0n);
}

export async function readTerm(chain: TermChain, account: string | null): Promise<TermSnap> {
  const book = termAddress(chain);
  const who = account ? (account as Hex) : null;
  const assets = termAssets(chain);
  const wallets = await Promise.all(assets.map((asset) => walletOf(chain, asset, who).catch(() => 0n)));
  if (!book) {
    const snap = emptySnap(chain, null);
    snap.pools = snap.pools.map((pool, index) => ({ ...pool, wallet: wallets[index] ?? 0n }));
    return snap;
  }
  const code = await rpc(chain, "eth_getCode", [book, "latest"]).catch(() => "0x");
  if (code === "0x" || code === "0x0") {
    const snap = emptySnap(chain, book);
    snap.mismatch = true;
    snap.pools = snap.pools.map((pool, index) => ({ ...pool, wallet: wallets[index] ?? 0n }));
    return snap;
  }
  let mismatch = false;
  try {
    const [safe, count, edition] = await Promise.all([
      read<string>(chain, book, "safe"),
      read<number>(chain, book, "count"),
      read<number>(chain, book, "edition"),
    ]);
    if (safe.toLowerCase() !== BOOK[chain].safe.toLowerCase() || Number(count) !== assets.length || Number(edition) !== 2) mismatch = true;
    const tokens = await Promise.all(
      assets.filter((asset) => !asset.native).map(async (asset) => {
        const token = await read<string>(chain, book, "tokenOf", [asset.id]);
        return token.toLowerCase() === (asset.token as string).toLowerCase();
      }),
    );
    if (tokens.some((ok) => !ok)) mismatch = true;
  } catch {
    mismatch = true;
  }
  if (mismatch) {
    const snap = emptySnap(chain, book);
    snap.mismatch = true;
    snap.pools = snap.pools.map((pool, index) => ({ ...pool, wallet: wallets[index] ?? 0n }));
    return snap;
  }
  const pools = await Promise.all(
    assets.map(async (asset, index) => {
      const [row, acct] = await Promise.all([
        read<readonly [bigint, bigint, bigint, bigint, bigint, number, boolean]>(chain, book, "pool", [asset.id]),
        who
          ? read<readonly [bigint, bigint, bigint]>(chain, book, "account", [asset.id, who]).catch(() => [0n, 0n, 0n] as const)
          : Promise.resolve([0n, 0n, 0n] as const),
      ]);
      return {
        id: asset.id,
        cash: row[0],
        out: row[1],
        shares: row[2],
        price: row[3],
        at: Number(row[4]),
        stamp: Number(row[5]),
        ready: Boolean(row[6]),
        supply: acct[0],
        basis: acct[1],
        shareAmt: acct[2],
        wallet: wallets[index] ?? 0n,
      } satisfies TermPool;
    }),
  );
  const [openCount, loanCount, activeCount] = await Promise.all([
    who ? read<number>(chain, book, "openLoans", [who]).catch(() => 0) : Promise.resolve(0),
    who ? read<bigint>(chain, book, "loanCount", [who]).catch(() => 0n) : Promise.resolve(0n),
    read<bigint>(chain, book, "activeCount").catch(() => 0n),
  ]);
  const mineCap = 40;
  const activeCap = 40;
  const mineFrom = loanCount > BigInt(mineCap) ? loanCount - BigInt(mineCap) : 0n;
  const activeFrom = activeCount > BigInt(activeCap) ? 0n : 0n;
  const activeTake = activeCount > BigInt(activeCap) ? activeCap : Number(activeCount);
  const [mine, active] = await Promise.all([
    who
      ? Promise.all(
          Array.from({ length: Number(loanCount - mineFrom) }, (_, index) =>
            read<never>(chain, book, "myLoan", [who, mineFrom + BigInt(index)]).then((row) => asLoan(row as never)),
          ),
        )
      : Promise.resolve([] as TermLoan[]),
    Promise.all(
      Array.from({ length: activeTake }, (_, index) =>
        read<never>(chain, book, "activeLoan", [activeFrom + BigInt(index)]).then((row) => asLoan(row as never)),
      ),
    ),
  ]);
  return {
    live: true,
    address: book,
    mismatch: false,
    pools,
    mine: mine.filter((row) => row.open),
    active,
    openCount: Number(openCount),
    truncated: loanCount > BigInt(mineCap) || activeCount > BigInt(activeCap),
  };
}

async function signer(chain: TermChain): Promise<string> {
  await switchDeskChain(BOOK[chain].chainId);
  const eth = await ensureProvider();
  const rows = (await eth.request({ method: "eth_accounts" })) as string[];
  const from = rows?.[0];
  if (!from) throw new Error("nowallet");
  return from;
}

async function send(from: string, to: Hex, data: Hex, value = 0n, gas?: bigint): Promise<Hex> {
  const eth = await ensureProvider();
  const tx: { from: string; to: Hex; data: Hex; value?: Hex; gas?: Hex } = { from, to, data };
  if (value > 0n) tx.value = `0x${value.toString(16)}`;
  if (gas) tx.gas = `0x${gas.toString(16)}`;
  return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
}

async function wait(chain: TermChain, hash: Hex): Promise<{ logs: { data: Hex; topics: Hex[] }[] }> {
  for (const url of BOOK[chain].rpc) {
    for (let i = 0; i < 24; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const json = (await res.json()) as { result?: { status?: string; logs?: { data: Hex; topics: Hex[] }[] } | null };
        if (!json.result) continue;
        if (json.result.status === "0x0") throw new Error("revert");
        return { logs: json.result.logs ?? [] };
      } catch (err) {
        if (err instanceof Error && err.message === "revert") throw err;
      }
    }
  }
  throw new Error("pending");
}

function need(chain: TermChain): Hex {
  const book = termAddress(chain);
  if (!book) throw new Error("live");
  return book;
}

async function allowToken(chain: TermChain, from: string, token: Hex, amount: bigint, spender: Hex) {
  const allowance = await read<bigint>(chain, token, "allowance", [from as Hex, spender], erc20);
  if (allowance >= amount) return;
  if (allowance > 0n) await wait(chain, await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 0n] })));
  await wait(chain, await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [spender, 2n ** 256n - 1n] })));
}

async function nativeBal(chain: TermChain, who: string): Promise<bigint> {
  return BigInt(String(await rpc(chain, "eth_getBalance", [who, "latest"])));
}

function safeMessage(data: Hex, nonce: bigint) {
  return {
    to: CREATE_CALL,
    value: 0n,
    data,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO,
    refundReceiver: ZERO,
    nonce,
  };
}

function normalizeSig(sig: string): Hex {
  const hex = (sig.startsWith("0x") ? sig : `0x${sig}`).toLowerCase();
  if (!/^0x[0-9a-f]{130}$/.test(hex)) throw new Error("revert");
  const v = Number.parseInt(hex.slice(-2), 16);
  const fixed = v < 27 ? v + 27 : v;
  return `${hex.slice(0, 130)}${fixed.toString(16).padStart(2, "0")}` as Hex;
}

async function sendSafe(chain: TermChain, from: string, data: Hex): Promise<Hex> {
  const spec = BOOK[chain];
  const who = from.toLowerCase();
  const owners = (await read<string[]>(chain, spec.safe, "getOwners", [], safeAbi)).map((row) => row.toLowerCase());
  if (!owners.includes(who)) throw new Error("leader");
  const nonce = await read<bigint>(chain, spec.safe, "nonce", [], safeAbi);
  const message = safeMessage(data, nonce);
  const typed = hashTypedData({
    domain: { chainId: spec.chainId, verifyingContract: spec.safe },
    types: {
      SafeTx: [
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "data", type: "bytes" },
        { name: "operation", type: "uint8" },
        { name: "safeTxGas", type: "uint256" },
        { name: "baseGas", type: "uint256" },
        { name: "gasPrice", type: "uint256" },
        { name: "gasToken", type: "address" },
        { name: "refundReceiver", type: "address" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "SafeTx",
    message,
  });
  const onchain = await read<Hex>(chain, spec.safe, "getTransactionHash", [CREATE_CALL, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce], safeAbi);
  if (onchain.toLowerCase() !== typed.toLowerCase()) throw new Error("revert");
  const storeKey = `tapeliquid-term-safe-${chain}-${nonce}-${typed}`;
  const bag = JSON.parse(window.localStorage.getItem(storeKey) || "{}") as Record<string, string>;
  if (!bag[who]) {
    const eth = await ensureProvider();
    const signed = (await eth.request({
      method: "eth_signTypedData_v4",
      params: [
        from,
        JSON.stringify({
          types: {
            EIP712Domain: [
              { name: "chainId", type: "uint256" },
              { name: "verifyingContract", type: "address" },
            ],
            SafeTx: [
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
              { name: "operation", type: "uint8" },
              { name: "safeTxGas", type: "uint256" },
              { name: "baseGas", type: "uint256" },
              { name: "gasPrice", type: "uint256" },
              { name: "gasToken", type: "address" },
              { name: "refundReceiver", type: "address" },
              { name: "nonce", type: "uint256" },
            ],
          },
          domain: { chainId: spec.chainId, verifyingContract: spec.safe },
          primaryType: "SafeTx",
          message: {
            to: CREATE_CALL,
            value: "0",
            data,
            operation: 0,
            safeTxGas: "0",
            baseGas: "0",
            gasPrice: "0",
            gasToken: ZERO,
            refundReceiver: ZERO,
            nonce: nonce.toString(),
          },
        }),
      ],
    })) as string;
    bag[who] = normalizeSig(signed);
    window.localStorage.setItem(storeKey, JSON.stringify(bag));
  }
  const ready = owners.filter((owner) => bag[owner]);
  if (ready.length < 2) throw new Error("second");
  const signatures = `0x${owners
    .filter((owner) => bag[owner])
    .sort()
    .map((owner) => bag[owner].slice(2))
    .join("")}` as Hex;
  const exec = encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [CREATE_CALL, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures],
  });
  return send(from, spec.safe, exec, 0n, 8_000_000n);
}

export async function deployTerm(chain: TermChain): Promise<string> {
  const spec = BOOK[chain];
  const from = await signer(chain);
  const args = encodeAbiParameters([{ type: "address" }], [spec.safe]);
  const init = (TERM_BYTECODE + args.slice(2)) as Hex;
  const inner = createCallData(init);
  const hash = from.toLowerCase() === spec.safe.toLowerCase() ? await send(from, CREATE_CALL, inner, 0n, 8_000_000n) : await sendSafe(chain, from, inner);
  const receipt = await wait(chain, hash);
  const landed = createdAddress(receipt.logs);
  window.localStorage.setItem(storageKey(chain), landed);
  return landed;
}

export async function depositTerm(chain: TermChain, id: number, amount: string) {
  const asset = termAsset(chain, id);
  const qty = units(amount, asset.decimals);
  if (qty <= 0n) throw new Error("amount");
  const from = await signer(chain);
  const book = need(chain);
  if (asset.native) {
    const gas = await nativeBal(chain, from);
    if (gas < qty + BOOK[chain].reserve) throw new Error("gas");
    await wait(chain, await send(from, book, encodeFunctionData({ abi, functionName: "deposit", args: [id, qty] }), qty));
    return;
  }
  const have = await read<bigint>(chain, asset.token as Hex, "balanceOf", [from as Hex], erc20);
  if (have < qty) throw new Error("balance");
  await allowToken(chain, from, asset.token as Hex, qty, book);
  await wait(chain, await send(from, book, encodeFunctionData({ abi, functionName: "deposit", args: [id, qty] })));
}

export function sharesFor(want: bigint, have: bigint, total: bigint, assets: bigint, cash: bigint): bigint {
  if (want <= 0n || have <= 0n || total <= 0n || assets <= 0n || cash <= 0n) return 0n;
  const room = want < cash ? want : cash;
  let shareAmt = (room * total + assets - 1n) / assets;
  if (shareAmt > have) shareAmt = have;
  let out = (shareAmt * assets) / total;
  if (out > cash) {
    shareAmt = (cash * total) / assets;
    if (shareAmt > have) shareAmt = have;
  }
  if (shareAmt === 0n) return 0n;
  out = (shareAmt * assets) / total;
  if (out === 0n || out > cash) return 0n;
  return shareAmt;
}

export async function withdrawTerm(chain: TermChain, id: number, amount: string) {
  const asset = termAsset(chain, id);
  const qty = units(amount, asset.decimals);
  if (qty <= 0n) throw new Error("amount");
  const from = await signer(chain);
  const book = need(chain);
  const [acct, pool] = await Promise.all([
    read<readonly [bigint, bigint, bigint]>(chain, book, "account", [id, from as Hex]),
    read<readonly [bigint, bigint, bigint, bigint, bigint, number, boolean]>(chain, book, "pool", [id]),
  ]);
  const shareAmt = sharesFor(qty, acct[2], pool[2], pool[0] + pool[1], pool[0]);
  if (shareAmt === 0n) throw new Error("idle");
  await wait(chain, await send(from, book, encodeFunctionData({ abi, functionName: "withdraw", args: [id, shareAmt] })));
}

export async function openTerm(chain: TermChain, coll: number, debt: number, term: number, collText: string, debtText: string) {
  if (coll === debt) throw new Error("same");
  const collAsset = termAsset(chain, coll);
  const debtAsset = termAsset(chain, debt);
  const collAmt = units(collText, collAsset.decimals);
  const principal = units(debtText, debtAsset.decimals);
  if (collAmt <= 0n || principal <= 0n) throw new Error("amount");
  const from = await signer(chain);
  const book = need(chain);
  const [collPool, debtPool, openCount] = await Promise.all([
    read<readonly [bigint, bigint, bigint, bigint, bigint, number, boolean]>(chain, book, "pool", [coll]),
    read<readonly [bigint, bigint, bigint, bigint, bigint, number, boolean]>(chain, book, "pool", [debt]),
    read<number>(chain, book, "openLoans", [from as Hex]),
  ]);
  if (!collPool[6] || !debtPool[6]) throw new Error("price");
  if (principal > debtPool[0]) throw new Error("dry");
  if (Number(openCount) >= 16) throw new Error("full");
  const collUsd = usdOf(collAmt, collPool[3], collAsset.decimals);
  const debtUsd = usdOf(principal, debtPool[3], debtAsset.decimals);
  if (debtUsd < MIN_USD) throw new Error("min");
  if (collUsd * OPEN_LTV < debtUsd * 10000n) throw new Error("ltv");
  const data = encodeFunctionData({ abi, functionName: "open", args: [coll, debt, term, collAmt, principal] });
  if (collAsset.native) {
    const gas = await nativeBal(chain, from);
    if (gas < collAmt + BOOK[chain].reserve) throw new Error("gas");
    await wait(chain, await send(from, book, data, collAmt));
    return;
  }
  const have = await read<bigint>(chain, collAsset.token as Hex, "balanceOf", [from as Hex], erc20);
  if (have < collAmt) throw new Error("balance");
  await allowToken(chain, from, collAsset.token as Hex, collAmt, book);
  await wait(chain, await send(from, book, data));
}

export async function addTermColl(chain: TermChain, id: bigint, coll: number, amount: string) {
  const asset = termAsset(chain, coll);
  const qty = units(amount, asset.decimals);
  if (qty <= 0n) throw new Error("amount");
  const from = await signer(chain);
  const book = need(chain);
  const data = encodeFunctionData({ abi, functionName: "addColl", args: [id, qty] });
  if (asset.native) {
    const gas = await nativeBal(chain, from);
    if (gas < qty + BOOK[chain].reserve) throw new Error("gas");
    await wait(chain, await send(from, book, data, qty));
    return;
  }
  const have = await read<bigint>(chain, asset.token as Hex, "balanceOf", [from as Hex], erc20);
  if (have < qty) throw new Error("balance");
  await allowToken(chain, from, asset.token as Hex, qty, book);
  await wait(chain, await send(from, book, data));
}

export async function repayTerm(chain: TermChain, id: bigint, debt: number, amount: string) {
  const asset = termAsset(chain, debt);
  const qty = units(amount, asset.decimals);
  if (qty <= 0n) throw new Error("amount");
  const from = await signer(chain);
  const book = need(chain);
  const data = encodeFunctionData({ abi, functionName: "repay", args: [id, qty] });
  if (asset.native) {
    const gas = await nativeBal(chain, from);
    if (gas < qty + BOOK[chain].reserve) throw new Error("gas");
    await wait(chain, await send(from, book, data, qty));
    return;
  }
  const have = await read<bigint>(chain, asset.token as Hex, "balanceOf", [from as Hex], erc20);
  if (have < qty) throw new Error("balance");
  await allowToken(chain, from, asset.token as Hex, qty, book);
  await wait(chain, await send(from, book, data));
}

export async function liquidateTerm(chain: TermChain, loan: TermLoan, pay: bigint) {
  if (pay <= 0n) throw new Error("amount");
  const asset = termAsset(chain, loan.debt);
  const from = await signer(chain);
  if (from.toLowerCase() === loan.user.toLowerCase()) throw new Error("self");
  const book = need(chain);
  const data = encodeFunctionData({ abi, functionName: "liquidate", args: [loan.id] });
  if (asset.native) {
    const gas = await nativeBal(chain, from);
    if (gas < pay + BOOK[chain].reserve) throw new Error("gas");
    await wait(chain, await send(from, book, data, pay));
    return;
  }
  const have = await read<bigint>(chain, asset.token as Hex, "balanceOf", [from as Hex], erc20);
  if (have < pay) throw new Error("balance");
  await allowToken(chain, from, asset.token as Hex, pay, book);
  await wait(chain, await send(from, book, data));
}

export async function pokeTerm(chain: TermChain, id: number) {
  const from = await signer(chain);
  const book = need(chain);
  if (chain === "bsc" && id === 3) {
    const pool = await read<readonly [bigint, bigint, bigint, bigint, bigint, number, boolean]>(chain, book, "pool", [2]);
    if (!pool[6]) throw new Error("price");
  }
  if (chain === "xlayer" && (id === 2 || id === 3 || id === 4)) {
    const needId = id === 2 ? 1 : 2;
    const pool = await read<readonly [bigint, bigint, bigint, bigint, bigint, number, boolean]>(chain, book, "pool", [needId]);
    if (!pool[6]) throw new Error("price");
  }
  await wait(chain, await send(from, book, encodeFunctionData({ abi, functionName: "poke", args: [id] })));
}

export function hourlyWad(kind: TermKind, mul: number): bigint {
  const year = kind === "stable" ? 80000000000000000n : kind === "gas" ? 120000000000000000n : 180000000000000000n;
  return (year / 365n / 24n) * BigInt(mul) / 10000n;
}

export function aprText(kind: TermKind, mul: number): string {
  const base = kind === "stable" ? 8 : kind === "gas" ? 12 : 18;
  const pct = (base * mul) / 10000;
  const text = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  return `${text}%`;
}

export function usdOf(amount: bigint, price: bigint, decimals: number): bigint {
  if (price <= 0n || amount <= 0n) return 0n;
  return (amount * price) / 10n ** BigInt(decimals);
}

export function usdToAmt(usdAmt: bigint, price: bigint, decimals: number): bigint {
  if (price <= 0n || usdAmt <= 0n) return 0n;
  const scale = 10n ** BigInt(decimals);
  return (usdAmt * scale + price - 1n) / price;
}

export function owedAt(loan: Pick<TermLoan, "principal" | "interest" | "start" | "marked" | "due" | "debt" | "term">, kind: TermKind, now: number): bigint {
  if (!Number.isFinite(now) || now <= loan.start) return loan.principal + loan.interest;
  const done = BigInt(Math.floor((now - loan.start) / 3600));
  const was = BigInt(Math.floor((loan.marked - loan.start) / 3600));
  if (done <= was) return loan.principal + loan.interest;
  const span = BigInt(Math.floor((loan.due - loan.start) / 3600));
  const row = TERM_ROWS[loan.term] ?? TERM_ROWS[0];
  const rate = hourlyWad(kind, row.mul);
  let add = 0n;
  if (was >= span) add = (loan.principal * rate * 2n * (done - was)) / WAD;
  else if (done <= span) add = (loan.principal * rate * (done - was)) / WAD;
  else {
    add = (loan.principal * rate * (span - was)) / WAD;
    add += (loan.principal * rate * 2n * (done - span)) / WAD;
  }
  return loan.principal + loan.interest + add;
}

export function freshAt(pool: TermPool | undefined, now: number): boolean {
  if (!pool || pool.price <= 0n || !pool.ready) return false;
  return now >= pool.at && now - pool.at <= 30 * 60;
}

export function termText(amount: bigint, decimals: number, digits = 4): string {
  return pretty(amount, decimals, digits);
}

export function termPlain(amount: bigint, decimals: number): string {
  const raw = formatUnits(amount, decimals);
  if (!raw.includes(".")) return raw;
  return raw.replace(/0+$/, "").replace(/\.$/, "");
}

export function liqPay(loan: TermLoan, owed: bigint, collPx: bigint, debtPx: bigint, collDec: number, debtDec: number): { pay: bigint; seize: bigint } | null {
  if (collPx <= 0n || debtPx <= 0n || owed <= 0n) return null;
  const collUsd = usdOf(loan.collAmt, collPx, collDec);
  const debtUsd = usdOf(owed, debtPx, debtDec);
  if (debtUsd === 0n || debtUsd * 10000n <= collUsd * LIQ_LTV) return null;
  const coverUsd = (collUsd * 10000n) / (10000n + BONUS_BPS);
  const wantUsd = debtUsd < coverUsd ? debtUsd : coverUsd;
  let pay = usdToAmt(wantUsd, debtPx, debtDec);
  if (pay > owed) pay = owed;
  if (pay === 0n) return null;
  const paidUsd = usdOf(pay, debtPx, debtDec);
  let seize = coverUsd === 0n ? loan.collAmt : (loan.collAmt * paidUsd) / coverUsd;
  if (seize > loan.collAmt) seize = loan.collAmt;
  return { pay, seize };
}

export function ltvBps(debtUsd: bigint, collUsd: bigint): bigint | null {
  if (collUsd <= 0n) return debtUsd > 0n ? null : 0n;
  return (debtUsd * 10000n) / collUsd;
}

export function liqCollPrice(owed: bigint, debtPx: bigint, debtDec: number, collAmt: bigint, collDec: number): bigint | null {
  if (owed <= 0n || debtPx <= 0n || collAmt <= 0n) return null;
  const debtUsd = usdOf(owed, debtPx, debtDec);
  return (debtUsd * 10000n * 10n ** BigInt(collDec)) / (LIQ_LTV * collAmt);
}

export { MIN_USD, OPEN_LTV, LIQ_LTV };
