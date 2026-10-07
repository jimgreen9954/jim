import { OFFICIAL, type OfficialBid, type OfficialBooks, type OfficialList } from "./official-books";

type RawBid = { id: number; buyer: string; transistors: string; tokenId: number; price: string; remaining: string };
type RawList = {
  id: number;
  seller: string;
  circuits: string;
  circuitId: string;
  price: string;
  valid?: boolean;
  revoked?: boolean;
  procName?: string;
  gateCount?: number;
  nIn?: number;
  nOut?: number;
};

function bnb(wei: string): number {
  const value = Number(wei);
  return Number.isFinite(value) ? value / 1e18 : 0;
}

export async function loadOfficialBooks(): Promise<OfficialBooks> {
  try {
    const [marketRes, circuitRes, cpuRes] = await Promise.all([
      fetch("https://tapeout.net/market.json", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000) }),
      fetch("https://tapeout.net/circuit-market.json", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) }),
      fetch("https://tapeout.net/processors.json", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) }),
    ]);
    if (!marketRes.ok) throw new Error(`market ${marketRes.status}`);
    if (!circuitRes.ok) throw new Error(`circuits ${circuitRes.status}`);
    const market = (await marketRes.json()) as { generatedAt?: string; lastBlock?: number; openBids?: RawBid[] };
    const circuits = (await circuitRes.json()) as { listings?: RawList[] };
    const names = new Map(OFFICIAL.chips.map((row) => [row.transistors.toLowerCase(), row.name]));
    if (cpuRes.ok) {
      const body = (await cpuRes.json()) as { cpus?: { transistors: string; name: string }[] };
      for (const cpu of body.cpus ?? []) names.set(cpu.transistors.toLowerCase(), cpu.name);
    }
    const bids: OfficialBid[] = [];
    for (const row of market.openBids ?? []) {
      const name = names.get(row.transistors.toLowerCase());
      if (!name) continue;
      if (row.tokenId !== 0 && row.tokenId !== 1) continue;
      const priceBnb = bnb(row.price);
      const remaining = Number(row.remaining);
      if (!(priceBnb > 0) || !(remaining > 0)) continue;
      bids.push({
        id: row.id,
        buyer: row.buyer,
        transistors: row.transistors,
        tokenId: row.tokenId,
        name,
        kind: row.tokenId === 0 ? "NAND" : "LATCH",
        priceBnb,
        priceWei: row.price,
        remaining,
      });
    }
    bids.sort((a, b) => b.priceBnb - a.priceBnb);
    const lists: OfficialList[] = [];
    for (const row of circuits.listings ?? []) {
      if (row.valid === false || row.revoked) continue;
      const priceBnb = bnb(row.price);
      if (!(priceBnb > 0)) continue;
      lists.push({
        id: row.id,
        seller: row.seller,
        circuits: row.circuits,
        circuitId: String(row.circuitId),
        name: row.procName || "—",
        priceBnb,
        priceWei: row.price,
        gates: Number(row.gateCount) || 0,
        nIn: Number(row.nIn) || 0,
        nOut: Number(row.nOut) || 0,
      });
      if (lists.length >= 40) break;
    }
    return { ok: true, error: null, asOf: market.generatedAt ?? null, block: market.lastBlock ?? null, bids, lists };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "feed", asOf: null, block: null, bids: [], lists: [] };
  }
}
