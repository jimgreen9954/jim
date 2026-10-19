type Eth = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  isOkxWallet?: boolean;
  isBinance?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
  isTrust?: boolean;
};

export type WalletKind = "okx" | "binance" | "injected";
export type DeskChain = 56 | 196;

const CHAINS: Record<DeskChain, { hex: string; add: Record<string, unknown> }> = {
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
      rpcUrls: ["https://rpc.xlayer.tech"],
      blockExplorerUrls: ["https://www.oklink.com/xlayer"],
    },
  },
};

let openLink: string | null = null;
const linkListeners = new Set<(next: string | null) => void>();
let current: Eth | null = null;
let account: string | null = null;
let kind: WalletKind = "injected";
let labelName = "钱包";
let chainId: number | null = null;
const listeners = new Set<(next: string | null) => void>();
const chainListeners = new Set<(next: number | null) => void>();

export function currentAccount(): string | null {
  return account;
}

export function currentChain(): number | null {
  return chainId;
}

export function walletLabel(): string {
  return labelName;
}

export function onAccount(cb: (next: string | null) => void): () => void {
  listeners.add(cb);
  cb(account);
  return () => listeners.delete(cb);
}

export function onChain(cb: (next: number | null) => void): () => void {
  chainListeners.add(cb);
  cb(chainId);
  return () => chainListeners.delete(cb);
}

export function onOpenLink(cb: (next: string | null) => void): () => void {
  linkListeners.add(cb);
  cb(openLink);
  return () => linkListeners.delete(cb);
}

function publishLink(next: string | null) {
  openLink = next;
  linkListeners.forEach((cb) => cb(next));
}

function remember(next: string | null) {
  account = next;
  listeners.forEach((cb) => cb(next));
}

function rememberChain(next: number | null) {
  chainId = Number.isFinite(next) ? next : null;
  chainListeners.forEach((cb) => cb(chainId));
}

export function rememberAccount(next: string) {
  remember(next);
}

type Host = Window & {
  okxwallet?: Eth;
  binancew3w?: { ethereum?: Eth };
  ethereum?: Eth;
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

function anyInjected(): Eth | null {
  return okxInjected() ?? binanceInjected() ?? host().ethereum ?? null;
}

function nameOf(eth: Eth): string {
  if (eth.isOkxWallet || eth === okxInjected()) return "OKX";
  if (eth.isBinance || eth === binanceInjected()) return "币安";
  if (eth.isRabby) return "Rabby";
  if (eth.isTrust) return "Trust";
  if (eth.isMetaMask) return "MetaMask";
  return "钱包";
}

function kindOf(eth: Eth): WalletKind {
  if (eth.isOkxWallet || eth === okxInjected()) return "okx";
  if (eth.isBinance || eth === binanceInjected()) return "binance";
  return "injected";
}

function captureOkxOpen() {
  const original = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const text = url == null ? "" : String(url);
    const tracked = /okx|topic=|\/ul\/connect|^wc:/i.test(text);
    const opened = original(url, target, features);
    if (tracked) publishLink(text);
    return opened;
  };
}

let armed = false;

function armCapture() {
  if (typeof window === "undefined" || armed) return;
  armed = true;
  captureOkxOpen();
}

async function refreshChain(eth: Eth) {
  try {
    const hex = String(await eth.request({ method: "eth_chainId" }));
    rememberChain(Number.parseInt(hex, 16));
  } catch {
    rememberChain(null);
  }
}

const wired = new WeakSet<object>();

async function useInjected(eth: Eth): Promise<string> {
  current = eth;
  kind = kindOf(eth);
  labelName = nameOf(eth);
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  remember(next);
  if (!wired.has(eth)) {
    wired.add(eth);
    eth.on?.("accountsChanged", (rows) => {
      const list = Array.isArray(rows) ? (rows as string[]) : [];
      remember(list[0] ?? null);
      if (!list[0]) rememberChain(null);
    });
    eth.on?.("chainChanged", (hex) => rememberChain(Number.parseInt(String(hex), 16)));
  }
  await refreshChain(eth);
  return next;
}

async function connectOkxRemote(): Promise<string> {
  const { OKXUniversalProvider, OpenAppLinkType } = await import("@okxconnect/universal-provider");
  const okx = await OKXUniversalProvider.init({
    dappMetaData: {
      name: "TAPELIQUID",
      icon: `${window.location.origin}/mark.jpg`,
    },
    openAppLinkType: OpenAppLinkType.UniversalLink,
  });
  armCapture();
  okx.on("display_uri", (uri: string) => publishLink(String(uri)));
  const signClient = (okx as { client?: { sessionConfig?: Record<string, unknown> } }).client;
  if (signClient) {
    signClient.sessionConfig = { ...(signClient.sessionConfig ?? {}), openUniversalUrl: true, redirect: "back" };
  }
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
          sessionConfig: { redirect: "back", openUniversalUrl: true },
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
      armCapture();
      if (args.method === "wallet_switchEthereumChain" || args.method === "eth_sendTransaction") {
        const hex =
          args.method === "wallet_switchEthereumChain"
            ? (args.params as { chainId?: string }[] | undefined)?.[0]?.chainId
            : (args.params as { chainId?: string }[] | undefined)?.[0]?.chainId;
        if (hex) okx.setDefaultChain(String(Number.parseInt(hex, 16)));
        else if (args.method === "eth_sendTransaction" && (chainId === 56 || chainId === 196)) okx.setDefaultChain(String(chainId));
      }
      try {
        return await okx.request(args);
      } finally {
        publishLink(null);
      }
    },
  };
  kind = "okx";
  labelName = "OKX";
  current = wrapped;
  const accounts = (await wrapped.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  remember(next);
  await refreshChain(wrapped);
  return next;
}

export async function connectBrowser(): Promise<string> {
  const eth = host().ethereum ?? okxInjected() ?? binanceInjected();
  if (!eth) throw new Error("nowallet");
  return useInjected(eth);
}

export async function connectKind(which: WalletKind): Promise<string> {
  if (which === "injected") return connectBrowser();
  const plugged = which === "binance" ? binanceInjected() : okxInjected();
  if (plugged) return useInjected(plugged);
  if (which === "binance") {
    const eth = host().ethereum;
    if (eth) return useInjected(eth);
    publishLink(`https://app.binance.com/cedefi/dapp?url=${encodeURIComponent(window.location.href)}`);
    throw new Error("binanceapp");
  }
  const eth = host().ethereum;
  if (eth) return useInjected(eth);
  return connectOkxRemote();
}

export async function switchDeskChain(id: DeskChain): Promise<void> {
  const eth = current ?? anyInjected();
  if (!eth) throw new Error("nowallet");
  if (!current) current = eth;
  const row = CHAINS[id];
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: row.hex }] });
  } catch (err) {
    const code = typeof err === "object" && err && "code" in err ? Number((err as { code?: number }).code) : 0;
    const message = err instanceof Error ? err.message : "";
    if (code === 4902 || /unrecognized|not added|unknown chain/i.test(message)) {
      await eth.request({ method: "wallet_addEthereumChain", params: [row.add] });
    } else {
      throw err;
    }
  }
  rememberChain(id);
}

export function getProvider(): Eth | null {
  return current;
}

export function walletKind(): WalletKind {
  return kind;
}

export function disconnectWallet() {
  const eth = current as (Eth & { disconnect?: () => Promise<unknown> }) | null;
  void eth?.disconnect?.().catch(() => undefined);
  current = null;
  kind = "injected";
  labelName = "钱包";
  publishLink(null);
  remember(null);
  rememberChain(null);
}

export async function ensureProvider(): Promise<Eth> {
  if (current) return current;
  const plugged = anyInjected();
  if (plugged) {
    current = plugged;
    kind = kindOf(plugged);
    labelName = nameOf(plugged);
    return plugged;
  }
  throw new Error("nowallet");
}

export async function connectInjected(eth: Eth): Promise<string> {
  return useInjected(eth);
}

export async function resumeInjected(): Promise<string | null> {
  const eth = anyInjected();
  if (!eth) return null;
  try {
    const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
    const next = accounts[0];
    if (!next) return null;
    current = eth;
    kind = kindOf(eth);
    labelName = nameOf(eth);
    remember(next);
    eth.on?.("accountsChanged", (rows) => {
      const list = Array.isArray(rows) ? (rows as string[]) : [];
      remember(list[0] ?? null);
    });
    eth.on?.("chainChanged", (hex) => rememberChain(Number.parseInt(String(hex), 16)));
    await refreshChain(eth);
    return next;
  } catch {
    return null;
  }
}