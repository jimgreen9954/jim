import { useState } from "react";

export function SymbolMenu({
  label,
  note,
  items,
}: {
  label: string;
  note?: string;
  zh?: boolean;
  items: { id: string; title: string; note?: string; on: boolean; run: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex min-h-12 w-full items-center justify-between gap-3 border border-gold bg-card px-3 text-left">
        <span className="min-w-0">
          <span className="block font-mono text-sm">{label}</span>
          {note ? <span className="block text-[11px] text-ink/50">{note}</span> : null}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-ink/45">{open ? "–" : "+"}</span>
      </button>
      {open ? (
        <ul className="mt-1 max-h-72 overflow-y-auto border border-gold bg-card">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  item.run();
                  setOpen(false);
                }}
                className={`flex min-h-12 w-full flex-col justify-center px-3 text-left ${item.on ? "bg-ink text-paper" : ""}`}
              >
                <span className="font-mono text-sm">{item.title}</span>
                {item.note ? <span className={`text-[11px] ${item.on ? "text-paper/70" : "text-ink/50"}`}>{item.note}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
