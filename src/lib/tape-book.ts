import { createServerFn } from "@tanstack/react-start";
import {
  encodeFunctionData,
  parseAbi,
  parseEther,
  verifyTypedData,
  type Hex,
} from "viem";
import { connectXLayer, txUrl } from "@/lib/xlayer";
import { getProvider } from "@/lib/wallet";

export const SEAPORT = "0x0000000000000068F116a894984e2DB1123eB395" as const;
export const TAPECODE = "0x0e91460d6823c711643e650a9a4c0cc21de41614" as const;
const RPC = "https://rpc.xlayer.tech";
const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
const FILE = "/workspace/data/tape-book.json";

const nftAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);
const seaAbi = parseAbi([
  "function getCounter(address) view returns (uint256)",
  "function fulfillOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, bytes signature) order, bytes32 fulfillerConduitKey) payable returns (bool)",
]);

const types = {
  OfferItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
  ],
  ConsiderationItem: [
    { name: "itemType", type: "uint8" },
    { name: "token", type: "address" },
    { name: "identifierOrCriteria", type: "uint256" },
    { name: "startAmount", type: "uint256" },
    { name: "endAmount", type: "uint256" },
    { name: "recipient", type: "address" },
  ],
  OrderComponents: [
    { name: "offerer", type: "address" },
    { name: "zone", type: "address" },
    { name: "offer", type: "OfferItem[]" },
    { name: "consideration", type: "ConsiderationItem[]" },
    { name: "orderType", type: "uint8" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "zoneHash", type: "bytes32" },
    { name: "salt", type: "uint256" },
    { name: "conduitKey", type: "bytes32" },
    { name: "counter", type: "uint256" },
  ],
} as const;

const domain = {
  name: "Seaport",
  version: "1.6",
  chainId: 196,
  verifyingContract: SEAPORT,
} as const;

export type BookOrder = {
  tokenId: string;
  offerer: string;
  price: string;
  salt: string;
  startTime: string;
  endTime: string;
  counter: string;
  signature: Hex;
};

function messageOf(order: BookOrder) {
  const price = BigInt(order.price);
  const tokenId = BigInt(order.tokenId);
  return {
    offerer: order.offerer as Hex,
    zone: "0x0000000000000000000000000000000000000000" as Hex,
    offer: [
      {
        itemType: 2,
        token: TAPECODE,
        identifierOrCriteria: tokenId,
        startAmount: 1n,
        endAmount: 1n,
      },
    ],
    consideration: [
      {
        itemType: 0,
        token: "0x0000000000000000000000000000000000000000" as Hex,
        identifierOrCriteria: 0n,
        startAmount: price,
        endAmount: price,
        recipient: order.offerer as Hex,
      },
    ],
    orderType: 0,
    startTime: BigInt(order.startTime),
    endTime: BigInt(order.endTime),
    zoneHash: ZERO,
    salt: BigInt(order.salt),
    conduitKey: ZERO,
    counter: BigInt(order.counter),
  };
}

async function rpc(to: string, data: string): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json()) as { result?: string };
  if (!body.result || body.result === "0x") throw new Error("rpc");
  return body.result;
}

async function ownerOf(tokenId: string): Promise<string> {
  const data = encodeFunctionData({ abi: nftAbi, functionName: "ownerOf", args: [BigInt(tokenId)] });
  const raw = await rpc(TAPECODE, data);
  return `0x${raw.slice(-40)}`.toLowerCase();
}

async function counterOf(account: string): Promise<string> {
  const data = encodeFunctionData({ abi: seaAbi, functionName: "getCounter", args: [account as Hex] });
  const raw = await rpc(SEAPORT, data);
  return BigInt(raw).toString();
}

function clean(order: BookOrder): BookOrder | null {
  if (!/^\d{1,12}$/.test(order.tokenId)) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(order.offerer)) return null;
  if (!/^\d+$/.test(order.price) || !/^\d+$/.test(order.salt)) return null;
  if (!/^\d+$/.test(order.startTime) || !/^\d+$/.test(order.endTime) || !/^\d+$/.test(order.counter)) return null;
  if (!/^0x[a-fA-F0-9]+$/.test(order.signature)) return null;
  const price = BigInt(order.price);
  if (price <= 0n || price > parseEther("1000")) return null;
  return { ...order, offerer: order.offerer.toLowerCase() };
}

async function readFile(): Promise<BookOrder[]> {
  try {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(FILE, "utf8");
    const parsed = JSON.parse(text) as BookOrder[];
    return Array.isArray(parsed) ? parsed.map(clean).filter((row): row is BookOrder => Boolean(row)) : [];
  } catch {
    return [];
  }
}

async function writeFile(rows: BookOrder[]) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir("/workspace/data", { recursive: true });
  await writeFile(FILE, JSON.stringify(rows));
}

async function stillGood(order: BookOrder): Promise<boolean> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (BigInt(order.endTime) <= now) return false;
  try {
    const [owner, counter] = await Promise.all([ownerOf(order.tokenId), counterOf(order.offerer)]);
    return owner === order.offerer.toLowerCase() && counter === order.counter;
  } catch {
    return false;
  }
}

export const getTapeBook = createServerFn({ method: "POST" }).handler(async (): Promise<BookOrder[]> => {
  const rows = await readFile();
  const kept: BookOrder[] = [];
  for (const row of rows) {
    if (await stillGood(row)) kept.push(row);
  }
  return kept;
});

export const saveTapeOrder = createServerFn({ method: "POST" })
  .validator((input: BookOrder) => {
    const row = clean(input);
    if (!row) throw new Error("order");
    return row;
  })
  .handler(async ({ data }) => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const start = BigInt(data.startTime);
    const end = BigInt(data.endTime);
    if (start > now + 3600n || end <= now || end - start > 30n * 24n * 60n * 60n) throw new Error("time");
    const [owner, counter] = await Promise.all([ownerOf(data.tokenId), counterOf(data.offerer)]);
    if (owner !== data.offerer.toLowerCase()) throw new Error("owner");
    if (counter !== data.counter) throw new Error("counter");
    const ok = await verifyTypedData({
      address: data.offerer as Hex,
      domain,
      types,
      primaryType: "OrderComponents",
      message: messageOf(data),
      signature: data.signature,
    });
    if (!ok) throw new Error("sig");
    const rows = (await readFile()).filter((row) => row.tokenId !== data.tokenId);
    rows.push(data);
    await writeFile(rows.slice(-80));
    return { ok: true };
  });

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}`, chainId: "0xc4" }],
  })) as Hex;
}

export async function listTapeOnSite(from: string, tokenId: string, priceOkb: string): Promise<void> {
  if (!/^\d{1,12}$/.test(tokenId)) throw new Error("order");
  const price = parseEther(priceOkb.trim());
  if (price <= 0n || price > parseEther("1000")) throw new Error("amount");
  await connectXLayer();
  const approvedData = encodeFunctionData({
    abi: nftAbi,
    functionName: "isApprovedForAll",
    args: [from as Hex, SEAPORT],
  });
  const approvedRaw = await rpc(TAPECODE, approvedData);
  if (BigInt(approvedRaw) === 0n) {
    const approve = encodeFunctionData({ abi: nftAbi, functionName: "setApprovalForAll", args: [SEAPORT, true] });
    const hash = await send(from, TAPECODE, approve);
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const res = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
      });
      const body = (await res.json()) as { result?: { status?: string } | null };
      if (body.result?.status === "0x0") throw new Error("revert");
      if (body.result?.status === "0x1") break;
    }
  }
  const counter = await counterOf(from);
  const now = Math.floor(Date.now() / 1000);
  const order: BookOrder = {
    tokenId,
    offerer: from.toLowerCase(),
    price: price.toString(),
    salt: `${now}${tokenId}`.slice(0, 20),
    startTime: String(now),
    endTime: String(now + 7 * 24 * 60 * 60),
    counter,
    signature: "0x",
  };
  const message = messageOf(order);
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const payload = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ...types,
    },
    primaryType: "OrderComponents",
    domain,
    message: {
      ...message,
      offer: message.offer.map((item) => ({ ...item, itemType: item.itemType, identifierOrCriteria: item.identifierOrCriteria.toString(), startAmount: item.startAmount.toString(), endAmount: item.endAmount.toString() })),
      consideration: message.consideration.map((item) => ({ ...item, identifierOrCriteria: item.identifierOrCriteria.toString(), startAmount: item.startAmount.toString(), endAmount: item.endAmount.toString() })),
      startTime: message.startTime.toString(),
      endTime: message.endTime.toString(),
      salt: message.salt.toString(),
      counter: message.counter.toString(),
    },
  };
  order.signature = (await eth.request({
    method: "eth_signTypedData_v4",
    params: [from, JSON.stringify(payload)],
  })) as Hex;
  await saveTapeOrder({ data: order });
}

export async function buyTapeOnSite(from: string, order: BookOrder): Promise<{ hash: Hex; url: string }> {
  await connectXLayer();
  const message = messageOf(order);
  const data = encodeFunctionData({
    abi: seaAbi,
    functionName: "fulfillOrder",
    args: [
      {
        parameters: {
          offerer: message.offerer,
          zone: message.zone,
          offer: message.offer,
          consideration: message.consideration,
          orderType: message.orderType,
          startTime: message.startTime,
          endTime: message.endTime,
          zoneHash: message.zoneHash,
          salt: message.salt,
          conduitKey: message.conduitKey,
          totalOriginalConsiderationItems: 1n,
        },
        signature: order.signature,
      },
      ZERO,
    ],
  });
  const hash = await send(from, SEAPORT, data, BigInt(order.price));
  return { hash, url: txUrl(hash) };
}

export function bookError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  if (/user rejected|denied|cancel/i.test(text)) return "你在钱包里取消了，没有成交。";
  if (text === "owner") return "这枚不在你的钱包里，不能挂。";
  if (text === "sig" || text === "counter" || text === "order") return "签名对不上，没有挂上去。";
  if (text === "amount") return "价格要写成大于 0、不超过 1000 OKB 的数字。";
  if (text === "nowallet") return "先连接钱包。";
  return text ? `没发出去：${text.slice(0, 140)}` : "没发出去。";
}
