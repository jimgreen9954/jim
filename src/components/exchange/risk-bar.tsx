import { useEffect, useState } from "react";
import { closePerp, deployRisk, priorBook, readPerp, riskOf, type Desk } from "@/lib/perp";
import { currentAccount } from "@/lib/wallet";

export function RiskBar({
  zh,
  chain,
  coin,
  onUse,
}: {
  zh: boolean;
  chain: Desk;
  coin: string;
  onUse: (address: string) => void;
}) {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [oldIds, setOldIds] = useState<bigint[]>([]);

  useEffect(() => {
    const saved = coin === "bem" ? riskOf(chain) : "";
    setAddr(saved);
    if (!saved) return;
    const prior = priorBook(chain);
    if (prior.toLowerCase() === saved.toLowerCase()) return;
    readPerp(prior, currentAccount())
      .then((view) => {
        const me = (currentAccount() ?? "").toLowerCase();
        setOldIds(view.liveDeals.filter((deal) => deal.long.toLowerCase() === me || deal.short.toLowerCase() === me).map((deal) => deal.id));
      })
      .catch(() => setOldIds([]));
  }, [chain, coin]);

  const go = async () => {
    setBusy(true);
    setNote("");
    try {
      const from = currentAccount();
      if (!from) throw new Error("fee");
      const next = await deployRisk(from, chain);
      setAddr(next);
      onUse(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setNote(message === "fee" ? (zh ? "只有收费地址能部署。" : "Only the fee address can deploy.") : zh ? "没有部署。" : "Not deployed.");
    } finally {
      setBusy(false);
    }
  };

  return null;
}
