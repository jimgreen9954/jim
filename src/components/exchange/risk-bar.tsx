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

  return (
    <div className="border border-gold/40 p-2 text-xs leading-5">
      <p className="text-sm text-ink">{zh ? "资金费 · 保险基金 · 自动减仓" : "Funding · insurance · ADL"}</p>
      <p className="mt-1 text-ink/70">{zh ? "资金费：风险本部署后，每 8 小时按（标记 − 指数）/ 指数在这一对里划，封顶 ±0.05%。" : "Funding, once the risk book is deployed: every 8 hours, (mark − index) / index, capped at ±0.05%, inside that pair."}</p>
      <p className="text-ink/70">{zh ? "保险基金：只从强平剩余划入，没有提取函数。" : "Insurance is filled only from a liquidation remainder. There is no withdraw."}</p>
      <p className="text-ink/70">{zh ? "自动减仓：保险不够时，只减这一对的浮盈，不动本金，也不去平别人。" : "ADL, only if insurance is short, takes that pair's profit. Not principal, and not other users."}</p>
      {coin !== "bem" ? <p className="mt-1 text-ink/50">{zh ? "这一张还没接上风险本。确认不会按这三项扣钱。" : "This pair has no risk book yet. Confirm does not charge these."}</p> : addr ? (
        <p className="mt-1 break-all font-mono text-[11px]">{addr}</p>
      ) : (
        <button type="button" disabled={busy} onClick={() => void go()} className="mt-2 h-9 w-full border border-gold/50 text-sm disabled:opacity-40">
          {busy ? (zh ? "等待钱包" : "Waiting") : zh ? "收费地址部署风险本" : "Fee address deploys the risk book"}
        </button>
      )}
      {oldIds.length > 0 ? oldIds.map((id) => (
        <button key={String(id)} type="button" className="mt-1 h-8 w-full border border-gold/40 font-mono text-[11px]" onClick={() => {
          const from = currentAccount();
          if (!from) return;
          void closePerp(from, priorBook(chain), id);
        }}>{zh ? `平旧仓 ${id}` : `Close old ${id}`}</button>
      )) : null}
      {note ? <p className="mt-1 text-sell">{note}</p> : null}
    </div>
  );
}
