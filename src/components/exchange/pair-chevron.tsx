export function PairChevron({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={`size-[18px] shrink-0 text-ink/75 transition-transform duration-200 ${up ? "rotate-180" : ""}`}>
      <path d="M4.2 7.3 10 13.1 15.8 7.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
