type Line = { k: string; v: string; href?: string };

export function SignCard({
  title,
  lines,
  warn,
  yes,
  no,
  onYes,
  onNo,
}: {
  title: string;
  lines: Line[];
  warn?: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
      <section className="max-h-[85vh] w-full max-w-lg overflow-auto border border-gold bg-card p-4 shadow-plate">
        <h2 className="font-display text-3xl italic">{title}</h2>
        <dl className="mt-3 flex flex-col gap-2">
          {lines.map((line) => (
            <div key={line.k} className="border-b border-gold/30 pb-2">
              <dt className="text-xs tracking-widest text-gold">{line.k}</dt>
              <dd className="mt-1 break-all font-mono text-sm">
                {line.href ? (
                  <a className="underline decoration-gold underline-offset-4" href={line.href} target="_blank" rel="noreferrer">
                    {line.v}
                  </a>
                ) : (
                  line.v
                )}
              </dd>
            </div>
          ))}
        </dl>
        {warn ? <p className="mt-3 text-sm leading-6 text-sell">{warn}</p> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="min-h-12 border border-gold" onClick={onNo}>
            {no}
          </button>
          <button type="button" className="min-h-12 bg-ink text-paper" onClick={onYes}>
            {yes}
          </button>
        </div>
      </section>
    </div>
  );
}
