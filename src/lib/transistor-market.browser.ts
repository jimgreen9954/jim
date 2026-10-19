export type Gate = {
  id: string;
  name: string;
  kind: "NAND" | "LATCH";
  tokenId: number;
  transistors: string;
  price: number;
  bid: number;
  ask: number;
  changePct: number;
  volumeBnb: number;
  capUsd: number;
};
export type Level = { price: number; qty: number; total: number; maker: string };
export type TransistorDesk = { ok: boolean; error: string | null; asOf: string; gates: Gate[]; bids: Level[]; asks: Level[] };

const WANTED: { transistors: string; name: string }[] = [
  { transistors: "0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087", name: "TapeOut" },
  { transistors: "0xE2DfD802081C7a05341E20b6582b04b908e8550c", name: "Behemoth" },
  { transistors: "0x1d23Bf70ec6bAAD95f396Ea38f8A8415119dFDE6", name: "Genesis CPU" },
];

function bnb(wei: string | null | undefined): number {
  if (!wei) return 0;
  const value = Number(wei);
  return Number.isFinite(value) ? value / 1e18 : 0;
}

export async function getTransistorDesk(input: { data: { token: string; id: number } }): Promise<TransistorDesk> {
  try {
    const rail = await fetch("https://api-tapeout.firsto.ai/v1/markets/rail?limit=20", { headers: { accept: "application/json" } });
    if (!rail.ok) throw new Error(`rail ${rail.status}`);
    const body = (await rail.json()) as { asOf?: string; markets?: { transistors: string; assets: { tokenId: number; symbol: string; referencePriceWei: string | null; referenceBidPriceWei: string | null; referenceAskPriceWei: string | null; estimatedMarketCapUsdMicros: string | null; rolling24h?: { referenceChangeBps?: string; volumeWei?: string } }[] }[] };
    const gates: Gate[] = [];
    for (const wanted of WANTED) {
      const market = (body.markets ?? []).find((row) => row.transistors.toLowerCase() === wanted.transistors.toLowerCase());
      for (const kind of ["NAND", "LATCH"] as const) {
        const asset = market?.assets.find((row) => row.symbol === kind);
        const price = bnb(asset?.referencePriceWei);
        gates.push({
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
    const bookRes = await fetch(`https://api-tapeout.firsto.ai/v1/book/${input.data.token}/${input.data.id}`, { headers: { accept: "application/json" } });
    if (!bookRes.ok) throw new Error(`book ${bookRes.status}`);
    const book = (await bookRes.json()) as { asOf?: string; bids?: { priceWei: string; remaining: string; maker: string }[]; asks?: { priceWei: string; remaining: string; maker: string }[] };
    const levels = (rows: { priceWei: string; remaining: string; maker: string }[] | undefined): Level[] =>
      (rows ?? []).slice(0, 8).map((row) => {
        const price = bnb(row.priceWei);
        const qty = Number(row.remaining) || 0;
        return { price, qty, total: price * qty, maker: row.maker };
      });
    return { ok: true, error: null, asOf: book.asOf ?? body.asOf ?? "", gates, bids: levels(book.bids), asks: levels(book.asks) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "feed", asOf: "", gates: [], bids: [], asks: [] };
  }
}
