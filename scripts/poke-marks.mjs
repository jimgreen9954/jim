#!/usr/bin/env node
// Poke the capped marks every 30 seconds, and watch the TAPE pool code.
// No key is stored here. The page does not send this transaction.
//   POKE_KEY=0x... node scripts/poke-marks.mjs
// Optional: POKE_ALERT_URL=https://... BSC_RPC=... XLAYER_RPC=... TAPE_MARK=0x...

import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

const key = process.env.POKE_KEY ?? "";
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error("Set POKE_KEY to a hex private key. Nothing was poked.");
  process.exit(1);
}

const account = privateKeyToAccount(key);
const pokeData = encodeFunctionData({
  abi: [{ name: "poke", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] }],
  functionName: "poke",
});
const guardAbi = [{ name: "guard", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] }];
const lastAbi = [{ name: "lastAt", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] }];
const xlayer = {
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: ["https://xlayer.drpc.org"] } },
};

const TAPE_POOL = "0x58eaD5b41Cfd3627791D439402dd65571c286484";
const TAPE_POOL_CODE = "0xf5e304a7d79711bb3c77a1380a0e2898ee40621ff46a14ad3456e205096f9fa9";
const uniq = (rows) => [...new Set(rows.filter(Boolean))];
const bscRpcs = uniq([process.env.BSC_RPC, "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org", "https://bsc.publicnode.com"]);
const xRpcs = uniq([process.env.XLAYER_RPC, "https://xlayer.drpc.org", "https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"]);

const jobs = [
  { name: "UP", chain: bsc, rpcs: bscRpcs, to: "0x11dCaA2ee4A6F4c437B9B6B304FFBc09B768845B" },
  {
    name: "TAPE",
    chain: xlayer,
    rpcs: xRpcs,
    to: /^0x[0-9a-fA-F]{40}$/.test(process.env.TAPE_MARK ?? "") ? process.env.TAPE_MARK : "0x86fA83c53DD77F1562543B62dFf839B7BcD0Ea99",
  },
];

const lastAlert = new Map();
const pausedSince = new Map();

async function alert(tag, text) {
  const now = Date.now();
  const line = `${new Date(now).toISOString()} ${text}`;
  console.error("ALERT", line);
  if (now - (lastAlert.get(tag) ?? 0) < 5 * 60 * 1000) return;
  lastAlert.set(tag, now);
  const url = process.env.POKE_ALERT_URL ?? "";
  if (!url) return;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: line }),
  }).catch(() => undefined);
}

async function tryRpcs(rpcs, run) {
  let last = "fail";
  for (const rpc of rpcs) {
    try {
      return await run(rpc);
    } catch (err) {
      last = err instanceof Error ? err.shortMessage || err.message : "fail";
    }
  }
  throw new Error(last);
}

async function poke(job) {
  const ready = await tryRpcs(job.rpcs, async (rpc) => {
    const client = createPublicClient({ chain: job.chain, transport: http(rpc, { timeout: 8_000 }) });
    const [last, block] = await Promise.all([
      client.readContract({ address: job.to, abi: lastAbi, functionName: "lastAt" }),
      client.getBlock({ blockTag: "latest" }),
    ]);
    return Number(block.timestamp) >= Number(last) + 30;
  }).catch(() => true);
  if (!ready) {
    console.log(new Date().toISOString(), job.name, "skip");
    return;
  }
  const hash = await tryRpcs(job.rpcs, (rpc) => {
    const wallet = createWalletClient({ account, chain: job.chain, transport: http(rpc, { timeout: 12_000 }) });
    return wallet.sendTransaction({ to: job.to, data: pokeData, account, chain: job.chain });
  });
  console.log(new Date().toISOString(), job.name, hash);
}

async function watch(job) {
  const guard = await tryRpcs(job.rpcs, async (rpc) => {
    const client = createPublicClient({ chain: job.chain, transport: http(rpc, { timeout: 8_000 }) });
    return client.readContract({ address: job.to, abi: guardAbi, functionName: "guard" });
  });
  if (guard) {
    pausedSince.delete(job.name);
    return;
  }
  const now = Date.now();
  if (!pausedSince.has(job.name)) pausedSince.set(job.name, now);
  const mins = Math.round((now - pausedSince.get(job.name)) / 60000);
  if (mins >= 5) await alert(`${job.name}-guard`, `${job.name} guard has been off for ${mins} min. Opens and liquidations are paused.`);
}

async function watchPool() {
  const code = await tryRpcs(xRpcs, (rpc) =>
    createPublicClient({ chain: xlayer, transport: http(rpc, { timeout: 8_000 }) }).getBytecode({ address: TAPE_POOL }),
  );
  const hash = code ? keccak256(code) : "";
  if (hash.toLowerCase() !== TAPE_POOL_CODE) {
    await alert("tape-pool", `TAPE pool code changed. Expected ${TAPE_POOL_CODE}, saw ${hash || "empty"}. Pause TAPE opens.`);
  }
}

async function once() {
  for (const job of jobs) {
    try {
      await poke(job);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fail";
      if (/Early|Paused|already|gap/i.test(msg)) console.log(new Date().toISOString(), job.name, "skip");
      else await alert(`${job.name}-poke`, `${job.name} poke failed: ${msg}`);
    }
    try {
      await watch(job);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fail";
      await alert(`${job.name}-read`, `${job.name} guard read failed: ${msg}`);
    }
  }
  try {
    await watchPool();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fail";
    await alert("tape-pool-read", `TAPE pool code read failed: ${msg}`);
  }
}

await once();
setInterval(() => {
  void once();
}, 30_000);
