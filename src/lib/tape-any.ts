import { createPublicClient, encodeFunctionData, formatEther, http, parseAbi, type Hex } from "viem";
import { bsc } from "viem/chains";
import { BSC, connectBsc, waitReceipt } from "@/lib/bsc";
import type { TapeTarget } from "@/lib/tape-targets";
import { getProvider } from "@/lib/wallet";
import { connectXLayer, DEPLOYED, rememberCircuit, XLAYER } from "@/lib/xlayer";
import { circuitTip } from "@/lib/circuit-tip";

const abi = parseAbi([
  "function tapeout(bytes netlist, uint32 nIn, uint32 nOut) payable returns (uint256)",
  "function TAPEOUT_FEE() view returns (uint256)",
  "function transistors() view returns (address)",
  "function nextId() view returns (uint256)",
  "function balanceOf(address,uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function circuitInfo(uint256) view returns (uint256 inputs, uint256 outputs, uint256 state, uint256 gates)",
]);

const bscClient = createPublicClient({ chain: bsc, transport: http(BSC.rpc) });
const xClient = createPublicClient({ transport: http(XLAYER.rpc) });

function reader(chain: TapeTarget["chain"]) {
  return chain === "bsc" ? bscClient : xClient;
}

export type TapeDesk = {
  nand: bigint;
  latch: bigint;
  fee: string;
  feeWei: bigint;
  native: bigint;
  total: number;
};

async function linked(target: TapeTarget): Promise<void> {
  const who = await reader(target.chain).readContract({
    address: target.circuits as Hex,
    abi,
    functionName: "transistors",
  });
  if (who.toLowerCase() !== target.transistors.toLowerCase()) throw new Error("locked");
}

export async function readTapeDesk(target: TapeTarget, account: string | null): Promise<TapeDesk> {
  const client = reader(target.chain);
  await linked(target);
  const [feeWei, next, nand, latch, native] = await Promise.all([
    client.readContract({ address: target.circuits as Hex, abi, functionName: "TAPEOUT_FEE" }),
    client.readContract({ address: target.circuits as Hex, abi, functionName: "nextId" }),
    account
      ? client.readContract({ address: target.transistors as Hex, abi, functionName: "balanceOf", args: [account as Hex, 0n] })
      : Promise.resolve(0n),
    account
      ? client.readContract({ address: target.transistors as Hex, abi, functionName: "balanceOf", args: [account as Hex, 1n] })
      : Promise.resolve(0n),
    account ? client.getBalance({ address: account as Hex }) : Promise.resolve(0n),
  ]);
  const tip = await circuitTip(client, target.circuits as Hex, Number(next));
  return { nand, latch, fee: formatEther(feeWei), feeWei, native, total: tip };
}

export async function readTapeRows(target: TapeTarget, limit = 8): Promise<{ id: string; nIn: string; nOut: string; gates: string; owner: string }[]> {
  const client = reader(target.chain);
  const next = await client.readContract({ address: target.circuits as Hex, abi, functionName: "nextId" });
  const last = await circuitTip(client, target.circuits as Hex, Number(next));
  if (last < 1) return [];
  const start = Math.max(1, last - limit + 1);
  const ids: number[] = [];
  for (let id = last; id >= start; id -= 1) ids.push(id);
  return Promise.all(ids.map(async (id) => {
    const [owner, info] = await Promise.all([
      client.readContract({ address: target.circuits as Hex, abi, functionName: "ownerOf", args: [BigInt(id)] }),
      client.readContract({ address: target.circuits as Hex, abi, functionName: "circuitInfo", args: [BigInt(id)] }),
    ]);
    return { id: String(id), nIn: info[0].toString(), nOut: info[1].toString(), gates: info[3].toString(), owner };
  }));
}

export type TapedOn = { hash: Hex; id: string; nIn: string; nOut: string; gates: string };

function mintedId(logs: readonly { address: string; topics: readonly `0x${string}`[] }[], circuits: string): string {
  const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const log = [...logs].reverse().find((row) => row.address.toLowerCase() === circuits.toLowerCase() && row.topics[0]?.toLowerCase() === topic && row.topics.length > 3);
  const id = log?.topics[3];
  return id ? BigInt(id).toString() : "";
}

/** Tape the selected processor. The circuit contract must point at the transistor contract from the official list. */
export async function tapeOn(target: TapeTarget, from: string, netlist: Hex, nIn: number, nOut: number): Promise<TapedOn> {
  if (nIn < 1 || nOut < 1) throw new Error("gates");
  const client = reader(target.chain);
  await linked(target);
  const fee = await client.readContract({ address: target.circuits as Hex, abi, functionName: "TAPEOUT_FEE" });
  const data = encodeFunctionData({ abi, functionName: "tapeout", args: [netlist, nIn, nOut] });
  await client.call({ account: from as Hex, to: target.circuits as Hex, data, value: fee });
  if (target.chain === "bsc") await connectBsc();
  else await connectXLayer();
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: target.circuits, data, value: `0x${fee.toString(16)}` }],
  })) as Hex;
  if (target.chain === "bsc") {
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "success") throw new Error("revert");
  } else {
    const receipt = await xClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error("revert");
    const id = mintedId(receipt.logs, target.circuits);
    const info = id
      ? await xClient.readContract({ address: target.circuits as Hex, abi, functionName: "circuitInfo", args: [BigInt(id)] })
      : null;
    const sheet = {
      hash,
      id,
      nIn: info ? info[0].toString() : String(nIn),
      nOut: info ? info[1].toString() : String(nOut),
      gates: info ? info[3].toString() : "",
    };
    if (id && target.circuits.toLowerCase() === DEPLOYED.circuits.toLowerCase()) rememberCircuit(from, sheet);
    return sheet;
  }
  return { hash, id: "", nIn: String(nIn), nOut: String(nOut), gates: "" };
}

export function tapeTxUrl(target: TapeTarget, hash: string): string {
  return target.chain === "bsc" ? `${BSC.explorer}/tx/${hash}` : `${XLAYER.explorer}/tx/${hash}`;
}

export function tapePage(target: TapeTarget): string {
  const chain = target.chain === "bsc" ? "bsc" : "xlayer";
  return `https://tapeout.net/#l2/${chain}/${target.circuits}`;
}
