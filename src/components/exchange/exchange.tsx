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
import { TapePoolDesk, TapeBridgePage } from "@/components/exchange/tape-pool-desk";
import { MineDesk, TapeNetLine } from "@/components/exchange/mine-desk";
import { Whitepaper } from "@/components/exchange/whitepaper";
import { SideRail } from "@/components/exchange/side-rail";
import { poolMark } from "@/lib/bsc";
import { getDeskQuotes, type DeskQuote } from "@/lib/candles";
import { FeeLockProvider, useFeeLock } from "@/lib/fee-lock";
import { currentAccount, onAccount } from "@/lib/wallet";
import { CLAIM_STEPS, bindCode, claimRebate, codeText, readRebate, registerCode, type Desk } from "@/lib/perp";
import { FeeBook } from "@/components/exchange/fee-book";
import { formatUnits } from "viem";

type Floor = "desk" | "paper" | "asset" | "tape" | "bridge" | "mine" | "rules" | "canvas" | "me";
type DeskTab = "spot" | "perp";
type Chain = "bsc" | "x";
type AssetKind = "chip" | "circuit" | "box" | "perp" | "bem";
type TapeTab = "trade" | "otc" | "stake" | "ash" | "bid";

export function Exchange({ start = "spot" }: { start?: "spot" | "paper" | "perp" | "gate" | "wafer" | "brief" }) {
  const [floor, setFloor] = useState<Floor>(start === "paper" ? "paper" : start === "gate" ? "asset" : start === "brief" ? "rules" : start === "perp" ? "desk" : "tape");
  const [desk, setDesk] = useState<DeskTab>(start === "perp" ? "perp" : "spot");
  const [chain, setChain] = useState<Chain>(start === "gate" ? "bsc" : "x");
  const [kind, setKind] = useState<AssetKind>(start === "gate" ? "perp" : "chip");
  const [tapeTab, setTapeTab] = useState<TapeTab>("trade");
  const [giftOpen, setGiftOpen] = useState(false);
  const { night, setNight } = useNight();
  useEffect(() => {
    const apply = () => {
      const named = window.location.hash.replace(/^#/, "");
      if (named === "spot") { setFloor("desk"); setDesk("spot"); }
      if (named === "tapetrade" || named === "tape" || named === "wafer") { setFloor("tape"); setTapeTab("trade"); }
      if (named === "book") { setFloor("tape"); setTapeTab("otc"); }
      if (named === "bridge") setFloor("bridge");
      if (named === "perp") { setFloor("desk"); setDesk("perp"); }
      if (named === "paper") setFloor("paper");
      if (named === "mine" || named === "claim") setFloor("mine");
      if (named === "stake") { setFloor("tape"); setTapeTab("stake"); }
      if (named === "nand") { setFloor("asset"); setChain("x"); setKind("chip"); }
      if (named === "xcircuit") { setFloor("asset"); setChain("x"); setKind("circuit"); }
      if (named === "box") { setFloor("asset"); setChain("x"); setKind("box"); }
      if (named === "gate" || named.startsWith("gate=")) { setFloor("asset"); setChain("bsc"); setKind("perp"); }
      if (named === "chips") { setFloor("asset"); setChain("bsc"); setKind("chip"); }
      if (named === "circuits") { setFloor("asset"); setChain("bsc"); setKind("circuit"); }
      if (named === "canvas") setFloor("canvas");
      if (named === "me" || named === "gift") setFloor("me");
      if (named === "gift") setGiftOpen(true);
      if (named === "brief" || named === "rules") setFloor("rules");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);
  const fit = (floor === "tape" && tapeTab === "otc") || (floor === "asset" && chain === "x" && kind === "chip");
  return (
    <FeeLockProvider>
      <div className="min-h-screen overflow-x-hidden bg-paper text-ink">
        <Crops />
        <SimClock />
        <BannerToast />
        <FuseFlash />
        <div className={`mx-auto flex w-full flex-col gap-2 px-2 pt-2 sm:px-3 lg:px-4 ${fit ? "min-h-screen pb-40 lg:h-dvh lg:overflow-hidden lg:pb-11" : "min-h-screen pb-24 lg:pb-12"}`}>
          <Header floor={floor} desk={desk} night={night} setNight={setNight} setFloor={setFloor} setDesk={setDesk} setTapeTab={setTapeTab} setGiftOpen={setGiftOpen} />
          <FeeStrip />
          <div className={`flex min-h-0 flex-col lg:flex-1 ${fit ? "lg:overflow-hidden" : ""}`}>
          {floor === "desk" && desk === "spot" ? <SpotDesk /> : null}
          {floor === "desk" && desk === "perp" ? <RealPerp /> : null}
          {floor === "paper" ? <PaperFloor /> : null}
          {floor === "tape" ? <TapeFloor tab={tapeTab} setTab={setTapeTab} /> : null}
          {floor === "bridge" ? <TapeBridgePage /> : null}
          {floor === "mine" ? <MineDesk lock="claim" /> : null}
          {floor === "asset" ? <AssetFloor chain={chain} kind={kind} setChain={setChain} setKind={setKind} /> : null}
          {floor === "canvas" ? <TapeCanvas /> : null}
          {floor === "me" ? <AccountCenter giftOpen={giftOpen} /> : null}
          {floor === "rules" ? <Whitepaper /> : null}
          </div>
        </div>
        <TerminalBar />
        <MobileBar floor={floor} desk={desk} chain={chain} kind={kind} night={night} setNight={setNight} setFloor={setFloor} setDesk={setDesk} setTapeTab={setTapeTab} setChain={setChain} setKind={setKind} setGiftOpen={setGiftOpen} />
      </div>
    </FeeLockProvider>
  );
}

function useNight() {
  const [night, setNight] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const on = window.localStorage.getItem("tapeliquid-night") === "1";
    setNight(on);
    document.documentElement.classList.toggle("night", on);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle("night", night);
    window.localStorage.setItem("tapeliquid-night", night ? "1" : "0");
  }, [night, ready]);
  return { night, setNight };
}

function TerminalBar() {
  const lang = useExchange((s) => s.lang);
  const setLang = useExchange((s) => s.setLang);
  const zh = lang === "zh";
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 hidden h-11 items-center gap-3 overflow-x-auto border-t border-gold/60 bg-paper/95 px-3 text-[12px] text-ink/80 backdrop-blur-sm lg:flex">
      <a href="#rules" className="shrink-0 underline decoration-gold underline-offset-4">{zh ? "使用指南" : "Guide"}</a>
      <a href="https://x.com/Icp_chinese" target="_blank" rel="noreferrer" className="shrink-0 underline decoration-gold underline-offset-4">X</a>
      <a href="https://t.me/+RWVnnxXf1LY1MWVh" target="_blank" rel="noreferrer" className="shrink-0 underline decoration-gold underline-offset-4">Telegram</a>
      <a href="https://github.com/jimgreen9954/jim" target="_blank" rel="noreferrer" className="shrink-0 underline decoration-gold underline-offset-4">GitHub</a>
      <a href="#rules" className="shrink-0 underline decoration-gold underline-offset-4">{zh ? "白皮书" : "Paper"}</a>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button type="button" className="min-h-8 px-1.5" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>{zh ? "EN" : "中文"}</button>
      </span>
    </footer>
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
      poolMark("bem")
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
  const unit = chain === "xlayer" ? "USDT" : "USDT";
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
          <p className="mt-2 text-xs leading-5 text-ink/70">{zh ? "本站手续费是付出金额的千分之二。没绑邀请人，整笔进收费地址。绑了之后，这笔手续费的 6% 付给邀请人，4% 少收交易的人，90% 进收费地址。永续、现货（含 X Layer 的 BEM、BSC 的比特币、ETH、ZEC）、加池、官方晶体管和官方电路都按这个比例。永续的 6% 记在合约里。其余是付款时拆开转。工房订单簿和 TAPE 池，千分之二整笔进收费地址，这两份已经部署的合约没有邀请人字段。电路容器的开通费是协议自己的：BSC 付 BNB，X Layer 付 0.08 OKB，不走这笔台费。" : "The site fee is 0.2% of the amount paid. With no referrer, all of it goes to the fee address. With one, 6% of that fee is paid to the referrer, the trader pays 4% less, and 90% goes to the fee address. That split covers perpetuals, spot including X Layer BEM, BSC bitcoin, ETH and ZEC, liquidity, official transistors, and official circuits. Perpetuals record the 6% on the contract. The workshop book and the TAPE pools send their 0.2% entirely to the fee address. Those deployed contracts have no referrer. A circuit container's open fee belongs to the protocol: BSC pays BNB, X Layer pays 0.08 OKB, and it is not this fee."}</p>
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

function LiveQuotes() {
  const setChainBem = useExchange((s) => s.setChainBem);
  const chainBem = useExchange((s) => s.chainBem);
  const [rows, setRows] = useState<DeskQuote[]>([]);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      getDeskQuotes()
        .then((next) => {
          if (dead) return;
          setRows(next);
          const bem = next.find((row) => row.id === "bem");
          if (bem && bem.px > 0) setChainBem(bem.px);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [setChainBem]);
  const name = { bem: "BEM", btc: "BTC", eth: "ETH", zec: "ZEC", bnb: "BNB" } as const;
  const shown = rows.length > 0 ? rows : chainBem && chainBem > 0 ? [{ id: "bem" as const, px: chainBem, chg: null }] : [];
  return (
    <>
      {shown.map((row) => {
        const digits = row.px >= 1000 ? 0 : 2;
        const text = row.px.toLocaleString("en-US", { minimumFractionDigits: digits === 0 ? 0 : 2, maximumFractionDigits: digits });
        return (
          <span key={row.id} className="shrink-0 font-mono tabular-nums">
            {name[row.id]} {text}
            {row.chg == null ? null : <span className={row.chg >= 0 ? " text-gold" : " text-sell"}>{row.chg >= 0 ? " +" : " "}{row.chg.toFixed(2)}%</span>}
          </span>
        );
      })}
    </>
  );
}

function Header({ floor, desk, night, setNight, setFloor, setDesk, setTapeTab, setGiftOpen }: { floor: Floor; desk: DeskTab; night: boolean; setNight: (next: boolean | ((on: boolean) => boolean)) => void; setFloor: (floor: Floor) => void; setDesk: (desk: DeskTab) => void; setTapeTab: (tab: TapeTab) => void; setGiftOpen: (open: boolean) => void }) {
  const lang = useExchange((s) => s.lang);
  const setLang = useExchange((s) => s.setLang);
  const reset = useExchange((s) => s.reset);
  const [arm, setArm] = useState(false);
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
    ["TAPE", floor === "tape", () => { setTapeTab("trade"); go("tape", "tape"); }],
    [lang === "zh" ? "挖矿" : "Mine", floor === "mine", () => go("mine", "mine")],
    [lang === "zh" ? "现货" : "Spot", floor === "desk" && desk === "spot", () => { setDesk("spot"); go("desk", "spot"); }],
    [lang === "zh" ? "永续" : "Perp", floor === "desk" && desk === "perp", () => { setDesk("perp"); go("desk", "perp"); }],
    [lang === "zh" ? "晶体管" : "Chips", floor === "asset", () => go("asset", "chips")],
    [lang === "zh" ? "跨链" : "Bridge", floor === "bridge", () => { window.history.replaceState(null, "", "#bridge"); go("bridge", "bridge"); }],
    [lang === "zh" ? "流片" : "Tape-out", floor === "canvas", () => go("canvas", "canvas")],
    [lang === "zh" ? "规则" : "Rules", floor === "rules", () => go("rules", "rules")],
    [lang === "zh" ? "练习" : "Practice", floor === "paper", () => go("paper", "paper")],
  ] as const;
  return (
    <header className="sticky top-0 z-20 -mx-2 shrink-0 border-b border-gold/40 bg-paper/95 px-2 py-2 backdrop-blur-sm sm:-mx-3 sm:px-3 lg:-mx-4 lg:px-4 pt-[max(0.35rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-3 overflow-x-auto border-b border-gold/30 pb-1 text-[11px] text-ink/65">
        <LiveQuotes />
        <span className="shrink-0">BSC · USDT</span>
        <span className="shrink-0">X Layer · USDT</span>
        <span className="shrink-0">{lang === "zh" ? "台费 0.20%" : "Fee 0.20%"}</span>
        <span className="shrink-0 font-mono">0x823b…054D</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <button type="button" onClick={() => go("desk", "spot")} className="flex shrink-0 items-center gap-2">
          <img src="/mark.jpg" alt="" className="size-7 border border-gold bg-foil object-cover" />
          <span className="font-display text-sm italic leading-none sm:text-lg">TAPELIQUID</span>
        </button>
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
          {nav.map(([label, on, run]) => (
            <button key={label} type="button" onClick={run} className={`shrink-0 border-b px-2.5 py-2 text-sm transition-colors duration-200 ${on ? "border-ink text-ink" : "border-transparent text-ink/50 hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ConnectButton />
          <InviteDock />
          <FeeBook />
          <button type="button" className={`hidden min-h-9 px-2 text-xs lg:inline ${floor === "me" ? "bg-ink text-paper" : ""}`} onClick={() => { setGiftOpen(false); go("me", "me"); }}>
            {lang === "zh" ? "资产" : "Assets"}
          </button>
          <button type="button" aria-label={night ? (lang === "zh" ? "白天" : "Day") : lang === "zh" ? "黑夜" : "Night"} className="hidden size-9 items-center justify-center text-ink lg:inline-flex" onClick={() => setNight((on) => !on)}>
            {night ? (
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="12" r="3.5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 14.5A7.5 7.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" /></svg>
            )}
          </button>
          <button type="button" className="hidden min-h-9 px-1.5 text-xs lg:inline" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
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
    </header>
  );
}

function MobileBar({ floor, desk, chain, kind, night, setNight, setFloor, setDesk, setTapeTab, setChain, setKind, setGiftOpen }: { floor: Floor; desk: DeskTab; chain: Chain; kind: AssetKind; night: boolean; setNight: (next: boolean | ((on: boolean) => boolean)) => void; setFloor: (floor: Floor) => void; setDesk: (desk: DeskTab) => void; setTapeTab: (tab: TapeTab) => void; setChain: (chain: Chain) => void; setKind: (kind: AssetKind) => void; setGiftOpen: (open: boolean) => void }) {
  const lang = useExchange((s) => s.lang);
  const setLang = useExchange((s) => s.setLang);
  const zh = lang === "zh";
  const [more, setMore] = useState(false);
  const jump = (next: Floor, hash: string) => {
    setMore(false);
    if (window.location.pathname.startsWith("/whitepaper")) {
      window.location.assign(next === "rules" ? "/whitepaper" : `/#${hash}`);
      return;
    }
    window.history.replaceState(null, "", `#${hash}`);
    setFloor(next);
  };
  const tabs = [
    { key: "tape", label: "TAPE", on: floor === "tape", run: () => { setTapeTab("trade"); jump("tape", "tape"); }, icon: "tape" },
    { key: "chip", label: zh ? "晶体管" : "Chips", on: floor === "asset" && chain === "x" && kind === "chip", run: () => { setChain("x"); setKind("chip"); jump("asset", "nand"); }, icon: "chip" },
    { key: "bridge", label: zh ? "跨链" : "Bridge", on: floor === "bridge", run: () => jump("bridge", "bridge"), icon: "bridge" },
    { key: "circuit", label: zh ? "电路" : "Circuits", on: floor === "asset" && chain === "x" && kind === "circuit", run: () => { setChain("x"); setKind("circuit"); jump("asset", "xcircuit"); }, icon: "circuit" },
    { key: "canvas", label: zh ? "流片" : "Tape", on: floor === "canvas", run: () => jump("canvas", "canvas"), icon: "out" },
    { key: "mine", label: zh ? "挖矿" : "Mine", on: floor === "mine", run: () => jump("mine", "mine"), icon: "mine" },
  ] as const;
  return (
    <>
      {more ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label={zh ? "关闭" : "Close"} className="absolute inset-0 bg-ink/30" onClick={() => setMore(false)} />
          <div className="absolute inset-x-0 bottom-[3.75rem] border-t border-gold bg-paper px-3 py-3">
            <div className="grid grid-cols-3 gap-2">
              <MoreCell label={zh ? "现货" : "Spot"} on={floor === "desk" && desk === "spot"} run={() => { setDesk("spot"); jump("desk", "spot"); }} />
              <MoreCell label={zh ? "容器" : "Box"} on={floor === "asset" && chain === "x" && kind === "box"} run={() => { setChain("x"); setKind("box"); jump("asset", "box"); }} />
              <MoreCell label={zh ? "永续" : "Perp"} on={floor === "desk" && desk === "perp"} run={() => { setDesk("perp"); jump("desk", "perp"); }} />
              <MoreCell label={zh ? "资产" : "Assets"} on={floor === "me"} run={() => { setGiftOpen(false); jump("me", "me"); }} />
              <MoreCell label={zh ? "练习" : "Practice"} on={floor === "paper"} run={() => jump("paper", "paper")} />
              <MoreCell label={zh ? "规则" : "Rules"} on={floor === "rules"} run={() => jump("rules", "rules")} />
              <MoreCell label={zh ? "指南" : "Guide"} on={false} run={() => jump("rules", "rules")} />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" className="flex min-h-11 items-center justify-center gap-2 border border-gold text-sm" onClick={() => setNight((on) => !on)}>
                {night ? (zh ? "白天模式" : "Day") : zh ? "暗色模式" : "Night"}
              </button>
              <a className="flex min-h-11 items-center justify-center border border-gold text-sm" href="https://x.com/Icp_chinese" target="_blank" rel="noreferrer">{zh ? "关注 X" : "X"}</a>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-sm">
              <span className="flex gap-3 text-ink/70">
                <a className="underline" href="https://t.me/+RWVnnxXf1LY1MWVh" target="_blank" rel="noreferrer">Telegram</a>
                <a className="underline" href="https://github.com/jimgreen9954/jim" target="_blank" rel="noreferrer">GitHub</a>
              </span>
              <span className="flex border border-gold">
                <button type="button" className={`min-h-9 px-3 ${zh ? "bg-ink text-paper" : ""}`} onClick={() => setLang("zh")}>中</button>
                <button type="button" className={`min-h-9 px-3 ${zh ? "" : "bg-ink text-paper"}`} onClick={() => setLang("en")}>EN</button>
              </span>
            </div>
          </div>
        </div>
      ) : null}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-[3.75rem] grid-cols-7 border-t border-gold/70 bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" onClick={tab.run} className={`flex flex-col items-center justify-center gap-0.5 border-t-2 text-[10px] leading-none ${tab.on ? "border-ink text-ink" : "border-transparent text-ink/45"}`}>
            <TabIcon name={tab.icon} />
            {tab.label}
          </button>
        ))}
        <button type="button" onClick={() => setMore((open) => !open)} className={`flex flex-col items-center justify-center gap-0.5 border-t-2 text-[10px] leading-none ${more ? "border-ink text-ink" : "border-transparent text-ink/45"}`}>
          <TabIcon name="more" />
          {zh ? "更多" : "More"}
        </button>
      </nav>
    </>
  );
}

function MoreCell({ label, on, run }: { label: string; on: boolean; run: () => void }) {
  return <button type="button" onClick={run} className={`min-h-11 border text-sm ${on ? "border-ink bg-ink text-paper" : "border-gold"}`}>{label}</button>;
}

function TabIcon({ name }: { name: string }) {
  const common = { viewBox: "0 0 24 24", className: "size-[18px]", fill: "none", stroke: "currentColor", strokeWidth: 1.6 };
  if (name === "tape") return <svg {...common}><circle cx="12" cy="12" r="7" /><path d="M9 15V9h3.2a2 2 0 0 1 0 4H9" /></svg>;
  if (name === "chip") return <svg {...common}><path d="M4 14c2-6 4-6 6 0s4 6 6 0 4-6 4 0" /></svg>;
  if (name === "bridge") return <svg {...common}><path d="M7 8h10M14 5l3 3-3 3M17 16H7M10 13l-3 3 3 3" /></svg>;
  if (name === "circuit") return <svg {...common}><circle cx="6" cy="12" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="18" cy="17" r="2" /><path d="M8 12h6M16 8.5 12 12l4 3.5" /></svg>;
  if (name === "out") return <svg {...common}><path d="M5 12h12M13 7l5 5-5 5" /></svg>;
  if (name === "box") return <svg {...common}><rect x="5" y="5" width="14" height="14" /><path d="M12 8v8M8 12h8" /></svg>;
  if (name === "mine") return <svg {...common}><path d="M4 19h16M7 19l8-9 2 2-6 7M14 8l2-2 3 3-2 2" /></svg>;
  return <svg {...common}><circle cx="6" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="18" cy="12" r="1.2" fill="currentColor" /></svg>;
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

function TapeFloor({ tab, setTab }: { tab: TapeTab; setTab: (tab: TapeTab) => void }) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const tabs = [
    ["trade", zh ? "现货" : "Spot"],
    ["otc", zh ? "挂单" : "Book"],
    ["stake", zh ? "质押" : "Stake"],
    ["ash", zh ? "销毁" : "Burn"],
    ["bid", zh ? "库藏" : "Reserve"],
  ] as const;
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1">
        <div>
          <h1 className="font-display text-xl italic leading-none text-ink lg:text-2xl">TAPE</h1>
          <p className="hidden text-sm text-ink sm:block">{zh ? "平台币" : "Platform token"}</p>
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setTab(id); if (id === "trade") window.history.replaceState(null, "", "#tape"); if (id === "otc") window.history.replaceState(null, "", "#book"); }} className={`min-h-9 shrink-0 px-3 text-sm transition-colors duration-200 ${tab === id ? "bg-ink text-paper" : "text-ink/70 hover:text-ink"}`}>{label}</button>
          ))}
        </div>
      </div>
      {tab === "trade" ? null : <TapeNetLine zh={zh} />}
      {tab === "trade" ? <TapePoolDesk /> : null}
      {tab === "otc" ? <div className="flex min-h-0 flex-1 flex-col"><TapeSpotDesk zh={zh} lanes={[0]} /></div> : null}
      {tab === "stake" ? <MineDesk lock="stake" /> : null}
      {tab === "ash" ? <MineDesk lock="ash" /> : null}
      {tab === "bid" ? <MineDesk lock="bid" /> : null}
    </section>
  );
}

function AssetFloor({ chain, kind, setChain, setKind }: { chain: Chain; kind: AssetKind; setChain: (chain: Chain) => void; setKind: (kind: AssetKind) => void }) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const pickChain = (next: Chain) => {
    setChain(next);
    if (next === "bsc" && (kind === "box")) setKind("chip");
    if (next === "x" && (kind === "perp" || kind === "bem")) setKind("chip");
  };
  const tabs = chain === "bsc"
    ? ([["chip", "NAND / LATCH · TapeOut"], ["circuit", zh ? "电路 · TapeOut" : "Circuits · TapeOut"], ["perp", zh ? "合约" : "Perp"], ["bem", "BEM"]] as const)
    : ([["chip", "NAND / LATCH · TAPELIQUID"], ["circuit", zh ? "电路 · TAPELIQUID" : "Circuits"], ["box", zh ? "容器 · TAPELIQUID" : "Box"]] as const);
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setKind(id)} className={`min-h-9 max-w-[11rem] shrink-0 truncate px-3 text-sm sm:max-w-none ${kind === id ? "border-b-2 border-ink font-medium" : "text-ink/50"}`}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 border border-gold">
          {(["bsc", "x"] as const).map((id) => (
            <button key={id} type="button" onClick={() => pickChain(id)} className={`min-h-9 px-3 text-xs ${chain === id ? "bg-ink text-paper" : "text-ink/60"}`}>{id === "bsc" ? "BSC" : "X Layer"}</button>
          ))}
        </div>
      </div>
      {chain === "bsc" && kind === "chip" ? <OfficialDesk mode="chips" /> : null}
      {chain === "bsc" && kind === "circuit" ? <OfficialDesk mode="circuits" /> : null}
      {chain === "bsc" && kind === "perp" ? <TransistorDesk /> : null}
      {chain === "bsc" && kind === "bem" ? <MineDesk lock="bem" /> : null}
      {chain === "x" && kind === "chip" ? <div className="flex min-h-0 flex-1 flex-col"><TapeSpotDesk zh={zh} lanes={[1, 2]} /></div> : null}
      {chain === "x" && kind === "circuit" ? <div className="flex min-h-0 flex-1 flex-col"><TapeSpotDesk zh={zh} lanes={["circuit"]} /></div> : null}
      {chain === "x" && kind === "box" ? <div className="flex min-h-0 flex-1 flex-col"><TapeSpotDesk zh={zh} lanes={["cap"]} /></div> : null}
    </section>
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
