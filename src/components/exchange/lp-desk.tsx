import { useEffect, useState } from "react";
import { BSC, FEE_TO, txUrl } from "@/lib/bsc";
import { addLp, formatLp, listLp, LP_CRYPTO, LP_STOCKS, quoteLp, removeLp, type LpKey, type LpPosition, type LpQuote } from "@/lib/lp";
import { useExchange } from "@/lib/exchange-store";
import { connectKind, currentAccount, onAccount } from "@/lib/wallet";
import { SignCard } from "@/components/exchange/sign-card";
import { useFeeLock } from "@/lib/fee-lock";

export function LpPanel() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const lock = useFeeLock();
  const [group, setGroup] = useState<"crypto" | "stock">("crypto");
  const [key, setKey] = useState<LpKey>("bem");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<LpQuote | null>(null);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [rows, setRows] = useState<LpPosition[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [card, setCard] = useState(false);
  const books = group === "crypto" ? LP_CRYPTO : LP_STOCKS;
  const book = books.find((item) => item.key === key) ?? books[0];

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    if (!account) {
      setRows([]);
      return;
    }
    let dead = false;
    listLp(account)
      .then((next) => {
        if (!dead) setRows(next);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [account, hash]);

  useEffect(() => {
    if (!amount.trim()) {
      setQuote(null);
      return;
    }
    let dead = false;
    quoteLp(book.key, amount)
      .then((next) => {
        if (!dead) setQuote(next);
      })
      .catch(() => {
        if (!dead) setQuote(null);
      });
    return () => {
      dead = true;
    };
  }, [amount, book.key]);

  const fail = (err: unknown) => {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (code === 4001) setNote(zh ? "你在钱包里取消了。" : "You cancelled in the wallet.");
    else if (message === "usdt") setNote(zh ? "USDT 不够。" : "Not enough USDT.");
    else if (message === "asset") setNote(zh ? `${book.zh} 不够。按池子现价，两边都要有。` : `Not enough ${book.en}. Both sides are required at the pool price.`);
    else if (message === "bnb") setNote(zh ? "BNB 不够。要留下约 0.003 付 gas。" : "Not enough BNB. Leave about 0.003 for gas.");
    else if (message === "empty") setNote(zh ? "这口池子还没有价。" : "This pool has no price yet.");
    else if (message === "reverted") setNote(zh ? "链上拒绝了。台费如果已经转出，不会自动退回。" : "The chain rejected it. A fee already sent is not returned.");
    else setNote(message || (zh ? "没完成。" : "Not finished."));
    setBad(true);
  };

  const shown = quote ? formatLp(book, quote) : null;

  return (
    <div className="grid gap-0 lg:grid-cols-12">
      <div className="border-b border-gold/40 p-3 lg:col-span-7 lg:border-r lg:border-b-0">
        <p className="text-sm leading-7 text-ink/80">
          {zh
            ? "只填 USDT。另一边按这口池子的现价配平，做成全区间。凭证留在你的钱包，页面不保管。撤回拿回两边，BNB 池拿回的是 BNB。"
            : "Type USDT only. The other side is matched to the pool price, across the full range. The position stays in your wallet. Withdrawing returns both sides. A BNB pool returns BNB."}
        </p>
        <div className="mt-3 grid grid-cols-2">
          {(["crypto", "stock"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setGroup(item);
                setKey(item === "crypto" ? "bem" : "spy");
                setAmount("");
              }}
              className={`min-h-9 border border-gold text-sm ${group === item ? "bg-ink text-paper" : ""}`}
            >
              {item === "crypto" ? (zh ? "加密货币" : "Crypto") : zh ? "美股" : "US stocks"}
            </button>
          ))}
        </div>
        <div className={`mt-2 grid ${group === "crypto" ? "grid-cols-4" : "grid-cols-3"}`}>
          {books.map((item) => (
            <button key={item.key} type="button" onClick={() => setKey(item.key)} className={`min-h-9 border border-gold font-mono text-xs ${book.key === item.key ? "bg-ink text-paper" : ""}`}>
              {zh ? item.zh : item.en}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs tracking-widest text-gold">{zh ? "我的流动性" : "My liquidity"}</p>
        {rows.length === 0 ? <p className="mt-2 text-sm text-ink/60">{zh ? "这个地址在本站这些池子里还没有仓位。" : "This address has no position in these pools."}</p> : null}
        <ul className="mt-2 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={String(row.id)} className="flex items-center justify-between gap-2 border border-gold/40 px-2 py-2">
              <span className="font-mono text-sm">#{row.id.toString()} · {zh ? row.labelZh : row.labelEn} / USDT</span>
              <button
                type="button"
                className="min-h-9 border border-gold px-2 text-xs"
                disabled={busy || lock.status !== "ok"}
                onClick={() => {
                  if (!account) return;
                  setBusy(true);
                  setBad(false);
                  setNote(zh ? "先退出，再付台费。" : "Exit first, then the fee.");
                  removeLp(account, row.id)
                    .then((tx) => {
                      setHash(tx);
                      setNote(null);
                    })
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                {zh ? "一键撤回" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <form
        className="flex flex-col gap-3 p-3 lg:sticky lg:top-28 lg:col-span-5 lg:self-start"
        onSubmit={(event) => {
          event.preventDefault();
          if (!account || !quote || lock.status !== "ok") return;
          setCard(true);
        }}
      >
        <p className="font-mono text-xs text-ink/70">{account ? `${zh ? "已连接" : "Connected"} ${account.slice(0, 6)}…${account.slice(-4)}` : zh ? "未连接" : "Not connected"}</p>
        <label className="border border-gold/40 px-3 py-2">
          <span className="block text-xs tracking-widest text-gold">{zh ? "放入 USDT" : "USDT in"}</span>
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0" className="w-full bg-transparent font-mono text-3xl outline-none" />
        </label>
        <p className="border border-gold/40 px-3 py-2">
          <span className="block text-xs tracking-widest text-gold">{zh ? "按现价还要" : "Also, at the pool price"}</span>
          <span className="font-mono text-2xl tabular-nums">{shown ? `${shown.asset} ${zh ? book.zh : book.en}` : "—"}</span>
        </p>
        <p className="font-mono text-xs text-ink/70">
          {zh ? "台费" : "Fee"} {shown ? `${shown.feeUsdt} USDT + ${shown.feeAsset} ${zh ? book.zh : book.en}` : "—"}
          {" · "}
          {zh ? "千分之二，和现货同一地址" : "0.20%, same address as spot"}
        </p>
        <button type="button" className="text-left font-mono text-xs underline decoration-gold" onClick={() => void navigator.clipboard?.writeText(FEE_TO)}>
          {FEE_TO}
        </button>
        {!account ? (
          <button
            type="button"
            className="min-h-12 border border-gold"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              connectKind("okx")
                .then(setAccount)
                .catch(fail)
                .finally(() => setBusy(false));
            }}
          >
            {zh ? "用 OKX 连接" : "Connect OKX"}
          </button>
        ) : (
          <button type="submit" className="min-h-12 bg-ink text-paper disabled:opacity-40" disabled={busy || lock.status !== "ok" || !quote}>
            {zh ? "一键添加" : "Add liquidity"}
          </button>
        )}
        {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        {hash ? (
          <a className="text-sm underline decoration-gold" href={txUrl(hash)} target="_blank" rel="noreferrer">
            {zh ? "交易" : "Transaction"}
          </a>
        ) : null}
        {card && quote && shown ? (
          <SignCard
            title={zh ? "签名前看一眼" : "Before you sign"}
            yes={zh ? "签名并添加" : "Sign and add"}
            no={zh ? "取消" : "Cancel"}
            warn={zh ? "会连续签几笔：先付台费，再授权，最后把流动性铸进你的钱包。中途取消，已经转出的台费不退。" : "Several signatures: the fee, the approvals, then the position in your wallet. A fee already sent is not returned."}
            onNo={() => setCard(false)}
            onYes={() => {
              setCard(false);
              if (!account) return;
              setBusy(true);
              setBad(false);
              setNote(zh ? "等钱包确认…" : "Waiting for the wallet…");
              addLp(account, book.key, amount)
                .then((tx) => {
                  setHash(tx);
                  setNote(null);
                  setAmount("");
                })
                .catch(fail)
                .finally(() => setBusy(false));
            }}
            lines={[
              { k: zh ? "池子" : "Pool", v: `${zh ? book.zh : book.en} / USDT`, href: `${BSC.explorer}/address/${book.pool}` },
              { k: zh ? "放入" : "Deposit", v: `${shown.usdt} USDT + ${shown.asset} ${zh ? book.zh : book.en}` },
              { k: zh ? "台费" : "Fee", v: `${shown.feeUsdt} USDT + ${shown.feeAsset} ${zh ? book.zh : book.en}` },
              { k: zh ? "收费地址" : "Fee address", v: FEE_TO, href: `${BSC.explorer}/address/${FEE_TO}` },
              { k: zh ? "范围" : "Range", v: zh ? "全区间" : "Full range" },
              { k: zh ? "凭证" : "Receipt", v: zh ? "留在这个钱包" : "Stays in this wallet" },
            ]}
          />
        ) : null}
      </form>
    </div>
  );
}
