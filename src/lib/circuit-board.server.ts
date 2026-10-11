import type { CircuitBar, CircuitBoard, CircuitPrint, CircuitRow, CircuitSigned } from "./circuit-board";

const API = "https://api-tapeout.firsto.ai";
const EMPTY: CircuitBoard = {
  ok: false,
  error: "feed",
  asOf: null,
  refDayPx: null,
  vol24h: null,
  trades24h: null,
  listed: null,
  circuits: null,
  holders: null,
  listedHash: null,
  official: [],
  other: [],
  mine: [],
  prints: [],
  bars: [],
};

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function bnb(wei: unknown): number | null {
  const n = num(wei);
  return n == null ? null : n / 1e18;
}

function bem(atomic: unknown, decimals = 8): number | null {
  const n = num(atomic);
  return n == null ? null : n / 10 ** decimals;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function addr(value: unknown): `0x${string}` | null {
  const row = text(value);
  return /^0x[a-fA-F0-9]{40}$/.test(row) ? (row as `0x${string}`) : null;
}

function signedOf(ask: Raw | null, price: string): CircuitSigned | null {
  const exec = (ask?.execution ?? null) as Raw | null;
  if (!exec || text(exec.kind) !== "signed_ask") return null;
  const exchange = addr(exec.exchange);
  const maker = addr(exec.maker);
  const collection = addr(exec.collection);
  const payout = addr(exec.payoutRecipient);
  const signature = text(exec.signature);
  const nonce = text(exec.nonce);
  const expiry = text(exec.expiry);
  const schema = num(exec.schemaVersion);
  const feeBps = num(exec.feeBps);
  if (!exchange || !maker || !collection || !payout || !/^0x[a-fA-F0-9]+$/.test(signature) || !nonce || !expiry || schema == null || feeBps == null) return null;
  const buyerCost = text(ask?.buyerCostWei) || price;
  return {
    exchange,
    maker,
    collection,
    tokenId: text(exec.tokenId),
    nonce,
    price,
    expiry,
    payout,
    feeBps,
    feeEpoch: text(exec.feeEpoch) || null,
    schemaVersion: schema,
    signature: signature as `0x${string}`,
    buyerCost,
  };
}

type Raw = Record<string, unknown>;

function rowOf(raw: Raw): CircuitRow | null {
  const mining = (raw.mining ?? {}) as Raw;
  const valuation = (raw.valuation ?? {}) as Raw;
  const ask = (raw.bestAsk ?? null) as Raw | null;
  const askWei = ask ? text(ask.priceWei) : "";
  const price = bnb(askWei);
  const hash = num(mining.weight) ?? 0;
  const dayBem = bem(mining.estimated24hAtomic, num(mining.tokenDecimals) ?? 8);
  const units = (num(raw.directNand) ?? 0) + (num(raw.directLatch) ?? 0);
  const crystal = bnb(valuation.crystalAveragePriceWei) ?? (price != null && units > 0 ? price / units : null);
  const hashPx = price != null && hash > 0 ? price / hash : null;
  const listed = (raw.listingReference ?? {}) as Raw;
  const dayPx = bnb(listed.dailyCapacityPriceWei) ?? (price != null && dayBem != null && dayBem > 0 ? price / dayBem : null);
  const official = ask && text(ask.venue) === "official" ? text(ask.id).match(/:(\d+)$/) : null;
  const payback = num(valuation.staticPaybackSeconds);
  const tokenId = text(raw.tokenId);
  if (!tokenId) return null;
  return {
    key: text(raw.id) || `${text(raw.collection)}:${tokenId}`,
    name: text(raw.processorName) || "—",
    tokenId,
    nand: num(raw.directNand) ?? 0,
    latch: num(raw.directLatch) ?? 0,
    nIn: num(raw.inputCount) ?? 0,
    nOut: num(raw.outputCount) ?? 0,
    nState: num(raw.stateCount) ?? 0,
    gates: num(raw.directGateCount) ?? 0,
    status: text(mining.status) || "—",
    hash,
    crystal,
    hashPx,
    dayBem,
    dayPx,
    ask: price,
    askWei: askWei || null,
    bid: bnb(raw.maxBidSellerNetWei),
    officialId: official ? Number(official[1]) : null,
    signed: signedOf(ask, askWei),
    seller: text(ask?.account) || text(raw.owner),
    listedAt: num(raw.createdTimestamp) ?? 0,
    paybackDays: payback != null ? payback / 86400 : null,
  };
}

function rowsOf(body: Raw | null): CircuitRow[] {
  const list = Array.isArray(body?.rows) ? body.rows : [];
  return list.map((row) => rowOf(row as Raw)).filter((row): row is CircuitRow => row != null);
}

async function pull(path: string): Promise<Raw | null> {
  const res = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  return (await res.json()) as Raw;
}

function barsOf(body: Raw | null): CircuitBar[] {
  const list = Array.isArray(body?.trades) ? body.trades : [];
  const map = new Map<number, CircuitBar>();
  for (const raw of list as Raw[]) {
    const at = Date.parse(text(raw.observedAt));
    const price = bnb(raw.priceWei);
    if (!Number.isFinite(at) || price == null || price <= 0) continue;
    const bucket = Math.floor(at / 3_600_000) * 3600;
    const cur = map.get(bucket);
    const size = num(raw.soldCount) ?? 1;
    if (!cur) map.set(bucket, { t: bucket, o: price, h: price, l: price, c: price, v: size });
    else {
      cur.h = Math.max(cur.h, price);
      cur.l = Math.min(cur.l, price);
      cur.c = price;
      cur.v += size;
    }
  }
  return [...map.values()];
}

function printsOf(body: Raw | null): CircuitPrint[] {
  const list = Array.isArray(body?.trades) ? body.trades : [];
  return list.slice(0, 40).map((raw) => {
    const row = raw as Raw;
    const mining = (row.mining ?? {}) as Raw;
    const valuation = (row.valuation ?? {}) as Raw;
    const price = bnb(row.priceWei) ?? 0;
    const hash = num(mining.weight) ?? 0;
    const dayBem = bem(mining.estimated24hAtomic, num(mining.tokenDecimals) ?? 8);
    const units = (num(row.directNand) ?? 0) + (num(row.directLatch) ?? 0);
    return {
      ts: num(row.blockTimestamp) ?? 0,
      name: text(row.processorName) || "—",
      tokenId: text(row.tokenId),
      nand: num(row.directNand) ?? 0,
      latch: num(row.directLatch) ?? 0,
      nIn: num(row.inputCount) ?? 0,
      nOut: num(row.outputCount) ?? 0,
      nState: num(row.stateCount) ?? 0,
      status: text(mining.status) || "—",
      hash,
      crystal: bnb(valuation.crystalAveragePriceWei) ?? (units > 0 && price > 0 ? price / units : null),
      hashPx: hash > 0 && price > 0 ? price / hash : null,
      dayBem,
      dayPx: dayBem != null && dayBem > 0 && price > 0 ? price / dayBem : null,
      price,
      buyer: text(row.buyer),
      seller: text(row.seller),
      tx: text(row.transactionHash),
    };
  });
}

export async function loadCircuitBoard(account: string): Promise<CircuitBoard> {
  try {
    const minePath = account
      ? `/v1/circuits?onlyMine=true&account=${account}&page=1&pageSize=50&sort=recently_listed`
      : "";
    const [official, other, holders, trades, candles, mine] = await Promise.all([
      pull("/v1/circuits?category=official_mining&sort=daily_capacity_price_low&page=1&pageSize=50"),
      pull("/v1/circuits?category=other&sort=price_low&page=1&pageSize=50"),
      pull("/v1/circuit-holders?page=1"),
      pull("/v1/circuit-trades?limit=40"),
      pull("/v1/analytics/circuits/trades?range=24h"),
      minePath ? pull(minePath) : Promise.resolve(null),
    ]);
    const stats = (holders?.marketStats ?? {}) as Raw;
    return {
      ok: Boolean(official || holders),
      error: official || holders ? null : "feed",
      asOf: text(holders?.asOf) || null,
      refDayPx: bnb(stats.referenceDailyCapacityPriceWei),
      vol24h: bnb(stats.volume24hWei),
      trades24h: num(stats.trades24h),
      listed: num(stats.activeListingCount),
      circuits: num(holders?.totalCircuits),
      holders: num(stats.holderAddressCount) ?? num(holders?.totalHolders),
      listedHash: num(stats.listedEffectiveH),
      official: rowsOf(official),
      other: rowsOf(other),
      mine: rowsOf(mine),
      prints: printsOf(trades),
      bars: barsOf(candles),
    };
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : "feed" };
  }
}
