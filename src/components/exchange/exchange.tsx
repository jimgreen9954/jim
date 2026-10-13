import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { copy } from "@/lib/copy";
import { startPersistence, useExchange } from "@/lib/exchange-store";
import { fmtPct, fmtPx, fmtUsd } from "@/lib/format";
import { equity, sessionChange } from "@/lib/match-engine";
import { Blotter } from "@/components/exchange/blotter";
import { Book } from "@/components/exchange/book";
import { TraceChart } from "@/components/exchange/chart";
import { DiePanel } from "@/components/exchange/die";
import { Ticket } from "@/components/exchange/ticket";
import { OfficialDesk } from "@/components/exchange/official-desk";
import { RealPerp } from "@/components/exchange/real-perp";
import { SpotDesk } from "@/components/exchange/spot-desk";
import { TransistorDesk } from "@/components/exchange/transistor-desk";
import { TapeCanvas } from "@/components/exchange/tape-canvas";
import { ConnectButton } from "@/components/exchange/wallet-bar";
import { AccountCenter } from "@/components/exchange/account-center";
import { TapeSpotDesk } from "@/components/exchange/tape-spot";
import { WorkshopRisk } from "@/components/exchange/risk-calc";
import { MineDesk } from "@/components/exchange/mine-desk";
import { Whitepaper } from "@/components/exchange/whitepaper";
import { SideRail } from "@/components/exchange/side-rail";
import { bemPrice } from "@/lib/bsc";
import { FeeLockProvider, useFeeLock } from "@/lib/fee-lock";
import { currentAccount, onAccount } from "@/lib/wallet";
import { CLAIM_STEPS, bindCode, claimRebate, codeText, readRebate, registerCode, type Desk } from "@/lib/perp";
import { formatUnits } from "viem";

type Floor = "desk" | "paper" | "shop" | "rules" | "canvas" | "me" | "mine";
type DeskTab = "spot" | "perp";
type ShopTab = "gate" | "chips" | "circuits" | "book";

export function Exchange({ start = "spot" }: { start?: "spot" | "paper" | "perp" | "gate" | "wafer" | "brief" }) {
  const [floor, setFloor] = useState<Floor>(start === "paper" ? "paper" : start === "gate" || start === "wafer" ? "shop" : start === "brief" ? "rules" : "desk");
  const [desk, setDesk] = useState<DeskTab>(start === "perp" ? "perp" : "spot");
  const [shop, setShop] = useState<ShopTab>(start === "gate" ? "gate" : "book");
  const [giftOpen, setGiftOpen] = useState(false);
  useEffect(() => {
    const apply = () => {
      const named = window.location.hash.replace(/^#/, "");
      if (named === "spot") { setFloor("desk"); setDesk("spot"); }
      if (named === "perp") { setFloor("desk"); setDesk("perp"); }
      if (named === "paper") setFloor("paper");
      if (named === "gate" || named.startsWith("gate=")) { setFloor("shop"); setShop("gate"); }
      if (named === "wafer" || named === "book" || named === "nand") { setFloor("shop"); setShop("book"); }
      if (named === "chips") { setFloor("shop"); setShop("chips"); }
      if (named === "circuits") { setFloor("shop"); setShop("circuits"); }
      if (named === "canvas") setFloor("canvas");
      if (named === "mine") setFloor("mine");
      if (named === "me" || named === "gift") setFloor("me");
      if (named === "gift") setGiftOpen(true);
      if (named === "brief" || named === "rules") setFloor("rules");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  return (
    <FeeLockProvider>
      <div className="min-h-screen overflow-x-hidden bg-paper text-ink">
        <Crops />
        <SimClock />
        <BannerToast />
        <FuseFlash />
        <div className={`mx-auto flex max-w-7xl flex-col gap-3 px-3 pt-2 sm:px-4 lg:gap-4 lg:px-6 ${floor === "paper" ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10" : "pb-[max(1.5rem,env(safe-area-inset-bottom))]"}`}>
          <Header floor={floor} desk={desk} shop={shop} setFloor={setFloor} setDesk={setDesk} setShop={setShop} setGiftOpen={setGiftOpen} />
          <FeeStrip />
          {floor === "desk" && desk === "spot" ? <SpotDesk /> : null}
          {floor === "desk" && desk === "perp" ? <RealPerp /> : null}
          {floor === "paper" ? <PaperFloor /> : null}
          {floor === "shop" ? <ShopFloor shop={shop} setShop={setShop} /> : null}
          {floor === "canvas" ? <TapeCanvas /> : null}
          {floor === "mine" ? <MineDesk /> : null}
          {floor === "me" ? <AccountCenter giftOpen={giftOpen} /> : null}
          {floor === "rules" ? <Whitepaper /> : null}
        </div>
        <footer className="mx-auto flex w-full max-w-7xl items-center gap-4 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-xs text-ink/55 sm:px-4 lg:px-6">
          <a href="https://t.me/+RWVnnxXf1LY1MWVh" target="_blank" rel="noreferrer" className="underline">Telegram</a>
          <a href="https://x.com/Icp_chinese" target="_blank" rel="noreferrer" className="underline">X</a>
        </footer>
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
    const stop = startPersistence();
    const id = window.setInterval(() => tick(400), 400);
    let dead = false;
    let pending = false;
    const pull = () => {
      if (pending || document.hidden) return;
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
    const priceId = window.setInterval(pull, 8000);
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

function inviteHref(code: string): string {
  if (typeof window === "undefined") return `#ref=${encodeURIComponent(code)}`;
  return `${window.location.origin}${window.location.pathname}#ref=${encodeURIComponent(code)}`;
}

function InviteDock() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<Desk>("xlayer");
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [code, setCode] = useState("");
  const [mine, setMine] = useState("");
  const [friend, setFriend] = useState("");
  const [referrer, setReferrer] = useState("");
  const [accrued, setAccrued] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && (dock.current?.contains(node) || panel.current?.contains(node))) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const fromHash = hash.startsWith("ref=") ? decodeURIComponent(hash.slice(4)) : "";
    const fromQuery = new URLSearchParams(window.location.search).get("ref") ?? "";
    const ref = (fromHash || fromQuery).trim().slice(0, 16);
    if (ref) {
      setFriend(ref);
      setOpen(true);
    }
  }, []);
  useEffect(() => {
    if (!account) return;
    let dead = false;
    const dec = chain === "xlayer" ? 6 : 18;
    readRebate(chain, account)
      .then((row) => {
        if (dead) return;
        setCode(codeText(row.code));
        setReferrer(row.referrer);
        setAccrued(Number(formatUnits(row.accrued, dec)));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [account, chain, open, note]);
  const run = (job: (from: string) => Promise<unknown>, ok: string) => {
    const from = account ?? currentAccount();
    if (!from) {
      setNote(zh ? "先连接钱包。" : "Connect a wallet first.");
      return;
    }
    setBusy(true);
    job(from)
      .then(() => setNote(ok))
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : "";
        setNote(/taken/i.test(text) ? (zh ? "这个码已经有人用了。" : "That code is taken.") : /have/i.test(text) ? (zh ? "这个地址已经有码，不能改。" : "This address already has a code.") : zh ? "没有写上。" : "It was not written.");
      })
      .finally(() => setBusy(false));
  };
  const unit = chain === "xlayer" ? "USDT0" : "USDT";
  return (
    <div className="relative" ref={dock}>
      <button type="button" className={`min-h-9 px-2 text-xs ${open ? "bg-ink text-paper" : "text-ink/80"}`} onClick={() => setOpen((on) => !on)}>
        {zh ? "邀请" : "Invite"}
      </button>
      {open ? createPortal(
          <div ref={panel} className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[80] max-h-[min(32rem,calc(100dvh-5rem))] overflow-y-auto border border-gold bg-paper p-3 text-sm shadow-plate sm:inset-x-auto sm:right-3 sm:w-[22rem]">
          <div className="grid grid-cols-2 border border-gold">
            <button type="button" className={`min-h-9 ${chain === "xlayer" ? "bg-ink text-paper" : ""}`} onClick={() => setChain("xlayer")}>X Layer</button>
            <button type="button" className={`min-h-9 ${chain === "bsc" ? "bg-ink text-paper" : ""}`} onClick={() => setChain("bsc")}>BSC</button>
          </div>
          <p className="mt-2 text-xs leading-5 text-ink/60">{zh ? "确认自己的码之后不能改。朋友打开链接，核对，再点绑定。两条链各算各的。" : "A code cannot be changed. A friend opens the link, checks it, then binds. The two chains are separate."}</p>
          {code ? (
            <div className="mt-2">
              <p className="font-mono">{code}</p>
              <input readOnly value={inviteHref(code)} className="mt-2 w-full border border-gold bg-transparent px-2 py-2 font-mono text-xs" />
              <button type="button" className="mt-2 min-h-9 border border-gold px-3 text-xs" onClick={() => {
                const link = inviteHref(code);
                navigator.clipboard.writeText(link).then(() => setNote(zh ? "链接已复制。" : "Link copied.")).catch(() => setNote(link));
              }}>{zh ? "复制邀请链接" : "Copy invite link"}</button>
            </div>
          ) : (
            <div className="mt-2 flex gap-2">
              <input value={mine} onChange={(event) => setMine(event.target.value)} placeholder={zh ? "我的邀请码" : "My code"} className="min-h-10 min-w-0 flex-1 border border-gold bg-transparent px-2" />
              <button type="button" disabled={busy} className="min-h-10 border border-gold px-3 text-xs disabled:opacity-40" onClick={() => run((from) => registerCode(from, chain, mine), zh ? "码已写上。链接在上面。" : "Code written. The link is above.")}>{zh ? "确认" : "Confirm"}</button>
            </div>
          )}
          {referrer && referrer !== "0x0000000000000000000000000000000000000000" ? (
            <p className="mt-2 font-mono text-xs">{referrer.slice(0, 6)}…{referrer.slice(-4)}</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <input value={friend} onChange={(event) => setFriend(event.target.value)} placeholder={zh ? "朋友的码" : "Their code"} className="min-h-10 min-w-0 flex-1 border border-gold bg-transparent px-2" />
              <button type="button" disabled={busy} className="min-h-10 border border-gold px-3 text-xs disabled:opacity-40" onClick={() => run((from) => bindCode(from, chain, friend), zh ? "已绑定。" : "Bound.")}>{zh ? "绑定" : "Bind"}</button>
            </div>
          )}
          <p className="mt-2 font-mono text-xs">{zh ? "可提" : "Claimable"} {accrued.toFixed(2)} {unit}</p>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {CLAIM_STEPS.map((step) => (
              <button key={step} type="button" disabled={busy || accrued + 1e-9 < step} className="min-h-8 border border-gold font-mono text-xs disabled:opacity-40" onClick={() => run((from) => claimRebate(from, chain, step), zh ? `已提 ${step}。` : `Claimed ${step}.`)}>{step}</button>
            ))}
          </div>
          {note ? <p className="mt-2 text-xs leading-5">{note}</p> : null}
          </div>,
          document.body,
      ) : null}
    </div>
  );
}

function Header({ floor, desk, shop, setFloor, setDesk, setShop, setGiftOpen }: { floor: Floor; desk: DeskTab; shop: ShopTab; setFloor: (floor: Floor) => void; setDesk: (desk: DeskTab) => void; setShop: (shop: ShopTab) => void; setGiftOpen: (open: boolean) => void }) {
  const lang = useExchange((s) => s.lang);
  const setLang = useExchange((s) => s.setLang);
  const reset = useExchange((s) => s.reset);
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
  const go = (next: Floor, hash: string) => {
    if (window.location.pathname.startsWith("/whitepaper")) {
      window.location.assign(next === "rules" ? "/whitepaper" : `/#${hash}`);
      return;
    }
    if (next === "rules") window.history.replaceState(null, "", "#rules");
    setFloor(next);
  };
  const nav = [
    [lang === "zh" ? "现货" : "Spot", floor === "desk" && desk === "spot", () => { setDesk("spot"); go("desk", "spot"); }],
    [lang === "zh" ? "永续" : "Perp", floor === "desk" && desk === "perp", () => { setDesk("perp"); go("desk", "perp"); }],
    ["TAPELIQUID", floor === "shop" && shop === "book", () => { setShop("book"); go("shop", "book"); }],
    ["TapeOut", floor === "shop" && shop !== "book", () => { setShop(shop === "book" ? "gate" : shop); go("shop", shop === "chips" ? "chips" : shop === "circuits" ? "circuits" : "gate"); }],
    [lang === "zh" ? "挖矿" : "Mine", floor === "mine", () => go("mine", "mine")],
    [lang === "zh" ? "流片" : "Tape-out", floor === "canvas", () => go("canvas", "canvas")],
    [lang === "zh" ? "规则" : "Rules", floor === "rules", () => go("rules", "rules")],
    [lang === "zh" ? "练习" : "Practice", floor === "paper", () => go("paper", "paper")],
  ] as const;
  return (
    <header className="sticky top-0 z-20 -mx-3 border-b border-gold/40 bg-paper/95 px-3 py-2 backdrop-blur-sm sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6 pt-[max(0.35rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => go("desk", "spot")} className="flex shrink-0 items-center gap-2">
          <img src="/mark.jpg" alt="" className="size-7 border border-gold bg-foil object-cover" />
          <span className="hidden font-display text-lg italic leading-none sm:inline">TAPELIQUID</span>
        </button>
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
          {nav.map(([label, on, run]) => (
            <button key={label} type="button" onClick={run} className={`shrink-0 border-b-2 px-2.5 py-2 text-sm ${on ? "border-ink font-medium text-ink" : "border-transparent text-ink/60"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ConnectButton />
          <InviteDock />
          <button type="button" className={`hidden min-h-9 px-2 text-xs sm:inline ${floor === "me" ? "bg-ink text-paper" : ""}`} onClick={() => { setGiftOpen(false); go("me", "me"); }}>
            {lang === "zh" ? "资产" : "Assets"}
          </button>
          <button type="button" className="min-h-9 px-1.5 text-xs text-ink/70 sm:hidden" onClick={() => { setGiftOpen(false); go("me", "me"); }}>
            {lang === "zh" ? "资产" : "Assets"}
          </button>
          <button type="button" aria-label={night ? (lang === "zh" ? "白天" : "Day") : lang === "zh" ? "黑夜" : "Night"} className="inline-flex size-9 items-center justify-center text-ink" onClick={() => setNight((on) => !on)}>
            {night ? (
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3.5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" /></svg>
            )}
          </button>
          <button type="button" className="hidden min-h-9 px-1.5 text-xs sm:inline" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang === "zh" ? "EN" : "中文"}
          </button>
          {floor === "paper" ? (
            <button
              type="button"
              className={`min-h-9 px-1.5 text-xs ${arm ? "text-sell" : ""}`}
              onClick={() => {
                if (!arm) setArm(true);
                else {
                  reset();
                  setArm(false);
                }
              }}
            >
              {arm ? (lang === "zh" ? "再点一次" : "Tap again") : lang === "zh" ? "清除" : "Clear"}
            </button>
          ) : null}
        </div>
      </div>
      <nav className="mt-1 flex items-center gap-0.5 overflow-x-auto lg:hidden">
        {nav.map(([label, on, run]) => (
          <button key={`m-${label}`} type="button" onClick={run} className={`shrink-0 border-b-2 px-2.5 py-2 text-sm ${on ? "border-ink font-medium text-ink" : "border-transparent text-ink/60"}`}>
            {label}
          </button>
        ))}
        <button type="button" className="shrink-0 px-2 py-2 text-xs sm:hidden" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>{lang === "zh" ? "EN" : "中文"}</button>
      </nav>
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
      <p className="text-sm text-ink/70">{lang === "zh" ? "余额是练习金。清除只动这台浏览器，不动合约。" : "The balance is practice cash. Clear only wipes this browser, not a contract."}</p>
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
  if (shop === "book") {
    return (
      <>
        <WorkshopRisk zh={zh} />
        <TapeSpotDesk zh={zh} />
      </>
    );
  }
  const lanes = [
    ["gate", zh ? "晶体管合约" : "Contracts"],
    ["chips", zh ? "晶体管" : "Transistors"],
    ["circuits", zh ? "电路" : "Circuits"],
  ] as const;
  return (
    <div className="lg:grid lg:grid-cols-[7.25rem_minmax(0,1fr)] lg:items-start lg:gap-3">
      <nav className="mb-3 flex gap-4 overflow-x-auto lg:sticky lg:top-16 lg:mb-0 lg:flex lg:flex-col lg:gap-1">
        {lanes.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setShop(id)} className={`shrink-0 border-l-2 py-1.5 pl-2 text-left text-sm ${shop === id ? "border-ink font-medium" : "border-transparent text-ink/45"}`}>
            {label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        <WorkshopRisk zh={zh} />
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
