import { useRef, useState, type ReactNode } from "react";

/** Hover text. It stays while the pointer is on the label or the note, then disappears. */
export function Hint({ label, text }: { label: ReactNode; text: ReactNode }) {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const show = (event: { currentTarget: HTMLElement }) => {
    if (timer.current) window.clearTimeout(timer.current);
    const rect = event.currentTarget.getBoundingClientRect();
    setBox({ x: rect.left, y: rect.bottom + 6 });
  };
  const hide = () => {
    timer.current = window.setTimeout(() => setBox(null), 220);
  };
  return (
    <span
      className="cursor-help underline decoration-dotted underline-offset-4"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {label}
      {box ? (
        <span
          role="tooltip"
          className="fixed z-[80] w-72 border border-gold bg-paper px-3 py-2 text-left text-[13px] font-normal normal-case leading-6 tracking-normal text-ink shadow-plate"
          style={{ left: Math.max(8, Math.min(box.x, window.innerWidth - 304)), top: Math.min(box.y, window.innerHeight - 220) }}
          onMouseEnter={() => { if (timer.current) window.clearTimeout(timer.current); }}
          onMouseLeave={hide}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
