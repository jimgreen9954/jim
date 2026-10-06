import {
  createPublicClient,
  decodeEventLog,
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

const client = createPublicClient({ transport: http(XLAYER.rpc) });

export async function readDeployFee(): Promise<bigint> {
  return client.readContract({
    address: XLAYER.factory,
    abi,
    functionName: "deployFee",
  });
}

export function formatOkb(wei: bigint): string {
  return formatEther(wei);
}

async function ensureXLayer(): Promise<void> {
  const eth = ethereum();
  if (!eth) throw new Error("nowallet");
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: XLAYER.hex }] });
  } catch (err) {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (code === 4902 || message.includes("Unrecognized")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: XLAYER.hex,
            chainName: "X Layer",
            rpcUrls: [XLAYER.rpc],
            nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
            blockExplorerUrls: [XLAYER.explorer],
          },
        ],
      });
    } else {
      throw err;
    }
  }
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
  while (row.block < head) {
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

/** Personal chop: four inputs, one output, three NAND gates. */
export async function countSeal(owner: string): Promise<number> {
  const next = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "nextId",
  });
  const last = Number(next);
  let count = 0;
  const ids = Array.from({ length: Math.max(0, last - 1) }, (_, i) => BigInt(i + 1));
  for (let i = 0; i < ids.length; i += 8) {
    const slice = ids.slice(i, i + 8);
    const rows = await Promise.all(
      slice.map(async (id) => {
        try {
          const [who, info] = await Promise.all([
            client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf", args: [id] }),
            client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo", args: [id] }),
          ]);
          return who.toLowerCase() === owner.toLowerCase() && info[0] === 4n && info[1] === 1n && info[3] === 3n;
        } catch {
          return false;
        }
      }),
    );
    count += rows.filter(Boolean).length;
  }
  return count;
}

export async function sealIds(owner: string): Promise<bigint[]> {
  const next = await client.readContract({
    address: DEPLOYED.circuits,
    abi: circuitAbi,
    functionName: "nextId",
  });
  const last = Number(next);
  const found: bigint[] = [];
  const ids = Array.from({ length: Math.max(0, last - 1) }, (_, i) => BigInt(i + 1));
  for (let i = 0; i < ids.length && found.length < 3; i += 8) {
    const slice = ids.slice(i, i + 8);
    const rows = await Promise.all(
      slice.map(async (id) => {
        try {
          const [who, info] = await Promise.all([
            client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "ownerOf", args: [id] }),
            client.readContract({ address: DEPLOYED.circuits, abi: circuitAbi, functionName: "circuitInfo", args: [id] }),
          ]);
          return who.toLowerCase() === owner.toLowerCase() && info[0] === 4n && info[1] === 1n && info[3] === 3n ? id : null;
        } catch {
          return null;
        }
      }),
    );
    for (const id of rows) if (id != null) found.push(id);
  }
  return found.slice(0, 3);
}

export async function tapeSeal(from: string): Promise<Hex> {
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
  return hash;
}

