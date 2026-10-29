import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useExchange, type Locale } from "@/lib/exchange-store";
import type { NumStyle } from "@/lib/format";

const NUMS: { id: NumStyle; label: string }[] = [
  { id: "us", label: "1,234.56" },
  { id: "eu", label: "1.234,56" },
  { id: "plain", label: "1234,56" },
  { id: "space", label: "1 234,56" },
];

const LANGS: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
  { id: "zh", label: "简体中文" },
  { id: "ko", label: "한국어" },
  { id: "es", label: "Español" },
];

const WORD = {
  num: {
    zh: "数字格式",
    en: "Number format",
    fr: "Format des nombres",
    ko: "숫자 형식",
    es: "Formato numérico",
  },
  lang: { zh: "语言", en: "Language", fr: "Langue", ko: "언어", es: "Idioma" },
  reset: { zh: "重置", en: "Reset", fr: "Réinitialiser", ko: "재설정", es: "Restablecer" },
} as const;

export function LocaleMenu() {
  const locale = useExchange((s) => s.locale);
  const num = useExchange((s) => s.num);
  const setLocale = useExchange((s) => s.setLocale);
  const setNum = useExchange((s) => s.setNum);
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !btn.current) return;
    const place = () => {
      const rect = btn.current?.getBoundingClientRect();
      if (!rect) return;
      setBox({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    const close = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && (btn.current?.contains(node) || panel.current?.contains(node)))
        return;
      setOpen(false);
    };
    const id = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={WORD.lang[locale]}
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-md text-ink/80 hover:bg-foil"
        onClick={() => setOpen((on) => !on)}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 4c2.2 2.4 2.2 13.6 0 16M12 4c-2.2 2.4-2.2 13.6 0 16" />
        </svg>
      </button>
      {open && box
        ? createPortal(
            <div
              ref={panel}
              className="fixed z-[80] w-44 rounded-lg border border-gold bg-card py-2 text-sm text-ink shadow-plate"
              style={{ top: box.top, right: box.right }}
            >
              <p className="px-3 py-1 text-xs text-ink/45">{WORD.num[locale]}</p>
              {NUMS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`block w-full px-3 py-1.5 text-left ${num === row.id ? "text-up" : "text-ink/80"}`}
                  onClick={() => setNum(row.id)}
                >
                  {row.label}
                </button>
              ))}
              <p className="mt-2 px-3 py-1 text-xs text-ink/45">{WORD.lang[locale]}</p>
              {LANGS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`block w-full px-3 py-1.5 text-left ${locale === row.id ? "text-up" : "text-ink/80"}`}
                  onClick={() => setLocale(row.id)}
                >
                  {row.label}
                </button>
              ))}
              <div className="mx-3 my-1 border-t border-gold" />
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-up"
                onClick={() => {
                  setNum("us");
                  setLocale("zh");
                }}
              >
                {WORD.reset[locale]}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
