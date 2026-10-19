import { useState, type ReactNode } from "react";

export function SideRail({ items, children }: { items: { key: string; label: string; on: boolean; run: () => void }[]; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const current = items.find((item) => item.on) ?? items[0];
  return (
    <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[7.25rem_minmax(0,1fr)] lg:items-stretch lg:gap-3">
      <div className="mb-3 lg:sticky lg:top-16 lg:mb-0">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-11 w-full items-center justify-between border border-gold px-3 text-left text-sm lg:hidden">
          <span className={current?.on ? "font-medium" : ""}>{current?.label}</span>
          <span className="text-xs text-ink/50">{open ? "▲" : "▼"}</span>
        </button>
        <nav className={`${open ? "mt-1 max-h-64 overflow-y-auto border border-gold" : "hidden"} lg:mt-0 lg:flex lg:max-h-none lg:flex-col lg:gap-1 lg:overflow-visible lg:border-0`}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                item.run();
                setOpen(false);
              }}
              className={`block w-full border-l-2 py-2 pl-3 text-left text-sm lg:py-1.5 lg:pl-2 ${item.on ? "border-ink font-medium text-ink" : "border-transparent text-ink/45"}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 min-w-0 lg:h-full">{children}</div>
    </div>
  );
}
