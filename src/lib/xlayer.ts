import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeFunctionData,
  formatEther,
  http,
  parseEther,
  toHex,
  type Hex,
} from "viem";

export const XLAYER = {
  chainId: 196,
  hex: "0xc4",
  name: "X Layer",
  rpc: "https://rpc.xlayer.tech",
  explorer: "https://www.oklink.com/xlayer",
  factory: "0x1f09daefa827f02cbb40967cc91b259763760761" as const,
  create: "https://tapeout.net/#create/xlayer",
  supply: 2_100_000n,
  minPrice: "0.000066",
  defaultPrice: "0.00066",
  feeOkb: "0.0066",
};

const abi = [
  {
    name: "createCPU",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "story", type: "string" },
      { name: "transistorSupply", type: "uint256" },
      { name: "mintPrice", type: "uint256" },
    ],
    outputs: [
      { name: "transistors", type: "address" },
      { name: "circuits", type: "address" },
    ],
  },
  {
    name: "deployFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "CPUCreated",
    type: "event",
    inputs: [
      { name: "circuits", type: "address", indexed: true },
      { name: "transistors", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "supply", type: "uint256", indexed: false },
      { name: "mintPrice", type: "uint256", indexed: false },
    ],
  },
] as const;

import { ensureProvider, getProvider, rememberAccount } from "@/lib/wallet";

export function hasWallet(): boolean {
  return Boolean(getProvider());
}

function ethereum() {
  return getProvider();
}

const xlayer = defineChain({
  id: XLAYER.chainId,
  name: XLAYER.name,
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER.rpc] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const client = createPublicClient({ chain: xlayer, transport: http(XLAYER.rpc, { batch: { batchSize: 40, wait: 16 }, timeout: 8_000 }) });

export async function readDeployFee(): Promise<bigint> {
  return client.readContract({
    address: XLAYER.factory,
    abi,
    functionName: "deployFee",
  });
}

export async function quoteGas(from: string, to: Hex, data: Hex): Promise<Hex | null> {
  try {
    const gas = await client.estimateGas({ account: from as Hex, to, data });
    return toHex((gas * 3n) / 2n);
  } catch {
    return null;
  }
}

function chainNumber(id: unknown): number {
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "bigint") return Number(id);
  if (id && typeof id === "object") {
    const row = id as { chainId?: unknown; result?: unknown };
    if (row.chainId != null) return chainNumber(row.chainId);
    if (row.result != null) return chainNumber(row.result);
  }
  const text = String(id ?? "").trim().toLowerCase();
  const body = text.startsWith("eip155:") ? text.slice(7) : text;
  if (!body) return 0;
  const parsed = Number.parseInt(body, body.startsWith("0x") ? 16 : 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function walletChain(): Promise<number> {
  const eth = ethereum();
  if (!eth) return 0;
  const id = await eth.request({ method: "eth_chainId" }).catch(() => null);
  const parsed = chainNumber(id);
  if (parsed) return parsed;
  const net = await eth.request({ method: "net_version" }).catch(() => null);
  return chainNumber(net);
}

async function onXLayer(): Promise<boolean> {
  return (await walletChain()) === XLAYER.chainId;
}

function chainError(seen: number): Error {
  return Object.assign(new Error("chain"), { chainId: seen || "" });
}

export function chainNote(zh: boolean, seen: string): string {
  const id = seen || (zh ? "未知" : "unknown");
  return zh
    ? `这个网页读到的链是 ${id}。电路在 X Layer，编号 196。币安里的 OKC / OKT 是 66，BSC 是 56，首页写成 OK 链也不算。要在打开本站的窗口里选 X Layer。`
    : `This page reads chain ${id}. Circuits are on X Layer, 196. OKC is 66 and BSC is 56. Choose X Layer in the window that has this site open.`;
}

async function ensureXLayer(): Promise<void> {
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  if (await onXLayer()) return;
  const add = {
    chainId: XLAYER.hex,
    chainName: "X Layer",
    rpcUrls: ["https://xlayerrpc.okx.com", XLAYER.rpc, "https://xlayer.drpc.org"],
    nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
    blockExplorerUrls: [XLAYER.explorer],
  };
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER.hex }] });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 4001) throw err;
    try {
      await eth.request({ method: "wallet_addEthereumChain", params: [add] });
    } catch (addErr) {
      if ((addErr as { code?: number }).code === 4001) throw addErr;
    }
    if (!(await onXLayer())) {
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER.hex }] });
      } catch (again) {
        if ((again as { code?: number }).code === 4001) throw again;
      }
    }
  }
  for (let i = 0; i < 8; i += 1) {
    if (await onXLayer()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw chainError(await walletChain());
}

export async function connectXLayer(): Promise<string> {
  const eth = await ensureProvider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  rememberAccount(next);
  await ensureXLayer();
  return next;
}

export async function deployProcessor(from: string, mintPrice: string): Promise<{ hash: Hex; circuits: string | null }> {
  const price = parseEther(mintPrice.trim());
  if (price < parseEther(XLAYER.minPrice)) throw new Error("minprice");
  const fee = await readDeployFee();
  const data = encodeFunctionData({
    abi,
    functionName: "createCPU",
    args: [
      "TAPELIQUID",
      "TAPE",
      "BEM spot and perpetual matched by a public NAND latch. Netlist is evalMatch.",
      XLAYER.supply,
      price,
    ],
  });
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  await ensureXLayer();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: XLAYER.factory, data, value: toHex(fee) }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  let circuits: string | null = null;
  if (receipt.status !== "success") throw new Error("revert");
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== XLAYER.factory.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (decoded.eventName === "CPUCreated") {
        circuits = decoded.args.circuits;
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { hash, circuits };
}

export function txUrl(hash: string): string {
  return `${XLAYER.explorer}/tx/${hash}`;
}

export const DEPLOYED = {
  circuits: "0x69F663931209096037474d7C20402232E5C762cA" as const,
  transistors: "0x3FA393d3081AcCff9E7989619B688235F6d3EE3F" as const,
};

const transistorAbi = [
  {
    name: "cpuName",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "supplyCap",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "minted",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "mintPrice",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "protocolFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "mint",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const circuitAbi = [
  {
    name: "nextId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "circuitInfo",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      { name: "inputs", type: "uint256" },
      { name: "outputs", type: "uint256" },
      { name: "state", type: "uint256" },
      { name: "gates", type: "uint256" },
    ],
  },
  {
    name: "TAPEOUT_FEE",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "tapeout",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "netlist", type: "bytes" },
      { name: "nIn", type: "uint32" },
      { name: "nOut", type: "uint32" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "eval",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "inputs", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

/** NAND(NAND(A,B), NAND(C,D)). Three NAND gates, no canvas buffers. */
export const SEAL_NETLIST =
  "0x000000020000030000000400000500000006000007" as Hex;

export type ProcessorStatus = {
  name: string;
  cap: string;
  minted: string;
  price: string;
  fee: string;
  circuits: string;
};

export async function readProcessor(): Promise<ProcessorStatus> {
  const [name, cap, minted, price, fee, nextId] = await Promise.all([
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "cpuName" }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "supplyCap" }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "minted" }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "mintPrice" }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "protocolFee" }),
    client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "nextId" }),
  ]);
  return {
    name,
    cap: cap.toString(),
    minted: minted.toString(),
    price: formatEther(price),
    fee: formatEther(fee),
    circuits: nextId.toString(),
  };
}

export function mintCost(price: string, fee: string, amount: bigint): string {
  return formatEther(parseEther(price) * amount + parseEther(fee));
}

export async function mintTransistor(from: string, id: 0 | 1, amount: bigint): Promise<Hex> {
  if (amount < 1n) throw new Error("amount");
  const [price, fee, minted, cap] = await Promise.all([
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "mintPrice" }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "protocolFee" }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "minted" }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "supplyCap" }),
  ]);
  if (minted + amount > cap) throw new Error("cap");
  const data = encodeFunctionData({ abi: transistorAbi, functionName: "mint", args: [BigInt(id), amount] });
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  await ensureXLayer();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: DEPLOYED.transistors, data, value: toHex(price * amount + fee) }],
  })) as Hex;
}

export async function mintNand(from: string, amount: bigint): Promise<Hex> {
  return mintTransistor(from, 0, amount);
}

export async function transistorHeld(owner: string): Promise<{ nand: bigint; latch: bigint }> {
  const [nand, latch] = await Promise.all([
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "balanceOf", args: [owner as Hex, 0n] }),
    client.readContract({ address: DEPLOYED.transistors, abi: transistorAbi, functionName: "balanceOf", args: [owner as Hex, 1n] }),
  ]);
  return { nand, latch };
}

let circuitIndex: { at: number; last: number; owners: Map<string, bigint[]> } | null = null;
let circuitFlight: Promise<{ at: number; last: number; owners: Map<string, bigint[]> }> | null = null;

async function ownedCircuits(): Promise<{ at: number; last: number; owners: Map<string, bigint[]> }> {
  const next = await client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "nextId" });
  const last = Number(next) - 1;
  if (circuitIndex && circuitIndex.last >= last && Date.now() - circuitIndex.at < 180_000) return circuitIndex;
  if (circuitFlight) return circuitFlight;
  const prior = circuitIndex && circuitIndex.last < last && Date.now() - circuitIndex.at < 180_000 ? circuitIndex : null;
  circuitFlight = (async () => {
    const owners = new Map<string, bigint[]>();
    if (prior) {
      for (const [who, ids] of prior.owners) owners.set(who, ids.slice());
    }
    const from = prior ? prior.last + 1 : 1;
    if (last >= from) {
      const ids = Array.from({ length: Math.min(last, 4000) - from + 1 }, (_, i) => BigInt(from + i));
      const jobs = [];
      for (let i = 0; i < ids.length; i += 400) {
        const slice = ids.slice(i, i + 400);
        jobs.push(client.multicall({
          contracts: slice.map((id) => ({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf" as const, args: [id] as const })),
          allowFailure: true,
        }).then((rows) => ({ slice, rows })));
      }
      const parts = await Promise.all(jobs);
      for (const { slice, rows } of parts) {
        rows.forEach((row, index) => {
          if (row.status !== "success" || typeof row.result !== "string") return;
          const who = row.result.toLowerCase();
          const list = owners.get(who) ?? [];
          list.push(slice[index]);
          owners.set(who, list);
        });
      }
    }
    circuitIndex = { at: Date.now(), last, owners };
    return circuitIndex;
  })().finally(() => {
    circuitFlight = null;
  });
  return circuitFlight;
}

export async function circuitShapes(ids: bigint[]): Promise<Map<string, { nIn: string; nOut: string; state: string; gates: string }>> {
  const out = new Map<string, { nIn: string; nOut: string; state: string; gates: string }>();
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const rows = await client.multicall({
      contracts: slice.map((id) => ({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo" as const, args: [id] as const })),
      allowFailure: true,
    });
    rows.forEach((row, index) => {
      if (row.status !== "success" || !Array.isArray(row.result)) return;
      const info = row.result as readonly [bigint, bigint, bigint, bigint];
      out.set(slice[index].toString(), { nIn: info[0].toString(), nOut: info[1].toString(), state: info[2].toString(), gates: info[3].toString() });
    });
  }
  return out;
}

const OWN_KEY = "tapeliquid-own-circuits";
const TASK_KEY = "tapeliquid-circuit-tasks";

function readOwn(): Record<string, { id: string; nIn: string; nOut: string; gates: string }[]> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(OWN_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, { id: string; nIn: string; nOut: string; gates: string }[]> : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberedCircuits(owner: string): { id: string; nIn: string; nOut: string; gates: string }[] {
  return readOwn()[owner.toLowerCase()] ?? [];
}

export function rememberCircuit(owner: string, row: { id: string; nIn: string; nOut: string; gates: string }) {
  if (!row.id || typeof localStorage === "undefined") return;
  const all = readOwn();
  const key = owner.toLowerCase();
  const list = all[key] ?? [];
  if (!list.some((item) => item.id === row.id)) list.unshift(row);
  all[key] = list.slice(0, 40);
  localStorage.setItem(OWN_KEY, JSON.stringify(all));
}

export type TapedSheet = { hash: Hex; id: string; nIn: string; nOut: string; gates: string };

function idFromLogs(logs: readonly { address: string; topics: readonly `0x${string}`[] }[]): string {
  const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const log = [...logs].reverse().find((row) => row.address.toLowerCase() === DEPLOYED.circuits.toLowerCase() && row.topics[0]?.toLowerCase() === topic && row.topics.length > 3);
  const id = log?.topics[3];
  return id ? BigInt(id).toString() : "";
}

async function sheetFromReceipt(from: string, hash: Hex, logs: readonly { address: string; topics: readonly `0x${string}`[] }[]): Promise<TapedSheet> {
  const id = idFromLogs(logs);
  if (!id) return { hash, id: "", nIn: "", nOut: "", gates: "" };
  const info = await client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo", args: [BigInt(id)] });
  const row = { hash, id, nIn: info[0].toString(), nOut: info[1].toString(), gates: info[3].toString() };
  rememberCircuit(from, row);
  return row;
}

export async function myCircuits(owner: string): Promise<{ id: string; gates: string; nIn: string; nOut: string }[]> {
  const known = rememberedCircuits(owner);
  const index = await ownedCircuits();
  const ids = index.owners.get(owner.toLowerCase()) ?? [];
  const found: { id: string; gates: string; nIn: string; nOut: string }[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const rows = await client.multicall({
      contracts: slice.map((id) => ({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo" as const, args: [id] as const })),
      allowFailure: true,
    });
    rows.forEach((row, index) => {
      if (row.status !== "success" || !Array.isArray(row.result)) return;
      const info = row.result as readonly [bigint, bigint, bigint, bigint];
      found.push({ id: slice[index].toString(), nIn: info[0].toString(), nOut: info[1].toString(), gates: info[3].toString() });
    });
  }
  const seen = new Set(found.map((row) => row.id));
  return [...known.filter((row) => !seen.has(row.id)), ...found];
}

const transferAbi = [
  {
    name: "safeTransferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "transferFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

function recipient(from: string, to: string): Hex {
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("address");
  if (to.toLowerCase() === from.toLowerCase()) throw new Error("self");
  if (to.toLowerCase() === "0x0000000000000000000000000000000000000000") throw new Error("address");
  return to as Hex;
}

/** Move this wallet's TAPELIQUID NAND or LATCH. The transistor contract is fixed. */
export async function transferTransistor(from: string, to: string, id: 0 | 1, amount: bigint): Promise<Hex> {
  if (amount < 1n) throw new Error("amount");
  const dest = recipient(from, to);
  const held = await transistorHeld(from);
  if ((id === 0 ? held.nand : held.latch) < amount) throw new Error("short");
  const data = encodeFunctionData({
    abi: transferAbi,
    functionName: "safeTransferFrom",
    args: [from as Hex, dest, BigInt(id), amount, "0x"],
  });
  await client.call({ account: from as Hex, to: DEPLOYED.transistors, data });
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  await ensureXLayer();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: DEPLOYED.transistors, data }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

/** Move one TAPELIQUID circuit this wallet owns. Official BSC circuits are not this function. */
export async function transferCircuit(from: string, to: string, id: bigint): Promise<Hex> {
  const dest = recipient(from, to);
  const who = await client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf", args: [id] });
  if (who.toLowerCase() !== from.toLowerCase()) throw new Error("owner");
  const data = encodeFunctionData({
    abi: transferAbi,
    functionName: "transferFrom",
    args: [from as Hex, dest, id],
  });
  await client.call({ account: from as Hex, to: DEPLOYED.circuits, data });
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  await ensureXLayer();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: DEPLOYED.circuits, data }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

export type KindSupply = {
  block: bigint;
  nandMint: bigint;
  latchMint: bigint;
  nandBurn: bigint;
  latchBurn: bigint;
};

const KIND_BASE: KindSupply = {
  block: 72499101n,
  nandMint: 388496n,
  latchMint: 97414n,
  nandBurn: 37194n,
  latchBurn: 0n,
};

const MINT_TOPIC = "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62";
const ZERO_TOPIC = `0x${"0".repeat(64)}`;
const KIND_KEY = "tapeliquid-kind-supply";

function loadKind(): KindSupply | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = JSON.parse(localStorage.getItem(KIND_KEY) || "");
    const row = {
      block: BigInt(raw.block),
      nandMint: BigInt(raw.nandMint),
      latchMint: BigInt(raw.latchMint),
      nandBurn: BigInt(raw.nandBurn),
      latchBurn: BigInt(raw.latchBurn),
    };
    if (row.block < KIND_BASE.block) return null;
    return row;
  } catch {
    return null;
  }
}

function saveKind(row: KindSupply) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(
    KIND_KEY,
    JSON.stringify({
      block: row.block.toString(),
      nandMint: row.nandMint.toString(),
      latchMint: row.latchMint.toString(),
      nandBurn: row.nandBurn.toString(),
      latchBurn: row.latchBurn.toString(),
    }),
  );
}

function addMintLog(row: KindSupply, log: { data: string; topics: string[] }): KindSupply {
  if (!log.data || log.data.length < 130) return row;
  const id = Number(BigInt(log.data.slice(0, 66)));
  const value = BigInt(`0x${log.data.slice(66, 130)}`);
  if (id !== 0 && id !== 1) return row;
  const next = { ...row };
  if (log.topics[2] === ZERO_TOPIC) {
    if (id === 0) next.nandMint += value;
    else next.latchMint += value;
  }
  if (log.topics[3] === ZERO_TOPIC) {
    if (id === 0) next.nandBurn += value;
    else next.latchBurn += value;
  }
  return next;
}

export async function catchKindSupply(onStep?: (row: KindSupply) => void): Promise<KindSupply> {
  let row = loadKind() ?? { ...KIND_BASE };
  onStep?.(row);
  const head = await client.getBlockNumber();
  const span = 100n;
  for (let round = 0; round < 8 && row.block < head; round += 1) {
    const from = row.block + 1n;
    const to = from + span - 1n > head ? head : from + span - 1n;
    const logs = (await client.request({
      method: "eth_getLogs",
      params: [
        {
          address: DEPLOYED.transistors,
          topics: [MINT_TOPIC],
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
        },
      ],
    })) as { data: string; topics: string[] }[];
    let next = { ...row, block: to };
    for (const log of logs) next = addMintLog(next, log);
    row = next;
    saveKind(row);
    onStep?.(row);
  }
  return row;
}

export function processorUrl(): string {
  return `https://tapeout.net/#l2/xlayer/${DEPLOYED.circuits}`;
}

export const CANVAS = "https://tapeout.net/#canvas";

async function sealHits(owner: string, limit: number): Promise<bigint[]> {
  const next = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "nextId",
  });
  const last = Number(next) - 1;
  if (last < 1) return [];
  const ids = Array.from({ length: last }, (_, i) => BigInt(i + 1));
  const found: bigint[] = [];
  for (let i = 0; i < ids.length && found.length < limit; i += 80) {
    const slice = ids.slice(i, i + 80);
    const rows = await client.multicall({
      contracts: slice.flatMap((id) => [
        { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf" as const, args: [id] as const },
        { address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo" as const, args: [id] as const },
      ]),
      allowFailure: true,
    });
    for (let j = 0; j < slice.length; j += 1) {
      const who = rows[j * 2];
      const info = rows[j * 2 + 1];
      if (who.status !== "success" || info.status !== "success") continue;
      const shape = info.result as readonly [bigint, bigint, bigint, bigint];
      if (String(who.result).toLowerCase() === owner.toLowerCase() && shape[0] === 4n && shape[1] === 1n && shape[3] === 3n) found.push(slice[j]);
    }
  }
  return found.slice(0, limit);
}

/** Personal chop: four inputs, one output, three NAND gates. */
export async function countSeal(owner: string): Promise<number> {
  return (await sealHits(owner, 260)).length;
}

export async function sealIds(owner: string): Promise<bigint[]> {
  return sealHits(owner, 3);
}

export const TAPE_SHEET = { nand: 18000, latch: 30000 } as const;

export function recipeNetlist(nand: number, latch: number): Hex {
  if (!Number.isInteger(nand) || !Number.isInteger(latch) || nand < 0 || latch < 0 || nand + latch < 1 || nand > 18000 || latch > 30000) {
    throw new Error("recipe");
  }
  const bytes: number[] = [];
  const id = (n: number) => bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  for (let i = 0; i < nand; i++) {
    bytes.push(0);
    id(2);
    id(3);
  }
  for (let i = 0; i < latch; i++) {
    bytes.push(1);
    id(2);
  }
  return `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Tape a NAND/LATCH recipe on this processor. Burns those transistors. It does not mine BEM. */
export async function tapeRecipe(from: string, nand: number, latch: number): Promise<TapedSheet> {
  const netlist = recipeNetlist(nand, latch);
  const fee = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "TAPEOUT_FEE",
  });
  const data = encodeFunctionData({
    abi: circuitAbi,
    functionName: "tapeout",
    args: [netlist, 2, 1],
  });
  await client.call({ account: from as Hex, to: DEPLOYED.circuits, data, value: fee });
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  await ensureXLayer();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: DEPLOYED.circuits, data, value: toHex(fee) }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return sheetFromReceipt(from, hash, receipt.logs);
}

export async function readOkb(account: string): Promise<bigint> {
  return client.getBalance({ address: account as Hex });
}

export async function readTapeFee(): Promise<string> {
  const fee = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "TAPEOUT_FEE",
  });
  return formatEther(fee);
}

export type ChainCircuit = {
  id: string;
  nIn: string;
  nOut: string;
  state: string;
  gates: string;
  owner: string;
};

export type CircuitCheck = "ok" | "bad";

function inputWord(nIn: number, mask: number): Hex {
  const bits = Math.max(nIn, 1);
  const bytes = new Uint8Array(Math.ceil(bits / 8));
  for (let i = 0; i < nIn && i < 24; i++) {
    if ((mask >> i) & 1) bytes[i >> 3] |= 1 << (i & 7);
  }
  return toHex(bytes);
}

function masksFor(nIn: number): number[] {
  if (nIn <= 0) return [0];
  if (nIn <= 5) return Array.from({ length: 2 ** nIn }, (_, i) => i);
  const width = Math.min(nIn, 12);
  const out = new Set<number>([0, (1 << width) - 1]);
  for (let i = 0; i < width; i++) out.add(1 << i);
  return [...out];
}

/** Run each circuit's own eval on chain. No wallet and no OKB. */
export async function checkCircuits(ids: string[]): Promise<Record<string, CircuitCheck>> {
  const unique = [...new Set(ids.filter((id) => /^\d+$/.test(id)))].slice(0, 16);
  const result: Record<string, CircuitCheck> = {};
  if (!unique.length) return result;
  let infos: { status: string; result?: readonly [bigint, bigint, bigint, bigint] }[];
  try {
    infos = await client.multicall({
      contracts: unique.map((id) => ({
        address: DEPLOYED.circuits,
        abi: circuitAbi,
        functionName: "circuitInfo" as const,
        args: [BigInt(id)] as const,
      })),
      allowFailure: true,
    }) as { status: string; result?: readonly [bigint, bigint, bigint, bigint] }[];
  } catch {
    unique.forEach((id) => { result[id] = "bad"; });
    return result;
  }
  const jobs: { id: string; data: Hex; minBytes: number }[] = [];
  unique.forEach((id, index) => {
    const row = infos[index];
    if (!row || row.status !== "success" || !row.result) {
      result[id] = "bad";
      return;
    }
    const nIn = Number(row.result[0]);
    const nOut = Number(row.result[1]);
    if (!Number.isFinite(nIn) || !Number.isFinite(nOut) || nIn > 64 || nOut > 256) {
      result[id] = "bad";
      return;
    }
    const minBytes = nOut <= 0 ? 0 : Math.ceil(nOut / 8);
    for (const mask of masksFor(nIn)) jobs.push({ id, data: inputWord(nIn, mask), minBytes });
  });
  const failed = new Set<string>();
  for (let cursor = 0; cursor < jobs.length; cursor += 48) {
    const slice = jobs.slice(cursor, cursor + 48);
    try {
      const calls = await client.multicall({
        contracts: slice.map((job) => ({
          address: DEPLOYED.circuits,
          abi: circuitAbi,
          functionName: "eval" as const,
          args: [BigInt(job.id), job.data] as const,
        })),
        allowFailure: true,
      });
      slice.forEach((job, index) => {
        const row = calls[index];
        if (!row || row.status !== "success") {
          failed.add(job.id);
          return;
        }
        const hex = row.result as Hex;
        const bytes = hex.startsWith("0x") ? (hex.length - 2) / 2 : 0;
        if (bytes < job.minBytes) failed.add(job.id);
      });
    } catch {
      slice.forEach((job) => failed.add(job.id));
    }
  }
  for (const id of unique) {
    if (result[id] === "bad") continue;
    result[id] = failed.has(id) ? "bad" : "ok";
  }
  return result;
}

const TASKS: { name: string; nIn: number; nOut: number; out: (mask: number) => number }[] = [
  { name: "AND", nIn: 2, nOut: 1, out: (mask) => ((mask & 1) && (mask & 2) ? 1 : 0) },
  { name: "NAND", nIn: 2, nOut: 1, out: (mask) => ((mask & 1) && (mask & 2) ? 0 : 1) },
  { name: "XOR", nIn: 2, nOut: 1, out: (mask) => (mask & 1) ^ ((mask >> 1) & 1) },
  { name: "XNOR", nIn: 2, nOut: 1, out: (mask) => ((mask & 1) ^ ((mask >> 1) & 1)) ^ 1 },
  { name: "XOR3", nIn: 3, nOut: 1, out: (mask) => (mask & 1) ^ ((mask >> 1) & 1) ^ ((mask >> 2) & 1) },
  {
    name: "Adder",
    nIn: 3,
    nOut: 2,
    out: (mask) => {
      const a = mask & 1;
      const b = (mask >> 1) & 1;
      const c = (mask >> 2) & 1;
      const sum = a ^ b ^ c;
      const carry = (a & b) | (a & c) | (b & c);
      return sum | (carry << 1);
    },
  },
];

function packedBits(hex: Hex, n: number): number {
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  let mask = 0;
  for (let i = 0; i < n; i += 1) {
    const byte = Number.parseInt(raw.slice((i >> 3) * 2, (i >> 3) * 2 + 2) || "0", 16);
    if ((byte >> (i & 7)) & 1) mask |= 1 << i;
  }
  return mask;
}

export function rememberedTasks(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(TASK_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, string> : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberTask(id: string, name: string) {
  if (typeof localStorage === "undefined") return;
  const all = rememberedTasks();
  all[id] = name;
  localStorage.setItem(TASK_KEY, JSON.stringify(all));
}

/** Compare one circuit with the public combinational tasks. A match is only a name in this browser. */
export async function matchCircuitTask(id: string): Promise<{ name: string } | null> {
  const info = await client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo", args: [BigInt(id)] });
  const nIn = Number(info[0]);
  const nOut = Number(info[1]);
  const state = Number(info[2]);
  if (state !== 0) return null;
  const task = TASKS.find((row) => row.nIn === nIn && row.nOut === nOut);
  if (!task) return null;
  const masks = Array.from({ length: 2 ** nIn }, (_, i) => i);
  const calls = await client.multicall({
    contracts: masks.map((mask) => ({
      address: DEPLOYED.circuits,
      abi: circuitAbi,
      functionName: "eval" as const,
      args: [BigInt(id), inputWord(nIn, mask)] as const,
    })),
    allowFailure: true,
  });
  for (let i = 0; i < masks.length; i += 1) {
    const row = calls[i];
    if (!row || row.status !== "success" || typeof row.result !== "string") return null;
    if (packedBits(row.result, nOut) !== task.out(masks[i])) return null;
  }
  return { name: task.name };
}

/** Latest taped circuits on this processor. The official project page reads the same contract. */
export async function readCircuits(limit = 12): Promise<{ total: number; rows: ChainCircuit[] }> {
  const next = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "nextId",
  });
  const last = Number(next) - 1;
  if (last < 1) return { total: 0, rows: [] };
  const start = Math.max(1, last - limit + 1);
  const ids: bigint[] = [];
  for (let id = last; id >= start; id -= 1) ids.push(BigInt(id));
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [who, info] = await Promise.all([
        client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf", args: [id] }),
        client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo", args: [id] }),
      ]);
      return {
        id: id.toString(),
        nIn: info[0].toString(),
        nOut: info[1].toString(),
        state: info[2].toString(),
        gates: info[3].toString(),
        owner: who,
      };
    }),
  );
  return { total: last, rows };
}

/** Tape whatever netlist the canvas compiled. Burns this processor's transistors. */
export async function tapeNetlist(from: string, netlist: Hex, nIn: number, nOut: number): Promise<TapedSheet> {
  const fee = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "TAPEOUT_FEE",
  });
  const data = encodeFunctionData({
    abi: circuitAbi,
    functionName: "tapeout",
    args: [netlist, nIn, nOut],
  });
  await client.call({ account: from as Hex, to: DEPLOYED.circuits, data, value: fee });
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  await ensureXLayer();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: DEPLOYED.circuits, data, value: toHex(fee) }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return sheetFromReceipt(from, hash, receipt.logs);
}

export async function tapeSeal(from: string): Promise<TapedSheet> {
  const fee = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "TAPEOUT_FEE",
  });
  const data = encodeFunctionData({
    abi: circuitAbi,
    functionName: "tapeout",
    args: [SEAL_NETLIST, 4, 1],
  });
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  await ensureXLayer();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: DEPLOYED.circuits, data, value: toHex(fee) }],
  })) as Hex;
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("revert");
  return sheetFromReceipt(from, hash, receipt.logs);
}

