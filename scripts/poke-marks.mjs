#!/usr/bin/env node
// Poke the capped marks about every 30 seconds.
// No key is stored here. Start it yourself:
//   POKE_KEY=0x... TAPE_MARK=0x... node scripts/poke-marks.mjs
// The page does not send this transaction.

import { createWalletClient, encodeFunctionData, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

const key = process.env.POKE_KEY ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set POKE_KEY to a hex private key. Nothing was poked.");
  process.exit(1);
}

const account = privateKeyToAccount(key);
const data = encodeFunctionData({
  abi: [{ name: "poke", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }],
  functionName: "poke",
});
const xlayer = {
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [process.env.XLAYER_RPC || "https://rpc.xlayer.tech"] } },
};

const jobs = [
  {
    name: "UP",
    chain: bsc,
    rpc: process.env.BSC_RPC || "https://bsc-dataseed.binance.org",
    to: "0x11dCaA2ee4A6F4c437B9B6B304FFBc09B768845B",
  },
];
if (/^0x[0-9a-fA-F]{40}$/.test(process.env.TAPE_MARK ?? "")) {
  jobs.push({
    name: "TAPE",
    chain: xlayer,
    rpc: process.env.XLAYER_RPC || "https://rpc.xlayer.tech",
    to: process.env.TAPE_MARK,
  });
}

async function once() {
  for (const job of jobs) {
    const wallet = createWalletClient({ account, chain: job.chain, transport: http(job.rpc) });
    try {
      const hash = await wallet.sendTransaction({ to: job.to, data, account, chain: job.chain });
      console.log(new Date().toISOString(), job.name, hash);
    } catch (err) {
      const msg = err instanceof Error ? err.shortMessage || err.message : "";
      console.log(new Date().toISOString(), job.name, /Early|Paused|already/i.test(msg) ? "skip" : "fail");
    }
  }
}

await once();
setInterval(() => {
  void once();
}, 30_000);
