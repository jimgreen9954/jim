import { decodeEventLog, decodeFunctionResult, encodeFunctionData, parseAbi, parseAbiItem, toHex } from "viem";
import { deskError } from "@/lib/asset-desk";
import { showMintWin, whenMined } from "@/lib/mint-win";
import { TAPE_BEM, TAPE_TOKEN } from "@/lib/tape-pool";
import { currentAccount, getProvider, onAccount } from "@/lib/wallet";
import { filterPunks, punkSheet, traitFacets, type PunkSort, type TraitKey } from "@/lib/circuit-punk";
import { onLang } from "@/lib/locale";
import { connectXLayer, xClient } from "@/lib/xlayer";

const CPUNK = "0xB5ac1dddc158a639D4499aad2d8F393989D4bD34" as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const FOUNDER = "0x571d447f4f24688ec35ccf07f1d6993655f6af15";
const MARTIAN = "0xddb587d88c0afa42317e033bdd11edc2462b873f";
const OFFICIAL = "0x2d44129d8ddb14ce5ac5ceebafa572eddd964c18";
const HOLDER_LABEL: Record<string, { name: string; tag: string }> = {
  [FOUNDER]: { name: "TapeOut 协议创始人", tag: "founder" },
  [MARTIAN]: { name: "火星人", tag: "mars" },
  [OFFICIAL]: { name: "TAPE NFT 官方", tag: "official" },
};
const client = xClient;
const coinAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ownerAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function publicMinted() view returns (uint32)",
  "function reserve() view returns (uint32)",
]);
const tryAbi = parseAbi(["function tryAggregate(bool requireSuccess,(address target,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])"]);

function bemText(raw: bigint): string {
  const whole = raw / 100_000_000n;
  const frac = (raw % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function bemRaw(text: string): bigint {
  const clean = text.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error("px");
  const [whole, frac = ""] = clean.split(".");
  return BigInt(whole) * 100_000_000n + BigInt((frac + "00000000").slice(0, 8));
}

function unitText(raw: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = raw / base;
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "").slice(0, 4);
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

function idSpans(ids: number[]): string {
  const sorted = [...ids].sort((a, b) => a - b);
  if (!sorted.length) return "";
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let index = 1; index <= sorted.length; index += 1) {
    const id = sorted[index];
    if (id === prev + 1) {
      prev = id;
      continue;
    }
    parts.push(start === prev ? `#${start}` : `#${start}–${prev}`);
    start = id;
    prev = id;
  }
  return parts.join(" ");
}

async function ownersOf(ids: number[]): Promise<(string | null)[]> {
  if (!ids.length) return [];
  const calls = ids.map((id) => ({
    target: CPUNK,
    callData: encodeFunctionData({ abi: ownerAbi, functionName: "ownerOf", args: [BigInt(id)] }),
  }));
  const data = encodeFunctionData({ abi: tryAbi, functionName: "tryAggregate", args: [false, calls] });
  const raw = await client.call({ to: MULTICALL, data });
  const decoded = decodeFunctionResult({ abi: tryAbi, functionName: "tryAggregate", data: raw.data ?? "0x" });
  return decoded.map((row) => (row.success && row.returnData.length >= 66 ? `0x${row.returnData.slice(-40)}`.toLowerCase() : null));
}

type CpunkWallet = { tape: bigint; bem: bigint; okb: bigint; count: bigint; ids: number[] };
const walletJobs = new Map<string, Promise<CpunkWallet>>();
const walletWatch = new Map<string, Set<(ids: number[], count: bigint) => void>>();

export function readCpunkWallet(address: `0x${string}`, onIds?: (ids: number[], count: bigint) => void): Promise<CpunkWallet> {
  const key = address.toLowerCase();
  if (onIds) {
    const set = walletWatch.get(key) ?? new Set();
    set.add(onIds);
    walletWatch.set(key, set);
  }
  const existing = walletJobs.get(key);
  if (existing) return existing;
  const job = (async (): Promise<CpunkWallet> => {
    const [tape, bem, okb, count, pub, reserve] = await Promise.all([
      client.readContract({ address: TAPE_TOKEN, abi: coinAbi, functionName: "balanceOf", args: [address] }),
      client.readContract({ address: TAPE_BEM, abi: coinAbi, functionName: "balanceOf", args: [address] }),
      client.getBalance({ address }),
      client.readContract({ address: CPUNK, abi: coinAbi, functionName: "balanceOf", args: [address] }),
      client.readContract({ address: CPUNK, abi: ownerAbi, functionName: "publicMinted" }),
      client.readContract({ address: CPUNK, abi: ownerAbi, functionName: "reserve" }),
    ]);
    const want = Number(count);
    const ids: number[] = [];
    const tell = () => walletWatch.get(key)?.forEach((fn) => fn([...ids], count));
    tell();
    if (want > 0) {
      const pubStart = Number(reserve) + 1;
      const all = [
        ...Array.from({ length: Number(pub) }, (_, index) => pubStart + index),
        ...Array.from({ length: Number(reserve) }, (_, index) => index + 1),
      ];
      for (let index = 0; index < all.length && ids.length < want; index += 80) {
        const slice = all.slice(index, index + 80);
        const owners = await ownersOf(slice);
        owners.forEach((owner, slot) => {
          if (owner === key) ids.push(slice[slot]);
        });
        ids.sort((a, b) => a - b);
        tell();
      }
    }
    return { tape, bem, okb, count, ids };
  })().finally(() => walletJobs.delete(key));
  walletJobs.set(key, job);
  return job;
}

export function bootCpunk(
  host: HTMLElement,
  signal: AbortSignal,
  askWallet: (openSheet: boolean) => void,
  openPage: (id: string) => void,
): () => void {
  const abi = parseAbi([
    "function publicMinted() view returns (uint32)",
    "function supply() view returns (uint32)",
    "function reserve() view returns (uint32)",
    "function live() view returns (bool)",
    "function closed() view returns (bool)",
    "function ownerOf(uint256) view returns (address)",
    "function listings(uint256) view returns (address seller, uint256 quote, uint64 at)",
    "function mint(uint256 qty, bytes32[] traits)",
    "function list(uint256 id, uint256 quote)",
    "function buy(uint256 id)",
    "function cancel(uint256 id)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ]);
  const listedEvent = parseAbiItem("event Listed(uint256 indexed id, address indexed seller, uint256 quote)");
  let listed = new Map<number, { seller: string; quote: bigint }>();
  const tradeNotes = new Map<number, string>();
  let minted = 0;
  let reserve = 7000;
  let supply = 10000;
  let live = true;
  let closed = false;
  let listsOnly = false;
  let openId = 0;
  let filterPage = 0;
  let sortMode: PunkSort = "rare";
  const filters: Partial<Record<TraitKey, string>> = {};
  const cut = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const send = async (from: string, to: string, data: string) => {
    const eth = getProvider();
    if (!eth) throw new Error("nowallet");
    let gas = 480_000n;
    try {
      const estimated = await eth.request({ method: "eth_estimateGas", params: [{ from, to, data, value: "0x0" }] });
      gas = (BigInt(String(estimated)) * 6n) / 5n + 30_000n;
    } catch {
      /* the wallet still has to confirm */
    }
    const hash = (await eth.request({
      method: "eth_sendTransaction",
      params: [{ from, to, data, value: "0x0", chainId: "0xc4", gas: `0x${gas.toString(16)}` }],
    })) as string;
    if (!(await whenMined(eth, hash))) throw new Error("revert");
    return hash;
  };
  const allow = async (from: string, token: `0x${string}`, need: bigint) => {
    const current = await client.readContract({ address: token, abi, functionName: "allowance", args: [from as `0x${string}`, CPUNK] });
    if (current >= need) return;
    await send(from, token, encodeFunctionData({ abi, functionName: "approve", args: [CPUNK, need] }));
  };

  let holderRows: { address: string; ids: number[] }[] = [];
  let holderSeen = 0;
  let holderTotal = 0;
  let holderPage = 0;
  const paintHolders = () => {
    const note = host.querySelector("#cp-holders-note");
    const body = host.querySelector("#cp-holders");
    const pageNote = host.querySelector("#cp-holder-page");
    const query = (host.querySelector<HTMLInputElement>("#cp-holder-q")?.value ?? "").trim().toLowerCase().replace(/^#/, "");
    if (note) {
      const named = [FOUNDER, MARTIAN, OFFICIAL].filter((addr) => holderRows.some((row) => row.address === addr)).length;
      note.textContent = holderSeen < holderTotal
        ? `已核对 ${holderSeen} / ${holderTotal} 张。三个标注地址里已出现 ${named} 个。`
        : `共 ${holderRows.length} 个持有地址。每页 30 个，创始人、火星人、官方在最前。`;
    }
    if (!body) return;
    const me = (currentAccount() ?? "").toLowerCase();
    const pool = holderSeen < holderTotal ? holderRows.filter((row) => HOLDER_LABEL[row.address]) : holderRows;
    const filtered = query
      ? pool.filter((row) => row.address.includes(query) || row.ids.some((id) => String(id).includes(query)) || (HOLDER_LABEL[row.address]?.name ?? "").toLowerCase().includes(query))
      : pool;
    const pages = Math.max(1, Math.ceil(filtered.length / 30));
    if (holderPage >= pages) holderPage = pages - 1;
    if (holderPage < 0) holderPage = 0;
    if (pageNote) pageNote.textContent = filtered.length ? `${holderPage + 1} / ${pages}` : "没有";
    body.replaceChildren();
    for (const row of filtered.slice(holderPage * 30, holderPage * 30 + 30)) {
      const tr = document.createElement("tr");
      const label = document.createElement("td");
      const mark = HOLDER_LABEL[row.address];
      if (mark) {
        const tag = document.createElement("span");
        tag.className = `tag ${mark.tag}`;
        tag.textContent = mark.name;
        label.append(tag);
      } else label.textContent = "持有人";
      if (row.address === me) {
        const you = document.createElement("span");
        you.className = "tag you";
        you.textContent = "你";
        you.style.marginLeft = "6px";
        label.append(you);
      }
      const addr = document.createElement("td");
      const link = document.createElement("a");
      link.href = `https://www.oklink.com/x-layer/address/${row.address}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = row.address;
      addr.append(link);
      const count = document.createElement("td");
      count.className = "right";
      count.textContent = String(row.ids.length);
      const ids = document.createElement("td");
      ids.textContent = idSpans(row.ids);
      tr.append(label, addr, count, ids);
      body.append(tr);
    }
  };
  host.querySelector("#cp-holder-prev")?.addEventListener("click", () => {
    holderPage -= 1;
    paintHolders();
  }, { signal });
  host.querySelector("#cp-holder-next")?.addEventListener("click", () => {
    holderPage += 1;
    paintHolders();
  }, { signal });
  host.querySelector("#cp-holder-q")?.addEventListener("input", () => {
    holderPage = 0;
    paintHolders();
  }, { signal });

  const scanHolders = async () => {
    const note = host.querySelector("#cp-holders-note");
    try {
      const [pub, heldReserve] = await Promise.all([
        client.readContract({ address: CPUNK, abi: ownerAbi, functionName: "publicMinted" }),
        client.readContract({ address: CPUNK, abi: ownerAbi, functionName: "reserve" }),
      ]);
      const publicIds = Array.from({ length: Number(pub) }, (_, index) => Number(heldReserve) + 1 + index);
      const rows = await Promise.all(publicIds.map((id) => client.readContract({ address: CPUNK, abi, functionName: "listings", args: [BigInt(id)] }).catch(() => null)));
      publicIds.forEach((id, place) => {
        const row = rows[place];
        if (row && row[0].toLowerCase() !== ZERO && row[1] > 0n) listed.set(id, { seller: row[0], quote: row[1] });
      });
      if (listed.size) paint();
      const ids = [...publicIds, ...Array.from({ length: Number(heldReserve) }, (_, index) => index + 1)];
      const bags = new Map<string, number[]>();
      let seen = 0;
      if (note) note.textContent = `正在核对 ${ids.length} 张的持有地址。`;
      for (let index = 0; index < ids.length; index += 320) {
        if (signal.aborted) return;
        const wave = [0, 1, 2, 3].map((slot) => ids.slice(index + slot * 80, index + (slot + 1) * 80)).filter((slice) => slice.length);
        let owners: (string | null)[][] = [];
        try {
          owners = await Promise.all(wave.map((slice) => ownersOf(slice)));
        } catch {
          continue;
        }
        const escrow: number[] = [];
        wave.forEach((slice, slot) => {
          owners[slot].forEach((owner, place) => {
            seen += 1;
            if (!owner) return;
            if (owner === CPUNK.toLowerCase()) escrow.push(slice[place]);
            const bag = bags.get(owner) ?? [];
            bag.push(slice[place]);
            bags.set(owner, bag);
          });
        });
        if (escrow.length) {
          const rows = await Promise.all(escrow.map((id) => client.readContract({ address: CPUNK, abi, functionName: "listings", args: [BigInt(id)] }).catch(() => null)));
          escrow.forEach((id, place) => {
            const row = rows[place];
            if (row && row[0].toLowerCase() !== ZERO && row[1] > 0n) listed.set(id, { seller: row[0], quote: row[1] });
          });
        }
        holderSeen = seen;
        holderTotal = ids.length;
        holderRows = [...bags.entries()]
          .map(([address, held]) => ({ address, ids: held }))
          .sort((a, b) => {
            const rank = (addr: string) => (addr === FOUNDER ? 0 : addr === MARTIAN ? 1 : addr === OFFICIAL ? 2 : 9);
            return rank(a.address) - rank(b.address) || b.ids.length - a.ids.length || (a.address < b.address ? -1 : 1);
          });
        paintHolders();
        paint();
        await new Promise((resolve) => window.setTimeout(resolve, 30));
      }
    } catch {
      if (note) note.textContent = "持有地址这次没读完。刷新后再对一次。";
    }
  };

  const paintAssets = (address: string | null) => {
    const box = host.querySelector("#punk-hold");
    const idsBox = host.querySelector("#punk-hold-ids");
    const mine = host.querySelector("#cp-mine-row");
    const mineNote = host.querySelector("#cp-mine");
    const note = host.querySelector("#punk-hold-note");
    const countNode = host.querySelector("#bal-punk");
    const owned = host.querySelector("#cp-owned");
    if (!address) {
      if (countNode) countNode.textContent = "—";
      if (note) note.textContent = "连接钱包后，这里显示张数、编号和图片。";
      idsBox?.replaceChildren();
      box?.replaceChildren();
      mine?.replaceChildren();
      return;
    }
    if (countNode) countNode.textContent = "…";
    const draw = (ids: number[], count: bigint, done: boolean) => {
      if (signal.aborted || currentAccount()?.toLowerCase() !== address.toLowerCase()) return;
      if (countNode) countNode.textContent = count.toString();
      const mineListings = [...listed.entries()]
        .filter((row) => row[1].seller.toLowerCase() === address.toLowerCase())
        .map((row) => row[0]);
      const held = [...new Set([...ids, ...mineListings])].sort((a, b) => a - b);
      if (note) {
        const selling = mineListings.length ? `另有 ${mineListings.length} 张挂单中。` : "";
        note.textContent = count === 0n && !mineListings.length
          ? "这个地址还没有电路朋克。"
          : done
            ? `钱包里 ${count.toString()} 张。${selling}`
            : `持有 ${count.toString()} 张，正在核对编号 ${ids.length}/${count.toString()}。${selling}`;
      }
      if (idsBox) {
        idsBox.replaceChildren();
        for (const id of held) {
          const chip = document.createElement("span");
          chip.textContent = mineListings.includes(id) ? `#${id} 挂单中` : `#${id}`;
          idsBox.append(chip);
        }
      }
      const cards = (target: Element | null) => {
        if (!target) return;
        target.replaceChildren();
        for (const id of held) {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "hold-card";
          const img = document.createElement("img");
          img.alt = `电路朋克 ${id}`;
          img.src = `/api/circuit-punk/${id}.png`;
          const title = document.createElement("b");
          const info = punkSheet(id);
          title.textContent = `#${id} · ${info.tier}`;
          const meta = document.createElement("small");
          meta.textContent = mineListings.includes(id)
            ? "挂单中"
            : `${info.traits[0].value} · 第 ${info.rank} 稀有 · ${info.rarest.value}`;
          card.append(img, title, meta);
          card.addEventListener("click", () => {
            const input = host.querySelector<HTMLInputElement>("#cp-list-id");
            if (input) input.value = String(id);
            openPage("trade");
            void openCard(id);
          }, { signal });
          target.append(card);
        }
      };
      cards(box);
      cards(owned);
      if (mine) {
        mine.replaceChildren();
        for (const id of held) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = mineListings.includes(id) ? `#${id} 挂单中` : `#${id}`;
          button.addEventListener("click", () => {
            const input = host.querySelector<HTMLInputElement>("#cp-list-id");
            if (input) input.value = String(id);
            const listMsg = host.querySelector("#cp-list-msg");
            if (listMsg) listMsg.textContent = `已填入 #${id}。填好价格再点挂出。`;
          }, { signal });
          mine.append(button);
        }
      }
      if (mineNote) mineNote.textContent = mineListings.length
        ? `挂单中 ${mineListings.map((id) => `#${id}`).join(" ")}。市场的「挂单」里能看到。`
        : held.length
          ? "点编号填进上面，再点挂出。"
          : "这个钱包还没有可挂的电路朋克。";
    };
    void readCpunkWallet(address as `0x${string}`, (ids, count) => draw(ids, count, ids.length >= Number(count)))
      .then((row) => {
        const tapeNode = host.querySelector("#cp-bal-tape");
        const bemNode = host.querySelector("#cp-bal-bem");
        const okbNode = host.querySelector("#cp-bal-okb");
        const punkNode = host.querySelector("#cp-bal-punk");
        if (tapeNode) tapeNode.textContent = unitText(row.tape, 8);
        if (bemNode) bemNode.textContent = unitText(row.bem, 8);
        if (okbNode) okbNode.textContent = unitText(row.okb, 18);
        if (punkNode) punkNode.textContent = row.count.toString();
        draw(row.ids, row.count, true);
      })
      .catch(() => {
        if (note) note.textContent = "电路朋克这次没读到，没有写成 0。";
      });
  };

  const cancelListing = async (id: number) => {
    const from = await connectXLayer();
    await send(from, CPUNK, encodeFunctionData({ abi, functionName: "cancel", args: [BigInt(id)] }));
    await refresh();
  };

  const paintMyLists = () => {
    const box = host.querySelector("#cp-my-lists");
    const note = host.querySelector("#cp-my-note");
    if (!box) return;
    const me = currentAccount()?.toLowerCase() ?? "";
    const mine = [...listed.entries()].filter((row) => me && row[1].seller.toLowerCase() === me);
    if (note) {
      note.textContent = !me
        ? "先连接钱包，这里显示你的挂单。"
        : mine.length
          ? `你挂着 ${mine.length} 张。点撤单即可取消。`
          : "你还没有挂单。";
    }
    box.replaceChildren();
    for (const [id, row] of mine) {
      const line = document.createElement("div");
      line.className = "my-list";
      const img = document.createElement("img");
      img.alt = "";
      img.src = `/api/circuit-punk/${id}.png`;
      const label = document.createElement("b");
      label.innerHTML = `#${id}<small>${bemText(row.quote)} BEM + ${bemText(row.quote * 1000n)} TAPE</small>`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "buy ghost";
      button.textContent = "撤单";
      button.addEventListener("click", () => void cancelListing(id).catch((error) => {
        if (note) note.textContent = deskError(error);
      }), { signal });
      line.append(img, label, button);
      box.append(line);
    }
  };

  const paint = () => {
    paintMyLists();
    const left = Math.max(0, supply - reserve - minted);
    const next = reserve + minted + 1;
    const stats = host.querySelector("#cp-stats");
    if (stats) {
      stats.replaceChildren();
      for (const [label, value] of [
        ["状态", closed ? "已收盘" : "正在铸造"],
        ["已公开铸出", String(minted)],
        ["还剩", String(left)],
        ["挂单", String(listed.size)],
      ] as const) {
        const card = document.createElement("div");
        card.className = "stat";
        const span = document.createElement("span");
        const bold = document.createElement("b");
        span.textContent = label;
        bold.textContent = value;
        card.append(span, bold);
        stats.append(card);
      }
    }
    const grid = host.querySelector("#cp-grid");
    if (!grid) return;
    const catalog = filterPunks(filters, undefined, sortMode);
    const forSale = filterPunks(filters, [...listed.keys()], sortMode);
    const rest = listsOnly ? [] : catalog.filter((id) => !listed.has(id));
    const matched = listsOnly ? forSale : [...forSale, ...rest];
    const pages = Math.max(1, Math.ceil(matched.length / 24));
    if (filterPage >= pages) filterPage = pages - 1;
    if (filterPage < 0) filterPage = 0;
    const ids = matched.slice(filterPage * 24, filterPage * 24 + 24);
    grid.replaceChildren();
    const view = host.querySelector("#cp-view-note");
    const pageNote = host.querySelector("#cp-art-page");
    const picked = Object.entries(filters).filter((entry) => entry[1]);
    const sortText = sortMode === "id" ? "按编号排" : sortMode === "common" ? "稀有的在后" : "稀有的在前";
    if (view) {
      view.textContent = listsOnly
        ? forSale.length
          ? `挂单 ${forSale.length} 张，排在市场最前。`
          : "还没有读到挂单。合约里托管的会补进来。"
        : `在售 ${forSale.length} 张排在最前，后面是${picked.length ? picked.map((entry) => entry[1]).join(" · ") : "全部"}，${sortText}。`;
    }
    if (pageNote) pageNote.textContent = matched.length ? `${filterPage + 1} / ${pages}` : "没有";
    if (!ids.length) {
      const empty = document.createElement("p");
      empty.className = "sub";
      empty.textContent = listsOnly ? "这个属性下还没有挂单。" : "没有符合这些属性的电路朋克。";
      grid.append(empty);
      return;
    }
    for (const id of ids) {
      const row = listed.get(id);
      const info = punkSheet(id);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "item cp-card";
      const pic = document.createElement("div");
      pic.className = "pic";
      const badge = document.createElement("span");
      badge.className = "rank-badge";
      badge.textContent = `第 ${info.rank}`;
      const img = document.createElement("img");
      img.alt = "";
      img.src = `/api/circuit-punk/${id}.png`;
      pic.append(badge, img);
      const body = document.createElement("div");
      body.className = "body";
      const name = document.createElement("div");
      name.className = "nm";
      name.textContent = `#${id} · ${info.tier}`;
      const price = document.createElement("div");
      price.className = "px";
      price.textContent = row
        ? `在售 ${bemText(row.quote)} BEM + ${bemText(row.quote * 1000n)} TAPE`
        : tradeNotes.get(id) ?? (id === next && live && !closed ? "下一张铸造" : "未挂单");
      const traits = document.createElement("dl");
      traits.className = "trait-mini";
      for (const cell of info.traits) {
        const line = document.createElement("div");
        const key = document.createElement("dt");
        key.textContent = cell.key;
        const value = document.createElement("dd");
        value.textContent = cell.value;
        const count = document.createElement("i");
        count.textContent = String(cell.n);
        value.append(count);
        line.append(key, value);
        traits.append(line);
      }
      body.append(name, price, traits);
      card.append(pic, body);
      card.addEventListener("click", () => void openCard(id), { signal });
      grid.append(card);
    }
  };

  const openCard = async (id: number) => {
    openId = id;
    const sheet = host.querySelector<HTMLElement>("#cp-sheet");
    const img = host.querySelector<HTMLImageElement>("#cp-sheet-img");
    const own = host.querySelector("#cp-sheet-own");
    const px = host.querySelector("#cp-sheet-px");
    const buy = host.querySelector<HTMLButtonElement>("#cp-buy");
    const cancel = host.querySelector<HTMLButtonElement>("#cp-cancel");
    const name = host.querySelector("#cp-sheet-name");
    if (img) img.src = `/api/circuit-punk/${id}.png`;
    if (name) name.textContent = `电路朋克 #${id}`;
    const meta = host.querySelector("#cp-sheet-meta");
    if (meta) {
      const info = punkSheet(id);
      meta.replaceChildren();
      const lead = document.createElement("p");
      lead.textContent = `稀有度 ${info.tier}，一万张里排第 ${info.rank}。最稀有的是${info.rarest.key}「${info.rarest.value}」，存世 ${info.rarest.n} 张，占 ${(info.rarest.n / 100).toFixed(2)}%。`;
      const table = document.createElement("table");
      table.className = "trait-table";
      const head = document.createElement("tr");
      for (const label of ["属性", "取值", "存世", "占比"]) {
        const cell = document.createElement("th");
        cell.textContent = label;
        if (label === "存世" || label === "占比") cell.className = "right";
        head.append(cell);
      }
      table.append(head);
      for (const cell of info.traits) {
        const tr = document.createElement("tr");
        const key = document.createElement("td");
        key.textContent = cell.key;
        const value = document.createElement("td");
        value.textContent = cell.value;
        const count = document.createElement("td");
        count.className = "right";
        count.textContent = `${cell.n} / 10000`;
        const pct = document.createElement("td");
        pct.className = "right";
        pct.textContent = `${(cell.n / 100).toFixed(2)}%`;
        tr.append(key, value, count, pct);
        table.append(tr);
      }
      meta.append(lead, table);
    }
    if (sheet) sheet.hidden = false;
    let seller = "";
    let quote = 0n;
    const owner = await client.readContract({ address: CPUNK, abi, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => "");
    const listing = await client.readContract({ address: CPUNK, abi, functionName: "listings", args: [BigInt(id)] }).catch(() => null);
    if (listing && listing[0].toLowerCase() !== ZERO) {
      seller = listing[0];
      quote = listing[1];
    }
    const mark = owner ? HOLDER_LABEL[owner.toLowerCase()] : undefined;
    if (own) own.textContent = owner ? `持有 ${mark ? `${mark.name} · ` : ""}${owner}` : "这张还没铸出。";
    if (px) px.textContent = quote > 0n ? `买下付 ${bemText(quote)} BEM 和 ${bemText(quote * 1000n)} TAPE` : "没有挂单";
    const me = (currentAccount() ?? "").toLowerCase();
    if (buy) {
      buy.hidden = quote === 0n || seller.toLowerCase() === me;
      buy.textContent = quote > 0n ? `付 ${bemText(quote)} BEM + ${bemText(quote * 1000n)} TAPE` : "买下";
    }
    if (cancel) cancel.hidden = !seller || seller.toLowerCase() !== me;
  };

  const refresh = async () => {
    try {
      const [pub, res, sup, on, shut] = await Promise.all([
        client.readContract({ address: CPUNK, abi, functionName: "publicMinted" }),
        client.readContract({ address: CPUNK, abi, functionName: "reserve" }),
        client.readContract({ address: CPUNK, abi, functionName: "supply" }),
        client.readContract({ address: CPUNK, abi, functionName: "live" }),
        client.readContract({ address: CPUNK, abi, functionName: "closed" }),
      ]);
      minted = Number(pub);
      reserve = Number(res);
      supply = Number(sup);
      live = on;
      closed = shut;
      const latest = await client.getBlockNumber();
      const from = latest > 99n ? latest - 99n : 0n;
      const logs = await client.getLogs({ address: CPUNK, event: listedEvent, fromBlock: from, toBlock: latest });
      const ids = [...new Set(logs.map((log) => Number(log.args.id ?? 0n)))].filter((id) => id > 0);
      const next = new Map<number, { seller: string; quote: bigint }>();
      for (const id of ids) {
        const row = await client.readContract({ address: CPUNK, abi, functionName: "listings", args: [BigInt(id)] });
        if (row[0].toLowerCase() !== ZERO && row[1] > 0n) next.set(id, { seller: row[0], quote: row[1] });
      }
      listed = new Map([...listed, ...next]);
    } catch {
      /* keep the last grid */
    }
    paint();
  };

  host.querySelector("#cp-list")?.addEventListener("click", () => void (async () => {
    const msg = host.querySelector("#cp-list-msg");
    try {
      if (!getProvider()) {
        askWallet(true);
        if (msg) msg.textContent = "先连接钱包，再点你持有的编号。";
        return;
      }
      if (msg) msg.textContent = "正在准备挂单。";
      const id = Number(host.querySelector<HTMLInputElement>("#cp-list-id")?.value ?? "");
      const raw = bemRaw(host.querySelector<HTMLInputElement>("#cp-list-px")?.value ?? "");
      const unit = host.querySelector<HTMLButtonElement>("#cp-unit .on")?.dataset.unit;
      const quote = unit === "tape" ? raw / 1000n : raw;
      if (unit === "tape" && raw % 1000n !== 0n) throw new Error("step");
      if (!Number.isInteger(id) || id < 1 || id > supply) throw new Error("id");
      if (quote < 10_000n) throw new Error("px");
      const from = await connectXLayer();
      const owner = await client.readContract({ address: CPUNK, abi, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => "");
      if (!owner || owner.toLowerCase() !== from.toLowerCase()) throw new Error("owner");
      if (msg) msg.textContent = "等钱包确认这笔挂单。";
      await send(from, CPUNK, encodeFunctionData({ abi, functionName: "list", args: [BigInt(id), quote] }));
      if (msg) msg.textContent = `#${id} 已挂出。在「挂单」里，排在市场最前。`;
      listed.set(id, { seller: from, quote });
      tradeNotes.set(id, `挂出 ${bemText(quote)} BEM + ${bemText(quote * 1000n)} TAPE`);
      listsOnly = true;
      filterPage = 0;
      host.querySelector("#cp-tab-lists")?.classList.add("on");
      host.querySelector("#cp-tab-items")?.classList.remove("on");
      paint();
      paintAssets(from);
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (msg) msg.textContent = text === "id" ? "先点你持有的编号。" : text === "owner" ? "这张不在当前钱包里。" : text === "px" || text === "step" ? "价格至少 0.0001 BEM，或 0.1 TAPE。" : deskError(error);
    }
  })(), { signal });

  host.querySelector("#cp-buy")?.addEventListener("click", () => void (async () => {
    const msg = host.querySelector("#cp-sheet-msg");
    if (!openId) return;
    try {
      const from = await connectXLayer();
      const listing = await client.readContract({ address: CPUNK, abi, functionName: "listings", args: [BigInt(openId)] });
      if (msg) msg.textContent = "先批准 BEM 和 TAPE，再买。";
      await allow(from, TAPE_BEM, listing[1]);
      await allow(from, TAPE_TOKEN, listing[1] * 1000n);
      await send(from, CPUNK, encodeFunctionData({ abi, functionName: "buy", args: [BigInt(openId)] }));
      showMintWin(host, `恭喜，电路朋克 #${openId} 属于你了。`);
      paintAssets(from);
      await refresh();
    } catch (error) {
      if (msg) msg.textContent = deskError(error);
    }
  })(), { signal });
  host.querySelector("#cp-cancel")?.addEventListener("click", () => void (async () => {
    const msg = host.querySelector("#cp-sheet-msg");
    try {
      await cancelListing(openId);
      if (msg) msg.textContent = "已经撤单。";
    } catch (error) {
      if (msg) msg.textContent = deskError(error);
    }
  })(), { signal });
  host.querySelector("#cp-sheet")?.addEventListener("click", (event) => {
    const sheet = event.currentTarget as HTMLElement;
    if (event.target === sheet) sheet.hidden = true;
  }, { signal });
  host.querySelector("#cp-close")?.addEventListener("click", () => {
    const sheet = host.querySelector<HTMLElement>("#cp-sheet");
    if (sheet) sheet.hidden = true;
  }, { signal });

  host.querySelector("#cp-unit")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button) return;
    host.querySelectorAll("#cp-unit button").forEach((node) => node.classList.remove("on"));
    button.classList.add("on");
    const input = host.querySelector<HTMLInputElement>("#cp-list-px");
    const label = host.querySelector("#cp-px-label");
    const pair = host.querySelector("#cp-pair");
    if (button.dataset.unit === "tape") {
      if (input && document.activeElement !== input) input.value = "2";
      if (label) label.textContent = "价格（TAPE）";
      if (pair) pair.textContent = "按 TAPE 标价。买家同时付对应的 BEM，1 BEM = 1000 TAPE。";
    } else {
      if (input && document.activeElement !== input) input.value = "0.002";
      if (label) label.textContent = "价格（BEM）";
      if (pair) pair.textContent = "按 BEM 标价。买家同时付 1000 倍 TAPE。";
    }
  }, { signal });
  host.querySelector("#cp-tab-items")?.addEventListener("click", () => {
    listsOnly = false;
    filterPage = 0;
    host.querySelector("#cp-tab-items")?.classList.add("on");
    host.querySelector("#cp-tab-lists")?.classList.remove("on");
    paint();
  }, { signal });
  host.querySelector("#cp-tab-lists")?.addEventListener("click", () => {
    listsOnly = true;
    filterPage = 0;
    host.querySelector("#cp-tab-lists")?.classList.add("on");
    host.querySelector("#cp-tab-items")?.classList.remove("on");
    paint();
  }, { signal });
  host.querySelector("#cp-sort")?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    const mode = button?.dataset.sort;
    if (!button || (mode !== "rare" && mode !== "common" && mode !== "id")) return;
    sortMode = mode;
    host.querySelectorAll("#cp-sort button").forEach((node) => node.classList.remove("on"));
    button.classList.add("on");
    filterPage = 0;
    paint();
  }, { signal });
  host.querySelector("#cp-art-prev")?.addEventListener("click", () => {
    filterPage -= 1;
    paint();
  }, { signal });
  host.querySelector("#cp-art-next")?.addEventListener("click", () => {
    filterPage += 1;
    paint();
  }, { signal });
  const filterBox = host.querySelector("#cp-filters");
  if (filterBox && !filterBox.childElementCount) {
    for (const facet of traitFacets()) {
      const row = document.createElement("div");
      row.className = "facet";
      const title = document.createElement("b");
      title.textContent = facet.key;
      row.append(title);
      const all = document.createElement("button");
      all.type = "button";
      all.className = "chip on";
      all.dataset.key = facet.key;
      all.dataset.value = "";
      all.textContent = "全部";
      row.append(all);
      for (const option of facet.options) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chip";
        button.dataset.key = facet.key;
        button.dataset.value = option.value;
        button.textContent = `${option.value} ${option.n}`;
        row.append(button);
      }
      filterBox.append(row);
    }
    filterBox.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest("button");
      if (!button || !filterBox.contains(button)) return;
      const key = button.dataset.key as TraitKey | undefined;
      if (!key) return;
      filters[key] = button.dataset.value || undefined;
      button.parentElement?.querySelectorAll("button").forEach((node) => node.classList.remove("on"));
      button.classList.add("on");
      filterPage = 0;
      paint();
    }, { signal });
  }
  const openFind = () => {
    const id = Number(host.querySelector<HTMLInputElement>("#cp-find")?.value ?? "");
    if (!Number.isInteger(id) || id < 1) return;
    void openCard(id);
  };
  host.querySelector("#cp-open")?.addEventListener("click", openFind, { signal });
  host.querySelector("#cp-find")?.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") openFind();
  }, { signal });

  host.querySelector("#cp-mint")?.addEventListener("click", () => void (async () => {
    const button = host.querySelector<HTMLButtonElement>("#cp-mint");
    const msg = host.querySelector("#cp-mint-msg");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (!getProvider()) {
        askWallet(true);
        if (msg) msg.textContent = "先连接钱包。";
        return;
      }
      const qty = Number(host.querySelector<HTMLInputElement>("#cp-qty")?.value ?? "");
      if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error("qty");
      const from = await connectXLayer();
      const now = Number(await client.readContract({ address: CPUNK, abi, functionName: "publicMinted" }));
      const start = BigInt(reserve) + BigInt(now) + 1n;
      const traits = Array.from({ length: qty }, (_, index) => toHex(start + BigInt(index), { size: 32 }));
      await allow(from, TAPE_TOKEN, BigInt(qty) * 100_000_000n);
      await allow(from, TAPE_BEM, BigInt(qty) * 100_000n);
      await send(from, CPUNK, encodeFunctionData({ abi, functionName: "mint", args: [BigInt(qty), traits] }));
      showMintWin(host, `恭喜，电路朋克 #${start} 属于你了。`);
      paintAssets(from);
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (msg) msg.textContent = text === "qty" ? "数量要是 1 到 10 的整数。" : deskError(error);
    } finally {
      button.disabled = false;
    }
  })(), { signal });

  const logAbi = parseAbi([
    "event Minted(address indexed to, uint256 indexed id)",
    "event Listed(uint256 indexed id, address indexed seller, uint256 quote)",
    "event Bought(uint256 indexed id, address indexed buyer, uint256 quote)",
    "event Cancelled(uint256 indexed id)",
  ]);
  type FeedRow = { line: string; tx: string };
  const born = 73628100n;
  let cursor = 0n;
  let feedReady = false;
  const feedRows: FeedRow[] = [];
  const paintFeed = () => {
    host.querySelectorAll(".cp-log").forEach((box) => {
      box.replaceChildren();
      const items = [...feedRows].reverse().slice(0, 40);
      if (!items.length) {
        const row = document.createElement("div");
        row.className = "feed-row";
        row.textContent = cursor <= born ? "正在读链上的真实挂单和成交。" : "这段还没有挂单或成交。";
        box.append(row);
        return;
      }
      for (const item of items) {
        const row = document.createElement("a");
        row.className = "feed-row";
        row.href = item.tx ? `https://www.oklink.com/x-layer/tx/${item.tx}` : "#";
        row.target = "_blank";
        row.rel = "noopener";
        row.textContent = item.line;
        box.append(row);
      }
    });
  };
  let scanning = false;
  const scanFeed = async () => {
    if (scanning || signal.aborted) return;
    scanning = true;
    try {
      const latest = await client.getBlockNumber();
      if (!feedReady) {
        cursor = latest > 900n ? latest - 900n : born;
        feedReady = true;
      }
      for (let step = 0; step < 4 && cursor <= latest; step += 1) {
        const end = cursor + 99n > latest ? latest : cursor + 99n;
        const logs = await client.getLogs({ address: CPUNK, fromBlock: cursor, toBlock: end });
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({ abi: logAbi, data: log.data, topics: log.topics });
            const tx = log.transactionHash ?? "";
            if (decoded.eventName === "Listed") {
              listed.set(Number(decoded.args.id), { seller: decoded.args.seller, quote: decoded.args.quote });
              tradeNotes.set(Number(decoded.args.id), `挂出 ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE`);
              feedRows.push({ tx, line: `挂出 #${decoded.args.id} · ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE · ${cut(decoded.args.seller)}` });
            } else if (decoded.eventName === "Bought") {
              listed.delete(Number(decoded.args.id));
              tradeNotes.set(Number(decoded.args.id), `成交 ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE`);
              feedRows.push({ tx, line: `买下 #${decoded.args.id} · ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE · ${cut(decoded.args.buyer)}` });
            } else if (decoded.eventName === "Cancelled") {
              listed.delete(Number(decoded.args.id));
              feedRows.push({ tx, line: `撤单 #${decoded.args.id}` });
            } else if (decoded.eventName === "Minted") {
              feedRows.push({ tx, line: `铸造 #${decoded.args.id} → ${cut(decoded.args.to)}` });
            }
          } catch {
            /* other events */
          }
        }
        cursor = end + 1n;
      }
      if (feedRows.length > 120) feedRows.splice(0, feedRows.length - 120);
      paintFeed();
      paint();
    } catch {
      paintFeed();
    } finally {
      scanning = false;
    }
  };
  paintFeed();
  void scanFeed();
  const feedTimer = window.setInterval(() => void scanFeed(), 1600);

  void scanHolders();
  void refresh();
  paintAssets(currentAccount());
  const stopWallet = onAccount((address) => paintAssets(address));
  const stopLang = onLang(() => {
    paint();
    paintFeed();
    paintHolders();
    paintAssets(currentAccount());
  });
  const timer = window.setInterval(() => void refresh(), 25_000);
  return () => {
    window.clearInterval(timer);
    window.clearInterval(feedTimer);
    stopWallet();
    stopLang();
  };
}
