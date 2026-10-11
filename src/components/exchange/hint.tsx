import { useState, type ReactNode } from "react";

/** Hover text. It appears beside the label and disappears when the pointer leaves. */
export function Hint({ label, text }: { label: ReactNode; text: string }) {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="cursor-help underline decoration-dotted underline-offset-4"
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setBox({ x: rect.left, y: rect.bottom + 6 });
      }}
      onMouseLeave={() => setBox(null)}
    >
      {label}
      {box ? (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[80] w-64 border border-gold bg-paper px-3 py-2 text-left text-[13px] font-normal normal-case leading-6 tracking-normal text-ink shadow-plate"
          style={{ left: Math.max(8, Math.min(box.x, window.innerWidth - 272)), top: Math.min(box.y, window.innerHeight - 120) }}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
