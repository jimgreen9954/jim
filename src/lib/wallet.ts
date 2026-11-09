type Eth = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (accounts: string[]) => void) => void;
};

export type WalletKind = "okx" | "binance" | "scan";
export type DeskChain = 56 | 196;

let openLink: string | null = null;
const linkListeners = new Set<(next: string | null) => void>();
let current: Eth | null = null;
let account: string | null = null;
let kind: WalletKind = "okx";
let dropped = false;
const listeners = new Set<(next: string | null) => void>();

export function currentAccount(): string | null {
  return account;
}

export function onAccount(cb: (next: string | null) => void): () => void {
  listeners.add(cb);
  cb(account);
  return () => listeners.delete(cb);
}

export function onOpenLink(cb: (next: string | null) => void): () => void {
  linkListeners.add(cb);
  cb(openLink);
  return () => linkListeners.delete(cb);
}

let pairUri: string | null = null;
const pairListeners = new Set<(next: string | null) => void>();

export function onPairUri(cb: (next: string | null) => void): () => void {
  pairListeners.add(cb);
  cb(pairUri);
  return () => pairListeners.delete(cb);
}

function publishPair(next: string | null) {
  pairUri = next;
  pairListeners.forEach((cb) => cb(next));
}

function publishLink(next: string | null) {
  openLink = next;
  linkListeners.forEach((cb) => cb(next));
}

function remember(next: string | null) {
  if (dropped && next) return;
  account = next;
  listeners.forEach((cb) => cb(next));
}

export async function resumeSession(): Promise<void> {
  if (account || dropped) return;
  const eth = okxInjected() ?? binanceInjected() ?? host().ethereum ?? null;
  if (!eth) return;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    const next = accounts?.[0];
    if (!next) return;
    current = eth;
    kind = eth === binanceInjected() ? "binance" : "okx";
    remember(next);
    eth.on?.("accountsChanged", (rows: string[]) => remember(rows?.[0] ?? null));
    eth.on?.("chainChanged", ((hex: unknown) => rememberChain(parseChainId(hex))) as (accounts: string[]) => void);
    void refreshChain(eth);
  } catch {
    /* No stored session. The connect button stays. */
  }
}

export function rememberAccount(next: string) {
  remember(next);
}

type Host = Window & {
  okxwallet?: Eth;
  binancew3w?: { ethereum?: Eth };
  ethereum?: Eth & { isOkxWallet?: boolean; isBinance?: boolean };
};

function host(): Host {
  return window as Host;
}

export function okxInjected(): Eth | null {
  const w = host();
  if (w.okxwallet) return w.okxwallet;
  if (w.ethereum?.isOkxWallet) return w.ethereum;
  return null;
}

export function binanceInjected(): Eth | null {
  const w = host();
  if (w.binancew3w?.ethereum) return w.binancew3w.ethereum;
  if (w.ethereum?.isBinance) return w.ethereum;
  return null;
}

function holdNavigation(url: string): boolean {
  const text = url.toLowerCase();
  const wallet =
    text.startsWith("okx://") ||
    text.startsWith("okxwallet://") ||
    text.startsWith("okxweb3://") ||
    text.includes("link.okx.com") ||
    text.includes("web3.okx.com") ||
    text.includes("web3link.okx.com") ||
    text.includes("okx.com/download") ||
    text.includes("/ul/connect");
  if (!wallet && !text.includes("dapp/url") && !text.includes("dappurl=")) return false;
  if (text.includes("dapp/url") || text.includes("dappurl=") || text.includes("wallet/dapp")) return true;
  publishLink(url);
  return true;
}

function stayOnPage() {
  if (typeof window === "undefined" || armed) return;
  armed = true;
  const original = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const text = url == null ? "" : String(url);
    if (holdNavigation(text)) return null;
    return original(url, target, features);
  };
  const proto = Location.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "href");
  if (desc?.get && desc.set) {
    try {
      Object.defineProperty(proto, "href", {
        configurable: true,
        enumerable: desc.enumerable ?? true,
        get() {
          return desc.get!.call(this);
        },
        set(value: string) {
          const text = String(value);
          if (holdNavigation(text)) return;
          desc.set!.call(this, text);
        },
      });
    } catch {
      /* Some browsers refuse the setter. window.open is still held. */
    }
  }
  const assign = proto.assign;
  proto.assign = function (url: string | URL) {
    const text = String(url);
    if (holdNavigation(text)) return;
    return assign.call(this, url);
  };
  const replace = proto.replace;
  proto.replace = function (url: string | URL) {
    const text = String(url);
    if (holdNavigation(text)) return;
    return replace.call(this, url);
  };
}

let armed = false;

async function useInjected(eth: Eth): Promise<string> {
  dropped = false;
  current = eth;
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  remember(next);
  eth.on?.("accountsChanged", (rows) => remember(rows[0] ?? null));
  eth.on?.("chainChanged", ((hex: unknown) => rememberChain(parseChainId(hex))) as (accounts: string[]) => void);
  void refreshChain(eth);
  return next;
}

const quiet = { redirect: "none" as const, openUniversalUrl: true };

async function connectOkxRemote(): Promise<string> {
  publishPair(null);
  const { OKXUniversalProvider, OpenAppLinkType } = await import("@okxconnect/universal-provider");
  const okx = await OKXUniversalProvider.init({
    dappMetaData: {
      name: "TAPELIQUID",
      icon: `${window.location.origin}/mark.jpg`,
    },
    openAppLinkType: OpenAppLinkType.UniversalLink,
  });
  stayOnPage();
  okx.on("display_uri", (uri: string) => {
    const text = String(uri);
    if (text.toLowerCase().startsWith("wc:")) {
      publishPair(text);
      return;
    }
    holdNavigation(text);
  });
  const signClient = (okx as { client?: { sessionConfig?: Record<string, unknown> } }).client;
  if (signClient) signClient.sessionConfig = { ...(signClient.sessionConfig ?? {}), ...quiet };
  if (!okx.connected()) {
    await new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!openLink) reject(new Error("nowallet"));
      }, 12000);
      okx
        .connect({
          namespaces: {
            eip155: {
              chains: ["eip155:56", "eip155:196"],
              defaultChain: "56",
              rpcMap: {
                "56": "https://bsc-dataseed.binance.org",
                "196": "https://rpc.xlayer.tech",
              },
            },
          },
          sessionConfig: quiet,
        })
        .then((session) => {
          window.clearTimeout(timer);
          resolve(session);
        })
        .catch((err: unknown) => {
          window.clearTimeout(timer);
          reject(err);
        });
    });
    publishLink(null);
  }
  const wrapped: Eth = {
    request: async (args) => {
      stayOnPage();
      if (signClient) signClient.sessionConfig = { ...(signClient.sessionConfig ?? {}), ...quiet };
      if (args.method === "wallet_switchEthereumChain" || args.method === "eth_sendTransaction") {
        const hex =
          args.method === "wallet_switchEthereumChain"
            ? (args.params as { chainId?: string }[] | undefined)?.[0]?.chainId
            : (args.params as { chainId?: string }[] | undefined)?.[0]?.chainId;
        if (hex) okx.setDefaultChain(String(Number.parseInt(hex, 16)));
        else if (args.method === "eth_sendTransaction") okx.setDefaultChain("56");
      }
      try {
        return await okx.request(args);
      } finally {
        publishLink(null);
      }
    },
  };
  current = wrapped;
  dropped = false;
  const accounts = (await wrapped.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  remember(next);
  return next;
}

let remote: { disconnect: () => Promise<void> } | null = null;

const WC_PROJECT = (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)?.trim() || "";

export async function connectScan(): Promise<string> {
  if (!WC_PROJECT) throw new Error("wc-project");
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  stayOnPage();
  publishPair(null);
  if (remote) {
    try {
      await remote.disconnect();
    } catch {
      /* The old phone session is already gone. */
    }
    remote = null;
  }
  const provider = await EthereumProvider.init({
    projectId: WC_PROJECT,
    optionalChains: [56, 196],
    showQrModal: false,
    rpcMap: {
      56: "https://bsc-dataseed.binance.org",
      196: "https://rpc.xlayer.tech",
    },
    metadata: {
      name: "TAPELIQUID",
      description: "TAPELIQUID",
      url: window.location.origin,
      icons: [`${window.location.origin}/mark.jpg`],
    },
    methods: [
      "eth_sendTransaction",
      "personal_sign",
      "eth_signTypedData_v4",
      "eth_sign",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
    ],
    events: ["chainChanged", "accountsChanged"],
  });
  provider.on("display_uri", (uri: string) => publishPair(String(uri)));
  if (!provider.session) await provider.connect();
  const next = provider.accounts[0];
  if (!next) throw new Error("nowallet");
  const wrapped: Eth = {
    request: (args) => provider.request(args),
  };
  remote = { disconnect: () => provider.disconnect() };
  current = wrapped;
  dropped = false;
  kind = "scan";
  remember(next);
  provider.on("accountsChanged", (rows: string[]) => remember(rows?.[0] ?? null));
  provider.on("chainChanged", (hex: string) => rememberChain(parseChainId(hex)));
  provider.on("disconnect", () => {
    if (current !== wrapped) return;
    current = null;
    remote = null;
    remember(null);
    rememberChain(null);
  });
  publishPair(null);
  void refreshChain(wrapped);
  return next;
}

export async function connectKind(which: WalletKind): Promise<string> {
  if (which === "scan") return connectScan();
  kind = which;
  const plugged = which === "binance" ? binanceInjected() : okxInjected();
  if (plugged) return useInjected(plugged);
  const eth = host().ethereum;
  if (which === "binance") {
    if (eth?.isBinance) return useInjected(eth);
    publishLink(`https://app.binance.com/cedefi/dapp?url=${encodeURIComponent(window.location.href)}`);
    throw new Error("binanceapp");
  }
  if (eth) return useInjected(eth);
  stayOnPage();
  return connectOkxRemote();
}

export function getProvider(): Eth | null {
  return current;
}

export async function disconnectWallet(): Promise<void> {
  const eth = current;
  dropped = true;
  try {
    await remote?.disconnect();
  } catch {
    /* The phone may already have dropped the session. */
  }
  remote = null;
  try {
    await eth?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    /* OKX and Binance often refuse. The page still drops the session. */
  }
  current = null;
  publishLink(null);
  publishPair(null);
  remember(null);
  rememberChain(null);
}

export async function grantedAccount(eth: Eth): Promise<string | null> {
  try {
    const rows = (await eth.request({ method: "eth_accounts" })) as string[];
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

export async function ensureProvider(): Promise<Eth> {
  if (current) return current;
  if (kind === "scan") {
    await connectScan();
    if (!current) throw new Error("nowallet");
    return current;
  }
  const plugged = kind === "binance" ? binanceInjected() : okxInjected();
  const eth = plugged ?? host().ethereum ?? null;
  if (eth) {
    current = eth;
    return eth;
  }
  if (kind === "binance") throw new Error("binanceapp");
  await connectOkxRemote();
  if (!current) throw new Error("nowallet");
  return current;
}

export async function connectAny(): Promise<string> {
  return connectKind(kind);
}

const DESK_CHAINS: Record<DeskChain, { hex: string; add: Record<string, unknown> }> = {
  56: {
    hex: "0x38",
    add: {
      chainId: "0x38",
      chainName: "BNB Smart Chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc-dataseed.binance.org"],
      blockExplorerUrls: ["https://bscscan.com"],
    },
  },
  196: {
    hex: "0xc4",
    add: {
      chainId: "0xc4",
      chainName: "X Layer",
      nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
      rpcUrls: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
      blockExplorerUrls: ["https://www.oklink.com/xlayer"],
    },
  },
};

let chainId: number | null = null;
const chainListeners = new Set<(next: number | null) => void>();

function rememberChain(next: number | null) {
  chainId = next != null && Number.isFinite(next) ? next : null;
  chainListeners.forEach((cb) => cb(chainId));
}

async function refreshChain(eth: Eth) {
  try {
    rememberChain(parseChainId(await eth.request({ method: "eth_chainId" })));
  } catch {
    rememberChain(null);
  }
}

export function currentChain(): number | null {
  return chainId;
}

export function walletLabel(): string {
  if (kind === "binance") return "币安";
  if (kind === "scan") return "手机钱包";
  return "OKX";
}

export function onChain(cb: (next: number | null) => void): () => void {
  chainListeners.add(cb);
  cb(chainId);
  return () => chainListeners.delete(cb);
}

export function parseChainId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("0x")) {
    const parsed = Number.parseInt(text, 16);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (/^\d+$/.test(text)) return Number(text);
  const parsed = Number.parseInt(text, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function connectBrowser(): Promise<string> {
  const okx = okxInjected();
  if (okx) {
    kind = "okx";
    return useInjected(okx);
  }
  const binance = binanceInjected();
  if (binance) {
    kind = "binance";
    return useInjected(binance);
  }
  const eth = host().ethereum;
  if (!eth) throw new Error("nowallet");
  kind = eth.isBinance ? "binance" : "okx";
  return useInjected(eth);
}

export async function connectInjected(eth: Eth): Promise<string> {
  return useInjected(eth);
}

export async function resumeInjected(): Promise<string | null> {
  const okx = okxInjected();
  const binance = binanceInjected();
  const raw = okx ?? binance ?? host().ethereum ?? null;
  if (!raw) return null;
  try {
    const accounts = (await raw.request({ method: "eth_accounts" })) as string[];
    const next = accounts[0];
    if (!next) return null;
    kind = raw === binance || host().ethereum?.isBinance ? "binance" : "okx";
    current = raw;
    dropped = false;
    remember(next);
    raw.on?.("accountsChanged", (rows) => remember(rows[0] ?? null));
    raw.on?.("chainChanged", ((hex: unknown) => rememberChain(parseChainId(hex))) as (accounts: string[]) => void);
    await refreshChain(raw);
    return next;
  } catch {
    return null;
  }
}

function chainRejected(err: unknown): boolean {
  const code = typeof err === "object" && err && "code" in err ? Number((err as { code?: number }).code) : 0;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return code === 4001 || /user rejected|denied|cancel/i.test(message);
}

export async function switchDeskChain(id: DeskChain): Promise<void> {
  const eth = current ?? okxInjected() ?? binanceInjected() ?? host().ethereum ?? null;
  if (!eth) throw new Error("nowallet");
  if (!current) current = eth;
  const row = DESK_CHAINS[id];
  const read = async () => parseChainId(await eth.request({ method: "eth_chainId" }));
  if ((await read().catch(() => null)) === id) {
    rememberChain(id);
    return;
  }
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: row.hex }] });
  } catch (err) {
    if (chainRejected(err)) throw err;
    try {
      await eth.request({ method: "wallet_addEthereumChain", params: [row.add] });
    } catch (addErr) {
      if (chainRejected(addErr)) throw addErr;
    }
  }
  for (let i = 0; i < 10; i += 1) {
    if ((await read().catch(() => null)) === id) {
      rememberChain(id);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
  throw new Error(id === 196 ? "xlayer" : "bsc");
}
