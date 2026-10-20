import { createPublicClient, decodeEventLog, decodeFunctionResult, encodeFunctionData, http, parseAbi, parseEther } from "viem";
import { getLaunchMarket, type OsCard, type TokenQuote } from "@/lib/opensea-feed";
import { getProtocolNfts, getTapeoutLive, type LiveTransistor, type ProtocolCircuit, type TapeoutLive } from "@/lib/tapeout-live";
import { mintChipArt } from "@/lib/chip-art";
import { nickOf, readAvatar, readCover, readNicks, writeAvatar, writeCover, writeNick } from "@/lib/nicks";
import { showMintWin, whenMined } from "@/lib/mint-win";
import { deskError, quoteBridge, quoteSwap, readSwapBalances, runBridge, runSwap, type BridgeDir, type CoinBals, type SwapPair, type SwapSide } from "@/lib/asset-desk";
import { watchEnglish } from "@/lib/live-en";
import { applyDom, bootLang, onLang, setUiLang, t, uiLang } from "@/lib/locale";
import { connectBrowser, connectInjected, connectKind, currentAccount, currentChain, disconnectWallet, getProvider, onAccount, onChain, onOpenLink, resumeInjected, switchDeskChain, walletLabel } from "@/lib/wallet";
import { bootGenesis } from "@/lib/genesis-desk";
import { getTapeCode, tapeImage } from "@/lib/okx-tape";
import { bookError, buyTapeOnSite, getTapeBook, listTapeOnSite, type BookOrder } from "@/lib/tape-book";
import { createAbi, factoryCreateData, factoryDeployData, FACTORY, FACTORY_PLATFORM } from "@/lib/tape-factory-deploy";
import { previewPathPrefix } from "@/lib/preview-path-prefix";
import { TAPE_BEM, TAPE_TOKEN } from "@/lib/tape-pool";
import { connectXLayer, txUrl, xRpc } from "@/lib/xlayer";
import { bootCpunk } from "@/lib/cpunk-desk";
import { bscRpc, connectBsc } from "@/lib/bsc";

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
  if (/HTTP request failed|Failed to fetch|network|timeout|Load failed/i.test(text)) return "节点没连上，没有发出去。再点一次。";
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
          rpcUrls: ["https://bsc.publicnode.com", "https://bsc-dataseed.bnbchain.org", "https://bsc-dataseed.binance.org"],
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
  host.querySelectorAll<HTMLElement>(".sheet").forEach((sheet) => {
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) sheet.hidden = true;
    }, opt);
  });
  let alive = true;
  const open = (id: string) => {
    const next = id === "profile" ? "assets" : id === "cpunk" ? "mint" : id;
    host.querySelectorAll(".page").forEach((node) => node.classList.remove("active"));
    host.querySelector("#page-" + next)?.classList.add("active");
    host.querySelectorAll(".nav-item").forEach((node) => node.classList.remove("active"));
    host.querySelector(`.nav-item[data-page="${next}"]`)?.classList.add("active");
    const scroller = host.querySelector(".content");
    if (scroller) scroller.scrollTop = 0;
  };
  (window as unknown as { switchPage?: (id: string) => void }).switchPage = open;
  host.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button || !host.contains(button)) return;
    const unit = button.closest("#cp-unit");
    if (unit) {
      unit.querySelectorAll("button").forEach((node) => node.classList.remove("on"));
      button.classList.add("on");
      const input = host.querySelector<HTMLInputElement>("#cp-list-px");
      const label = host.querySelector("#cp-px-label");
      const pair = host.querySelector("#cp-pair");
      const tape = button.dataset.unit === "tape";
      if (input) input.value = tape ? "2" : "0.002";
      if (label) label.textContent = tape ? "价格（TAPE）" : "价格（BEM）";
      if (pair) pair.textContent = tape ? "现在按 TAPE 标价。买家同时付对应的 BEM。" : "现在按 BEM 标价。买家同时付 1000 倍的 TAPE。";
    }
    if (button.id === "cp-tab-items" || button.id === "cp-tab-lists") {
      const lists = button.id === "cp-tab-lists";
      host.querySelector("#cp-tab-items")?.classList.toggle("on", !lists);
      host.querySelector("#cp-tab-lists")?.classList.toggle("on", lists);
    }
  }, opt);
  host.querySelectorAll<HTMLElement>("[onclick*='switchPage']").forEach((node) => {
    const id = node.getAttribute("onclick")?.match(/switchPage\('([^']+)'\)/)?.[1];
    if (!id) return;
    node.addEventListener("click", (event) => {
      event.preventDefault();
      open(id);
    }, opt);
  });
  host.querySelector("#launch-create")?.addEventListener("click", () => void (async () => {
    const note = host.querySelector("#launch-create-msg");
    const button = host.querySelector<HTMLButtonElement>("#launch-create");
    if (!button || button.disabled) return;
    button.disabled = true;
    if (note) note.textContent = "等钱包确认。创建会付进金库的 OKB，并授权 1 TAPE。";
    try {
      if (!getProvider()) {
        showSheet(true);
        if (note) note.textContent = "先连接钱包，再创建。";
        return;
      }
      const from = await connectXLayer();
      const name = host.querySelector<HTMLInputElement>("#launch-name")?.value.trim() ?? "";
      const symbol = host.querySelector<HTMLInputElement>("#launch-symbol")?.value.trim() ?? "";
      const supply = Number(host.querySelector<HTMLInputElement>("#launch-supply")?.value ?? "");
      const reserve = Number(host.querySelector<HTMLInputElement>("#launch-reserve")?.value ?? "");
      const mult = Number(host.querySelector<HTMLInputElement>("#launch-mult")?.value ?? "");
      const quote = host.querySelector<HTMLButtonElement>("#launch-quote .on")?.dataset.quote;
      const mode = quote === "okb" ? 2 : quote === "bem" ? 3 : 1;
      if (!name || name.length > 32 || !symbol || symbol.length > 16) throw new Error("name");
      if (!Number.isInteger(supply) || supply < 1 || supply > 100_000) throw new Error("supply");
      if (!Number.isInteger(reserve) || reserve < 0 || reserve > supply) throw new Error("supply");
      if (!Number.isInteger(mult) || mult < 1 || mult > 1_000_000) throw new Error("mult");
      let base = "";
      if (name === "电路朋克") {
        if (previewPathPrefix(window.location.hostname, window.location.pathname)) throw new Error("preview");
        base = `${window.location.origin}/api/circuit-punk/`;
        if (base.length > 128) throw new Error("uri");
      }
      const xl = createPublicClient({ transport: http("https://rpc.xlayer.tech") });
      const seedAbi = parseAbi(["function okbSeed() view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
      const seed = await xl.readContract({ address: FACTORY, abi: seedAbi, functionName: "okbSeed" });
      const value = mode === 2 ? seed + 10n ** 16n : seed;
      const allow = async (token: `0x${string}`, need: bigint) => {
        const current = await xl.readContract({ address: token, abi: seedAbi, functionName: "allowance", args: [from as `0x${string}`, FACTORY] });
        if (current >= need) return;
        if (current > 0n) {
          const zero = encodeFunctionData({ abi: seedAbi, functionName: "approve", args: [FACTORY, 0n] });
          const zeroHash = (await getProvider()?.request({ method: "eth_sendTransaction", params: [{ from, to: token, data: zero, value: "0x0", chainId: "0xc4" }] })) as string;
          await xl.waitForTransactionReceipt({ hash: zeroHash as `0x${string}`, timeout: 90_000 });
        }
        const data = encodeFunctionData({ abi: seedAbi, functionName: "approve", args: [FACTORY, need] });
        const hash = (await getProvider()?.request({ method: "eth_sendTransaction", params: [{ from, to: token, data, value: "0x0", chainId: "0xc4" }] })) as string;
        await xl.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 90_000 });
      };
      if (note) note.textContent = "先授权代币，再签创建。取消任何一步都等于没创建。";
      await allow(TAPE_TOKEN, 100_000_000n);
      if (mode !== 2) await allow(TAPE_BEM, 1_000_000n);
      const data = factoryCreateData(mode, mult, supply, reserve, name, symbol, base);
      const hash = (await getProvider()?.request({
        method: "eth_sendTransaction",
        params: [{ from, to: FACTORY, data, value: `0x${value.toString(16)}`, chainId: "0xc4" }],
      })) as string;
      if (note) note.textContent = `已提交 ${hash.slice(0, 10)}… 等项目地址。`;
      showLink("#factory-link", txUrl(hash), "查看这笔创建");
      const receipt = await xl.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 120_000 });
      const born = receipt.logs.flatMap((log) => {
        try {
          const decoded = decodeEventLog({ abi: createAbi, data: log.data, topics: log.topics });
          return decoded.eventName === "Created" ? [decoded.args.drop] : [];
        } catch {
          return [];
        }
      })[0];
      if (note) note.textContent = born ? `项目已创建 ${born}` : `创建已上链 ${hash.slice(0, 10)}…`;
      if (born) showLink("#factory-link", `https://www.oklink.com/x-layer/evm/address/${born}`, "打开这个项目");
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error ?? "");
      if (note) {
        note.textContent = text === "name" ? "名称最多 32 字，符号最多 16 字。"
          : text === "supply" ? "总量 1 到 100000，预留不能超过总量。"
          : text === "mult" ? "倍数要是 1 到 1000000 的整数。"
          : text === "uri" ? "图片地址超过 128 个字，合约装不下。换更短的正式网址再创建。"
          : text === "preview" ? "现在是预览网址。发布之后用正式网址再点创建，不然图片会跟着预览失效。"
          : deskError(error);
      }
    } finally {
      button.disabled = false;
    }
  })(), opt);

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
    host.style.colorScheme = mode;
    if (themeBtn) {
      const narrow = window.matchMedia("(max-width: 860px)").matches;
      const day = narrow ? (uiLang() === "zh" ? "昼" : "Day") : t("themeDay");
      const night = narrow ? (uiLang() === "zh" ? "夜" : "Night") : t("themeNight");
      themeBtn.textContent = mode === "dark" ? day : night;
    }
    window.localStorage.setItem("tape-theme", mode);
  };
  paintTheme(saved);
  themeBtn?.addEventListener("click", () => paintTheme(host.dataset.theme === "dark" ? "light" : "dark"), opt);

  const launchMult = host.querySelector<HTMLInputElement>("#launch-mult");
  const launchSupply = host.querySelector<HTMLInputElement>("#launch-supply");
  const launchReserve = host.querySelector<HTMLInputElement>("#launch-reserve");
  const launchPrice = host.querySelector("#launch-price");
  const launchTrade = host.querySelector("#launch-trade");
  let launchQuote: "pair" | "okb" | "bem" = "pair";
  const paintLaunch = () => {
    const mult = Math.max(1, Math.floor(Number(launchMult?.value) || 1));
    if (launchMult && document.activeElement !== launchMult) launchMult.value = String(mult);
    const supply = Math.max(0, Math.floor(Number(launchSupply?.value) || 0));
    let reserve = Math.max(0, Math.floor(Number(launchReserve?.value) || 0));
    if (reserve > supply) reserve = supply;
    if (launchReserve && document.activeElement !== launchReserve && String(reserve) !== launchReserve.value) {
      launchReserve.value = String(reserve);
    }
    const bem = (mult * 0.001).toLocaleString("en-US", { maximumFractionDigits: 6 });
    if (launchQuote === "okb") {
      if (launchPrice) launchPrice.textContent = `公开铸造价 ${mult} OKB · 预留 ${reserve} / ${supply} · 单人最多 10 次`;
      if (launchTrade) launchTrade.textContent = "二级市场只用 OKB。倍数是整数，不能改成别的币。";
    } else if (launchQuote === "bem") {
      if (launchPrice) launchPrice.textContent = `公开铸造价 ${bem} BEM · 预留 ${reserve} / ${supply} · 单人最多 10 次`;
      if (launchTrade) launchTrade.textContent = "二级市场只用 BEM。单位锁在 0.001 BEM，只能按整数倍放大。";
    } else {
      if (launchPrice) launchPrice.textContent = `公开铸造价 ${mult} TAPE + ${bem} BEM · 预留 ${reserve} / ${supply} · 单人最多 10 次`;
      if (launchTrade) launchTrade.textContent = "二级市场按这一对一起付。不能只改 TAPE 或只改 BEM。";
    }
  };
  host.querySelector("#launch-quote")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    const next = button?.dataset.quote;
    if (next !== "okb" && next !== "bem" && next !== "pair") return;
    launchQuote = next;
    host.querySelectorAll<HTMLButtonElement>("#launch-quote .fbtn").forEach((node) => {
      node.classList.toggle("on", node === button);
    });
    paintLaunch();
  }, opt);
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
  const circuitOn = () => host.querySelector<HTMLInputElement>("#launch-name")?.value.trim() === "电路朋克";
  const paintBase = () => {
    const note = host.querySelector("#launch-base");
    if (!note) return;
    if (!circuitOn()) {
      note.textContent = "改了名称就不会写成电路朋克。图片地址留空，链上没有图。";
      return;
    }
    const preview = previewPathPrefix(window.location.hostname, window.location.pathname);
    const base = `${window.location.origin}/api/circuit-punk/`;
    note.textContent = preview
      ? "样张可以看。创建要等站点发布，在正式网址上签。预览网址写进合约后图片会失效。"
      : base.length > 128
        ? `图片地址有 ${base.length} 字，合约最多 128，这次写不进去。`
        : `创建后图片地址写死为 ${base}。公开铸造 1 TAPE + 0.001 BEM。预留 7000 张要一笔领一张。`;
  };
  async function paintCircuitPunks() {
    if (!traitGrid || !traitSum) return;
    const rollBtn = host.querySelector("#trait-roll");
    if (rollBtn) rollBtn.textContent = "再看八种晶粒";
    paintBase();
    traitSum.textContent = "正在读取电路朋克样张…";
    try {
      const prefix = previewPathPrefix(window.location.hostname, window.location.pathname) ?? "";
      const res = await fetch(`${prefix}/api/circuit-punk/sample`, { cache: "no-store" });
      if (!res.ok) throw new Error("sample");
      const body = (await res.json()) as {
        census: { name: string; n: number; tier: string }[];
        items: { name: string; attributes: { trait_type: string; value: string | number }[] }[];
      };
      const censusText = body.census.map((row) => `${row.name} ${row.n}`).join("，");
      traitSum.textContent = `一万张按种类比例生成，商标和真人没有临摹。${censusText}。`;
      traitGrid.replaceChildren();
      for (const item of body.items) {
        const id = Number(item.name.split("#")[1]);
        const card = document.createElement("div");
        card.className = "trait-card punk";
        const slot = document.createElement("div");
        slot.className = "art-slot";
        const img = document.createElement("img");
        img.alt = item.name;
        img.src = `${prefix}/api/circuit-punk/${id}.png`;
        slot.append(img);
        const meta = document.createElement("div");
        const title = document.createElement("b");
        title.textContent = item.name;
        meta.append(title);
        for (const attr of item.attributes) {
          const line = document.createElement("span");
          line.textContent = `${attr.trait_type} ${attr.value}`;
          if (attr.trait_type === "权重") line.className = "rare";
          meta.append(line);
        }
        card.append(slot, meta);
        traitGrid.append(card);
      }
      const artMsg = host.querySelector("#art-msg");
      if (artMsg) artMsg.textContent = "这是按编号现算的 24×24 像素。一万张都在同一个图片地址上，不上传原图。";
    } catch {
      traitSum.textContent = "样张没有读到。创建前这个站点要能打开图片。";
    }
  }
  const rollTraits = () => {
    if (!traitGrid || !traitSum) return;
    if (circuitOn()) {
      void paintCircuitPunks();
      return;
    }
    const rollBtn = host.querySelector("#trait-roll");
    if (rollBtn) rollBtn.textContent = "批量生成属性";
    paintBase();
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
      const net = document.createElement("span");
      net.className = "netlist";
      net.dataset.netlist = `tapnet/1\nid=${item.id}\ngate=${item.gate}\nnode=${item.node}\nlayers=${item.layer}\npack=${item.pack}\nvolt=${item.volt}\ndie=${item.die}\nrarity=${item.rare}`;
      net.textContent = "TAP-721 · L0 · 网表哈希计算中";
      meta.append(title, line, line2, rare, net);
      slot.append(svg);
      card.append(slot, meta);
      traitGrid.append(card);
    }
    lastShown = preview;
    const nodes = [...traitGrid.querySelectorAll<HTMLElement>(".netlist")];
    void Promise.all(nodes.map(async (node) => {
      const raw = new TextEncoder().encode(node.dataset.netlist ?? "");
      const digest = await crypto.subtle.digest("SHA-256", raw);
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      node.textContent = `TAP-721 · L0 · ${hex.slice(0, 10)}… 未流片`;
      node.title = hex;
    }));
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
  host.querySelector("#launch-name")?.addEventListener("input", () => {
    generated.clear();
    paintArtMode();
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
    if (circuitOn()) {
      const artSource = host.querySelector<HTMLElement>("#art-source");
      if (artSource) artSource.hidden = true;
      if (artKey) artKey.hidden = true;
      if (artFiles) artFiles.hidden = true;
      if (artStyleBox) artStyleBox.hidden = true;
      if (artGo) artGo.hidden = true;
      return;
    }
    const artSource = host.querySelector<HTMLElement>("#art-source");
    if (artSource) artSource.hidden = false;
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
      showMintWin(host, uiLang() === "zh" ? "恭喜，这 4 张芯片图已经生成。" : "These four chips are ready.");
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
      line.textContent = t("balEmpty");
      box.append(line);
      return;
    }
    const rows = [
      { chain: "BSC", symbol: "BNB", native: true, decimals: 18 },
      { chain: "BSC", symbol: "BEM", token: "0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a", decimals: 8 },
      { chain: "BSC", symbol: "USDT", token: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
      { chain: "X Layer", symbol: "OKB", native: true, decimals: 18 },
      { chain: "X Layer", symbol: "BEM", token: "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952", decimals: 8 },
      { chain: "X Layer", symbol: "TAPE", token: TAPE_TOKEN, decimals: 8 },
    ];
    void Promise.all(rows.map(async (row) => {
      try {
        const data = row.native ? undefined : `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
        const ask = row.chain === "BSC" ? bscRpc : xRpc;
        const result = await ask({
          jsonrpc: "2.0",
          id: 1,
          method: row.native ? "eth_getBalance" : "eth_call",
          params: row.native ? [address, "latest"] : [{ to: row.token, data }, "latest"],
        });
        if (!result || result === "0x") return null;
        const value = Number(BigInt(result)) / 10 ** row.decimals;
        return { chain: row.chain, symbol: row.symbol, value };
      } catch {
        return null;
      }
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
    const cover = address ? readCover(address) : "";
    const src = avatar || "/tape-launch/logo.png";
    const av = host.querySelector<HTMLImageElement>("#assets-av");
    if (av) av.src = src;
    const banner = host.querySelector<HTMLElement>("#user-banner");
    if (banner) banner.style.backgroundImage = cover ? `url("${cover}")` : "";
    const assets = host.querySelector("#assets-name");
    if (assets) assets.textContent = nick || t("assetsTitle");
    const nickInput = host.querySelector<HTMLInputElement>("#profile-nick");
    if (nickInput && document.activeElement !== nickInput) nickInput.value = nick;
    const clearAv = host.querySelector<HTMLButtonElement>("#profile-clear");
    if (clearAv) clearAv.hidden = !avatar;
    const clearCover = host.querySelector<HTMLButtonElement>("#cover-clear");
    if (clearCover) clearCover.hidden = !cover;
    if (walletBtn) {
      const chain = currentChain() === 56 ? "BSC" : currentChain() === 196 ? "X Layer" : "";
      const narrow = window.matchMedia("(max-width: 860px)").matches;
      const who = nick || short(address || "");
      walletBtn.textContent = address ? (narrow || !chain ? who : `${who} · ${chain}`) : t("login");
    }
    const topLogout = host.querySelector<HTMLButtonElement>("#btn-logout");
    if (topLogout) topLogout.hidden = !address;
    const logout = host.querySelector<HTMLButtonElement>("#wallet-logout");
    if (logout) logout.hidden = !address;
    const assetsLogout = host.querySelector<HTMLButtonElement>("#assets-logout");
    const assetsLogin = host.querySelector<HTMLButtonElement>("#assets-login");
    const who = host.querySelector("#wallet-who");
    if (who) {
      who.textContent = address
        ? `${walletLabel()} · ${short(address)}`
        : uiLang() === "zh" ? "未连接" : "Not connected";
    }
    if (assetsLogout) assetsLogout.hidden = !address;
    if (assetsLogin) assetsLogin.hidden = Boolean(address);
  };

  const paintAccount = (address: string | null) => {
    paintIdentity(address);
    const node = host.querySelector("#assets-addr");
    if (node) node.textContent = address ? `${short(address)} · ${uiLang() === "zh" ? "已连接" : "connected"}` : t("addrOff");
    const bal = host.querySelector("#bal-native");
    const label = host.querySelector("#bal-label");
    if (!address) {
      if (bal) bal.textContent = "—";
      if (label) label.textContent = "—";
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
  const paintChain = (id: number | null) => {
    host.querySelectorAll<HTMLButtonElement>("#chain-row button").forEach((button) => {
      button.classList.toggle("on", Number(button.dataset.chain) === id);
    });
    paintIdentity(currentAccount());
  };
  const stopChain = onChain(paintChain);
  const stopAccount = onAccount(paintAccount);
  const stopLink = onOpenLink((link) => {
    const box = host.querySelector<HTMLElement>("#wallet-link");
    if (msg && link) msg.textContent = t("walletPop");
    if (!box) return;
    box.replaceChildren();
    if (!link) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    showSheet(true);
    const anchor = document.createElement("a");
    anchor.className = "buy";
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = uiLang() === "zh" ? "打开钱包" : "Open wallet";
    box.append(anchor);
  });

  const fail = (error: unknown) => {
    if (!msg) return;
    const text = error instanceof Error ? error.message : "";
    msg.textContent = text === "binanceapp" ? t("binanceFail") : t("walletFail");
  };

  const connectNamed = async (which: "okx" | "binance" | "browser") => {
    if (msg) msg.textContent = t("walletWait");
    try {
      if (which === "browser") await connectBrowser();
      else await connectKind(which);
      if (msg) msg.textContent = t("walletOn");
    } catch (error) {
      fail(error);
    }
  };
  host.querySelector('[data-wallet="browser"]')?.addEventListener("click", () => void connectNamed("browser"), opt);
  host.querySelector('[data-wallet="okx"]')?.addEventListener("click", () => void connectNamed("okx"), opt);
  host.querySelector('[data-wallet="binance"]')?.addEventListener("click", () => void connectNamed("binance"), opt);
  host.querySelector("#chain-row")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    const id = Number(button?.dataset.chain);
    if (id !== 56 && id !== 196) return;
    void (async () => {
      if (msg) msg.textContent = id === 56 ? t("chainWaitBsc") : t("chainWaitXl");
      try {
        if (!getProvider()) await connectBrowser();
        await switchDeskChain(id);
        if (msg) msg.textContent = id === 56 ? t("chainOnBsc") : t("chainOnXl");
      } catch (error) {
        fail(error);
      }
    })();
  }, opt);
  const logoutNow = () => {
    disconnectWallet();
    showSheet(false);
  };
  host.querySelector("#wallet-logout")?.addEventListener("click", logoutNow, opt);
  host.querySelector("#btn-logout")?.addEventListener("click", logoutNow, opt);
  host.querySelector("#assets-logout")?.addEventListener("click", logoutNow, opt);
  host.querySelector("#assets-login")?.addEventListener("click", () => showSheet(true), opt);
  host.querySelector("#mint-close")?.addEventListener("click", () => {
    const win = host.querySelector<HTMLElement>("#mint-win");
    if (win) win.hidden = true;
  }, opt);
  void resumeInjected();

  const profileMsg = host.querySelector<HTMLElement>("#profile-msg");
  const sayProfile = (text: string) => {
    if (profileMsg) {
      profileMsg.hidden = false;
      profileMsg.textContent = text;
    }
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
  const shrinkCover = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 960;
        canvas.height = 320;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          reject(new Error("canvas"));
          return;
        }
        const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("image"));
      };
      img.src = url;
    });
  const readPic = async (file: File | undefined, kind: "avatar" | "cover") => {
    if (!file) return "";
    if (!file.type.startsWith("image/") || file.size > 8_000_000) throw new Error("size");
    const data = kind === "avatar" ? await shrinkAvatar(file) : await shrinkCover(file);
    if (data.length > (kind === "avatar" ? 140_000 : 220_000)) throw new Error("large");
    return data;
  };
  const needWallet = () => {
    const address = currentAccount();
    if (address) return address;
    sayProfile(uiLang() === "zh" ? "先连接钱包。昵称、头像和背景才会绑到这个地址。" : "Connect a wallet so the name sticks to it.");
    const msgBox = host.querySelector<HTMLElement>("#profile-msg");
    if (msgBox) msgBox.hidden = false;
    showSheet(true);
    return null;
  };
  const sayPic = (error: unknown) => {
    const code = error instanceof Error ? error.message : "";
    const box = host.querySelector<HTMLElement>("#profile-msg");
    if (box) box.hidden = false;
    sayProfile(code === "large"
      ? (uiLang() === "zh" ? "这张图压缩后还是太大，换一张。" : "That image is still too large.")
      : code === "size"
        ? (uiLang() === "zh" ? "请选一张 8MB 以内的图片。" : "Pick an image under 8MB.")
        : (uiLang() === "zh" ? "这张图读不了。" : "Could not read that image."));
  };
  const openPic = (inputId: string) => {
    if (!needWallet()) return;
    host.querySelector<HTMLInputElement>(inputId)?.click();
  };
  const onPic = (inputId: string, kind: "avatar" | "cover") => {
    host.querySelector<HTMLInputElement>(inputId)?.addEventListener("change", () => {
      const address = currentAccount();
      const input = host.querySelector<HTMLInputElement>(inputId);
      const file = input?.files?.[0];
      if (!address || !file) return;
      void readPic(file, kind).then((data) => {
        if (kind === "avatar") writeAvatar(address, data);
        else writeCover(address, data);
        if (input) input.value = "";
        paintIdentity(address);
        const box = host.querySelector<HTMLElement>("#profile-msg");
        if (box) box.hidden = false;
        sayProfile(uiLang() === "zh" ? "已换上。只存在这台浏览器。" : "Saved in this browser only.");
      }).catch(sayPic);
    }, opt);
  };
  host.querySelector("#avatar-edit")?.addEventListener("click", () => openPic("#profile-file"), opt);
  host.querySelector("#cover-edit")?.addEventListener("click", () => openPic("#cover-file"), opt);
  host.querySelector("#user-banner")?.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    openPic("#cover-file");
  }, opt);
  onPic("#profile-file", "avatar");
  onPic("#cover-file", "cover");
  const nickInput = host.querySelector<HTMLInputElement>("#profile-nick");
  const nameBtn = host.querySelector<HTMLButtonElement>("#name-edit");
  let nickSkip = false;
  const closeNick = (save: boolean) => {
    if (!nickInput || !nameBtn || nickInput.hidden) return;
    const address = currentAccount();
    if (save && address) writeNick(address, nickInput.value);
    nickInput.hidden = true;
    nameBtn.hidden = false;
    if (address) paintIdentity(address);
  };
  nameBtn?.addEventListener("click", () => {
    const address = needWallet();
    if (!address || !nickInput || !nameBtn) return;
    nickInput.value = nickOf(address, readNicks());
    nickInput.hidden = false;
    nameBtn.hidden = true;
    nickInput.focus();
    nickInput.select();
  }, opt);
  nickInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      closeNick(true);
    } else if (event.key === "Escape") {
      nickSkip = true;
      closeNick(false);
    }
  }, opt);
  nickInput?.addEventListener("blur", () => {
    if (nickSkip) {
      nickSkip = false;
      return;
    }
    closeNick(true);
  }, opt);
  host.querySelector("#profile-clear")?.addEventListener("click", (event) => {
    event.preventDefault();
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
  host.querySelector("#cover-clear")?.addEventListener("click", (event) => {
    event.preventDefault();
    const address = currentAccount();
    if (!address) {
      sayProfile("先连接钱包。");
      showSheet(true);
      return;
    }
    writeCover(address, "");
    const file = host.querySelector<HTMLInputElement>("#cover-file");
    if (file) file.value = "";
    paintIdentity(address);
    sayProfile(uiLang() === "zh" ? "已去掉背景。" : "Background cleared.");
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
      if (msg) msg.textContent = t("walletWait");
      void connectInjected(provider)
        .then(() => {
          if (msg) msg.textContent = t("walletOn");
        })
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

  host.querySelectorAll<HTMLElement>(".need-wallet").forEach((node) => {
    node.addEventListener("click", () => {
      if (!getProvider()) showSheet(true);
      else if (msg) {
        showSheet(true);
        msg.textContent = uiLang() === "zh" ? "钱包已连接。" : "Wallet connected.";
      }
    }, opt);
  });

  const openExt = (name: string, line: string, tokenId = "") => {
    const sheet = host.querySelector<HTMLElement>("#ext-sheet");
    const title = host.querySelector("#ext-name");
    const px = host.querySelector("#ext-px");
    const msg = host.querySelector("#ext-msg");
    const book = host.querySelector("#ext-book");
    const list = host.querySelector<HTMLButtonElement>("#ext-list");
    const price = host.querySelector<HTMLInputElement>("#ext-price");
    const listLabel = host.querySelector<HTMLElement>("#ext-list-label");
    const buy = host.querySelector<HTMLButtonElement>("#ext-buy");
    if (title) title.textContent = name;
    if (px) px.textContent = line;
    if (sheet) {
      sheet.dataset.token = tokenId;
      sheet.hidden = false;
    }
    const tape = Boolean(tokenId);
    const art = host.querySelector<HTMLImageElement>("#ext-art");
    if (art) {
      if (tape && tapeHead?.logo) {
        art.hidden = false;
        art.src = tapeImage(tapeHead.logo);
      } else {
        art.hidden = true;
      }
    }
    if (list) list.hidden = !tape;
    if (price) price.hidden = !tape;
    if (listLabel) listLabel.hidden = !tape;
    if (buy) buy.hidden = !tape;
    if (msg) {
      msg.textContent = tape
        ? "OKX 的公开接口没有成交签名，那一笔不能在这里吃。持有人可以在本站另挂，买家付 OKB，在 X Layer 成交。"
        : "这是以太坊上的地板价。公开接口没有签名，不能在 X Layer 上成交，页面也不跳走。";
    }
    if (book) book.textContent = "";
    if (!tape) return;
    void getTapeBook()
      .then((rows) => {
        const hit = rows.find((row) => row.tokenId === tokenId);
        if (sheet) sheet.dataset.order = hit ? JSON.stringify(hit) : "";
        if (book) {
          book.textContent = hit
            ? `本站挂单 ${Number(hit.price) / 1e18} OKB`
            : "本站还没有这枚的挂单。";
        }
        if (buy) buy.hidden = !hit;
      })
      .catch(() => {
        if (book) book.textContent = "本站挂单没读到。";
      });
  };
  host.querySelector("#ext-close")?.addEventListener("click", () => {
    const sheet = host.querySelector<HTMLElement>("#ext-sheet");
    if (sheet) sheet.hidden = true;
  }, opt);
  host.querySelector("#ext-sheet")?.addEventListener("click", (event) => {
    const sheet = host.querySelector<HTMLElement>("#ext-sheet");
    if (event.target === sheet && sheet) sheet.hidden = true;
  }, opt);
  host.querySelector("#ext-buy")?.addEventListener("click", () => void (async () => {
    const sheet = host.querySelector<HTMLElement>("#ext-sheet");
    const msg = host.querySelector("#ext-msg");
    const raw = sheet?.dataset.order || "";
    if (!raw) {
      if (msg) msg.textContent = sheet?.dataset.token
        ? "本站还没有可成交的签名。"
        : "以太坊上的系列没有拿到签名，这一下不会发交易。";
      return;
    }
    const button = host.querySelector<HTMLButtonElement>("#ext-buy");
    if (button) button.disabled = true;
    if (msg) msg.textContent = "等钱包确认。付的是挂单价的 OKB。";
    try {
      if (!getProvider()) {
        showSheet(true);
        if (msg) msg.textContent = "先连接钱包。";
        return;
      }
      const from = await connectXLayer();
      const done = await buyTapeOnSite(from, JSON.parse(raw) as BookOrder);
      if (msg) msg.textContent = `已提交。${done.url}`;
      if (sheet) sheet.dataset.order = "";
    } catch (error) {
      if (msg) msg.textContent = bookError(error);
    } finally {
      if (button) button.disabled = false;
    }
  })(), opt);
  host.querySelector("#ext-list")?.addEventListener("click", () => void (async () => {
    const sheet = host.querySelector<HTMLElement>("#ext-sheet");
    const msg = host.querySelector("#ext-msg");
    const tokenId = sheet?.dataset.token || "";
    const price = host.querySelector<HTMLInputElement>("#ext-price")?.value ?? "";
    const button = host.querySelector<HTMLButtonElement>("#ext-list");
    if (!tokenId || !button) return;
    button.disabled = true;
    if (msg) msg.textContent = "等钱包确认。第一次要先授权这枚 NFT。";
    try {
      if (!getProvider()) {
        showSheet(true);
        if (msg) msg.textContent = "先连接钱包。";
        return;
      }
      const from = await connectXLayer();
      await listTapeOnSite(from, tokenId, price);
      if (msg) msg.textContent = "已经挂在本站。买家在这里付 OKB。";
      openExt(`TapeCode #${tokenId}`, host.querySelector("#ext-px")?.textContent || "", tokenId);
    } catch (error) {
      if (msg) msg.textContent = bookError(error);
    } finally {
      button.disabled = false;
    }
  })(), opt);

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
          openExt(card.name, floorText(card));
        });
        row.append(img, meta, deal);
        row.addEventListener("click", () => openExt(card.name, floorText(card)));
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
        row.addEventListener("click", () => openExt(card.name, floorText(card)));
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
          openExt(card.name, floorText(card));
        });
        tr.children[4]?.append(deal);
        tr.addEventListener("click", () => openExt(card.name, floorText(card)));
        body.append(tr);
      }
      if (movers && moverCount < 3) {
        moverCount += 1;
        const tile = document.createElement("button");
        tile.type = "button";
        tile.className = "mover cat-item js-live";
        tile.dataset.cat = card.cat;
        tile.dataset.name = card.name;
        tile.style.backgroundImage = `url("${card.image.replace(/"/g, "")}")`;
        const cap = document.createElement("div");
        cap.className = "cap";
        const title = document.createElement("b");
        title.textContent = card.name;
        const sub = document.createElement("span");
        sub.textContent = `地板 ${floorText(card)}`;
        cap.append(title, sub);
        tile.append(cap);
        tile.addEventListener("click", () => openExt(card.name, floorText(card)));
        movers.append(tile);
      }
    }
    placeTape();
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
        note.textContent = t("refNote");
      }
    })
    .catch(() => {
      const note = host.querySelector("#os-note");
      if (note) note.textContent = t("refNote");
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
      say("先连接钱包。BSC 的挂单和卖出在这里签，链要切到 BSC。");
      return null;
    }
    try {
      await ensureBsc(eth);
    } catch (error) {
      say(tradeError(error));
      return null;
    }
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
    void bscRpc({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0xcA11bde05977b3631167028862bE2a173976CA11", data }, "latest"] })
      .then((result) => {
        const decoded = decodeFunctionResult({ abi: multicallAbi, functionName: "aggregate", data: result as `0x${string}` });
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
        const body = host.querySelector("#tape-body");
        if (body && body.textContent?.includes("正在读取")) body.textContent = "行情没读到。刷新后再挂单。";
      });
  };
  const circuitMarket = "0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f";
  const circuitAbi = parseAbi([
    "function listingFor(address circuits, uint256 tokenId) view returns (uint256 id, address seller, uint96 price, bool valid)",
    "function buy(uint256 id, uint96 expectedPrice) payable",
  ]);
  const circuitMulti = parseAbi([
    "function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)",
  ]);
  type ListedCircuit = ProtocolCircuit & { listingId: bigint | null; price: bigint | null };
  let protoPick: ListedCircuit | null = null;
  const paintCircuits = (rows: ListedCircuit[], noteText: string) => {
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
      const card = document.createElement("button");
      card.className = "token";
      card.type = "button";
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
      line.textContent = row.price != null
        ? `在售 ${formatBnb(row.price)} BNB · 点此购买`
        : `最近成交 ${row.grossBnb.toFixed(4)} BNB · 未挂单`;
      meta.append(title, line);
      card.append(mark, meta);
      card.addEventListener("click", () => {
        protoPick = row;
        const sheet = host.querySelector<HTMLElement>("#proto-sheet");
        const name = host.querySelector("#proto-name");
        const px = host.querySelector("#proto-px");
        const link = host.querySelector<HTMLAnchorElement>("#proto-link");
        const buy = host.querySelector<HTMLButtonElement>("#proto-buy");
        const message = host.querySelector("#proto-msg");
        if (name) name.textContent = `电路 #${row.tokenId}`;
        if (px) px.textContent = row.price != null ? `官网挂单 ${formatBnb(row.price)} BNB` : "没有有效挂单，不能按最近成交价买。";
        if (link) link.href = `https://bscscan.com/nft/${row.circuit}/${row.tokenId}`;
        if (buy) buy.hidden = row.price == null;
        if (message) message.textContent = "";
        if (sheet) sheet.hidden = false;
      });
      grid.append(card);
    }
  };
  const formatBnb = (wei: bigint) => {
    const whole = Number(wei) / 1e18;
    if (!Number.isFinite(whole)) return "—";
    return whole.toLocaleString("en-US", { maximumFractionDigits: 4 });
  };
  const loadCircuits = () => {
    void getProtocolNfts()
      .then(async (data) => {
        if (!alive) return;
        const listed = data.circuits.length === 0
          ? []
          : await (async () => {
              const calls = data.circuits.map((row) => ({
                target: circuitMarket,
                callData: encodeFunctionData({
                  abi: circuitAbi,
                  functionName: "listingFor",
                  args: [row.circuit as `0x${string}`, BigInt(row.tokenId)],
                }),
              }));
              const dataHex = encodeFunctionData({ abi: circuitMulti, functionName: "aggregate", args: [calls] });
              const result = await bscRpc({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [{ to: "0xcA11bde05977b3631167028862bE2a173976CA11", data: dataHex }, "latest"],
              });
              if (!result || result === "0x") return data.circuits.map((row) => ({ ...row, listingId: null, price: null }));
              const decoded = decodeFunctionResult({
                abi: circuitMulti,
                functionName: "aggregate",
                data: result as `0x${string}`,
              }) as readonly [bigint, `0x${string}`[]];
              return data.circuits.map((row, index) => {
                try {
                  const item = decodeFunctionResult({
                    abi: circuitAbi,
                    functionName: "listingFor",
                    data: decoded[1][index],
                  }) as readonly [bigint, string, bigint, boolean];
                  if (!item[3] || item[2] <= 0n) return { ...row, listingId: null, price: null };
                  return { ...row, listingId: item[0], price: item[2] };
                } catch {
                  return { ...row, listingId: null, price: null };
                }
              });
            })();
        const onSale = listed.filter((row) => row.price != null).length;
        paintCircuits(
          listed,
          data.ok
            ? `协议电路和创世是同一份官网市场。这一屏 ${onSale} 枚有挂单，用已连接的钱包付挂单价。没挂单的不能买。`
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
  host.querySelector("#proto-close")?.addEventListener("click", () => {
    const sheet = host.querySelector<HTMLElement>("#proto-sheet");
    if (sheet) sheet.hidden = true;
  }, opt);
  host.querySelector("#proto-sheet")?.addEventListener("click", (event) => {
    const sheet = host.querySelector<HTMLElement>("#proto-sheet");
    if (event.target === sheet && sheet) sheet.hidden = true;
  }, opt);
  host.querySelector("#proto-buy")?.addEventListener("click", () => void (async () => {
    const row = protoPick;
    const message = host.querySelector("#proto-msg");
    const sayProto = (text: string) => {
      if (message) message.textContent = text;
    };
    if (!row?.listingId || row.price == null || row.price <= 0n) {
      sayProto("没有有效挂单，不能按最近成交价买。");
      return;
    }
    const button = host.querySelector<HTMLButtonElement>("#proto-buy");
    if (button) button.disabled = true;
    try {
      if (!getProvider()) {
        showSheet(true);
        sayProto(uiLang() === "zh" ? "先连接钱包，再切到 BSC 购买。" : "Connect a wallet, then switch to BSC.");
        return;
      }
      const eth = getProvider();
      if (!eth) throw new Error("nowallet");
      await ensureBsc(eth);
      let from = currentAccount();
      if (!from) {
        const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
        from = accounts[0] ?? null;
      }
      if (!from) throw new Error("nowallet");
      const call = encodeFunctionData({
        abi: circuitAbi,
        functionName: "listingFor",
        args: [row.circuit as `0x${string}`, BigInt(row.tokenId)],
      });
      const result = await bscRpc({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: circuitMarket, data: call }, "latest"] });
      if (!result || result === "0x") throw new Error("挂单没了");
      const decoded = decodeFunctionResult({ abi: circuitAbi, functionName: "listingFor", data: result as `0x${string}` }) as readonly [bigint, string, bigint, boolean];
      if (!decoded[3] || decoded[0] !== row.listingId || decoded[2] !== row.price) {
        sayProto("挂单变了。刷新后再买，没有按旧价格发出去。");
        return;
      }
      sayProto(`正在付 ${formatBnb(row.price)} BNB。只签官网市场这一笔，不另扣服务费。`);
      const data = encodeFunctionData({
        abi: circuitAbi,
        functionName: "buy",
        args: [row.listingId, row.price],
      });
      const hash = await sendTx(eth, { from, to: circuitMarket, data, value: row.price });
      sayProto(`买单已提交 ${short(hash)}。等链上确认。`);
      const ok = await whenMined(eth, hash);
      if (!alive) return;
      if (!ok) {
        sayProto("还没确认成功，没有放礼花。");
        return;
      }
      sayProto(`已确认 ${short(hash)}。`);
      showMintWin(host, uiLang() === "zh" ? "恭喜，这枚协议电路已经属于你。" : "This circuit is yours.");
    } catch (error) {
      sayProto(tradeError(error));
    } finally {
      if (button) button.disabled = false;
    }
  })(), opt);

  const swapPair = () => (host.querySelector<HTMLButtonElement>("#swap-pair .on")?.dataset.pair as SwapPair) || "bsc-bem";
  const swapSide = () => (host.querySelector<HTMLButtonElement>("#swap-side .on")?.dataset.side as SwapSide) || "buy";
  const bridgeDir = () => (host.querySelector<HTMLButtonElement>("#bridge-dir .on")?.dataset.dir as BridgeDir) || "to-xlayer";
  const pick = (box: string, button: HTMLButtonElement) => {
    host.querySelectorAll<HTMLButtonElement>(`${box} .fbtn`).forEach((node) => node.classList.remove("on"));
    button.classList.add("on");
  };
  const paintTok = (id: string, symbol: "USDT" | "OKB" | "BEM" | "TAPE") => {
    const node = host.querySelector(id);
    if (!node) return;
    const mark = node.querySelector("i");
    const img = node.querySelector("img");
    const label = node.querySelector("b");
    if (label) label.textContent = symbol;
    const src = symbol === "BEM" ? "/tape-launch/tokens/bem.jpg" : symbol === "OKB" ? "/tape-launch/tokens/okb.png" : "";
    if (img) {
      img.hidden = !src;
      if (src) img.src = src;
    }
    if (mark) {
      mark.hidden = Boolean(src);
      mark.textContent = symbol === "TAPE" ? "T" : "₮";
      mark.classList.toggle("tape", symbol === "TAPE");
    }
  };
  const paySymbol = (): "USDT" | "OKB" | "BEM" | "TAPE" => {
    if (swapSide() === "sell") return swapPair() === "xl-tape" ? "TAPE" : "BEM";
    if (swapPair() === "bsc-bem") return "USDT";
    if (swapPair() === "xl-tape") return "USDT";
    return "OKB";
  };
  const paintSwapLabel = () => {
    const pair = swapPair();
    const buy = swapSide() === "buy";
    const pay = paySymbol();
    const recv = buy ? (pair === "xl-tape" ? "TAPE" : "BEM") : pair === "bsc-bem" || pair === "xl-tape" ? "USDT" : "OKB";
    const payLabel = host.querySelector("#swap-in-label");
    const recvLabel = host.querySelector("#swap-out-label");
    if (payLabel) payLabel.textContent = t("swapPay");
    if (recvLabel) recvLabel.textContent = t("swapRecv");
    paintTok("#swap-in-tok", pay);
    paintTok("#swap-out-tok", recv);
  };
  let swapTicket = 0;
  const refreshSwap = () => {
    const ticket = ++swapTicket;
    const quote = host.querySelector("#swap-quote");
    const amount = host.querySelector("#swap-out-amt");
    const raw = host.querySelector<HTMLInputElement>("#swap-amt")?.value ?? "";
    paintSwapLabel();
    if (!quote || !amount) return;
    void quoteSwap(swapPair(), swapSide(), raw)
      .then((row) => {
        if (!alive || ticket !== swapTicket) return;
        amount.textContent = row.amount;
        const tape = swapPair() === "xl-tape";
        quote.textContent = tape
          ? (row.live ? "报价来自官方 TAPE 池。流动性很小。" : "报价能读。池子没开，这一下不会发交易。")
          : row.venue === "bsc" ? t("quoteBsc") : t("quoteXl");
        const warn = host.querySelector<HTMLElement>("#swap-liq");
        const go = host.querySelector<HTMLButtonElement>("#swap-go");
        if (warn) {
          warn.hidden = !tape;
          warn.textContent = row.note;
        }
        if (go) {
          const closed = tape && !row.live;
          go.disabled = closed;
          go.textContent = closed ? "池子未开" : t("swapGo");
        }
      })
      .catch((error) => {
        if (!alive || ticket !== swapTicket) return;
        amount.textContent = "—";
        quote.textContent = deskError(error);
        const warn = host.querySelector<HTMLElement>("#swap-liq");
        const go = host.querySelector<HTMLButtonElement>("#swap-go");
        if (warn) warn.hidden = swapPair() !== "xl-tape";
        if (go && swapPair() !== "xl-tape") {
          go.disabled = false;
          go.textContent = t("swapGo");
        }
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
  let bals: CoinBals | null = null;
  const paintBals = async () => {
    const account = currentAccount();
    const nodes = {
      usdt: host.querySelector("#bal-usdt"),
      okb: host.querySelector("#bal-okb"),
      bem: host.querySelector("#bal-bem"),
      tape: host.querySelector("#bal-tape"),
      usdtCh: host.querySelector("#bal-usdt-ch"),
      bemCh: host.querySelector("#bal-bem-ch"),
    };
    if (!account) {
      bals = null;
      if (nodes.usdt) nodes.usdt.textContent = "—";
      if (nodes.okb) nodes.okb.textContent = "—";
      if (nodes.bem) nodes.bem.textContent = "—";
      if (nodes.tape) nodes.tape.textContent = "—";
      return;
    }
    try {
      const next = await readSwapBalances(account);
      if (!alive || currentAccount()?.toLowerCase() !== account.toLowerCase()) return;
      bals = next;
      const tape = swapPair() === "xl-tape";
      if (nodes.usdt) nodes.usdt.textContent = tape ? next.usdtXl : next.usdtBsc;
      if (nodes.usdtCh) nodes.usdtCh.textContent = tape ? "X Layer" : "BSC";
      if (nodes.okb) nodes.okb.textContent = next.okb;
      if (nodes.bem) nodes.bem.textContent = swapPair() === "bsc-bem" ? next.bemBsc : next.bemXl;
      if (nodes.bemCh) nodes.bemCh.textContent = swapPair() === "bsc-bem" ? "BSC" : "X Layer";
      if (nodes.tape) nodes.tape.textContent = next.tape;
    } catch {
      if (nodes.usdt) nodes.usdt.textContent = "—";
    }
  };
  const fillPay = (symbol: "usdt" | "okb" | "bem" | "tape") => {
    const pairBtn = (pair: SwapPair) => host.querySelector<HTMLButtonElement>(`#swap-pair [data-pair="${pair}"]`);
    const sideBtn = (side: SwapSide) => host.querySelector<HTMLButtonElement>(`#swap-side [data-side="${side}"]`);
    const choose = (pair: SwapPair, side: SwapSide) => {
      const a = pairBtn(pair);
      const b = sideBtn(side);
      if (a) pick("#swap-pair", a);
      if (b) pick("#swap-side", b);
    };
    if (symbol === "usdt") choose(swapPair() === "xl-tape" ? "xl-tape" : "bsc-bem", "buy");
    if (symbol === "okb") choose("xl-bem", "buy");
    if (symbol === "bem") choose(swapPair() === "bsc-bem" ? "bsc-bem" : "xl-bem", "sell");
    if (symbol === "tape") choose("xl-tape", "sell");
    const input = host.querySelector<HTMLInputElement>("#swap-amt");
    const value = !bals
      ? ""
      : symbol === "usdt"
        ? swapPair() === "xl-tape" ? bals.usdtXl : bals.usdtBsc
        : symbol === "okb"
          ? bals.okb
          : symbol === "bem"
            ? swapPair() === "bsc-bem" ? bals.bemBsc : bals.bemXl
            : bals.tape;
    if (input && value && value !== "0") {
      const n = Number(value);
      input.value = symbol === "okb" && n > 0.002 ? String(Math.floor((n - 0.002) * 1e6) / 1e6) : value;
    }
    refreshSwap();
    void paintBals();
  };
  host.querySelector("#swap-bals")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    const fill = button?.dataset.fill;
    if (fill === "usdt" || fill === "okb" || fill === "bem" || fill === "tape") fillPay(fill);
  }, opt);
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
  host.querySelector("#factory-go")?.addEventListener("click", () => void (async () => {
    const button = host.querySelector<HTMLButtonElement>("#factory-go");
    const msg = host.querySelector("#factory-msg");
    if (!button || button.disabled) return;
    button.disabled = true;
    if (msg) {
      msg.textContent = "等钱包确认。这一步不转 OKB，只把数量写进工厂。";
      msg.scrollIntoView({ block: "nearest" });
    }
    try {
      if (!getProvider()) {
        showSheet(true);
        if (msg) msg.textContent = "先连接收费钱包，再签名部署。";
        return;
      }
      const from = await connectXLayer();
      if (from.toLowerCase() !== FACTORY_PLATFORM.toLowerCase()) {
        if (msg) msg.textContent = `部署和收费都只用 ${FACTORY_PLATFORM}。请换成这个钱包再签名。`;
        return;
      }
      const seed = parseEther((host.querySelector<HTMLInputElement>("#factory-okb")?.value ?? "").trim());
      if (seed <= 0n || seed > parseEther("10")) throw new Error("amount");
      const eth = getProvider();
      if (!eth) throw new Error("nowallet");
      const data = factoryDeployData(seed);
      const estimated = await eth.request({
        method: "eth_estimateGas",
        params: [{ from, data, value: "0x0" }],
      });
      const gas = (BigInt(String(estimated)) * 12n) / 10n + 80_000n;
      const hash = (await eth.request({
        method: "eth_sendTransaction",
        params: [{ from, chainId: "0xc4", data, value: "0x0", gas: `0x${gas.toString(16)}` }],
      })) as string;
      showLink("#factory-link", txUrl(hash), "查看这笔部署");
      let deployed = "";
      for (let i = 0; i < 8; i++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const receipt = (await eth.request({
          method: "eth_getTransactionReceipt",
          params: [hash],
        })) as { contractAddress?: string | null; status?: string } | null;
        if (receipt?.status === "0x0") throw new Error("revert");
        if (receipt?.contractAddress) {
          deployed = receipt.contractAddress;
          break;
        }
      }
      if (msg) {
        msg.textContent = deployed
          ? `工厂 ${deployed}。创建按钮仍然关着。源码核对之前不要把这个地址写进页面。`
          : "部署已提交。上链后在浏览器里看新合约地址，先不要写进页面。";
      }
    } catch (error) {
      if (msg) msg.textContent = deskError(error);
    } finally {
      button.disabled = false;
    }
  })(), opt);
  host.querySelectorAll<HTMLButtonElement>("[data-open-swap]").forEach((node) => {
    node.addEventListener("click", () => {
      const pair = node.dataset.openSwap;
      const side = node.dataset.openSide;
      const pairBtn = host.querySelector<HTMLButtonElement>(`#swap-pair [data-pair="${pair}"]`);
      const sideBtn = host.querySelector<HTMLButtonElement>(`#swap-side [data-side="${side}"]`);
      if (pairBtn) pick("#swap-pair", pairBtn);
      if (sideBtn) pick("#swap-side", sideBtn);
      refreshSwap();
      open("tokens");
    }, opt);
  });
  host.querySelector("#swap-go")?.addEventListener("click", () => void (async () => {
    const button = host.querySelector<HTMLButtonElement>("#swap-go");
    const msg = host.querySelector("#swap-msg");
    if (!button || button.disabled) return;
    button.disabled = true;
    if (msg) msg.textContent = t("swapWait");
    try {
      if (!getProvider()) {
        showSheet(true);
        if (msg) msg.textContent = t("swapNeed");
        return;
      }
      const done = await runSwap(swapPair(), swapSide(), host.querySelector<HTMLInputElement>("#swap-amt")?.value ?? "");
      if (msg) msg.textContent = t("swapSent");
      showLink("#swap-link", done.url, t("swapView"));
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
      if (!getProvider()) {
        showSheet(true);
        if (msg) msg.textContent = "先连接钱包。去 X Layer 时用 BSC，回来时用 X Layer。右上角可以切。";
        return;
      }
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
    void paintBals();
  }, 20_000);
  void paintBals();
  const stopBal = onAccount(() => {
    void paintBals();
  });

  const langBtn = host.querySelector<HTMLButtonElement>("#btn-lang");
  const paintLang = () => {
    applyDom(host);
    paintTheme(host.dataset.theme === "dark" ? "dark" : "light");
    paintAccount(currentAccount());
    refreshSwap();
    if (langBtn) langBtn.textContent = t("langBtn");
  };
  bootLang();
  paintLang();
  langBtn?.addEventListener("click", () => setUiLang(uiLang() === "zh" ? "en" : "zh"), opt);
  const stopLang = onLang(paintLang);

  const stopGenesis = bootGenesis(host);
  let tapeHead: Awaited<ReturnType<typeof getTapeCode>> | null = null;
  let tapeCards: Awaited<ReturnType<typeof getTapeCode>>["cards"] = [];
  let tapeCursor = "";
  let tapeMore = false;
  let tapeBusy = false;
  let tapeOpen = false;
  const paintTapeOpen = () => {
    const fold = host.querySelector<HTMLElement>("#tape-fold");
    const banner = host.querySelector<HTMLElement>("#tape-banner");
    const label = host.querySelector("#tape-open");
    if (fold) fold.hidden = !tapeOpen;
    if (banner) banner.setAttribute("aria-expanded", tapeOpen ? "true" : "false");
    if (label) label.textContent = tapeOpen
      ? (uiLang() === "zh" ? "收起挂单" : "Hide listings")
      : (uiLang() === "zh" ? "点开看挂单" : "Show listings");
  };
  const renderTape = () => {
    const banner = host.querySelector<HTMLElement>("#tape-banner");
    const logo = host.querySelector<HTMLImageElement>("#tape-logo");
    const desc = host.querySelector("#tape-desc");
    const metrics = host.querySelector("#tape-metrics");
    const note = host.querySelector("#tape-code-note");
    const grid = host.querySelector("#tape-grid");
    const more = host.querySelector<HTMLButtonElement>("#tape-more");
    const head = tapeHead;
    if (!head) return;
    if (!head.ok || !grid || !metrics) {
      if (note) {
        note.hidden = false;
        note.textContent = head?.error ? `OKX 合集没读到：${head.error}` : "OKX 合集没读到。";
      }
      paintTapeOpen();
      return;
    }
    if (banner && head.logo) banner.style.backgroundImage = `url("${tapeImage(head.logo)}")`;
    if (logo && head.logo) logo.src = tapeImage(head.logo);
    const supply = head.supply == null ? "—" : head.supply.toLocaleString("en-US");
    if (desc) {
      desc.textContent = uiLang() === "zh" ? `X Layer · ${supply}` : `X Layer · ${supply}`;
    }
    const cells = [
      [head.floor ? `${head.floor} OKB` : "—", uiLang() === "zh" ? "地板价" : "Floor"],
      [head.offer ? `${head.offer} OKB` : "—", uiLang() === "zh" ? "最高出价" : "Best offer"],
      [head.volume ? `${Number(head.volume).toLocaleString("en-US", { maximumFractionDigits: 0 })} OKB` : "—", uiLang() === "zh" ? "总成交" : "Volume"],
      [head.owners || "—", uiLang() === "zh" ? "持有人" : "Owners"],
      [head.listed || "—", uiLang() === "zh" ? "在售" : "Listed"],
      [head.change || "—", uiLang() === "zh" ? "地板 24h" : "Floor 24h"],
    ];
    metrics.replaceChildren();
    for (const [value, label] of cells) {
      const box = document.createElement("div");
      const strong = document.createElement("b");
      strong.textContent = value;
      const span = document.createElement("span");
      span.textContent = label;
      box.append(strong, span);
      metrics.append(box);
    }
    if (note) note.hidden = true;
    grid.replaceChildren();
    for (const card of tapeCards) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "tape-card";
      const face = document.createElement("div");
      face.className = "face";
      if (head.logo) {
        const img = document.createElement("img");
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.src = tapeImage(head.logo);
        face.style.backgroundImage = `url("${tapeImage(head.logo)}")`;
        face.append(img);
      }
      const badge = document.createElement("em");
      badge.textContent = `#${card.tokenId}`;
      face.append(badge);
      const meta = document.createElement("div");
      meta.className = "px";
      const title = document.createElement("b");
      title.textContent = card.price ? `${card.price} OKB` : uiLang() === "zh" ? "未标价" : "Unlisted";
      const line = document.createElement("span");
      const bits: string[] = [];
      if (card.usd && Number(card.usd)) bits.push(`$${Number(card.usd).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
      if (card.last) bits.push(uiLang() === "zh" ? `上次 ${card.last} OKB` : `last ${card.last} OKB`);
      line.textContent = bits.join(" · ") || card.name;
      meta.append(title, line);
      link.append(face, meta);
      link.addEventListener("click", () => {
        const price = card.price ? `${card.price} OKB` : (uiLang() === "zh" ? "未标价" : "Unpriced");
        openExt(`TapeCode #${card.tokenId}`, price, card.tokenId);
      });
      grid.append(link);
    }
    if (more) {
      more.hidden = !tapeMore;
      more.disabled = tapeBusy;
      more.textContent = uiLang() === "zh" ? "更多挂单" : "More listings";
    }
    paintTapeOpen();
    placeTape();
  };
  const pinPunk = () => {
    const row = host.querySelector<HTMLElement>("#rank-punk");
    const floor = row?.querySelector(".floor");
    if (floor) floor.textContent = uiLang() === "zh" ? "铸造中" : "Minting";
    if (row && !row.dataset.bound) {
      row.dataset.bound = "1";
      row.addEventListener("click", () => open("trade"));
    }
  };
  const openTape = () => {
    open("discover");
    tapeOpen = true;
    paintTapeOpen();
    host.querySelector("#tape-banner")?.scrollIntoView({ block: "nearest" });
  };
  const placeTape = () => {
    host.querySelectorAll(".js-tape-pin").forEach((node) => node.remove());
    const head = tapeHead;
    const rankRow = host.querySelector<HTMLElement>("#rank-tape");
    if (rankRow && !rankRow.dataset.bound) {
      rankRow.dataset.bound = "1";
      rankRow.addEventListener("click", openTape);
    }
    if (!head?.ok) {
      pinPunk();
      return;
    }
    const floor = head.floor ? `${head.floor} OKB` : "—";
    const shown = tapeImage(head.logo);
    if (rankRow) {
      const img = rankRow.querySelector("img");
      if (img) img.src = shown;
      const floorEl = rankRow.querySelector(".floor");
      if (floorEl) floorEl.textContent = floor;
    }
    const grid = host.querySelector("#series-grid");
    if (grid) {
      const row = document.createElement("div");
      row.className = "mini js-tape-pin";
      const img = document.createElement("img");
      img.alt = "";
      if (head.logo) img.src = shown;
      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("b");
      title.textContent = "TapeCode-Test1";
      const sub = document.createElement("span");
      sub.textContent = `${floor} · X Layer`;
      meta.append(title, sub);
      row.append(img, meta);
      row.addEventListener("click", openTape);
      grid.prepend(row);
    }
    const body = host.querySelector("#market-body");
    if (body) {
      const tr = document.createElement("tr");
      tr.className = "js-tape-pin";
      tr.innerHTML = `<td></td><td class="right"></td><td class="right">—</td><td class="right">—</td><td></td>`;
      const nameCell = document.createElement("div");
      nameCell.className = "namecell";
      const img = document.createElement("img");
      img.className = "av";
      img.alt = "";
      if (head.logo) img.src = shown;
      const spanName = document.createElement("span");
      spanName.textContent = "TapeCode-Test1 · X Layer";
      nameCell.append(img, spanName);
      tr.children[0]?.append(nameCell);
      const cell = tr.children[1];
      if (cell) cell.textContent = floor;
      tr.addEventListener("click", openTape);
      body.prepend(tr);
    }
    pinPunk();
  };
  pinPunk();
  const tapeoutBody = host.querySelector<HTMLElement>("#tapeout-body");
  const tapeoutBtn = host.querySelector<HTMLButtonElement>("#tapeout-toggle");
  const tapeoutLabel = host.querySelector("#tapeout-label");
  tapeoutBtn?.addEventListener("click", () => {
    if (!tapeoutBody || !tapeoutBtn) return;
    const opening = tapeoutBody.hidden;
    tapeoutBody.hidden = !opening;
    tapeoutBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    if (tapeoutLabel) tapeoutLabel.textContent = opening ? (uiLang() === "zh" ? "隐藏" : "Hide") : (uiLang() === "zh" ? "打开" : "Open");
  }, opt);
  const pullTape = (cursor: string) => {
    if (tapeBusy) return;
    tapeBusy = true;
    const more = host.querySelector<HTMLButtonElement>("#tape-more");
    if (more) more.disabled = true;
    void getTapeCode({ data: { cursor } })
      .then((data) => {
        if (!alive) return;
        if (!cursor) {
          tapeHead = data;
          tapeCards = data.ok ? data.cards : [];
        } else if (data.ok) {
          const seen = new Set(tapeCards.map((card) => card.tokenId));
          tapeCards = tapeCards.concat(data.cards.filter((card) => !seen.has(card.tokenId)));
        }
        if (data.ok) {
          tapeCursor = data.cursor;
          tapeMore = data.more;
        }
      })
      .catch(() => {
        if (alive && !tapeHead) tapeHead = { ok: false, error: "okx", name: "TapeCode-Test1", contract: "", desc: "", supply: null, floor: "", offer: "", volume: "", owners: "", listed: "", indexed: "", change: "", banner: "", logo: "", cursor: "", more: false, cards: [] };
      })
      .finally(() => {
        tapeBusy = false;
        if (alive) renderTape();
      });
  };
  pullTape("");
  const toggleTape = () => {
    tapeOpen = !tapeOpen;
    paintTapeOpen();
  };
  host.querySelector("#tape-banner")?.addEventListener("click", toggleTape, opt);
  host.querySelector("#tape-banner")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleTape();
  }, opt);
  host.querySelector("#tape-more")?.addEventListener("click", () => {
    if (tapeCursor) pullTape(tapeCursor);
  }, opt);
  const stopTapeLang = onLang(() => {
    if (alive) renderTape();
  });
  const stopCpunk = bootCpunk(host, ac.signal, showSheet, open);
  const stopEnglish = watchEnglish(host);

  return () => {
    alive = false;
    window.clearInterval(tapeTimer);
    window.clearInterval(protoTimer);
    window.clearInterval(deskTimer);
    stopAccount();
    stopBal();
    stopChain();
    stopLink();
    stopGenesis();
    stopTapeLang();
    stopLang();
    stopEnglish();
    stopCpunk();
    ac.abort();
  };
}
