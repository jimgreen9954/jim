import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, hashTypedData, parseAbi, type Hex } from "viem";
import { BNB_GAS_RESERVE, BSC, pretty, units } from "@/lib/bsc";
import { BSC_SAFE, XLAYER, XLAYER_SAFE } from "@/lib/chain-marks";
import { CREATE_CALL, createCallData } from "@/lib/create-call";
import { LEND_BYTECODE } from "@/lib/lend-bytecode";
import { LEND_ERC_BYTECODE } from "@/lib/lend-erc-bytecode";
import { OKB } from "@/lib/okb";
import { OPEN_POOL } from "@/lib/tape-open-swap";
import { TAPE_BEM, TAPE_TOKEN, TAPE_USDT } from "@/lib/tape-pool";
import { ensureProvider, switchDeskChain } from "@/lib/wallet";

export type LendChain = "xlayer" | "bsc";

const abi = parseAbi([
  "function cash() view returns (uint256)",
  "function assets() view returns (uint256)",
  "function totalShares() view returns (uint256)",
  "function totalBorrow() view returns (uint256)",
  "function shares(address) view returns (uint256)",
  "function collateral(address) view returns (uint256)",
  "function debtOf(address) view returns (uint256)",
  "function supplyOf(address) view returns (uint256)",
  "function maxBorrow(address) view returns (uint256)",
  "function price() view returns (uint256)",
  "function rates() view returns (uint256 borrowApr, uint256 supplyApr, uint256 util)",
  "function deposit(uint256)",
  "function withdraw(uint256)",
  "function lockNative() payable",
  "function lock(uint256)",
  "function unlock(uint256)",
  "function borrow(uint256)",
  "function repay(uint256)",
  "function liquidate(address,uint256)",
  "function fresh() view returns (bool)",
  "function poke()",
]);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);

const DEAD = 1_000_000n;
const DUST = 1_000n;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;

export type LendAsset = "gas" | "tape" | "bem";

const PIN: Partial<Record<`${LendChain}:${LendAsset}`, Hex>> = {
  "xlayer:gas": "0x57228158cba08c61710ab2644e583c328ec86ea7",
  "xlayer:tape": "0x425285da21ed3eabe64550d1be7dcabcf6f9e851",
  "xlayer:bem": "0x5ed8551f90acc6395810d8274b019bf13ef1f696",
  "bsc:gas": "0xd8d981d32b12ea85b739bb667946975d25b0ab53",
  "bsc:bem": "0xd2c7150f7779ded403c3f81a68dab5164b54df28",
};

export function lendChoices(chain: LendChain): LendAsset[] {
  return chain === "xlayer" ? ["gas", "tape", "bem"] : ["gas", "bem"];
}

export function lendSpec(chain: LendChain, asset: LendAsset) {
  const base = LEND_MARKET[chain];
  if (asset === "gas") return { ...base, native: true, collDec: 18, mode: 0 as const };
  if (chain === "bsc" && asset === "bem") {
    return {
      ...base,
      collSym: "BEM",
      coll: BSC.bem,
      native: false,
      collDec: 8,
      pool: "0x3098D7A051045000d68eC0360753A40C8cABEa31" as Hex,
      mode: 0 as const,
    };
  }
  if (chain === "xlayer" && asset === "tape") {
    return { ...base, collSym: "TAPE", coll: TAPE_TOKEN, native: false, collDec: 8, pool: OPEN_POOL, mode: 1 as const };
  }
  if (chain === "xlayer" && asset === "bem") {
    return { ...base, collSym: "BEM", coll: TAPE_BEM, native: false, collDec: 8, pool: OPEN_POOL, mode: 2 as const };
  }
  throw new Error("asset");
}

export const LEND_MARKET = {
  xlayer: {
    usdt: TAPE_USDT,
    usdtDec: 6,
    usdtSym: "USDT0",
    collSym: "OKB",
    coll: OKB.wokb,
    pool: "0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082" as Hex,
    safe: XLAYER_SAFE,
    reserve: OKB.gasReserve,
    chainId: 196 as const,
  },
  bsc: {
    usdt: BSC.usdt,
    usdtDec: 18,
    usdtSym: "USDT",
    collSym: "BNB",
    coll: BSC.wbnb,
    pool: BSC.bnbPool,
    safe: BSC_SAFE,
    reserve: BNB_GAS_RESERVE,
    chainId: 56 as const,
  },
} as const;

const rpcs: Record<LendChain, string[]> = {
  xlayer: [XLAYER.rpc, "https://xlayer.drpc.org"],
  bsc: [BSC.rpc, "https://bsc.publicnode.com"],
};

function keyOf(chain: LendChain, asset: LendAsset) {
  return `tapeliquid-lend2-${chain}-${asset}`;
}

function feeKey(chain: LendChain, asset: LendAsset) {
  return `tapeliquid-lend3-${chain}-${asset}`;
}

export function lendAddress(chain: LendChain, asset: LendAsset = "gas"): Hex | null {
  const pinned = PIN[`${chain}:${asset}`];
  if (pinned) return pinned;
  if (typeof window === "undefined") return null;
  const saved = window.localStorage.getItem(feeKey(chain, asset)) ?? window.localStorage.getItem(keyOf(chain, asset)) ?? "";
  return /^0x[a-fA-F0-9]{40}$/.test(saved) ? (saved as Hex) : null;
}

export type LendView = {
  live: boolean;
  cash: bigint;
  assets: bigint;
  supply: bigint;
  debt: bigint;
  posted: bigint;
  maxBorrow: bigint;
  freeColl: bigint;
  walletUsdt: bigint;
  walletGas: bigint;
  walletColl: bigint;
  fresh: boolean;
  price: bigint | null;
  borrowApr: bigint;
  supplyApr: bigint;
};

async function rpc(chain: LendChain, method: string, params: unknown[]): Promise<unknown> {
  let last = "rpc";
  for (const url of rpcs[chain]) {
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

async function call(chain: LendChain, to: Hex, data: Hex, block: "latest" | bigint = "latest"): Promise<Hex> {
  const tag = typeof block === "bigint" ? `0x${block.toString(16)}` : "latest";
  const result = await rpc(chain, "eth_call", [{ to, data }, tag]);
  if (typeof result !== "string") throw new Error("rpc");
  return result as Hex;
}

function read<T>(
  chain: LendChain,
  to: Hex,
  fn: string,
  args: readonly unknown[] = [],
  book: readonly unknown[] = abi,
  block: "latest" | bigint = "latest",
): Promise<T> {
  const data = (encodeFunctionData as (spec: { abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }) => Hex)({
    abi: book,
    functionName: fn,
    args,
  });
  return call(chain, to, data, block).then(
    (raw) =>
      (decodeFunctionResult as (spec: { abi: readonly unknown[]; functionName: string; data: Hex }) => T)({
        abi: book,
        functionName: fn,
        data: raw,
      }),
  );
}

function empty(chain: LendChain): LendView {
  return {
    live: false,
    cash: 0n,
    assets: 0n,
    supply: 0n,
    debt: 0n,
    posted: 0n,
    maxBorrow: 0n,
    freeColl: 0n,
    walletUsdt: 0n,
    walletGas: 0n,
    walletColl: 0n,
    fresh: false,
    price: null,
    borrowApr: 0n,
    supplyApr: 0n,
  };
}

export async function readLend(chain: LendChain, asset: LendAsset, account: string | null): Promise<LendView> {
  const spec = lendSpec(chain, asset);
  const lend = lendAddress(chain, asset);
  const who = (account || ZERO) as Hex;
  const [walletUsdt, walletGas, walletColl] = await Promise.all([
    read<bigint>(chain, spec.usdt, "balanceOf", [who], erc20).catch(() => 0n),
    rpc(chain, "eth_getBalance", [who, "latest"]).then((raw) => BigInt(String(raw))).catch(() => 0n),
    spec.native
      ? Promise.resolve(0n)
      : read<bigint>(chain, spec.coll, "balanceOf", [who], erc20).catch(() => 0n),
  ]);
  if (!lend) return { ...empty(chain), walletUsdt, walletGas, walletColl, fresh: false };
  const [cash, assets, supply, debt, posted, maxMore, price, rates, liveFresh] = await Promise.all([
    read<bigint>(chain, lend, "cash"),
    read<bigint>(chain, lend, "assets"),
    read<bigint>(chain, lend, "supplyOf", [who]),
    read<bigint>(chain, lend, "debtOf", [who]),
    read<bigint>(chain, lend, "collateral", [who]),
    read<bigint>(chain, lend, "maxBorrow", [who]),
    read<bigint>(chain, lend, "price").catch(() => null),
    read<readonly [bigint, bigint, bigint]>(chain, lend, "rates").catch(() => [0n, 0n, 0n] as const),
    spec.native ? Promise.resolve(true) : read<boolean>(chain, lend, "fresh").catch(() => false),
  ]);
  const unit = 10n ** BigInt(spec.collDec);
  let free = posted;
  if (debt > 0n && price && price > 0n) {
    const keep = (debt * 2n * unit + price - 1n) / price;
    free = posted > keep ? posted - keep : 0n;
  }
  return {
    live: true,
    cash,
    assets,
    supply,
    debt,
    posted,
    maxBorrow: maxMore,
    freeColl: free,
    walletUsdt,
    walletGas,
    walletColl: spec.native ? walletGas : walletColl,
    fresh: liveFresh,
    price,
    borrowApr: rates[0],
    supplyApr: rates[1],
  };
}

async function signer(chain: LendChain): Promise<string> {
  await switchDeskChain(LEND_MARKET[chain].chainId);
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

async function wait(chain: LendChain, hash: Hex): Promise<{ logs: { data: Hex; topics: Hex[] }[] }> {
  for (const url of rpcs[chain]) {
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

async function allowToken(chain: LendChain, from: string, token: Hex, amount: bigint, lend: Hex) {
  const allowance = await read<bigint>(chain, token, "allowance", [from as Hex, lend], erc20);
  if (allowance >= amount) return;
  if (allowance > 0n) await wait(chain, await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [lend, 0n] })));
  await wait(chain, await send(from, token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [lend, 2n ** 256n - 1n] })));
}

function need(chain: LendChain, asset: LendAsset): Hex {
  const lend = lendAddress(chain, asset);
  if (!lend) throw new Error("live");
  return lend;
}

function born(logs: { topics: Hex[] }[]): string {
  const topic = "0x4db17dd5e4732fb6da34a148104a592783ca119a1e7bb8829eba6cbadef0b511";
  for (const log of logs) {
    if ((log.topics[0] || "").toLowerCase() !== topic) continue;
    if (log.topics[1] && log.topics[1].length === 66) return `0x${log.topics[1].slice(26)}`;
  }
  throw new Error("revert");
}

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);

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

export async function deployLend(chain: LendChain, asset: LendAsset): Promise<string> {
  const spec = lendSpec(chain, asset);
  const from = await signer(chain);
  const who = from.toLowerCase();
  const args = spec.native
    ? encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }],
        [spec.usdt, spec.coll, spec.pool, spec.safe],
      )
    : encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint8" },
          { type: "address" },
        ],
        [spec.mode, spec.usdt, spec.coll, spec.pool, spec.collDec, spec.safe],
      );
  const init = ((spec.native ? LEND_BYTECODE : LEND_ERC_BYTECODE) + args.slice(2)) as Hex;
  const inner = createCallData(init);
  const hash =
    who === spec.safe.toLowerCase()
      ? await send(from, CREATE_CALL, inner, 0n, 4_000_000n)
      : await sendSafe(chain, spec.safe, spec.chainId, from, inner);
  const receipt = await wait(chain, hash);
  const landed = born(receipt.logs);
  window.localStorage.setItem(feeKey(chain, asset), landed);
  return landed;
}

async function sendSafe(chain: LendChain, safe: Hex, chainId: number, from: string, data: Hex): Promise<Hex> {
  const who = from.toLowerCase();
  const owners = (await read<string[]>(chain, safe, "getOwners", [], safeAbi)).map((row) => row.toLowerCase());
  if (!owners.includes(who)) throw new Error("leader");
  const nonce = await read<bigint>(chain, safe, "nonce", [], safeAbi);
  const message = safeMessage(data, nonce);
  const typed = hashTypedData({
    domain: { chainId, verifyingContract: safe },
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
  const onchain = await read<Hex>(
    chain,
    safe,
    "getTransactionHash",
    [CREATE_CALL, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce],
    safeAbi,
  );
  if (onchain.toLowerCase() !== typed.toLowerCase()) throw new Error("revert");
  const storeKey = `tapeliquid-safe-${chain}-${nonce}-${typed}`;
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
          domain: { chainId, verifyingContract: safe },
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
  const call = encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [CREATE_CALL, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures],
  });
  return send(from, safe, call, 0n, 5_000_000n);
}

export async function depositLend(chain: LendChain, asset: LendAsset, amount: string) {
  const spec = lendSpec(chain, asset);
  const qty = units(amount, spec.usdtDec);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  const have = await read<bigint>(chain, spec.usdt, "balanceOf", [from as Hex], erc20);
  if (have < qty) throw new Error("usdt");
  const lend = need(chain, asset);
  await allowToken(chain, from, spec.usdt, qty, lend);
  await wait(chain, await send(from, lend, encodeFunctionData({ abi, functionName: "deposit", args: [qty] })));
}

export async function withdrawLend(chain: LendChain, asset: LendAsset, amount: string) {
  const spec = lendSpec(chain, asset);
  const qty = units(amount, spec.usdtDec);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  const lend = need(chain, asset);
  const [supply, haveShares, total, poolAssets, poolCash] = await Promise.all([
    read<bigint>(chain, lend, "supplyOf", [from as Hex]),
    read<bigint>(chain, lend, "shares", [from as Hex]),
    read<bigint>(chain, lend, "totalShares"),
    read<bigint>(chain, lend, "assets"),
    read<bigint>(chain, lend, "cash"),
  ]);
  const room = supply < poolCash ? supply : poolCash;
  const want = qty < room ? qty : room;
  if (want === 0n || haveShares === 0n || total === 0n) throw new Error("idle");
  let shareAmt = (want * (total + DEAD) + poolAssets + DUST - 1n) / (poolAssets + DUST);
  if (shareAmt > haveShares) shareAmt = haveShares;
  if (shareAmt === 0n) throw new Error("idle");
  await wait(chain, await send(from, lend, encodeFunctionData({ abi, functionName: "withdraw", args: [shareAmt] })));
}

export async function lockLend(chain: LendChain, asset: LendAsset, amount: string) {
  const spec = lendSpec(chain, asset);
  const qty = units(amount, spec.collDec);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  const lend = need(chain, asset);
  if (spec.native) {
    const gas = BigInt(String(await rpc(chain, "eth_getBalance", [from, "latest"])));
    if (gas < qty + spec.reserve) throw new Error("gas");
    await wait(chain, await send(from, lend, encodeFunctionData({ abi, functionName: "lockNative" }), qty));
    return;
  }
  const have = await read<bigint>(chain, spec.coll, "balanceOf", [from as Hex], erc20);
  if (have < qty) throw new Error("coll");
  await allowToken(chain, from, spec.coll, qty, lend);
  await wait(chain, await send(from, lend, encodeFunctionData({ abi, functionName: "lock", args: [qty] })));
}

export async function unlockLend(chain: LendChain, asset: LendAsset, amount: string) {
  const spec = lendSpec(chain, asset);
  const qty = units(amount, spec.collDec);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  await wait(chain, await send(from, need(chain, asset), encodeFunctionData({ abi, functionName: "unlock", args: [qty] })));
}

export async function borrowLend(chain: LendChain, asset: LendAsset, amount: string) {
  const spec = lendSpec(chain, asset);
  const qty = units(amount, spec.usdtDec);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  const lend = need(chain, asset);
  const [cash, posted, liveFresh] = await Promise.all([
    read<bigint>(chain, lend, "cash"),
    read<bigint>(chain, lend, "collateral", [from as Hex]),
    spec.native || spec.mode === 0 ? Promise.resolve(true) : read<boolean>(chain, lend, "fresh"),
  ]);
  if (posted === 0n) throw new Error("posted");
  if (qty > cash) throw new Error("dry");
  if (!liveFresh) {
    await wait(chain, await send(from, lend, encodeFunctionData({ abi, functionName: "poke" })));
  }
  await wait(chain, await send(from, lend, encodeFunctionData({ abi, functionName: "borrow", args: [qty] })));
}

export async function repayLend(chain: LendChain, asset: LendAsset, amount: string) {
  const spec = lendSpec(chain, asset);
  const qty = units(amount, spec.usdtDec);
  if (qty === 0n) throw new Error("amount");
  const from = await signer(chain);
  const have = await read<bigint>(chain, spec.usdt, "balanceOf", [from as Hex], erc20);
  if (have < qty) throw new Error("usdt");
  const lend = need(chain, asset);
  await allowToken(chain, from, spec.usdt, qty, lend);
  await wait(chain, await send(from, lend, encodeFunctionData({ abi, functionName: "repay", args: [qty] })));
}

export async function pokeLend(chain: LendChain, asset: LendAsset) {
  const spec = lendSpec(chain, asset);
  if (spec.native || spec.mode === 0) throw new Error("live");
  const from = await signer(chain);
  await wait(chain, await send(from, need(chain, asset), encodeFunctionData({ abi, functionName: "poke" })));
}

export function lendText(amount: bigint, decimals: number): string {
  return pretty(amount, decimals, 4);
}

export function lendPlain(amount: bigint, decimals: number): string {
  const raw = pretty(amount, decimals, decimals).replace(/,/g, "");
  return raw;
}

/** Collateral marked in stablecoin. Same division the contract uses. Null when the price is not in. */
export function collQuote(posted: bigint, price: bigint | null, collDec: number): bigint | null {
  if (!price || price <= 0n) return null;
  return (posted * price) / 10n ** BigInt(collDec);
}

/** Debt / collateral value, in basis points. 7500 is the contract liquidation line. */
export function debtBps(debt: bigint, value: bigint | null): bigint | null {
  if (debt === 0n) return 0n;
  if (value == null) return null;
  if (value === 0n) return 10001n;
  return (debt * 10000n) / value;
}

/**
 * Lowest collateral price, in stablecoin raw units per 1 token, that is still safe.
 * One tick under this, liquidate() is allowed. Matches TapeLend / TapeLendErc: 75%.
 */
export function closePrice(debt: bigint, posted: bigint, collDec: number): bigint | null {
  if (debt === 0n || posted === 0n) return null;
  const unit = 10n ** BigInt(collDec);
  const den = 7500n * posted;
  const num = debt * 10000n * unit;
  let px = (num + den - 1n) / den;
  const open = (p: bigint) => debt * 10000n > ((posted * p) / unit) * 7500n;
  for (let i = 0; i < 8 && open(px); i += 1) px += 1n;
  return px;
}

export function bpsText(bps: bigint): string {
  if (bps > 10000n) return ">100%";
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${frac}%`;
}

const BONUS = 500n;
const LIQ_BPS = 7500n;

export type Seize = {
  pay: bigint;
  seize: bigint;
  seizeValue: bigint;
  profit: bigint;
  wiped: bigint;
  shortfall: bigint;
};

/** What one full liquidation does, using the contract's rounding. */
export function seizeQuote(debt: bigint, posted: bigint, price: bigint, collDec: number): Seize | null {
  if (debt === 0n || posted === 0n || price <= 0n) return null;
  const unit = 10n ** BigInt(collDec);
  const usdtOf = (amount: bigint) => (amount * price) / unit;
  const collOf = (amount: bigint) => (amount * unit + price - 1n) / price;
  const cover = usdtOf((posted * 10000n) / (10000n + BONUS));
  const pay = cover < debt ? cover : debt;
  if (pay === 0n) return null;
  let seize = collOf((pay * (10000n + BONUS)) / 10000n);
  if (seize > posted) seize = posted;
  if (seize === 0n) return null;
  const seizeValue = usdtOf(seize);
  const closes = pay === debt || seize === posted;
  const wiped = closes ? debt : pay;
  return {
    pay,
    seize,
    seizeValue,
    profit: seizeValue > pay ? seizeValue - pay : 0n,
    wiped,
    shortfall: closes && debt > pay ? debt - pay : 0n,
  };
}

export function underwater(debt: bigint, posted: bigint, price: bigint | null, collDec: number): boolean {
  if (debt === 0n || posted === 0n || !price || price <= 0n) return false;
  const value = (posted * price) / 10n ** BigInt(collDec);
  return debt * 10000n > value * LIQ_BPS;
}

const SEEN: Partial<Record<`${LendChain}:${LendAsset}`, { block: bigint; borrow: bigint; addrs: readonly Hex[] }>> = {
  "xlayer:tape": {
    block: 74735282n,
    borrow: 83600343n,
    addrs: [
      "0x585d2df4b8fdda783b074555e6f3787e3fcb39d7",
      "0xe98239cd0fe01f027842d6af58edd05e0c3fa7a8",
      "0xeb5d714444a14691c765b485632e28cb1619dbf4",
    ],
  },
  "xlayer:bem": {
    block: 75031920n,
    borrow: 674082592n,
    addrs: [
      "0x585d2df4b8fdda783b074555e6f3787e3fcb39d7",
      "0xeb5d714444a14691c765b485632e28cb1619dbf4",
      "0x18529cbdb9cf708c1497122c21344f7fd7448ed0",
      "0x5166d829e38e78f402c2b0be289adb086cb5d331",
    ],
  },
};

export type Debtor = {
  chain: LendChain;
  asset: LendAsset;
  account: Hex;
  debt: bigint;
  posted: bigint;
  price: bigint | null;
  ratio: bigint | null;
  seize: Seize | null;
  open: boolean;
};

function bagKey(chain: LendChain, asset: LendAsset) {
  return `tapeliquid-debtors-${chain}-${asset}`;
}

function loadBag(chain: LendChain, asset: LendAsset) {
  const seen = SEEN[`${chain}:${asset}`];
  let saved: { block?: string; borrow?: string; addrs?: string[] } = {};
  if (typeof window !== "undefined") {
    try {
      saved = JSON.parse(window.localStorage.getItem(bagKey(chain, asset)) || "{}") as typeof saved;
    } catch {
      saved = {};
    }
  }
  const addrs = new Set<string>([...(seen?.addrs ?? []), ...(saved.addrs ?? [])].map((item) => item.toLowerCase()));
  const block = saved.block ? BigInt(saved.block) : seen?.block ?? 0n;
  const borrow = saved.borrow ? BigInt(saved.borrow) : seen?.borrow ?? 0n;
  return { block, borrow, addrs };
}

function saveBag(chain: LendChain, asset: LendAsset, block: bigint, borrow: bigint, addrs: Set<string>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    bagKey(chain, asset),
    JSON.stringify({ block: block.toString(), borrow: borrow.toString(), addrs: [...addrs] }),
  );
}

async function bornBlock(chain: LendChain, lend: Hex): Promise<bigint> {
  const key = `tapeliquid-lend-born-${chain}-${lend}`;
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(key);
    if (saved && /^\d+$/.test(saved)) return BigInt(saved);
  }
  const head = BigInt(String(await rpc(chain, "eth_blockNumber", [])));
  let lo = 1n;
  let hi = head;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    const code = await rpc(chain, "eth_getCode", [lend, `0x${mid.toString(16)}`]);
    if (typeof code === "string" && code !== "0x") hi = mid;
    else lo = mid + 1n;
  }
  if (typeof window !== "undefined") window.localStorage.setItem(key, lo.toString());
  return lo;
}

async function callersAt(chain: LendChain, lend: Hex, block: bigint): Promise<string[]> {
  const raw = (await rpc(chain, "eth_getBlockByNumber", [`0x${block.toString(16)}`, true])) as {
    transactions?: { from?: string; to?: string | null }[];
  };
  const to = lend.toLowerCase();
  return (raw.transactions ?? [])
    .filter((tx) => (tx.to || "").toLowerCase() === to && tx.from)
    .map((tx) => (tx.from as string).toLowerCase());
}

async function extendBorrowers(chain: LendChain, asset: LendAsset, lend: Hex, liveBorrow: bigint) {
  const bag = loadBag(chain, asset);
  if (bag.borrow === liveBorrow && bag.block > 0n) return bag.addrs;
  let block = bag.block;
  let cur = bag.borrow;
  if (block === 0n) {
    block = await bornBlock(chain, lend);
    cur = 0n;
  }
  const at = await read<bigint>(chain, lend, "totalBorrow", [], abi, block).catch(() => null);
  if (at !== cur) {
    block = await bornBlock(chain, lend);
    cur = 0n;
  }
  const head = BigInt(String(await rpc(chain, "eth_blockNumber", [])));
  let guard = 0;
  while (cur !== liveBorrow && block < head && guard < 40) {
    let left = block;
    let right = head;
    while (left + 1n < right) {
      const mid = (left + right) / 2n;
      const value = await read<bigint>(chain, lend, "totalBorrow", [], abi, mid);
      if (value === cur) left = mid;
      else right = mid;
    }
    for (const from of await callersAt(chain, lend, right)) bag.addrs.add(from);
    cur = await read<bigint>(chain, lend, "totalBorrow", [], abi, right);
    block = right;
    guard += 1;
  }
  saveBag(chain, asset, head, liveBorrow, bag.addrs);
  return bag.addrs;
}

export async function readDebtors(): Promise<Debtor[]> {
  const jobs = (["xlayer", "bsc"] as const).flatMap((chain) => lendChoices(chain).map((asset) => debtorsOf(chain, asset)));
  const rows = (await Promise.all(jobs)).flat();
  return rows.sort((a, b) => Number(b.open) - Number(a.open) || Number((b.ratio ?? 0n) - (a.ratio ?? 0n)));
}

async function debtorsOf(chain: LendChain, asset: LendAsset): Promise<Debtor[]> {
  const lend = lendAddress(chain, asset);
  if (!lend) return [];
  const spec = lendSpec(chain, asset);
  const liveBorrow = await read<bigint>(chain, lend, "totalBorrow").catch(() => 0n);
  if (liveBorrow === 0n) return [];
  const who = await extendBorrowers(chain, asset, lend, liveBorrow).catch(() => loadBag(chain, asset).addrs);
  const price = await read<bigint>(chain, lend, "price").catch(() => null);
  const rows = await Promise.all(
    [...who].map(async (account) => {
      const [debt, posted] = await Promise.all([
        read<bigint>(chain, lend, "debtOf", [account as Hex]).catch(() => 0n),
        read<bigint>(chain, lend, "collateral", [account as Hex]).catch(() => 0n),
      ]);
      return { account: account as Hex, debt, posted };
    }),
  );
  return rows
    .filter((row) => row.debt > 0n)
    .map((row) => {
      const value = collQuote(row.posted, price, spec.collDec);
      const ratio = debtBps(row.debt, value);
      const seize = price && price > 0n ? seizeQuote(row.debt, row.posted, price, spec.collDec) : null;
      return {
        chain,
        asset,
        account: row.account,
        debt: row.debt,
        posted: row.posted,
        price,
        ratio,
        seize,
        open: underwater(row.debt, row.posted, price, spec.collDec),
      };
    });
}

export async function liquidateLend(chain: LendChain, asset: LendAsset, account: string) {
  const spec = lendSpec(chain, asset);
  const from = await signer(chain);
  if (from.toLowerCase() === account.toLowerCase()) throw new Error("self");
  const lend = need(chain, asset);
  const [debt, posted, price, have] = await Promise.all([
    read<bigint>(chain, lend, "debtOf", [account as Hex]),
    read<bigint>(chain, lend, "collateral", [account as Hex]),
    read<bigint>(chain, lend, "price"),
    read<bigint>(chain, spec.usdt, "balanceOf", [from as Hex], erc20),
  ]);
  if (!underwater(debt, posted, price, spec.collDec)) throw new Error("safe");
  const quote = seizeQuote(debt, posted, price, spec.collDec);
  if (!quote) throw new Error("amount");
  if (have < quote.pay) throw new Error("usdt");
  await allowToken(chain, from, spec.usdt, quote.pay, lend);
  await wait(
    chain,
    await send(from, lend, encodeFunctionData({ abi, functionName: "liquidate", args: [account as Hex, 2n ** 256n - 1n] })),
  );
}

export function aprText(apr: bigint): string {
  const points = (apr * 10000n) / 10n ** 18n;
  const whole = points / 100n;
  const frac = (points % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${frac}%`;
}
