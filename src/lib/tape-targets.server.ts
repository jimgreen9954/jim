import { OURS, type TapeTarget } from "./tape-targets";

let cache: { at: number; rows: TapeTarget[] } | null = null;

export async function loadTapeTargets(): Promise<TapeTarget[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.rows;
  const res = await fetch("https://tapeout.net/processors.json", {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`processors ${res.status}`);
  const body = (await res.json()) as { cpus?: { name?: string; address?: string; transistors?: string }[] };
  const official: TapeTarget[] = [];
  for (const row of body.cpus ?? []) {
    if (!row.name || !row.address || !row.transistors) continue;
    if (!/^0x[a-fA-F0-9]{40}$/.test(row.address) || !/^0x[a-fA-F0-9]{40}$/.test(row.transistors)) continue;
    official.push({
      chain: "bsc",
      name: row.name,
      circuits: row.address,
      transistors: row.transistors,
      ours: false,
    });
  }
  const rows = [OURS, ...official.filter((row) => row.circuits.toLowerCase() !== OURS.circuits.toLowerCase())];
  cache = { at: Date.now(), rows };
  return rows;
}
