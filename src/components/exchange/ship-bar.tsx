import { useEffect, useState } from "react";
import { BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { deployExitVault } from "@/lib/ship-home";
import { currentAccount, onAccount } from "@/lib/wallet";

export function ShipBar({ zh }: { zh: boolean }) {
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [busy, setBusy] = useState<"bsc" | "xlayer" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [made, setMade] = useState<{ bsc?: string; xlayer?: string }>({});
  useEffect(() => onAccount(setAccount), []);
  const who = account?.toLowerCase();
  const go = (chain: "bsc" | "xlayer") => {
    const safe = chain === "bsc" ? BSC_SAFE : XLAYER_SAFE;
    if (!account) {
      setNote(zh ? "先连上对应链的多签。" : "Connect that chain's multisig first.");
      return;
    }
    if (who !== safe.toLowerCase()) {
      setNote(zh ? "只有多签能部署。" : "Only the multisig can deploy.");
      return;
    }
    setBusy(chain);
    setNote(null);
    void deployExitVault(chain, account)
      .then((addr) => {
        setMade((prev) => ({ ...prev, [chain]: addr }));
        setNote(zh ? `${chain === "bsc" ? "BSC" : "X Layer"} 金库 ${addr}` : `${chain === "bsc" ? "BSC" : "X Layer"} vault ${addr}`);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        setNote(message === "safe" ? (zh ? "只有多签能部署。" : "Only the multisig can deploy.") : message || (zh ? "没部署成。" : "It did not deploy."));
      })
      .finally(() => setBusy(null));
  };
  return (
    <section id="deploy" className="border border-gold bg-card px-3 py-3 text-sm">
      <p className="text-[11px] tracking-[0.16em] text-gold">{zh ? "部署" : "Deploy"}</p>
      <p className="mt-1 text-xs text-ink/70">
        {zh
          ? "新金库跟现在的 BEM 永续。有份额的人可以申请退出，6 小时后任何人可以强制平掉金库的单。用多签签名。部署完把地址发我，我再撤掉这个按钮。"
          : "The new vault follows the current BEM book. A shareholder can ask to exit. After 6 hours anyone can force that vault flat. Sign with the multisig. Send me the address and I will remove this button."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="h-10 border border-gold px-3 text-xs disabled:opacity-50" disabled={busy !== null} onClick={() => go("bsc")}>
          {busy === "bsc" ? (zh ? "部署中" : "Deploying") : zh ? "部署 BSC 金库" : "Deploy the BSC vault"}
        </button>
        <button type="button" className="h-10 border border-gold px-3 text-xs disabled:opacity-50" disabled={busy !== null} onClick={() => go("xlayer")}>
          {busy === "xlayer" ? (zh ? "部署中" : "Deploying") : zh ? "部署 X Layer 金库" : "Deploy the X Layer vault"}
        </button>
      </div>
      {made.bsc ? <p className="mt-2 break-all font-mono text-xs">BSC {made.bsc}</p> : null}
      {made.xlayer ? <p className="mt-1 break-all font-mono text-xs">X Layer {made.xlayer}</p> : null}
      {note ? <p className="mt-2 text-xs">{note}</p> : null}
    </section>
  );
}
