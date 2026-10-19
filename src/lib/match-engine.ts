export const HALF_SPREAD = 0.00045;
export const MMR = 0.005;

export type Side = "buy" | "sell";
export type MarketId = "spot" | "perp";
export type Bool4 = [boolean, boolean, boolean, boolean];
export type Fail = "badsize" | "badprice" | "nofunds" | "nobem" | "nomargin" | "nopos";

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type Order = {
  id: string;
  market: MarketId;
  side: Side;
  price: number;
  size: number;
  remaining: number;
  lockedUsd: number;
  lockedBem: number;
  leverage: number;
  ts: number;
};

export type Position = {
  size: number;
  entry: number;
  margin: number;
  leverage: number;
};

export type Fill = {
  id: string;
  market: MarketId;
  side: Side;
  price: number;
  size: number;
  fee: number;
  pnl: number;
  ts: number;
  kind: "trade" | "liq";
};

export type Print = {
  id: string;
  side: Side;
  price: number;
  size: number;
  mine: boolean;
};

export type Level = { price: number; size: number; mine: number };

export type Engine = {
  usd: number;
  bem: number;
  position: Position | null;
  orders: Order[];
  fills: Fill[];
  prints: Print[];
  price: number;
  candles: Candle[];
  funding: number;
  fundingPaid: number;
  clock: number;
  rng: number;
  taped: boolean;
  solved: number;
  inputs: Bool4;
  target: boolean;
  anchor: number;
  acc: number;
  seq: number;
  pulse: number;
  fuse: number;
  lastMine: number;
};

export type PlaceCmd = {
  market: MarketId;
  side: Side;
  orderType: "market" | "limit";
  size: number;
  price: number;
  leverage: number;
};

export type PlaceResult = { engine: Engine; error: Fail | null };

const TAKER = 0.0008;
const MAKER = 0.0002;
const nand = (a: boolean, b: boolean) => !(a && b);

/** Public matcher. AND, built only from NAND — the taped circuit. */
export function evalMatch(bidLive: boolean, askLive: boolean): boolean {
  const n = nand(bidLive, askLive);
  return nand(n, n);
}

/** Personal seal: (A AND B) OR (C AND D), NAND only. */
export function evalStamp(inp: Bool4): boolean {
  return nand(nand(inp[0], inp[1]), nand(inp[2], inp[3]));
}

export function feeRate(taped: boolean, taker: boolean): number {
  if (taker) return taped ? TAKER / 2 : TAKER;
  return taped ? 0 : MAKER;
}

function r6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function r4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function tickPx(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clampLev(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(20, Math.max(1, Math.round(n)));
}

function nextRng(seed: number): { seed: number; u: number } {
  let a = seed | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { seed: a >>> 0, u };
}

function buildCandles(rng0: number): { candles: Candle[]; price: number; rng: number } {
  let rng = rng0;
  const candles: Candle[] = [];
  let prev = 0.94;
  for (let i = 0; i < 72; i++) {
    const n1 = nextRng(rng);
    rng = n1.seed;
    const n2 = nextRng(rng);
    rng = n2.seed;
    const base = 0.94 + Math.sin(i / 8) * 0.035 + Math.sin(i / 21) * 0.018;
    const c = Math.max(0.4, base + (n1.u - 0.5) * 0.008);
    const o = prev;
    const w = 0.002 + n2.u * 0.006;
    candles.push({
      t: i,
      o: r6(o),
      c: r6(c),
      h: r6(Math.max(o, c) + w),
      l: r6(Math.max(0.2, Math.min(o, c) - w * 0.85)),
      v: r4(500 + n2.u * 2400),
    });
    prev = c;
  }
  const price = candles[candles.length - 1]!.c;
  return { candles, price, rng };
}

function seedPrints(price: number): Print[] {
  const out: Print[] = [];
  for (let i = 0; i < 8; i++) {
    out.push({
      id: `s${i}`,
      side: i % 2 === 0 ? "buy" : "sell",
      price: tickPx(price * (1 + (i - 4) * 0.00035)),
      size: r4(12 + i * 9),
      mine: false,
    });
  }
  return out;
}

export function initialEngine(): Engine {
  const seeded = buildCandles(0x7a9e0d);
  return {
    usd: 10000,
    bem: 2000,
    position: null,
    orders: [],
    fills: [],
    prints: seedPrints(seeded.price),
    price: seeded.price,
    candles: seeded.candles,
    funding: 0.00032,
    fundingPaid: 0,
    clock: 0,
    rng: seeded.rng,
    taped: false,
    solved: 0,
    inputs: [false, false, false, false],
    target: true,
    anchor: seeded.price,
    acc: 0,
    seq: 1,
    pulse: 0,
    fuse: 0,
    lastMine: -999,
  };
}

export function resetEngine(prev: Engine): Engine {
  const fresh = initialEngine();
  return {
    ...fresh,
    taped: prev.taped,
    solved: prev.solved,
    inputs: prev.inputs,
    target: prev.target,
  };
}

function takeId(e: Engine, prefix: string): [Engine, string] {
  return [{ ...e, seq: e.seq + 1 }, `${prefix}${e.seq}`];
}

function pushFill(e: Engine, fill: Omit<Fill, "id">): Engine {
  const [eng, id] = takeId(e, "f");
  const row: Fill = { ...fill, id };
  return { ...eng, fills: [row, ...eng.fills].slice(0, 40) };
}

function pushPrint(e: Engine, side: Side, price: number, size: number, mine: boolean): Engine {
  const [eng, id] = takeId(e, "p");
  const row: Print = { id, side, price: tickPx(price), size: r4(size), mine };
  return {
    ...eng,
    prints: [row, ...eng.prints].slice(0, 16),
    pulse: mine ? eng.pulse + 1 : eng.pulse,
    lastMine: mine ? eng.clock : eng.lastMine,
  };
}

export function touchBid(price: number): number {
  return price * (1 - HALF_SPREAD);
}

export function touchAsk(price: number): number {
  return price * (1 + HALF_SPREAD);
}

export function spreadBps(price: number): number {
  if (!(price > 0)) return 0;
  return ((touchAsk(price) - touchBid(price)) / price) * 10000;
}

export function liqPrice(pos: Position): number | null {
  if (!(Math.abs(pos.size) > 1e-8)) return null;
  if (pos.size > 0) return (pos.margin - pos.entry * pos.size) / (pos.size * (MMR - 1));
  const size = Math.abs(pos.size);
  return (pos.margin + pos.entry * size) / (size * (1 + MMR));
}

export function unrealized(pos: Position | null, price: number): number {
  if (!pos) return 0;
  return (price - pos.entry) * pos.size;
}

export function equity(e: Engine): number {
  const lockedU = e.orders.reduce((s, o) => s + o.lockedUsd, 0);
  const lockedB = e.orders.reduce((s, o) => s + o.lockedBem, 0);
  const upnl = unrealized(e.position, e.price);
  const margin = e.position?.margin ?? 0;
  return r6(e.usd + lockedU + (e.bem + lockedB) * e.price + margin + upnl);
}

export function sessionChange(e: Engine): number {
  const o = e.candles[0]?.o ?? e.price;
  if (!(o > 0)) return 0;
  return (e.price - o) / o;
}

export function maxSize(e: Engine, market: MarketId, side: Side, leverage: number): number {
  const px = side === "buy" ? touchAsk(e.price) : touchBid(e.price);
  const fee = feeRate(e.taped, true);
  if (!(px > 0)) return 0;
  if (market === "spot") {
    if (side === "buy") return Math.max(0, Math.floor(e.usd / (px * (1 + fee))));
    return Math.max(0, Math.floor(e.bem));
  }
  const dir = side === "buy" ? 1 : -1;
  const lev = clampLev(leverage);
  const room = e.usd / (px * (1 / lev + fee));
  if (e.position && Math.sign(e.position.size) !== dir && e.position.size !== 0) {
    return Math.max(0, Math.floor(Math.abs(e.position.size) + room));
  }
  const useLev = e.position && e.position.size !== 0 ? e.position.leverage : lev;
  const add = e.usd / (px * (1 / useLev + fee));
  return Math.max(0, Math.floor(add));
}

export function buildBook(price: number, orders: Order[], market: MarketId, clock: number): { bids: Level[]; asks: Level[] } {
  const bids: Level[] = [];
  const asks: Level[] = [];
  for (let i = 0; i < 6; i++) {
    const breathe = 1 + ((clock + i * 5) % 7) * 0.05;
    const wob = 0.75 + ((i * 3) % 5) * 0.1;
    bids.push({
      price: tickPx(touchBid(price) * (1 - i * 0.00115)),
      size: r4((80 + i * 64) * wob * breathe),
      mine: 0,
    });
    asks.push({
      price: tickPx(touchAsk(price) * (1 + i * 0.00115)),
      size: r4((76 + i * 70) * wob * breathe),
      mine: 0,
    });
  }
  for (const o of orders) {
    if (o.market !== market) continue;
    const list = o.side === "buy" ? bids : asks;
    const hit = list.find((l) => Math.abs(l.price - o.price) <= 0.00015);
    if (hit) hit.mine = r4(hit.mine + o.remaining);
    else list.push({ price: tickPx(o.price), size: r4(o.remaining), mine: r4(o.remaining) });
  }
  bids.sort((a, b) => b.price - a.price);
  asks.sort((a, b) => a.price - b.price);
  return { bids: bids.slice(0, 8), asks: asks.slice(0, 8) };
}

function previewPerp(
  pos0: Position | null,
  usd0: number,
  side: Side,
  size: number,
  price: number,
  leverage: number,
  rate: number,
): { usd: number; position: Position | null; fee: number; pnl: number } | { error: Fail } {
  let usd = usd0;
  let pot = 0;
  let pos = pos0 && Math.abs(pos0.size) > 1e-8 ? { ...pos0 } : null;
  const fee = r6(price * size * rate);
  const dir = side === "buy" ? 1 : -1;
  let left = size;
  let realized = 0;

  if (pos && Math.sign(pos.size) !== dir) {
    const sign = Math.sign(pos.size);
    const closeQty = Math.min(Math.abs(pos.size), left);
    const pnlPart = r6((price - pos.entry) * closeQty * sign);
    const release = r6(pos.margin * (closeQty / Math.abs(pos.size)));
    realized = pnlPart;
    pot = r6(Math.max(0, release + pnlPart));
    const newSize = r6(pos.size - sign * closeQty);
    const newMargin = r6(Math.max(0, pos.margin - release));
    pos =
      Math.abs(newSize) < 1e-6
        ? null
        : { size: newSize, entry: pos.entry, margin: newMargin, leverage: pos.leverage };
    left = r6(size - closeQty);
  }

  if (left > 1e-6) {
    const lev = clampLev(pos ? pos.leverage : leverage);
    const addMargin = r6((price * left) / lev);
    if (usd + pot + 1e-6 < addMargin) return { error: "nomargin" };
    let need = addMargin;
    const usePot = Math.min(pot, need);
    pot = r6(pot - usePot);
    need = r6(need - usePot);
    usd = r6(usd - need);
    if (!pos) {
      pos = { size: r6(dir * left), entry: price, margin: addMargin, leverage: lev };
    } else {
      const abs0 = Math.abs(pos.size);
      const abs1 = abs0 + left;
      pos = {
        size: r6(dir * abs1),
        entry: r6((pos.entry * abs0 + price * left) / abs1),
        margin: r6(pos.margin + addMargin),
        leverage: pos.leverage,
      };
    }
  }

  const reducingOnly = left <= 1e-6;
  const available = usd + pot;
  let charge = fee;
  if (reducingOnly && available + 1e-6 < fee) charge = r6(Math.max(0, available));
  else if (available + 1e-6 < fee) return { error: "nofunds" };

  let feeNeed = charge;
  const feePot = Math.min(pot, feeNeed);
  pot = r6(pot - feePot);
  feeNeed = r6(feeNeed - feePot);
  usd = r6(usd + pot - feeNeed);
  return { usd, position: pos, fee: charge, pnl: realized };
}

function trySpot(
  e: Engine,
  side: Side,
  size: number,
  price: number,
  taker: boolean,
): { engine: Engine } | { error: Fail } {
  if (!evalMatch(true, true)) return { error: "nofunds" };
  const rate = feeRate(e.taped, taker);
  const fee = r6(price * size * rate);
  if (side === "buy") {
    const cost = r6(price * size + fee);
    if (e.usd + 1e-6 < cost) return { error: "nofunds" };
    let eng: Engine = { ...e, usd: r6(e.usd - cost), bem: r6(e.bem + size) };
    eng = pushFill(eng, { market: "spot", side, price, size, fee, pnl: 0, ts: e.clock, kind: "trade" });
    eng = pushPrint(eng, side, price, size, true);
    return { engine: eng };
  }
  if (e.bem + 1e-6 < size) return { error: "nobem" };
  const proceeds = r6(price * size - fee);
  let eng: Engine = { ...e, usd: r6(e.usd + proceeds), bem: r6(e.bem - size) };
  eng = pushFill(eng, { market: "spot", side, price, size, fee, pnl: 0, ts: e.clock, kind: "trade" });
  eng = pushPrint(eng, side, price, size, true);
  return { engine: eng };
}

function tryPerp(
  e: Engine,
  side: Side,
  size: number,
  price: number,
  leverage: number,
  taker: boolean,
): { engine: Engine } | { error: Fail } {
  if (!evalMatch(true, true)) return { error: "nofunds" };
  const preview = previewPerp(e.position, e.usd, side, size, price, leverage, feeRate(e.taped, taker));
  if ("error" in preview) return preview;
  let eng: Engine = { ...e, usd: preview.usd, position: preview.position };
  eng = pushFill(eng, {
    market: "perp",
    side,
    price,
    size,
    fee: preview.fee,
    pnl: preview.pnl,
    ts: e.clock,
    kind: "trade",
  });
  eng = pushPrint(eng, side, price, size, true);
  return { engine: eng };
}

function perpLock(e: Engine, side: Side, size: number, price: number, leverage: number): number | { error: Fail } {
  const rate = feeRate(e.taped, false);
  const fee = price * size * rate;
  const dir = side === "buy" ? 1 : -1;
  let openQty = size;
  if (e.position && Math.sign(e.position.size) !== dir) {
    openQty = Math.max(0, size - Math.abs(e.position.size));
  }
  const lev =
    e.position && e.position.size !== 0 && openQty < size
      ? e.position.leverage
      : e.position && e.position.size !== 0 && Math.sign(e.position.size) === dir
        ? e.position.leverage
        : leverage;
  const margin = openQty > 0 ? (price * openQty) / clampLev(lev) : 0;
  const lock = r6(margin + fee);
  if (e.usd + 1e-6 < lock) return { error: openQty > 0 ? "nomargin" : "nofunds" };
  return lock;
}

export function placeOrder(e: Engine, cmd: PlaceCmd): PlaceResult {
  const size = r4(cmd.size);
  if (!Number.isFinite(size) || size < 1) return { engine: e, error: "badsize" };
  const leverage = clampLev(cmd.leverage);
  const bid = touchBid(e.price);
  const ask = touchAsk(e.price);
  const limit = r6(cmd.price);
  if (cmd.orderType === "limit" && (!(limit > 0) || !Number.isFinite(limit))) {
    return { engine: e, error: "badprice" };
  }
  const marketable =
    cmd.orderType === "market" ||
    (cmd.side === "buy" && limit >= ask - 1e-9) ||
    (cmd.side === "sell" && limit <= bid + 1e-9);

  if (marketable) {
    const px = tickPx(cmd.side === "buy" ? ask : bid);
    const done =
      cmd.market === "spot"
        ? trySpot(e, cmd.side, size, px, true)
        : tryPerp(e, cmd.side, size, px, leverage, true);
    if ("error" in done) return { engine: e, error: done.error };
    return { engine: done.engine, error: null };
  }

  if (cmd.market === "spot" && cmd.side === "buy") {
    const lock = r6(limit * size * (1 + feeRate(e.taped, false)));
    if (e.usd + 1e-6 < lock) return { engine: e, error: "nofunds" };
    const [eng, id] = takeId(e, "o");
    const order: Order = {
      id,
      market: "spot",
      side: "buy",
      price: tickPx(limit),
      size,
      remaining: size,
      lockedUsd: lock,
      lockedBem: 0,
      leverage: 1,
      ts: e.clock,
    };
    return { engine: { ...eng, usd: r6(e.usd - lock), orders: [...eng.orders, order] }, error: null };
  }

  if (cmd.market === "spot" && cmd.side === "sell") {
    if (e.bem + 1e-6 < size) return { engine: e, error: "nobem" };
    const [eng, id] = takeId(e, "o");
    const order: Order = {
      id,
      market: "spot",
      side: "sell",
      price: tickPx(limit),
      size,
      remaining: size,
      lockedUsd: 0,
      lockedBem: size,
      leverage: 1,
      ts: e.clock,
    };
    return { engine: { ...eng, bem: r6(e.bem - size), orders: [...eng.orders, order] }, error: null };
  }

  const lock = perpLock(e, cmd.side, size, limit, leverage);
  if (typeof lock !== "number") return { engine: e, error: lock.error };
  const lev =
    e.position && e.position.size !== 0 && Math.sign(e.position.size) === (cmd.side === "buy" ? 1 : -1)
      ? e.position.leverage
      : leverage;
  const [eng, id] = takeId(e, "o");
  const order: Order = {
    id,
    market: "perp",
    side: cmd.side,
    price: tickPx(limit),
    size,
    remaining: size,
    lockedUsd: lock,
    lockedBem: 0,
    leverage: clampLev(lev),
    ts: e.clock,
  };
  return { engine: { ...eng, usd: r6(e.usd - lock), orders: [...eng.orders, order] }, error: null };
}

export function cancelOrder(e: Engine, id: string): Engine {
  const o = e.orders.find((x) => x.id === id);
  if (!o) return e;
  return {
    ...e,
    usd: r6(e.usd + o.lockedUsd),
    bem: r6(e.bem + o.lockedBem),
    orders: e.orders.filter((x) => x.id !== id),
  };
}

export function closePosition(e: Engine, fraction: number): PlaceResult {
  if (!e.position || !(Math.abs(e.position.size) > 1e-8)) return { engine: e, error: "nopos" };
  const size = r4(Math.abs(e.position.size) * fraction);
  if (!(size > 0)) return { engine: e, error: "badsize" };
  const side: Side = e.position.size > 0 ? "sell" : "buy";
  if (size >= 1) {
    return placeOrder(e, {
      market: "perp",
      side,
      orderType: "market",
      size,
      price: e.price,
      leverage: e.position.leverage,
    });
  }
  const px = tickPx(side === "buy" ? touchAsk(e.price) : touchBid(e.price));
  const done = tryPerp(e, side, size, px, e.position.leverage, true);
  if ("error" in done) return { engine: e, error: done.error };
  return { engine: done.engine, error: null };
}

export function setInput(e: Engine, index: 0 | 1 | 2 | 3): Engine {
  const inputs: Bool4 = [e.inputs[0], e.inputs[1], e.inputs[2], e.inputs[3]];
  inputs[index] = !inputs[index];
  return { ...e, inputs };
}

export function tapStamp(e: Engine): { engine: Engine; ok: boolean } {
  if (e.taped) return { engine: e, ok: false };
  if (evalStamp(e.inputs) !== e.target) return { engine: e, ok: false };
  const solved = e.solved + 1;
  if (solved >= 3) {
    return { engine: { ...e, solved, taped: true, pulse: e.pulse + 1 }, ok: true };
  }
  const target = !e.target;
  const inputs: Bool4 = target ? [false, false, false, false] : [true, true, false, false];
  return { engine: { ...e, solved, target, inputs, pulse: e.pulse + 1 }, ok: true };
}

function isHit(o: Order, price: number): boolean {
  const bid = touchBid(price);
  const ask = touchAsk(price);
  return o.side === "buy" ? ask <= o.price + 1e-8 : bid + 1e-8 >= o.price;
}

function fillResting(e: Engine, o: Order): Engine {
  const released: Engine = {
    ...e,
    usd: r6(e.usd + o.lockedUsd),
    bem: r6(e.bem + o.lockedBem),
    orders: e.orders.filter((x) => x.id !== o.id),
  };
  const applied =
    o.market === "spot"
      ? trySpot(released, o.side, o.remaining, o.price, false)
      : tryPerp(released, o.side, o.remaining, o.price, o.leverage, false);
  if ("error" in applied) return e;
  return applied.engine;
}

function fillTouched(e: Engine): Engine {
  let next = e;
  const skipped = new Set<string>();
  for (let guard = 0; guard < 12; guard++) {
    const hit = next.orders.find((o) => !skipped.has(o.id) && isHit(o, next.price));
    if (!hit) break;
    const done = fillResting(next, hit);
    if (done === next) {
      skipped.add(hit.id);
      continue;
    }
    next = done;
  }
  return next;
}

function refundInto(e: Engine, o: Order): Engine {
  if (!e.orders.some((x) => x.id === o.id)) return e;
  return {
    ...e,
    usd: r6(e.usd + o.lockedUsd),
    bem: r6(e.bem + o.lockedBem),
    orders: e.orders.filter((x) => x.id !== o.id),
  };
}

function liquidateIfNeeded(e: Engine): Engine {
  const pos = e.position;
  if (!pos || !(Math.abs(pos.size) > 1e-8)) return e;
  const pnl = (e.price - pos.entry) * pos.size;
  const eq = pos.margin + pnl;
  const mm = Math.abs(pos.size) * e.price * MMR;
  if (eq > mm && pos.margin > 0) return e;
  let eng = e;
  for (const o of [...e.orders]) {
    if (o.market === "perp") eng = refundInto(eng, o);
  }
  eng = { ...eng, position: null, fuse: eng.fuse + 1 };
  return pushFill(eng, {
    market: "perp",
    side: pos.size > 0 ? "sell" : "buy",
    price: e.price,
    size: r4(Math.abs(pos.size)),
    fee: 0,
    pnl: r6(-pos.margin),
    ts: e.clock,
    kind: "liq",
  });
}

function rollCandle(e: Engine, price: number, u: number, dt: number, tfMs: number): Engine {
  const candles = e.candles.slice();
  const last = candles[candles.length - 1];
  if (!last) return e;
  const cur: Candle = {
    ...last,
    h: Math.max(last.h, price),
    l: Math.min(last.l, price),
    c: price,
    v: r4(last.v + 12 + u * 40),
  };
  candles[candles.length - 1] = cur;
  let acc = e.acc + dt;
  if (acc >= tfMs) {
    candles.push({ t: cur.t + 1, o: price, h: price, l: price, c: price, v: 0 });
    acc = 0;
  }
  return { ...e, candles: candles.slice(-90), acc };
}

function applyFunding(e: Engine): Engine {
  if (!e.position || e.clock % 25 !== 0) return e;
  const notional = Math.abs(e.position.size) * e.price;
  const mag = r6(Math.abs(notional * e.funding) * 0.08);
  if (!(mag > 0)) return e;
  const paying = (e.funding >= 0 && e.position.size > 0) || (e.funding < 0 && e.position.size < 0);
  if (!paying) {
    return { ...e, usd: r6(e.usd + mag), fundingPaid: r6(e.fundingPaid - mag) };
  }
  const fromUsd = Math.min(e.usd, mag);
  let usd = r6(e.usd - fromUsd);
  const rest = r6(mag - fromUsd);
  let pos = e.position;
  if (rest > 0) pos = { ...pos, margin: r6(pos.margin - rest) };
  return liquidateIfNeeded({ ...e, usd, position: pos, fundingPaid: r6(e.fundingPaid + mag) });
}

function fabPrint(e: Engine): Engine {
  const a = nextRng(e.rng);
  const b = nextRng(a.seed);
  const side: Side = a.u > 0.48 ? "buy" : "sell";
  const size = r4(6 + b.u * 80);
  const px = side === "buy" ? touchAsk(e.price) : touchBid(e.price);
  return pushPrint({ ...e, rng: b.seed }, side, px, size, false);
}

export function step(e: Engine, dt: number, tfMs: number): Engine {
  const a = nextRng(e.rng);
  const b = nextRng(a.seed);
  const shock = (a.u - 0.5) * 0.0014;
  const mean = ((e.anchor - e.price) / Math.max(e.price, 0.01)) * 0.004;
  let price = r6(e.price * (1 + shock + mean));
  if (!Number.isFinite(price) || price < 0.05) price = e.anchor;
  const funding = r6(0.00028 + Math.sin((e.clock + 1) / 28) * 0.00022);
  let next: Engine = { ...e, price, rng: b.seed, funding, clock: e.clock + 1 };
  next = rollCandle(next, price, b.u, dt, tfMs);
  next = liquidateIfNeeded(next);
  next = fillTouched(next);
  next = applyFunding(next);
  next = liquidateIfNeeded(next);
  if (next.clock % 2 === 0) next = fabPrint(next);
  return next;
}

export function markTo(e: Engine, price: number): Engine {
  const px = r6(price);
  if (!(px > 0)) return e;
  return liquidateIfNeeded({ ...e, price: px });
}

export function sanitizeEngine(raw: unknown): Engine | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<Engine>;
  if (typeof o.usd !== "number" || typeof o.price !== "number" || !(o.price > 0)) return null;
  const base = initialEngine();
  const candles = Array.isArray(o.candles) && o.candles.length >= 8 ? (o.candles as Candle[]) : base.candles;
  const inputsOk = Array.isArray(o.inputs) && o.inputs.length === 4;
  const inputs: Bool4 = inputsOk
    ? [!!o.inputs![0], !!o.inputs![1], !!o.inputs![2], !!o.inputs![3]]
    : base.inputs;
  const pos = o.position;
  const position =
    pos && typeof pos === "object" && typeof pos.size === "number" && typeof pos.entry === "number"
      ? pos
      : null;
  const orders = Array.isArray(o.orders)
    ? (o.orders as Order[]).filter(
        (ord) =>
          !!ord &&
          typeof ord.id === "string" &&
          (ord.market === "spot" || ord.market === "perp") &&
          (ord.side === "buy" || ord.side === "sell") &&
          ord.remaining > 0,
      )
    : [];
  return {
    ...base,
    usd: o.usd,
    bem: typeof o.bem === "number" ? o.bem : base.bem,
    price: o.price,
    candles,
    position,
    orders,
    fills: Array.isArray(o.fills) ? (o.fills as Fill[]).slice(0, 40) : [],
    prints: Array.isArray(o.prints) && o.prints.length > 0 ? (o.prints as Print[]).slice(0, 16) : base.prints,
    funding: typeof o.funding === "number" ? o.funding : base.funding,
    fundingPaid: typeof o.fundingPaid === "number" ? o.fundingPaid : 0,
    clock: typeof o.clock === "number" ? o.clock : 0,
    rng: typeof o.rng === "number" ? o.rng : base.rng,
    taped: o.taped === true,
    solved: typeof o.solved === "number" ? o.solved : 0,
    inputs,
    target: typeof o.target === "boolean" ? o.target : true,
    anchor: typeof o.anchor === "number" ? o.anchor : o.price,
    acc: typeof o.acc === "number" ? o.acc : 0,
    seq: typeof o.seq === "number" ? o.seq : 1,
    pulse: typeof o.pulse === "number" ? o.pulse : 0,
    fuse: typeof o.fuse === "number" ? o.fuse : 0,
    lastMine: typeof o.lastMine === "number" ? o.lastMine : -999,
  };
}
