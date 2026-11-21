import { concat, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, hashTypedData, keccak256, parseAbi, toHex, type Hex } from "viem";
import { BSC, connectBsc } from "@/lib/bsc";
import { BSC_SAFE, XLAYER, XLAYER_SAFE } from "@/lib/chain-marks";
import { CREATE_CALL, createCallData, createdAddress } from "@/lib/create-call";
import { RED_COMMIT, FAB_SYNC_SHIP, SEAL_REBATE_V5, TAPE_SYNC_SHIP, UP_SYNC_SHIP, X_VAULT_SHIP } from "@/lib/sync-ship-artifact";
import { ensureProvider, switchDeskChain } from "@/lib/wallet";
import { connectXLayer } from "@/lib/xlayer";

export type ShipKind = "up" | "tape" | "fab" | "vault";

const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const SHIPPED = keccak256(toHex("Shipped(address,address)"));
const VAULT_SHIPPED = keccak256(toHex("Shipped(address)"));

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);

const SPEC = {
  up: { chain: "bsc" as const, chainId: 56, safe: BSC_SAFE as Hex, init: UP_SYNC_SHIP, gas: 12_000_000n, rpc: [BSC.rpc, "https://bsc.publicnode.com"] },
  tape: { chain: "xlayer" as const, chainId: 196, safe: XLAYER_SAFE as Hex, init: TAPE_SYNC_SHIP, gas: 12_000_000n, rpc: [XLAYER.rpc, "https://xlayer.drpc.org"] },
  fab: { chain: "xlayer" as const, chainId: 196, safe: XLAYER_SAFE as Hex, init: FAB_SYNC_SHIP, gas: 12_000_000n, rpc: [XLAYER.rpc, "https://xlayer.drpc.org"] },
  vault: { chain: "xlayer" as const, chainId: 196, safe: XLAYER_SAFE as Hex, init: X_VAULT_SHIP, gas: 6_000_000n, rpc: [XLAYER.rpc, "https://xlayer.drpc.org"] },
};

export type ShipLanding = { ship: string; mark: string; book: string };

const KEY = "tapeliquid-sync-ship-v2";

export function savedShip(kind: ShipKind): ShipLanding | null {
  if (typeof window === "undefined") return null;
  try {
    const bag = JSON.parse(window.localStorage.getItem(KEY) || "{}") as Record<string, ShipLanding>;
    return bag[kind] ?? null;
  } catch {
    return null;
  }
}

function remember(kind: ShipKind, row: ShipLanding) {
  const bag = JSON.parse(window.localStorage.getItem(KEY) || "{}") as Record<string, ShipLanding>;
  bag[kind] = row;
  window.localStorage.setItem(KEY, JSON.stringify(bag));
}

async function rpc(chain: "bsc" | "xlayer", method: string, params: unknown[]): Promise<unknown> {
  const urls = chain === "bsc" ? SPEC.up.rpc : SPEC.tape.rpc;
  let last: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (json.error) throw new Error(json.error.message || "revert");
      return json.result;
    } catch (err) {
      last = err;
    }
  }
  throw last instanceof Error ? last : new Error("revert");
}

async function read<T>(chain: "bsc" | "xlayer", to: Hex, name: "getOwners" | "nonce" | "getTransactionHash", args: readonly unknown[]): Promise<T> {
  const data = encodeFunctionData({ abi: safeAbi, functionName: name, args } as never);
  const raw = (await rpc(chain, "eth_call", [{ to, data }, "latest"])) as Hex;
  return decodeFunctionResult({ abi: safeAbi, functionName: name, data: raw } as never) as T;
}

async function signer(chain: "bsc" | "xlayer"): Promise<string> {
  await switchDeskChain(chain === "bsc" ? 56 : 196);
  if (chain === "bsc") await connectBsc();
  else await connectXLayer();
  const eth = await ensureProvider();
  const rows = (await eth.request({ method: "eth_accounts" })) as string[];
  const from = rows?.[0];
  if (!from) throw new Error("nowallet");
  return from;
}

async function send(from: string, to: Hex, data: Hex, gas: bigint): Promise<Hex> {
  const eth = await ensureProvider();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, gas: `0x${gas.toString(16)}` }],
  })) as Hex;
}

async function wait(chain: "bsc" | "xlayer", hash: Hex): Promise<{ logs: { data: Hex; topics: Hex[] }[] }> {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const receipt = (await rpc(chain, "eth_getTransactionReceipt", [hash]).catch(() => null)) as
      | { status?: string; logs?: { data: Hex; topics: Hex[] }[] }
      | null;
    if (!receipt) continue;
    if (receipt.status === "0x0") throw new Error("revert");
    return { logs: receipt.logs ?? [] };
  }
  throw new Error("pending");
}

function normalizeSig(sig: string): Hex {
  const hex = (sig.startsWith("0x") ? sig : `0x${sig}`).toLowerCase();
  if (!/^0x[0-9a-f]{130}$/.test(hex)) throw new Error("revert");
  const v = Number.parseInt(hex.slice(-2), 16);
  const fixed = v < 27 ? v + 27 : v;
  return `${hex.slice(0, 130)}${fixed.toString(16).padStart(2, "0")}` as Hex;
}

async function sendSafe(kind: ShipKind, from: string, to: Hex, data: Hex): Promise<Hex> {
  const spec = SPEC[kind];
  const who = from.toLowerCase();
  const owners = (await read<string[]>(spec.chain, spec.safe, "getOwners", [])).map((row) => row.toLowerCase());
  if (!owners.includes(who) && who !== spec.safe.toLowerCase()) throw new Error("leader");
  if (who === spec.safe.toLowerCase()) return send(from, to, data, spec.gas);
  const nonce = await read<bigint>(spec.chain, spec.safe, "nonce", []);
  const message = {
    to,
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
  const onchain = await read<Hex>(spec.chain, spec.safe, "getTransactionHash", [to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce]);
  if (onchain.toLowerCase() !== typed.toLowerCase()) throw new Error("revert");
  const storeKey = `tapeliquid-sync-safe-${kind}-${nonce}-${typed}`;
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
            to,
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
    args: [to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures],
  });
  return send(from, spec.safe, exec, spec.gas);
}

function landed(kind: ShipKind, logs: { data: Hex; topics: Hex[] }[]): ShipLanding {
  const ship = createdAddress(logs);
  if (kind === "vault") {
    for (const log of logs) {
      if (log.topics[0]?.toLowerCase() === VAULT_SHIPPED.toLowerCase() && log.topics[1]?.length === 66) {
        const vault = `0x${log.topics[1].slice(26)}`;
        return { ship, mark: "", book: vault };
      }
    }
    return { ship, mark: "", book: "" };
  }
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() === SHIPPED.toLowerCase() && log.topics[1]?.length === 66 && log.topics[2]?.length === 66) {
      return { ship, mark: `0x${log.topics[1].slice(26)}`, book: `0x${log.topics[2].slice(26)}` };
    }
  }
  return { ship, mark: "", book: "" };
}

/** Two signatures, same browser. The trading page does not switch to the new addresses. */
export async function deployShip(kind: ShipKind): Promise<ShipLanding> {
  const spec = SPEC[kind];
  const from = await signer(spec.chain);
  const inner = createCallData(spec.init);
  const hash = await sendSafe(kind, from, CREATE_CALL, inner);
  const receipt = await wait(spec.chain, hash);
  const row = landed(kind, receipt.logs);
  remember(kind, row);
  return row;
}

const RED_USDT = {
  bsc: BSC.usdt,
  xlayer: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Hex,
};

/** New commit-reveal packet. Claims stay on the old contracts. */
export async function deployRedCommit(chain: "bsc" | "xlayer"): Promise<string> {
  const kind: ShipKind = chain === "bsc" ? "up" : "tape";
  const spec = SPEC[kind];
  const from = await signer(chain);
  const args = encodeAbiParameters([{ type: "address" }, { type: "address" }], [RED_USDT[chain], spec.safe]);
  const init = `${RED_COMMIT}${args.slice(2)}` as Hex;
  const hash = await sendSafe(kind, from, CREATE_CALL, createCallData(init));
  const receipt = await wait(chain, hash);
  const address = createdAddress(receipt.logs);
  window.localStorage.setItem(`tapeliquid-red-commit-${chain}`, address);
  return address;
}

export function savedRedCommit(chain: "bsc" | "xlayer"): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(`tapeliquid-red-commit-${chain}`) || "";
}

const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const REBATE_SALT_V5 = keccak256(toHex("TAPELIQUID-seal-v5"));
const CLAIM_X = "0xCAC69F02c06bfCa3bFDb1eaF1F4a60e17e718081" as Hex;
const CLAIM_BSC = "0xce3511b6e909c9694826cfd5dbe434d457920eba" as Hex;
const CLAIM_GATE = "0x798637b6d18cE053D69CfC0B08Ead105de352c11" as Hex;
const CIRCUITS = "0x69F663931209096037474d7C20402232E5C762cA" as Hex;

function rebateInit(chain: "bsc" | "xlayer"): Hex {
  const safe = chain === "bsc" ? BSC_SAFE : XLAYER_SAFE;
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }],
    chain === "xlayer"
      ? [RED_USDT.xlayer, CIRCUITS, ZERO, CLAIM_X, ZERO, ZERO, safe]
      : [BSC.usdt, ZERO, CLAIM_GATE, CLAIM_BSC, ZERO, ZERO, safe],
  );
  return `${SEAL_REBATE_V5}${args.slice(2)}` as Hex;
}

/** Predicted address. Claims stay on the old rebate until this one has code. */
export function rebateClerkAddress(chain: "bsc" | "xlayer"): Hex {
  const init = rebateInit(chain);
  const hash = keccak256(concat(["0xff", FACTORY, REBATE_SALT_V5, keccak256(init)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

export async function deployRebateClerk(chain: "bsc" | "xlayer"): Promise<string> {
  const kind: ShipKind = chain === "bsc" ? "up" : "tape";
  const from = await signer(chain);
  const data = concat([REBATE_SALT_V5, rebateInit(chain)]);
  const hash = await sendSafe(kind, from, FACTORY, data);
  await wait(chain, hash);
  return rebateClerkAddress(chain);
}
