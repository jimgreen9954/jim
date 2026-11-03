import { encodeAbiParameters, encodeFunctionData, hashTypedData, keccak256, parseAbi, parseEther, type Hex } from "viem";
import { BSC, BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { CREATE_CALL, createCallData, createdAddress } from "@/lib/create-call";
import { GAS_STOCK_BYTECODE } from "@/lib/gas-stock-artifact";
import { ensureProvider, switchDeskChain } from "@/lib/wallet";
import { XLAYER } from "@/lib/xlayer";

export type GasChain = "xlayer" | "bsc";

const SAFE = { xlayer: XLAYER_SAFE, bsc: BSC_SAFE } as const;
const CHAIN_ID = { xlayer: 196, bsc: 56 } as const;
const RPC = {
  xlayer: ["https://xlayerrpc.okx.com", XLAYER.rpc],
  bsc: ["https://bsc.publicnode.com", BSC.rpc],
} as const;
const KEY = { xlayer: "tapeliquid-gas-xlayer", bsc: "tapeliquid-gas-bsc" } as const;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;

export const GAS_STOCK = {
  xlayer: "0x293e4803b9b53a3d81b7545beb1957514a586522",
  bsc: "0x9731a8c780917cf7964ce3c13d8b9818ce924e19",
} as const;

const safeAbi = parseAbi([
  "function getOwners() view returns (address[])",
  "function nonce() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) payable returns (bool)",
]);

const stockAbi = parseAbi([
  "function spare(address) view returns (uint256)",
  "function fund() payable",
  "function open(address taker, bytes32 key, uint64 expire) payable returns (uint256)",
  "function openSpare(address taker, bytes32 key, uint64 expire, uint256 net) returns (uint256)",
  "function fill(uint256 id, bytes32 secret)",
  "event Opened(uint256 indexed id, address indexed maker, address indexed taker, uint256 net, bytes32 key, uint64 expire)",
]);

export function gasStockAddress(chain: GasChain): Hex {
  return GAS_STOCK[chain];
}

async function nativeBalance(chain: GasChain, who: Hex): Promise<bigint> {
  let last = "revert";
  for (const url of RPC[chain]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [who, "latest"] }),
      });
      const json = (await res.json()) as { result?: string; error?: { message?: string } };
      if (json.result) return BigInt(json.result);
      last = json.error?.message || last;
    } catch {
      last = "revert";
    }
  }
  throw new Error(last);
}

export async function readGasBalances(account: string | null): Promise<{ okb: bigint; bnb: bigint; walletOkb: bigint; walletBnb: bigint }> {
  const who = (account || ZERO) as Hex;
  const [okb, bnb, walletOkb, walletBnb] = await Promise.all([
    nativeBalance("xlayer", GAS_STOCK.xlayer),
    nativeBalance("bsc", GAS_STOCK.bsc),
    account ? nativeBalance("xlayer", who) : 0n,
    account ? nativeBalance("bsc", who) : 0n,
  ]);
  return { okb, bnb, walletOkb, walletBnb };
}

export function arrivalWei(toBnb: boolean, gross: bigint, okbUsd: bigint, bnbUsd: bigint): bigint {
  if (gross <= 0n || okbUsd <= 0n || bnbUsd <= 0n) return 0n;
  const net = (gross * 998n) / 1000n;
  if (net <= 0n) return 0n;
  return toBnb ? (net * okbUsd * 10n ** 12n) / bnbUsd : (net * bnbUsd) / okbUsd / 10n ** 12n;
}

export async function fundGas(chain: GasChain, from: string, amount: string): Promise<Hex> {
  const value = parseEther(amount);
  if (value <= 0n) throw new Error("amount");
  const data = encodeFunctionData({ abi: stockAbi, functionName: "fund" });
  const receipt = await sendTx(chain, from, GAS_STOCK[chain], data, value);
  return receipt.hash;
}

export async function crossGas(toBnb: boolean, from: string, amount: string, okbUsd: bigint, bnbUsd: bigint): Promise<"done" | "second"> {
  const gross = parseEther(amount);
  const out = arrivalWei(toBnb, gross, okbUsd, bnbUsd);
  if (gross <= 0n || out <= 0n) throw new Error("amount");
  const source: GasChain = toBnb ? "xlayer" : "bsc";
  const dest: GasChain = toBnb ? "bsc" : "xlayer";
  const wallet = await nativeBalance(source, from as Hex);
  const reserve = source === "xlayer" ? 2_000_000_000_000_000n : 3_000_000_000_000_000n;
  if (wallet < gross + reserve) throw new Error("balance");
  const mine = await callStock<bigint>(dest, "spare", [from as Hex]);
  const house = await callStock<bigint>(dest, "spare", [SAFE[dest]]);
  const maker = mine >= out ? from : house >= out ? SAFE[dest] : "";
  if (!maker) throw new Error("stock");
  const key = "tapeliquid-gas-ticket";
  const saved = JSON.parse(window.localStorage.getItem(key) || "null") as Ticket | null;
  const ticket: Ticket =
    saved && saved.from === from.toLowerCase() && saved.toBnb === toBnb && saved.gross === gross.toString()
      ? saved
      : {
          from: from.toLowerCase(),
          toBnb,
          gross: gross.toString(),
          out: out.toString(),
          secret: keccak256(`0x${crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`),
          hash: "0x" as Hex,
          expire: (Math.floor(Date.now() / 1000) + 3600).toString(),
          maker,
          step: "lock",
        };
  if (ticket.hash === "0x") ticket.hash = keccak256(ticket.secret);
  const payer = ticket.maker || maker;
  window.localStorage.setItem(key, JSON.stringify(ticket));
  if (ticket.step === "lock") {
    const data = encodeFunctionData({
      abi: stockAbi,
      functionName: "open",
      args: [payer as Hex, ticket.hash, BigInt(ticket.expire)],
    });
    const receipt = await sendTx(source, from, GAS_STOCK[source], data, gross);
    ticket.sourceId = openedId(receipt.logs);
    ticket.step = "match";
    window.localStorage.setItem(key, JSON.stringify(ticket));
  }
  if (ticket.step === "match") {
    const data = encodeFunctionData({
      abi: stockAbi,
      functionName: "openSpare",
      args: [from as Hex, ticket.hash, BigInt(ticket.expire), BigInt(ticket.out)],
    });
    if (payer.toLowerCase() === from.toLowerCase()) {
      const receipt = await sendTx(dest, from, GAS_STOCK[dest], data, 0n);
      ticket.destId = openedId(receipt.logs);
    } else {
      let hash: Hex;
      try {
        hash = await sendSafe(dest, SAFE[dest], from, data, GAS_STOCK[dest]);
      } catch (err) {
        if (err instanceof Error && err.message === "second") return "second";
        throw err;
      }
      const receipt = await wait(dest, hash);
      ticket.destId = openedId(receipt.logs);
    }
    ticket.step = "take";
    window.localStorage.setItem(key, JSON.stringify(ticket));
  }
  if (ticket.step === "take") {
    const data = encodeFunctionData({ abi: stockAbi, functionName: "fill", args: [BigInt(ticket.destId || "0"), ticket.secret] });
    await sendTx(dest, from, GAS_STOCK[dest], data, 0n);
    ticket.step = "settle";
    window.localStorage.setItem(key, JSON.stringify(ticket));
  }
  const data = encodeFunctionData({ abi: stockAbi, functionName: "fill", args: [BigInt(ticket.sourceId || "0"), ticket.secret] });
  await sendTx(source, from, GAS_STOCK[source], data, 0n);
  window.localStorage.removeItem(key);
  return "done";
}

type Ticket = {
  from: string;
  toBnb: boolean;
  gross: string;
  out: string;
  secret: Hex;
  hash: Hex;
  expire: string;
  maker: string;
  sourceId?: string;
  destId?: string;
  step: "lock" | "match" | "take" | "settle";
};

function openedId(logs: { data: Hex; topics: Hex[] }[]): string {
  for (const log of logs) {
    if ((log.topics[1] || "").length === 66 && log.topics.length >= 4) return BigInt(log.topics[1]).toString();
  }
  throw new Error("revert");
}

async function callStock<T>(chain: GasChain, name: "spare", args: readonly unknown[]): Promise<T> {
  const data = encodeFunctionData({ abi: stockAbi, functionName: name, args: args as never });
  let last = "revert";
  for (const url of RPC[chain]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: GAS_STOCK[chain], data }, "latest"] }),
      });
      const json = (await res.json()) as { result?: string };
      if (!json.result || json.result === "0x") continue;
      const { decodeFunctionResult } = await import("viem");
      return decodeFunctionResult({ abi: stockAbi, functionName: name, data: json.result as Hex }) as T;
    } catch {
      last = "revert";
    }
  }
  throw new Error(last);
}

async function sendTx(chain: GasChain, from: string, to: Hex, data: Hex, value: bigint): Promise<{ hash: Hex; logs: { data: Hex; topics: Hex[] }[] }> {
  await switchDeskChain(CHAIN_ID[chain]);
  const eth = await ensureProvider();
  const tx: { from: string; to: Hex; data: Hex; value?: Hex } = { from, to, data };
  if (value > 0n) tx.value = `0x${value.toString(16)}`;
  const hash = (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
  const receipt = await wait(chain, hash);
  return { hash, logs: receipt.logs };
}

export async function deployGasStock(chain: GasChain): Promise<string> {
  await switchDeskChain(CHAIN_ID[chain]);
  const eth = await ensureProvider();
  const rows = (await eth.request({ method: "eth_accounts" })) as string[];
  const from = rows?.[0];
  if (!from) throw new Error("nowallet");
  const safe = SAFE[chain];
  const args = encodeAbiParameters([{ type: "address" }], [safe]);
  const init = (GAS_STOCK_BYTECODE + args.slice(2)) as Hex;
  const data = createCallData(init);
  const hash = await sendSafe(chain, safe, from, data);
  const receipt = await wait(chain, hash);
  const landed = createdAddress(receipt.logs);
  window.localStorage.setItem(KEY[chain], landed);
  return landed;
}

async function sendSafe(chain: GasChain, safe: Hex, from: string, data: Hex, to: Hex = CREATE_CALL): Promise<Hex> {
  await switchDeskChain(CHAIN_ID[chain]);
  const who = from.toLowerCase();
  const owners = (await read<string[]>(chain, safe, "getOwners", [])).map((row) => row.toLowerCase());
  if (who === safe.toLowerCase()) {
    return send(from, to, data);
  }
  if (!owners.includes(who)) throw new Error("leader");
  const nonce = await read<bigint>(chain, safe, "nonce", []);
  const typed = hashTypedData({
    domain: { chainId: CHAIN_ID[chain], verifyingContract: safe },
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
    message: {
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
    },
  });
  const onchain = await read<Hex>(chain, safe, "getTransactionHash", [to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, nonce]);
  if (onchain.toLowerCase() !== typed.toLowerCase()) throw new Error("revert");
  const storeKey = `tapeliquid-gas-safe-${chain}-${nonce}-${typed}`;
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
          domain: { chainId: CHAIN_ID[chain], verifyingContract: safe },
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
  const call = encodeFunctionData({
    abi: safeAbi,
    functionName: "execTransaction",
    args: [to, 0n, data, 0, 0n, 0n, 0n, ZERO, ZERO, signatures],
  });
  return send(from, safe, call);
}

function normalizeSig(sig: string): Hex {
  const hex = (sig.startsWith("0x") ? sig : `0x${sig}`).toLowerCase();
  if (!/^0x[0-9a-f]{130}$/.test(hex)) throw new Error("revert");
  const v = Number.parseInt(hex.slice(-2), 16);
  const fixed = v < 27 ? v + 27 : v;
  return `${hex.slice(0, 130)}${fixed.toString(16).padStart(2, "0")}` as Hex;
}

async function send(from: string, to: Hex, data: Hex): Promise<Hex> {
  const eth = await ensureProvider();
  return (await eth.request({ method: "eth_sendTransaction", params: [{ from, to, data }] })) as Hex;
}

async function read<T>(chain: GasChain, to: Hex, name: string, args: readonly unknown[]): Promise<T> {
  const data = encodeFunctionData({ abi: safeAbi, functionName: name as "nonce", args: args as never });
  let last = "revert";
  for (const url of RPC[chain]) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    const json = (await res.json()) as { result?: string; error?: { message?: string } };
    if (!json.result || json.result === "0x") {
      last = json.error?.message || last;
      continue;
    }
    const { decodeFunctionResult } = await import("viem");
    return decodeFunctionResult({ abi: safeAbi, functionName: name as "nonce", data: json.result as Hex }) as T;
  }
  throw new Error(last);
}

async function wait(chain: GasChain, hash: Hex): Promise<{ logs: { data: Hex; topics: Hex[] }[] }> {
  for (const url of RPC[chain]) {
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
