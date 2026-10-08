import { useEffect, useState } from "react";
import { SealRebateBox } from "@/components/exchange/seal-rebate";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { evalMatch } from "@/lib/match-engine";
import { connectXLayer, countSeal, processorUrl, tapeSeal, txUrl } from "@/lib/xlayer";
import { currentAccount, onAccount } from "@/lib/wallet";

export function ChipMark({ className, hot }: { className?: string; hot?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={className ?? "size-12 text-gold"} aria-hidden>
      <rect x="14" y="14" width="36" height="36" fill="var(--color-card)" stroke="currentColor" strokeWidth="1.4" />
      {Array.from({ length: 4 }, (_, i) => (
        <g key={i}>
          <rect x={18 + i * 8} y="6" width="3" height="8" fill="currentColor" />
          <rect x={18 + i * 8} y="50" width="3" height="8" fill="currentColor" />
          <rect x="6" y={18 + i * 8} width="8" height="3" fill="currentColor" />
          <rect x="50" y={18 + i * 8} width="8" height="3" fill="currentColor" />
        </g>
      ))}
      <rect
        x="24"
        y="24"
        width="16"
        height="16"
        fill={hot ? "var(--color-foil)" : "none"}
        stroke="currentColor"
      />
    </svg>
  );
}

export function SealStamp() {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [sealCount, setSealCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    if (!account) {
      setSealCount(null);
      return;
    }
    let dead = false;
    countSeal(account)
      .then((n) => {
        if (!dead) setSealCount(n);
      })
      .catch(() => {
        if (!dead) setSealCount(null);
      });
    return () => {
      dead = true;
    };
  }, [account, busy]);

  const onStamp = async () => {
    setBusy(true);
    setNote(lang === "zh" ? "正在连接钱包。请在弹出的窗口里确认。" : "Connecting the wallet. Confirm the popup.");
    try {
      const from = await Promise.race([
        account ? Promise.resolve(account) : connectXLayer(),
        new Promise<string>((_, reject) => {
          window.setTimeout(() => reject(new Error("timeout")), 20000);
        }),
      ]);
      setAccount(from);
      let have = await countSeal(from);
      setSealCount(have);
      const need = Math.max(0, 3 - have);
      if (need === 0) {
        setNote(lang === "zh" ? "三盏都亮了。下面用这三盏登记。盘口费率不变，登记后才能领回一半。" : "All three lamps are lit. Register them below. The book fee stays. Half can be claimed after registration.");
        return;
      }
      setNote(
        lang === "zh"
          ? `钱包会按还差的次数逐笔确认，一共 ${need} 笔。每笔烧掉 3 个 NAND，支付 0.0013 OKB。`
          : `The wallet asks once for each lamp still missing, ${need} in all. Each burns 3 NAND and pays 0.0013 OKB.`,
      );
      let hash = "";
      for (let i = 0; i < need; i += 1) {
        hash = await tapeSeal(from);
        have += 1;
        setSealCount(have);
      }
      setNote(lang === "zh" ? "三张印鉴已在处理器上。再点下面的登记。订单簿费率没变。" : "Three seals are on the processor. Register below. The book fee is unchanged.");
      window.open(txUrl(hash), "_blank", "noopener,noreferrer");
    } catch (err) {
      const timedOut = err instanceof Error && err.message === "timeout";
      setNote(
        timedOut
          ? lang === "zh"
            ? "钱包没有弹出。先点右上角连接钱包，再回来点这一下。"
            : "No wallet popup. Connect from the top right, then tap this again."
          : lang === "zh"
            ? "流片没有完成。已成功的笔数还在。先连接钱包，并确认 NAND 和 OKB 够。"
            : "Tape-out stopped. Circuits that already landed still count. Connect the wallet, and check NAND and OKB.",
      );
    } finally {
      setBusy(false);
    }
  };

  const lit = Math.min(sealCount ?? 0, 3);
  return (
    <div className="border border-gold/40 p-3">
      <h3 className="font-display text-2xl italic">{c.seal}</h3>
      <SealLamps lit={lit} lang={lang} />
      <p className="mt-3 text-sm leading-relaxed">{lit >= 3 ? c.sealDone : c.sealHint}</p>
      <button
        type="button"
        onClick={onStamp}
        disabled={busy || lit >= 3}
        className="mt-3 min-h-12 w-full border border-gold bg-ink text-paper disabled:opacity-60"
      >
        {busy ? (lang === "zh" ? "签名中" : "Signing") : lit >= 3 ? (lang === "zh" ? "三盏都亮了" : "All three lit") : c.stamp}
      </button>
      {note ? <p className="mt-2 text-sm leading-relaxed">{note}</p> : null}
      <p className="mt-3 text-sm leading-relaxed">
        {lang === "zh"
          ? `这个钱包 ${sealCount == null ? "还没连接" : `${lit} / 3`}。灯不改盘口费率。永续成交仍收千分之二。登记之后，这一半从领取池领回，推荐少付的部分按少付之后再算。`
          : `This wallet ${sealCount == null ? "is not connected" : `${lit} / 3`}. Lamps do not change the book fee. Perps still charge 0.20%. After registration, half is claimed from the pool. A referrer discount is applied before that half.`}
      </p>
    </div>
  );
}

export function DiePanel() {
  const lang = useExchange((s) => s.lang);
  const clock = useExchange((s) => s.engine.clock);
  const lastMine = useExchange((s) => s.engine.lastMine);
  const c = copy[lang];
  const [bid, setBid] = useState(true);
  const [ask, setAsk] = useState(true);
  const lamp = evalMatch(bid, ask);
  const hot = clock - lastMine < 4;

  return (
    <section className="relative overflow-hidden border border-gold bg-card p-4 shadow-plate">
      <div className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full border border-gold/30" />
      <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full border border-dashed border-gold/40" />
      <div className="relative">
        <p className="text-xs tracking-widest text-gold">{c.specimen}</p>
        <div className="mt-3 flex items-center gap-4">
          <DieFace clock={clock} hot={hot} />
          <div>
            <h2 className="font-display text-3xl italic leading-none">TAPELIQUID</h2>
            <p className="mt-2 text-xs tracking-widest text-gold">{c.match}</p>
            <p className="mt-1 font-mono text-xs tabular-nums">CLK {String(clock).padStart(6, "0")}</p>
          </div>
        </div>

        <div className="mt-5 border border-gold/40 p-3">
          <p className="text-xs tracking-widest text-gold">{c.probe}</p>
          <p className="mt-1 text-sm leading-relaxed">{c.probeHint}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Pad on={bid} label={c.bidPad} onClick={() => setBid((v) => !v)} />
            <Pad on={ask} label={c.askPad} onClick={() => setAsk((v) => !v)} />
            <Lamp on={lamp} label={c.lamp} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink/70">{c.netlistBody}</p>
        </div>

        <div className="mt-4">
          <SealStamp />
        </div>
        <SealRebateBox />

        <details className="mt-4 border border-gold/40 p-3">
          <summary className="cursor-pointer font-display text-lg italic">{c.brief}</summary>
          <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed">
            <p>{c.briefP1}</p>
            <p>{c.briefP2}</p>
            <p className="text-xs tracking-widest text-gold">{c.reqTitle}</p>
            <ul className="list-disc pl-4">
              <li>{c.req1}</li>
              <li>{c.req2}</li>
              <li>{c.req3}</li>
            </ul>
            <p className="text-ink/70">{c.demo}</p>
            <p className="flex gap-4">
              <a className="underline decoration-gold underline-offset-4" href="https://ignix.bot/x_campaign" target="_blank" rel="noreferrer">
                {c.linkHack}
              </a>
              <a className="underline decoration-gold underline-offset-4" href={processorUrl()} target="_blank" rel="noreferrer">
                {c.linkTape}
              </a>
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function DieFace({ clock, hot }: { clock: number; hot: boolean }) {
  return (
    <svg viewBox="0 0 120 120" className="size-28 shrink-0 text-gold" aria-hidden>
      <rect x="22" y="22" width="76" height="76" fill="var(--color-card)" stroke="currentColor" />
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <rect x={30 + i * 11} y="8" width="4" height="14" fill="currentColor" />
          <rect x={30 + i * 11} y="98" width="4" height="14" fill="currentColor" />
          <rect x="8" y={30 + i * 11} width="14" height="4" fill="currentColor" />
          <rect x="98" y={30 + i * 11} width="14" height="4" fill="currentColor" />
        </g>
      ))}
      {Array.from({ length: 16 }, (_, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        const on = (clock + i) % 11 < 4 || (hot && i === clock % 16);
        return (
          <rect
            key={i}
            x={34 + col * 14}
            y={34 + row * 14}
            width="10"
            height="10"
            fill={on ? "var(--color-foil)" : "none"}
            stroke="currentColor"
          />
        );
      })}
    </svg>
  );
}

function Pad({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`min-h-11 min-w-16 border border-gold px-3 ${on ? "bg-foil" : "bg-card"}`}>
      {label}
      <span className="ml-1 font-mono text-xs">{on ? "1" : "0"}</span>
    </button>
  );
}

function SealLamps({ lit, lang }: { lit: number; lang: "zh" | "en" }) {
  const lamps = [
    { name: lang === "zh" ? "金" : "Gold", fill: "bg-gold", ring: "border-gold" },
    { name: lang === "zh" ? "铜" : "Copper", fill: "bg-[#b87333]", ring: "border-[#b87333]" },
    { name: lang === "zh" ? "朱" : "Vermilion", fill: "bg-sell", ring: "border-sell" },
  ];
  return (
    <div className="mt-3 flex flex-wrap gap-4">
      {lamps.map((lamp, i) => (
        <span key={lamp.name} className="inline-flex min-h-11 items-center gap-2">
          <span className={`inline-block size-4 rounded-full border ${lamp.ring} ${i < lit ? lamp.fill : "bg-card"}`} />
          <span className="text-sm">
            {lamp.name} {i < lit ? (lang === "zh" ? "亮" : "on") : lang === "zh" ? "灭" : "off"}
          </span>
        </span>
      ))}
    </div>
  );
}

function Lamp({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="inline-flex min-h-11 items-center gap-2 px-1">
      <span className={`inline-block size-4 rounded-full border border-gold ${on ? "bg-foil" : "bg-card"}`} />
      <span className="text-sm">
        {label} {on ? "1" : "0"}
      </span>
    </span>
  );
}
