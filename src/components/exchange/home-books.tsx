import { useEffect, useState } from "react";
import { BSC_SAFE, XLAYER_SAFE } from "@/lib/chain-marks";
import { coinBook, deployCoin, type CoinBook } from "@/lib/perp";
import { deployLend } from "@/lib/lend";
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
  const [step, setStep] = useState(0);
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
        const allow = [row.chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE];
        if (!allow.some((who) => who.toLowerCase() === from.toLowerCase())) {
          setNote(zh ? "只有多签钱包能部署。" : "Only the multisig can deploy.");
          return;
        }
        const { book } = await deployCoin(from, row.coin, setStep);
        setBooks((prev) => ({ ...(prev ?? {}), [row.coin]: book }));
        window.dispatchEvent(new CustomEvent("tape-coin-book", { detail: { coin: row.coin, book } }));
        setNote(
          zh
            ? `已部署 ${book}。把这行地址发我，我写进页面，再把这个按钮撤掉。`
            : `Deployed ${book}. Send this address. I will pin it and remove this button.`,
        );
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "fee"
            ? zh
              ? "只有多签钱包能部署。"
              : "Only the multisig can deploy."
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
  if (open.length === 0 && !note) return null;

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
              {busy === row.coin ? (zh ? (step <= 1 ? "标记" : "永续") : "Sign") : zh ? "部署" : "Deploy"}
            </button>
          </div>
        );
      })}
      {note ? <p className="break-all border-t border-gold/30 px-3 py-2 font-mono text-[11px]">{note}</p> : null}
    </section>
  );
}

type Patch = { id: "tape" | "bem"; zh: string; en: string };

const PATCHES: Patch[] = [
  { id: "tape", zh: "TAPE 借贷", en: "TAPE lend" },
  { id: "bem", zh: "BEM 借贷", en: "BEM lend" },
];

function patchKey(row: Patch) {
  return `tl-lend-fix2:${row.id}`;
}

function patchSaved(): Record<string, string> {
  const next: Record<string, string> = {};
  for (const row of PATCHES) {
    const own = window.localStorage.getItem(patchKey(row)) ?? "";
    if (/^0x[a-fA-F0-9]{40}$/.test(own)) next[row.id] = own;
  }
  return next;
}

export function HomePatch({ zh }: { zh: boolean }) {
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    setDone(patchSaved());
  }, []);

  const sign = (row: Patch) => {
    setBusy(row.id);
    setNote("");
    void (async () => {
      try {
        const from = await connectXLayer();
        if (from.toLowerCase() !== XLAYER_SAFE.toLowerCase()) {
          setNote(zh ? "只有 X Layer 多签能部署。" : "Only the X Layer multisig can deploy.");
          return;
        }
        const landed = await deployLend("xlayer", row.id);
        window.localStorage.setItem(patchKey(row), landed);
        setDone((prev) => ({ ...prev, [row.id]: landed }));
        setNote(
          zh
            ? `已部署 ${landed}。不能撤回。新池是空的，旧池里的钱不会搬过来。把这行地址发我。`
            : `Deployed ${landed}. It cannot be revoked. The new pool is empty. Funds in the old pool do not move. Send this address.`,
        );
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "second"
            ? zh
              ? "还要第二位多签签名。"
              : "A second multisig signature is still required."
            : code === "leader" || code === "fee"
              ? zh
                ? "只有多签钱包能部署。"
                : "Only the multisig can deploy."
              : zh
                ? "没部署成。"
                : "It did not deploy.",
        );
      } finally {
        setBusy(null);
      }
    })();
  };

  return (
    <section className="border border-gold bg-card">
      <p className="border-b border-gold/30 px-3 py-2 text-xs text-ink/70">
        {zh
          ? "刚才两口只挡住了过期时间。价格每次最多走 0.5%，时间却被记成新的，还能按偏高的价借款。这两口是空的。再各签一次。旧池里已有的钱不会搬过来。"
          : "The two pools just signed only reject an old timestamp. A price that is still walking toward the market is treated as fresh, so a borrow can use a high value. Both pools are empty. Sign each once more. Money already in an older pool does not move."}
      </p>
      {PATCHES.map((row) => (
        <div key={row.id} className="flex min-h-12 items-center gap-2 border-t border-gold/30 px-3">
          <span className="w-28 shrink-0 text-sm">{zh ? row.zh : row.en}</span>
          <span className="text-xs text-ink/50">X Layer</span>
          <span className="truncate font-mono text-[11px] text-ink/70">{done[row.id] ?? ""}</span>
          <button
            type="button"
            disabled={busy !== null || Boolean(done[row.id])}
            onClick={() => sign(row)}
            className="ml-auto min-h-11 shrink-0 border border-gold bg-ink px-3 text-sm text-paper disabled:opacity-40"
          >
            {busy === row.id ? (zh ? "签名" : "Sign") : done[row.id] ? (zh ? "已部署" : "Deployed") : zh ? "部署" : "Deploy"}
          </button>
        </div>
      ))}
      {note ? <p className="break-all border-t border-gold/30 px-3 py-2 font-mono text-[11px]">{note}</p> : null}
    </section>
  );
}
