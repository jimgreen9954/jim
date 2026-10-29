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

import { PairChevron } from "@/components/exchange/pair-chevron";

export { PairChevron };

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
  {
    id: "bemspot",
    view: { kind: "pancake", pair: "bem" },
    symbol: "BEM-USDT",
    kind: "spot",
    tag: "现货",
    where: "Pancake · BSC",
    pin: true,
  },
  {
    id: "tape",
    view: { kind: "tape", market: 0, pair: "usdt" },
    symbol: "TAPE-USDT0",
    kind: "spot",
    tag: "现货",
    where: "池子 · X Layer",
    pin: true,
  },
  {
    id: "btcspot",
    view: { kind: "pancake", pair: "btc" },
    symbol: "BTC-USDT",
    kind: "spot",
    tag: "现货",
    where: "Pancake · BSC",
    pin: true,
  },
  {
    id: "ethspot",
    view: { kind: "pancake", pair: "eth" },
    symbol: "ETH-USDT",
    kind: "spot",
    tag: "现货",
    where: "Pancake · BSC",
    pin: true,
  },
  {
    id: "bnbspot",
    view: { kind: "pancake", pair: "bnb" },
    symbol: "BNB-USDT",
    kind: "spot",
    tag: "现货",
    where: "Pancake · BSC",
    pin: true,
  },
  {
    id: "okbspot",
    view: { kind: "pancake", pair: "okb" },
    symbol: "OKB-USDT0",
    kind: "spot",
    tag: "现货",
    where: "Potato · X Layer",
    pin: true,
  },
  {
    id: "tapebem",
    view: { kind: "tape", market: 0, pair: "bem" },
    symbol: "TAPE-BEM",
    kind: "spot",
    tag: "现货",
    where: "池子 · X Layer",
    pin: true,
  },
  {
    id: "tapeokb",
    view: { kind: "tape", market: 0, pair: "okb" },
    symbol: "TAPE-OKB",
    kind: "spot",
    tag: "现货",
    where: "池子 · X Layer",
    pin: true,
  },
  {
    id: "tapeotc",
    view: { kind: "otc", market: 0 },
    symbol: "TAPE-USDT0",
    kind: "spot",
    tag: "OTC",
    where: "工房挂单",
    pin: true,
  },
  {
    id: "zecspot",
    view: { kind: "pancake", pair: "zec" },
    symbol: "ZEC-USDT",
    kind: "spot",
    tag: "现货",
    where: "Pancake · BSC",
    pin: false,
  },
  {
    id: "bem",
    view: { kind: "perp", chain: "bsc", coin: "bem" },
    symbol: "BEM-USDT",
    kind: "perp",
    tag: "永续",
    where: "",
    pin: true,
    lev: "1000×",
  },
  {
    id: "bemx",
    view: { kind: "perp", chain: "xlayer", coin: "bem" },
    symbol: "BEM-USDT0",
    kind: "perp",
    tag: "永续",
    where: "",
    pin: true,
    lev: "1000×",
  },
  {
    id: "nand",
    view: { kind: "tape", market: 1 },
    symbol: "NAND-USDT0",
    kind: "spot",
    tag: "现货",
    where: "订单簿 · X Layer",
    pin: false,
  },
  {
    id: "latch",
    view: { kind: "tape", market: 2 },
    symbol: "LATCH-USDT0",
    kind: "spot",
    tag: "现货",
    where: "订单簿 · X Layer",
    pin: false,
  },
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
        const text = row.price.toLocaleString("en-US", {
          maximumFractionDigits: row.price >= 1 ? 4 : 6,
        });
        write("tape", text);
        write("tapeperp", text);
        const depth = Number(row.bemTape + row.okbTape) / 1e8;
        if (depth > 0)
          setPool(`${depth.toLocaleString("en-US", { maximumFractionDigits: 0 })} TAPE`);
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
    bnbPrice()
      .then((text) => write("bnbspot", text))
      .catch(() => undefined);
    okbPrice()
      .then((text) => write("okbspot", text))
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [bem]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ROWS.filter((row) => {
      if (tab === "perp" && row.kind !== "perp") return false;
      if (tab === "spot" && row.kind !== "spot") return false;
      if (
        strict &&
        row.kind === "perp" &&
        row.id !== "bem" &&
        row.id !== "bemx" &&
        row.id !== "tapeperp" &&
        !px[row.id]
      )
        return false;
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
    <div
      className="fixed inset-x-0 bottom-[calc(3.4rem+env(safe-area-inset-bottom))] top-[var(--desk-top)] z-[80] xl:bottom-0"
      onClick={onClose}
    >
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
          <button
            type="button"
            onClick={() => setStrict((on) => !on)}
            className={`h-9 shrink-0 px-2 text-xs ${strict ? "bg-ink" : "border border-gold/50 text-ink/70"}`}
          >
            {zh ? (strict ? "只看有价" : "全部") : strict ? "Priced" : "All"}
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-gold/30 px-2">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`shrink-0 border-b-2 px-3 py-2 text-sm ${tab === item.id ? "border-up text-ink" : "border-transparent text-ink/45"}`}
            >
              {zh ? item.zh : item.en}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <p className="px-3 pt-2 text-[11px] text-ink/45">
            {zh
              ? "先看代币。搜索只在你输入以后才筛选。价格来自池子或报价，读不到是横线，不填假数。"
              : "Tokens are listed first. Search only filters after you type. Prices come from the pool or the quote. A dash is a missed read, not a made-up number."}
          </p>
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-ink/45">
              <tr>
                <th className="px-3 py-2 font-normal">{zh ? "市场" : "Market"}</th>
                <th className="px-2 py-2 font-normal">{zh ? "最新" : "Last"}</th>
                <th className="hidden px-2 py-2 font-normal sm:table-cell">
                  {zh ? "8小时资金" : "8h funding"}
                </th>
                <th className="hidden px-2 py-2 font-normal sm:table-cell">
                  {zh ? "这一本" : "Book"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-gold/15 hover:bg-foil"
                  onClick={() => onPick(row.view)}
                >
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <CoinMark id={coinOf(row)} />
                      <span>
                        <span className="font-medium">
                          {row.pin ? "★ " : ""}
                          {row.symbol}
                        </span>
                        {row.lev ? (
                          <span className="lev-chip ml-2 rounded px-1.5 py-0.5 font-mono text-[10px]">
                            {row.lev}
                          </span>
                        ) : null}
                        <span className="ml-2 text-[10px] text-ink/40">{row.tag}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono">
                    {px[row.id] || (row.id === "bemx" ? px.bem : "") || "—"}
                  </td>
                  <td className="hidden px-2 py-2 font-mono text-ink/55 sm:table-cell">
                    {row.kind === "perp" ? (zh ? "不收" : "None") : "—"}
                  </td>
                  <td className="hidden px-2 py-2 text-ink/60 sm:table-cell">
                    {row.where}
                    {row.id === "tape" && pool ? (
                      <span className="ml-2 font-mono text-ink/40">
                        {zh ? "池" : "Pool"} {pool}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-ink/45">
                    {zh ? "没有这一项。" : "Nothing matches."}
                  </td>
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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="sheet-up max-h-[86dvh] w-full max-w-md overflow-auto border border-gold bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pop-in"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/20 sm:hidden" />
        <div className="flex items-center justify-between">
          <h3 className="text-base">{zh ? "调整杠杆" : "Leverage"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center text-lg text-ink/50"
          >
            ×
          </button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={1000}
            value={n}
            onChange={(event) => {
              const next = Number(event.target.value);
              setN(next);
              onLev(next);
            }}
            className="touch-range w-full"
          />
          <span className="w-16 shrink-0 text-right font-mono text-lg">{n}×</span>
        </div>
        <button
          type="button"
          className="mt-4 h-11 w-full bg-up text-sm text-paper"
          onClick={onClose}
        >
          {zh ? "好" : "Done"}
        </button>
        {n > 20 ? (
          <p className="mt-2 text-xs text-sell">
            {zh ? "超过 20 倍，强平更近。" : "Over 20× sits closer to liquidation."}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function MarginDialog({
  zh,
  mode = "iso",
  onPick,
  onClose,
}: {
  zh: boolean;
  mode?: "cross" | "iso";
  onPick?: (next: "cross" | "iso") => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="sheet-up w-full max-w-lg border border-gold bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pop-in"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/20 sm:hidden" />
        <div className="flex items-center justify-between">
          <h3 className="text-base">{zh ? "保证金模式" : "Margin mode"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center text-lg text-ink/50"
          >
            ×
          </button>
        </div>
        {(
          [
            ["cross", zh ? "全仓" : "Cross"],
            ["iso", zh ? "逐仓" : "Isolated"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              onPick?.(id);
              onClose();
            }}
            className={`mt-2 flex h-12 w-full items-center gap-3 border px-3 text-left ${mode === id ? "border-up" : "border-gold/40"}`}
          >
            <span
              className={`grid size-4 shrink-0 place-items-center rounded-sm text-[10px] ${mode === id ? "bg-up text-paper" : "border border-gold"}`}
            >
              {mode === id ? "✓" : ""}
            </span>
            <span className="text-sm">{label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function AccountDialog({
  zh,
  mode = "manual",
  onPick,
  onClose,
}: {
  zh: boolean;
  mode?: "unified" | "port" | "manual";
  onPick?: (next: "unified" | "port" | "manual") => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={onClose}
    >
      <div
        className="sheet-up w-full max-w-lg border border-gold bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pop-in"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/20 sm:hidden" />
        <div className="flex items-center justify-between">
          <h3 className="text-base">{zh ? "账户类型" : "Account type"}</h3>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center text-lg text-ink/50"
          >
            ×
          </button>
        </div>
        {(
          [
            ["unified", zh ? "统一账户" : "Unified"],
            ["port", zh ? "投资组合保证金" : "Portfolio margin"],
            ["manual", zh ? "手动" : "Manual"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              onPick?.(id);
              onClose();
            }}
            className={`mt-2 flex h-12 w-full items-center gap-3 border px-3 text-left ${mode === id ? "border-up" : "border-gold/40"}`}
          >
            <span
              className={`grid size-4 shrink-0 place-items-center rounded-sm text-[10px] ${mode === id ? "bg-up text-paper" : "border border-gold"}`}
            >
              {mode === id ? "✓" : ""}
            </span>
            <span className="text-sm">{label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function FundingBoard({ zh, mark, last }: { zh: boolean; mark: number; last: number }) {
  const preview = fundingPreview(mark, last);
  const clock = fundClock();
  const points = preview
    ? [preview.raw, preview.raw * 0.6, preview.capped, preview.capped]
    : [0, 0, 0, 0];
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
        <p>
          <span className="block text-[11px] text-ink/45">{zh ? "资金费" : "Funding"}</span>
          <span className="font-mono">{preview ? pct(preview.capped) : "—"}</span>
        </p>
        <p>
          <span className="block text-[11px] text-ink/45">{zh ? "标记差" : "Last vs mark"}</span>
          <span className="font-mono">{preview ? pct(preview.raw) : "—"}</span>
        </p>
        <p>
          <span className="block text-[11px] text-ink/45">{zh ? "倒计时" : "Countdown"}</span>
          <span className="font-mono">{clock.left}</span>
        </p>
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
  void zh;
  return null;
}
