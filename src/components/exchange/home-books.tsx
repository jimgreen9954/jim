import { useEffect, useState } from "react";
import { FEE_TO, BSC_SAFE, XLAYER_SAFE } from "@/lib/chain-marks";
import { coinBook, deployCoin, type CoinBook } from "@/lib/perp";
import { connectBsc } from "@/lib/bsc";
import { connectXLayer } from "@/lib/xlayer";

const ROWS: { coin: CoinBook; zh: string; en: string; chain: "bsc" | "xlayer"; where: string }[] = [
  { coin: "btc", zh: "BTC 永续", en: "BTC perp", chain: "bsc", where: "BSC" },
  { coin: "eth", zh: "ETH 永续", en: "ETH perp", chain: "bsc", where: "BSC" },
  { coin: "zec", zh: "ZEC 永续", en: "ZEC perp", chain: "bsc", where: "BSC" },
  { coin: "up", zh: "UP 永续", en: "UP perp", chain: "bsc", where: "BSC" },
  { coin: "tape", zh: "TAPE 永续", en: "TAPE perp", chain: "xlayer", where: "X Layer" },
];

function saved(): Record<string, string> {
  const next: Record<string, string> = {};
  for (const row of ROWS) next[row.coin] = coinBook(row.chain, row.coin);
  return next;
}

export function HomeBooks({ zh }: { zh: boolean }) {
  const [books, setBooks] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, setStep] = useState(0);
  const [note, setNote] = useState("");

  useEffect(() => {
    setBooks(saved());
  }, []);

  if (!books) return null;

  const sign = (row: (typeof ROWS)[number]) => {
    setBusy(row.coin);
    setNote("");
    setStep(1);
    void (async () => {
      try {
        const from = row.chain === "xlayer" ? await connectXLayer() : await connectBsc();
        const allow = [FEE_TO, row.chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE];
        if (!allow.some((who) => who.toLowerCase() === from.toLowerCase())) {
          setNote(zh ? "只有收费地址能签。" : "Only the fee address can sign.");
          return;
        }
        const { book } = await deployCoin(from, row.coin, setStep);
        setBooks((prev) => ({ ...(prev ?? {}), [row.coin]: book }));
        window.dispatchEvent(new CustomEvent("tape-coin-book", { detail: { coin: row.coin, book } }));
        setNote("");
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "fee"
            ? zh
              ? "只有收费地址能签。"
              : "Only the fee address can sign."
            : code === "price"
              ? zh
                ? "标记价对不上，这一本没部署。"
                : "The mark did not match. This book was not deployed."
              : zh
                ? "没部署成。"
                : "It did not deploy.",
        );
      } finally {
        setBusy(null);
        setStep(0);
      }
    })();
  };

  const open = ROWS.filter((row) => !books[row.coin]);
  if (open.length === 0) return null;

  return (
    <section className="border border-gold bg-card">
      {open.map((row) => {
        return (
          <div
            key={row.coin}
            className="flex min-h-12 items-center gap-2 border-t border-gold/30 px-3 first:border-t-0"
          >
            <span className="w-24 shrink-0 text-sm">{zh ? row.zh : row.en}</span>
            <span className="text-xs text-ink/50">{row.where}</span>
            <span className="font-mono text-xs">0.20%</span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => sign(row)}
              className="ml-auto min-h-11 shrink-0 border border-gold bg-ink px-3 text-sm text-paper disabled:opacity-40"
            >
              {busy === row.coin ? (zh ? "签名" : "Sign") : zh ? "部署" : "Deploy"}
            </button>
          </div>
        );
      })}
      {note ? <p className="break-all border-t border-gold/30 px-3 py-2 font-mono text-[11px]">{note}</p> : null}
    </section>
  );
}
