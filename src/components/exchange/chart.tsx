import { useEffect, useState } from "react";
import { Kline } from "@/components/exchange/kline";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { getPaperCandles, PAPER_FRAMES, paperLabel, type Ohlc, type PaperFrame } from "@/lib/candles";

export function TraceChart() {
  const live = useExchange((s) => s.chainBem);
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [frame, setFrame] = useState<PaperFrame>("1m");
  const [rows, setRows] = useState<Ohlc[]>([]);

  useEffect(() => {
    let dead = false;
    setRows([]);
    const pull = () => {
      getPaperCandles({ data: frame })
        .then((next) => {
          if (!dead && next.length > 0) setRows(next);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, frame === "1m" ? 15_000 : 60_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [frame]);

  const view = rows.map((candle, index) => {
    if (index !== rows.length - 1 || !(live && live > 0)) return candle;
    return { ...candle, c: live, h: Math.max(candle.h, live), l: Math.min(candle.l, live) };
  });

  return (
    <section className="border border-gold bg-card shadow-plate">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gold/30 px-3 py-2">
        <p className="text-xs tracking-widest text-gold">{c.paper}</p>
        <div className="flex border border-gold">
          {PAPER_FRAMES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFrame(item)}
              className={`min-h-8 px-2 text-xs ${frame === item ? "bg-ink text-paper" : ""}`}
            >
              {paperLabel(item, lang)}
            </button>
          ))}
        </div>
      </div>
      {view.length === 0 ? <p className="px-3 py-6 text-sm text-ink/60">{lang === "zh" ? "K线还在读池子。" : "Reading the pool candles."}</p> : <Kline bars={view} lang={lang} desk="paper" />}
    </section>
  );
}
