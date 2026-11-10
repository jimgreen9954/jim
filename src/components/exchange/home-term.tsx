import { useEffect, useState } from "react";
import { deployTerm, forgetTerm, termAddress, type TermChain } from "@/lib/term";

const ROWS: { chain: TermChain; zh: string; en: string }[] = [
  { chain: "xlayer", zh: "期贷", en: "Term", },
  { chain: "bsc", zh: "期贷", en: "Term" },
];

export function HomeTerm({ zh }: { zh: boolean }) {
  const [saved, setSaved] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const pull = () => {
    const next: Record<string, string> = {};
    for (const row of ROWS) next[row.chain] = termAddress(row.chain) ?? "";
    setSaved(next);
  };

  useEffect(() => {
    pull();
  }, []);

  if (!saved) return null;

  const sign = (chain: TermChain) => {
    if (busy) return;
    setBusy(chain);
    setNote(zh ? "请等钱包弹出。多签要两个地址各签一次。" : "Wait for the wallet. A multisig needs both signers.");
    void (async () => {
      try {
        const address = await deployTerm(chain);
        pull();
        setNote(
          zh
            ? `已部署 ${address}。把这行地址发我，我写进页面，再把这个按钮撤掉。`
            : `Deployed ${address}. Send this address. I will pin it and remove this button.`,
        );
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "leader"
            ? zh
              ? "这个钱包不是多签的签名地址。"
              : "This wallet is not a signer of the multisig."
            : code === "second"
              ? zh
                ? "已记下这个地址的签名。换成另一个签名地址再点一次。"
                : "This signature is saved. Switch to the other signer and tap again."
              : code === "pending"
                ? zh
                  ? "还在确认。不要重复提交。"
                  : "Still confirming. Do not send it again."
                : /rejected|denied|cancel/i.test(code)
                  ? zh
                    ? "已取消。"
                    : "Cancelled."
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
      {ROWS.map((row) => {
        const address = saved[row.chain] ?? "";
        return (
          <div key={row.chain} className="flex min-h-12 items-center gap-2 border-t border-gold/30 px-3 first:border-t-0">
            <span className="w-16 shrink-0 text-sm">{zh ? row.zh : row.en}</span>
            <span className="text-xs text-ink/50">{row.chain === "xlayer" ? "X Layer" : "BSC"}</span>
            {address ? (
              <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{address}</span>
            ) : (
              <span className="text-xs text-ink/45">{zh ? "每条链一份" : "One per chain"}</span>
            )}
            {address ? (
              <button
                type="button"
                className="ml-auto min-h-11 shrink-0 px-2 text-xs text-ink/60 underline"
                onClick={() => {
                  forgetTerm(row.chain);
                  pull();
                  setNote(zh ? "已忘掉。可以再部署一次。" : "Forgotten. You can deploy again.");
                }}
              >
                {zh ? "忘掉" : "Forget"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => sign(row.chain)}
                className="ml-auto min-h-11 shrink-0 border border-gold bg-ink px-3 text-sm text-paper disabled:opacity-40"
              >
                {busy === row.chain ? (zh ? "签名" : "Sign") : zh ? "部署" : "Deploy"}
              </button>
            )}
          </div>
        );
      })}
      {note ? <p className="break-all border-t border-gold/30 px-3 py-2 font-mono text-[11px]">{note}</p> : null}
    </section>
  );
}
