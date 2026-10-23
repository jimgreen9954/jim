const KEY = "tapeliquid-nicks-v1";

export function readNicks(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function writeNick(address: string, name: string) {
  const next = readNicks();
  const key = address.toLowerCase();
  const trimmed = name.trim().slice(0, 16);
  if (!trimmed) delete next[key];
  else next[key] = trimmed;
  window.localStorage.setItem(KEY, JSON.stringify(next));
}

export function nickOf(address: string, nicks: Record<string, string>): string {
  return nicks[address.toLowerCase()] ?? "";
}
