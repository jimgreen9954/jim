const KEY = "tapeliquid-nicks-v1";
const AVATAR_KEY = "tapeliquid-avatars-v1";

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

function readAvatars(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(AVATAR_KEY) ?? "{}") as Record<string, string>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function readAvatar(address: string): string {
  if (typeof window === "undefined") return "";
  const value = readAvatars()[address.toLowerCase()];
  return typeof value === "string" && value.startsWith("data:image/") ? value : "";
}

export function writeAvatar(address: string, dataUrl: string) {
  const next = readAvatars();
  const key = address.toLowerCase();
  if (!dataUrl.startsWith("data:image/")) delete next[key];
  else next[key] = dataUrl;
  window.localStorage.setItem(AVATAR_KEY, JSON.stringify(next));
}