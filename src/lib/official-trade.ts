import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { BSC, TxPending, connectBsc, waitOk } from "@/lib/bsc";
import { OFFICIAL } from "@/lib/official-books";
import type { CircuitSigned } from "@/lib/circuit-board";
import { getProvider } from "@/lib/wallet";

const client = createPublicClient({ transport: http(BSC.rpc) });

const bidAbi = parseAbi([
  "function bids(uint256) view returns (address buyer, address transistors, uint96 price, uint8 tokenId, uint16 feeBps, uint256 remaining)",
  "function fillBid(uint256 id, uint256 quantity)",
  "function placeBid(address transistors, uint8 tokenId, uint96 price, uint256 quantity) payable returns (uint256)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
]);

const listAbi = parseAbi(["function buy(uint256 id, uint96 expectedPrice) payable"]);
const signedAbi = parseAbi([
  "function fillSignedAsk((address maker, address collection, uint256 tokenId, uint256 nonce, uint128 price, uint64 expiry, address payoutRecipient, uint16 feeBps, uint16 schemaVersion) ask, bytes signature, address nftRecipient) payable",
]);
const signedAbiEpoch = parseAbi([
  "function fillSignedAsk((address maker, address collection, uint256 tokenId, uint256 nonce, uint128 price, uint64 expiry, address payoutRecipient, uint16 feeBps, uint256 feeEpoch, uint16 schemaVersion) ask, bytes signature, address nftRecipient) payable",
]);

const moveAbi = parseAbi([
  "function balanceOf(address,uint256) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function ownerOf(uint256) view returns (address)",
  "function transferFrom(address from, address to, uint256 tokenId)",
]);

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  await connectBsc();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

async function finish(hash: Hex): Promise<Hex> {
  try {
    await waitOk(hash);
    return hash;
  } catch (err) {
    if (err instanceof TxPending) throw err;
    throw new Error("revert");
  }
}

/** Eat an official bid. The bid is re-read on chain first. One signature, the official market only. */
export async function fillOfficialBid(from: string, id: bigint, quantity: bigint, transistors: string, priceWei: bigint): Promise<Hex> {
  if (quantity < 1n) throw new Error("amount");
  const row = await client.readContract({
    address: OFFICIAL.transistorMarket,
    abi: bidAbi,
    functionName: "bids",
    args: [id],
  });
  if (row[1].toLowerCase() !== transistors.toLowerCase() || row[2] !== priceWei) throw new Error("gone");
  if (row[5] < quantity) throw new Error("gone");
  const data = encodeFunctionData({ abi: bidAbi, functionName: "fillBid", args: [id, quantity] });
  const approved = await client.readContract({
    address: row[1],
    abi: bidAbi,
    functionName: "isApprovedForAll",
    args: [from as Hex, OFFICIAL.transistorMarket],
  });
  if (!approved) {
    const approve = encodeFunctionData({
      abi: bidAbi,
      functionName: "setApprovalForAll",
      args: [OFFICIAL.transistorMarket, true],
    });
    const approveHash = await send(from, row[1], approve);
    try {
      await waitOk(approveHash);
    } catch (err) {
      if (err instanceof TxPending) throw err;
      throw new Error("revert");
    }
  }
  await client.call({ account: from as Hex, to: OFFICIAL.transistorMarket, data });
  return finish(await send(from, OFFICIAL.transistorMarket, data));
}

/** Place a bid on a processor that is already in the official snapshot. */
export async function placeOfficialBid(from: string, transistors: Hex, tokenId: 0 | 1, priceWei: bigint, quantity: bigint): Promise<Hex> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(transistors)) throw new Error("locked");
  if (quantity < 1n || quantity > 10_000n || priceWei <= 0n) throw new Error("amount");
  const notional = priceWei * quantity;
  const data = encodeFunctionData({
    abi: bidAbi,
    functionName: "placeBid",
    args: [transistors, tokenId, priceWei, quantity],
  });
  await client.call({ account: from as Hex, to: OFFICIAL.transistorMarket, data, value: notional });
  return finish(await send(from, OFFICIAL.transistorMarket, data, notional));
}

/** Buy one official circuit listing at the exact wei price from the snapshot. */
export async function buyOfficialCircuit(from: string, id: bigint, priceWei: bigint): Promise<Hex> {
  if (priceWei <= 0n) throw new Error("amount");
  const data = encodeFunctionData({ abi: listAbi, functionName: "buy", args: [id, priceWei] });
  await client.call({ account: from as Hex, to: OFFICIAL.circuitMarket, data, value: priceWei });
  return finish(await send(from, OFFICIAL.circuitMarket, data, priceWei));
}

/** Fill one signed circuit ask. The price in the signature is what the wallet pays. */
export async function fillSignedCircuit(from: string, ask: CircuitSigned): Promise<Hex> {
  const price = BigInt(ask.price);
  const value = BigInt(ask.buyerCost || ask.price);
  if (price <= 0n || value < price) throw new Error("amount");
  const common = {
    maker: ask.maker,
    collection: ask.collection,
    tokenId: BigInt(ask.tokenId),
    nonce: BigInt(ask.nonce),
    price,
    expiry: BigInt(ask.expiry),
    payoutRecipient: ask.payout,
    feeBps: ask.feeBps,
    schemaVersion: ask.schemaVersion,
  };
  const data = ask.feeEpoch
    ? encodeFunctionData({ abi: signedAbiEpoch, functionName: "fillSignedAsk", args: [{ ...common, feeEpoch: BigInt(ask.feeEpoch) }, ask.signature, from as Hex] })
    : encodeFunctionData({ abi: signedAbi, functionName: "fillSignedAsk", args: [common, ask.signature, from as Hex] });
  await client.call({ account: from as Hex, to: ask.exchange, data, value });
  return finish(await send(from, ask.exchange, data, value));
}

export const CAPACITY_EXCHANGE = "0x9273d46b77B67Ba9B24177C25EC25fcbADf27040" as Hex;

const capacityAbi = parseAbi([
  "function placeCapacityBid(uint256 dailyCapacityPriceWei, uint256 minCircuitH, uint256 maxCircuitH, address nftRecipient, address refundRecipient, uint16 expectedFeeBps) payable returns (uint256)",
  "function cancelCapacityBid(uint256 orderId)",
  "function acceptCapacityBid(uint256 orderId, address collection, uint256 tokenId, bytes32 minerKey, address proceedsRecipient, uint256 expectedDailyCapacityPriceWei, uint16 expectedFeeBps, uint256 minNetProceedsWei)",
  "function quoteCapacityBidFill(uint256 orderId, address collection, uint256 tokenId, bytes32 minerKey) view returns ((uint256 circuitH, uint256 estimated24hAtomic, uint256 grossPriceWei, uint256 takerFeeWei, uint256 netProceedsWei))",
]);

const circuitReadAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function isApprovedForAll(address account, address operator) view returns (bool)",
  "function setApprovalForAll(address operator, bool approved)",
  "function eval(uint256 id, bytes inputs) view returns (bytes)",
]);

const podKeyAbi = parseAbi(["function minerKey(address,uint256) pure returns (bytes32)"]);

export async function placeCapacityBid(from: string, priceWei: bigint, budgetWei: bigint, minH: bigint, maxH: bigint, feeBps: number): Promise<Hex> {
  if (priceWei <= 0n || budgetWei <= 0n) throw new Error("amount");
  if (maxH > 0n && minH > maxH) throw new Error("range");
  const data = encodeFunctionData({
    abi: capacityAbi,
    functionName: "placeCapacityBid",
    args: [priceWei, minH, maxH, from as Hex, from as Hex, feeBps],
  });
  await client.call({ account: from as Hex, to: CAPACITY_EXCHANGE, data, value: budgetWei });
  const hash = await send(from, CAPACITY_EXCHANGE, data, budgetWei);
  await waitOk(hash);
  return hash;
}

export async function cancelCapacityBid(from: string, orderId: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi: capacityAbi, functionName: "cancelCapacityBid", args: [orderId] });
  await client.call({ account: from as Hex, to: CAPACITY_EXCHANGE, data });
  const hash = await send(from, CAPACITY_EXCHANGE, data);
  await waitOk(hash);
  return hash;
}

export async function acceptCapacityBid(from: string, orderId: bigint, collection: Hex, tokenId: bigint, priceWei: bigint, feeBps: number): Promise<Hex> {
  const owner = await client.readContract({ address: collection, abi: circuitReadAbi, functionName: "ownerOf", args: [tokenId] });
  if (owner.toLowerCase() !== from.toLowerCase()) throw new Error("owner");
  const approved = await client.readContract({ address: collection, abi: circuitReadAbi, functionName: "isApprovedForAll", args: [from as Hex, CAPACITY_EXCHANGE] });
  if (!approved) {
    const allow = encodeFunctionData({ abi: circuitReadAbi, functionName: "setApprovalForAll", args: [CAPACITY_EXCHANGE, true] });
    await waitOk(await send(from, collection, allow));
  }
  const key = await client.readContract({ address: "0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46", abi: podKeyAbi, functionName: "minerKey", args: [collection, tokenId] });
  const quote = await client.readContract({
    address: CAPACITY_EXCHANGE,
    abi: capacityAbi,
    functionName: "quoteCapacityBidFill",
    args: [orderId, collection, tokenId, key],
  });
  if (quote.netProceedsWei <= 0n) throw new Error("quote");
  const data = encodeFunctionData({
    abi: capacityAbi,
    functionName: "acceptCapacityBid",
    args: [orderId, collection, tokenId, key, from as Hex, priceWei, feeBps, quote.netProceedsWei],
  });
  await client.call({ account: from as Hex, to: CAPACITY_EXCHANGE, data });
  const hash = await send(from, CAPACITY_EXCHANGE, data);
  await waitOk(hash);
  return hash;
}

export async function evalOwnedCircuit(from: string, collection: Hex, tokenId: bigint, input: Hex): Promise<"ok" | "bad"> {
  const owner = await client.readContract({ address: collection, abi: circuitReadAbi, functionName: "ownerOf", args: [tokenId] });
  if (owner.toLowerCase() !== from.toLowerCase()) throw new Error("owner");
  try {
    const out = await client.readContract({ address: collection, abi: circuitReadAbi, functionName: "eval", args: [tokenId, input] });
    return typeof out === "string" && out.startsWith("0x") ? "ok" : "bad";
  } catch {
    return "bad";
  }
}

function destOf(from: string, to: string): Hex {
  if (!/^0x[a-fA-F0-9]{40}$/.test(to)) throw new Error("address");
  if (to.toLowerCase() === from.toLowerCase()) throw new Error("self");
  return to as Hex;
}

/** Move NAND or LATCH on one official BSC transistor contract. */
export async function transferBscTransistor(from: string, token: Hex, id: 0 | 1, amount: bigint, to: string): Promise<Hex> {
  if (amount < 1n) throw new Error("amount");
  const dest = destOf(from, to);
  const held = await client.readContract({ address: token, abi: moveAbi, functionName: "balanceOf", args: [from as Hex, BigInt(id)] });
  if (held < amount) throw new Error("short");
  const data = encodeFunctionData({
    abi: moveAbi,
    functionName: "safeTransferFrom",
    args: [from as Hex, dest, BigInt(id), amount, "0x"],
  });
  await client.call({ account: from as Hex, to: token, data });
  const hash = await send(from, token, data);
  const receipt = await waitReceipt(hash);
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}

/** Move one official BSC circuit this wallet owns. */
export async function transferBscCircuit(from: string, token: Hex, id: bigint, to: string): Promise<Hex> {
  const dest = destOf(from, to);
  const who = await client.readContract({ address: token, abi: moveAbi, functionName: "ownerOf", args: [id] });
  if (who.toLowerCase() !== from.toLowerCase()) throw new Error("owner");
  const data = encodeFunctionData({ abi: moveAbi, functionName: "transferFrom", args: [from as Hex, dest, id] });
  await client.call({ account: from as Hex, to: token, data });
  const hash = await send(from, token, data);
  const receipt = await waitReceipt(hash);
  if (receipt.status !== "success") throw new Error("revert");
  return hash;
}
