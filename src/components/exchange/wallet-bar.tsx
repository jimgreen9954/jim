import { useEffect, useState } from "react";
import {
  connectKind,
  currentAccount,
  currentChain,
  disconnectWallet,
  onAccount,
  onChain,
  onOpenLink,
  switchDeskChain,
  type DeskChain,
} from "@/lib/wallet";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ChainSwitch({ compact = false }: { compact?: boolean }) {
  const lang = useExchange((s) => s.lang);
  const [id, setId] = useState<number | null>(currentChain());
  const [busy, setBusy] = useState<DeskChain | null>(null);
  useEffect(() => onChain(setId), []);
  const pick = (next: DeskChain) => {
    if (busy || id === next) return;
    setBusy(next);
    void switchDeskChain(next)
      .catch(async (err: unknown) => {
        if (!(err instanceof Error) || err.message !== "nowallet") return;
        await connectKind("okx");
        await switchDeskChain(next);
      })
      .catch(() => undefined)
      .finally(() => setBusy(null));
  };
  const item = (next: DeskChain, label: string) => {
    const on = id === next;
    return (
      <button
        key={next}
        type="button"
        disabled={busy != null}
        onClick={() => pick(next)}
        className={`h-8 rounded-md px-2 text-xs disabled:opacity-40 ${on ? "bg-ink text-paper" : "text-ink/70"}`}
      >
        {busy === next ? "…" : label}
      </button>
    );
  };
  return (
    <span
      className="inline-flex h-8 items-center rounded-md border border-gold bg-card"
      aria-label={lang === "zh" ? "切换链" : "Chain"}
    >
      {item(56, "BSC")}
      {item(196, compact ? "X" : "X Layer")}
    </span>
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
