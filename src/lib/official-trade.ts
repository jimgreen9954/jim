import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { BSC, DESK_FEE_BPS, FEE_TO, connectBsc, waitReceipt } from "@/lib/bsc";
import { OFFICIAL } from "@/lib/official-books";
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

const moveAbi = parseAbi([
  "function balanceOf(address,uint256) view returns (uint256)",
  "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
  "function ownerOf(uint256) view returns (address)",
  "function transferFrom(address from, address to, uint256 tokenId)",
]);

function feeOf(notional: bigint): bigint {
  return (notional * BigInt(DESK_FEE_BPS)) / 10_000n;
}

async function send(from: string, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  await connectBsc();
  return (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data, value: `0x${value.toString(16)}` }],
  })) as Hex;
}

async function payFee(from: string, notional: bigint): Promise<void> {
  const fee = feeOf(notional);
  if (fee <= 0n) return;
  const hash = await send(from, FEE_TO, "0x", fee);
  const receipt = await waitReceipt(hash);
  if (receipt.status !== "success") throw new Error("fee-kept");
}

/** Eat an official bid. The bid is re-read on chain first. 0.2% is paid before the official fill. */
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
  const notional = row[2] * quantity;
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
    const approveReceipt = await waitReceipt(approveHash);
    if (approveReceipt.status !== "success") throw new Error("revert");
  }
  await client.call({ account: from as Hex, to: OFFICIAL.transistorMarket, data });
  await payFee(from, notional);
  try {
    const hash = await send(from, OFFICIAL.transistorMarket, data);
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "success") throw new Error("fee-kept");
    return hash;
  } catch (err) {
    if (err instanceof Error && err.message === "fee-kept") throw err;
    throw new Error("fee-kept");
  }
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
  await payFee(from, notional);
  try {
    const hash = await send(from, OFFICIAL.transistorMarket, data, notional);
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "success") throw new Error("fee-kept");
    return hash;
  } catch (err) {
    if (err instanceof Error && err.message === "fee-kept") throw err;
    throw new Error("fee-kept");
  }
}

/** Buy one official circuit listing at the exact wei price from the snapshot. */
export async function buyOfficialCircuit(from: string, id: bigint, priceWei: bigint): Promise<Hex> {
  if (priceWei <= 0n) throw new Error("amount");
  const data = encodeFunctionData({ abi: listAbi, functionName: "buy", args: [id, priceWei] });
  await client.call({ account: from as Hex, to: OFFICIAL.circuitMarket, data, value: priceWei });
  await payFee(from, priceWei);
  try {
    const hash = await send(from, OFFICIAL.circuitMarket, data, priceWei);
    const receipt = await waitReceipt(hash);
    if (receipt.status !== "success") throw new Error("fee-kept");
    return hash;
  } catch (err) {
    if (err instanceof Error && err.message === "fee-kept") throw err;
    throw new Error("fee-kept");
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
