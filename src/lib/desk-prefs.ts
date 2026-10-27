import { useEffect, useState } from "react";

export type DeskPrefs = {
  keepAlive: boolean;
  orderConfirm: boolean;
  closeConfirm: boolean;
  closeAllHold: boolean;
  delayGuard: boolean;
  dustSweep: boolean;
  bookSetsSize: boolean;
  bookAnimate: boolean;
  chartPrints: boolean;
  showPnl: boolean;
  notifyFill: boolean;
  soundFill: boolean;
  showWarnings: boolean;
  verboseErrors: boolean;
  bookRem: 16 | 18 | 24;
};

const KEY = "tapeliquid-desk-prefs-v1";

export const PREF_DEFAULTS: DeskPrefs = {
  keepAlive: true,
  orderConfirm: true,
  closeConfirm: true,
  closeAllHold: false,
  delayGuard: true,
  dustSweep: true,
  bookSetsSize: true,
  bookAnimate: true,
  chartPrints: true,
  showPnl: true,
  notifyFill: true,
  soundFill: false,
  showWarnings: true,
  verboseErrors: false,
  bookRem: 18,
};

let cache: DeskPrefs = { ...PREF_DEFAULTS };
const subs = new Set<() => void>();
let loaded = false;
let returnedAt = 0;
let delayPass = false;
let sawHide = false;

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || "{}") as Partial<DeskPrefs>;
    cache = { ...PREF_DEFAULTS, ...raw };
    if (cache.bookRem !== 16 && cache.bookRem !== 18 && cache.bookRem !== 24) cache.bookRem = 18;
  } catch {
    cache = { ...PREF_DEFAULTS };
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) sawHide = true;
    else if (sawHide) returnedAt = Date.now();
  });
}

function publish() {
  subs.forEach((fn) => fn());
}

export function readPrefs(): DeskPrefs {
  load();
  return cache;
}

export function writePrefs(patch: Partial<DeskPrefs>) {
  load();
  cache = { ...cache, ...patch };
  window.localStorage.setItem(KEY, JSON.stringify(cache));
  publish();
}

export function useDeskPrefs(): DeskPrefs {
  const [prefs, setPrefs] = useState<DeskPrefs>(PREF_DEFAULTS);
  useEffect(() => {
    load();
    setPrefs(cache);
    const pull = () => setPrefs({ ...cache });
    subs.add(pull);
    return () => {
      subs.delete(pull);
    };
  }, []);
  return prefs;
}

export function freshEnough(): boolean {
  load();
  if (!cache.delayGuard) return true;
  if (typeof document !== "undefined" && document.hidden) return false;
  if (returnedAt && Date.now() - returnedAt < 1200) {
    if (!delayPass) {
      delayPass = true;
      return false;
    }
    delayPass = false;
    returnedAt = 0;
  }
  return true;
}

export function resetLayout() {
  writePrefs({ bookRem: 18 });
  const drop: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key && (key.startsWith("tapeliquid-ink-") || key === "tapeliquid-bias")) drop.push(key);
  }
  drop.forEach((key) => window.localStorage.removeItem(key));
}

export function cycleBook() {
  const order: DeskPrefs["bookRem"][] = [18, 16, 24];
  const index = order.indexOf(readPrefs().bookRem);
  writePrefs({ bookRem: order[(index + 1) % order.length] });
}

function beep() {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.05, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.13);
  osc.onended = () => void ctx.close();
}

export function announceFill(title: string, body: string) {
  const prefs = readPrefs();
  if (prefs.soundFill) {
    try { beep(); } catch { /* autoplay can refuse */ }
  }
  if (prefs.notifyFill && typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
    try { new Notification(title, { body }); } catch { /* the toggle still stands */ }
  }
  void import("@/components/exchange/trade-foot").then((mod) => mod.rememberFill(`${title} ${body}`.trim())).catch(() => undefined);
}
