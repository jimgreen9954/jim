import type { ReactNode } from "react";

export function SideRail({ items, children }: { items: { key: string; label: string; on: boolean; run: () => void }[]; children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[7.25rem_minmax(0,1fr)] lg:items-start lg:gap-3">
      <nav className="mb-3 flex gap-4 overflow-x-auto lg:sticky lg:top-16 lg:mb-0 lg:flex lg:flex-col lg:gap-1">
        {items.map((item) => (
          <button key={item.key} type="button" onClick={item.run} className={`shrink-0 border-l-2 py-1.5 pl-2 text-left text-sm ${item.on ? "border-ink font-medium text-ink" : "border-transparent text-ink/45"}`}>
            {item.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
