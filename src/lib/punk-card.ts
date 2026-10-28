import { punk } from "@/lib/circuit-punk";

export const DESK_FEE_BPS = 20;
export const FAUX_CAP = 50;
export const THAW_HOURS = 48;
export const RECRAFT_DAYS = 30;
export const UNLOCK_DAYS = 7;

export type CardKind = "copper" | "silver" | "gold" | "euv" | "faux";
export type Desk = "spot" | "perp" | "circuit" | "launch";

export type PunkCard = {
  kind: CardKind;
  name: string;
  ids: number[];
  stats: Record<Desk, number>;
  main: Desk | null;
  feeAll: number;
  feeMain: number;
  color: string;
  edge: string | null;
};

const RANK: Record<string, number> = { 普通: 0, 少见: 1, 稀有: 2, 史诗: 3, 传说: 4 };

const SUB_W: Record<string, number> = {
  轻掺杂硅: 4000,
  中掺杂硅: 2500,
  重掺杂硅: 1500,
  本征硅: 800,
  氧化层: 700,
  氮化镓: 300,
  碳化硅: 200,
  极紫外: 9,
  报废硅: 88,
  厚铜: 24,
};
const METAL_W: Record<string, number> = {
  无金属: 2800,
  铝互连: 2200,
  铜互连: 1600,
  金互连: 900,
  钴盖帽: 44,
  紫光刻胶: 500,
  钨栓塞: 400,
  绿胶: 200,
  高顶盖帽: 115,
};
const EYE_W: Record<string, number> = {
  键合点: 5200,
  遮光层: 527,
  经典遮光: 502,
  牛角框: 535,
  眼罩: 293,
  三维眼镜: 286,
  激光对准: 120,
};
const BOND_W: Record<string, number> = {
  钝化: 4200,
  引线: 2459,
  探针: 961,
  针孔: 644,
  金属胡须: 420,
  开槽: 380,
  金凸点: 169,
  崩边: 78,
};
const PACK_BONUS: Record<string, number> = { 裸片: 0, QFN: 2, BGA: 4, WLCSP: 6, 陶瓷盖: 8 };

const FEE: Record<CardKind, { all: number; main: number; name: string; edge: string | null; hue: number }> = {
  copper: { all: 16, main: 14, name: "铜片", edge: null, hue: 28 },
  silver: { all: 12, main: 10, name: "银盖", edge: null, hue: 216 },
  gold: { all: 8, main: 6, name: "金线", edge: null, hue: 40 },
  euv: { all: 6, main: 4, name: "极紫外", edge: "#3DDEA2", hue: 252 },
  faux: { all: 8, main: 8, name: "仿极紫外", edge: null, hue: 252 },
};

const DESKS: Desk[] = ["spot", "perp", "circuit", "launch"];

function traitScore(weight: number): number {
  return Math.max(0, Math.min(100, Math.round(8000 / weight)));
}

function mix(n: number): number {
  let x = (n + 0x9e3779b9) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = light - c / 2;
  const channel =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const hex = channel.map((part) => Math.round((part + m) * 255).toString(16).padStart(2, "0")).join("");
  return `#${hex}`;
}

function rows(ids: number[]) {
  return ids.map((id) => punk(id));
}

function clean(ids: number[]): string | null {
  if (ids.some((id) => !Number.isInteger(id) || id < 1 || id > 10_000)) return "编号要在 1 到 10000。";
  if (new Set(ids).size !== ids.length) return "同一张不能用两次。";
  return null;
}

function isEuv(ids: number[]): boolean {
  const list = rows(ids);
  if (ids.length === 3 && list.some((row) => row.tier === "传说")) return true;
  if (ids.length !== 4) return false;
  const epic = list.some((row) => row.tier === "史诗");
  const restOk = list.every((row) => (RANK[row.tier] ?? 0) >= RANK.少见);
  return epic && restOk;
}

function isGold(ids: number[]): boolean {
  if (ids.length !== 3) return false;
  const list = rows(ids);
  return list.some((row) => (RANK[row.tier] ?? 0) >= RANK.稀有) && new Set(list.map((row) => row.type)).size === 3;
}

function isSilver(ids: number[]): boolean {
  if (ids.length !== 3) return false;
  const list = rows(ids);
  const rareEnough = list.some((row) => (RANK[row.tier] ?? 0) >= RANK.少见);
  return rareEnough && new Set(list.map((row) => row.sub)).size >= 2;
}

function isCopper(ids: number[]): boolean {
  if (ids.length !== 2) return false;
  const list = rows(ids);
  return list.every((row) => row.tier === "普通") && list[0].type !== list[1].type;
}

function isFaux(ids: number[]): boolean {
  if (ids.length !== 20) return false;
  const list = rows(ids);
  return list.every((row) => row.tier === "普通") && new Set(list.map((row) => row.type)).size > 1;
}

function kindOf(ids: number[]): CardKind | null {
  if (isEuv(ids)) return "euv";
  if (isGold(ids)) return "gold";
  if (isSilver(ids)) return "silver";
  if (isCopper(ids)) return "copper";
  if (isFaux(ids)) return "faux";
  return null;
}

function why(ids: number[]): string {
  if (ids.length === 20) {
    const list = rows(ids);
    if (list.some((row) => row.tier !== "普通")) return "仿极紫外只要二十张普通。";
    return "这二十张类型完全相同。要换进另一种普通。";
  }
  if (ids.length === 2) return "铜片要两张普通，而且类型不同。";
  if (ids.length === 4) return "极紫外的史诗配方要一张史诗，另外三张至少是少见。";
  if (ids.length === 3) return "三张可以对银盖、金线，或用一张传说做极紫外。银盖至少一张少见、两种衬底。金线至少一张稀有，三张类型各不相同。";
  return "张数对不上。铜片 2 张，银盖和金线 3 张，极紫外 3 或 4 张，仿极紫外 20 张。";
}

function build(ids: number[], kind: CardKind): PunkCard {
  const list = rows(ids);
  const bonus = list.map((row) => PACK_BONUS[row.pack] ?? 0);
  const family = [
    list.map((row) => traitScore(SUB_W[row.sub] ?? 1000)),
    list.map((row) => traitScore(METAL_W[row.metal] ?? 1000)),
    list.map((row) => traitScore(BOND_W[row.bond] ?? 1000)),
    list.map((row) => traitScore(EYE_W[row.eye] ?? 1000)),
  ];
  const stats = Object.fromEntries(
    DESKS.map((desk, index) => {
      const raw = family[index].map((score, at) => Math.min(100, score + bonus[at]));
      const avg = raw.reduce((sum, score) => sum + score, 0) / raw.length;
      return [desk, Math.max(0, Math.min(100, Math.round(avg)))];
    }),
  ) as Record<Desk, number>;
  const rule = FEE[kind];
  const main = kind === "faux" ? null : DESKS.reduce((best, desk) => (stats[desk] > stats[best] ? desk : best));
  const shift = (mix(ids.reduce((sum, id) => sum + id, 0)) % 25) - 12;
  const sat = kind === "silver" ? 14 : kind === "faux" ? 62 : 70;
  const light = kind === "silver" ? 78 : kind === "euv" ? 62 : kind === "faux" ? 54 : 48;
  return {
    kind,
    name: rule.name,
    ids: [...ids],
    stats,
    main,
    feeAll: rule.all,
    feeMain: rule.main,
    color: hsl(rule.hue + shift, sat, light),
    edge: rule.edge,
  };
}

export function forge(ids: number[]): { ok: true; card: PunkCard } | { ok: false; reason: string } {
  const bad = clean(ids);
  if (bad) return { ok: false, reason: bad };
  const kind = kindOf(ids);
  if (!kind) return { ok: false, reason: why(ids) };
  return { ok: true, card: build(ids, kind) };
}

export function bestHeld(ids: number[]): PunkCard | null {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id >= 1 && id <= 10_000))];
  const meta = unique.map((id) => ({ id, row: punk(id) }));
  const rank = (tier: string) => RANK[tier] ?? 0;
  const take = (picked: number[]) => {
    const made = forge(picked);
    return made.ok ? made.card : null;
  };
  const legend = meta.find((item) => item.row.tier === "传说");
  if (legend && meta.length >= 3) {
    const card = take([legend.id, ...meta.filter((item) => item.id !== legend.id).slice(0, 2).map((item) => item.id)]);
    if (card) return card;
  }
  const epic = meta.find((item) => item.row.tier === "史诗");
  if (epic) {
    const mates = meta.filter((item) => item.id !== epic.id && rank(item.row.tier) >= RANK.少见).slice(0, 3);
    if (mates.length === 3) {
      const card = take([epic.id, ...mates.map((item) => item.id)]);
      if (card) return card;
    }
  }
  for (const head of meta.filter((item) => rank(item.row.tier) >= RANK.稀有)) {
    const used = new Set([head.row.type]);
    const pick = [head];
    for (const item of meta) {
      if (item.id === head.id || used.has(item.row.type)) continue;
      pick.push(item);
      used.add(item.row.type);
      if (pick.length === 3) break;
    }
    if (pick.length === 3) {
      const card = take(pick.map((item) => item.id));
      if (card?.kind === "gold") return card;
    }
  }
  const heads = meta.filter((item) => rank(item.row.tier) >= RANK.少见).slice(0, 12);
  const pool = meta.slice(0, 40);
  let silver: PunkCard | null = null;
  for (const head of heads) {
    const others = pool.filter((item) => item.id !== head.id);
    for (let i = 0; i < others.length; i += 1) {
      for (let j = i + 1; j < others.length; j += 1) {
        if (new Set([head.row.sub, others[i].row.sub, others[j].row.sub]).size < 2) continue;
        const card = take([head.id, others[i].id, others[j].id]);
        if (!card || card.kind === "copper" || card.kind === "faux") continue;
        if (card.kind === "euv" || card.kind === "gold") return card;
        if (!silver) silver = card;
      }
    }
  }
  if (silver) return silver;
  const commons = meta.filter((item) => item.row.tier === "普通");
  for (let i = 0; i < commons.length; i += 1) {
    const mate = commons.find((item, index) => index > i && item.row.type !== commons[i].row.type);
    if (!mate) continue;
    const card = take([commons[i].id, mate.id]);
    if (card) return card;
  }
  if (commons.length >= 20 && new Set(commons.map((item) => item.row.type)).size > 1) {
    const other = commons.find((item) => item.row.type !== commons[0].row.type);
    if (other) {
      const rest = commons.filter((item) => item.id !== commons[0].id && item.id !== other.id).slice(0, 18);
      const card = take([commons[0].id, other.id, ...rest.map((item) => item.id)]);
      if (card) return card;
    }
  }
  return null;
}

export function deskFeeBps(card: PunkCard, desk: Desk): number {
  return card.main === desk ? card.feeMain : card.feeAll;
}

export const DESK_LABEL: Record<Desk, string> = {
  spot: "现货",
  perp: "永续",
  circuit: "电路",
  launch: "发射",
};
