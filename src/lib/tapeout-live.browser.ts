export type LivePrint = { ts: number; bnb: number; qty: number; bem: number | null };
export type LiveTransistor = {
  id: string;
  name: string;
  kind: "NAND" | "LATCH";
  lastBnb: number | null;
  lastTs: number;
  trades: number;
  qty: number;
  volBnb: number;
  trades24: number;
  qty24: number;
  volBnb24: number;
  bem: number | null;
  usd: number | null;
  bidBnb: number | null;
  bidBem: number | null;
  bidQty: number;
  prints: LivePrint[];
};
export type TapeoutLive = {
  ok: boolean;
  error: string | null;
  asOf: string | null;
  bem: { usd: number; change24: number | null; vol24: number; pair: string } | null;
  bnbUsd: number | null;
  pod: { miners: number; verified: number; dailyBem: number; block: number } | null;
  rows: LiveTransistor[];
  listed: number;
  traded: number;
  bidding: number;
};

const DEX = "https://api.dexscreener.com/latest/dex/tokens/0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a";
const BNB = "https://api.coinbase.com/v2/prices/BNB-USD/spot";
const PAIR = "https://dexscreener.com/bsc/0x3098d7a051045000d68ec0360753a40c8cabea31";

export async function getTapeoutLive(): Promise<TapeoutLive> {
  const blank: TapeoutLive = {
    ok: false,
    error: "行情接口没打开",
    asOf: null,
    bem: null,
    bnbUsd: null,
    pod: null,
    rows: [],
    listed: 0,
    traded: 0,
    bidding: 0,
  };
  try {
    const [dexRes, bnbRes] = await Promise.all([fetch(DEX), fetch(BNB)]);
    const dex = (await dexRes.json()) as { pairs?: { priceUsd?: string; priceChange?: { h24?: number }; volume?: { h24?: number }; liquidity?: { usd?: number } }[] };
    const bnb = (await bnbRes.json()) as { data?: { amount?: string } };
    const pair = [...(dex.pairs ?? [])].sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0))[0];
    const usd = Number(pair?.priceUsd);
    return {
      ...blank,
      ok: Number.isFinite(usd) && usd > 0,
      error: null,
      asOf: new Date().toISOString(),
      bem: Number.isFinite(usd) && usd > 0 ? { usd, change24: pair?.priceChange?.h24 ?? null, vol24: Number(pair?.volume?.h24 ?? 0), pair: PAIR } : null,
      bnbUsd: Number(bnb.data?.amount) || null,
    };
  } catch {
    return blank;
  }
}
