import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { jumpChain } from "@/components/exchange/desk-home";
import { currentDesk, type Desk } from "@/lib/perp";
import {
  connectKind,
  connectScan,
  currentAccount,
  disconnectWallet,
  binanceWcLink,
  onAccount,
  onOpenLink,
  onPairUri,
  onPhoneAsk,
  switchDeskChain,
  tapBlank,
  walletLabel,
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
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [pair, setPair] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "binance" | "okx">(null);
  const codeRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => onOpenLink(setLink), []);
  useEffect(() => onPairUri(setPair), []);
  useEffect(() => onPhoneAsk(setPhone), []);
  useEffect(() => {
    const canvas = codeRef.current;
    if (!canvas || !pair) return;
    QRCode.toCanvas(canvas, pair, { width: 180, margin: 1, errorCorrectionLevel: "M" }).catch(
      () => undefined,
    );
  }, [pair, open]);
  const enter = () => {
    setEntered(true);
    setOpen(false);
    setAsk(null);
  };
  const leave = () => {
    setEntered(false);
    setOpen(false);
    void disconnectWallet();
  };
  const fail = (err: unknown) => {
    if (err instanceof Error && err.message === "wc-project") {
      setNote(
        zh
          ? "扫码还差 WalletConnect 项目号。配上之后，OKX、小狐狸、币安都能扫，每一笔都在手机上确认。"
          : "Scan needs a WalletConnect project id. OKX, MetaMask and Binance then confirm every trade on the phone.",
      );
      return;
    }
    if (err instanceof Error && err.message === "binanceapp") {
      setNote(
        zh
          ? "没有自动打开币安。允许弹出窗口，或点「打开币安」。连上之后，买卖会再到币安里点确认。"
          : "Binance did not open. Allow pop-ups, or tap Open Binance. After it connects, each trade asks Binance to confirm.",
      );
      return;
    }
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (message === "nowallet") {
      setNote(
        zh
          ? "没有连上。手机上要点确认，并允许这个页面看到地址。"
          : "Not connected. Confirm on the phone and allow this page to see the address.",
      );
      return;
    }
    setNote(code === 4001 ? c.walletReject : message || c.walletNo);
  };
  const run = (job: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    job()
      .then(() => enter())
      .catch(fail)
      .finally(() => setBusy(false));
  };
  if (compact) {
    const binance =
      ask === "binance" ||
      Boolean(link && (link.includes("binance.com") || link.startsWith("bnc:"))) ||
      walletLabel() === "币安";
    const openText = binance ? (zh ? "打开币安钱包" : "Open Binance Wallet") : zh ? "打开OKX钱包" : "Open OKX Wallet";
    return (
      <span className="relative flex items-center gap-1">
        {link ? (
          <a
            href={link}
            {...(tapBlank(link) ? { target: "_blank", rel: "noreferrer" } : {})}
            className="inline-flex h-8 items-center border border-gold bg-ink px-2 text-xs text-paper"
          >
            {openText}
          </a>
        ) : null}
        <button
          type="button"
          className="h-8 max-w-[5.5rem] truncate rounded-md border border-gold px-2 text-xs"
          onClick={() => setOpen((on) => !on)}
        >
          {account ? short(account) : zh ? "登录" : "Log in"}
        </button>
        {open ? (
          <>
            <button
              type="button"
              aria-label={zh ? "关闭" : "Close"}
              className="fixed inset-0 z-30 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div className="absolute right-0 top-full z-40 mt-2 w-60 border border-gold bg-card p-3 shadow-plate">
              {account ? (
                <button type="button" className="mb-2 h-10 w-full border border-gold text-sm" onClick={leave}>
                  {zh ? "退出" : "Log out"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                className="mb-2 h-10 w-full bg-ink text-sm text-paper disabled:opacity-40"
                onClick={() => {
                  setAsk("okx");
                  run(() => connectKind("okx"));
                }}
              >
                OKX
              </button>
              <button
                type="button"
                disabled={busy}
                className="h-10 w-full border border-gold text-sm disabled:opacity-40"
                onClick={() => {
                  setAsk("binance");
                  run(() => connectKind("binance"));
                }}
              >
                {zh ? "币安" : "Binance"}
              </button>
              {link ? (
                <a
                  href={link}
                  {...(tapBlank(link) ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="mt-2 flex h-10 items-center justify-center bg-ink text-sm text-paper"
                >
                  {openText}
                </a>
              ) : null}
              {pair ? (
                <div className="mt-3 grid justify-items-center gap-1">
                  <canvas ref={codeRef} width={180} height={180} />
                  <p className="text-center text-[11px] leading-4 text-ink/55">
                    {zh ? "用币安或 OKX 扫这个码。这一页不要关。" : "Scan with Binance or OKX. Leave this page open."}
                  </p>
                </div>
              ) : null}
              {note ? <p className="mt-2 text-xs text-sell">{note}</p> : null}
            </div>
          </>
        ) : null}
        {ask || link ? (
          <div className="fixed inset-x-3 bottom-[4.5rem] z-[70] border border-gold bg-card p-3 shadow-plate">
            <p className="text-sm">
              {link
                ? zh
                  ? "点下面去钱包里确认。这一页留着，确认后回来。"
                  : "Open the wallet below. This page stays. Come back after you confirm."
                : zh
                  ? "正在连接钱包…"
                  : "Connecting the wallet…"}
            </p>
            {link ? (
              <a
                href={link}
                {...(tapBlank(link) ? { target: "_blank", rel: "noreferrer" } : {})}
                className="mt-2 flex h-11 items-center justify-center bg-ink text-sm text-paper"
              >
                {openText}
              </a>
            ) : null}
            {pair && binance ? (
              <a
                href={binanceWcLink(pair)}
                className="mt-2 flex h-11 items-center justify-center border border-gold text-sm"
              >
                {zh ? "打不开就点这里" : "If that did not open"}
              </a>
            ) : null}
            {note ? <p className="mt-2 text-xs text-sell">{note}</p> : null}
            <button
              type="button"
              className="mt-2 h-9 w-full text-xs text-ink/55"
              onClick={() => setAsk(null)}
            >
              {zh ? "取消" : "Cancel"}
            </button>
          </div>
        ) : null}
      </span>
    );
  }
  if (account && entered) {
    return (
      <span
        className={`flex items-center gap-1 ${compact ? "max-w-[6.2rem]" : "max-w-[18rem] flex-wrap sm:max-w-none sm:gap-2"}`}
      >
        <span
          className={`inline-flex min-h-9 items-center rounded-md border border-gold bg-card px-3 font-mono text-xs text-ink/90 ${compact ? "max-w-full truncate px-2" : ""}`}
        >
          {short(account)}
        </span>
        {compact || !phone ? null : (
          <span className="inline-flex min-h-10 items-center border border-gold bg-ink px-2 text-xs text-paper">
            {zh ? `打开${phone}点确认` : `Confirm in ${phone}`}
          </span>
        )}
        {!link ? null : (
          <a
            href={link}
            {...(tapBlank(link) ? { target: "_blank", rel: "noreferrer" } : {})}
            className="inline-flex min-h-9 shrink-0 items-center border border-gold bg-ink px-2 text-xs text-paper"
          >
            {zh ? "去确认" : "Confirm"}
          </a>
        )}
        {compact ? null : (
          <button
            type="button"
            className="min-h-8 shrink-0 px-1 text-xs text-ink/50 sm:min-h-11 sm:border sm:border-gold sm:px-3 sm:text-ink"
            onClick={leave}
          >
            {zh ? "退出" : "Out"}
          </button>
        )}
      </span>
    );
  }
  const binance = link?.includes("binance.com");
  return (
    <span className="relative">
      <button
        type="button"
        className="min-h-9 rounded-md bg-ink px-3 text-sm text-paper"
        onClick={() => setOpen((on) => !on)}
      >
        {zh ? "登录" : "Log in"}
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-label={zh ? "关闭" : "Close"}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-40 mt-2 w-60 border border-gold bg-card p-3 shadow-plate">
            {account ? (
              <div className="mb-3 border-b border-gold/40 pb-3">
                <p className="font-mono text-xs">{short(account)}</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="h-9 flex-1 bg-ink text-sm text-paper" onClick={enter}>
                    {zh ? "进入" : "Enter"}
                  </button>
                  <button type="button" className="h-9 flex-1 border border-gold text-sm" onClick={leave}>
                    {zh ? "退出" : "Out"}
                  </button>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              disabled={busy}
              className="mb-2 h-10 w-full bg-ink text-sm text-paper disabled:opacity-40"
              onClick={() => run(() => connectKind("okx"))}
            >
              {zh ? "浏览器钱包" : "Browser wallet"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="mb-2 h-10 w-full border border-gold text-sm disabled:opacity-40"
              onClick={() => run(() => connectScan())}
            >
              {zh ? "扫码登录" : "Scan to log in"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="h-10 w-full border border-gold text-sm text-ink/80 disabled:opacity-40"
              onClick={() => {
                setNote(zh ? "点打开币安。这一页留着，确认后回来。" : "Tap Open Binance. This page stays. Come back after you confirm.");
                run(() => connectKind("binance"));
              }}
            >
              {zh ? "币安" : "Binance"}
            </button>
            {pair ? (
              <div className="mt-3 grid justify-items-center gap-1">
                <canvas ref={codeRef} width={180} height={180} />
                <p className="text-center text-[11px] leading-4 text-ink/55">
                  {zh
                    ? "OKX、小狐狸或币安扫一次。连上之后，BSC 和 X Layer 都在手机上签名。"
                    : "One scan with OKX, MetaMask or Binance. BSC and X Layer then both sign on the phone."}
                </p>
              </div>
            ) : null}
            {link ? (
              <a
                href={link}
                {...(tapBlank(link) ? { target: "_blank", rel: "noreferrer" } : {})}
                className="mt-2 flex h-10 items-center justify-center border border-gold text-sm"
              >
                {binance ? (zh ? "打开币安钱包" : "Open Binance Wallet") : zh ? "打开OKX钱包" : "Open OKX Wallet"}
              </a>
            ) : null}
            {note ? <p className="mt-2 text-xs text-sell">{note}</p> : null}
          </div>
        </>
      ) : null}
    </span>
  );
}
