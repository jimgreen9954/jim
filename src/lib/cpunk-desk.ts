import { decodeEventLog, decodeFunctionResult, encodeFunctionData, parseAbi, parseAbiItem, toHex } from "viem";
import { deskError } from "@/lib/asset-desk";
import { showMintWin } from "@/lib/mint-win";
import { TAPE_BEM, TAPE_TOKEN } from "@/lib/tape-pool";
import { currentAccount, getProvider, onAccount } from "@/lib/wallet";
import { filterPunks, punkSheet, traitFacets, type PunkSort, type TraitKey } from "@/lib/circuit-punk";
import { DESK_LABEL, bestHeld, forge } from "@/lib/punk-card";
import { onLang } from "@/lib/locale";
import { connectXLayer, xClient } from "@/lib/xlayer";

const CPUNK = "0xB5ac1dddc158a639D4499aad2d8F393989D4bD34" as const;
const ZERO = "0x0000000000000000000000000000000000000000";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;
const FOUNDER = "0x571d447f4f24688ec35ccf07f1d6993655f6af15";
const MARTIAN = "0xddb587d88c0afa42317e033bdd11edc2462b873f";
const OFFICIAL = "0x2d44129d8ddb14ce5ac5ceebafa572eddd964c18";
const BITMAP = "0x8ec346d8a7156776adfacba5dddb2ff9b308cb50";
const YANG = "0xa11e739adf417ffe34e1eba75df2031499192b66";
const LOYAL = "0x2b067593b4f9b0d26564c83f20e91b5d0e286dc6";
const FOUNDATION = "0x04b649076a11819ef7ada36e02dd55e0923550ee";
const XING = "0x876c3500883c072d6ea447e6e7c8f097aa7c7bc0";
const RUHUA = "0x75c186ede5d0691d66bc932fd04f8e149d1f5fa5";
const SUSSI = "0xb8bd12503918476a2785cf1617a0faf13aad771c";
const ZHOU = "0x94e8c5822ff10be48713adae49af7acdb390eeb4";
const YASI = "0x072925b5375063a3c6adc37d4611ff6ce5558f10";
const CHENG = "0xdc352a37a53f5d45a9a6fb44d8076a475884ba91";
const EASON = "0x1aeb3c9ec1efa74ad7a543dbd02769c18cd50119";
const YW = "0x42445b49e961de2c071ea20f73db769987303d64";
const CHICKEN = "0x98ce75463917e5fd1470675c6f133a38f7167712";
const XIAO = "0x4569f6d72aa0cd0b7c3434eac2a00cbfa261c7e4";
const HOLDER_LABEL: Record<string, { name: string; tag: string }> = {
  [FOUNDER]: { name: "TapeOut 协议创始人", tag: "founder" },
  [MARTIAN]: { name: "火星人", tag: "mars" },
  [OFFICIAL]: { name: "TAPE NFT 官方", tag: "official" },
  [BITMAP]: { name: "93.bitmap", tag: "bitmap" },
  [YANG]: { name: "0x杨杨｜tapeout", tag: "yang" },
  [LOYAL]: { name: "LOYAL路遥", tag: "loyal" },
  [FOUNDATION]: { name: "基金会TapeOutCF", tag: "foundation" },
  [XING]: { name: "星帅", tag: "xing" },
  [RUHUA]: { name: "茹花小姐", tag: "ruhua" },
  [SUSSI]: { name: "Sussiie", tag: "sussiie" },
  [ZHOU]: { name: "周红衣", tag: "zhou" },
  [YASI]: { name: "Yasimin雅思敏", tag: "yasi" },
  [CHENG]: { name: "橙子", tag: "cheng" },
  [EASON]: { name: "OnlyEason | TapeOut", tag: "eason" },
  [YW]: { name: "ywweb3", tag: "yw" },
  [CHICKEN]: { name: "Ch!cken(TapeOut薄🐔版)", tag: "chicken" },
  [XIAO]: { name: "肖战羊", tag: "xiao" },
};
const HOLDER_RANK = [FOUNDER, MARTIAN, OFFICIAL, BITMAP, YANG, LOYAL, FOUNDATION, XING, RUHUA, SUSSI, ZHOU, YASI, CHENG, EASON, YW, CHICKEN, XIAO];
const GRANTS: { address: string; ids: number[] }[] = [
  { address: BITMAP, ids: Array.from({ length: 10 }, (_, index) => 370 + index) },
  { address: YANG, ids: Array.from({ length: 10 }, (_, index) => 380 + index) },
  { address: LOYAL, ids: Array.from({ length: 10 }, (_, index) => 390 + index) },
  { address: FOUNDATION, ids: Array.from({ length: 10 }, (_, index) => 400 + index) },
  { address: XING, ids: Array.from({ length: 10 }, (_, index) => 410 + index) },
  { address: RUHUA, ids: Array.from({ length: 10 }, (_, index) => 420 + index) },
  { address: SUSSI, ids: Array.from({ length: 10 }, (_, index) => 430 + index) },
  { address: ZHOU, ids: Array.from({ length: 10 }, (_, index) => 440 + index) },
  { address: YASI, ids: Array.from({ length: 10 }, (_, index) => 450 + index) },
  { address: CHENG, ids: Array.from({ length: 10 }, (_, index) => 460 + index) },
  { address: EASON, ids: Array.from({ length: 10 }, (_, index) => 470 + index) },
  { address: YW, ids: Array.from({ length: 10 }, (_, index) => 480 + index) },
  { address: CHICKEN, ids: Array.from({ length: 10 }, (_, index) => 490 + index) },
  { address: XIAO, ids: Array.from({ length: 10 }, (_, index) => 500 + index) },
];
const client = xClient;
const coinAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ownerAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function publicMinted() view returns (uint32)",
  "function reserve() view returns (uint32)",
  "function listings(uint256) view returns (address seller, uint256 quote, uint64 at)",
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

function holderRole(ids: number[], reserve: number): { name: string; tag: string } {
  let circuit = 0;
  let tape = 0;
  let pub = 0;
  for (const id of ids) {
    if (id >= 151 && id <= 369) circuit += 1;
    else if (id >= 1000 && id <= 6019) tape += 1;
    else if (id > reserve) pub += 1;
  }
  if (tape >= circuit && tape >= pub && tape > 0) return { name: "TapeCode", tag: "role" };
  if (circuit >= pub && circuit > 0) return { name: "电路持有", tag: "role" };
  if (pub > 0) return { name: "公开铸造", tag: "role" };
  if (ids.some((id) => (id >= 370 && id <= 999) || (id >= 6020 && id <= 7000))) return { name: "预留持有", tag: "role" };
  return { name: "链上持有", tag: "role" };
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

async function readListings(ids: number[]): Promise<(readonly [string, bigint, bigint] | null)[]> {
  if (!ids.length) return [];
  const calls = ids.map((id) => ({
    target: CPUNK,
    callData: encodeFunctionData({ abi: ownerAbi, functionName: "listings", args: [BigInt(id)] }),
  }));
  const data = encodeFunctionData({ abi: tryAbi, functionName: "tryAggregate", args: [false, calls] });
  const raw = await client.call({ to: MULTICALL, data });
  const decoded = decodeFunctionResult({ abi: tryAbi, functionName: "tryAggregate", data: raw.data ?? "0x" });
  return decoded.map((row) => {
    if (!row.success || row.returnData === "0x") return null;
    const [seller, quote, at] = decodeFunctionResult({
      abi: ownerAbi,
      functionName: "listings",
      data: row.returnData,
    });
    return [seller, quote, at] as const;
  });
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

type CpunkAct = { kind: "挂单" | "成交"; id: number; px: string; who: string; tx: string };
const cpunkActs: CpunkAct[] = [];
export function cpunkActivity(): CpunkAct[] {
  return cpunkActs.slice();
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
      const seen = new Set<number>();
      const bands: number[] = [];
      const push = (id: number) => {
        if (id < 1 || seen.has(id)) return;
        seen.add(id);
        bands.push(id);
      };
      const range = (from: number, to: number) => {
        for (let id = from; id <= to; id += 1) push(id);
      };
      const pubStart = Number(reserve) + 1;
      range(pubStart, pubStart + Number(pub) - 1);
      range(1, Math.min(999, Number(reserve)));
      range(6020, Number(reserve));
      range(1000, 6019);
      const take = async (slice: number[]) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            return await ownersOf(slice);
          } catch {
            await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
        return slice.map(() => null);
      };
      for (let index = 0; index < bands.length && ids.length < want; index += 400) {
        const wave = [0, 1, 2, 3, 4].map((slot) => bands.slice(index + slot * 80, index + (slot + 1) * 80)).filter((slice) => slice.length);
        const rows = await Promise.all(wave.map((slice) => take(slice)));
        rows.forEach((owners, slot) => {
          owners.forEach((owner, place) => {
            if (owner === key) ids.push(wave[slot][place]);
          });
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
  let heldForForge: number[] = [];
  const abi = parseAbi([
    "function publicMinted() view returns (uint32)",
    "function supply() view returns (uint32)",
    "function reserve() view returns (uint32)",
    "function live() view returns (bool)",
    "function closed() view returns (bool)",
    "function ownerOf(uint256) view returns (address)",
    "function listings(uint256) view returns (address seller, uint256 quote, uint64 at)",
    "function mint(uint256 qty, bytes32[] traits)",
    "function mintedBy(address) view returns (uint32)",
    "function list(uint256 id, uint256 quote)",
    "function buy(uint256 id)",
    "function cancel(uint256 id)",
    "function claimReserve(uint256 id, bytes32 trait)",
    "function transferFrom(address from, address to, uint256 id)",
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ]);
  const listedEvent = parseAbiItem("event Listed(uint256 indexed id, address indexed seller, uint256 quote)");
  let listed = new Map<number, { seller: string; quote: bigint }>();
  const tradeNotes = new Map<number, string>();
  let minted = 0;
  let walletMints: number | null = null;
  let reserve = 7000;
  let supply = 10000;
  let live = true;
  let closed = false;
  let listsOnly = true;
  let openId = 0;
  let filterPage = 0;
  let pageSize = 24;
  let sortMode: PunkSort | "high" | "low" = "low";
  let marketReady = true;
  let syncActs = () => {};
  const filters: Partial<Record<TraitKey, string>> = {};
  const cut = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

  const waitReceipt = async (hash: string) => {
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
      try {
        const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
        if (receipt.status === "success") return "ok";
        if (receipt.status === "reverted") return "fail";
      } catch {
        /* still pending, or the node has not seen it yet */
      }
    }
    return "sent";
  };
  const send = async (from: string, to: string, data: string) => {
    const eth = getProvider();
    if (!eth) throw new Error("nowallet");
    const tx: Record<string, string> = { from, to, data, value: "0x0", chainId: "0xc4" };
    try {
      const estimated = await eth.request({ method: "eth_estimateGas", params: [tx] });
      tx.gas = `0x${((BigInt(String(estimated)) * 12n) / 10n + 50_000n).toString(16)}`;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error ?? "");
      if (/owner|seller|quote|pull|exact|list|allowance|insufficient|trait|reserve|move|auth/i.test(reason)) throw error;
      tx.gas = "0x2dc6c0";
    }
    let sent: unknown;
    try {
      sent = await eth.request({ method: "eth_sendTransaction", params: [tx] });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error ?? "");
      if (/gas|intrinsic/i.test(reason)) {
        delete tx.gas;
        sent = await eth.request({ method: "eth_sendTransaction", params: [tx] });
      } else {
        throw error;
      }
    }
    const hash = typeof sent === "string" ? sent : String((sent as { hash?: string } | null)?.hash ?? "");
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("nowallet");
    const mined = await waitReceipt(hash);
    if (mined === "fail") throw new Error("revert");
    if (mined === "sent") throw new Error("pending");
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
      note.textContent = holderSeen < holderTotal
        ? "正在读取链上持有人。"
        : `共 ${holderRows.length} 个持有地址。`;
    }
    if (!body) return;
    const me = (currentAccount() ?? "").toLowerCase();
    const bags = new Map<string, number[]>();
    for (const row of holderRows) bags.set(row.address, [...row.ids]);
    const ownedBy = new Map<number, string>();
    for (const [addr, ids] of bags) for (const id of ids) ownedBy.set(id, addr);
    const pinned = [
      { address: FOUNDER, ids: Array.from({ length: 50 }, (_, index) => index + 1) },
      { address: MARTIAN, ids: Array.from({ length: 100 }, (_, index) => index + 51) },
      ...GRANTS,
    ];
    for (const grant of pinned) {
      const mine = new Set(bags.get(grant.address) ?? []);
      for (const id of grant.ids) {
        const holder = ownedBy.get(id);
        if (holder && holder !== grant.address) {
          mine.delete(id);
          continue;
        }
        if (!holder) continue;
        mine.add(id);
      }
      if (mine.size) bags.set(grant.address, [...mine].sort((a, b) => a - b));
    }
    const pool = [...bags.entries()]
      .map(([address, ids]) => ({ address, ids }))
      .filter((row) => holderSeen >= holderTotal || HOLDER_LABEL[row.address])
      .sort((a, b) => {
      const rank = (addr: string) => {
        const place = HOLDER_RANK.indexOf(addr);
        return place < 0 ? 9 : place;
      };
      return rank(a.address) - rank(b.address) || b.ids.length - a.ids.length || (a.address < b.address ? -1 : 1);
    });
    const filtered = query
      ? pool.filter((row) => row.address.includes(query) || row.ids.some((id) => String(id).includes(query)) || (HOLDER_LABEL[row.address]?.name ?? holderRole(row.ids, reserve).name).toLowerCase().includes(query))
      : pool;
    const pages = Math.max(1, Math.ceil(filtered.length / 30));
    if (holderPage >= pages) holderPage = pages - 1;
    if (holderPage < 0) holderPage = 0;
    if (pageNote) pageNote.textContent = filtered.length ? `${holderPage + 1} / ${pages}` : "没有";
    body.replaceChildren();
    for (const row of filtered.slice(holderPage * 30, holderPage * 30 + 30)) {
      const tr = document.createElement("tr");
      const label = document.createElement("td");
      const mark = HOLDER_LABEL[row.address] ?? holderRole(row.ids, reserve);
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
      for (let index = 0; index < publicIds.length; index += 80) {
        if (signal.aborted) return;
        const slice = publicIds.slice(index, index + 80);
        const rows = await readListings(slice).catch(() => []);
        slice.forEach((id, place) => {
          const row = rows[place];
          if (row && row[0].toLowerCase() !== ZERO && row[1] > 0n) listed.set(id, { seller: row[0], quote: row[1] });
        });
      }
      if (listed.size) paint();
      const reserveIds = Array.from({ length: Number(heldReserve) }, (_, index) => index + 1);
      const ids = [...reserveIds.filter((id) => id <= 150), ...publicIds, ...reserveIds.filter((id) => id > 150)];
      const bags = new Map<string, number[]>();
      let seen = 0;
      if (note) note.textContent = "正在读取链上持有人。";
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
            const rank = (addr: string) => {
              const place = HOLDER_RANK.indexOf(addr);
              return place < 0 ? 9 : place;
            };
            return rank(a.address) - rank(b.address) || b.ids.length - a.ids.length || (a.address < b.address ? -1 : 1);
          });
        paintHolders();
        paint();
        await new Promise((resolve) => window.setTimeout(resolve, 400));
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
      host.querySelector("#cp-forge-picks")?.replaceChildren();
      host.querySelector("#cp-forge-owned")?.replaceChildren();
      const mineNote = host.querySelector("#cp-forge-mine");
      const bestNote = host.querySelector("#cp-forge-best");
      if (mineNote) mineNote.textContent = "连接钱包后，这里列出你持有的卡。";
      if (bestNote) bestNote.textContent = "连接钱包后，点上面的「用我持有的合成」。";
      heldForForge = [];
      return;
    }
    if (countNode) countNode.textContent = "…";
    const draw = (ids: number[], count: bigint, done: boolean) => {
      if (signal.aborted || currentAccount()?.toLowerCase() !== address.toLowerCase()) return;
      if (countNode) countNode.textContent = count.toString();
      const mineListings = [...listed.entries()]
        .filter((row) => row[1].seller.toLowerCase() === address.toLowerCase())
        .map((row) => row[0]);
      const shown = count;
      const held = [...new Set([...ids, ...mineListings])].sort((a, b) => a - b);
      if (countNode) countNode.textContent = shown.toString();
      if (note) {
        const selling = mineListings.length ? `另有 ${mineListings.length} 张挂单中。` : "";
        note.textContent = shown === 0n
          ? "这个地址还没有 Circuit Punk。"
          : !done && ids.length < Number(count)
            ? `链上有 ${count.toString()} 张，正在读取编号。读到之前也可以把编号填进上面再点挂出。${selling}`
            : done
              ? `钱包里 ${shown.toString()} 张。点编号就能挂出。${selling}`
              : `持有 ${shown.toString()} 张，正在核对编号 ${ids.length}/${count.toString()}。${selling}`;
      }
      if (idsBox) {
        idsBox.replaceChildren();
        for (const id of held) {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.textContent = mineListings.includes(id) ? `#${id} 挂单中` : `#${id}`;
          chip.addEventListener("click", () => {
            host.querySelectorAll("#xfer-coin .fbtn").forEach((node) => node.classList.toggle("on", (node as HTMLElement).dataset.coin === "punk"));
            const amt = host.querySelector<HTMLInputElement>("#xfer-amt");
            const label = host.querySelector("#xfer-amt-label");
            const msg = host.querySelector("#xfer-msg");
            if (label) label.textContent = "编号";
            if (amt) amt.value = String(id);
            if (msg) msg.textContent = mineListings.includes(id) ? "这张挂单中，先撤单才能转。" : `已填入 #${id}。填接收地址后点签名转出。`;
            host.querySelector("#xfer")?.scrollIntoView({ block: "nearest" });
          }, { signal });
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
          img.alt = `Circuit Punk ${id}`;
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
          ? "点编号填进上面，再点挂出。链上持有人都可以挂。"
          : count > 0n
            ? "链上有藏品，编号还在读。也可以直接把编号填进上面再点挂出。"
            : "这个钱包还没有可挂的 Circuit Punk。";
      const forgePicks = host.querySelector("#cp-forge-picks");
      const forgeOwned = host.querySelector("#cp-forge-owned");
      const forgeMine = host.querySelector("#cp-forge-mine");
      const chosen = new Set((host.querySelector<HTMLInputElement>("#cp-forge-ids")?.value ?? "").split(/[^\d]+/).filter(Boolean).map(Number));
      const toggleForge = (id: number) => {
        const input = host.querySelector<HTMLInputElement>("#cp-forge-ids");
        const current = (input?.value ?? "").split(/[^\d]+/).filter(Boolean).map(Number);
        const next = current.includes(id) ? current.filter((n) => n !== id) : [...current, id];
        if (input) input.value = next.join(" ");
        paintForge();
      };
      if (forgeMine) {
        forgeMine.textContent = held.length
          ? `你有 ${held.length} 张。点一张加入材料，再点一次拿下。${held.length > 80 ? "先显示 80 张，其余直接输入编号。" : ""}`
          : count > 0n
            ? "编号还在读。也可以直接把编号填进下面。"
            : "这个钱包还没有 Circuit Punk。编号仍可以自己输入。";
      }
      const shownHeld = held.slice(0, 80);
      if (forgePicks) {
        forgePicks.replaceChildren();
        for (const id of shownHeld) {
          const button = document.createElement("button");
          button.type = "button";
          button.dataset.id = String(id);
          button.textContent = `#${id}`;
          if (chosen.has(id)) button.classList.add("on");
          button.addEventListener("click", () => toggleForge(id), { signal });
          forgePicks.append(button);
        }
      }
      if (forgeOwned) {
        forgeOwned.replaceChildren();
        for (const id of shownHeld) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = chosen.has(id) ? "forge-tile on" : "forge-tile";
          button.dataset.id = String(id);
          const img = document.createElement("img");
          img.alt = `Circuit Punk ${id}`;
          img.src = `/api/circuit-punk/${id}.png`;
          const title = document.createElement("b");
          const info = punkSheet(id);
          title.textContent = `#${id}`;
          const meta = document.createElement("small");
          meta.textContent = `${info.tier} · ${info.traits[0]?.value ?? ""}`;
          button.append(img, title, meta);
          button.addEventListener("click", () => toggleForge(id), { signal });
          forgeOwned.append(button);
        }
      }
      paintHeld(held);
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
        if (note) note.textContent = "Circuit Punk 这次没读到，没有写成 0。";
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
    const ended = closed || left === 0;
    const next = reserve + minted + 1;
    const leftNote = host.querySelector("#cp-left");
    if (leftNote) {
      const times = walletMints == null ? "连上钱包后显示还能铸几次。" : `这个钱包已铸 ${walletMints} 次，还能 ${Math.max(0, 10 - walletMints)} 次。`;
      leftNote.textContent = ended
        ? "火热交易中。公开额度已经铸满，到市场按价格挂单、买下。"
        : !live
          ? "铸造还没打开。"
          : `一次一张。每次 1 TAPE + 0.001 BEM。下一张是 #${next > supply ? "—" : next}。一个钱包最多十次。${times}`;
    }
    const stats = host.querySelector("#cp-stats");
    if (stats) {
      stats.replaceChildren();
      for (const [label, value] of [
        ["状态", ended ? "火热交易中" : "正在铸造"],
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
    host.querySelectorAll(".minting").forEach((node) => {
      node.textContent = "火热交易中";
    });
    const kick = host.querySelector("#page-mint .cp-kicker");
    if (kick) kick.textContent = "火热交易中";
    const mintButton = host.querySelector<HTMLButtonElement>("#cp-mint");
    if (mintButton) {
      mintButton.textContent = ended ? "去交易" : "铸造这一张";
      mintButton.disabled = false;
    }
    const marketKick = host.querySelector("#page-trade .cp-kicker");
    if (marketKick) marketKick.textContent = "火热交易中";
    const hero = host.querySelector("#cp-hero-metrics");
    if (hero) {
      const quotes = [...listed.values()].map((row) => row.quote).filter((quote) => quote > 0n).sort((a, b) => (a < b ? -1 : 1));
      const floor = quotes[0];
      const high = quotes[quotes.length - 1];
      const cells = [
        [floor ? `${bemText(floor)} BEM` : "—", "地板价"],
        [high ? `${bemText(high)} BEM` : "—", "最高价"],
        [String(listed.size), "在售"],
        ["10,000", "总量"],
        ["火热交易中", "状态"],
      ];
      hero.replaceChildren();
      for (const [value, label] of cells) {
        const box = document.createElement("div");
        const strong = document.createElement("b");
        strong.textContent = value;
        const span = document.createElement("span");
        span.textContent = label;
        box.append(strong, span);
        hero.append(box);
      }
    }
    syncActs();
    const grid = host.querySelector("#cp-grid");
    if (!grid) return;
    const traitSort: PunkSort = sortMode === "high" || sortMode === "low" ? "rare" : sortMode;
    const byPrice = (ids: number[]) => [...ids].sort((a, b) => {
      const left = listed.get(a)?.quote ?? 0n;
      const right = listed.get(b)?.quote ?? 0n;
      if (left === right) return a - b;
      const higher = left > right ? -1 : 1;
      return sortMode === "low" ? -higher : higher;
    });
    const catalog = filterPunks(filters, undefined, traitSort);
    const priced = byPrice(filterPunks(filters, [...listed.keys()], traitSort));
    const forSale = sortMode === "high" || sortMode === "low" ? priced : filterPunks(filters, [...listed.keys()], traitSort);
    const rest = listsOnly ? [] : catalog.filter((id) => !listed.has(id));
    const matched = listsOnly ? forSale : [...forSale, ...rest];
    const pages = Math.max(1, Math.ceil(matched.length / pageSize));
    if (filterPage >= pages) filterPage = pages - 1;
    if (filterPage < 0) filterPage = 0;
    const pricePlace = new Map(forSale.map((id, index) => [id, index + 1]));
    const ids = matched.slice(filterPage * pageSize, filterPage * pageSize + pageSize);
    grid.replaceChildren();
    const view = host.querySelector("#cp-view-note");
    const pageNote = host.querySelector("#cp-art-page");
    const picked = Object.entries(filters).filter((entry) => entry[1]);
    const sortText = sortMode === "high" ? "价格从高到低" : sortMode === "low" ? "价格从低到高" : sortMode === "id" ? "按编号排" : sortMode === "common" ? "稀有的在后" : "稀有的在前";
    if (view) {
      view.textContent = sortMode === "high" || sortMode === "low"
        ? listsOnly
          ? forSale.length
            ? `挂单 ${forSale.length} 张，${sortText}。`
            : "还没有读到挂单。合约里托管的会补进来。"
          : `在售 ${forSale.length} 张按${sortText}排在前面。没挂单的在后面。`
        : listsOnly
          ? forSale.length
            ? `挂单 ${forSale.length} 张，排在市场最前。`
            : "还没有读到挂单。合约里托管的会补进来。"
          : `在售 ${forSale.length} 张排在最前，后面是${picked.length ? picked.map((entry) => entry[1]).join(" · ") : "全部"}，${sortText}。`;
    }
    if (pageNote) pageNote.textContent = matched.length ? `${filterPage + 1} / ${pages}` : "没有";
    if (!ids.length) {
      const empty = document.createElement("p");
      empty.className = "sub";
      empty.textContent = listsOnly ? "还没有挂单，所以现在买不了。钱包里有的，在左边填编号再点挂出。" : "没有符合这些属性的 Circuit Punk。";
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
        ? `${sortMode === "high" || sortMode === "low" ? `价位 ${pricePlace.get(id)} · ` : ""}在售 ${bemText(row.quote)} BEM + ${bemText(row.quote * 1000n)} TAPE`
        : tradeNotes.get(id) ?? (id === next && live && !ended ? "下一张铸造" : "未挂单");
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
    if (name) name.textContent = `Circuit Punk #${id}`;
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
    const mark = owner ? (HOLDER_LABEL[owner.toLowerCase()] ?? holderRole([id], reserve)) : undefined;
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
      const leftNow = Math.max(0, supply - reserve - minted);
      if ((shut || leftNow === 0) && !marketReady) {
        marketReady = true;
        listsOnly = true;
        sortMode = "low";
        filterPage = 0;
        host.querySelector("#cp-tab-lists")?.classList.add("on");
        host.querySelector("#cp-tab-items")?.classList.remove("on");
        host.querySelectorAll("#cp-sort button").forEach((node) => node.classList.toggle("on", (node as HTMLElement).dataset.sort === "low"));
      }
    } catch {
      /* keep the last counts */
    }
    try {
      const latest = await client.getBlockNumber();
      const from = latest > 99n ? latest - 99n : 0n;
      const logs = await client.getLogs({ address: CPUNK, event: listedEvent, fromBlock: from, toBlock: latest });
      const fresh = [...new Set(logs.map((log) => Number(log.args.id ?? 0n)))].filter((id) => id > 0);
      const known = [...new Set([...listed.keys(), ...fresh])];
      for (let index = 0; index < known.length; index += 40) {
        const slice = known.slice(index, index + 40);
        const rows = await readListings(slice);
        slice.forEach((id, place) => {
          const row = rows[place];
          if (!row) return;
          if (row[0].toLowerCase() !== ZERO && row[1] > 0n) listed.set(id, { seller: row[0], quote: row[1] });
          else listed.delete(id);
        });
      }
    } catch {
      /* listings can wait */
    }
    const who = currentAccount();
    if (who) {
      try {
        walletMints = Number(await client.readContract({
          address: CPUNK,
          abi,
          functionName: "mintedBy",
          args: [who as `0x${string}`],
        }));
      } catch {
        walletMints = null;
      }
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
      let owner = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          owner = await client.readContract({ address: CPUNK, abi, functionName: "ownerOf", args: [BigInt(id)] });
          break;
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
        }
      }
      if (owner && owner.toLowerCase() === CPUNK.toLowerCase()) throw new Error("listed");
      if (owner && owner.toLowerCase() !== from.toLowerCase()) throw new Error("owner");
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
      if (msg) msg.textContent = text === "id" ? "先填编号。钱包里的编号点一下就会填上。" : text === "listed" ? "这张已经挂着。先撤单再改价。" : text === "owner" ? "这张不在当前钱包里。换成持有它的钱包再挂。" : text === "px" || text === "step" ? "价格至少 0.0001 BEM，或 0.1 TAPE。" : deskError(error);
    }
  })(), { signal });

  host.querySelector("#cp-buy")?.addEventListener("click", () => void (async () => {
    const msg = host.querySelector("#cp-sheet-msg");
    if (!openId) return;
    try {
      const from = await connectXLayer();
      const listing = await client.readContract({ address: CPUNK, abi, functionName: "listings", args: [BigInt(openId)] });
      if (!listing[0] || listing[0].toLowerCase() === ZERO || listing[1] === 0n) throw new Error("gone");
      if (listing[0].toLowerCase() === from.toLowerCase()) throw new Error("self");
      const [bemBal, tapeBal] = await Promise.all([
        client.readContract({ address: TAPE_BEM, abi: coinAbi, functionName: "balanceOf", args: [from as `0x${string}`] }),
        client.readContract({ address: TAPE_TOKEN, abi: coinAbi, functionName: "balanceOf", args: [from as `0x${string}`] }),
      ]);
      if (bemBal < listing[1]) throw new Error("needbem");
      if (tapeBal < listing[1] * 1000n) throw new Error("needtape");
      if (msg) msg.textContent = "先批准 BEM 和 TAPE，再买。";
      await allow(from, TAPE_BEM, listing[1]);
      await allow(from, TAPE_TOKEN, listing[1] * 1000n);
      if (msg) msg.textContent = "等钱包确认这笔购买。";
      await send(from, CPUNK, encodeFunctionData({ abi, functionName: "buy", args: [BigInt(openId)] }));
      showMintWin(host, `恭喜，Circuit Punk #${openId} 属于你了。`);
      paintAssets(from);
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (msg) msg.textContent = text === "gone" ? "这张已经不在售，刷新后再看。" : text === "self" ? "这张是你自己挂的，不能买。" : text === "needbem" ? "BEM 不够付这一单。" : text === "needtape" ? "TAPE 不够付这一单。成交要按 1 BEM 再付 1000 TAPE。" : deskError(error);
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
    if (!button || (mode !== "rare" && mode !== "common" && mode !== "id" && mode !== "high" && mode !== "low")) return;
    sortMode = mode;
    host.querySelectorAll("#cp-sort button").forEach((node) => node.classList.remove("on"));
    button.classList.add("on");
    filterPage = 0;
    paint();
  }, { signal });
  host.querySelector("#cp-art-prev")?.addEventListener("click", () => {
    filterPage -= 1;
    paint();
    host.querySelector("#cp-grid")?.scrollIntoView({ block: "start" });
  }, { signal });
  host.querySelector("#cp-art-next")?.addEventListener("click", () => {
    filterPage += 1;
    paint();
    host.querySelector("#cp-grid")?.scrollIntoView({ block: "start" });
  }, { signal });
  host.querySelector("#cp-page-size")?.addEventListener("change", (event) => {
    const raw = Number((event.target as HTMLInputElement).value);
    if (!Number.isInteger(raw) || raw < 4 || raw > 96) return;
    pageSize = raw;
    filterPage = 0;
    paint();
  }, { signal });
  const filterBox = host.querySelector("#cp-filters");
  host.querySelector("#cp-filter-toggle")?.addEventListener("click", () => {
    if (!filterBox) return;
    const open = filterBox.classList.toggle("collapsed") === false;
    const button = host.querySelector("#cp-filter-toggle");
    if (button) button.textContent = open ? "收起筛选" : "筛选";
  }, { signal });
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
    if (closed || supply - reserve - minted <= 0) {
      openPage("trade");
      return;
    }
    button.disabled = true;
    try {
      if (!getProvider()) {
        askWallet(true);
        if (msg) msg.textContent = "先连接钱包。";
        return;
      }
      if (walletMints != null && walletMints >= 10) throw new Error("wallet");
      const qty = 1;
      if (msg) msg.textContent = "正在读下一张。这次付 1 TAPE 和 0.001 BEM。";
      const from = await connectXLayer();
      const open = await client.readContract({ address: CPUNK, abi, functionName: "live" });
      const shut = await client.readContract({ address: CPUNK, abi, functionName: "closed" });
      if (supply - reserve - minted <= 0 || shut) throw new Error("mintend");
      if (!open) throw new Error("mintclosed");
      const [tapeBal, bemBal, okbBal] = await Promise.all([
        client.readContract({ address: TAPE_TOKEN, abi, functionName: "balanceOf", args: [from as `0x${string}`] }),
        client.readContract({ address: TAPE_BEM, abi, functionName: "balanceOf", args: [from as `0x${string}`] }),
        client.getBalance({ address: from as `0x${string}` }),
      ]);
      if (tapeBal < 100_000_000n) throw new Error("tape");
      if (bemBal < 100_000n) throw new Error("bem");
      if (okbBal < 200_000_000_000_000n) throw new Error("gas");
      const now = Number(await client.readContract({ address: CPUNK, abi, functionName: "publicMinted" }));
      const used = Number(await client.readContract({ address: CPUNK, abi, functionName: "mintedBy", args: [from as `0x${string}`] }));
      walletMints = used;
      if (used >= 10) throw new Error("wallet");
      const start = BigInt(reserve) + BigInt(now) + 1n;
      const traits = [toHex(start, { size: 32 })];
      if (msg) msg.textContent = "先授权 1 TAPE 和 0.001 BEM。";
      await allow(from, TAPE_TOKEN, 100_000_000n);
      await allow(from, TAPE_BEM, 100_000n);
      if (msg) msg.textContent = "等钱包确认。这一张铸完，这个钱包还剩 " + String(9 - used) + " 次。";
      await send(from, CPUNK, encodeFunctionData({ abi, functionName: "mint", args: [BigInt(qty), traits] }));
      showMintWin(host, `恭喜，Circuit Punk #${start} 属于你了。`);
      paintAssets(from);
      await refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : "";
      if (msg) msg.textContent = text === "qty" ? "一次只能铸一张。" : deskError(error);
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
  type FeedRow = { kind: "挂单" | "成交" | "撤单" | "铸造"; id: number; px: string; who: string; tx: string; line: string };
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
    syncActs = () => {
      const sales = feedRows
        .filter((row): row is FeedRow & { kind: "成交" } => row.kind === "成交")
        .slice(-24)
        .reverse();
      const orders = [...listed.entries()]
        .sort((a, b) => (a[1].quote < b[1].quote ? -1 : 1))
        .slice(0, 30)
        .map(([id, row]) => ({
          kind: "挂单" as const,
          id,
          px: `${bemText(row.quote)} BEM + ${bemText(row.quote * 1000n)} TAPE`,
          who: cut(row.seller),
          tx: "",
        }));
      cpunkActs.splice(0, cpunkActs.length, ...sales, ...orders);
      window.dispatchEvent(new CustomEvent("cpunk-feed"));
    };
    syncActs();
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
      for (let step = 0; step < 1 && cursor <= latest; step += 1) {
        const end = cursor + 99n > latest ? latest : cursor + 99n;
        const logs = await client.getLogs({ address: CPUNK, fromBlock: cursor, toBlock: end });
        for (const log of logs) {
          try {
            const decoded = decodeEventLog({ abi: logAbi, data: log.data, topics: log.topics });
            const tx = log.transactionHash ?? "";
            if (decoded.eventName === "Listed") {
              listed.set(Number(decoded.args.id), { seller: decoded.args.seller, quote: decoded.args.quote });
              tradeNotes.set(Number(decoded.args.id), `挂出 ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE`);
              feedRows.push({
                kind: "挂单",
                id: Number(decoded.args.id),
                px: `${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE`,
                who: cut(decoded.args.seller),
                tx,
                line: `挂出 #${decoded.args.id} · ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE · ${cut(decoded.args.seller)}`,
              });
            } else if (decoded.eventName === "Bought") {
              listed.delete(Number(decoded.args.id));
              tradeNotes.set(Number(decoded.args.id), `成交 ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE`);
              feedRows.push({
                kind: "成交",
                id: Number(decoded.args.id),
                px: `${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE`,
                who: cut(decoded.args.buyer),
                tx,
                line: `买下 #${decoded.args.id} · ${bemText(decoded.args.quote)} BEM + ${bemText(decoded.args.quote * 1000n)} TAPE · ${cut(decoded.args.buyer)}`,
              });
            } else if (decoded.eventName === "Cancelled") {
              listed.delete(Number(decoded.args.id));
              feedRows.push({ kind: "撤单", id: Number(decoded.args.id), px: "", who: "", tx, line: `撤单 #${decoded.args.id}` });
            } else if (decoded.eventName === "Minted") {
              feedRows.push({ kind: "铸造", id: Number(decoded.args.id), px: "", who: cut(decoded.args.to), tx, line: `铸造 #${decoded.args.id} → ${cut(decoded.args.to)}` });
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
  const logToggle = host.querySelector<HTMLButtonElement>("#cp-log-toggle");
  const logBox = host.querySelector<HTMLElement>("#cp-log");
  if (window.matchMedia("(max-width: 860px)").matches && logBox) logBox.hidden = true;
  if (logToggle && logBox) {
    logToggle.textContent = logBox.hidden ? "显示" : "隐藏";
    logToggle.addEventListener("click", () => {
      logBox.hidden = !logBox.hidden;
      logToggle.textContent = logBox.hidden ? "显示" : "隐藏";
    }, { signal });
  }
  void scanFeed();
  paintHolders();
  void scanHolders();
  const tradePage = host.querySelector("#page-trade");
  const forgeInput = host.querySelector<HTMLInputElement>("#cp-forge-ids");
  const forgeOut = host.querySelector("#cp-forge-out");
  const tierRank = (tier: string) => (tier === "传说" ? 5 : tier === "史诗" ? 4 : tier === "稀有" ? 3 : tier === "少见" ? 2 : 1);
  const paintHeld = (ids: number[]) => {
    heldForForge = ids;
    const node = host.querySelector("#cp-forge-best");
    if (!node) return;
    node.replaceChildren();
    if (!ids.length) {
      node.textContent = "这个钱包还没有可以合成的卡。";
      return;
    }
    const card = bestHeld(ids);
    if (!card) {
      node.textContent = `你有 ${ids.length} 张。还凑不齐。铜片只要两张类型不同的普通。`;
      return;
    }
    const line = document.createElement("span");
    line.textContent = `可以合成${card.name}。点上面的按钮，或点这里直接合成。`;
    const use = document.createElement("button");
    use.type = "button";
    use.className = "forge-go";
    use.style.marginLeft = "8px";
    use.textContent = "合成";
    use.addEventListener("click", () => commitForge(card.ids), { signal });
    node.append(line, use);
  };
  const paintForge = () => {
    if (!forgeOut) return;
    const ids = (forgeInput?.value ?? "").split(/[^\d]+/).filter(Boolean).map(Number);
    host.querySelectorAll<HTMLButtonElement>("#cp-forge-picks button, #cp-forge-owned button").forEach((button) => {
      button.classList.toggle("on", ids.includes(Number(button.dataset.id)));
    });
    const sheets = ids.map((id) => punkSheet(id));
    const trait = (id: number, key: string) => punkSheet(id).traits.find((cell) => cell.key === key)?.value ?? "";
    const commons = sheets.filter((row) => row.tier === "普通");
    const commonTypes = new Set(commons.map((row) => row.traits.find((cell) => cell.key === "类型")?.value));
    const types = new Set(ids.map((id) => trait(id, "类型")));
    const subs = new Set(ids.map((id) => trait(id, "衬底")));
    const at = (tier: number) => sheets.filter((row) => tierRank(row.tier) >= tier).length;
    const made = ids.length ? forge(ids) : null;
    const ready = (kind: string) => made?.ok === true && made.card.kind === kind;
    const say = (name: string, text: string) => {
      const node = host.querySelector(`#cp-gap-${name}`);
      if (node) node.textContent = !ids.length ? "还没选。" : ready(name) ? "已凑齐。" : text;
    };
    say("copper", `普通 ${commons.length}/2，类型 ${commonTypes.size}/2。要刚好 2 张，而且类型不同。`);
    say("silver", `少见及以上 ${at(2)}/1，衬底 ${subs.size}/2。要刚好 3 张。`);
    say("gold", `稀有及以上 ${at(3)}/1，类型 ${types.size}/3。要刚好 3 张，类型各不相同。`);
    say("euv", `传说 ${sheets.filter((row) => row.tier === "传说").length}/1 加任意 2 张，或史诗 ${sheets.filter((row) => row.tier === "史诗").length}/1 加少见及以上共 4 张。`);
    say("faux", `普通 ${commons.length}/20，类型 ${commonTypes.size} 种。二十张不能是同一种。`);
    forgeOut.replaceChildren();
    if (!ids.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.style.textAlign = "left";
      empty.textContent = "先点你的卡，或输入编号。凑齐后结果出现在这里。";
      forgeOut.append(empty);
      return;
    }
    if (!made || !made.ok) {
      const fail = document.createElement("p");
      fail.className = "hint";
      fail.style.textAlign = "left";
      fail.textContent = made && !made.ok ? made.reason : "这组还不能合成。";
      forgeOut.append(fail);
      return;
    }
    const card = made.card;
    const view = document.createElement("div");
    view.className = "forge-result";
    const face = document.createElement("div");
    face.className = "craft-face";
    face.style.background = `linear-gradient(145deg, ${card.color}, #120c18 78%)`;
    if (card.edge) face.style.boxShadow = `inset 0 0 0 3px ${card.edge}`;
    const photos = document.createElement("div");
    photos.className = "craft-photos";
    for (const id of card.ids.slice(0, 6)) {
      const img = document.createElement("img");
      img.alt = `Circuit Punk ${id}`;
      img.src = `/api/circuit-punk/${id}.png`;
      photos.append(img);
    }
    if (card.ids.length > 6) {
      const more = document.createElement("span");
      more.textContent = `+${card.ids.length - 6}`;
      photos.append(more);
    }
    const side = document.createElement("div");
    const title = document.createElement("h4");
    title.textContent = card.name;
    const mats = document.createElement("p");
    mats.textContent = card.ids.map((id) => `#${id}`).join(" ");
    const fee = document.createElement("p");
    const main = card.main ? `主属性 ${DESK_LABEL[card.main]} ${(card.feeMain / 100).toFixed(2)}%` : "没有主属性再减";
    fee.textContent = `全场 ${(card.feeAll / 100).toFixed(2)}% · ${main}`;
    const stats = document.createElement("p");
    stats.textContent = (Object.keys(DESK_LABEL) as (keyof typeof DESK_LABEL)[])
      .map((desk) => `${DESK_LABEL[desk]} ${card.stats[desk]}`)
      .join(" · ");
    side.append(title, mats, fee, stats);
    face.append(photos, side);
    const guide = document.createElement("p");
    const passKey = card.ids.join(",");
    let saved = "";
    try {
      saved = localStorage.getItem("tape-forge-pass") ?? "";
    } catch {
      saved = "";
    }
    if (saved === passKey) {
      guide.textContent = "已合成。这些编号要锁定，锁着不能转。拆开后 48 小时不能转，这组编号 30 天内不能再合成。锁卡合约上线前，这张卡先记在这台浏览器。现在可以去交易所确认身份。";
      const link = document.createElement("a");
      link.className = "forge-go";
      link.href = "https://app.tapeliquid.net/";
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "去交易所确认身份";
      view.append(face, guide, link);
    } else {
      guide.textContent = "这张卡可以合成。点下面生成，并准备锁定这些编号。";
      const confirm = document.createElement("button");
      confirm.type = "button";
      confirm.className = "forge-go";
      confirm.textContent = "合成";
      confirm.addEventListener("click", () => {
        try {
          localStorage.setItem("tape-forge-pass", passKey);
        } catch {
          guide.textContent = "这台浏览器没有记下。换一台之后要重新合成。";
        }
        paintForge();
      }, { signal });
      view.append(face, guide, confirm);
    }
    forgeOut.append(view);
  };
  forgeInput?.addEventListener("input", paintForge, { signal });
  paintForge();
  const commitForge = (ids: number[]) => {
    if (forgeInput) forgeInput.value = ids.join(" ");
    try {
      localStorage.setItem("tape-forge-pass", ids.join(","));
    } catch {
      /* this browser did not store it */
    }
    paintForge();
    host.querySelector("#cp-forge-out")?.scrollIntoView({ block: "nearest" });
  };
  host.querySelector("#cp-forge-go")?.addEventListener("click", () => {
    const msg = host.querySelector("#cp-forge-go-msg");
    if (!heldForForge.length) {
      if (msg) msg.textContent = "先连接持有 Circuit Punk 的钱包。";
      return;
    }
    const card = bestHeld(heldForForge);
    if (!card) {
      if (msg) msg.textContent = "这组持有凑不齐。铜片要两张类型不同的普通。";
      return;
    }
    commitForge(card.ids);
    if (msg) msg.textContent = `已合成${card.name}。卡在下面。`;
  }, { signal });
  let holdersStarted = false;
  const startHolders = () => {
    if (holdersStarted || signal.aborted) return;
    if (!tradePage?.classList.contains("active")) return;
    holdersStarted = true;
    paintHolders();
  };
  const pageObs = new MutationObserver(startHolders);
  if (tradePage) pageObs.observe(tradePage, { attributes: true, attributeFilter: ["class"] });
  startHolders();
  const feedTimer = window.setInterval(() => void scanFeed(), 12_000);

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
    pageObs.disconnect();
    stopWallet();
    stopLang();
  };
}
