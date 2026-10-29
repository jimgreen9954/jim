import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  cycleBook,
  readPrefs,
  resetLayout,
  useDeskPrefs,
  writePrefs,
  type DeskPrefs,
} from "@/lib/desk-prefs";

const REV = "ef9c8a9";

function Toggle({ on, flip }: { on: boolean; flip: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={flip}
      className={`relative h-[22px] w-10 shrink-0 rounded-full transition-colors ${on ? "bg-[#3ddec8]" : "bg-ink/20"}`}
    >
      <span
        className={`absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-all ${on ? "left-[20px]" : "left-[2px]"}`}
      />
    </button>
  );
}

export function SettingsMenu({ zh }: { zh: boolean }) {
  const prefs = useDeskPrefs();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onDown = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && (box.current?.contains(node) || panel.current?.contains(node)))
        return;
      setOpen(false);
    };
    const id = window.setTimeout(() => {
      window.addEventListener("keydown", onKey);
      window.addEventListener("pointerdown", onDown);
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const flip = (key: keyof DeskPrefs) => {
    const next = !readPrefs()[key];
    writePrefs({ [key]: next });
    if (
      key === "notifyFill" &&
      next &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
  };

  const row = (key: keyof DeskPrefs, label: string) => (
    <div key={key} className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm">{label}</span>
      <Toggle on={Boolean(prefs[key])} flip={() => flip(key)} />
    </div>
  );

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-label={zh ? "设置" : "Settings"}
        aria-expanded={open}
        onClick={() => setOpen((on) => !on)}
        className="grid size-9 place-items-center rounded-md text-ink/80 hover:bg-foil"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M4 8h9M17 8h3" />
          <circle cx="15" cy="8" r="2" />
          <path d="M4 16h3M11 16h9" />
          <circle cx="9" cy="16" r="2" />
        </svg>
        <span className="menu-word">{zh ? "设置" : "Settings"}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              className="pop-in fixed right-2 top-[calc(env(safe-area-inset-top)+3.25rem)] z-[80] max-h-[min(32rem,calc(100dvh-5rem))] w-[min(20rem,calc(100vw-1rem))] overflow-auto rounded-2xl border border-gold/40 bg-card p-4 shadow-plate sm:right-3"
            >
              <p className="text-xs text-ink/45">{zh ? "交易" : "Trade"}</p>
              {row("keepAlive", zh ? "保持交易连接" : "Stay connected")}
              {row("orderConfirm", zh ? "下单确认" : "Confirm orders")}
              {row("closeConfirm", zh ? "平仓确认" : "Confirm closes")}
              {row("closeAllHold", zh ? "持有至全部仓位平仓" : "Close flattens every position")}
              {row("delayGuard", zh ? "交易延迟保护" : "Stale-data guard")}
              {row("dustSweep", zh ? "现货零钱清理" : "Spot dust sweep")}
              <div className="my-2 border-t border-gold/30" />
              <p className="text-xs text-ink/45">{zh ? "订单簿" : "Book"}</p>
              {row("bookSetsSize", zh ? "点击订单簿设置数量" : "Click the book to set size")}
              {row("bookAnimate", zh ? "动画订单簿" : "Animate the book")}
              <div className="my-2 border-t border-gold/30" />
              <p className="text-xs text-ink/45">{zh ? "显示" : "Display"}</p>
              {row("chartPrints", zh ? "在图表上显示买卖" : "Prints on the chart")}
              {row("showPnl", zh ? "显示盈亏" : "Show PnL")}
              <div className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>{zh ? "布局" : "Layout"}</span>
                <span className="flex gap-3 text-[#3ddec8]">
                  <button type="button" onClick={() => cycleBook()}>
                    {zh ? "编辑" : "Edit"}
                  </button>
                  <button type="button" onClick={() => resetLayout()}>
                    {zh ? "重置" : "Reset"}
                  </button>
                </span>
              </div>
              <div className="my-2 border-t border-gold/30" />
              <p className="text-xs text-ink/45">{zh ? "通知与声音" : "Alerts"}</p>
              {row("notifyFill", zh ? "显示后台成交通知" : "Background fill alerts")}
              {row("soundFill", zh ? "成交时播放声音" : "Sound on fill")}
              {row("showWarnings", zh ? "显示所有警告" : "Show warnings")}
              {row("verboseErrors", zh ? "显示详细错误信息" : "Verbose errors")}
              <p className="mt-3 font-mono text-[11px] text-ink/35">rev 2026-10-26-{REV}</p>
              <div className="mt-3 flex justify-end gap-3 border-t border-gold/30 pt-3 text-xs text-ink/70">
                <a href="/whitepaper">{zh ? "文档" : "Docs"}</a>
                <a href="#rules">{zh ? "支持" : "Support"}</a>
                <a href="/whitepaper">{zh ? "条款" : "Terms"}</a>
                <a href="/whitepaper">{zh ? "隐私政策" : "Privacy"}</a>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
