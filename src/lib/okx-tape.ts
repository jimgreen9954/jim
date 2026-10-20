import { createServerFn } from "@tanstack/react-start";

const CONTRACT = "0x0e91460d6823c711643e650a9a4c0cc21de41614";
const PROJECT = 20687112;
const PAGE = "https://web3.okx.com/nft/collection/xlayer/tapecode-test1";
const MARKET = "https://web3.okx.com/priapi/v1/nft/secondary/market";
const RPC = "https://rpc.xlayer.tech";
const LOGO = "https://web3.okx.com/cdn/nft/0085a0bb-6bec-42f8-b180-6c67fbba49b5.png";
const PAGE_SIZE = 20;

export function tapeImage(value: string): string {
  const raw = value && /^https:\/\/(web3\.okx\.com|static\.okx\.com|static\.coinall\.ltd)\//.test(value.split("?")[0]) ? value : LOGO;
  return `/api/okx-img?u=${encodeURIComponent(raw)}`;
}

export type TapeCard = {
  tokenId: string;
  name: string;
  price: string;
  usd: string;
  last: string;
  owner: string;
  href: string;
};

export type TapeCode = {
  ok: boolean;
  error: string | null;
  name: string;
  contract: string;
  desc: string;
  supply: number | null;
  floor: string;
  offer: string;
  volume: string;
  owners: string;
  listed: string;
  indexed: string;
  change: string;
  banner: string;
  logo: string;
  cursor: string;
  more: boolean;
  cards: TapeCard[];
};

function empty(error: string | null): TapeCode {
  return {
    ok: false,
    error,
    name: "TapeCode-Test1",
    contract: CONTRACT,
    desc: "",
    supply: null,
    floor: "",
    offer: "",
    volume: "",
    owners: "",
    listed: "",
    indexed: "",
    change: "",
    banner: "",
    logo: "",
    cursor: "",
    more: false,
    cards: [],
  };
}

function okxImage(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value.split("?")[0];
  if (!/^https:\/\/(web3\.okx\.com|static\.okx\.com|static\.coinall\.ltd)\//.test(clean)) return "";
  return value;
}

async function chainSupply(): Promise<number | null> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: CONTRACT, data: "0x18160ddd" }, "latest"],
    }),
    signal: AbortSignal.timeout(12_000),
  });
  const body = (await res.json()) as { result?: string };
  if (!body.result || body.result === "0x") return null;
  return Number(BigInt(body.result));
}

type Sale = { strPrice?: string; strUsdPrice?: string; price?: number; currency?: string };
type Item = {
  tokenId?: string;
  name?: string;
  ownerAddress?: string;
  projectUrl?: string;
  sale?: Sale | null;
  lastPrice?: Sale | null;
};

async function market(cursor: string): Promise<{ list: Item[]; cursor: string; total: number | null }> {
  const res = await fetch(MARKET, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
      origin: "https://web3.okx.com",
      referer: PAGE,
    },
    body: JSON.stringify({
      sources: [],
      stateIn: [],
      nameSearch: "",
      sortBy: "makeOrderUsd",
      ownerAddressIn: [],
      contentTypes: [],
      projectIn: [PROJECT],
      pageNum: 1,
      pageSize: PAGE_SIZE,
      cursor,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`okx ${res.status}`);
  const body = (await res.json()) as { code?: number; data?: { list?: Item[]; cursor?: string; total?: number } };
  if (body.code !== 0 || !body.data) throw new Error("okx market");
  return {
    list: body.data.list ?? [],
    cursor: body.data.cursor || "",
    total: typeof body.data.total === "number" ? body.data.total : null,
  };
}

async function collectionMeta(): Promise<Partial<TapeCode>> {
  const html = await fetch(PAGE, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html" },
    signal: AbortSignal.timeout(15_000),
  }).then((res) => {
    if (!res.ok) throw new Error(`okx ${res.status}`);
    return res.text();
  });
  const matched = html.match(/<script[^>]*>(\{"appContext".*?)<\/script>/);
  if (!matched?.[1]) return {};
  const parsed = JSON.parse(matched[1]) as {
    appContext?: { initialProps?: { collectionInfo?: Record<string, unknown> } };
  };
  const info = parsed.appContext?.initialProps?.collectionInfo;
  if (!info) return {};
  const collection = (info.collectionInfo ?? {}) as {
    desc?: string;
    collectionBackgroundImage?: string;
    collectionImage?: string;
    contractAddress?: string;
  };
  const stats = (info.collectionProjectStats ?? {}) as {
    numOwners?: string;
    totalListed?: string;
    totalItems?: number;
    bestProjectOffer?: { strPrice?: string };
    platformFloorPrice?: { specifyFloorPrice?: { floorPrice?: { strPrice?: string } } };
    totalVolume?: { strPrice?: string };
  };
  const faqs = (info.faqs ?? {}) as { floorPriceGains?: string };
  const gain = Number(faqs.floorPriceGains);
  return {
    contract: (collection.contractAddress || CONTRACT).toLowerCase(),
    desc: collection.desc || "",
    floor: stats.platformFloorPrice?.specifyFloorPrice?.floorPrice?.strPrice || "",
    offer: stats.bestProjectOffer?.strPrice || "",
    volume: stats.totalVolume?.strPrice || "",
    owners: stats.numOwners || "",
    listed: stats.totalListed || "",
    indexed: stats.totalItems == null ? "" : String(stats.totalItems),
    change: Number.isFinite(gain) ? `${gain >= 0 ? "+" : ""}${(gain * 100).toFixed(1)}%` : "",
    banner: okxImage(collection.collectionBackgroundImage),
    logo: okxImage(collection.collectionImage),
  };
}

function cardsOf(list: Item[]): TapeCard[] {
  return list
    .filter((row) => row.tokenId)
    .map((row) => ({
      tokenId: String(row.tokenId),
      name: row.name || `#${row.tokenId}`,
      price: row.sale?.strPrice || (row.sale?.price != null ? String(row.sale.price) : ""),
      usd: row.sale?.strUsdPrice || "",
      last: row.lastPrice?.strPrice || "",
      owner: row.ownerAddress || "",
      href: `https://web3.okx.com/nft/asset/xlayer/${CONTRACT}/${row.tokenId}`,
    }));
}

export const getTapeCode = createServerFn({ method: "POST" })
  .validator((input: { cursor?: string } | undefined) => {
    const cursor = typeof input?.cursor === "string" ? input.cursor.trim() : "";
    if (cursor.length > 180 || /[\r\n<>]/.test(cursor)) return { cursor: "" };
    return { cursor };
  })
  .handler(async ({ data }): Promise<TapeCode> => {
    try {
      const first = data.cursor === "";
      const [page, meta, supply] = await Promise.all([
        market(data.cursor),
        first ? collectionMeta().catch(() => ({} as Partial<TapeCode>)) : Promise.resolve({} as Partial<TapeCode>),
        first ? chainSupply().catch(() => null) : Promise.resolve(null),
      ]);
      const cards = cardsOf(page.list);
      const fromList = okxImage(page.list.find((row) => row.projectUrl)?.projectUrl);
      return {
        ...empty(null),
        ok: true,
        error: null,
        ...meta,
        name: "TapeCode-Test1",
        contract: (meta.contract || CONTRACT).toLowerCase(),
        supply: first ? supply : null,
        logo: meta.logo || fromList || LOGO,
        banner: meta.banner || fromList || LOGO,
        cursor: page.cursor,
        more: cards.length === PAGE_SIZE && Boolean(page.cursor),
        cards,
      };
    } catch (error) {
      return empty(error instanceof Error ? error.message.slice(0, 80) : "okx");
    }
  });
