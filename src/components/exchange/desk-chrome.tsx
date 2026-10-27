import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { bemPrice, bnbPrice, ercPrice } from "@/lib/bsc";
import { CoinMark } from "@/components/exchange/coin-mark";
import { okbPrice } from "@/lib/okb";
import { useExchange } from "@/lib/exchange-store";
import { fundingPreview, fundClock, pct } from "@/lib/risk-rules";
import { readOpenBook } from "@/lib/tape-open-candles";
import { readSpotBook, usdtText } from "@/lib/tape-spot";
import type { Desk } from "@/lib/perp";

export function PairChevron({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`size-[18px] shrink-0 text-ink/75 ${up ? "rotate-180" : ""}`}>
      <path d="M4.2 7.3 10 13.1 15.8 7.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type TapePair = "usdt" | "bem" | "okb";
export type SpotId = 0 | 1 | 2;
export type PerpCoin = "bem" | "btc" | "eth" | "zec" | "tape";

export type DeskView =
  | { kind: "tape"; market: SpotId; pair?: TapePair }
  | { kind: "otc"; market: SpotId }
  | { kind: "pancake"; pair: "bem" | "bnb" | "okb" | "btc" | "eth" | "zec" | "xau" }
  | { kind: "perp"; chain: Desk; coin: PerpCoin };

type Tab = "all" | "perp" | "spot";

type Row = {
  id: string;
  view: DeskView;
  symbol: string;
  kind: "spot" | "perp";
  tag: string;
  where: string;
  pin: boolean;
  lev?: string;
};

const ROWS: Row[] = [
  { id: "tape", view: { kind: "tape", market: 0, pair: "usdt" }, symbol: "TAPE-USDT0", kind: "spot", tag: "现货", where: "池子 · X Layer", pin: true },
  { id: "tapebem", view: { kind: "tape", market: 0, pair: "bem" }, symbol: "TAPE-BEM", kind: "spot", tag: "现货", where: "池子 · X Layer", pin: true },
  { id: "tapeokb", view: { kind: "tape", market: 0, pair: "okb" }, symbol: "TAPE-OKB", kind: "spot", tag: "现货", where: "池子 · X Layer", pin: true },
  { id: "tapeotc", view: { kind: "otc", market: 0 }, symbol: "TAPE-USDT0", kind: "spot", tag: "OTC", where: "工房挂单", pin: true },
  { id: "bemspot", view: { kind: "pancake", pair: "bem" }, symbol: "BEM-USDT", kind: "spot", tag: "现货", where: "Pancake · BSC", pin: true },
  { id: "btcspot", view: { kind: "pancake", pair: "btc" }, symbol: "BTC-USDT", kind: "spot", tag: "现货", where: "Pancake · BSC", pin: false },
  { id: "ethspot", view: { kind: "pancake", pair: "eth" }, symbol: "ETH-USDT", kind: "spot", tag: "现货", where: "Pancake · BSC", pin: false },
  { id: "zecspot", view: { kind: "pancake", pair: "zec" }, symbol: "ZEC-USDT", kind: "spot", tag: "现货", where: "Pancake · BSC", pin: false },
  { id: "bnbspot", view: { kind: "pancake", pair: "bnb" }, symbol: "BNB-USDT", kind: "spot", tag: "现货", where: "Pancake · BSC", pin: true },
  { id: "okbspot", view: { kind: "pancake", pair: "okb" }, symbol: "OKB-USDT0", kind: "spot", tag: "现货", where: "Potato · X Layer", pin: true },
  { id: "tapeperp", view: { kind: "perp", chain: "xlayer", coin: "tape" }, symbol: "TAPE-USDT0", kind: "perp", tag: "永续", where: "TAPE 标记 · 结算本未部署", pin: true, lev: "1000×" },
  { id: "bem", view: { kind: "perp", chain: "bsc", coin: "bem" }, symbol: "BEM-USDT", kind: "perp", tag: "永续", where: "TAPE 协议 · BSC", pin: true, lev: "1000×" },
  { id: "bemx", view: { kind: "perp", chain: "xlayer", coin: "bem" }, symbol: "BEM-USDT0", kind: "perp", tag: "永续", where: "TAPE 协议 · X Layer", pin: true, lev: "1000×" },
  { id: "btc", view: { kind: "perp", chain: "bsc", coin: "btc" }, symbol: "BTC-USDT", kind: "perp", tag: "永续", where: "与 BEM 同一张单", pin: false, lev: "1000×" },
  { id: "eth", view: { kind: "perp", chain: "bsc", coin: "eth" }, symbol: "ETH-USDT", kind: "perp", tag: "永续", where: "与 BEM 同一张单", pin: false, lev: "1000×" },
  { id: "zec", view: { kind: "perp", chain: "bsc", coin: "zec" }, symbol: "ZEC-USDT", kind: "perp", tag: "永续", where: "与 BEM 同一张单", pin: false, lev: "1000×" },
  { id: "nand", view: { kind: "tape", market: 1 }, symbol: "NAND-USDT0", kind: "spot", tag: "现货", where: "订单簿 · X Layer", pin: false },
  { id: "latch", view: { kind: "tape", market: 2 }, symbol: "LATCH-USDT0", kind: "spot", tag: "现货", where: "订单簿 · X Layer", pin: false },
];

function coinOf(row: Row): string {
  if (row.id.startsWith("tape")) return "tape";
  const head = row.symbol.split("-")[0]?.toLowerCase() ?? "tape";
  return head;
}

export function MarketSheet({
  zh,
  initial,
  onClose,
  onPick,
}: {
  zh: boolean;
  initial: Tab;
  onClose: () => void;
  onPick: (view: DeskView) => void;
}) {
  const bem = useExchange((s) => s.chainBem);
  const [tab, setTab] = useState<Tab>(initial);
  const [q, setQ] = useState("");
  const [strict, setStrict] = useState(false);
  const [px, setPx] = useState<Record<string, string>>({});
  const [pool, setPool] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let dead = false;
    const write = (id: string, text: string) => {
      if (!dead && text) setPx((prev) => ({ ...prev, [id]: text }));
    };
    readOpenBook()
      .then((row) => {
        if (dead || !(row.price > 0)) return;
        const text = row.price.toLocaleString("en-US", { maximumFractionDigits: row.price >= 1 ? 4 : 6 });
        write("tape", text);
        write("tapeperp", text);
        const depth = Number(row.bemTape + row.okbTape) / 1e8;
        if (depth > 0) setPool(`${depth.toLocaleString("en-US", { maximumFractionDigits: 0 })} TAPE`);
      })
      .catch(() => undefined);
    readSpotBook(0)
      .then((book) => {
        const bid = book?.bids[0]?.price ?? 0n;
        const ask = book?.asks[0]?.price ?? 0n;
        if (dead || (bid === 0n && ask === 0n)) return;
        const mid = bid > 0n && ask > 0n ? (bid + ask) / 2n : bid > 0n ? bid : ask;
        write("tape", usdtText(mid, 4));
        write("tapeperp", usdtText(mid, 4));
      })
      .catch(() => undefined);
    if (typeof bem === "number" && bem > 0) {
      const text = bem.toLocaleString("en-US", { maximumFractionDigits: 4 });
      write("bem", text);
      write("bemspot", text);
    }
    bemPrice()
      .then((text) => {
        write("bem", text);
        write("bemspot", text);
      })
      .catch(() => undefined);
    (["btc", "eth", "zec"] as const).forEach((coin) => {
      ercPrice(coin)
        .then((text) => {
          write(coin, text);
          write(`${coin}spot`, text);
        })
        .catch(() => undefined);
    });
    bnbPrice().then((text) => write("bnbspot", text)).catch(() => undefined);
    okbPrice().then((text) => write("okbspot", text)).catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [bem]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ROWS.filter((row) => {
      if (tab === "perp" && row.kind !== "perp") return false;
      if (tab === "spot" && row.kind !== "spot") return false;
      if (strict && row.kind === "perp" && row.id !== "bem" && row.id !== "bemx" && row.id !== "tapeperp" && !px[row.id]) return false;
      if (!needle) return true;
      return `${row.symbol} ${row.where} ${row.tag}`.toLowerCase().includes(needle);
    });
  }, [q, tab, strict, px]);

  const tabs: { id: Tab; zh: string; en: string }[] = [
    { id: "all", zh: "所有", en: "All" },
    { id: "perp", zh: "合约", en: "Perps" },
    { id: "spot", zh: "现货", en: "Spot" },
  ];

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.4rem+env(safe-area-inset-bottom))] top-[var(--desk-top)] z-[80] xl:bottom-0" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="pop-in absolute inset-x-0 top-0 flex h-full flex-col overflow-hidden border border-gold bg-card shadow-plate sm:inset-x-4 sm:top-2 sm:h-auto sm:max-h-[min(36rem,calc(100dvh-8rem))]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gold/40 p-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 border border-gold/50 px-2">
            <span className="text-ink/40">⌕</span>
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={zh ? "搜索" : "Search"}
              className="h-9 w-full bg-transparent text-sm outline-none"
            />
          </label>
          <button type="button" onClick={() => setStrict((on) => !on)} className={`h-9 shrink-0 px-2 text-xs ${strict ? "bg-ink" : "border border-gold/50 text-ink/70"}`}>
            {zh ? (strict ? "只看有价" : "全部") : strict ? "Priced" : "All"}
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-gold/30 px-2">
          {tabs.map((item) => (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === item.id ? "border-up text-ink" : "border-transparent text-ink/45"}`}>
              {zh ? item.zh : item.en}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="px-3 pt-2 text-[11px] text-ink/45">{zh ? "先看代币。搜索只在你输入以后才筛选。价格来自池子或报价，读不到是横线，不填假数。" : "Tokens are listed first. Search only filters after you type. Prices come from the pool or the quote. A dash is a missed read, not a made-up number."}</p>
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-ink/45">
              <tr>
                <th className="px-3 py-2 font-normal">{zh ? "市场" : "Market"}</th>
                <th className="px-2 py-2 font-normal">{zh ? "最新" : "Last"}</th>
                <th className="hidden px-2 py-2 font-normal sm:table-cell">{zh ? "8小时资金" : "8h funding"}</th>
                <th className="hidden px-2 py-2 font-normal sm:table-cell">{zh ? "这一本" : "Book"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t border-gold/15 hover:bg-foil" onClick={() => onPick(row.view)}>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <CoinMark id={coinOf(row)} />
                      <span>
                        <span className="font-medium">{row.pin ? "★ " : ""}{row.symbol}</span>
                        {row.lev ? <span className="lev-chip ml-2 rounded px-1.5 py-0.5 font-mono text-[10px]">{row.lev}</span> : null}
                        <span className="ml-2 text-[10px] text-ink/40">{row.tag}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono">{px[row.id] || (row.id === "bemx" ? px.bem : "") || "—"}</td>
                  <td className="hidden px-2 py-2 font-mono text-ink/55 sm:table-cell">{row.kind === "perp" ? (zh ? "不收" : "None") : "—"}</td>
                  <td className="hidden px-2 py-2 text-ink/60 sm:table-cell">
                    {row.where}
                    {row.id === "tape" && pool ? <span className="ml-2 font-mono text-ink/40">{zh ? "池" : "Pool"} {pool}</span> : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-ink/45">{zh ? "没有这一项。" : "Nothing matches."}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="border-t border-gold/30 px-3 py-2 text-[11px] text-ink/40">
          {zh ? "Esc 关闭。" : "Esc closes."}
        </p>
      </div>
    </div>
  );
}

export function LevDialog({
  zh,
  lev,
  onLev,
  onClose,
}: {
  zh: boolean;
  lev: number;
  onLev: (next: number) => void;
  onClose: () => void;
}) {
  const [n, setN] = useState(lev >= 1 ? lev : 3);
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="pop-in w-full max-w-md border border-gold bg-card p-4" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base">{zh ? "调整杠杆" : "Leverage"}</h3>
          <button type="button" onClick={onClose} className="px-2 text-ink/50">×</button>
        </div>
        <p className="mt-2 text-xs leading-5 text-ink/60">{zh ? "这一本最高 1000 倍。倍数越高，标记价反向一点点就到强平。新手档在 20 倍以内。" : "This book caps at 1,000×. A higher multiple reaches liquidation on a smaller mark move. Beginner stays at 20×."}</p>
        <div className="mt-4 flex items-center gap-3">
          <input type="range" min={1} max={1000} value={n} onChange={(event) => setN(Number(event.target.value))} className="w-full" />
          <span className="w-16 shrink-0 text-right font-mono">{n}×</span>
        </div>
        <button type="button" className="mt-4 h-11 w-full bg-ink text-sm" onClick={() => { onLev(n); onClose(); }}>
          {zh ? "用这个倍数" : "Use this"}
        </button>
        {n > 20 ? <p className="mt-2 border border-sell/50 px-2 py-2 text-xs text-sell">{zh ? "超过 20 倍，开仓时还要再确认一次。" : "Over 20× asks again before the order."}</p> : null}
      </div>
    </div>,
    document.body,
  );
}

export function MarginDialog({ zh, mode = "iso", onPick, onClose }: { zh: boolean; mode?: "cross" | "iso"; onPick?: (next: "cross" | "iso") => void; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="pop-in w-full max-w-lg border border-gold bg-card p-5" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base">{zh ? "保证金模式" : "Margin mode"}</h3>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center text-lg text-ink/50">×</button>
        </div>
        {([
          ["cross", zh ? "全仓" : "Cross", zh ? "盈亏算在这个钱包的可用余额上。这一本链上结算仍是逐仓，选中只改这一页的记账。" : "PnL is marked against the wallet. This book's chain settlement is still isolated."],
          ["iso", zh ? "逐仓" : "Isolated", zh ? "只拿这一张单的保证金去算强平。" : "Only this order's margin is used for liquidation."],
        ] as const).map(([id, label, hint]) => (
          <button key={id} type="button" onClick={() => onPick?.(id)} className={`mt-2 flex w-full items-start gap-3 border px-3 py-3 text-left ${mode === id ? "border-up" : "border-gold/40"}`}>
            <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm text-[10px] ${mode === id ? "bg-up text-paper" : "border border-gold"}`}>{mode === id ? "✓" : ""}</span>
            <span>
              <span className="block text-sm">{label}</span>
              <span className="mt-1 block text-xs leading-5 text-ink/55">{hint}</span>
            </span>
          </button>
        ))}
        <button type="button" className="mt-4 h-11 w-full bg-up text-sm text-paper" onClick={onClose}>{zh ? "好" : "Done"}</button>
      </div>
    </div>,
    document.body,
  );
}

export function AccountDialog({ zh, mode = "manual", onPick, onClose }: { zh: boolean; mode?: "unified" | "port" | "manual"; onPick?: (next: "unified" | "port" | "manual") => void; onClose: () => void }) {
  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4" onMouseDown={onClose}>
      <div className="pop-in w-full max-w-lg border border-gold bg-card p-5" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base">{zh ? "账户类型" : "Account type"}</h3>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center text-lg text-ink/50">×</button>
        </div>
        {([
          ["unified", zh ? "统一账户" : "Unified"],
          ["port", zh ? "投资组合保证金" : "Portfolio margin"],
          ["manual", zh ? "手动" : "Manual"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => onPick?.(id)} className={`mt-2 flex w-full items-start gap-3 border px-3 py-3 text-left ${mode === id ? "border-up" : "border-gold/40"}`}>
            <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm text-[10px] ${mode === id ? "bg-up text-paper" : "border border-gold"}`}>{mode === id ? "✓" : ""}</span>
            <span className="text-sm">{label}</span>
          </button>
        ))}
        <p className="mt-3 text-xs leading-5 text-ink/50">{zh ? "链上这一本按逐仓签名。统一账户和投资组合保证金先记在这一页。" : "This book still signs isolated margin. Unified and portfolio margin are kept on this page."}</p>
        <button type="button" className="mt-4 h-11 w-full bg-up text-sm text-paper" onClick={onClose}>{zh ? "好" : "Done"}</button>
      </div>
    </div>,
    document.body,
  );
}

export function FundingBoard({ zh, mark, last }: { zh: boolean; mark: number; last: number }) {
  const preview = fundingPreview(mark, last);
  const clock = fundClock();
  const points = preview ? [preview.raw, preview.raw * 0.6, preview.capped, preview.capped] : [0, 0, 0, 0];
  const w = 520;
  const h = 180;
  const min = Math.min(...points, -FUND_CAP_VIEW);
  const max = Math.max(...points, FUND_CAP_VIEW);
  const span = max - min || 1;
  const d = points
    .map((n, i) => {
      const x = 16 + (i * (w - 32)) / Math.max(points.length - 1, 1);
      const y = 16 + ((max - n) / span) * (h - 32);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="px-3 py-3">
      <div className="flex flex-wrap gap-6 text-sm">
        <p><span className="block text-[11px] text-ink/45">{zh ? "这一本" : "This book"}</span><span className="font-mono">{zh ? "不收资金费" : "No funding"}</span></p>
        <p><span className="block text-[11px] text-ink/45">{zh ? "最后一笔相对标记" : "Last vs mark"}</span><span className="font-mono">{preview ? pct(preview.raw) : "—"}</span></p>
        <p><span className="block text-[11px] text-ink/45">{zh ? "下一本会封顶" : "Next book cap"}</span><span className="font-mono">{preview ? pct(preview.capped) : "—"}</span></p>
        <p><span className="block text-[11px] text-ink/45">{zh ? "下一本的钟" : "Next book clock"}</span><span className="font-mono">{clock.left}</span></p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-44 w-full">
        <line x1="16" y1={h / 2} x2={w - 16} y2={h / 2} stroke="rgba(255,255,255,0.12)" />
        <path d={d} fill="none" stroke="var(--color-up)" strokeWidth="1.6" />
      </svg>
    </div>
  );
}

const FUND_CAP_VIEW = 0.0005;

export function RiskCards({ zh }: { zh: boolean }) {
  const items = zh
    ? [
        ["资金费", "这一本不收。", "下一本每 8 小时结算一次，费率是（标记 − 指数）/ 指数，封顶 ±0.05%。多头在标记更高时付给空头。钱在这一对的保证金里划。没有指数源时不收。"],
        ["保险基金", "这一本没有池子。", "下一本从强平剩余里留一半进保险，一半给强平的人。只用来补这一对的穿仓。没有提取函数，谁都不能提走。"],
        ["自动减仓", "这一本不扫别人的仓。", "穿仓时，对面的保证金先承担。下一本也只减这一对里的盈利方。保险不够才减。不会按排名去平别的用户。"],
      ]
    : [
        ["Funding", "This book charges none.", "The next book would settle every 8 hours at (mark − index) / index, capped at ±0.05%, inside this pair's margin."],
        ["Insurance", "This book has no pool.", "The next book would keep half of a liquidation remainder and pay half to the caller. It only covers that pair's shortfall. Nobody can withdraw it."],
        ["ADL", "This book does not close other users.", "The counterparty's margin takes the loss. The next book would haircut only that pair's winner, and only after insurance is short."],
      ];
  return (
    <div className="grid gap-2">
      {items.map(([title, now, next]) => (
        <div key={title} className="border border-gold/30 px-2 py-2">
          <p className="text-xs text-ink/80">{title}</p>
          <p className="mt-1 text-xs text-ink">{now}</p>
          <p className="mt-1 text-[11px] leading-5 text-ink/50">{next}</p>
        </div>
      ))}
    </div>
  );
}
