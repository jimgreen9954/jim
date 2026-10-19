import { decodeFunctionResult, encodeFunctionData, formatEther, parseAbi, parseEther, type Abi } from "viem";
import { onLang, t, tf } from "@/lib/locale";
import { connectKind, currentAccount, getProvider, walletKind } from "@/lib/wallet";

const GENESIS = "0x50A994E71615474b55559fF4F500928fbc339DD9";
const MARKET = "0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f";
const MULTICALL = "0xcA11bde05977b3631167028862bE2a173976CA11";
const RPC = "https://bsc-dataseed.binance.org";
const PAGE = 12;

const cpuAbi = parseAbi([
  "function nextId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  "function approve(address to, uint256 tokenId)",
]);

const marketAbi = parseAbi([
  "function nextListingId() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function listingView(uint256 id) view returns (address seller, address circuits, uint256 tokenId, uint96 price, uint16 feeBps, bool valid)",
  "function listingFor(address circuits, uint256 tokenId) view returns (uint256 id, address seller, uint96 price, bool valid)",
  "function buy(uint256 id, uint96 expectedPrice) payable",
  "function list(address circuits, uint256 tokenId, uint96 price) returns (uint256)",
]);

const multiAbi = parseAbi([
  "function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)",
]);

type Injected = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type GenesisCard = {
  tokenId: bigint;
  listingId: bigint | null;
  price: bigint | null;
  seller: string | null;
  owner: string | null;
  valid: boolean;
};

async function ethCall(to: string, data: string): Promise<string> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    signal: AbortSignal.timeout(15000),
  });
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (!body.result) throw new Error(body.error?.message || "rpc");
  return body.result;
}

function callData(abi: Abi, fn: string, args: readonly unknown[] = []): `0x${string}` {
  return encodeFunctionData({ abi, functionName: fn, args } as never);
}

function callResult(abi: Abi, fn: string, data: string): unknown {
  return decodeFunctionResult({ abi, functionName: fn, data: data as `0x${string}` } as never);
}

async function read(abi: Abi, fn: string, args: readonly unknown[] = [], to = GENESIS): Promise<unknown> {
  return callResult(abi, fn, await ethCall(to, callData(abi, fn, args)));
}

async function aggregate(calls: { target: string; callData: `0x${string}` }[]): Promise<`0x${string}`[]> {
  const data = encodeFunctionData({
    abi: multiAbi,
    functionName: "aggregate",
    args: [calls.map((call) => ({ target: call.target as `0x${string}`, callData: call.callData }))],
  });
  const raw = await ethCall(MULTICALL, data);
  const decoded = decodeFunctionResult({ abi: multiAbi, functionName: "aggregate", data: raw as `0x${string}` });
  return [...decoded[1]];
}

function bnb(wei: bigint): string {
  const text = formatEther(wei);
  const [whole, frac = ""] = text.split(".");
  return frac ? `${whole}.${frac.slice(0, 4).replace(/0+$/, "") || "0"}` : whole;
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function ensureBsc(eth: Injected): Promise<void> {
  const chain = String(await eth.request({ method: "eth_chainId" })).toLowerCase();
  if (Number.parseInt(chain, 16) === 56) return;
  await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
}

async function send(eth: Injected, tx: { from: string; to: string; data: `0x${string}`; value?: bigint }): Promise<string> {
  const payload: Record<string, string> = { from: tx.from, to: tx.to, data: tx.data, chainId: "0x38" };
  if (tx.value != null) payload.value = `0x${tx.value.toString(16)}`;
  return String(await eth.request({ method: "eth_sendTransaction", params: [payload] }));
}

export function bootGenesis(host: HTMLElement): () => void {
  const ac = new AbortController();
  const opt = { signal: ac.signal };
  let alive = true;
  let mode: "sale" | "all" = "all";
  let page = 0;
  let total = 0n;
  let fee = 100;
  let busy = false;
  let picked: GenesisCard | null = null;
  const grid = host.querySelector("#genesis-grid");
  const note = host.querySelector("#genesis-note");
  const pageLabel = host.querySelector("#genesis-page");
  const sheet = host.querySelector<HTMLElement>("#gen-sheet");
  const say = (text: string) => {
    const node = host.querySelector("#gen-msg");
    if (node) node.textContent = text;
  };

  const paint = (rows: GenesisCard[], label: string) => {
    if (!alive || !grid) return;
    if (pageLabel) pageLabel.textContent = label;
    grid.replaceChildren();
    if (rows.length === 0) {
      const empty = document.createElement("p");
      empty.className = "sub";
      empty.textContent = mode === "sale" ? t("emptySale") : t("emptyAll");
      grid.append(empty);
      return;
    }
    for (const row of rows) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "token";
      const mark = document.createElement("div");
      mark.className = "mark";
      mark.style.background = `hsl(${Number(row.tokenId % 360n)} 62% 42%)`;
      mark.textContent = row.tokenId.toString().slice(-3);
      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("b");
      title.textContent = tf("genCard", { id: row.tokenId.toString() });
      const line = document.createElement("span");
      line.textContent = row.valid && row.price != null ? tf("listed", { px: bnb(row.price) }) : t("unlisted");
      meta.append(title, line);
      card.append(mark, meta);
      card.addEventListener("click", () => open(row));
      grid.append(card);
    }
  };

  const open = (row: GenesisCard) => {
    picked = row;
    if (!sheet) return;
    sheet.hidden = false;
    const name = host.querySelector("#gen-name");
    const px = host.querySelector("#gen-px");
    const link = host.querySelector<HTMLAnchorElement>("#gen-link");
    const buy = host.querySelector<HTMLButtonElement>("#gen-buy");
    const list = host.querySelector<HTMLButtonElement>("#gen-list");
    if (name) name.textContent = tf("genName", { id: row.tokenId.toString() });
    if (px) {
      px.textContent = row.valid && row.price != null
        ? tf("listedPx", { px: bnb(row.price), seller: row.seller ? short(row.seller) : "—", fee: fee / 100 })
        : tf("noListing", { owner: row.owner ? tf("ownerBit", { owner: short(row.owner) }) : "" });
    }
    if (link) link.href = `https://bscscan.com/nft/${GENESIS}/${row.tokenId}`;
    if (buy) buy.disabled = !(row.valid && row.price != null && row.listingId != null);
    if (list) list.disabled = false;
    say("");
  };

  const load = async () => {
    if (!alive) return;
    try {
      if (total === 0n) {
        total = (await read(cpuAbi, "nextId")) as bigint;
        fee = Number(await read(marketAbi, "feeBps", [], MARKET));
      }
      const minted = total > 0n ? total - 1n : 0n;
      if (note) {
        note.textContent = tf("genesisNote", { n: minted.toLocaleString("en-US"), fee: fee / 100 });
      }
      if (mode === "all") {
        const from = 1n + BigInt(page * PAGE);
        if (from > minted) {
          paint([], t("end"));
          return;
        }
        const ids: bigint[] = [];
        for (let i = 0n; i < BigInt(PAGE) && from + i <= minted; i += 1n) ids.push(from + i);
        const calls = ids.flatMap((id) => [
          { target: GENESIS, callData: encodeFunctionData({ abi: cpuAbi, functionName: "ownerOf", args: [id] }) },
          { target: MARKET, callData: encodeFunctionData({ abi: marketAbi, functionName: "listingFor", args: [GENESIS, id] }) },
        ]);
        const back = await aggregate(calls);
        const rows: GenesisCard[] = ids.map((id, index) => {
          let owner: string | null = null;
          try {
            owner = String(decodeFunctionResult({ abi: cpuAbi, functionName: "ownerOf", data: back[index * 2] }));
          } catch {
            owner = null;
          }
          let listingId: bigint | null = null;
          let price: bigint | null = null;
          let seller: string | null = null;
          let valid = false;
          try {
            const listing = decodeFunctionResult({ abi: marketAbi, functionName: "listingFor", data: back[index * 2 + 1] }) as readonly [bigint, string, bigint, boolean];
            listingId = listing[0];
            seller = listing[1];
            price = listing[2];
            valid = Boolean(listing[3]) && listingId > 0n && price > 0n;
          } catch {
            valid = false;
          }
          return { tokenId: id, listingId: valid ? listingId : null, price: valid ? price : null, seller: valid ? seller : null, owner, valid };
        });
        const last = ids[ids.length - 1] ?? from;
        paint(rows, tf("pageAll", { from: from.toString(), to: last.toString(), minted: minted.toString() }));
        return;
      }
      const next = (await read(marketAbi, "nextListingId", [], MARKET)) as bigint;
      let cursor = next - 1n - BigInt(page) * 400n;
      const rows: GenesisCard[] = [];
      let looked = 0;
      while (alive && rows.length < PAGE && cursor >= 1n && looked < 400) {
        const end = cursor;
        const start = end > 79n ? end - 79n : 1n;
        const ids: bigint[] = [];
        for (let id = end; id >= start; id -= 1n) ids.push(id);
        const calls = ids.map((id) => ({
          target: MARKET,
          callData: encodeFunctionData({ abi: marketAbi, functionName: "listingView", args: [id] }),
        }));
        const back = await aggregate(calls);
        ids.forEach((id, index) => {
          if (rows.length >= PAGE) return;
          try {
            const view = decodeFunctionResult({ abi: marketAbi, functionName: "listingView", data: back[index] }) as readonly [string, string, bigint, bigint, number, boolean];
            if (view[1].toLowerCase() !== GENESIS.toLowerCase() || !view[5] || view[3] <= 0n) return;
            rows.push({ tokenId: view[2], listingId: id, price: view[3], seller: view[0], owner: view[0], valid: true });
          } catch {
            /* empty slot */
          }
        });
        looked += ids.length;
        cursor = start - 1n;
      }
      if (rows.length === 0 && cursor < 1n) {
        paint([], t("pageSaleEmpty"));
        return;
      }
      paint(rows, tf("pageSale", { page: page + 1, n: rows.length }));
    } catch (error) {
      if (!alive) return;
      if (note) note.textContent = tf("genesisFail", { err: error instanceof Error ? error.message.slice(0, 80) : "rpc" });
    }
  };

  const gate = async (): Promise<{ eth: Injected; from: string } | null> => {
    if (!getProvider() || walletKind() !== "okx") {
      say(t("needOkx"));
      try {
        await connectKind("okx");
      } catch {
        say(t("noWallet"));
        return null;
      }
    }
    const eth = getProvider();
    if (!eth || walletKind() !== "okx") {
      say(t("needOkx"));
      return null;
    }
    await ensureBsc(eth);
    let from = currentAccount();
    if (!from) {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      from = accounts[0] ?? null;
    }
    if (!from) throw new Error(t("noWallet"));
    return { eth, from };
  };

  host.querySelector("#gen-sale")?.addEventListener("click", () => {
    mode = "sale";
    page = 0;
    host.querySelector("#gen-sale")?.classList.add("on");
    host.querySelector("#gen-all")?.classList.remove("on");
    void load();
  }, opt);
  host.querySelector("#gen-all")?.addEventListener("click", () => {
    mode = "all";
    page = 0;
    host.querySelector("#gen-all")?.classList.add("on");
    host.querySelector("#gen-sale")?.classList.remove("on");
    void load();
  }, opt);
  host.querySelector("#gen-prev")?.addEventListener("click", () => {
    page = Math.max(0, page - 1);
    void load();
  }, opt);
  host.querySelector("#gen-next")?.addEventListener("click", () => {
    page += 1;
    void load();
  }, opt);
  host.querySelector("#gen-close")?.addEventListener("click", () => {
    if (sheet) sheet.hidden = true;
  }, opt);
  host.querySelector("#gen-buy")?.addEventListener("click", () => void (async () => {
    if (busy || !picked?.valid || picked.listingId == null || picked.price == null) return;
    const row = picked;
    busy = true;
    try {
      const who = await gate();
      if (!who) return;
      say(tf("payBnb", { px: bnb(row.price!) }));
      const data = encodeFunctionData({
        abi: marketAbi,
        functionName: "buy",
        args: [row.listingId!, row.price!],
      });
      const hash = await send(who.eth, { from: who.from, to: MARKET, data, value: row.price! });
      say(tf("buySent", { hash: short(hash) }));
      void load();
    } catch (error) {
      say(error instanceof Error ? error.message.slice(0, 160) : t("buyFail"));
    } finally {
      busy = false;
    }
  })(), opt);
  host.querySelector("#gen-list")?.addEventListener("click", () => void (async () => {
    if (busy || !picked) return;
    const row = picked;
    const raw = host.querySelector<HTMLInputElement>("#gen-price")?.value.trim() ?? "";
    busy = true;
    try {
      if (!/^\d+(\.\d+)?$/.test(raw) || Number(raw) <= 0) throw new Error(t("priceHint"));
      const price = parseEther(raw as `${number}`);
      if (price >= 2n ** 96n) throw new Error(t("priceRange"));
      const who = await gate();
      if (!who) return;
      const owner = String(await read(cpuAbi, "ownerOf", [row.tokenId]));
      if (owner.toLowerCase() !== who.from.toLowerCase()) throw new Error(t("notOwner"));
      const approved = String(await read(cpuAbi, "getApproved", [row.tokenId]));
      const all = Boolean(await read(cpuAbi, "isApprovedForAll", [who.from, MARKET]));
      if (approved.toLowerCase() !== MARKET.toLowerCase() && !all) {
        say(t("approve"));
        const data = encodeFunctionData({ abi: cpuAbi, functionName: "approve", args: [MARKET, row.tokenId] });
        const hash = await send(who.eth, { from: who.from, to: GENESIS, data });
        say(tf("approveSent", { hash: short(hash) }));
        return;
      }
      const data = encodeFunctionData({ abi: marketAbi, functionName: "list", args: [GENESIS, row.tokenId, price] });
      const hash = await send(who.eth, { from: who.from, to: MARKET, data });
      say(tf("listSent", { hash: short(hash) }));
    } catch (error) {
      say(error instanceof Error ? error.message.slice(0, 160) : t("listFail"));
    } finally {
      busy = false;
    }
  })(), opt);

  const stopLang = onLang(() => {
    void load();
  });
  void load();
  return () => {
    alive = false;
    stopLang();
    ac.abort();
  };
}
