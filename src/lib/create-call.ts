import { decodeEventLog, encodeFunctionData, parseAbi, type Hex } from "viem";

export const CREATE_CALL = "0x9b35Af71d77eaf8d7e40252370304687390A1A52" as Hex;

const abi = parseAbi([
  "function performCreate(uint256 value, bytes deploymentData) returns (address newContract)",
  "event ContractCreation(address newContract)",
]);

export function createCallData(init: Hex): Hex {
  return encodeFunctionData({ abi, functionName: "performCreate", args: [0n, init] });
}

export function createdAddress(logs: readonly { data: Hex; topics: readonly Hex[] }[]): string {
  for (const log of logs) {
    try {
      if (log.topics.length === 0) continue;
      const ev = decodeEventLog({ abi, data: log.data, topics: [log.topics[0], ...log.topics.slice(1)] });
      if (ev.eventName === "ContractCreation") return ev.args.newContract;
    } catch {
      continue;
    }
  }
  throw new Error("revert");
}
