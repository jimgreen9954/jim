import { useEffect, useRef, useState } from "react";
import { jumpChain } from "@/components/exchange/desk-home";
import { currentDesk, type Desk } from "@/lib/perp";
import {
  connectKind,
  currentAccount,
  disconnectWallet,
  onAccount,
  onOpenLink,
  switchDeskChain,
} from "@/lib/wallet";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ChainSwitch({
  compact = false,
  onJump,
}: {
  compact?: boolean;
  onJump?: (side: "spot" | "perp") => void;
}) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [desk, setDesk] = useState<Desk>("bsc");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<Desk | null>(null);
  const gen = useRef(0);
  useEffect(() => {
    const on = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (next === "bsc" || next === "xlayer") setDesk(next);
    };
    window.addEventListener("tape-desk-chain", on);
    setDesk(currentDesk());
    setReady(true);
    return () => window.removeEventListener("tape-desk-chain", on);
  }, []);
  const pick = (next: Desk) => {
    const view = jumpChain(next);
    onJump?.(view.kind === "perp" ? "perp" : "spot");
    if (!currentAccount()) return;
    const mine = ++gen.current;
    setBusy(next);
    void switchDeskChain(next === "bsc" ? 56 : 196)
      .catch(() => undefined)
      .finally(() => {
        if (gen.current === mine) setBusy(null);
      });
  };
  const item = (next: Desk, mark: string, label: string, onClass: string) => {
    const on = ready && desk === next;
    return (
      <button
        type="button"
        aria-pressed={on}
        title={
          zh
            ? next === "bsc"
              ? "切到 BSC 交易"
              : "切到 X Layer 交易"
            : next === "bsc"
              ? "Trade on BSC"
              : "Trade on X Layer"
        }
        className={`${on ? onClass : ""}${busy === next ? " busy" : ""}`}
        onClick={() => pick(next)}
      >
        <img src={mark} alt="" width={18} height={18} decoding="async" />
        <span>{label}</span>
      </button>
    );
  };
  return (
    <div className="chain-switch shrink-0" role="group" aria-label={zh ? "切换链" : "Switch chain"}>
      {item("bsc", "/coins/bnb.png", "BSC", "on-bsc")}
      {item("xlayer", "/coins/okb.svg", compact ? "X" : "X Layer", "on-x")}
    </div>
  );
}

export function ConnectButton({ compact = false }: { compact?: boolean } = {}) {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => onOpenLink(setLink), []);
  if (link && !account) {
    const binance = link.includes("binance.com");
    return (
      <span className="flex max-w-[18rem] flex-wrap items-center gap-1 sm:max-w-none sm:gap-2">
        <a
          href={link}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center border border-gold bg-ink px-3 text-sm text-paper"
        >
          {binance
            ? lang === "zh"
              ? "打开币安"
              : "Open Binance"
            : lang === "zh"
              ? "去 OKX 确认"
              : "Confirm in OKX"}
        </a>
        <span className="text-[11px] leading-4 text-ink/55">
          {lang === "zh" ? "这一页不跳走" : "This page stays"}
        </span>
      </span>
    );
  }
  if (account) {
    return (
      <span
        className={`flex items-center gap-1 ${compact ? "max-w-[6.2rem]" : "max-w-[18rem] flex-wrap sm:max-w-none sm:gap-2"}`}
      >
        <span
          className={`inline-flex min-h-9 items-center rounded-md border border-gold bg-card px-3 font-mono text-xs text-ink/90 ${compact ? "max-w-full truncate px-2" : ""}`}
        >
          {short(account)}
        </span>
        {compact ? null : link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center border border-gold bg-ink px-2 text-xs text-paper sm:min-h-11 sm:text-sm"
          >
            {lang === "zh" ? "去 OKX 确认" : "Confirm in OKX"}
          </a>
        ) : null}
        {compact ? null : (
          <button
            type="button"
            className="min-h-8 shrink-0 px-1 text-xs text-ink/50 sm:min-h-11 sm:border sm:border-gold sm:px-3 sm:text-ink"
            onClick={() => void disconnectWallet()}
          >
            {lang === "zh" ? "退出" : "Out"}
          </button>
        )}
      </span>
    );
  }
  if (compact) {
    return (
      <button
        type="button"
        className="h-8 rounded-md border border-gold px-3 text-xs disabled:opacity-40"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          connectKind("okx")
            .catch(() => undefined)
            .finally(() => setBusy(false));
        }}
      >
        {lang === "zh" ? "连接" : "Connect"}
      </button>
    );
  }
  return (
    <span className="flex gap-1 sm:gap-2">
      {(["okx", "binance"] as const).map((which) => (
        <button
          key={which}
          type="button"
          className={`min-h-9 rounded-md px-3 text-sm disabled:opacity-40 ${which === "okx" ? "bg-ink text-paper" : "border border-gold text-ink/80"}`}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNote(
              lang === "zh"
                ? "停在这一页。去 OKX 点确认，不要让网站跳进去。"
                : "Stay on this page. Confirm in OKX. Do not open the site inside it.",
            );
            connectKind(which)
              .catch((err: unknown) => {
                if (err instanceof Error && err.message === "binanceapp") return;
                const code = (err as { code?: number }).code;
                const message = err instanceof Error ? err.message : "";
                setNote(code === 4001 ? c.walletReject : message || c.walletNo);
              })
              .finally(() => setBusy(false));
          }}
        >
          {which === "okx"
            ? lang === "zh"
              ? "连接"
              : "Connect"
            : lang === "zh"
              ? "币安"
              : "Binance"}
        </button>
      ))}
      {note ? <span className="self-center text-xs text-sell">{note}</span> : null}
    </span>
  );
}
