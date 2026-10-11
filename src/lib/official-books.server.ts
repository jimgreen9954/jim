import { OFFICIAL, type OfficialBid, type OfficialBooks, type OfficialList, type OfficialTrade } from "./official-books";

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
  nState?: number;
  width?: number;
  eligible?: boolean;
};
type RawTrade = {
  id: string | number;
  buyer: string;
  seller: string;
  circuits: string;
  circuitId: string | number;
  price: string;
  ts: number;
  tx: string;
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
    const circuits = (await circuitRes.json()) as { listings?: RawList[]; trades?: RawTrade[]; vol24h?: string; volTotal?: string; maxId?: number };
    const names = new Map<string, string>(OFFICIAL.chips.map((row) => [row.transistors.toLowerCase(), row.name]));
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
    const sellers = new Set<string>();
    let listed = 0;
    for (const row of circuits.listings ?? []) {
      if (row.valid === false || row.revoked) continue;
      const priceBnb = bnb(row.price);
      if (!(priceBnb > 0)) continue;
      listed += 1;
      if (row.seller) sellers.add(row.seller.toLowerCase());
      if (lists.length >= 80) continue;
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
        nState: Number(row.nState) || 0,
        width: Number(row.width) || 0,
        eligible: row.eligible === true,
      });
    }
    const trades: OfficialTrade[] = (circuits.trades ?? []).slice(0, 240).map((row) => ({
      id: String(row.id),
      buyer: row.buyer,
      seller: row.seller,
      circuits: row.circuits,
      circuitId: String(row.circuitId),
      priceBnb: bnb(row.price),
      ts: Number(row.ts) || 0,
      tx: row.tx,
    }));
    return {
      ok: true,
      error: null,
      asOf: market.generatedAt ?? null,
      block: market.lastBlock ?? null,
      bids,
      lists,
      listed,
      sellers: sellers.size,
      maxId: Number(circuits.maxId) || 0,
      vol24h: bnb(circuits.vol24h ?? "0"),
      volTotal: bnb(circuits.volTotal ?? "0"),
      trades,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "feed", asOf: null, block: null, bids: [], lists: [], listed: 0, sellers: 0, maxId: 0, vol24h: 0, volTotal: 0, trades: [] };
  }
}
