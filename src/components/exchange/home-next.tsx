import { useState } from "react";
import { connectBsc } from "@/lib/bsc";
import { BSC_SAFE, XLAYER_SAFE } from "@/lib/chain-marks";
import { deployLend, type LendAsset, type LendChain } from "@/lib/lend";
import { deployTerm, type TermChain } from "@/lib/term";
import { connectXLayer } from "@/lib/xlayer";

type Row =
  | { id: string; kind: "term"; chain: TermChain; zh: string; en: string; where: string }
  | { id: string; kind: "lend"; chain: LendChain; asset: LendAsset; zh: string; en: string; where: string };

const ROWS: Row[] = [
  { id: "term-x", kind: "term", chain: "xlayer", zh: "期贷", en: "Term", where: "X Layer" },
  { id: "term-b", kind: "term", chain: "bsc", zh: "期贷", en: "Term", where: "BSC" },
  { id: "lend-xt", kind: "lend", chain: "xlayer", asset: "tape", zh: "借贷 TAPE", en: "Lend TAPE", where: "X Layer" },
  { id: "lend-xb", kind: "lend", chain: "xlayer", asset: "bem", zh: "借贷 BEM", en: "Lend BEM", where: "X Layer" },
  { id: "lend-bb", kind: "lend", chain: "bsc", asset: "bem", zh: "借贷 BEM", en: "Lend BEM", where: "BSC" },
];

export function HomeNext({ zh }: { zh: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const sign = (row: Row) => {
    setBusy(row.id);
    setNote("");
    void (async () => {
      try {
        const from = row.chain === "xlayer" ? await connectXLayer() : await connectBsc();
        const safe = row.chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE;
        if (safe.toLowerCase() !== from.toLowerCase()) {
          setNote(zh ? "只有多签钱包能部署。" : "Only the multisig can deploy.");
          return;
        }
        const landed = row.kind === "term" ? await deployTerm(row.chain) : await deployLend(row.chain, row.asset);
        setNote(
          zh
            ? `已部署 ${landed}。把这行地址发我。我写进页面，旧池留着还款和取出，再把这个按钮撤掉。`
            : `Deployed ${landed}. Send this address. I will pin it, leave the old pool for repayment and withdrawal, and remove this button.`,
        );
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "second"
            ? zh
              ? "还要另一位多签签名。"
              : "It still needs the second multisig signature."
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
    <section className="mt-2 border border-gold bg-card">
      <p className="px-3 py-2 text-xs leading-5 text-ink/70">
        {zh
          ? "新借贷和新期贷还没上链。只有多签能点。旧池不关。部署后把地址发我，我再撤掉对应按钮。"
          : "The new lending pools and term books are not live. Only the multisig can deploy. Old pools stay. Send each address and I will remove that button."}
      </p>
      {ROWS.map((row) => (
        <div key={row.id} className="flex min-h-12 items-center gap-2 border-t border-gold/30 px-3">
          <span className="w-24 shrink-0 text-sm">{zh ? row.zh : row.en}</span>
          <span className="text-xs text-ink/50">{row.where}</span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => sign(row)}
            className="ml-auto min-h-11 shrink-0 border border-gold bg-ink px-3 text-sm text-paper disabled:opacity-40"
          >
            {busy === row.id ? "…" : zh ? "部署" : "Deploy"}
          </button>
        </div>
      ))}
      {note ? <p className="break-all border-t border-gold/30 px-3 py-2 font-mono text-[11px]">{note}</p> : null}
    </section>
  );
}
