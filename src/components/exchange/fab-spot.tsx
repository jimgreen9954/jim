import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { CoinMark } from "@/components/exchange/coin-mark";
import { Kline } from "@/components/exchange/kline";
import { PairChevron } from "@/components/exchange/pair-chevron";
import { PhoneChrome, wantedPane, type PhonePane } from "@/components/exchange/phone-desk";
import { SignCard } from "@/components/exchange/sign-card";
import type { DeskView } from "@/components/exchange/desk-chrome";
import { rememberFill } from "@/components/exchange/trade-foot";
import { pretty, units } from "@/lib/bsc";
import { getCoinCandles } from "@/lib/candles";
import type { Candle } from "@/lib/bem-ohlcv";
import { fabBemPrice, fabUsd, quoteFab, readFab, swapFab } from "@/lib/fab";
import { okbTxUrl, readXBem } from "@/lib/okb";
import { markDeskFill } from "@/lib/red-packet";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectXLayer } from "@/lib/xlayer";

type Frame = "1m" | "5m" | "15m" | "1h" | "1d";

const FRAMES: { id: Frame; zh: string; en: string }[] = [
  { id: "1m", zh: "1分", en: "1m" },
  { id: "5m", zh: "5分", en: "5m" },
  { id: "15m", zh: "15分", en: "15m" },
  { id: "1h", zh: "1时", en: "1h" },
  { id: "1d", zh: "1日", en: "1d" },
];

function num(text: string): number {
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pxOf(n: number): string {
  if (!(n > 0)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 6 });
}

export function FabSpot({
  zh,
  onMarkets,
  onJump,
}: {
  zh: boolean;
  onMarkets?: () => void;
  onJump?: (view: DeskView) => void;
}) {
  const [phone, setPhone] = useState<PhonePane>(wantedPane);
  const [menu, setMenu] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [bem, setBem] = useState<bigint | null>(null);
  const [fab, setFab] = useState<bigint | null>(null);
  const [bemPx, setBemPx] = useState(0);
  const [usd, setUsd] = useState(0);
  const [out, setOut] = useState("");
  const [floor, setFloor] = useState<bigint | null>(null);
  const [bars, setBars] = useState<Candle[]>([]);
  const [frame, setFrame] = useState<Frame>("1h");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [hash, setHash] = useState("");
  const [card, setCard] = useState(false);

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const load = () => {
      fabBemPrice()
        .then((text) => {
          const n = num(text);
          if (!dead && n > 0) setBemPx(n);
        })
        .catch(() => undefined);
      fabUsd()
        .then((n) => {
          if (!dead && n > 0) setUsd(n);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 12_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!account) {
      setBem(null);
      setFab(null);
      return;
    }
    let dead = false;
    const load = () => {
      readXBem(account)
        .then((n) => {
          if (!dead) setBem(n);
        })
        .catch(() => undefined);
      readFab(account)
        .then((n) => {
          if (!dead) setFab(n);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 12_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [account, hash]);

  useEffect(() => {
    let dead = false;
    getCoinCandles({ data: { coin: "fab", frame } })
      .then((rows) => {
        if (!dead) setBars(rows);
      })
      .catch(() => {
        if (!dead) setBars([]);
      });
    return () => {
      dead = true;
    };
  }, [frame]);

  useEffect(() => {
    let dead = false;
    const raw = amount.trim();
    if (!raw) {
      setOut("");
      setFloor(null);
      return;
    }
    let typed = 0n;
    try {
      typed = units(raw, 8);
    } catch {
      setOut("");
      setFloor(null);
      return;
    }
    const net = (typed * 9980n) / 10_000n;
    if (net <= 0n) {
      setOut("");
      setFloor(null);
      return;
    }
    const timer = window.setTimeout(() => {
      quoteFab(side, net)
        .then((quoted) => {
          if (dead) return;
          const min = (quoted * 9900n) / 10_000n;
          setFloor(min);
          setOut(pretty(quoted, 8, 4));
        })
        .catch(() => {
          if (dead) return;
          setOut("");
          setFloor(null);
        });
    }, 280);
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, [amount, side]);

  const held = side === "buy" ? bem : fab;
  const payUnit = side === "buy" ? "BEM" : "FAB";
  const recvUnit = side === "buy" ? "FAB" : "BEM";
  let typed = 0n;
  try {
    typed = amount.trim() ? units(amount, 8) : 0n;
  } catch {
    typed = 0n;
  }
  const over = held != null && typed > held;

  const fill = (pct: number) => {
    if (held == null) return;
    const cut = (held * BigInt(pct)) / 100n;
    const [whole, frac = ""] = formatUnits(cut, 8).split(".");
    const trimmed = frac.slice(0, 6).replace(/0+$/, "");
    setAmount(trimmed ? `${whole}.${trimmed}` : whole);
  };

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : "";
    setBad(true);
    if (message === "balance") setNote(zh ? `这个钱包的 ${payUnit} 不够。` : `Not enough ${payUnit} in this wallet.`);
    else if (message === "tiny") setNote(zh ? "池子报不出价，没有发出去。" : "The pool did not quote. Nothing was sent.");
    else if (message === "quote-moved")
      setNote(zh ? "价格变了。看新报价再签。" : "The price moved. Look at the new quote, then sign.");
    else if (message === "amount") setNote(zh ? "先填数量。" : "Enter an amount.");
    else if (message === "fee-open") setNote(zh ? "成交了，台费没扣上。再点一次补上。" : "Filled. The desk fee was not taken. Tap again.");
    else setNote(message || (zh ? "钱包没有完成。" : "The wallet did not finish."));
  };

  const trade = async () => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "正在打开钱包…" : "Opening the wallet…");
    try {
      const from = account ?? (await connectXLayer());
      setAccount(from);
      const tx = await swapFab(from, side, amount, floor ?? undefined);
      markDeskFill("xlayer", from, "spot", Number(amount) || 0, "fab");
      setHash(tx);
      rememberFill(
        zh
          ? side === "buy"
            ? `付 ${amount} BEM，买入 ${out || ""} FAB`
            : `卖出 ${amount} FAB，收到 ${out || ""} BEM`
          : side === "buy"
            ? `Pay ${amount} BEM, buy ${out || ""} FAB`
            : `Sell ${amount} FAB, receive ${out || ""} BEM`,
        okbTxUrl(tx),
      );
      setNote("");
      setAmount("");
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const openC = bars[0]?.o || bars[0]?.c || 0;
  const last = bars.at(-1)?.c || usd;
  const change = openC > 0 && last > 0 ? (last - openC) / openC : 0;

  return (
    <section className="phone-desk spot-split min-w-0 overflow-hidden border border-gold bg-card" data-phone={phone}>
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold px-3 py-2">
        <button type="button" onClick={() => (onMarkets ? onMarkets() : setMenu((on) => !on))} className="flex min-w-0 items-center gap-2">
          <CoinMark id="fab" />
          <span className="truncate text-lg font-medium tracking-tight">FAB/BEM</span>
          <PairChevron up={menu} />
          <span className="lev-chip shrink-0 rounded px-1.5 py-0.5 text-[11px]">{zh ? "现货" : "Spot"}</span>
        </button>
        {menu && !onMarkets ? (
          <div className="absolute left-2 top-12 z-30 w-52 border border-gold bg-card shadow-plate">
            <button
              type="button"
              className="block h-10 w-full px-3 text-left text-sm hover:bg-foil/70"
              onClick={() => {
                setMenu(false);
                onJump?.({ kind: "perp", chain: "xlayer", coin: "fab" });
              }}
            >
              FAB/USDT0 · {zh ? "永续" : "Perp"}
            </button>
          </div>
        ) : null}
        <p className="font-mono text-sm">
          {pxOf(bemPx)} <span className="text-[11px] text-ink/40">BEM</span>
        </p>
        <p className="font-mono text-sm text-ink/70">
          {usd > 0 ? `$${pxOf(usd)}` : "—"}
        </p>
        <p className={`font-mono text-sm ${change < 0 ? "text-sell" : "text-up"}`}>
          {last > 0 && openC > 0 ? `${change >= 0 ? "+" : ""}${(change * 100).toFixed(2)}%` : "—"}
        </p>
        <p className="text-[11px] text-ink/45">{zh ? "最大池 BEM/FAB 0.9%" : "Deepest pool · BEM/FAB 0.9%"}</p>
      </div>
      <PhoneChrome
        zh={zh}
        pane={phone}
        setPane={setPhone}
        sheet={false}
        onBuy={() => {
          setSide("buy");
          setPhone("ticket");
        }}
        onSell={() => {
          setSide("sell");
          setPhone("ticket");
        }}
      />
      <div className="spot-grid grid min-w-0 items-start xl:grid-cols-[minmax(0,1fr)_18rem_20rem]">
        <div className="ph-chart min-w-0">
          <Kline
            bars={bars}
            mark={usd}
            lang={zh ? "zh" : "en"}
            desk="spot"
            frame={frame}
            frames={FRAMES.map((row) => ({ id: row.id, label: zh ? row.zh : row.en }))}
            onFrame={(id) => setFrame(id as Frame)}
          />
          <p className="px-3 pb-2 text-[11px] text-ink/40">{zh ? "K 线是美元，按 FAB 最大的那个池。" : "Candles are USD, from FAB's deepest pool."}</p>
        </div>
        <div className="ph-book order-3 min-w-0 border-t border-gold xl:order-2 xl:border-t-0 xl:border-l">
          <div className="flex h-9 items-center border-b border-gold px-3 text-xs">
            <span className="tab-on">{zh ? "这一池" : "Pool"}</span>
          </div>
          <div className="flex flex-col gap-3 px-3 py-3 text-sm">
            <p>BEM / FAB · 0.9%</p>
            <p className="text-xs leading-relaxed text-ink/55">
              {zh
                ? "现货只打进这个 v4 池。FAB 的流动性几乎都在这里。OKB/FAB 和 FAB/USDC 更浅，不走。"
                : "Spot fills this v4 pool only. Almost all FAB liquidity is here. The thinner OKB/FAB and FAB/USDC pools are not used."}
            </p>
            <p className="font-mono text-xs text-ink/70">
              1 FAB = {pxOf(bemPx)} BEM
              {usd > 0 ? ` · $${pxOf(usd)}` : ""}
            </p>
            <p className="font-mono text-[11px] text-ink/40">Uniswap v4 · X Layer</p>
          </div>
        </div>
        <div className="ph-ticket relative order-2 border-t border-gold p-3 xl:order-3 xl:border-t-0 xl:border-l">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setSide("buy")} className={`h-10 text-sm ${side === "buy" ? "bg-ink" : "quiet-buy"}`}>
              {zh ? "买入" : "Buy"}
            </button>
            <button
              type="button"
              onClick={() => setSide("sell")}
              className={`h-10 text-sm ${side === "sell" ? "bg-sell text-[#fff7f8]" : "quiet-sell"}`}
            >
              {zh ? "卖出" : "Sell"}
            </button>
          </div>
          <p className="mt-3 font-mono text-lg tabular-nums">
            {pxOf(bemPx)} <span className="text-xs text-ink/45">BEM</span>
          </p>
          <div className="mt-2 grid grid-cols-2 border border-gold/40 font-mono text-sm">
            <p className="px-2 py-2">
              <span className="block text-[10px] text-ink/45">{zh ? "可用" : "Available"}</span>
              {held == null ? "—" : pretty(held, 8, 4)} {payUnit}
            </p>
            <p className="border-l border-gold/40 px-2 py-2">
              <span className="block text-[10px] text-ink/45">{zh ? "约得" : "About"}</span>
              {out ? `${out} ${recvUnit}` : "—"}
            </p>
          </div>
          <label className="relative mt-2 block border border-gold/40 px-2 py-2">
            <span className="text-[11px] text-ink/45">{zh ? `支付 ${payUnit}` : `Pay ${payUnit}`}</span>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              className="w-full bg-transparent font-mono text-lg outline-none"
            />
          </label>
          <div className="mt-2 grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((pct) => (
              <button key={pct} type="button" onClick={() => fill(pct)} className="h-8 border border-gold/40 text-xs text-ink/70">
                {pct}%
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink/45">
            {zh ? "台费 0.20% 从支付里扣，然后进 BEM/FAB 0.9%。滑点 1%。" : "A 0.20% desk fee comes off the payment, then the rest hits BEM/FAB 0.9%. Slippage 1%."}
          </p>
          {over ? <p className="mt-2 text-xs text-sell">{zh ? "余额不够。" : "Not enough balance."}</p> : null}
          <button
            type="button"
            disabled={busy || over || !amount.trim()}
            onClick={() => setCard(true)}
            className={`mt-3 min-h-11 w-full text-sm ${side === "sell" ? "hl-sell" : "hl-buy"} disabled:opacity-40`}
          >
            {busy ? (zh ? "签名中" : "Signing") : side === "buy" ? (zh ? "买入 FAB" : "Buy FAB") : zh ? "卖出 FAB" : "Sell FAB"}
          </button>
          {note ? <p className={`mt-2 text-xs ${bad ? "text-sell" : "text-ink/70"}`}>{note}</p> : null}
          {hash ? (
            <a href={okbTxUrl(hash)} target="_blank" rel="noreferrer" className="mt-2 block font-mono text-[11px] text-ink/60 underline">
              {hash.slice(0, 10)}…{hash.slice(-6)}
            </a>
          ) : null}
        </div>
      </div>
      {card ? (
        <SignCard
          title={zh ? "签名前看一眼" : "Before you sign"}
          yes={zh ? "确认并签名" : "Confirm and sign"}
          no={zh ? "取消" : "Cancel"}
          onNo={() => setCard(false)}
          onYes={() => {
            setCard(false);
            void trade();
          }}
          lines={[
            { k: zh ? "方向" : "Side", v: side === "buy" ? (zh ? "用 BEM 买 FAB" : "Buy FAB with BEM") : zh ? "把 FAB 卖成 BEM" : "Sell FAB for BEM" },
            { k: zh ? "支付" : "Pay", v: `${amount || "—"} ${payUnit}` },
            { k: zh ? "约得" : "About", v: out ? `${out} ${recvUnit}` : "—" },
            { k: zh ? "池子" : "Pool", v: "BEM/FAB 0.9% · X Layer" },
          ]}
        />
      ) : null}
    </section>
  );
}
