import type { LiveTransistor, TapeoutLive } from "./tapeout-live";

const MARKET = "https://tapeout.net/market.json";
const POD = "https://tapeout.net/pod/pod-stats.json";
const BEM_TOKEN = "0x5ce033b2bfca3af30b3e8c8457deaf776a8b695a";
const GECKO = `https://api.geckoterminal.com/api/v2/networks/bsc/tokens/${BEM_TOKEN}`;
const BNB = "https://api.coinbase.com/v2/prices/BNB-USD/spot";
const PAIR = "https://dexscreener.com/bsc/0x3098d7a051045000d68ec0360753a40c8cabea31";

const DEX = `https://api.dexscreener.com/latest/dex/tokens/${BEM_TOKEN}`;

type Trade = { ts: number; price: string; qty: string };
type Token = { transistors: string; tokenId: number; name: string; processor: string };
type Bid = { transistors: string; tokenId: number; price: string; remaining: string };
type MarketFile = {
  generatedAt?: string;
  tokens?: Token[];
  tradesByKey?: Record<string, Trade[]>;
  openBids?: Bid[];
};
type GeckoBody = {
  data?: { attributes?: { price_usd?: string; volume_usd?: { h24?: string } } };
};
type DexPair = {
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
};
type DexBody = { pairs?: DexPair[] };
type PodBody = {
  block?: number;
  minerCount?: number;
  verifMinerCount?: number;
  currentRate?: string;
};

let cache: { at: number; ttl: number; data: TapeoutLive } | null = null;

function weiBnb(wei: bigint): number {
  const micro = wei / 10n ** 12n;
  return Number(micro) / 1e6;
}

async function grab<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { accept: "application/json", "user-agent": "TAPELIQUID/1.0" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

function empty(error: string | null): TapeoutLive {
  return {
    ok: false,
    error,
    asOf: null,
    bem: null,
    bnbUsd: null,
    pod: null,
    rows: [],
    listed: 0,
    traded: 0,
    bidding: 0,
  };
}

function quoteBem(gecko: GeckoBody | null, dex: DexBody | null): TapeoutLive["bem"] {
  let usd = 0;
  let vol24 = 0;
  let change24: number | null = null;
  const g = Number(gecko?.data?.attributes?.price_usd);
  const gv = Number(gecko?.data?.attributes?.volume_usd?.h24);
  if (Number.isFinite(g) && g > 0) usd = g;
  if (Number.isFinite(gv) && gv >= 0) vol24 = gv;

  const pairs = [...(dex?.pairs ?? [])].sort(
    (a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0),
  );
  const best = pairs[0];
  if (best) {
    const px = Number(best.priceUsd);
    if (!(usd > 0) && Number.isFinite(px) && px > 0) usd = px;
    const ch = best.priceChange?.h24;
    if (typeof ch === "number" && Number.isFinite(ch)) change24 = ch / 100;
    if (!(vol24 > 0)) {
      const sum = pairs.reduce((s, row) => s + (Number(row.volume?.h24) || 0), 0);
      if (sum > 0) vol24 = sum;
    }
  }
  if (!(usd > 0)) return null;
  return { usd, change24, vol24, pair: PAIR };
}

function quoteToken(bnbPx: number | null, bnbUsd: number | null, bemUsd: number | null) {
  if (bnbPx == null || bnbUsd == null) return { usd: null as number | null, bem: null as number | null };
  const usd = bnbPx * bnbUsd;
  return { usd, bem: bemUsd != null && bemUsd > 0 ? usd / bemUsd : null };
}

type Bucket = {
  id: string;
  name: string;
  tokenId: number;
  lastTs: number;
  lastWei: bigint;
  sawTrade: boolean;
  vol: bigint;
  vol24: bigint;
  qty: number;
  qty24: number;
  trades: number;
  trades24: number;
  rawPrints: { ts: number; wei: bigint; qty: number }[];
  bidWei: bigint;
  bidQty: number;
};

export async function loadTapeoutLive(): Promise<TapeoutLive> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.data;

  const [marketR, geckoR, dexR, bnbR, podR] = await Promise.allSettled([
    grab<MarketFile>(MARKET),
    grab<GeckoBody>(GECKO),
    grab<DexBody>(DEX),
    grab<{ data?: { amount?: string } }>(BNB),
    grab<PodBody>(POD),
  ]);

  if (marketR.status !== "fulfilled") {
    return empty(marketR.reason instanceof Error ? marketR.reason.message : "market.json failed");
  }

  const market = marketR.value;
  const bem = quoteBem(
    geckoR.status === "fulfilled" ? geckoR.value : null,
    dexR.status === "fulfilled" ? dexR.value : null,
  );

  let bnbUsd: number | null = null;
  if (bnbR.status === "fulfilled") {
    const n = Number(bnbR.value.data?.amount);
    if (Number.isFinite(n) && n > 0) bnbUsd = n;
  }

  let pod: TapeoutLive["pod"] = null;
  if (podR.status === "fulfilled") {
    const rate = Number(podR.value.currentRate);
    pod = {
      miners: Number(podR.value.minerCount ?? 0),
      verified: Number(podR.value.verifMinerCount ?? 0),
      dailyBem: Number.isFinite(rate) ? (rate / 1e8) * 86400 : 0,
      block: Number(podR.value.block ?? 0),
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const day = now - 86400;
  const meta = new Map<string, { name: string; tokenId: number }>();
  for (const token of market.tokens ?? []) {
    const key = `${token.transistors.toLowerCase()}-${token.tokenId}`;
    if (!meta.has(key)) meta.set(key, { name: token.name || "—", tokenId: token.tokenId });
  }

  const bemUsd = bem?.usd ?? null;
  const buckets = new Map<string, Bucket>();
  const bucket = (rawKey: string): Bucket => {
    const id = rawKey.toLowerCase();
    const hit = buckets.get(id);
    if (hit) return hit;
    const tokenId = Number(id.slice(id.lastIndexOf("-") + 1));
    const info = meta.get(id);
    const next: Bucket = {
      id,
      name: info?.name ?? id.slice(0, 8),
      tokenId,
      lastTs: 0,
      lastWei: 0n,
      sawTrade: false,
      vol: 0n,
      vol24: 0n,
      qty: 0,
      qty24: 0,
      trades: 0,
      trades24: 0,
      rawPrints: [],
      bidWei: 0n,
      bidQty: 0,
    };
    buckets.set(id, next);
    return next;
  };

  for (const [key, trades] of Object.entries(market.tradesByKey ?? {})) {
    if (!Array.isArray(trades) || trades.length === 0) continue;
    const acc = bucket(key);
    for (const trade of trades) {
      let price: bigint;
      let q: bigint;
      try {
        price = BigInt(trade.price);
        q = BigInt(trade.qty);
      } catch {
        continue;
      }
      acc.sawTrade = true;
      acc.trades += 1;
      acc.vol += price * q;
      acc.qty += Number(q);
      acc.rawPrints.push({ ts: trade.ts, wei: price, qty: Number(q) });
      if (trade.ts >= acc.lastTs) {
        acc.lastTs = trade.ts;
        acc.lastWei = price;
      }
      if (trade.ts >= day) {
        acc.vol24 += price * q;
        acc.qty24 += Number(q);
        acc.trades24 += 1;
      }
    }
  }

  for (const bid of market.openBids ?? []) {
    let price: bigint;
    let rem: bigint;
    try {
      price = BigInt(bid.price);
      rem = BigInt(bid.remaining);
    } catch {
      continue;
    }
    if (price <= 0n || rem <= 0n) continue;
    const acc = bucket(`${bid.transistors}-${bid.tokenId}`);
    if (price > acc.bidWei) {
      acc.bidWei = price;
      acc.bidQty = Number(rem);
    } else if (price === acc.bidWei) {
      acc.bidQty += Number(rem);
    }
  }

  const rows: LiveTransistor[] = [];
  for (const acc of buckets.values()) {
    if (!acc.sawTrade && acc.bidWei <= 0n) continue;
    const lastBnb = acc.sawTrade ? weiBnb(acc.lastWei) : null;
    const lastQuote = quoteToken(lastBnb, bnbUsd, bemUsd);
    const bidBnb = acc.bidWei > 0n ? weiBnb(acc.bidWei) : null;
    const bidQuote = quoteToken(bidBnb, bnbUsd, bemUsd);
    const prints = acc.rawPrints
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 6)
      .map((print) => {
        const bnb = weiBnb(print.wei);
        return { ts: print.ts, bnb, qty: print.qty, bem: quoteToken(bnb, bnbUsd, bemUsd).bem };
      });
    rows.push({
      id: acc.id,
      name: acc.name,
      kind: acc.tokenId === 1 ? "LATCH" : "NAND",
      lastBnb,
      lastTs: acc.lastTs,
      trades: acc.trades,
      qty: acc.qty,
      volBnb: weiBnb(acc.vol),
      trades24: acc.trades24,
      qty24: acc.qty24,
      volBnb24: weiBnb(acc.vol24),
      bem: lastQuote.bem,
      usd: lastQuote.usd,
      bidBnb,
      bidBem: bidQuote.bem,
      bidQty: acc.bidQty,
      prints,
    });
  }
  rows.sort(
    (a, b) =>
      b.volBnb24 - a.volBnb24 ||
      b.volBnb - a.volBnb ||
      (b.bidBnb ?? 0) * b.bidQty - (a.bidBnb ?? 0) * a.bidQty,
  );

  const data: TapeoutLive = {
    ok: true,
    error: null,
    asOf: market.generatedAt ?? null,
    bem,
    bnbUsd,
    pod,
    rows,
    listed: market.tokens?.length ?? 0,
    traded: rows.filter((row) => row.trades > 0).length,
    bidding: rows.filter((row) => row.trades === 0 && row.bidBnb != null).length,
  };
  cache = { at: Date.now(), ttl: bem ? 45_000 : 8_000, data };
  return data;
}
