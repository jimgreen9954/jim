export type PodMiner = {
  cpu: string;
  circuits: string;
  circuitId: number;
  taskId: number;
};

export type PodSnap = {
  at: string;
  miners: PodMiner[];
};

let fileCache: { at: number; owners: Record<string, PodMiner[]> ; generatedAt: string } | null = null;

export async function loadPodMiners(account: string): Promise<PodSnap> {
  if (!fileCache || Date.now() - fileCache.at > 60_000) {
    const res = await fetch("https://tapeout.net/pod/pod-miners.json", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`pod-miners ${res.status}`);
    const body = (await res.json()) as { generatedAt?: string; owners?: Record<string, PodMiner[]> };
    fileCache = { at: Date.now(), owners: body.owners ?? {}, generatedAt: body.generatedAt ?? "" };
  }
  const miners = fileCache.owners[account.toLowerCase()] ?? [];
  return { at: fileCache.generatedAt, miners };
}
