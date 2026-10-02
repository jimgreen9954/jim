import { create } from "zustand";
import {
  cancelOrder,
  closePosition,
  initialEngine,
  maxSize,
  placeOrder,
  resetEngine,
  sanitizeEngine,
  setInput,
  step,
  tapStamp,
  type Engine,
  type Fail,
  type MarketId,
  type Side,
} from "@/lib/match-engine";

const KEY = "tapeliquid-v1";

export type Lang = "zh" | "en";
export type Pane = "trade" | "book" | "holds" | "die";
export type BannerKey =
  | Fail
  | "rested"
  | "filled"
  | "cancelled"
  | "stamped"
  | "sealed"
  | "mismatch"
  | "resetok"
  | "liq";

type Draft = {
  orderType: "market" | "limit";
  size: string;
  price: string;
  leverage: number;
};

type Banner = { id: number; key: BannerKey };

type Store = {
  engine: Engine;
  lang: Lang;
  market: MarketId;
  side: Side;
  tf: 4000 | 8000 | 16000;
  pane: Pane;
  draft: Draft;
  banner: Banner | null;
  liqSeq: number;
  booted: boolean;
  chainBem: number | null;
  clearBanner: () => void;
  hydrate: () => void;
  tick: (dt: number) => void;
  setLang: (lang: Lang) => void;
  setMarket: (market: MarketId) => void;
  setSide: (side: Side) => void;
  setTf: (tf: 4000 | 8000 | 16000) => void;
  setPane: (pane: Pane) => void;
  setOrderType: (orderType: Draft["orderType"]) => void;
  setSize: (size: string) => void;
  setPrice: (price: string) => void;
  setLev: (leverage: number) => void;
  applyPercent: (pct: number) => void;
  pickLevel: (price: number, side: Side) => void;
  submit: () => void;
  cancel: (id: string) => void;
  close: (fraction: number) => void;
  reset: () => void;
  flipPad: (index: 0 | 1 | 2 | 3) => void;
  tap: () => void;
  setChainBem: (price: number | null) => void;
  rebaseIfFresh: (price: number) => void;
};

let bannerSeq = 0;

function shout(key: BannerKey): Banner {
  bannerSeq += 1;
  return { id: bannerSeq, key };
}

const draft0 = (): Draft => ({ orderType: "market", size: "100", price: "", leverage: 5 });

function persist(s: Store) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, lang: s.lang, market: s.market, tf: s.tf, engine: s.engine }),
    );
  } catch {
    /* private mode */
  }
}

function scaledFresh(engine: Engine, price: number): Engine {
  if (!(price > 0) || !Number.isFinite(price)) return engine;
  if (Math.abs(engine.price - price) / price < 0.01) return { ...engine, anchor: price };
  const ratio = price / engine.price;
  const scale = (n: number) => Math.round(n * ratio * 1e6) / 1e6;
  return {
    ...engine,
    price: scale(engine.price),
    anchor: scale(engine.price),
    candles: engine.candles.map((c) => ({
      ...c,
      o: scale(c.o),
      h: scale(c.h),
      l: scale(c.l),
      c: scale(c.c),
    })),
    prints: engine.prints.map((p) => ({ ...p, price: scale(p.price) })),
  };
}

export const useExchange = create<Store>((set, get) => ({
  engine: initialEngine(),
  lang: "zh",
  market: "spot",
  side: "buy",
  tf: 8000,
  pane: "trade",
  draft: draft0(),
  banner: null,
  liqSeq: 0,
  booted: false,
  chainBem: null,
  clearBanner: () => set({ banner: null }),
  hydrate: () => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        set({ booted: true });
        return;
      }
      const data = JSON.parse(raw) as {
        lang?: Lang;
        market?: MarketId;
        tf?: number;
        engine?: unknown;
      };
      const engine = sanitizeEngine(data.engine);
      if (!engine) {
        set({ booted: true });
        return;
      }
      set({
        engine,
        lang: data.lang === "en" ? "en" : "zh",
        market: data.market === "perp" ? "perp" : "spot",
        tf: data.tf === 4000 || data.tf === 16000 ? data.tf : 8000,
        booted: true,
      });
    } catch {
      set({ booted: true });
    }
  },
  tick: (dt) => {
    const s = get();
    const next = step(s.engine, dt, s.tf);
    const liq = next.fuse !== s.engine.fuse;
    set({
      engine: next,
      liqSeq: liq ? s.liqSeq + 1 : s.liqSeq,
      banner: liq ? shout("liq") : s.banner,
    });
  },
  setLang: (lang) => set({ lang }),
  setMarket: (market) => set({ market }),
  setSide: (side) => set({ side }),
  setTf: (tf) => set({ tf }),
  setPane: (pane) => set({ pane }),
  setOrderType: (orderType) =>
    set((s) => ({
      draft: {
        ...s.draft,
        orderType,
        price: orderType === "limit" ? s.draft.price || s.engine.price.toFixed(4) : s.draft.price,
      },
    })),
  setSize: (size) => set((s) => ({ draft: { ...s.draft, size } })),
  setPrice: (price) => set((s) => ({ draft: { ...s.draft, price } })),
  setLev: (leverage) => set((s) => ({ draft: { ...s.draft, leverage } })),
  applyPercent: (pct) => {
    const s = get();
    const n = maxSize(s.engine, s.market, s.side, s.draft.leverage);
    if (n < 1) {
      const key: Fail = s.market === "spot" && s.side === "sell" ? "nobem" : "nofunds";
      set({ banner: shout(key) });
      return;
    }
    set({ draft: { ...s.draft, size: String(Math.max(1, Math.floor(n * pct))) } });
  },
  pickLevel: (price, side) =>
    set((s) => ({
      side,
      pane: "trade",
      draft: { ...s.draft, orderType: "limit", price: price.toFixed(4) },
    })),
  submit: () => {
    const s = get();
    const before = s.engine.fills[0]?.id;
    const beforeOrders = s.engine.orders.length;
    const res = placeOrder(s.engine, {
      market: s.market,
      side: s.side,
      orderType: s.draft.orderType,
      size: Number(s.draft.size),
      price: Number(s.draft.price),
      leverage: s.draft.leverage,
    });
    if (res.error) {
      set({ banner: shout(res.error) });
      return;
    }
    const rested = res.engine.orders.length > beforeOrders;
    const filled = res.engine.fills[0]?.id !== before;
    set({ engine: res.engine, banner: shout(rested && !filled ? "rested" : "filled") });
  },
  cancel: (id) => set({ engine: cancelOrder(get().engine, id), banner: shout("cancelled") }),
  close: (fraction) => {
    const res = closePosition(get().engine, fraction);
    if (res.error) set({ banner: shout(res.error) });
    else set({ engine: res.engine, banner: shout("filled") });
  },
  reset: () => {
    const s = get();
    const engine = s.chainBem ? scaledFresh(resetEngine(s.engine), s.chainBem) : resetEngine(s.engine);
    set({ engine, banner: shout("resetok"), draft: draft0() });
  },
  flipPad: (index) => set((s) => ({ engine: setInput(s.engine, index) })),
  tap: () => {
    const prev = get().engine;
    const res = tapStamp(prev);
    if (!res.ok) {
      set({ banner: shout("mismatch") });
      return;
    }
    set({ engine: res.engine, banner: shout(res.engine.taped ? "sealed" : "stamped") });
  },
  setChainBem: (price) => set({ chainBem: price }),
  rebaseIfFresh: (price) => {
    const engine = get().engine;
    if (engine.position || engine.orders.length > 0 || engine.fills.length > 0) return;
    set({ engine: scaledFresh(engine, price) });
  },
}));

export function startPersistence() {
  useExchange.getState().hydrate();
  return useExchange.subscribe((s, p) => {
    const meaningful =
      s.engine.seq !== p.engine.seq ||
      s.engine.taped !== p.engine.taped ||
      s.engine.solved !== p.engine.solved ||
      s.engine.inputs !== p.engine.inputs ||
      s.lang !== p.lang ||
      s.market !== p.market ||
      s.tf !== p.tf ||
      (s.engine.clock !== p.engine.clock && s.engine.clock % 8 === 0);
    if (meaningful) persist(s);
  });
}
