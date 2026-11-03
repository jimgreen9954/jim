import { decodeEventLog, encodeFunctionData, getAddress, keccak256, parseAbi, toHex, type Hex } from "viem";

export const CREATE_CALL = "0x9b35Af71d77eaf8d7e40252370304687390A1A52" as Hex;

const abi = parseAbi([
  "function performCreate(uint256 value, bytes deploymentData) returns (address newContract)",
  "event ContractCreation(address indexed newContract)",
]);

const CREATION_TOPIC = keccak256(toHex("ContractCreation(address)"));

export function createCallData(init: Hex): Hex {
  return encodeFunctionData({ abi, functionName: "performCreate", args: [0n, init] });
}

export function createdAddress(logs: readonly { data: Hex; topics: readonly Hex[] }[]): string {
  for (const log of logs) {
    if (!log.topics.length || log.topics[0].toLowerCase() !== CREATION_TOPIC) continue;
    const indexed = log.topics[1];
    if (indexed && indexed.length === 66) return getAddress(`0x${indexed.slice(26)}`);
    try {
      const ev = decodeEventLog({
        abi,
        data: log.data,
        topics: [log.topics[0], ...log.topics.slice(1)] as [Hex, ...Hex[]],
      });
      if (ev.eventName === "ContractCreation") return ev.args.newContract;
    } catch {
      continue;
    }
  }
  throw new Error("revert");
}
