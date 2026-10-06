import { useEffect, useState } from "react";
import { copy } from "@/lib/copy";
import { startPersistence, useExchange } from "@/lib/exchange-store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/format";
import { equity, sessionChange } from "@/lib/match-engine";
import { Blotter } from "@/components/exchange/blotter";
import { Book } from "@/components/exchange/book";
import { TraceChart } from "@/components/exchange/chart";
import { DiePanel } from "@/components/exchange/die";
import { Ticket } from "@/components/exchange/ticket";
import { LiveBoard } from "@/components/exchange/live-board";
import { RealPerp } from "@/components/exchange/real-perp";
import { SpotDesk } from "@/components/exchange/spot-desk";
import { TransistorDesk } from "@/components/exchange/transistor-desk";
import { WalletBar } from "@/components/exchange/wallet-bar";
import { SealRebateBox } from "@/components/exchange/seal-rebate";
import { Whitepaper } from "@/components/exchange/whitepaper";
import { bemPrice } from "@/lib/bsc";
import { FeeLockProvider, useFeeLock } from "@/lib/fee-lock";

type Floor = "desk" | "paper" | "shop" | "rules";
type DeskTab = "spot" | "perp";
type ShopTab = "gate" | "wafer";

export function Exchange({ start = "spot" }: { start?: "spot" | "paper" | "perp" | "gate" | "wafer" | "brief" }) {
  const [floor, setFloor] = useState<Floor>(start === "paper" ? "paper" : start === "gate" || start === "wafer" ? "shop" : start === "brief" ? "rules" : "desk");
  const [desk, setDesk] = useState<DeskTab>(start === "perp" ? "perp" : "spot");
  const [shop, setShop] = useState<ShopTab>(start === "wafer" ? "wafer" : "gate");
  useEffect(() => {
    const named = window.location.hash.replace(/^#/, "");
    if (named === "spot") { setFloor("desk"); setDesk("spot"); }
    if (named === "perp") { setFloor("desk"); setDesk("perp"); }
    if (named === "paper") setFloor("paper");
    if (named === "gate" || named.startsWith("gate=")) { setFloor("shop"); setShop("gate"); }
    if (named === "wafer") { setFloor("shop"); setShop("wafer"); }
    if (named === "brief" || named === "rules") setFloor("rules");
  }, []);
  return (
    <FeeLockProvider>
      <div className="min-h-screen overflow-x-hidden bg-paper text-ink">
        <Crops />
        <SimClock />
        <BannerToast />
        <FuseFlash />
        <div className={`mx-auto flex max-w-6xl flex-col gap-4 px-3 pt-2 lg:px-6 ${floor === "paper" ? "pb-24 lg:pb-10" : "pb-8"}`}>
          <Header floor={floor} desk={desk} setFloor={setFloor} setDesk={setDesk} setShop={setShop} />
          <FeeStrip />
          {floor === "desk" && desk === "spot" ? <SpotDesk /> : null}
          {floor === "desk" && desk === "perp" ? <RealPerp /> : null}
          {floor === "paper" ? <PaperFloor /> : null}
          {floor === "shop" ? <ShopFloor shop={shop} setShop={setShop} /> : null}
          {floor === "rules" ? <Whitepaper /> : null}
        </div>
        {floor === "paper" ? <MobileNav /> : null}
      </div>
    </FeeLockProvider>
  );
}

function FeeStrip() {
  const lang = useExchange((s) => s.lang);
  const lock = useFeeLock();
  if (lock.status === "checking") {
    return <p className="text-xs text-ink/60">{lang === "zh" ? "正在对三份合约的收费地址。" : "Checking the fee address on the three contracts."}</p>;
  }
  if (lock.status === "bad") {
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
  return (
    <p className="text-xs text-ink/60">{lang === "zh" ? "台费地址已核对" : "Fee address checked"}</p>
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
    const stop = startPersistence();
    const id = window.setInterval(() => tick(400), 400);
    let dead = false;
    let pending = false;
    const pull = () => {
      if (pending) return;
      pending = true;
      bemPrice()
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
    const priceId = window.setInterval(pull, 1000);
    return () => {
      dead = true;
      window.clearInterval(id);
      window.clearInterval(priceId);
      stop();
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
    <p className="fixed inset-x-3 top-4 z-50 mx-auto max-w-md border border-gold bg-card px-3 py-2 text-center text-sm shadow-plate">
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

function Header({ floor, desk, setFloor, setDesk, setShop }: { floor: Floor; desk: DeskTab; setFloor: (floor: Floor) => void; setDesk: (desk: DeskTab) => void; setShop: (shop: ShopTab) => void }) {
  const lang = useExchange((s) => s.lang);
  const setLang = useExchange((s) => s.setLang);
  const reset = useExchange((s) => s.reset);
  const c = copy[lang];
  const [arm, setArm] = useState(false);
  const [night, setNight] = useState(false);
  const [nightReady, setNightReady] = useState(false);
  useEffect(() => {
    const on = window.localStorage.getItem("tapeliquid-night") === "1";
    setNight(on);
    document.documentElement.classList.toggle("night", on);
    setNightReady(true);
  }, []);
  useEffect(() => {
    if (!nightReady) return;
    document.documentElement.classList.toggle("night", night);
    window.localStorage.setItem("tapeliquid-night", night ? "1" : "0");
  }, [night, nightReady]);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh" : "en";
  }, [lang]);
  useEffect(() => {
    if (!arm) return;
    const id = window.setTimeout(() => setArm(false), 2800);
    return () => window.clearTimeout(id);
  }, [arm]);
  const floors = [
    ["desk", lang === "zh" ? "交易台" : "Desk"],
    ["paper", lang === "zh" ? "练习" : "Practice"],
    ["shop", lang === "zh" ? "工房" : "Workshop"],
    ["rules", lang === "zh" ? "规则" : "Rules"],
  ] as const;
  const line = floor === "paper"
    ? lang === "zh" ? "不进实盘成交" : "Not a live fill"
    : floor === "desk" && desk === "perp"
      ? lang === "zh" ? "同一份合约里互相成交" : "Fills only inside this contract"
      : floor === "desk"
        ? lang === "zh" ? "钱包里真买卖" : "Real trades in the wallet"
        : "";
  const go = (next: Floor) => {
    if (window.location.pathname.startsWith("/whitepaper")) {
      window.location.assign(next === "rules" ? "/whitepaper" : `/#${next === "desk" ? desk : next === "shop" ? "gate" : "paper"}`);
      return;
    }
    if (next === "rules") window.location.assign("/whitepaper");
    else setFloor(next);
  };
  return (
    <header className="sticky top-0 z-20 -mx-3 flex flex-col gap-3 bg-paper/95 px-3 py-3 backdrop-blur-sm lg:-mx-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/mark.jpg" alt="" className="size-14 shrink-0 border border-gold bg-[#14110d] object-cover" />
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl italic tracking-wide sm:text-2xl">TAPELIQUID</h1>
            <p className="truncate text-xs tracking-widest text-gold">{c.kicker}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="min-h-9 border border-gold px-2 text-xs" onClick={() => setNight((on) => !on)}>
            {night ? (lang === "zh" ? "白天" : "Day") : lang === "zh" ? "黑夜" : "Night"}
          </button>
          <button type="button" className="min-h-9 border border-gold px-2 text-xs" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang === "zh" ? "EN" : "中文"}
          </button>
          {floor === "paper" ? (
            <button
              type="button"
              className={`min-h-9 border px-2 text-xs ${arm ? "border-sell text-sell" : "border-gold"}`}
              onClick={() => {
                if (!arm) setArm(true);
                else {
                  reset();
                  setArm(false);
                }
              }}
            >
              {arm ? (lang === "zh" ? "再点一次" : "Tap again") : lang === "zh" ? "只清除本机练习记录，不动合约" : "Clears this browser only"}
            </button>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          if (window.location.pathname.startsWith("/whitepaper")) {
            window.location.assign("/#wafer");
            return;
          }
          setFloor("shop");
          setShop("wafer");
        }}
        className="flex min-h-14 items-center justify-between border border-gold bg-ink px-4 text-paper"
      >
        <span>
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "现在去铸造" : "Mint now"}</span>
          <span className="font-display text-2xl italic">{lang === "zh" ? "晶圆 · 16 颗 NAND" : "Wafer · 16 NAND"}</span>
        </span>
        <span className="text-sm">{lang === "zh" ? "去铸造" : "Mint"}</span>
      </button>
      <div className="grid grid-cols-4 border border-gold">
        {floors.map(([id, label]) => (
          <button key={id} type="button" onClick={() => go(id)} className={`min-h-11 text-sm ${floor === id ? "bg-ink text-paper" : "bg-card"}`}>
            {label}
          </button>
        ))}
      </div>
      {floor === "desk" ? (
        <div className="grid grid-cols-2 border border-gold">
          {(["spot", "perp"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setDesk(id)} className={`min-h-10 text-sm ${desk === id ? "bg-ink text-paper" : ""}`}>
              {id === "spot" ? (lang === "zh" ? "现货" : "Spot") : lang === "zh" ? "永续" : "Perp"}
            </button>
          ))}
        </div>
      ) : null}
      {line ? <p className="text-sm text-ink/70">{line}</p> : null}
    </header>
  );
}

function PaperFloor() {
  const lang = useExchange((s) => s.lang);
  return (
    <div className="relative">
      <p className="pointer-events-none absolute top-16 right-4 z-10 font-display text-3xl italic text-ink/15">{lang === "zh" ? "练习 · 本地" : "Practice · local"}</p>
      <p className="text-sm text-ink/70">{lang === "zh" ? "不进实盘成交。余额是练习金。" : "Not a live fill. The balance is practice cash."}</p>
      <div className="grid items-start gap-4 lg:grid-cols-12">
        <aside className="hidden lg:col-span-4 lg:block">
          <div className="lg:sticky lg:top-4">
            <DiePanel />
          </div>
        </aside>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          <MarketBar />
          <TraceChart />
          <Tape />
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
    </div>
  );
}

function ShopFloor({ shop, setShop }: { shop: ShopTab; setShop: (shop: ShopTab) => void }) {
  const lang = useExchange((s) => s.lang);
  return (
    <>
      <p className="text-sm text-ink/80">{lang === "zh" ? "先铸造 NAND，再流片。流片烧掉晶体管，不能撤回。" : "Mint NAND, then tape out. A tape-out burns transistors and cannot be undone."}</p>
      <div className="grid grid-cols-2 border border-gold">
        {(["gate", "wafer"] as const).map((id) => (
          <button key={id} type="button" onClick={() => setShop(id)} className={`min-h-10 text-sm ${shop === id ? "bg-ink text-paper" : ""}`}>
            {id === "gate" ? (lang === "zh" ? "晶体管" : "Transistors") : lang === "zh" ? "晶圆" : "Wafer"}
          </button>
        ))}
      </div>
      {shop === "gate" ? <TransistorDesk /> : (
        <>
          <WalletBar />
          <LiveBoard />
          <SealRebateBox />
        </>
      )}
    </>
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

function MobileNav() {
  const pane = useExchange((s) => s.pane);
  const setPane = useExchange((s) => s.setPane);
  const lang = useExchange((s) => s.lang);
  const pos = useExchange((s) => s.engine.position);
  const c = copy[lang];
  const items = [
    ["trade", c.trade],
    ["book", c.book],
    ["holds", c.holds],
    ["die", c.die],
  ] as const;
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-gold bg-paper lg:hidden">
      {items.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setPane(id)}
          className={`relative min-h-12 text-sm ${pane === id ? "bg-foil text-ink" : "text-ink"}`}
        >
          {label}
          {id === "holds" && pos && pos.size !== 0 ? <span className="absolute top-2 right-5 size-2 bg-sell" /> : null}
        </button>
      ))}
    </nav>
  );
}
