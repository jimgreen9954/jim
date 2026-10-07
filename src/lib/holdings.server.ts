import { createPublicClient, formatEther, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { BSC } from "./bsc";
import type { ChipRow, CircuitRow, Holdings } from "./holdings";
import { DEPLOYED, myCircuits, transistorHeld } from "./xlayer";

type Cpu = { address: string; transistors: string; name: string };

const erc1155 = parseAbi(["function balanceOf(address,uint256) view returns (uint256)"]);
const erc721 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
]);

let cpuCache: { at: number; rows: Cpu[] } | null = null;
const client = createPublicClient({ chain: bsc, transport: http(BSC.rpc) });

async function processors(): Promise<Cpu[]> {
  if (cpuCache && Date.now() - cpuCache.at < 60_000) return cpuCache.rows;
  const res = await fetch("https://tapeout.net/processors.json", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`processors ${res.status}`);
  const body = (await res.json()) as { cpus?: Cpu[] };
  const rows = (body.cpus ?? []).filter((row) => row.address && row.transistors && row.name);
  cpuCache = { at: Date.now(), rows };
  return rows;
}

const resultCache = new Map<string, { at: number; row: Holdings }>();

export async function loadHoldings(account: `0x${string}` | string): Promise<Holdings> {
  const key = account.toLowerCase();
  const hit = resultCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.row;
  const row = await readHoldings(account);
  if (row.ok) resultCache.set(key, { at: Date.now(), row });
  return row;
}

async function readHoldings(account: `0x${string}` | string): Promise<Holdings> {
  const owner = account as `0x${string}`;
  try {
    const [cpus, bnb, tape, mine, marketRes] = await Promise.all([
      processors(),
      client.getBalance({ address: owner }),
      transistorHeld(owner).catch(() => ({ nand: 0n, latch: 0n })),
      myCircuits(owner).catch(() => []),
      fetch("https://tapeout.net/circuit-market.json", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) }),
    ]);
    const listed = new Map<string, { name: string; price: string; gates: number }>();
    if (marketRes.ok) {
      const body = (await marketRes.json()) as { listings?: { seller: string; circuits: string; circuitId: string; price: string; valid?: boolean; revoked?: boolean; procName?: string; gateCount?: number }[] };
      for (const row of body.listings ?? []) {
        if (row.valid === false || row.revoked) continue;
        if (row.seller.toLowerCase() !== owner.toLowerCase()) continue;
        listed.set(`${row.circuits.toLowerCase()}:${row.circuitId}`, { name: row.procName || "—", price: row.price, gates: Number(row.gateCount) || 0 });
      }
    }
    const calls = cpus.flatMap((cpu) => [
      { address: cpu.transistors as `0x${string}`, abi: erc1155, functionName: "balanceOf" as const, args: [owner, 0n] as const },
      { address: cpu.transistors as `0x${string}`, abi: erc1155, functionName: "balanceOf" as const, args: [owner, 1n] as const },
      { address: cpu.address as `0x${string}`, abi: erc721, functionName: "balanceOf" as const, args: [owner] as const },
    ]);
    const read = await client.multicall({ contracts: calls, allowFailure: true, batchSize: 150 });
    const chips: ChipRow[] = [
      {
        chain: "xlayer",
        name: "TAPELIQUID",
        transistors: DEPLOYED.transistors,
        circuits: DEPLOYED.circuits,
        nand: tape.nand.toString(),
        latch: tape.latch.toString(),
        ours: true,
      },
    ];
    const circuits: CircuitRow[] = mine.map((row) => ({
      chain: "xlayer" as const,
      name: "TAPELIQUID",
      circuits: DEPLOYED.circuits,
      id: row.id,
      count: "1",
      listed: false,
      priceBnb: null,
    }));
    for (let index = 0; index < cpus.length; index += 1) {
      const cpu = cpus[index];
      const nand = read[index * 3];
      const latch = read[index * 3 + 1];
      const count = read[index * 3 + 2];
      const n = nand?.status === "success" ? nand.result : 0n;
      const l = latch?.status === "success" ? latch.result : 0n;
      const c = count?.status === "success" ? count.result : 0n;
      if (n > 0n || l > 0n) {
        chips.push({
          chain: "bsc",
          name: cpu.name,
          transistors: cpu.transistors,
          circuits: cpu.address,
          nand: n.toString(),
          latch: l.toString(),
          ours: false,
        });
      }
      if (c > 0n) {
        const cap = c > 40n ? 40n : c;
        let ids: string[] = [];
        try {
          ids = (await Promise.all(
            Array.from({ length: Number(cap) }, (_, i) =>
              client.readContract({
                address: cpu.address as `0x${string}`,
                abi: erc721,
                functionName: "tokenOfOwnerByIndex",
                args: [owner, BigInt(i)],
              }),
            ),
          )).map((id) => id.toString());
        } catch {
          ids = [];
        }
        if (ids.length === 0) {
          circuits.push({
            chain: "bsc",
            name: cpu.name,
            circuits: cpu.address,
            id: null,
            count: c.toString(),
            listed: false,
            priceBnb: null,
          });
        } else {
          for (const id of ids) {
            const hit = listed.get(`${cpu.address.toLowerCase()}:${id}`);
            circuits.push({
              chain: "bsc",
              name: cpu.name,
              circuits: cpu.address,
              id,
              count: "1",
              listed: Boolean(hit),
              priceBnb: hit && Number.isFinite(Number(hit.price)) ? Number(hit.price) / 1e18 : null,
            });
          }
          if (c > 40n) {
            circuits.push({
              chain: "bsc",
              name: cpu.name,
              circuits: cpu.address,
              id: null,
              count: (c - 40n).toString(),
              listed: false,
              priceBnb: null,
            });
          }
        }
      }
    }
    for (const [key, row] of listed) {
      const [circuitsAddr, id] = key.split(":");
      if (circuits.some((item) => item.circuits.toLowerCase() === circuitsAddr && item.id === id)) continue;
      const price = Number(row.price);
      circuits.push({
        chain: "bsc",
        name: row.name,
        circuits: circuitsAddr,
        id,
        count: "1",
        listed: true,
        priceBnb: Number.isFinite(price) ? price / 1e18 : null,
      });
    }
    chips.sort((a, b) => Number(b.ours) - Number(a.ours) || a.name.localeCompare(b.name));
    return {
      ok: true,
      error: null,
      asOf: new Date().toISOString(),
      scanned: cpus.length,
      bnb: formatEther(bnb),
      chips,
      circuits,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "read",
      asOf: "",
      scanned: 0,
      bnb: "0",
      chips: [],
      circuits: [],
    };
  }
}
