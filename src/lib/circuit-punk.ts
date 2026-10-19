export const CPUNK_SUPPLY = 10_000;
export const CPUNK_RESERVE = 7_000;
export const CPUNK_NAME = "电路朋克";
export const CPUNK_SYMBOL = "CPUNK";
export const CPUNK_BLURB = "向中本聪致敬。TAPEOUT 社区的历史纪念。";

// 120 source pictures, collage and one duplicate left out.
// 人像 52, 吉祥物 28, 标识 18, 抽象 14, 场景 8.
// The 9 / 24 / 88 slots match the punk alien, ape and zombie counts.
// The other 9,879 follow that 52:28:18:14:8 split.
const TYPES = [
  { name: "极紫外晶粒", n: 9, tier: "传说" },
  { name: "键合巨像", n: 24, tier: "史诗" },
  { name: "报废晶粒", n: 88, tier: "稀有" },
  { name: "晶圆人像", n: 4281, tier: "普通" },
  { name: "吉祥晶粒", n: 2305, tier: "普通" },
  { name: "对准标记", n: 1482, tier: "少见" },
  { name: "缺陷图样", n: 1153, tier: "少见" },
  { name: "纪念版图", n: 658, tier: "少见" },
] as const;

export function census() {
  return TYPES.map((row) => ({ name: row.name, n: row.n, tier: row.tier }));
}

type Punk = {
  id: number;
  type: string;
  tier: string;
  weight: number;
  sub: string;
  metal: string;
  eye: string;
  bond: string;
  pack: string;
};

const ORDER = buildOrder();

function mix(n: number): number {
  let x = (n + 0x9e3779b9) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function buildOrder(): Uint8Array {
  const bag: number[] = [];
  TYPES.forEach((row, index) => {
    for (let i = 0; i < row.n; i += 1) bag.push(index);
  });
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = mix(i + 17) % (i + 1);
    const swap = bag[i];
    bag[i] = bag[j];
    bag[j] = swap;
  }
  return Uint8Array.from(bag);
}

function pick<T>(id: number, salt: number, rows: { name: T; w: number }[]): T {
  const total = rows.reduce((sum, row) => sum + row.w, 0);
  let roll = mix(id * 97 + salt) % total;
  for (const row of rows) {
    if (roll < row.w) return row.name;
    roll -= row.w;
  }
  return rows[0].name;
}

const SUB = [
  { name: "轻掺杂硅", w: 4000 },
  { name: "中掺杂硅", w: 2500 },
  { name: "重掺杂硅", w: 1500 },
  { name: "本征硅", w: 800 },
  { name: "氧化层", w: 700 },
  { name: "氮化镓", w: 300 },
  { name: "碳化硅", w: 200 },
];
const METAL = [
  { name: "无金属", w: 2800 },
  { name: "铝互连", w: 2200 },
  { name: "铜互连", w: 1600 },
  { name: "金互连", w: 900 },
  { name: "钴盖帽", w: 44 },
  { name: "紫光刻胶", w: 500 },
  { name: "钨栓塞", w: 400 },
  { name: "绿胶", w: 200 },
  { name: "高顶盖帽", w: 115 },
];
const EYE = [
  { name: "键合点", w: 5200 },
  { name: "遮光层", w: 527 },
  { name: "经典遮光", w: 502 },
  { name: "牛角框", w: 535 },
  { name: "眼罩", w: 293 },
  { name: "三维眼镜", w: 286 },
  { name: "激光对准", w: 120 },
];
const BOND = [
  { name: "钝化", w: 4200 },
  { name: "引线", w: 2459 },
  { name: "探针", w: 961 },
  { name: "针孔", w: 644 },
  { name: "金属胡须", w: 420 },
  { name: "开槽", w: 380 },
  { name: "金凸点", w: 169 },
  { name: "崩边", w: 78 },
];
const PACK = [
  { name: "裸片", w: 7000 },
  { name: "QFN", w: 1400 },
  { name: "BGA", w: 900 },
  { name: "WLCSP", w: 500 },
  { name: "陶瓷盖", w: 200 },
];

export function punk(id: number): Punk {
  if (id < 1 || id > CPUNK_SUPPLY) throw new Error("id");
  const type = TYPES[ORDER[id - 1]];
  const bond = pick(id, 4, BOND);
  const eye = pick(id, 3, EYE);
  const metal = pick(id, 2, METAL);
  let tier = type.tier;
  if (type.name === "晶圆人像" || type.name === "吉祥晶粒" || type.name === "纪念版图") {
    if (eye === "三维眼镜" || metal === "钴盖帽" || bond === "崩边") tier = "稀有";
    else if (bond === "探针" || bond === "金凸点" || metal === "高顶盖帽" || metal === "紫光刻胶") tier = "少见";
  }
  return {
    id,
    type: type.name,
    tier,
    weight: type.n,
    sub: type.name === "极紫外晶粒" ? "极紫外" : type.name === "报废晶粒" ? "报废硅" : type.name === "键合巨像" ? "厚铜" : pick(id, 1, SUB),
    metal,
    eye,
    bond,
    pack: pick(id, 5, PACK),
  };
}

export function sampleIds(): number[] {
  const want = TYPES.map((row) => row.name);
  const found: number[] = [];
  const seen = new Set<string>();
  for (let id = 1; id <= CPUNK_SUPPLY && seen.size < want.length; id += 1) {
    const row = punk(id);
    if (seen.has(row.type)) continue;
    seen.add(row.type);
    found.push(id);
  }
  return found.slice(0, 8);
}

const PAL = [
  "#638596", "#000000", "#ffffff", "#1b1b1b", "#6b3a1f", "#c4524a", "#e6c15a", "#3a2a6a",
  "#7a3e9a", "#2f6b3a", "#f3d2b3", "#e0ac7a", "#8d5524", "#f6e7d8",
  "#c68642", "#d7a48a", "#4a3728", "#c8f542", "#7da269", "#6b4423",
  "#d7dde6", "#f2f2f2", "#111111", "#ffd36b", "#8fd3ff", "#e8eef2",
];

const INK: Record<string, string> = {
  无金属: "",
  铝互连: "#1b1b1b",
  铜互连: "#6b3a1f",
  金互连: "#e6c15a",
  钴盖帽: "#3a2a6a",
  紫光刻胶: "#7a3e9a",
  钨栓塞: "#c4524a",
  绿胶: "#2f6b3a",
  高顶盖帽: "#1b1b1b",
};
const SKIN: Record<string, string> = {
  轻掺杂硅: "#f3d2b3",
  中掺杂硅: "#e0ac7a",
  重掺杂硅: "#8d5524",
  本征硅: "#f6e7d8",
  氧化层: "#c68642",
  氮化镓: "#d7a48a",
  碳化硅: "#4a3728",
  极紫外: "#c8f542",
  报废硅: "#7da269",
  厚铜: "#6b4423",
};

const SHADE: Record<string, string> = {
  轻掺杂硅: "#e0ac7a",
  中掺杂硅: "#c68642",
  重掺杂硅: "#4a3728",
  本征硅: "#d7a48a",
  氧化层: "#6b4423",
  氮化镓: "#c68642",
  碳化硅: "#1b1b1b",
  极紫外: "#2f6b3a",
  报废硅: "#2f6b3a",
  厚铜: "#4a3728",
};

function storeZlib(raw: Buffer): Buffer {
  const len = raw.length;
  const out = Buffer.alloc(2 + 5 + len + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  out[2] = 0x01;
  out.writeUInt16LE(len, 3);
  out.writeUInt16LE(~len & 0xffff, 5);
  raw.copy(out, 7);
  let a = 1;
  let b = 0;
  for (let i = 0; i < len; i += 1) {
    a = (a + raw[i]) % 65521;
    b = (b + a) % 65521;
  }
  out.writeUInt32BE(((b << 16) | a) >>> 0, 7 + len);
  return out;
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, tail]);
}

function pngIndexed(pixels: number[], palette: string[]): Buffer {
  const raw = Buffer.alloc(24 * 25);
  for (let y = 0; y < 24; y += 1) {
    raw[y * 25] = 0;
    for (let x = 0; x < 24; x += 1) raw[y * 25 + 1 + x] = pixels[y * 24 + x];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(24, 0);
  ihdr.writeUInt32BE(24, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = Buffer.alloc(palette.length * 3);
  palette.forEach((hex, i) => {
    plte[i * 3] = Number.parseInt(hex.slice(1, 3), 16);
    plte[i * 3 + 1] = Number.parseInt(hex.slice(3, 5), 16);
    plte[i * 3 + 2] = Number.parseInt(hex.slice(5, 7), 16);
  });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("PLTE", plte),
    chunk("IDAT", storeZlib(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function idx(hex: string): number {
  const at = PAL.indexOf(hex);
  return at >= 0 ? at : 0;
}

export function punkPng(id: number): Buffer {
  const row = punk(id);
  const g = Array<number>(24 * 24).fill(idx("#638596"));
  const set = (x: number, y: number, hex: string) => {
    if (x < 0 || y < 0 || x > 23 || y > 23) return;
    g[y * 24 + x] = idx(hex);
  };
  const rect = (x: number, y: number, w: number, h: number, hex: string) => {
    for (let yy = 0; yy < h; yy += 1) for (let xx = 0; xx < w; xx += 1) set(x + xx, y + yy, hex);
  };
  const skin = SKIN[row.sub] ?? "#f3d2b3";
  const shade = SHADE[row.sub] ?? "#c68642";
  const hair = INK[row.metal] || "";
  const alien = row.type === "极紫外晶粒";
  const ape = row.type === "键合巨像";
  const zombie = row.type === "报废晶粒";
  const mascot = row.type === "吉祥晶粒";
  const mark = row.type === "对准标记";
  const hx = alien ? 8 : ape ? 6 : 7;
  const hy = alien ? 4 : ape ? 6 : 7;
  const hw = alien ? 8 : ape ? 12 : 10;
  const hh = alien ? 13 : ape ? 11 : 10;
  rect(hx - 1, hy - 1, hw + 2, hh + 2, "#000000");
  rect(hx, hy, hw, hh, skin);
  if (!alien && !mark) {
    const ew = ape ? 3 : 2;
    const eh = ape ? 5 : 3;
    rect(hx - ew, hy + 3, ew, eh, "#000000");
    rect(hx - ew + 1, hy + 4, ew - 1, eh - 2, skin);
    rect(hx + hw, hy + 3, ew, eh, "#000000");
    rect(hx + hw, hy + 4, ew - 1, eh - 2, skin);
  }
  if (mascot) {
    rect(hx + 1, hy - 4, 3, 4, "#000000");
    rect(hx + 2, hy - 3, 1, 2, skin);
    rect(hx + hw - 4, hy - 4, 3, 4, "#000000");
    rect(hx + hw - 3, hy - 3, 1, 2, skin);
  }
  const hat = row.metal === "钴盖帽" || row.metal === "高顶盖帽";
  const long = row.type === "晶圆人像" && mix(id) % 100 < 39;
  if (hair && !hat) {
    rect(hx, hy - 2, hw, 3, "#000000");
    rect(hx + 1, hy - 1, hw - 2, 2, hair);
    if (row.metal === "钨栓塞") {
      rect(hx + Math.floor(hw / 2) - 2, hy - 6, 4, 5, hair);
      rect(hx + Math.floor(hw / 2) - 2, hy - 6, 4, 1, "#000000");
    } else if (long) {
      rect(hx - 2, hy + 1, 3, 11, hair);
      rect(hx + hw - 1, hy + 1, 3, 11, hair);
    } else {
      rect(hx, hy + 1, 2, 3, hair);
      rect(hx + hw - 2, hy + 1, 2, 3, hair);
    }
  }
  if (hat) {
    rect(hx - 1, hy - 3, hw + 2, 3, "#000000");
    rect(hx, hy - 2, hw, 2, "#1b1b1b");
    if (row.metal === "高顶盖帽") {
      rect(hx + 2, 0, hw - 4, hy - 2, "#000000");
      rect(hx + 3, 1, hw - 6, hy - 4, "#1b1b1b");
    } else {
      rect(hx + 1, hy - 5, hw - 2, 3, "#3a2a6a");
    }
  }
  const eyeY = hy + (alien ? 5 : 3);
  const lx = hx + 1;
  const rx = hx + hw - 3;
  if (alien) {
    rect(hx, eyeY, 3, 4, "#000000");
    rect(hx + hw - 3, eyeY, 3, 4, "#000000");
    set(hx + 1, eyeY + 1, "#ffffff");
    set(hx + hw - 2, eyeY + 1, "#ffffff");
  } else if (zombie) {
    rect(lx, eyeY, 2, 2, "#000000");
    set(lx, eyeY, "#ffffff");
    rect(rx, eyeY + 1, 2, 1, "#111111");
  } else if (mark) {
    rect(lx, eyeY, 3, 1, "#000000");
    set(lx + 1, eyeY - 1, "#c4524a");
    set(lx + 1, eyeY + 1, "#c4524a");
    rect(rx - 1, eyeY, 3, 1, "#000000");
    set(rx, eyeY - 1, "#c4524a");
    set(rx, eyeY + 1, "#c4524a");
    set(hx + Math.floor(hw / 2), hy + 1, "#c4524a");
  } else {
    rect(lx, eyeY, 2, 2, "#000000");
    rect(rx, eyeY, 2, 2, "#000000");
    set(lx, eyeY, "#ffffff");
    set(rx, eyeY, "#ffffff");
  }
  if (!alien && !mark && (row.eye === "遮光层" || row.eye === "经典遮光" || row.eye === "三维眼镜" || row.eye === "牛角框")) {
    const frame = row.eye === "三维眼镜" ? "#8fd3ff" : row.eye === "经典遮光" ? "#111111" : row.eye === "牛角框" ? "#6b4423" : "#1b1b1b";
    rect(lx - 1, eyeY - 1, hw - 2, 1, frame);
    rect(lx - 1, eyeY, 3, 2, frame);
    rect(rx - 1, eyeY, 3, 2, frame);
    const leftLens = row.eye === "三维眼镜" ? "#8fd3ff" : "#111111";
    const rightLens = row.eye === "三维眼镜" ? "#c4524a" : "#111111";
    set(lx, eyeY + 1, leftLens);
    set(lx + 1, eyeY, leftLens);
    set(rx, eyeY + 1, rightLens);
    set(rx + 1, eyeY, rightLens);
  }
  if (row.eye === "眼罩") rect(lx - 1, eyeY, 4, 3, "#111111");
  if (row.eye === "激光对准" && !alien) {
    rect(0, eyeY + 1, 24, 1, "#c4524a");
    set(lx, eyeY, "#ffd36b");
    set(rx, eyeY, "#ffd36b");
  }
  const noseY = hy + (alien ? 9 : 6);
  if (!alien && !mark) {
    set(hx + Math.floor(hw / 2) - 1, noseY, shade);
    set(hx + Math.floor(hw / 2), noseY, shade);
  }
  const my = hy + hh - 3;
  if (ape) {
    rect(hx + 2, my - 1, hw - 4, 3, "#000000");
    rect(hx + 3, my, hw - 6, 1, "#ffffff");
  } else if (zombie) {
    rect(hx + 2, my, hw - 4, 2, "#111111");
    set(hx + 3, my, "#c4524a");
  } else if (row.bond === "崩边") {
    rect(hx + 3, my, hw - 6, 2, "#000000");
    rect(hx + 3, my, hw - 6, 1, "#ffffff");
  } else if (row.bond === "开槽") {
    rect(hx + 3, my, hw - 6, 1, "#c4524a");
  } else if (!mark) {
    rect(hx + 3, my, hw - 6, 1, shade);
  }
  if (row.bond === "金属胡须") rect(hx + 1, my - 1, hw - 2, 3, "#1b1b1b");
  if (row.bond === "探针") {
    rect(hx + hw - 1, my, 5, 1, "#f2f2f2");
    set(hx + hw + 3, my, "#c4524a");
  }
  if (row.bond === "针孔") set(hx + hw - 3, my - 2, shade);
  if (row.bond === "引线") set(hx + hw, hy + 5, "#e6c15a");
  if (row.type === "缺陷图样") {
    set(hx + 1, hy + 1, "#c4524a");
    set(hx + hw - 2, hy + 2, "#638596");
    set(hx + 2, hy + hh - 2, "#638596");
  }
  if (row.type === "纪念版图") {
    rect(hx + 1, hy - 3, hw - 2, 1, "#ffd36b");
    set(hx - 1, hy - 1, "#ffd36b");
    set(hx + hw, hy - 1, "#ffd36b");
  }
  rect(hx + 3, hy + hh, Math.max(2, hw - 6), 2, skin);
  if (row.bond === "金凸点") rect(hx + 2, hy + hh + 1, hw - 4, 1, "#e6c15a");
  const cloth = row.pack === "陶瓷盖" ? "#e8eef2" : "#1b1b1b";
  rect(3, 19, 18, 5, "#000000");
  rect(4, 19, 16, 5, cloth);
  if (row.pack === "QFN") {
    for (let pin = 0; pin < 4; pin += 1) {
      set(2, 19 + pin, "#d7dde6");
      set(21, 19 + pin, "#d7dde6");
    }
  }
  if (row.pack === "BGA") {
    set(7, 21, "#e6c15a");
    set(12, 22, "#e6c15a");
    set(16, 21, "#e6c15a");
  }
  if (row.pack === "WLCSP") rect(6, 19, 12, 1, "#d7dde6");
  return pngIndexed(g, PAL);
}

export function punkMeta(id: number, origin: string) {
  const row = punk(id);
  const root = origin.replace(/\/$/, "");
  return {
    name: `${CPUNK_NAME} #${id}`,
    description: CPUNK_BLURB,
    image: `${root}/api/circuit-punk/${id}.png`,
    attributes: [
      { trait_type: "类型", value: row.type },
      { trait_type: "权重", value: row.tier },
      { trait_type: "存世", value: row.weight },
      { trait_type: "衬底", value: row.sub },
      { trait_type: "金属层", value: row.metal },
      { trait_type: "对准", value: row.eye },
      { trait_type: "键合", value: row.bond },
      { trait_type: "封装", value: row.pack },
    ],
  };
}
