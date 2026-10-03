import type { Gate, Level, TransistorDesk } from "./transistor-market";

const RAIL = "https://api-tapeout.firsto.ai/v1/markets/rail?limit=20";

const WANTED: { transistors: string; name: string }[] = [
  { transistors: "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087", name: "TapeOut" },
  { transistors: "0xE2DfD802081C7a05341E20b6582b04b908e8550c", name: "Behemoth" },
  { transistors: "0x1d23Bf70ec6bAAD95f396Ea38f8A8415119dFDE6", name: "Genesis CPU" },
];

type Asset = {
  tokenId: number;
  symbol: string;
  referencePriceWei: string | null;
  referenceBidPriceWei: string | null;
  referenceAskPriceWei: string | null;
  estimatedMarketCapUsdMicros: string | null;
  rolling24h?: { referenceChangeBps?: string; volumeWei?: string };
};

type Market = { transistors: string; name: string; assets: Asset[] };
type Rail = { asOf?: string; markets?: Market[] };
type Book = { asOf?: string; bids?: { priceWei: string; remaining: string; maker: string }[]; asks?: { priceWei: string; remaining: string; maker: string }[] };

let cache: { at: number; rail: Rail } | null = null;

function bnb(wei: string | null | undefined): number {
  if (!wei) return 0;
  const value = Number(wei);
  return Number.isFinite(value) ? value / 1e18 : 0;
}

async function rail(): Promise<Rail> {
  if (cache && Date.now() - cache.at < 1000) return cache.rail;
  const res = await fetch(RAIL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`rail ${res.status}`);
  const body = (await res.json()) as Rail;
  cache = { at: Date.now(), rail: body };
  return body;
}

function gatesOf(body: Rail): Gate[] {
  const rows: Gate[] = [];
  for (const wanted of WANTED) {
    const market = (body.markets ?? []).find((row) => row.transistors.toLowerCase() === wanted.transistors.toLowerCase());
    for (const kind of ["NAND", "LATCH"] as const) {
      const asset = market?.assets.find((row) => row.symbol === kind);
      const price = bnb(asset?.referencePriceWei);
      rows.push({
        id: `${wanted.name}-${kind}`.toLowerCase().replace(/\s+/g, "-"),
        name: wanted.name,
        kind,
        tokenId: kind === "NAND" ? 0 : 1,
        transistors: wanted.transistors,
        price,
        bid: bnb(asset?.referenceBidPriceWei) || price,
        ask: bnb(asset?.referenceAskPriceWei) || price,
        changePct: Number(asset?.rolling24h?.referenceChangeBps ?? 0) / 100,
        volumeBnb: bnb(asset?.rolling24h?.volumeWei),
        capUsd: Number(asset?.estimatedMarketCapUsdMicros ?? 0) / 1e6,
      });
    }
  }
  return rows;
}

function levels(rows: { priceWei: string; remaining: string; maker: string }[] | undefined): Level[] {
  return (rows ?? []).slice(0, 8).map((row) => {
    const price = bnb(row.priceWei);
    const qty = Number(row.remaining) || 0;
    return { price, qty, total: price * qty, maker: row.maker };
  });
}

export async function loadTransistorDesk(token: string, id: number): Promise<TransistorDesk> {
  try {
    const body = await rail();
    const gates = gatesOf(body);
    const res = await fetch(`https://api-tapeout.firsto.ai/v1/book/${token}/${id}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`book ${res.status}`);
    const book = (await res.json()) as Book;
    return {
      ok: true,
      error: null,
      asOf: book.asOf ?? body.asOf ?? "",
      gates,
      bids: levels(book.bids),
      asks: levels(book.asks),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "feed", asOf: "", gates: [], bids: [], asks: [] };
  }
}
