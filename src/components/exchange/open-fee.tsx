import { useEffect, useState } from "react";
import { txUrl as bscTx } from "@/lib/bsc";
import { openFees, payOpenFee, subscribeOpenFees, type OpenFeeView } from "@/lib/fee-pack";
import { TxPending } from "@/lib/chain-marks";
import { currentAccount, onAccount } from "@/lib/wallet";
import { txUrl as xTx } from "@/lib/xlayer";

function link(row: OpenFeeView): string {
  return row.chainId === 56 ? bscTx(row.hash) : xTx(row.hash);
}

export function OpenFeeBar({ zh }: { zh: boolean }) {
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [rows, setRows] = useState<OpenFeeView[]>([]);
  const [busy, setBusy] = useState<56 | 196 | null>(null);
  const [confirm, setConfirm] = useState<56 | 196 | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    const load = () => setRows(openFees(account));
    load();
    return subscribeOpenFees(load);
  }, [account]);
  if (!rows.length) return null;
  const pay = async (row: OpenFeeView, takeOver = false) => {
    if (!account) return;
    setBusy(row.chainId);
    setNote(null);
    try {
      await payOpenFee(account, row.chainId, takeOver);
      setConfirm(null);
      setNote(zh ? "手续费已补。成交没有重做。" : "The fee is paid. The fill was not sent again.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "pending" || err instanceof TxPending)
        setNote(zh ? "回执还没读到。先打开这笔哈希，不要再点成交。" : "The receipt is not back. Open the hash. Do not tap the trade again.");
      else if (message === "fee-silent") {
        setConfirm(row.chainId);
        setNote(
          zh
            ? "另一个页面没有应答。这一页不会自动补。只有确认那个页面已经关掉，才接手。"
            : "The other page did not answer. This page will not pay on its own. Continue only if you confirm that page is closed.",
        );
      } else if (message === "fee-open")
        setNote(zh ? "另一个页面还在等钱包。这一页没有补。" : "The other page is still waiting on the wallet. This page did not pay.");
      else setNote(zh ? "手续费没签上。成交没有重做。" : "The fee was not signed. The fill was not sent again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mx-2 mt-2 border border-sell px-3 py-2 text-xs sm:mx-3">
      <p className="text-sell">
        {zh
          ? "有一笔成交已经上链，手续费还没扣。不要再点成交。这一条只补手续费。另一个页面如果正在等钱包，这里不会再发，也不会因为没应答就自动接手。同一笔编号再付，链上会失败。每笔仍要钱包确认。"
          : "A fill is already on chain and the fee is still open. Do not tap the trade again. This row pays only the fee. Another tab waiting on the wallet is not paid again, and silence does not take over. Paying the same id again fails on chain. Each payment still needs the wallet."}
      </p>
      {rows.map((row) => (
        <div key={row.chainId} className="mt-2 flex flex-wrap items-center gap-2">
          <a className="font-mono text-ink/70 underline" href={link(row)} target="_blank" rel="noreferrer">
            {row.hash}
          </a>
          <button
            type="button"
            className="min-h-9 border border-sell px-2 text-sell"
            disabled={busy !== null}
            onClick={() => void pay(row)}
          >
            {busy === row.chainId ? "…" : zh ? "只补手续费" : "Pay the fee only"}
          </button>
          {confirm === row.chainId ? (
            <button
              type="button"
              className="min-h-9 border border-sell px-2 text-sell"
              disabled={busy !== null}
              onClick={() => void pay(row, true)}
            >
              {zh ? "那个页面已经关掉" : "That page is closed"}
            </button>
          ) : null}
        </div>
      ))}
      {note ? <p className="mt-1">{note}</p> : null}
    </div>
  );
}
