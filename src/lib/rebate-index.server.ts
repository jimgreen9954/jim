import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createPublicClient, decodeEventLog, http, keccak256, toBytes, type Hex } from "viem";
import type { Invitee, RebateBook } from "./rebate-index";

const PERP = "0xce3511b6e909c9694826cfd5dbe434d457920eba" as const;
const BIRTH = 72_430_087n;
const FILE = "/workspace/data/rebate-index.json";
const STEP = 250n;
const client = createPublicClient({ transport: http("https://rpc.xlayer.tech") });

const posted = {
  name: "Posted",
  type: "event",
  inputs: [
    { name: "id", type: "uint256", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "long", type: "bool", indexed: false },
    { name: "margin", type: "uint256", indexed: false },
    { name: "lev", type: "uint16", indexed: false },
    { name: "price", type: "uint256", indexed: false },
  ],
} as const;
const cancelled = {
  name: "Cancelled",
  type: "event",
  inputs: [
    { name: "id", type: "uint256", indexed: true },
    { name: "user", type: "address", indexed: true },
    { name: "margin", type: "uint256", indexed: false },
  ],
} as const;
const matched = {
  name: "Matched",
  type: "event",
  inputs: [
    { name: "id", type: "uint256", indexed: true },
    { name: "quoteId", type: "uint256", indexed: true },
    { name: "long", type: "address", indexed: true },
    { name: "short", type: "address", indexed: false },
    { name: "base", type: "uint256", indexed: false },
    { name: "entry", type: "uint256", indexed: false },
    { name: "fee", type: "uint256", indexed: false },
  ],
} as const;
const dealAbi = [
  {
    name: "deals",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [
      { name: "long", type: "address" },
      { name: "short", type: "address" },
      { name: "marginL", type: "uint96" },
      { name: "marginS", type: "uint96" },
      { name: "base", type: "uint128" },
      { name: "entry", type: "uint128" },
      { name: "open", type: "bool" },
      { name: "levL", type: "uint16" },
      { name: "levS", type: "uint16" },
    ],
  },
  {
    name: "referrerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "codeOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

type Post = { user: string; margin: string; lev: number };
type Bind = { user: string; referrer: string; block: number };
type Fee = { id: string; user: string; referrer: string; margin: string; notional: string; reward: string };
type State = { next: string; posts: Record<string, Post>; binds: Bind[]; fees: Fee[]; gap: boolean };

const empty = (): State => ({ next: BIRTH.toString(), posts: {}, binds: [], fees: [], gap: false });
const BIND = keccak256(toBytes("bind(bytes32)")).slice(0, 10);
const zero = "0x0000000000000000000000000000000000000000";
let chain: Promise<void> = Promise.resolve();

async function load(): Promise<State> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as State;
  } catch {
    return empty();
  }
}

async function save(state: State) {
  await mkdir("/workspace/data", { recursive: true });
  await writeFile(FILE, JSON.stringify(state));
}

async function referrerAt(user: string, block: bigint): Promise<string> {
  return client.readContract({
    address: PERP,
    abi: dealAbi,
    functionName: "referrerOf",
    args: [user as Hex],
    blockNumber: block,
  });
}

function rewardOf(used: bigint, referred: boolean): bigint {
  const gross = (used * 2n) / 1000n;
  return referred ? (gross * 6n) / 100n : 0n;
}

async function scan(state: State, head: bigint) {
  let cursor = BigInt(state.next);
  const stop = cursor + STEP > head ? head : cursor + STEP;
  while (cursor <= stop) {
    const to = cursor + 99n > stop ? stop : cursor + 99n;
    const logs = await client.getLogs({ address: PERP, fromBlock: cursor, toBlock: to });
    const posts: { id: string; user: string; margin: bigint; lev: number; block: bigint }[] = [];
    const cancels: { id: string; user: string; block: bigint; tx: string }[] = [];
    const matches: { id: bigint; block: bigint; tx: string }[] = [];
    for (const log of logs) {
      const topic = (log.topics[0] ?? "").toLowerCase();
      try {
        if (topic === keccak256(toBytes("Posted(uint256,address,bool,uint256,uint16,uint256)"))) {
          const decoded = decodeEventLog({ abi: [posted], data: log.data, topics: log.topics });
          posts.push({
            id: decoded.args.id.toString(),
            user: decoded.args.user.toLowerCase(),
            margin: decoded.args.margin,
            lev: decoded.args.lev,
            block: log.blockNumber ?? cursor,
          });
        } else if (topic === keccak256(toBytes("Cancelled(uint256,address,uint256)"))) {
          const decoded = decodeEventLog({ abi: [cancelled], data: log.data, topics: log.topics });
          cancels.push({
            id: decoded.args.id.toString(),
            user: decoded.args.user.toLowerCase(),
            block: log.blockNumber ?? cursor,
            tx: log.transactionHash ?? `${log.blockNumber}`,
          });
        } else if (topic === keccak256(toBytes("Matched(uint256,uint256,address,address,uint256,uint256,uint256)"))) {
          const decoded = decodeEventLog({ abi: [matched], data: log.data, topics: log.topics });
          matches.push({ id: decoded.args.id, block: log.blockNumber ?? cursor, tx: log.transactionHash ?? `${log.blockNumber}` });
        }
      } catch {
        state.gap = true;
      }
    }
    for (const post of posts) state.posts[post.id] = { user: post.user, margin: post.margin.toString(), lev: post.lev };
    const blocks: bigint[] = [];
    for (let block = cursor; block <= to; block++) blocks.push(block);
    const bodies = [];
    for (let i = 0; i < blocks.length; i += 8) {
      const slice = blocks.slice(i, i + 8);
      bodies.push(...(await Promise.all(slice.map((block) => client.getBlock({ blockNumber: block, includeTransactions: true })))));
    }
    for (const body of bodies) {
      for (const tx of body.transactions) {
        if (typeof tx === "string" || (tx.to ?? "").toLowerCase() !== PERP.toLowerCase()) continue;
        const sel = tx.input.slice(0, 10).toLowerCase();
        if (sel !== BIND || tx.input.length < 74) continue;
        const code = `0x${tx.input.slice(10, 74)}` as Hex;
        const who = await client.readContract({
          address: PERP,
          abi: dealAbi,
          functionName: "codeOwner",
          args: [code],
          blockNumber: body.number,
        });
        if (who.toLowerCase() === zero) continue;
        const user = tx.from.toLowerCase();
        if (!state.binds.some((row) => row.user === user)) state.binds.push({ user, referrer: who.toLowerCase(), block: Number(body.number) });
      }
    }
    for (const row of cancels) {
      const post = state.posts[row.id];
      if (!post) {
        state.gap = true;
        continue;
      }
      const ref = (await referrerAt(row.user, row.block)).toLowerCase();
      if (ref === zero) continue;
      const margin = BigInt(post.margin);
      const id = `${row.tx}-${row.user}-cancel`;
      if (state.fees.some((fee) => fee.id === id)) continue;
      state.fees.push({
        id,
        user: row.user,
        referrer: ref,
        margin: margin.toString(),
        notional: (margin * BigInt(post.lev)).toString(),
        reward: rewardOf(margin, true).toString(),
      });
    }
    for (const row of matches) {
      const deal = await client.readContract({ address: PERP, abi: dealAbi, functionName: "deals", args: [row.id] });
      const sides = [
        { user: deal[0], lev: BigInt(deal[7]) },
        { user: deal[1], lev: BigInt(deal[8]) },
      ];
      const base = deal[4];
      const entry = deal[5];
      for (const side of sides) {
        if (side.lev === 0n) continue;
        const used = (base * entry) / (side.lev * 10n ** 18n);
        const ref = (await referrerAt(side.user, row.block)).toLowerCase();
        if (ref === zero) continue;
        const id = `${row.tx}-${side.user.toLowerCase()}-match`;
        if (state.fees.some((fee) => fee.id === id)) continue;
        state.fees.push({
          id,
          user: side.user.toLowerCase(),
          referrer: ref,
          margin: used.toString(),
          notional: ((base * entry) / 10n ** 18n).toString(),
          reward: rewardOf(used, true).toString(),
        });
      }
    }
    cursor = to + 1n;
    state.next = cursor.toString();
    await save(state);
  }
}

function book(state: State, account: string, head: bigint): RebateBook {
  const me = account.toLowerCase();
  const rows = new Map<string, { margin: bigint; notional: bigint; reward: bigint }>();
  for (const bind of state.binds) {
    if (bind.referrer !== me) continue;
    rows.set(bind.user, rows.get(bind.user) ?? { margin: 0n, notional: 0n, reward: 0n });
  }
  for (const fee of state.fees) {
    if (fee.referrer !== me) continue;
    const row = rows.get(fee.user) ?? { margin: 0n, notional: 0n, reward: 0n };
    row.margin += BigInt(fee.margin);
    row.notional += BigInt(fee.notional);
    row.reward += BigInt(fee.reward);
    rows.set(fee.user, row);
  }
  const invitees: Invitee[] = [...rows.entries()].map(([user, row]) => ({
    user,
    margin: row.margin.toString(),
    notional: row.notional.toString(),
    reward: row.reward.toString(),
  }));
  const counted = invitees.reduce((sum, row) => sum + BigInt(row.reward), 0n);
  const scanned = BigInt(state.next);
  return {
    live: !state.gap,
    caughtUp: !state.gap && scanned > head,
    head: head.toString(),
    scanned: state.next,
    invitees,
    counted: counted.toString(),
  };
}

export async function loadRebateBook(account: string): Promise<RebateBook> {
  const run = chain.then(async () => {
    const state = await load();
    const head = await client.getBlockNumber();
    if (BigInt(state.next) <= head) await scan(state, head);
    return book(await load(), account, head);
  });
  chain = run.then(() => undefined, () => undefined);
  return run;
}
