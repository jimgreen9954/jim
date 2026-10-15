type Eth = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (accounts: string[]) => void) => void;
};

export type WalletKind = "okx" | "binance";

let openLink: string | null = null;
const linkListeners = new Set<(next: string | null) => void>();
let current: Eth | null = null;
let account: string | null = null;
let kind: WalletKind = "okx";
let dropped = false;
const listeners = new Set<(next: string | null) => void>();

export function walletKind(): WalletKind {
  return kind;
}

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

function publishLink(next: string | null) {
  openLink = next;
  linkListeners.forEach((cb) => cb(next));
}

function remember(next: string | null) {
  if (dropped && next) return;
  account = next;
  listeners.forEach((cb) => cb(next));
}

export function rememberAccount(next: string) {
  remember(next);
}

type Host = Window & {
  okxwallet?: Eth;
  binancew3w?: Eth & { ethereum?: Eth };
  ethereum?: Eth & { isOkxWallet?: boolean; isBinance?: boolean; providers?: Array<Eth & { isBinance?: boolean; isOkxWallet?: boolean }> };
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

const binanceWrap = new WeakMap<Eth, Eth>();

function wrapBinance(eth: Eth): Eth {
  const hit = binanceWrap.get(eth);
  if (hit) return hit;
  const next: Eth = {
    request: (args) => {
      if (args.method === "eth_sendTransaction" && Array.isArray(args.params) && args.params[0] && typeof args.params[0] === "object") {
        const row = { ...(args.params[0] as Record<string, unknown>) };
        delete row.chainId;
        if (row.value == null) row.value = "0x0";
        return eth.request({ method: "eth_sendTransaction", params: [row] });
      }
      return eth.request(args);
    },
    on: eth.on?.bind(eth),
  };
  binanceWrap.set(eth, next);
  return next;
}

export function binanceInjected(): Eth | null {
  const w = host();
  const listed = w.ethereum?.providers?.find((row) => row.isBinance);
  const nested = w.binancew3w?.ethereum ?? (w.binancew3w && "request" in w.binancew3w ? w.binancew3w : null);
  const marked = w.ethereum?.isBinance ? w.ethereum : null;
  const found = listed ?? nested ?? marked;
  return found ? wrapBinance(found) : null;
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
  return next;
}

const quiet = { redirect: "none" as const, openUniversalUrl: true };

async function connectOkxRemote(): Promise<string> {
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
    if (text.toLowerCase().startsWith("wc:")) return;
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

export async function connectKind(which: WalletKind): Promise<string> {
  kind = which;
  const plugged = which === "binance" ? binanceInjected() : okxInjected();
  if (plugged) return useInjected(plugged);
  const eth = host().ethereum;
  if (which === "binance") {
    if (eth && !eth.isOkxWallet) return useInjected(wrapBinance(eth));
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
    await eth?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
  } catch {
    /* OKX and Binance often refuse. The page still drops the session. */
  }
  current = null;
  publishLink(null);
  remember(null);
}

export async function ensureProvider(): Promise<Eth> {
  if (current) return current;
  const plugged = kind === "binance" ? binanceInjected() : okxInjected();
  if (plugged) {
    current = plugged;
    return plugged;
  }
  if (kind === "binance") {
    const eth = host().ethereum;
    if (eth && !eth.isOkxWallet) {
      const next = wrapBinance(eth);
      current = next;
      return next;
    }
    throw new Error("binanceapp");
  }
  await connectOkxRemote();
  if (!current) throw new Error("nowallet");
  return current;
}

export async function connectAny(): Promise<string> {
  return connectKind(kind);
}
