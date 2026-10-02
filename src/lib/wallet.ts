type Eth = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

let openLink: string | null = null;
const linkListeners = new Set<(next: string | null) => void>();

export function onOpenLink(cb: (next: string | null) => void): () => void {
  linkListeners.add(cb);
  cb(openLink);
  return () => linkListeners.delete(cb);
}

function publishLink(next: string | null) {
  openLink = next;
  linkListeners.forEach((cb) => cb(next));
}

function captureOkxOpen() {
  const original = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const text = url == null ? "" : String(url);
    if (text.includes("okx") || text.includes("topic=") || text.includes("/ul/connect")) {
      publishLink(text);
      return null;
    }
    return original(url, target, features);
  };
  const proto = Object.getPrototypeOf(window.location) as Location;
  const desc = Object.getOwnPropertyDescriptor(proto, "href");
  if (desc?.set && desc.configurable) {
    try {
      Object.defineProperty(proto, "href", {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value: string) {
          const text = String(value);
          if (text.includes("okx") || text.includes("topic=") || text.includes("/ul/connect")) {
            publishLink(text);
            return;
          }
          desc.set?.call(this, value);
        },
      });
    } catch {
      /* keep the original setter */
    }
  }
}

let armed = false;

function armCapture() {
  if (typeof window === "undefined" || armed) return;
  armed = true;
  captureOkxOpen();
}
let current: Eth | null = null;
let account: string | null = null;
const listeners = new Set<(next: string | null) => void>();

export function currentAccount(): string | null {
  return account;
}

export function onAccount(cb: (next: string | null) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function rememberAccount(next: string) {
  account = next;
  listeners.forEach((cb) => cb(next));
}

function injected(): Eth | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: Eth }).ethereum;
  return eth?.request ? eth : null;
}

export function getProvider(): Eth | null {
  return current ?? injected();
}

export async function ensureProvider(): Promise<Eth> {
  const plugged = injected();
  if (plugged) {
    current = plugged;
    return plugged;
  }
  if (current) return current;
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
  if (signClient) {
    signClient.sessionConfig = { ...(signClient.sessionConfig ?? {}), openUniversalUrl: true, redirect: "back" };
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
  const accounts = (await wrapped.request({ method: "eth_requestAccounts" })) as string[];
  if (accounts[0]) rememberAccount(accounts[0]);
  return wrapped;
}

export async function connectAny(): Promise<string> {
  const eth = await ensureProvider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const next = accounts[0];
  if (!next) throw new Error("nowallet");
  rememberAccount(next);
  return next;
}
