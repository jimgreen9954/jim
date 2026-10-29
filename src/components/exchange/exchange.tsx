import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copy } from "@/lib/copy";
import { startPersistence, useExchange } from "@/lib/exchange-store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/format";
import { equity, sessionChange } from "@/lib/match-engine";
import { DeskHome, RedPocket, rememberDesk } from "@/components/exchange/desk-home";
import { ConnectButton, ChainSwitch } from "@/components/exchange/wallet-bar";
import { SettingsMenu } from "@/components/exchange/settings-menu";
import { LocaleMenu } from "@/components/exchange/locale-menu";
import { SideRail } from "@/components/exchange/side-rail";
import { FeeLockProvider, useFeeLock } from "@/lib/fee-lock";
import { connectKind, disconnectWallet, resumeSession } from "@/lib/wallet";
import { readPrefs } from "@/lib/desk-prefs";
import { askChart, askTrade } from "@/components/exchange/phone-desk";

const FeeBook = lazy(() => import("@/components/exchange/header-docks").then((m) => ({ default: m.FeeBook })));
const BridgeDock = lazy(() => import("@/components/exchange/header-docks").then((m) => ({ default: m.BridgeDock })));
const InviteDock = lazy(() => import("@/components/exchange/header-docks").then((m) => ({ default: m.InviteDock })));

type Floor = "desk" | "paper" | "shop" | "rules" | "canvas" | "me" | "mine";
type DeskTab = "spot" | "perp";
type ShopTab = "gate" | "chips" | "circuits" | "book";

const AccountCenter = lazy(() => import("@/components/exchange/account-center").then((m) => ({ default: m.AccountCenter })));
const TapeSpotDesk = lazy(() => import("@/components/exchange/tape-spot").then((m) => ({ default: m.TapeSpotDesk })));
const WorkshopRisk = lazy(() => import("@/components/exchange/risk-calc").then((m) => ({ default: m.WorkshopRisk })));
const MineDesk = lazy(() => import("@/components/exchange/mine-desk").then((m) => ({ default: m.MineDesk })));
const Whitepaper = lazy(() => import("@/components/exchange/whitepaper").then((m) => ({ default: m.Whitepaper })));
const TapeCanvas = lazy(() => import("@/components/exchange/tape-canvas").then((m) => ({ default: m.TapeCanvas })));
const OfficialDesk = lazy(() => import("@/components/exchange/official-desk").then((m) => ({ default: m.OfficialDesk })));
const TransistorDesk = lazy(() => import("@/components/exchange/transistor-desk").then((m) => ({ default: m.TransistorDesk })));
const Blotter = lazy(() => import("@/components/exchange/blotter").then((m) => ({ default: m.Blotter })));
const Book = lazy(() => import("@/components/exchange/book").then((m) => ({ default: m.Book })));
const TraceChart = lazy(() => import("@/components/exchange/chart").then((m) => ({ default: m.TraceChart })));
const DiePanel = lazy(() => import("@/components/exchange/die").then((m) => ({ default: m.DiePanel })));
const Ticket = lazy(() => import("@/components/exchange/ticket").then((m) => ({ default: m.Ticket })));

export function Exchange({ start = "spot" }: { start?: "spot" | "paper" | "perp" | "gate" | "wafer" | "brief" }) {
  const [floor, setFloor] = useState<Floor>(start === "paper" ? "paper" : start === "gate" || start === "wafer" ? "shop" : start === "brief" ? "rules" : "desk");
  const [desk, setDesk] = useState<DeskTab>(start === "perp" ? "perp" : "spot");
  const [shop, setShop] = useState<ShopTab>(start === "gate" ? "gate" : "book");
  const [giftOpen, setGiftOpen] = useState(false);
  const [place, setPlace] = useState("");
  const { night, setNight } = useNight();
  const num = useExchange((s) => s.num);
  useEffect(() => {
    let stop = () => {};
    const id = window.setTimeout(() => {
      stop = startPersistence();
    }, 1500);
    return () => {
      window.clearTimeout(id);
      stop();
    };
  }, []);
  useEffect(() => {
    const apply = () => {
      const named = window.location.hash.replace(/^#/, "");
      setPlace(named);
      if (named === "spot") { setFloor("desk"); setDesk("spot"); }
      if (named === "perp") { setFloor("desk"); setDesk("perp"); }
      if (named === "paper") setFloor("paper");
      if (named === "gate" || named.startsWith("gate=")) { setFloor("shop"); setShop("gate"); }
      if (named === "wafer" || named === "book" || named === "nand") { setFloor("shop"); setShop("book"); }
      if (named === "chips") { setFloor("shop"); setShop("chips"); }
      if (named === "circuits") { setFloor("shop"); setShop("circuits"); }
      if (named === "canvas") setFloor("canvas");
      if (named === "mine" || named === "earn" || named === "net" || named === "stake" || named === "vault" || named === "bid" || named === "ash") setFloor("mine");
      if (named === "me" || named === "gift") setFloor("me");
      if (named === "gift") setGiftOpen(true);
      if (named === "brief" || named === "rules") setFloor("rules");
    };
    apply();
    window.addEventListener("hashchange", apply);
    if (readPrefs().keepAlive) void resumeSession();
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  return (
    <FeeLockProvider>
      <div className="min-h-screen overflow-x-hidden bg-paper text-ink" data-num={num}>
        <Crops />
        {floor === "paper" ? <SimClock /> : null}
        <BannerToast />
        <FuseFlash />
        <div className="mx-auto flex min-h-screen w-full flex-col pb-24 lg:pb-10">
          <Header floor={floor} desk={desk} shop={shop} place={place} night={night} setNight={setNight} setFloor={setFloor} setDesk={setDesk} setShop={setShop} setGiftOpen={setGiftOpen} />
          {floor === "desk" ? <TradeBanner /> : null}
          <div key={`${floor}-${shop}`} className={`flex flex-col gap-3 px-2 pt-2 sm:px-3 ${floor === "paper" ? "pb-6" : ""}`}>
          <FeeStrip />
          {floor === "desk" ? <DeskHome desk={desk} onDesk={setDesk} /> : null}
          {floor === "paper" ? <Suspense fallback={null}><PaperFloor /></Suspense> : null}
          {floor === "shop" ? <Suspense fallback={null}><ShopFloor shop={shop} setShop={setShop} /></Suspense> : null}
          {floor === "canvas" ? <Suspense fallback={null}><TapeCanvas /></Suspense> : null}
          {floor === "mine" ? <Suspense fallback={null}><MineDesk /></Suspense> : null}
          {floor === "me" ? <Suspense fallback={null}><AccountCenter giftOpen={giftOpen} /></Suspense> : null}
          {floor === "rules" ? <Suspense fallback={null}><Whitepaper /></Suspense> : null}
          </div>
        </div>
        <TerminalBar night={night} setNight={setNight} />
        <RedPocket />
      </div>
    </FeeLockProvider>
  );
}

function useNight() {
  const [night, setNight] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = window.localStorage.getItem("tapeliquid-night") !== "day";
    setNight(on);
    document.documentElement.classList.toggle("day", !on);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("day", !night);
    window.localStorage.setItem("tapeliquid-night", night ? "1" : "day");
  }, [night, ready]);
  return { night, setNight };
}

function ThemeButton({ night, setNight, icon = false }: { night: boolean; setNight: (next: boolean | ((on: boolean) => boolean)) => void; icon?: boolean }) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const label = night ? (zh ? "夜间" : "Night") : (zh ? "日间" : "Day");
  const flip = () => {
    const next = !night;
    document.documentElement.classList.toggle("day", !next);
    setNight(next);
  };
  return (
    <button
      type="button"
      aria-pressed={night}
      title={night ? (zh ? "现在是夜间。点一下换成日间。" : "Night. Switch to day.") : (zh ? "现在是日间。点一下换成夜间。" : "Day. Switch to night.")}
      className={`inline-flex shrink-0 items-center justify-center gap-1 border border-gold text-ink ${icon ? "size-9" : "h-8 px-2 text-xs"}`}
      onClick={flip}
    >
      <span className="theme-ico" aria-hidden>
        <svg viewBox="0 0 24 24" className={night ? "theme-ico-on" : "theme-ico-off"} fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" /></svg>
        <svg viewBox="0 0 24 24" className={night ? "theme-ico-off" : "theme-ico-on"} fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3.5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>
      </span>
      {icon ? null : <span>{label}</span>}
    </button>
  );
}

function TerminalBar({ night, setNight }: { night: boolean; setNight: (next: boolean | ((on: boolean) => boolean)) => void }) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  return (
    <footer className="desk-bar fixed inset-x-0 bottom-0 z-30 hidden h-8 items-center gap-3 overflow-x-auto border-t border-gold px-3 text-[11px] text-ink/55 lg:flex">
      <span className="inline-flex shrink-0 items-center gap-1 text-up"><span className="live-dot size-1.5 rounded-full bg-up" />{zh ? "在线" : "Live"}</span>
      <a href="#rules" className="shrink-0 hover:text-ink">{zh ? "文档" : "Docs"}</a>
      <a href="https://x.com/TAPELIQUID" target="_blank" rel="noreferrer" className="shrink-0 hover:text-ink">X</a>
      <a href="https://t.me/+JN0c8XGQpIkxNTRh" target="_blank" rel="noreferrer" className="shrink-0 hover:text-ink">Telegram</a>
      <a href="https://github.com/jimgreen9954/jim" target="_blank" rel="noreferrer" className="shrink-0 hover:text-ink">GitHub</a>
      <a href="#rules" className="shrink-0 hover:text-ink">{zh ? "条款" : "Rules"}</a>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <ThemeButton night={night} setNight={setNight} />
      </span>
    </footer>
  );
}

function TradeBanner() {
  const zh = useExchange((s) => s.lang) === "zh";
  const cells = zh
    ? [
        ["现货", "TAPE"],
        ["委托", "限价 / 市价"],
        ["合约", "TAPE"],
        ["市场", "全部"],
      ]
    : [
        ["Spot", "TAPE"],
        ["Order", "Limit / Market"],
        ["Perps", "TAPE"],
        ["Markets", "All"],
      ];
  return (
    <div className="trade-ribbon hidden overflow-x-auto lg:block" role="status">
      <div className="mx-auto flex h-8 w-max min-w-full items-stretch justify-center">
        {cells.map(([key, value], index) => (
          <div key={key} className={`flex items-center gap-2 px-3.5 ${index > 0 ? "ribbon-rule" : ""}`}>
            {index === 0 ? <span className="live-dot size-1.5 shrink-0 rounded-full bg-up" aria-hidden /> : null}
            <span className="text-[10px] tracking-[0.18em] text-current/45 uppercase">{key}</span>
            <span className="font-mono text-[12px]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeeStrip() {
  const lang = useExchange((s) => s.lang);
  const lock = useFeeLock();
  if (lock.status === "checking") {
    return <p className="text-xs text-ink/60">{lang === "zh" ? "正在对三份合约的收费地址。" : "Checking the fee address on the three contracts."}</p>;
  }
  if (lock.status !== "bad") return null;
  return (
    <p className="border border-sell px-3 py-2 text-sm text-sell">
      {lang === "zh" ? "收费地址对不上，下单已停。" : "The fee address does not match. Orders are stopped."}{" "}
      {lock.rows
        .filter((row) => !row.ok)
        .map((row) => `${row.name}: ${row.got ?? (lang === "zh" ? "没读到" : "unread")}`)
        .join(" · ")}
    </p>
  );
}

function Crops() {
  return (
    <div aria-hidden>
      <span className="crop crop-tl" />
      <span className="crop crop-tr" />
      <span className="crop crop-bl" />
      <span className="crop crop-br" />
    </div>
  );
}

function SimClock() {
  const tick = useExchange((s) => s.tick);
  const follow = useExchange((s) => s.setChainBem);
  useEffect(() => {
    const id = window.setInterval(() => tick(400), 400);
    let dead = false;
    let pending = false;
    const pull = () => {
      if (pending || document.hidden) return;
      pending = true;
      import("@/lib/bsc")
        .then((mod) => mod.bemPrice())
        .then((text) => {
          const n = Number(text.replace(/,/g, ""));
          if (!dead && n > 0) follow(n);
        })
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };
    pull();
    const priceId = window.setInterval(pull, 8000);
    return () => {
      dead = true;
      window.clearInterval(id);
      window.clearInterval(priceId);
    };
  }, [tick, follow]);
  return null;
}

function BannerToast() {
  const banner = useExchange((s) => s.banner);
  const clear = useExchange((s) => s.clearBanner);
  const lang = useExchange((s) => s.lang);
  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => clear(), 2800);
    return () => window.clearTimeout(id);
  }, [banner, clear]);
  if (!banner || banner.key === "liq") return null;
  const text = copy[lang].banners[banner.key] ?? banner.key;
  return (
    <p className="toast-in fixed inset-x-3 top-4 z-50 mx-auto max-w-md border border-gold bg-card px-3 py-2 text-center text-sm shadow-plate">
      {text}
    </p>
  );
}

function FuseFlash() {
  const liqSeq = useExchange((s) => s.liqSeq);
  const lang = useExchange((s) => s.lang);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (liqSeq === 0) return;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), 1800);
    return () => window.clearTimeout(id);
  }, [liqSeq]);
  if (!on) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div className="sweep h-1 bg-sell" />
      <p className="mx-auto mt-3 w-fit bg-sell px-4 py-2 text-sm text-[#f7f5f0]">{copy[lang].banners.liq}</p>
    </div>
  );
}


function Header({ floor, desk, shop, place, night, setNight, setFloor, setDesk, setShop, setGiftOpen }: { floor: Floor; desk: DeskTab; shop: ShopTab; place: string; night: boolean; setNight: (next: boolean | ((on: boolean) => boolean)) => void; setFloor: (floor: Floor) => void; setDesk: (desk: DeskTab) => void; setShop: (shop: ShopTab) => void; setGiftOpen: (open: boolean) => void }) {
  const lang = useExchange((s) => s.lang);
  const locale = useExchange((s) => s.locale);
  const reset = useExchange((s) => s.reset);
  const [arm, setArm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [pane, setPane] = useState<"chart" | "ticket">("chart");
  useEffect(() => {
    const chart = () => setPane("chart");
    const trade = () => setPane("ticket");
    window.addEventListener("tape-chart", chart);
    window.addEventListener("tape-trade", trade);
    return () => {
      window.removeEventListener("tape-chart", chart);
      window.removeEventListener("tape-trade", trade);
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    if (!arm) return;
    const id = window.setTimeout(() => setArm(false), 2800);
    return () => window.clearTimeout(id);
  }, [arm]);
  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);
  const go = (next: Floor, hash: string) => {
    if (window.location.pathname.startsWith("/whitepaper")) {
      window.location.assign(next === "rules" ? "/whitepaper" : `/#${hash}`);
      return;
    }
    const url = `#${hash}`;
    if (window.location.hash !== url) window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    setFloor(next);
    setMenu(false);
  };
  const item = (label: string, on: boolean, run: () => void) => (
    <button key={label} type="button" onClick={run} className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm ${on ? "bg-foil text-ink" : "text-ink/65 hover:text-ink"}`}>
      {label}
    </button>
  );
  const zh = lang === "zh";
  const claimOn = floor === "mine" && place !== "stake" && place !== "vault" && place !== "bid" && place !== "ash";
  const home = () => { rememberDesk({ kind: "tape", market: 0 }); window.dispatchEvent(new CustomEvent("tape-home", { detail: "tape" })); go("desk", "spot"); setDesk("spot"); };
  const perps = () => { rememberDesk({ kind: "perp", chain: "xlayer", coin: "bem" }); window.dispatchEvent(new CustomEvent("tape-home", { detail: "tape-perp" })); go("desk", "perp"); setDesk("perp"); };
  const showChart = () => {
    setMenu(false);
    if (floor !== "desk") {
      if (desk === "perp") perps();
      else home();
    }
    askChart();
  };
  const showTrade = () => {
    setMenu(false);
    if (floor !== "desk") {
      if (desk === "perp") perps();
      else home();
    }
    askTrade();
  };
  const row = (label: string, on: boolean, run: () => void) => (
    <button type="button" onClick={() => { setMenu(false); run(); }} className={`flex h-12 w-full items-center px-4 text-left text-[15px] ${on ? "text-ink" : "text-ink/80"}`}>{label}</button>
  );
  return (
    <header className="desk-header sticky top-0 z-50 border-b border-gold px-2 sm:px-3 pt-[env(safe-area-inset-top)]">
      <div className="flex h-12 items-center gap-1 lg:hidden">
        <button type="button" aria-label={zh ? "菜单" : "Menu"} className="grid size-10 place-items-center" onClick={() => setMenu(true)}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <button type="button" onClick={home} aria-label="TAPELIQUID">
          <img src="/logo-mark.png" alt="" width={24} height={24} decoding="async" className="size-6 rounded-full" />
        </button>
        <div className="ml-auto flex items-center gap-1">
          <ChainSwitch compact />
          <ConnectButton compact />
          <ThemeButton night={night} setNight={setNight} icon />
          <LocaleMenu />
          {!wide ? <SettingsMenu zh={zh} /> : null}
        </div>
      </div>
      <div className="hidden h-12 items-center gap-1 lg:flex">
        <button type="button" onClick={home} className="mr-1 flex shrink-0 items-center gap-2 px-1">
          <img src="/logo-mark.png" alt="" width={24} height={24} decoding="async" className="size-6 rounded-full" />
          <span className="text-[15px] font-medium tracking-tight">TAPELIQUID</span>
        </button>
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {item(zh ? "现货" : "Spot", floor === "desk" && desk === "spot", home)}
          {item(zh ? "合约" : "Perps", floor === "desk" && desk === "perp", perps)}
          {item(zh ? "赚取" : "Earn", claimOn, () => go("mine", "earn"))}
          {wide ? <Suspense fallback={null}><BridgeDock /></Suspense> : null}
          {wide ? <Suspense fallback={null}><InviteDock /></Suspense> : null}
          {item(zh ? "规则" : "Rules", floor === "rules", () => go("rules", "rules"))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ChainSwitch />
          <ConnectButton />
          {wide ? <Suspense fallback={null}><FeeBook /></Suspense> : null}
          {wide ? <SettingsMenu zh={zh} /> : null}
          {floor === "paper" ? (
            <button
              type="button"
              className={`min-h-9 px-1.5 text-xs ${arm ? "text-sell" : "text-ink/70"}`}
              onClick={() => {
                if (!arm) setArm(true);
                else {
                  reset();
                  setArm(false);
                }
              }}
            >
              {arm ? (zh ? "再点一次" : "Tap again") : zh ? "清除" : "Clear"}
            </button>
          ) : null}
          <ThemeButton night={night} setNight={setNight} />
          <button type="button" className={`min-h-9 px-1.5 text-xs ${floor === "me" ? "text-ink" : "text-ink/70"}`} onClick={() => { setGiftOpen(false); go("me", "me"); }}>
            {zh ? "资产" : "Portfolio"}
          </button>
          <LocaleMenu />
        </div>
      </div>
      <nav className="hidden items-center gap-0.5 overflow-x-auto border-t border-gold/30 py-1 lg:flex">
        {item(zh ? "工房" : "Workshop", floor === "shop" && shop === "book", () => { setShop("book"); go("shop", "book"); })}
        {item(zh ? "TapeOut 合约" : "TapeOut book", floor === "shop" && shop !== "book", () => { setShop("gate"); go("shop", "gate"); })}
        {item(zh ? "流片" : "Tape-out", floor === "canvas", () => go("canvas", "canvas"))}
        {item(zh ? "练习" : "Practice", floor === "paper", () => go("paper", "paper"))}
        {item(zh ? "金库" : "Vault", floor === "mine" && (place === "vault" || place === "bid"), () => go("mine", "vault"))}
        {item(zh ? "质押" : "Stake", floor === "mine" && place === "stake", () => go("mine", "stake"))}
        {item(zh ? "销毁" : "Burn", floor === "mine" && place === "ash", () => go("mine", "ash"))}
      </nav>
      {menu && !wide ? createPortal(
        <div className="fixed inset-0 z-[70]">
          <button type="button" aria-label={zh ? "关闭" : "Close"} className="absolute inset-0 bg-black/55" onClick={() => setMenu(false)} />
          <nav className="phone-menu absolute inset-y-0 left-0 flex w-[min(16.5rem,78vw)] flex-col overflow-y-auto bg-card pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-ink shadow-plate">
            {row(zh ? "投资组合" : "Portfolio", floor === "me", () => { setGiftOpen(false); go("me", "me"); })}
            {row(zh ? "赚取" : "Earn", claimOn, () => go("mine", "earn"))}
            {row(zh ? "金库" : "Vault", floor === "mine" && (place === "vault" || place === "bid"), () => go("mine", "vault"))}
            {row(zh ? "质押" : "Stake", floor === "mine" && place === "stake", () => go("mine", "stake"))}
            <div className="px-1"><Suspense fallback={null}><InviteDock /></Suspense></div>
            <div className="mx-4 my-2 border-t border-white/10" />
            {row(zh ? "现货" : "Spot", floor === "desk" && desk === "spot", home)}
            {row(zh ? "合约" : "Perps", floor === "desk" && desk === "perp", perps)}
            <div className="px-1"><Suspense fallback={null}><BridgeDock /></Suspense></div>
            <div className="px-1"><Suspense fallback={null}><FeeBook /></Suspense></div>
            {row(zh ? "工房" : "Workshop", floor === "shop" && shop === "book", () => { setShop("book"); go("shop", "book"); })}
            {row("TapeOut", floor === "shop" && shop !== "book", () => { setShop("gate"); go("shop", "gate"); })}
            {row(zh ? "流片" : "Tape-out", floor === "canvas", () => go("canvas", "canvas"))}
            {row(zh ? "练习" : "Practice", floor === "paper", () => go("paper", "paper"))}
            {row(zh ? "销毁" : "Burn", floor === "mine" && place === "ash", () => go("mine", "ash"))}
            {row(zh ? "文档" : "Docs", floor === "rules", () => go("rules", "rules"))}
            <a className="flex h-12 items-center px-4 text-[15px] text-ink/80" href="https://x.com/TAPELIQUID" target="_blank" rel="noreferrer">{zh ? "支持 · X" : "Support · X"}</a>
            <a className="flex h-12 items-center px-4 text-[15px] text-ink/80" href="https://t.me/+JN0c8XGQpIkxNTRh" target="_blank" rel="noreferrer">Telegram</a>
            <button type="button" className="flex h-12 w-full items-center px-4 text-left text-[15px] text-ink" onClick={() => { const next = !night; document.documentElement.classList.toggle("day", !next); setNight(next); }}>{night ? (zh ? "换成日间" : "Switch to day") : zh ? "换成夜间" : "Switch to night"}</button>
            <button type="button" className="flex h-12 w-full items-center px-4 text-left text-[15px] text-ink/80" onClick={() => { setMenu(false); connectKind("binance").catch(() => undefined); }}>{zh ? "币安钱包" : "Binance"}</button>
            <button type="button" className="flex h-12 w-full items-center px-4 text-left text-[15px] text-ink/50" onClick={() => { setMenu(false); void disconnectWallet(); }}>{zh ? "退出钱包" : "Disconnect"}</button>
          </nav>
        </div>,
        document.body,
      ) : null}
      {wide ? null : createPortal(
        <nav className="phone-tabbar fixed inset-x-0 bottom-0 z-[45] grid grid-cols-3 border-t border-gold bg-card pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] text-ink">
          <button type="button" className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${floor === "desk" && pane === "chart" ? "text-up" : "text-ink/55"}`} onClick={showChart}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M4 19V5M4 19h16" /><path d="M8 15v-4M12 15V8M16 15v-6" /></svg>
            {zh ? "市场" : "Markets"}
          </button>
          <button type="button" className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${floor === "desk" && pane === "ticket" ? "text-up" : "text-ink/55"}`} onClick={showTrade}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="12" cy="12" r="7" /><path d="M12 8v4l2.5 2" /></svg>
            {zh ? "交易" : "Trade"}
          </button>
          <button type="button" className={`flex flex-col items-center justify-center gap-0.5 text-[11px] ${floor === "me" ? "text-up" : "text-ink/55"}`} onClick={() => { setGiftOpen(false); go("me", "me"); }}>
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><circle cx="12" cy="9" r="3" /><path d="M6 19c1.2-2.4 3.2-3.5 6-3.5s4.8 1.1 6 3.5" /></svg>
            {zh ? "账户" : "Account"}
          </button>
        </nav>,
        document.body,
      )}
    </header>
  );
}

function PaperFloor() {
  const lang = useExchange((s) => s.lang);
  const pane = useExchange((s) => s.pane);
  const setPane = useExchange((s) => s.setPane);
  const c = copy[lang];
  const showChart = pane === "trade";
  return (
    <SideRail items={[
      ["trade", c.trade],
      ["book", c.book],
      ["holds", c.holds],
      ["die", c.die],
    ].map(([id, label]) => ({ key: id, label, on: pane === id, run: () => setPane(id as typeof pane) }))}>
    <div className="relative">
      <p className="pointer-events-none absolute top-16 right-4 z-10 hidden font-display text-3xl italic text-ink/15 lg:block">{lang === "zh" ? "练习 · 本地" : "Practice · local"}</p>
      {pane === "trade" ? (
      <div className="grid items-start gap-4 lg:grid-cols-12">
        <aside className="hidden lg:col-span-4 lg:block">
          <div className="lg:sticky lg:top-4">
            <DiePanel />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          <MarketBar />
          <div className={showChart ? "flex flex-col gap-4" : "hidden lg:flex lg:flex-col lg:gap-4"}>
            <TraceChart />
            <Tape />
          </div>
          <div className="hidden gap-4 lg:grid lg:grid-cols-2">
            <Ticket />
            <Book />
          </div>
          <div className="hidden lg:block">
            <Blotter />
          </div>
          <div className="lg:hidden">
            <MobilePane />
          </div>
        </div>
      </div>
      ) : <MobilePane />}
    </div>
    </SideRail>
  );
}

function ShopFloor({ shop, setShop }: { shop: ShopTab; setShop: (shop: ShopTab) => void }) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const lanes = [
    ["book", zh ? "TAPELIQUID 现货" : "TAPELIQUID spot"],
    ["gate", zh ? "TapeOut 晶体管合约" : "TapeOut contracts"],
    ["chips", zh ? "TapeOut 晶体管" : "TapeOut transistors"],
    ["circuits", zh ? "TapeOut 电路" : "TapeOut circuits"],
  ] as const;
  const pick = (id: ShopTab) => {
    setShop(id);
    const hash = id === "book" ? "book" : id;
    const url = `#${hash}`;
    if (window.location.hash !== url) window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  return (
    <div className="lg:grid lg:grid-cols-[8.5rem_minmax(0,1fr)] lg:items-start lg:gap-3">
      <nav className="mb-3 flex gap-4 overflow-x-auto lg:sticky lg:top-24 lg:mb-0 lg:flex lg:flex-col lg:gap-1">
        {lanes.map(([id, label]) => (
          <button key={id} type="button" onClick={() => pick(id)} className={`shrink-0 border-l-2 py-1.5 pl-2 text-left text-sm ${shop === id ? "border-ink font-medium" : "border-transparent text-ink/45"}`}>
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        <WorkshopRisk zh={zh} />
        {shop === "book" ? <TapeSpotDesk zh={zh} /> : null}
        {shop === "gate" ? <TransistorDesk /> : null}
        {shop === "chips" ? <OfficialDesk mode="chips" /> : null}
        {shop === "circuits" ? <OfficialDesk mode="circuits" /> : null}
      </div>
    </div>
  );
}

function MarketBar() {
  const lang = useExchange((s) => s.lang);
  const market = useExchange((s) => s.market);
  const setMarket = useExchange((s) => s.setMarket);
  const engine = useExchange((s) => s.engine);
  const c = copy[lang];
  const change = sessionChange(engine);
  const text = engine.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const [whole, frac = "00"] = text.split(".");
  return (
    <section className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setMarket("spot")}
          className={`min-h-14 border border-gold px-3 text-left ${market === "spot" ? "bg-foil" : "bg-card"}`}
        >
          <span className="block text-xs tracking-widest">{c.spotSub}</span>
          <span className="font-display text-2xl italic">{c.spot}</span>
        </button>
        <button
          type="button"
          onClick={() => setMarket("perp")}
          className={`min-h-14 border border-gold px-3 text-left ${market === "perp" ? "bg-foil" : "bg-card"}`}
        >
          <span className="block text-xs tracking-widest">
            {c.perpSub} · 20×
          </span>
          <span className="font-display text-2xl italic">{c.perp}</span>
        </button>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-gold">{c.mark}</p>
          <p className="font-mono leading-none tabular-nums text-ink">
            <span className="text-4xl">{whole}</span>
            <span className="text-lg">.{frac}</span>
          </p>
          <p className={`mt-1 font-mono text-sm tabular-nums ${change >= 0 ? "text-gold" : "text-sell"}`}>{fmtPct(change)}</p>
        </div>
        <div className="text-right font-mono text-xs tabular-nums">
          <p>
            {c.equity} {fmtUsd(equity(engine))}
          </p>
          <p className="mt-1">
            {c.funding} {fmtPct(engine.funding)}
          </p>
          <p className="mt-1 text-ink/60">{c.fundingHint}</p>
        </div>
      </div>
    </section>
  );
}

function Tape() {
  const prints = useExchange((s) => s.engine.prints);
  return (
    <div className="flex gap-4 overflow-hidden border border-gold/40 bg-card px-3 py-2">
      {prints.map((p) => (
        <span key={p.id} className={`shrink-0 font-mono text-xs tabular-nums ${p.side === "buy" ? "text-gold" : "text-sell"} ${p.mine ? "underline" : ""}`}>
          {fmtPx(p.price)}
        </span>
      ))}
    </div>
  );
}

function MobilePane() {
  const pane = useExchange((s) => s.pane);
  if (pane === "book") return <Book />;
  if (pane === "holds") return <Blotter />;
  if (pane === "die") return <DiePanel />;
  return <Ticket />;
}
