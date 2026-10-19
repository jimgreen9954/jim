import { createServerFn } from "@tanstack/react-start";

export type OsCat = "pfp" | "art";

export type OsCard = {
  slug: string;
  name: string;
  cat: OsCat;
  image: string;
  floor: number | null;
  symbol: string;
  vol1d: number;
  vol7d: number;
  vol30d: number;
  sales1d: number;
  sales7d: number;
  sales30d: number;
  supply: number;
  url: string;
  verified: boolean;
};

export type TokenQuote = {
  id: string;
  symbol: string;
  price: number | null;
  change: number | null;
  mcap: number | null;
};

export type LaunchMarket = {
  source: "opensea";
  tokens: TokenQuote[];
  collections: OsCard[];
};

const PRESET: { slug: string; cat: OsCat }[] = [
  { slug: "boredapeyachtclub", cat: "pfp" },
  { slug: "mutant-ape-yacht-club", cat: "pfp" },
  { slug: "bored-ape-kennel-club", cat: "pfp" },
  { slug: "pudgypenguins", cat: "pfp" },
  { slug: "lilpudgys", cat: "pfp" },
  { slug: "azuki", cat: "pfp" },
  { slug: "beanzofficial", cat: "pfp" },
  { slug: "milady", cat: "pfp" },
  { slug: "cryptopunks", cat: "pfp" },
  { slug: "doodles-official", cat: "pfp" },
  { slug: "clonex", cat: "pfp" },
  { slug: "moonbirds", cat: "pfp" },
  { slug: "degods", cat: "pfp" },
  { slug: "world-of-women-nft", cat: "pfp" },
  { slug: "chromie-squiggle-by-snowfro", cat: "art" },
  { slug: "fidenza-by-tyler-hobbs", cat: "art" },
  { slug: "autoglyphs", cat: "art" },
  { slug: "ringers-by-dmitri-cherniak", cat: "art" },
];

let cache: { at: number; data: LaunchMarket } | null = null;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "tapeliquid/1.0" },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

function num(value: unknown): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function catOf(raw: unknown, fallback: OsCat): OsCat {
  const text = String(raw ?? "").toLowerCase();
  if (text.includes("art")) return "art";
  if (text.includes("pfp")) return "pfp";
  return fallback;
}

async function one(slug: string, fallback: OsCat): Promise<OsCard | null> {
  try {
    const [info, stats] = await Promise.all([
      getJson(`https://api.opensea.io/api/v2/collections/${slug}`),
      getJson(`https://api.opensea.io/api/v2/collections/${slug}/stats`),
    ]);
    const row = info as Record<string, unknown>;
    const stat = stats as {
      total?: { floor_price?: number; floor_price_symbol?: string };
      intervals?: { interval?: string; volume?: number; sales?: number }[];
    };
    const intervals = stat.intervals ?? [];
    const pick = (name: string) => intervals.find((item) => item.interval === name);
    const image = String(row.image_url ?? "");
    if (!image.startsWith("https://")) return null;
    const floorRaw = stat.total?.floor_price;
    const url = String(row.opensea_url ?? "");
    return {
      slug,
      name: String(row.name ?? slug),
      cat: catOf(row.category, fallback),
      image,
      floor: typeof floorRaw === "number" ? floorRaw : null,
      symbol: String(stat.total?.floor_price_symbol ?? "ETH"),
      vol1d: num(pick("one_day")?.volume),
      vol7d: num(pick("seven_day")?.volume),
      vol30d: num(pick("thirty_day")?.volume),
      sales1d: num(pick("one_day")?.sales),
      sales7d: num(pick("seven_day")?.sales),
      sales30d: num(pick("thirty_day")?.sales),
      supply: num(row.total_supply),
      url: url.startsWith("https://") ? url : `https://opensea.io/collection/${slug}`,
      verified: ["verified", "approved"].includes(String(row.safelist_status ?? "")),
    };
  } catch {
    return null;
  }
}

async function quotes(): Promise<TokenQuote[]> {
  try {
    const body = (await getJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=okb,bem-2&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
    )) as Record<string, { usd?: number; usd_24h_change?: number; usd_market_cap?: number }>;
    const map = (id: string, symbol: string): TokenQuote => ({
      id,
      symbol,
      price: typeof body[id]?.usd === "number" ? body[id].usd : null,
      change: typeof body[id]?.usd_24h_change === "number" ? body[id].usd_24h_change : null,
      mcap: typeof body[id]?.usd_market_cap === "number" ? body[id].usd_market_cap : null,
    });
    return [map("bem-2", "BEM"), map("okb", "OKB")];
  } catch {
    return [];
  }
}

export async function pullLaunchMarket(): Promise<LaunchMarket> {
  if (cache && Date.now() - cache.at < 120_000 && cache.data.collections.length > 0) return cache.data;
  const collections: OsCard[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < PRESET.length; index += 3) {
    const batch = PRESET.slice(index, index + 3);
    const rows = await Promise.all(batch.map((item) => one(item.slug, item.cat)));
    for (const row of rows) {
      if (!row || seen.has(row.image)) continue;
      seen.add(row.image);
      collections.push(row);
    }
  }
  const data: LaunchMarket = { source: "opensea", tokens: await quotes(), collections };
  if (collections.length > 0) cache = { at: Date.now(), data };
  return data;
}

export const getLaunchMarket = createServerFn({ method: "GET" }).handler(async () => pullLaunchMarket());
