import { useEffect, useState } from "react";
import { ercPrice, ERC_BOOKS, type ErcKey } from "@/lib/bsc";
import { Kline } from "@/components/exchange/kline";

const SYMBOL = { btc: "BTCUSDT", eth: "ETHUSDT", zec: "ZECUSDT" } as const;
const NAME = { btc: "BTC", eth: "ETH", zec: "ZEC" } as const;

type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };

function liq(mark: number, lev: number, long: boolean): string {
  if (!(mark > 0) || lev < 1) return "—";
  const px = long ? mark * (1 - 0.5 / lev) : mark * (1 + 0.5 / lev);
  return px.toLocaleString("en-US", { maximumFractionDigits: mark >= 100 ? 2 : 4 });
}

export function CoinContract({ coin, lang }: { coin: "btc" | "eth" | "zec"; lang: "zh" | "en" }) {
  const zh = lang === "zh";
  const sym = NAME[coin];
  const book = ERC_BOOKS[coin as ErcKey];
  const [mark, setMark] = useState(0);
  const [bars, setBars] = useState<Bar[]>([]);
  const [side, setSide] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("5");
  const [lev, setLev] = useState(5);
  const [note, setNote] = useState("");

  useEffect(() => {
    let dead = false;
    const pullPx = () => {
      ercPrice(coin).then((text) => {
        const n = Number(text.replace(/,/g, ""));
        if (!dead && n > 0) setMark(n);
      }).catch(() => undefined);
    };
    const pullBars = () => {
      fetch(`https://api.binance.com/api/v3/klines?symbol=${SYMBOL[coin]}&interval=1h&limit=48`)
        .then((res) => res.json())
        .then((rows: unknown) => {
          if (dead || !Array.isArray(rows)) return;
          const next = rows.flatMap((row) => {
            if (!Array.isArray(row)) return [];
            const t = Number(row[0]) / 1000;
            const o = Number(row[1]);
            const h = Number(row[2]);
            const l = Number(row[3]);
            const c = Number(row[4]);
            const v = Number(row[5]);
            if (![t, o, h, l, c].every((n) => Number.isFinite(n))) return [];
            return [{ t, o, h, l, c, v }];
          });
          if (next.length) setBars(next);
        })
        .catch(() => undefined);
    };
    pullPx();
    pullBars();
    const id = window.setInterval(() => { pullPx(); pullBars(); }, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [coin]);

  const px = mark > 0 ? mark.toLocaleString("en-US", { maximumFractionDigits: mark >= 100 ? 2 : 4 }) : "—";
  const fee = (() => {
    const n = Number(margin);
    return Number.isFinite(n) && n > 0 ? (n * 0.002).toLocaleString("en-US", { maximumFractionDigits: 4 }) : "—";
  })();

  return (
    <section className="border border-gold bg-card">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/40 px-3 py-3">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.14em] text-gold">{zh ? "BSC · 永续" : "BSC · Perp"}</p>
          <p className="font-display text-2xl italic leading-none sm:text-3xl">{sym} / USDT</p>
          <p className="mt-1 font-mono text-[11px] text-ink/70 sm:text-xs">{zh ? `币 ${sym} · 链 BSC · 保证金 USDT · 永续` : `Coin ${sym} · chain BSC · margin USDT · perp`}</p>
          <p className="mt-1 max-w-xl text-[11px] leading-5 text-ink/55">{zh ? `和 BEM 同一类保证金合约。标记读 Pancake ${sym}/USDT 池，费率 ${(book.fee / 10000).toFixed(2)}%。不是买入现货，币不会进钱包。` : `Same margin contract as BEM. Mark reads the Pancake ${sym}/USDT pool. Not a spot buy. Coins do not land in the wallet.`}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] tracking-widest text-gold">{zh ? "标记" : "Mark"}</p>
          <p className="font-mono text-2xl tabular-nums leading-none sm:text-3xl">{px}</p>
        </div>
      </div>
      <div className="grid items-start lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <div className="order-2 min-w-0 border-t border-gold/30 lg:order-1 lg:border-t-0 lg:border-r">
          <div className="max-h-64 overflow-hidden lg:max-h-[28rem]">
            <Kline bars={bars.length ? bars : mark > 0 ? [{ t: Math.floor(Date.now() / 1000), o: mark, h: mark, l: mark, c: mark }] : []} mark={mark} lang={lang} desk={`perp-${coin}`} />
          </div>
        </div>
        <form
          className="order-1 flex flex-col gap-2 p-3 lg:order-2"
          onSubmit={(event) => {
            event.preventDefault();
            setNote(zh
              ? `${sym} 和 BEM 是同一份规则的永续：保证金锁进合约，按标记结算。能撮合的结算本仍是 BEM。这一对的结算合约还没接上，所以没有发单，USDT 也不会扣，也不会走现货兑换。`
              : `${sym} uses the same perpetual rules as BEM: margin locks in the contract and settles on the mark. The book that can match is still BEM. This pair's settlement contract is not attached, so nothing was sent, no USDT moved, and it did not swap spot.`);
          }}
        >
          <div className="grid grid-cols-2 border border-gold">
            <button type="button" className={`min-h-12 text-sm ${side === "long" ? "bg-ink text-white" : "text-up"}`} onClick={() => setSide("long")}>{zh ? "开多" : "Long"}</button>
            <button type="button" className={`min-h-12 text-sm ${side === "short" ? "bg-sell text-white" : "text-sell"}`} onClick={() => setSide("short")}>{zh ? "开空" : "Short"}</button>
          </div>
          <label className="grid gap-1 text-xs text-ink/55">
            {zh ? "保证金 USDT" : "Margin USDT"}
            <input value={margin} onChange={(event) => setMargin(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
          </label>
          <div className="grid grid-cols-4 gap-1">
            {[3, 5, 10, 20].map((n) => (
              <button key={n} type="button" onClick={() => setLev(n)} className={`min-h-11 border font-mono text-xs ${lev === n ? "border-ink bg-ink text-paper" : "border-gold"}`}>{n}×</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <p className="border border-gold/40 px-2 py-2"><span className="block text-ink/45">{zh ? "强平价" : "Liq"}</span><span className="font-mono">{liq(mark, lev, side === "long")}</span></p>
            <p className="border border-gold/40 px-2 py-2"><span className="block text-ink/45">{zh ? "千分之二" : "0.20%"}</span><span className="font-mono">{fee} USDT</span></p>
          </div>
          <p className="text-[11px] leading-5 text-ink/55">{zh ? "绑了邀请人：这笔手续费的 6% 给邀请人，你少付 4%，90% 进收费地址。规则和 BEM 永续相同。" : "With a referrer, 6% of the fee goes to them, you pay 4% less, and 90% goes to the fee address. Same rule as the BEM perpetual."}</p>
          <button type="submit" className={`min-h-12 text-sm text-white ${side === "long" ? "bg-ink" : "bg-sell"}`}>{side === "long" ? (zh ? `开多 ${sym}` : `Long ${sym}`) : zh ? `开空 ${sym}` : `Short ${sym}`}</button>
          {note ? <p className="text-xs leading-5 text-ink/70">{note}</p> : null}
        </form>
      </div>
    </section>
  );
}
