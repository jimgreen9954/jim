import { decodeFunctionResult, encodeFunctionData, parseEther } from "viem";
import { getLaunchMarket, type OsCard, type TokenQuote } from "@/lib/opensea-feed";
import { getProtocolNfts, getTapeoutLive, type LiveTransistor, type ProtocolCircuit, type TapeoutLive } from "@/lib/tapeout-live";
import { mintChipArt } from "@/lib/chip-art";
import { nickOf, readAvatar, readNicks, writeAvatar, writeNick } from "@/lib/nicks";
import { deskError, quoteBridge, quoteSwap, runBridge, runSwap, type BridgeDir, type SwapPair, type SwapSide } from "@/lib/asset-desk";
import { connectInjected, connectKind, currentAccount, getProvider, onAccount, onOpenLink, resumeInjected, walletLabel } from "@/lib/wallet";
import { bootGenesis } from "@/lib/genesis-desk";

type Injected = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (accounts: string[]) => void) => void;
};

type Announced = {
  info: { uuid: string; name: string; icon: string };
  provider: Injected;
};

const MARKET = "0xA6a80C1919a8326022d7c601a488888C13aA16E4";
const BSC = "0x38";
const OFFICIAL = [
  "0xcc42ba5de07f01b472a5b14cf45abcca79eb8087",
  "0xe2dfd802081c7a05341e20b6582b04b908e8550c",
  "0x1d23bf70ec6baad95f396ea38f8a8415119dfde6",
];

const bidAbi = [
  {
    name: "placeBid",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "transistors", type: "address" },
      { name: "tokenId", type: "uint8" },
      { name: "price", type: "uint96" },
      { name: "quantity", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "fillBid",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "quantity", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const erc1155 = [
  {
    name: "isApprovedForAll",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
] as const;

function bnbText(value: number | null): string {
  if (value == null || !(value > 0)) return "—";
  if (value < 0.001) return value.toFixed(8);
  if (value < 1) return value.toFixed(5);
  return value.toFixed(4);
}

function officialRank(row: LiveTransistor): number {
  const index = OFFICIAL.indexOf(row.token);
  return index < 0 ? 99 : index * 2 + row.tokenId;
}

function bnbFromWei(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "").slice(0, 8);
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

function ago(ts: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (sec < 60) return `${sec} 秒前`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`;
  return `${Math.floor(sec / 86400)} 天前`;
}

function tradeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : 0;
  if (code === 4001 || /user rejected|denied|cancel/i.test(text)) return "你在钱包里取消了，没有成交。";
  if (/数量要是|价格要写成|价格超出|当前买价只剩|数量太大/.test(text)) return text;
  if (/insufficient funds/i.test(text)) return "BNB 不够锁这笔买单。";
  if (text === "nowallet") return "没有连上钱包。";
  return text ? `没发出去：${text.slice(0, 160)}` : "没发出去。";
}

async function ensureBsc(eth: Injected): Promise<void> {
  const chain = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
  if (Number.parseInt(chain, 16) === 56) return;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BSC }] });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number((error as { code?: number }).code) : 0;
    if (code !== 4902) throw error;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BSC,
          chainName: "BNB Smart Chain",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bsc-dataseed.binance.org"],
          blockExplorerUrls: ["https://bscscan.com"],
        },
      ],
    });
  }
}

async function sendTx(
  eth: Injected,
  tx: { from: string; to: string; data: `0x${string}`; value?: bigint },
): Promise<string> {
  const payload: Record<string, string> = { from: tx.from, to: tx.to, data: tx.data, chainId: BSC };
  if (tx.value != null) payload.value = `0x${tx.value.toString(16)}`;
  const hash = await eth.request({ method: "eth_sendTransaction", params: [payload] });
  return String(hash);
}

function money(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;
}

function amt(value: number): string {
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (value >= 1) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function floorText(card: OsCard): string {
  return card.floor == null ? "暂无" : `${amt(card.floor)} ${card.symbol}`;
}

function face(img: HTMLImageElement, src: string, drop: HTMLElement) {
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.src = src;
  img.addEventListener("error", () => drop.remove());
}

function quoteText(node: HTMLElement, quote: TokenQuote | undefined) {
  node.replaceChildren();
  if (!quote || quote.price == null) {
    node.textContent = "暂无公开价";
    return;
  }
  node.append(document.createTextNode(`${money(quote.price)} · `));
  const change = document.createElement("i");
  const delta = quote.change ?? 0;
  change.className = delta >= 0 ? "up" : "down";
  change.textContent = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
  node.append(change);
}

export function bootLaunch(host: HTMLElement): () => void {
  const ac = new AbortController();
  const opt = { signal: ac.signal };
  let alive = true;
  const open = (id: string) => {
    host.querySelectorAll(".page").forEach((node) => node.classList.remove("active"));
    host.querySelector("#page-" + id)?.classList.add("active");
    host.querySelectorAll(".nav-item").forEach((node) => node.classList.remove("active"));
    host.querySelector(`.nav-item[data-page="${id}"]`)?.classList.add("active");
    const scroller = host.querySelector(".content");
    if (scroller) scroller.scrollTop = 0;
  };
  (window as unknown as { switchPage?: (id: string) => void }).switchPage = open;

  let cat = "all";
  let query = "";
  let span: "vol1d" | "vol7d" | "vol30d" = "vol1d";
  const cards: OsCard[] = [];

  const apply = () => {
    host.querySelectorAll<HTMLElement>(".cat-item").forEach((node) => {
      const name = (node.dataset.name || "").toLowerCase();
      const okCat = cat === "all" || node.dataset.cat === cat;
      const okQuery = !query || name.includes(query);
      node.hidden = !(okCat && okQuery);
    });
    host.querySelectorAll<HTMLElement>(".js-vol").forEach((node) => {
      const card = cards.find((item) => item.slug === node.dataset.slug);
      if (!card) return;
      node.textContent = `${amt(card[span])} ${card.symbol}`;
    });
    host.querySelectorAll<HTMLElement>(".js-sales").forEach((node) => {
      const card = cards.find((item) => item.slug === node.dataset.slug);
      if (!card) return;
      const key = span === "vol7d" ? "sales7d" : span === "vol30d" ? "sales30d" : "sales1d";
      node.textContent = String(card[key]);
    });
    for (const id of ["filter-empty", "market-empty"]) {
      const note = host.querySelector<HTMLElement>("#" + id);
      if (!note) continue;
      const scope = id === "market-empty" ? host.querySelector("#page-market") : host.querySelector("#page-discover");
      const visible = scope?.querySelectorAll(".cat-item:not([hidden])").length ?? 0;
      note.hidden = visible > 0;
    }
  };

  const setCat = (next: string) => {
    cat = next;
    host.querySelectorAll<HTMLElement>("[data-filter]").forEach((node) => {
      node.classList.toggle("on", node.dataset.filter === next);
    });
    apply();
  };

  host.querySelectorAll<HTMLElement>("[data-filter]").forEach((node) => {
    node.addEventListener("click", () => setCat(node.dataset.filter || "all"), opt);
  });
  host.querySelectorAll<HTMLElement>("[data-span]").forEach((node) => {
    node.addEventListener("click", () => {
      const key = node.dataset.span;
      span = key === "vol7d" || key === "vol30d" ? key : "vol1d";
      host.querySelectorAll<HTMLElement>("[data-span]").forEach((chip) => {
        chip.classList.toggle("on", chip.dataset.span === span);
      });
      apply();
    }, opt);
  });
  host.querySelector<HTMLInputElement>(".search input")?.addEventListener("input", (event) => {
    query = (event.target as HTMLInputElement).value.trim().toLowerCase();
    apply();
  }, opt);

  const saved = window.localStorage.getItem("tape-theme") === "dark" ? "dark" : "light";
  const themeBtn = host.querySelector<HTMLButtonElement>("#btn-theme");
  const paintTheme = (mode: "dark" | "light") => {
    host.dataset.theme = mode;
    if (themeBtn) themeBtn.textContent = mode === "dark" ? "白天" : "深夜";
    window.localStorage.setItem("tape-theme", mode);
  };
  paintTheme(saved);
  themeBtn?.addEventListener("click", () => paintTheme(host.dataset.theme === "dark" ? "light" : "dark"), opt);

  const launchMult = host.querySelector<HTMLInputElement>("#launch-mult");
  const launchSupply = host.querySelector<HTMLInputElement>("#launch-supply");
  const launchReserve = host.querySelector<HTMLInputElement>("#launch-reserve");
  const launchPrice = host.querySelector("#launch-price");
  const paintLaunch = () => {
    const mult = Math.max(1, Math.floor(Number(launchMult?.value) || 1));
    const supply = Math.max(0, Math.floor(Number(launchSupply?.value) || 0));
    let reserve = Math.max(0, Math.floor(Number(launchReserve?.value) || 0));
    if (reserve > supply) reserve = supply;
    if (launchReserve && document.activeElement !== launchReserve && String(reserve) !== launchReserve.value) {
      launchReserve.value = String(reserve);
    }
    const bem = (mult * 0.001).toLocaleString("en-US", { maximumFractionDigits: 6 });
    if (launchPrice) launchPrice.textContent = `公开铸造价 ${mult} TAPE + ${bem} BEM · 预留 ${reserve} / ${supply}`;
  };
  for (const input of [launchMult, launchSupply, launchReserve]) {
    input?.addEventListener("input", paintLaunch, opt);
  }
  paintLaunch();

  const GATES = ["NAND", "NOR", "LATCH", "INV", "MUX", "DFF"];
  const NODES = ["28nm", "14nm", "7nm", "5nm", "3nm"];
  const LAYERS = [2, 3, 4, 6, 8, 10, 12];
  const PACKS = ["裸片", "QFN", "BGA", "WLCSP"];
  const VOLTS = ["0.55V", "0.7V", "0.8V", "1.0V", "1.2V"];
  const RARITY = [
    { name: "普通", weight: 70, color: "#6b7280" },
    { name: "少见", weight: 18, color: "#3b82f6" },
    { name: "稀有", weight: 8, color: "#7c3aed" },
    { name: "史诗", weight: 3, color: "#d4a017" },
    { name: "传说", weight: 1, color: "#e11d48" },
  ];
  const TRAIT_SPACE = 64 * VOLTS.length * PACKS.length * LAYERS.length * NODES.length * GATES.length;
  let traitSalt = 1;
  let lastShown: { id: number; gate: string; node: string; layer: number; pack: string; volt: string; die: string; rare: string }[] = [];
  const generated = new Map<number, string>();
  const traitSum = host.querySelector("#trait-sum");
  const traitGrid = host.querySelector("#trait-grid");
  const rollTraits = () => {
    if (!traitGrid || !traitSum) return;
    const supply = Math.max(0, Math.floor(Number(launchSupply?.value) || 0));
    const name = host.querySelector<HTMLInputElement>("#launch-name")?.value.trim() || "Tape";
    const symbol = host.querySelector<HTMLInputElement>("#launch-symbol")?.value.trim() || "TAPE";
    traitGrid.replaceChildren();
    if (supply < 1) {
      traitSum.textContent = "总量至少是 1，才能批量生成。";
      return;
    }
    const count = Math.min(supply, 2000);
    let seed = traitSalt;
    for (const ch of `${name}:${symbol}:${supply}`) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
    const next = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const used = new Set<number>();
    const tallies = new Map(RARITY.map((item) => [item.name, 0]));
    const preview: { id: number; gate: string; node: string; layer: number; pack: string; volt: string; die: string; rare: string; color: string }[] = [];
    let guard = 0;
    while (preview.length < count && guard < count * 8) {
      guard += 1;
      const pick = Math.floor(next() * TRAIT_SPACE);
      if (used.has(pick)) continue;
      used.add(pick);
      let n = pick;
      const die = n % 64;
      n = Math.floor(n / 64);
      const volt = VOLTS[n % VOLTS.length] ?? VOLTS[0];
      n = Math.floor(n / VOLTS.length);
      const pack = PACKS[n % PACKS.length] ?? PACKS[0];
      n = Math.floor(n / PACKS.length);
      const layer = LAYERS[n % LAYERS.length] ?? LAYERS[0];
      n = Math.floor(n / LAYERS.length);
      const node = NODES[n % NODES.length] ?? NODES[0];
      n = Math.floor(n / NODES.length);
      const gate = GATES[n % GATES.length] ?? GATES[0];
      const roll = next() * 100;
      let cursor = 0;
      let rare = RARITY[0];
      for (const item of RARITY) {
        cursor += item.weight;
        if (roll < cursor) {
          rare = item;
          break;
        }
      }
      tallies.set(rare.name, (tallies.get(rare.name) ?? 0) + 1);
      preview.push({
        id: preview.length + 1,
        gate,
        node,
        layer,
        pack,
        volt,
        die: `${"ABCDEFGH"[Math.floor(die / 8)]}${((die % 8) + 1)}`,
        rare: rare.name,
        color: rare.color,
      });
    }
    const tallyText = RARITY.map((item) => `${item.name} ${tallies.get(item.name) ?? 0}`).join(" · ");
    traitSum.textContent =
      count < supply
        ? `先生成前 ${count} 张，属性组合不重复。${tallyText}。页面只展示 12 张。还没上链。`
        : `已生成 ${count} 张，属性组合不重复。${tallyText}。页面只展示 12 张。还没上链。`;
    const shown = [];
    for (const tier of [...RARITY].reverse()) {
      const hit = preview.find((item) => item.rare === tier.name);
      if (hit) shown.push(hit);
    }
    for (const item of preview) {
      if (shown.length >= 12) break;
      if (!shown.includes(item)) shown.push(item);
    }
    for (const item of shown) {
      const card = document.createElement("div");
      card.className = "trait-card";
      card.dataset.traitId = String(item.id);
      const slot = document.createElement("div");
      slot.className = "art-slot";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 64 64");
      const body = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      body.setAttribute("x", "10");
      body.setAttribute("y", "10");
      body.setAttribute("width", "44");
      body.setAttribute("height", "44");
      body.setAttribute("rx", "6");
      body.setAttribute("fill", item.color);
      svg.append(body);
      const pins = 4 + (item.layer % 5);
      for (let pin = 0; pin < pins; pin += 1) {
        const mark = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        const along = 12 + pin * (40 / pins);
        mark.setAttribute("x", pin % 2 === 0 ? "4" : "54");
        mark.setAttribute("y", String(along));
        mark.setAttribute("width", "6");
        mark.setAttribute("height", "3");
        mark.setAttribute("fill", item.color);
        svg.append(mark);
      }
      const meta = document.createElement("div");
      const title = document.createElement("b");
      title.textContent = `#${String(item.id).padStart(3, "0")} ${item.gate}`;
      const line = document.createElement("span");
      line.textContent = `${item.node} · ${item.layer}层 · ${item.volt}`;
      const line2 = document.createElement("span");
      line2.textContent = `${item.pack} · 晶圆 ${item.die}`;
      const rare = document.createElement("span");
      rare.className = "rare";
      rare.style.color = item.color;
      rare.textContent = item.rare;
      meta.append(title, line, line2, rare);
      slot.append(svg);
      card.append(slot, meta);
      traitGrid.append(card);
    }
    lastShown = preview;
  };
  host.querySelector("#trait-roll")?.addEventListener("click", () => {
    traitSalt += 1;
    generated.clear();
    rollTraits();
  }, opt);
  launchSupply?.addEventListener("change", () => {
    generated.clear();
    rollTraits();
  }, opt);
  rollTraits();

  type Shown = { id: number; gate: string; node: string; layer: number; pack: string; volt: string; die: string; rare: string };
  let artMode: "upload" | "key" | "platform" = "upload";
  let artStyle: "punk" | "real" = "punk";
  let uploadUrls: string[] = [];
  let artBusy = false;
  const artMsg = host.querySelector("#art-msg");
  const artKey = host.querySelector<HTMLInputElement>("#art-key");
  const artFiles = host.querySelector<HTMLInputElement>("#art-files");
  const artStyleBox = host.querySelector<HTMLElement>("#art-style");
  const artGo = host.querySelector<HTMLButtonElement>("#art-go");
  if (artKey) {
    const savedKey = window.sessionStorage.getItem("tape-art-key") ?? "";
    if (savedKey) artKey.value = savedKey;
  }
  const sayArt = (text: string) => {
    if (artMsg) artMsg.textContent = text;
  };
  const paintArtMode = () => {
    host.querySelectorAll<HTMLButtonElement>("[data-art]").forEach((node) => {
      node.classList.toggle("on", node.dataset.art === artMode);
    });
    host.querySelectorAll<HTMLButtonElement>("[data-look]").forEach((node) => {
      node.classList.toggle("on", node.dataset.look === artStyle);
    });
    if (artKey) artKey.hidden = artMode !== "key";
    if (artFiles) artFiles.hidden = artMode !== "upload";
    if (artStyleBox) artStyleBox.hidden = artMode === "upload";
    if (artGo) artGo.hidden = artMode === "upload";
    sayArt(
      artMode === "upload"
        ? "上传的图按顺序套到预览上。不会拿去假充 AI 图。"
        : artMode === "key"
          ? "用你的 Key 真出图，每次 4 张。Key 只留在这台浏览器。"
          : "平台默认真出图，每次 4 张，花的是站点额度。可选朋克或真实。",
    );
  };
  const applyImages = () => {
    host.querySelectorAll<HTMLElement>(".trait-card").forEach((card, index) => {
      const slot = card.querySelector(".art-slot");
      if (!slot) return;
      const id = Number(card.dataset.traitId);
      const url = artMode === "upload" ? uploadUrls[index] : generated.get(id);
      if (!url) return;
      const img = document.createElement("img");
      img.alt = "";
      img.src = url;
      slot.replaceChildren(img);
    });
  };
  host.querySelectorAll<HTMLButtonElement>("[data-art]").forEach((node) => {
    node.addEventListener("click", () => {
      const nextMode = node.dataset.art;
      artMode = nextMode === "key" || nextMode === "platform" ? nextMode : "upload";
      paintArtMode();
      applyImages();
    }, opt);
  });
  host.querySelectorAll<HTMLButtonElement>("[data-look]").forEach((node) => {
    node.addEventListener("click", () => {
      artStyle = node.dataset.look === "real" ? "real" : "punk";
      paintArtMode();
    }, opt);
  });
  artFiles?.addEventListener("change", () => {
    for (const url of uploadUrls) URL.revokeObjectURL(url);
    uploadUrls = [];
    const files = [...(artFiles.files ?? [])].filter((file) => file.type.startsWith("image/") && file.size <= 8_000_000).slice(0, 12);
    uploadUrls = files.map((file) => URL.createObjectURL(file));
    applyImages();
    sayArt(uploadUrls.length ? `已套上 ${uploadUrls.length} 张你上传的图。` : "没有读到可用的图片。");
  }, opt);
  artGo?.addEventListener("click", () => {
    if (artBusy || !traitGrid) return;
    const key = artKey?.value.trim() ?? "";
    if (artMode === "key" && key.length < 8) {
      sayArt("先贴上你的 Key。");
      return;
    }
    const cards = [...traitGrid.querySelectorAll<HTMLElement>(".trait-card")].slice(0, 4);
    if (cards.length === 0) {
      sayArt("先生成属性，再出图。");
      return;
    }
    artBusy = true;
    if (artGo) artGo.disabled = true;
    void (async () => {
      if (artMode === "key" && artKey) window.sessionStorage.setItem("tape-art-key", key);
      for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        if (!card) continue;
        sayArt(`正在出第 ${index + 1} / ${cards.length} 张…`);
        const id = Number(card.dataset.traitId);
        const item = lastShown.find((row) => row.id === id);
        const prompt = item
          ? `${item.gate} foundry chip, ${item.node}, ${item.layer} metal layers, ${item.pack} package, wafer ${item.die}, ${item.rare} rarity`
          : "unique foundry chip";
        const result = await mintChipArt({ data: { style: artStyle, prompt, key: artMode === "key" ? key : "" } });
        if (!result.ok) {
          sayArt(result.error);
          return;
        }
        generated.set(id, result.image);
        applyImages();
      }
      sayArt(artMode === "platform" ? "这 4 张是平台默认出的。" : "这 4 张是用你的 Key 出的。");
    })()
      .catch(() => sayArt("出图没有完成，没有换成假图。"))
      .finally(() => {
        artBusy = false;
        if (artGo) artGo.disabled = false;
      });
  }, opt);
  paintArtMode();

  const sheet = host.querySelector<HTMLElement>("#wallet-sheet");
  const msg = host.querySelector<HTMLElement>("#wallet-msg");
  const extra = host.querySelector<HTMLElement>("#wallet-extra");
  extra?.replaceChildren();
  const walletBtn = host.querySelector<HTMLButtonElement>("#btn-wallet");
  const announced: Announced[] = [];

  const showSheet = (openSheet: boolean) => {
    if (sheet) sheet.hidden = !openSheet;
  };
  walletBtn?.addEventListener("click", () => showSheet(true), opt);
  host.querySelector("#wallet-close")?.addEventListener("click", () => showSheet(false), opt);
  sheet?.addEventListener("click", (event) => {
    if (event.target === sheet) showSheet(false);
  }, opt);

  let liveRows: LiveTransistor[] = [];
  let refreshHolds = () => {};

  let balGen = 0;
  const paintBalances = (address: string | null) => {
    const box = host.querySelector("#wallet-balances");
    if (!box) return;
    const gen = ++balGen;
    box.replaceChildren();
    if (!address) {
      const line = document.createElement("p");
      line.className = "sub";
      line.textContent = "连接 OKX 钱包后，这里显示这个地址在 BSC 和 X Layer 的 BNB、OKB、BEM、USDT。";
      box.append(line);
      return;
    }
    const rows = [
      { chain: "BSC", symbol: "BNB", rpc: "https://bsc-dataseed.binance.org", native: true, decimals: 18 },
      { chain: "BSC", symbol: "BEM", rpc: "https://bsc-dataseed.binance.org", token: "0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a", decimals: 8 },
      { chain: "BSC", symbol: "USDT", rpc: "https://bsc-dataseed.binance.org", token: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { chain: "X Layer", symbol: "OKB", rpc: "https://rpc.xlayer.tech", native: true, decimals: 18 },
      { chain: "X Layer", symbol: "BEM", rpc: "https://rpc.xlayer.tech", token: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952", decimals: 8 },
    ];
    void Promise.all(rows.map(async (row) => {
      const data = row.native ? undefined : `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
      const res = await fetch(row.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: row.native ? "eth_getBalance" : "eth_call",
          params: row.native ? [address, "latest"] : [{ to: row.token, data }, "latest"],
        }),
        signal: AbortSignal.timeout(12000),
      });
      const body = (await res.json()) as { result?: string };
      if (!body.result || body.result === "0x") return null;
      const value = Number(BigInt(body.result)) / 10 ** row.decimals;
      return { chain: row.chain, symbol: row.symbol, value };
    })).then((items) => {
      if (!alive || gen !== balGen) return;
      box.replaceChildren();
      for (const item of items) {
        if (!item || !Number.isFinite(item.value)) continue;
        const chip = document.createElement("div");
        chip.className = "bal-chip";
        const amount = document.createElement("b");
        amount.textContent = item.value.toLocaleString("en-US", { maximumFractionDigits: 4 });
        const span = document.createElement("span");
        span.textContent = `${item.symbol} · ${item.chain}`;
        chip.append(amount, span);
        box.append(chip);
      }
    }).catch(() => {
      if (!alive || gen !== balGen) return;
    });
  };

  const paintIdentity = (address: string | null) => {
    const nick = address ? nickOf(address, readNicks()) : "";
    const avatar = address ? readAvatar(address) : "";
    const src = avatar || "/tape-launch/logo.png";
    for (const id of ["profile-av", "assets-av"]) {
      const img = host.querySelector<HTMLImageElement>("#" + id);
      if (img) img.src = src;
    }
    const title = host.querySelector("#profile-name");
    if (title) title.textContent = nick || "我的";
    const assets = host.querySelector("#assets-name");
    if (assets) assets.textContent = nick || "我的资产";
    const nickInput = host.querySelector<HTMLInputElement>("#profile-nick");
    if (nickInput && document.activeElement !== nickInput) nickInput.value = nick;
    if (walletBtn) walletBtn.textContent = address ? `${walletLabel()} · ${nick || short(address)}` : "连接钱包";
  };

  const paintAccount = (address: string | null) => {
    paintIdentity(address);
    for (const id of ["assets-addr", "profile-addr"]) {
      const node = host.querySelector("#" + id);
      if (node) node.textContent = address ? `${short(address)} · 已连接` : "未连接钱包";
    }
    const bal = host.querySelector("#bal-native");
    const label = host.querySelector("#bal-label");
    if (!address) {
      if (bal) bal.textContent = "—";
      if (label) label.textContent = "OKX 钱包 · 链上";
      paintBalances(null);
      refreshHolds();
      return;
    }
    const eth = getProvider();
    if (!eth) {
      paintBalances(address);
      refreshHolds();
      return;
    }
    void (async () => {
      try {
        const chain = String(await eth.request({ method: "eth_chainId" }));
        const raw = String(await eth.request({ method: "eth_getBalance", params: [address, "latest"] }));
        const value = Number(BigInt(raw)) / 1e18;
        const chainId = Number.parseInt(chain, 16);
        const symbol = chainId === 56 ? "BNB" : chainId === 196 ? "OKB" : chainId === 1 ? "ETH" : "原生币";
        if (currentAccount() !== address) return;
        if (bal) bal.textContent = value.toLocaleString("en-US", { maximumFractionDigits: 4 });
        if (label) label.textContent = `${walletLabel()} · ${symbol}`;
      } catch {
        if (bal) bal.textContent = "—";
      }
    })();
    paintBalances(address);
    refreshHolds();
  };
  const stopAccount = onAccount(paintAccount);
  const stopLink = onOpenLink((link) => {
    if (msg && link) msg.textContent = "已弹出钱包连接，请在 App 里确认";
  });

  const fail = (error: unknown) => {
    if (!msg) return;
    const text = error instanceof Error ? error.message : "";
    msg.textContent = text === "binanceapp" ? "浏览器里没有币安钱包，请用币安 App 打开这个页面" : "没有连上。请安装钱包，或换 OKX / 币安 / 浏览器钱包";
  };

  const connectNamed = async (which: "okx" | "binance") => {
    if (msg) msg.textContent = "正在唤起钱包…";
    try {
      await connectKind(which);
      showSheet(false);
    } catch (error) {
      fail(error);
    }
  };
  host.querySelector('[data-wallet="okx"]')?.addEventListener("click", () => void connectNamed("okx"), opt);
  host.querySelector('[data-wallet="binance"]')?.addEventListener("click", () => void connectNamed("binance"), opt);
  void resumeInjected();

  const profileMsg = host.querySelector("#profile-msg");
  const sayProfile = (text: string) => {
    if (profileMsg) profileMsg.textContent = text;
  };
  const shrinkAvatar = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("canvas"));
          return;
        }
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      img.src = url;
    });
  host.querySelector("#profile-save")?.addEventListener("click", () => {
    const address = currentAccount();
    if (!address) {
      sayProfile("先连接钱包，头像和昵称才绑到这个地址。");
      showSheet(true);
      return;
    }
    const nickInput = host.querySelector<HTMLInputElement>("#profile-nick");
    writeNick(address, nickInput?.value ?? "");
    const file = host.querySelector<HTMLInputElement>("#profile-file")?.files?.[0];
    if (!file) {
      paintIdentity(address);
      sayProfile("昵称已保存。只存在这台浏览器。");
      return;
    }
    if (!file.type.startsWith("image/") || file.size > 8_000_000) {
      sayProfile("请选一张 8MB 以内的图片。");
      return;
    }
    void shrinkAvatar(file)
      .then((data) => {
        if (data.length > 140_000) {
          sayProfile("这张图压缩后还是太大，换一张。");
          return;
        }
        writeAvatar(address, data);
        paintIdentity(address);
        sayProfile("头像和昵称已保存。只存在这台浏览器。");
      })
      .catch(() => sayProfile("这张图读不了。"));
  }, opt);
  host.querySelector("#profile-clear")?.addEventListener("click", () => {
    const address = currentAccount();
    if (!address) {
      sayProfile("先连接钱包。");
      showSheet(true);
      return;
    }
    writeAvatar(address, "");
    const file = host.querySelector<HTMLInputElement>("#profile-file");
    if (file) file.value = "";
    paintIdentity(address);
    sayProfile("已去掉头像。");
  }, opt);

  const addWallet = (name: string, icon: string, provider: Injected) => {
    if (!extra) return;
    const button = document.createElement("button");
    button.className = "wbtn";
    button.type = "button";
    if (icon.startsWith("data:") || icon.startsWith("https://")) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = icon;
      button.append(img);
    }
    button.append(document.createTextNode(name));
    button.addEventListener("click", () => {
      if (msg) msg.textContent = "正在唤起钱包…";
      void connectInjected(provider)
        .then(() => showSheet(false))
        .catch(fail);
    });
    extra.append(button);
  };

  const onAnnounce = (event: Event) => {
    const detail = (event as CustomEvent<Announced>).detail;
    if (!detail?.info?.uuid || announced.some((item) => item.info.uuid === detail.info.uuid)) return;
    announced.push(detail);
    addWallet(detail.info.name, detail.info.icon, detail.provider);
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce, opt);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const timer = window.setTimeout(() => {
    const eth = (window as unknown as { ethereum?: Injected }).ethereum;
    if (eth && announced.length === 0) addWallet("浏览器钱包", "", eth);
  }, 400);

  host.querySelectorAll<HTMLElement>(".need-wallet").forEach((node) => {
    node.addEventListener("click", () => {
      if (!getProvider()) showSheet(true);
      else if (msg) {
        showSheet(true);
        msg.textContent = "钱包已连接。本地芯片挂单还没接成交合约，OpenSea 系列请点卡片上的链接。";
      }
    }, opt);
  });

  const mount = (list: OsCard[]) => {
    if (!alive) return;
    host.querySelectorAll(".js-live").forEach((node) => node.remove());
    cards.splice(0, cards.length, ...list);
    const grid = host.querySelector("#series-grid");
    const rank = host.querySelector("#rank-rows");
    const body = host.querySelector("#market-body");
    const movers = host.querySelector("#mover-grid");
    let moverCount = 0;
    const seen = new Set<string>();
    for (const card of list) {
      if (!card.image || seen.has(card.image)) continue;
      seen.add(card.image);
      const label = card.cat === "art" ? "艺术" : "PFP";
      if (grid) {
        const row = document.createElement("div");
        row.className = "mini cat-item js-live";
        row.dataset.cat = card.cat;
        row.dataset.name = `${card.name} ${label}`;
        const img = document.createElement("img");
        face(img, card.image, row);
        const meta = document.createElement("div");
        meta.className = "meta";
        const title = document.createElement("b");
        title.textContent = card.name;
        const sub = document.createElement("span");
        sub.textContent = `${floorText(card)} · ${label}`;
        meta.append(title, sub);
        const deal = document.createElement("button");
        deal.className = "deal";
        deal.type = "button";
        deal.textContent = "交易";
        deal.addEventListener("click", (event) => {
          event.stopPropagation();
          window.open(card.url, "_blank", "noopener");
        });
        row.append(img, meta, deal);
        row.addEventListener("click", () => window.open(card.url, "_blank", "noopener"));
        grid.append(row);
      }
      if (rank) {
        const row = document.createElement("div");
        row.className = "rank-row cat-item js-live";
        row.dataset.cat = card.cat;
        row.dataset.name = card.name;
        row.innerHTML = `<div class="who"><img alt=""><div><div class="nm"></div></div></div><div class="floor"></div>`;
        const img = row.querySelector("img");
        if (img) face(img, card.image, row);
        const name = row.querySelector(".nm");
        if (name) name.textContent = card.verified ? `${card.name} ✓` : card.name;
        const floor = row.querySelector(".floor");
        if (floor) floor.textContent = floorText(card);
        row.addEventListener("click", () => window.open(card.url, "_blank", "noopener"));
        rank.append(row);
      }
      if (body) {
        const tr = document.createElement("tr");
        tr.className = "cat-item js-live";
        tr.dataset.cat = card.cat;
        tr.dataset.name = card.name;
        const cells = ["", "", "", "", ""];
        tr.innerHTML = cells.map((_, index) => `<td${index && index < 4 ? ' class="right"' : ""}></td>`).join("");
        const nameCell = document.createElement("div");
        nameCell.className = "namecell";
        const img = document.createElement("img");
        img.className = "av";
        face(img, card.image, tr);
        const spanName = document.createElement("span");
        spanName.textContent = `${card.name} · ${label}`;
        nameCell.append(img, spanName);
        tr.children[0]?.append(nameCell);
        const values = [floorText(card), `${amt(card.vol1d)} ${card.symbol}`, String(card.sales1d)];
        values.forEach((text, index) => {
          const cell = tr.children[index + 1] as HTMLElement | undefined;
          if (!cell) return;
          if (index === 1) {
            cell.classList.add("js-vol");
            cell.dataset.slug = card.slug;
          }
          if (index === 2) {
            cell.classList.add("js-sales");
            cell.dataset.slug = card.slug;
          }
          cell.textContent = text;
        });
        const deal = document.createElement("button");
        deal.className = "deal";
        deal.type = "button";
        deal.textContent = "交易";
        deal.addEventListener("click", (event) => {
          event.stopPropagation();
          window.open(card.url, "_blank", "noopener");
        });
        tr.children[4]?.append(deal);
        tr.addEventListener("click", () => window.open(card.url, "_blank", "noopener"));
        body.append(tr);
      }
      if (movers && moverCount < 3) {
        moverCount += 1;
        const tile = document.createElement("a");
        tile.className = "mover cat-item js-live";
        tile.dataset.cat = card.cat;
        tile.dataset.name = card.name;
        tile.href = card.url;
        tile.target = "_blank";
        tile.rel = "noopener";
        tile.style.backgroundImage = `url("${card.image.replace(/"/g, "")}")`;
        const cap = document.createElement("div");
        cap.className = "cap";
        const title = document.createElement("b");
        title.textContent = card.name;
        const sub = document.createElement("span");
        sub.textContent = `地板 ${floorText(card)}`;
        cap.append(title, sub);
        tile.append(cap);
        movers.append(tile);
      }
    }
    apply();
  };

  void getLaunchMarket()
    .then((market) => {
      if (!alive) return;
      const bySymbol = new Map(market.tokens.map((item) => [item.symbol, item]));
      const bem = host.querySelector<HTMLElement>("#px-bem");
      const okb = host.querySelector<HTMLElement>("#px-okb");
      const bemRow = host.querySelector<HTMLElement>("#row-bem");
      const okbRow = host.querySelector<HTMLElement>("#row-okb");
      if (bem) quoteText(bem, bySymbol.get("BEM"));
      if (okb) quoteText(okb, bySymbol.get("OKB"));
      const fillRow = (row: HTMLElement | null, quote: TokenQuote | undefined) => {
        if (!row || !quote) return;
        const cells = row.querySelectorAll("td");
        if (cells[1]) cells[1].textContent = money(quote.mcap);
        if (cells[2]) cells[2].textContent = money(quote.price);
        if (cells[4]) {
          cells[4].textContent = quote.change == null ? "—" : `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(1)}%`;
          cells[4].classList.toggle("up", (quote.change ?? 0) >= 0);
          cells[4].classList.toggle("down", (quote.change ?? 0) < 0);
        }
      };
      fillRow(bemRow, bySymbol.get("BEM"));
      fillRow(okbRow, bySymbol.get("OKB"));
      mount(market.collections);
      const note = host.querySelector("#os-note");
      if (note) {
        note.textContent =
          market.collections.length > 0
            ? "地板价、成交额和笔数来自 OpenSea。点「交易」进入该系列的真实市场。BEM、OKB 只是公开参考价，这里不成交。"
            : "OpenSea 这次没有返回。能成交的只有代币页上的晶体管。";
      }
    })
    .catch(() => {
      const note = host.querySelector("#os-note");
      if (note) note.textContent = "OpenSea 行情暂时读不到。晶体管成交仍在代币页。";
    });

  const tradeSheet = host.querySelector<HTMLElement>("#trade-sheet");
  const tradeName = host.querySelector<HTMLElement>("#trade-name");
  const tradePx = host.querySelector<HTMLElement>("#trade-px");
  const tradeQty = host.querySelector<HTMLInputElement>("#trade-qty");
  const tradePrice = host.querySelector<HTMLInputElement>("#trade-price");
  const tradeMsg = host.querySelector<HTMLElement>("#trade-msg");
  const tradeLink = host.querySelector<HTMLAnchorElement>("#trade-link");
  const tradeBid = host.querySelector<HTMLButtonElement>("#trade-bid");
  const tradeSell = host.querySelector<HTMLButtonElement>("#trade-sell");
  let currentRow: LiveTransistor | null = null;
  let busy = false;
  const say = (text: string) => {
    if (tradeMsg) tradeMsg.textContent = text;
  };
  const showTrade = (openIt: boolean) => {
    if (tradeSheet) tradeSheet.hidden = !openIt;
  };
  const fillSheet = (row: LiveTransistor) => {
    currentRow = row;
    if (tradeName) tradeName.textContent = `${row.name} · ${row.kind}`;
    if (tradePx) {
      tradePx.textContent = `最新 ${bnbText(row.lastBnb)} BNB · 最高买价 ${bnbText(row.bidBnb)} BNB × ${row.bidQty || "—"}`;
    }
    if (tradePrice && document.activeElement !== tradePrice && !tradePrice.value) {
      tradePrice.value = row.bidBnb != null ? bnbText(row.bidBnb) : row.lastBnb != null ? bnbText(row.lastBnb) : "";
    }
    if (tradeLink) tradeLink.href = `https://tapeout.net/market/${row.token}/${row.tokenId}`;
    if (tradeSell) tradeSell.disabled = busy || row.bidId == null;
    if (tradeBid) tradeBid.disabled = busy;
  };
  const openTrade = (row: LiveTransistor) => {
    if (tradePrice && currentRow?.id !== row.id) tradePrice.value = "";
    fillSheet(row);
    say(row.bidId == null ? "现在没有买价，只能挂买单。卖出要等有人出价。" : "挂买单会锁定 BNB。卖出是把这颗晶体管卖给当前最高买价。");
    showTrade(true);
  };
  host.querySelector("#trade-close")?.addEventListener("click", () => showTrade(false), opt);
  tradeSheet?.addEventListener("click", (event) => {
    if (event.target === tradeSheet) showTrade(false);
  }, opt);

  const ready = async (): Promise<{ eth: Injected; from: string } | null> => {
    let eth = getProvider();
    if (!eth) {
      showSheet(true);
      if (msg) msg.textContent = "先连接钱包。成交在 BSC，和 tapeout.net 同一份市场合约。";
      return null;
    }
    await ensureBsc(eth);
    eth = getProvider() ?? eth;
    let from = currentAccount();
    if (!from) {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      from = accounts[0] ?? null;
    }
    if (!from) throw new Error("nowallet");
    return { eth, from };
  };

  const qtyOf = (max: number | null): bigint => {
    const raw = (tradeQty?.value || "").trim();
    if (!/^[1-9]\d*$/.test(raw)) throw new Error("数量要是正整数");
    const n = BigInt(raw);
    if (max != null && max > 0 && n > BigInt(Math.floor(max))) throw new Error(`当前买价只剩 ${Math.floor(max)} 个`);
    if (n > 1_000_000_000n) throw new Error("数量太大");
    return n;
  };

  const priceOf = (): bigint => {
    const raw = (tradePrice?.value || "").trim();
    if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) throw new Error("价格要写成 BNB 数字，例如 0.05");
    const wei = parseEther(raw as `${number}`);
    if (wei <= 0n || wei >= 2n ** 96n) throw new Error("价格超出合约能收的范围");
    return wei;
  };

  const waitMined = async (eth: Injected, hash: string): Promise<"ok" | "fail" | "pending"> => {
    for (let i = 0; i < 16 && alive; i += 1) {
      const rec = (await eth.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
      if (rec) return rec.status === "0x0" ? "fail" : "ok";
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    return "pending";
  };

  tradeBid?.addEventListener("click", () => void (async () => {
    if (busy || !currentRow) return;
    const row = currentRow;
    try {
      const price = priceOf();
      const qty = qtyOf(null);
      const gate = await ready();
      if (!gate) return;
      busy = true;
      tradeBid.disabled = true;
      if (tradeSell) tradeSell.disabled = true;
      const value = price * qty;
      say(`正在挂买单，钱包会锁定 ${bnbFromWei(value)} BNB。取消就等于没成交。`);
      const data = encodeFunctionData({
        abi: bidAbi,
        functionName: "placeBid",
        args: [row.token as `0x${string}`, row.tokenId, price, qty],
      });
      const hash = await sendTx(gate.eth, { from: gate.from, to: MARKET, data, value });
      say(`买单已提交 ${short(hash)}。等 tapeout.net 刷出后这里的买价才会变，没有假装成交。`);
    } catch (error) {
      say(tradeError(error));
    } finally {
      busy = false;
      if (tradeBid) tradeBid.disabled = false;
      if (tradeSell && currentRow) tradeSell.disabled = currentRow.bidId == null;
    }
  })(), opt);

  tradeSell?.addEventListener("click", () => void (async () => {
    if (busy || !currentRow) return;
    const row = currentRow;
    if (row.bidId == null) {
      say("现在没有可吃的买价。");
      return;
    }
    try {
      const qty = qtyOf(row.bidQty);
      const gate = await ready();
      if (!gate) return;
      busy = true;
      tradeSell.disabled = true;
      if (tradeBid) tradeBid.disabled = true;
      const callData = encodeFunctionData({
        abi: erc1155,
        functionName: "isApprovedForAll",
        args: [gate.from as `0x${string}`, MARKET],
      });
      let approved = false;
      try {
        const raw = await gate.eth.request({
          method: "eth_call",
          params: [{ from: gate.from, to: row.token, data: callData }, "latest"],
        });
        approved = Boolean(
          decodeFunctionResult({
            abi: erc1155,
            functionName: "isApprovedForAll",
            data: String(raw) as `0x${string}`,
          }),
        );
      } catch {
        approved = false;
      }
      if (!approved) {
        say("第一次卖出要授权市场合约拿你的晶体管。钱包会先弹出授权。");
        const approveData = encodeFunctionData({
          abi: erc1155,
          functionName: "setApprovalForAll",
          args: [MARKET, true],
        });
        const approveHash = await sendTx(gate.eth, { from: gate.from, to: row.token, data: approveData });
        say(`授权已提交 ${short(approveHash)}，等它上链再卖。`);
        const mined = await waitMined(gate.eth, approveHash);
        if (mined !== "ok") {
          say(mined === "fail" ? "授权失败，没有卖出。" : "授权还在确认。等它上链后再点一次卖出。");
          return;
        }
      }
      say(`正在卖 ${qty.toString()} 个给买价 #${row.bidId}。`);
      const data = encodeFunctionData({
        abi: bidAbi,
        functionName: "fillBid",
        args: [BigInt(row.bidId), qty],
      });
      const hash = await sendTx(gate.eth, { from: gate.from, to: MARKET, data });
      say(`卖出已提交 ${short(hash)}。晶体管转给买家，BNB 进你的钱包。价格要等 tapeout.net 刷出才变。`);
    } catch (error) {
      say(tradeError(error));
    } finally {
      busy = false;
      if (tradeBid) tradeBid.disabled = false;
      if (tradeSell && currentRow) tradeSell.disabled = currentRow.bidId == null;
    }
  })(), opt);

  const paintTape = (data: TapeoutLive) => {
    const note = host.querySelector("#tape-note");
    const when = data.asOf ? new Date(data.asOf).toLocaleString("zh-CN", { hour12: false }) : "";
    if (note) {
      note.textContent = data.ok
        ? `最新价和最高买价来自 tapeout.net${when ? ` · ${when}` : ""}。挂买单、卖给买价，发到 BSC 合约 ${short(MARKET)}。`
        : `读不到 tapeout.net：${data.error || "请稍后再试"}`;
    }
    const bemStat = host.querySelector("#stat-bem");
    const tradedStat = host.querySelector("#stat-traded");
    const bidsStat = host.querySelector("#stat-bids");
    if (bemStat) bemStat.textContent = data.bem ? money(data.bem.usd) : "—";
    if (tradedStat) tradedStat.textContent = data.ok ? String(data.traded) : "—";
    if (bidsStat) bidsStat.textContent = data.ok ? String(data.rows.filter((row) => row.bidBnb != null).length) : "—";

    const byId = new Map(data.rows.map((row) => [row.id, row]));
    const official: LiveTransistor[] = [];
    for (const addr of OFFICIAL) {
      for (const tokenId of [0, 1]) {
        const hit = byId.get(`${addr}-${tokenId}`);
        if (hit) official.push(hit);
      }
    }
    const rest = data.rows.filter((row) => officialRank(row) === 99);
    const shown = [...official, ...rest];
    liveRows = shown;
    refreshHolds();

    const grid = host.querySelector("#tape-official");
    if (grid) {
      grid.replaceChildren();
      if (official.length === 0) {
        const empty = document.createElement("p");
        empty.className = "sub";
        empty.textContent = data.ok ? "官方晶体管这次没有行情。" : "行情还没读到。";
        grid.append(empty);
      }
      for (const row of official) grid.append(tapeCard(row));
    }

    const body = host.querySelector("#tape-body");
    if (body) {
      body.replaceChildren();
      if (shown.length === 0) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 6;
        td.textContent = data.ok ? "tapeout.net 这次没有可交易的晶体管。" : "正在读取 tapeout.net…";
        tr.append(td);
        body.append(tr);
      }
      for (const row of shown) body.append(tapeRow(row));
    }

    const feed = host.querySelector("#tape-feed");
    if (feed) {
      feed.replaceChildren();
      const prints = data.rows
        .flatMap((row) => row.prints.map((print) => ({ row, print })))
        .sort((a, b) => b.print.ts - a.print.ts)
        .slice(0, 8);
      if (prints.length === 0) {
        const line = document.createElement("div");
        line.className = "feed-row";
        line.textContent = data.ok ? "tapeout.net 这次没有带回成交。" : "成交还没读到。";
        feed.append(line);
      }
      for (const item of prints) {
        const line = document.createElement("div");
        line.className = "feed-row";
        const pill = document.createElement("span");
        pill.className = "pill";
        pill.textContent = "成交";
        const name = document.createElement("span");
        name.textContent = `${item.row.name} · ${item.row.kind} × ${item.print.qty}`;
        const px = document.createElement("span");
        px.textContent = `${bnbText(item.print.bnb)} BNB`;
        const time = document.createElement("span");
        time.style.color = "var(--muted)";
        time.textContent = ago(item.print.ts);
        line.append(pill, name, px, time);
        line.addEventListener("click", () => openTrade(item.row));
        feed.append(line);
      }
    }

    if (currentRow && tradeSheet && !tradeSheet.hidden) {
      const fresh = byId.get(currentRow.id);
      if (fresh) fillSheet(fresh);
    }
  };

  const multicallAbi = [
    {
      name: "aggregate",
      type: "function",
      stateMutability: "payable",
      inputs: [
        {
          name: "calls",
          type: "tuple[]",
          components: [
            { name: "target", type: "address" },
            { name: "callData", type: "bytes" },
          ],
        },
      ],
      outputs: [
        { name: "blockNumber", type: "uint256" },
        { name: "returnData", type: "bytes[]" },
      ],
    },
  ] as const;

  let holdGen = 0;
  refreshHolds = () => {
    const address = currentAccount();
    const list = host.querySelector("#hold-list");
    const count = host.querySelector("#bal-hold");
    const gen = ++holdGen;
    if (!list) return;
    list.replaceChildren();
    const note = (text: string) => {
      const line = document.createElement("p");
      line.className = "sub";
      line.textContent = text;
      list.append(line);
    };
    if (!address) {
      if (count) count.textContent = "—";
      note("连接钱包后，按 BSC 上的余额列出能卖的晶体管。");
      return;
    }
    if (liveRows.length === 0) {
      if (count) count.textContent = "—";
      note("晶体管行情还没读到，持仓稍后再查。");
      return;
    }
    if (count) count.textContent = "读取中";
    const rows = liveRows.slice(0, 80);
    const calls = rows.map((row) => ({
      target: row.token as `0x${string}`,
      callData: encodeFunctionData({
        abi: erc1155,
        functionName: "balanceOf",
        args: [address as `0x${string}`, BigInt(row.tokenId)],
      }),
    }));
    const data = encodeFunctionData({ abi: multicallAbi, functionName: "aggregate", args: [calls] });
    void fetch("https://bsc-dataseed.binance.org", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0xcA11bde05977b3631167028862bE2a173976CA11", data }, "latest"] }),
      signal: AbortSignal.timeout(12000),
    })
      .then(async (res) => {
        const body = (await res.json()) as { result?: `0x${string}` };
        if (!body.result) throw new Error("rpc");
        const decoded = decodeFunctionResult({ abi: multicallAbi, functionName: "aggregate", data: body.result });
        return rows.map((row, index) => ({ row, qty: Number(BigInt(decoded[1][index] ?? "0x0")) }));
      })
      .then((heldRows) => {
        if (!alive || gen !== holdGen) return;
        const held = heldRows.filter((item) => Number.isFinite(item.qty) && item.qty > 0);
        if (count) count.textContent = String(held.length);
        list.replaceChildren();
        if (held.length === 0) {
          note("这个地址在已读取的晶体管里没有持仓。");
          return;
        }
        for (const item of held) {
          const node = document.createElement("div");
          node.className = "token";
          const meta = document.createElement("div");
          meta.className = "meta";
          const title = document.createElement("b");
          title.textContent = `${item.row.name} · ${item.row.kind}`;
          const sub = document.createElement("span");
          sub.textContent = `持有 ${item.qty} · 最高买价 ${bnbText(item.row.bidBnb)} BNB`;
          meta.append(title, sub);
          const button = document.createElement("button");
          button.className = "deal";
          button.type = "button";
          button.textContent = item.row.bidId == null ? "挂买单" : "卖出";
          button.addEventListener("click", () => openTrade(item.row));
          node.append(meta, button);
          list.append(node);
        }
      })
      .catch(() => {
        if (!alive || gen !== holdGen) return;
        if (count) count.textContent = "—";
        list.replaceChildren();
        note("BSC 余额这次没读到，没有写成 0。");
      });
  };

  const tapeCard = (row: LiveTransistor) => {
    const node = document.createElement("div");
    node.className = "token";
    const meta = document.createElement("div");
    meta.className = "meta";
    const title = document.createElement("b");
    title.textContent = `${row.name} · ${row.kind}`;
    const sub = document.createElement("span");
    sub.textContent = `最新 ${bnbText(row.lastBnb)} BNB · 买 ${bnbText(row.bidBnb)}`;
    meta.append(title, sub);
    const button = document.createElement("button");
    button.className = "deal";
    button.type = "button";
    button.textContent = "交易";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openTrade(row);
    });
    node.addEventListener("click", () => openTrade(row));
    node.append(meta, button);
    return node;
  };

  const tapeRow = (row: LiveTransistor) => {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    const who = document.createElement("div");
    who.className = "namecell";
    const label = document.createElement("span");
    label.textContent = `${row.name} · ${row.kind}`;
    who.append(label);
    name.append(who);
    const cells = [bnbText(row.lastBnb), bnbText(row.bidBnb), row.bidQty > 0 ? String(row.bidQty) : "—", bnbText(row.volBnb24)];
    tr.append(name);
    for (const text of cells) {
      const td = document.createElement("td");
      td.className = "right";
      td.textContent = text;
      tr.append(td);
    }
    const action = document.createElement("td");
    action.className = "right";
    const button = document.createElement("button");
    button.className = "deal";
    button.type = "button";
    button.textContent = "交易";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openTrade(row);
    });
    action.append(button);
    tr.append(action);
    tr.addEventListener("click", () => openTrade(row));
    return tr;
  };

  const loadTape = () => {
    void getTapeoutLive()
      .then((data) => {
        if (alive) paintTape(data);
      })
      .catch(() => {
        if (!alive) return;
        const note = host.querySelector("#tape-note");
        if (note) note.textContent = "读不到 tapeout.net，没有用假价格顶上。";
      });
  };
  const paintCircuits = (rows: ProtocolCircuit[], noteText: string) => {
    const note = host.querySelector("#proto-note");
    if (note) note.textContent = noteText;
    const grid = host.querySelector("#proto-grid");
    if (!grid) return;
    grid.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sub";
      empty.textContent = "这次没有读到协议电路。";
      grid.append(empty);
      return;
    }
    for (const row of rows) {
      const card = document.createElement("a");
      card.className = "token";
      card.href = `https://bscscan.com/nft/${row.circuit}/${row.tokenId}`;
      card.target = "_blank";
      card.rel = "noopener";
      const mark = document.createElement("div");
      mark.className = "mark";
      const hue = Number(BigInt(row.tokenId) % 360n);
      mark.style.background = `hsl(${hue} 62% 42%)`;
      mark.textContent = row.tokenId.slice(-2);
      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("b");
      title.textContent = `电路 #${row.tokenId}`;
      const line = document.createElement("span");
      line.textContent = `最近成交 ${row.grossBnb.toFixed(4)} BNB · 同一枚 ERC-721 · 买卖在官网市场`;
      meta.append(title, line);
      card.append(mark, meta);
      grid.append(card);
    }
  };
  const loadCircuits = () => {
    void getProtocolNfts()
      .then((data) => {
        if (!alive) return;
        paintCircuits(
          data.circuits,
          data.ok
            ? "在 tapeout.net 流片得到的电路本来就是 ERC-721。点进去看的是同一枚。本站没有电路市场的下单接口，不会代买。"
            : `协议电路暂时读不到：${data.error || "请稍后再试"}`,
        );
      })
      .catch(() => {
        if (alive) paintCircuits([], "协议电路暂时读不到，没有用假 NFT 顶上。");
      });
  };
  loadTape();
  loadCircuits();
  const tapeTimer = window.setInterval(loadTape, 50_000);
  const protoTimer = window.setInterval(loadCircuits, 60_000);

  const swapPair = () => (host.querySelector<HTMLButtonElement>("#swap-pair .on")?.dataset.pair as SwapPair) || "bsc-bem";
  const swapSide = () => (host.querySelector<HTMLButtonElement>("#swap-side .on")?.dataset.side as SwapSide) || "buy";
  const bridgeDir = () => (host.querySelector<HTMLButtonElement>("#bridge-dir .on")?.dataset.dir as BridgeDir) || "to-xlayer";
  const pick = (box: string, button: HTMLButtonElement) => {
    host.querySelectorAll<HTMLButtonElement>(`${box} .fbtn`).forEach((node) => node.classList.remove("on"));
    button.classList.add("on");
  };
  const swapLabel = host.querySelector("#swap-in-label");
  const paintSwapLabel = () => {
    if (!swapLabel) return;
    const pay = swapSide() === "buy" ? (swapPair() === "bsc-bem" ? "USDT" : "OKB") : "BEM";
    swapLabel.textContent = `支付 ${pay}`;
  };
  let swapTicket = 0;
  const refreshSwap = () => {
    const ticket = ++swapTicket;
    const quote = host.querySelector("#swap-quote");
    const raw = host.querySelector<HTMLInputElement>("#swap-amt")?.value ?? "";
    paintSwapLabel();
    if (!quote) return;
    void quoteSwap(swapPair(), swapSide(), raw)
      .then((text) => {
        if (alive && ticket === swapTicket && quote) quote.textContent = text;
      })
      .catch((error) => {
        if (alive && ticket === swapTicket && quote) quote.textContent = deskError(error);
      });
  };
  let bridgeTicket = 0;
  const refreshBridge = () => {
    const ticket = ++bridgeTicket;
    const quote = host.querySelector("#bridge-quote");
    const raw = host.querySelector<HTMLInputElement>("#bridge-amt")?.value ?? "";
    if (!quote) return;
    void quoteBridge(bridgeDir(), raw)
      .then((text) => {
        if (alive && ticket === bridgeTicket && quote) quote.textContent = text;
      })
      .catch((error) => {
        if (alive && ticket === bridgeTicket && quote) quote.textContent = deskError(error);
      });
  };
  host.querySelector("#swap-pair")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    pick("#swap-pair", button);
    refreshSwap();
  }, opt);
  host.querySelector("#swap-side")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    pick("#swap-side", button);
    refreshSwap();
  }, opt);
  host.querySelector("#swap-flip")?.addEventListener("click", () => {
    const next = host.querySelector<HTMLButtonElement>(`#swap-side .fbtn:not(.on)`);
    if (!next) return;
    pick("#swap-side", next);
    refreshSwap();
  }, opt);
  host.querySelector("#swap-amt")?.addEventListener("input", refreshSwap, opt);
  host.querySelector("#bridge-dir")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    pick("#bridge-dir", button);
    refreshBridge();
  }, opt);
  host.querySelector("#bridge-amt")?.addEventListener("input", refreshBridge, opt);
  const showLink = (id: string, url: string, label: string) => {
    const link = host.querySelector<HTMLAnchorElement>(id);
    if (!link) return;
    link.hidden = false;
    link.href = url;
    link.textContent = label;
  };
  host.querySelector("#swap-go")?.addEventListener("click", () => void (async () => {
    const button = host.querySelector<HTMLButtonElement>("#swap-go");
    const msg = host.querySelector("#swap-msg");
    if (!button || button.disabled) return;
    button.disabled = true;
    if (msg) msg.textContent = "等钱包确认。取消就等于没成交。";
    try {
      const done = await runSwap(swapPair(), swapSide(), host.querySelector<HTMLInputElement>("#swap-amt")?.value ?? "");
      if (msg) msg.textContent = "兑换已提交。到账以链上收据为准，这里不提前改余额。";
      showLink("#swap-link", done.url, "查看这笔交易");
    } catch (error) {
      if (msg) msg.textContent = deskError(error);
    } finally {
      button.disabled = false;
    }
  })(), opt);
  host.querySelector("#bridge-go")?.addEventListener("click", () => void (async () => {
    const button = host.querySelector<HTMLButtonElement>("#bridge-go");
    const msg = host.querySelector("#bridge-msg");
    if (!button || button.disabled) return;
    button.disabled = true;
    if (msg) msg.textContent = "等钱包确认。BSC 到 X Layer 可能要先批准 BEM。";
    try {
      const done = await runBridge(bridgeDir(), host.querySelector<HTMLInputElement>("#bridge-amt")?.value ?? "");
      if (msg) msg.textContent = "跨链已提交。到账要等官方桥确认，这里不提前加余额。";
      showLink("#bridge-link", done.url, "查看这笔跨链");
    } catch (error) {
      if (msg) msg.textContent = deskError(error);
    } finally {
      button.disabled = false;
    }
  })(), opt);
  refreshSwap();
  refreshBridge();
  const deskTimer = window.setInterval(() => {
    refreshSwap();
    refreshBridge();
  }, 20_000);

  const stopGenesis = bootGenesis(host);

  return () => {
    alive = false;
    window.clearTimeout(timer);
    window.clearInterval(tapeTimer);
    window.clearInterval(protoTimer);
    window.clearInterval(deskTimer);
    stopAccount();
    stopLink();
    stopGenesis();
    ac.abort();
  };
}
