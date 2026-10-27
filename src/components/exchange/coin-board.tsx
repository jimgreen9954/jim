import { useEffect, useState } from "react";
import {
  BSC,
  connectBsc,
  ERC_BOOKS,
  ercPrice,
  pretty,
  quoteExact,
  readAsset,
  readBalances,
  splitDeskFee,
  swapListed,
  TxPending,
  txUrl,
  units,
  type ErcKey,
} from "@/lib/bsc";
import { inviteCut, referrerOf } from "@/lib/invite-cut";
import { rememberFill, TradeLog, TradeQuota } from "@/components/exchange/trade-foot";
import { currentAccount, onAccount } from "@/lib/wallet";

const NAME = { btc: "BTC", eth: "ETH", zec: "ZEC" } as const;
const ZH = { btc: "比特币", eth: "以太坊", zec: "Zcash" } as const;

export function CoinBoard({ coin, lang }: { coin: "btc" | "eth" | "zec"; lang: "zh" | "en" }) {
  const zh = lang === "zh";
  const book = ERC_BOOKS[coin];
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [mark, setMark] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [floor, setFloor] = useState<bigint | null>(null);
  const [usdt, setUsdt] = useState<bigint | null>(null);
  const [asset, setAsset] = useState<bigint | null>(null);
  const [referred, setReferred] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const symbol = NAME[coin];
  const payDecimals = side === "buy" ? BSC.usdtDecimals : book.decimals;

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      ercPrice(coin).then((text) => { if (!dead) setMark(text); }).catch(() => undefined);
      const who = currentAccount();
      if (!who) return;
      readBalances(who).then((row) => { if (!dead) setUsdt(row.usdt); }).catch(() => undefined);
      readAsset(who, ERC_BOOKS[coin].token).then((row) => { if (!dead) setAsset(row); }).catch(() => undefined);
      referrerOf("bsc", who).then((whoRef) => { if (!dead) setReferred(whoRef != null); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 12000);
    return () => { dead = true; window.clearInterval(id); };
  }, [coin, account]);

  useEffect(() => {
    let dead = false;
    setOut(null);
    setFloor(null);
    try {
      const amountIn = units(amount || "0", payDecimals);
      if (amountIn <= 0n) return;
      const { swapIn } = splitDeskFee(amountIn);
      const tokenIn = side === "buy" ? BSC.usdt : book.token;
      const tokenOut = side === "buy" ? book.token : BSC.usdt;
      const outDecimals = side === "buy" ? book.decimals : BSC.usdtDecimals;
      quoteExact(tokenIn, tokenOut, swapIn, book.fee)
        .then((value) => {
          if (dead) return;
          const min = (value * BigInt(10_000 - BSC.slippageBps)) / 10_000n;
          setOut(pretty(value, outDecimals, side === "buy" ? 4 : 2));
          setFloor(min);
        })
        .catch(() => undefined);
    } catch {
      setOut(null);
      setFloor(null);
    }
    return () => { dead = true; };
  }, [amount, side, coin, payDecimals, book.token, book.fee, book.decimals]);

  let typed = 0n;
  try { typed = amount.trim() ? units(amount, payDecimals) : 0n; } catch { typed = 0n; }
  const gross = typed > 0n ? splitDeskFee(typed).fee : 0n;
  const cut = inviteCut(gross, referred);
  const purse = side === "buy" ? usdt : asset;
  const over = purse != null && typed > purse;

  const trade = () => {
    if (!floor || !amount.trim() || over) return;
    setBusy(true);
    setBad(false);
    setNote(zh ? "先在钱包确认。" : "Confirm in the wallet.");
    void (async () => {
      try {
        const from = account ?? (await connectBsc());
        setAccount(from);
        const tx = await swapListed(from, coin as ErcKey, side, amount, floor);
        setHash(tx);
        rememberFill(`${zh ? (side === "buy" ? "买入" : "卖出") : side} ${amount} ${symbol}`, txUrl(tx));
        setNote(zh ? "已经成交，币在这个钱包里。" : "Filled. The coin is in this wallet.");
        setBad(false);
      } catch (err) {
        setBad(true);
        const message = err instanceof Error ? err.message : "";
        if (message === "pending" || err instanceof TxPending) {
          if (err instanceof TxPending && err.hash) setHash(err.hash);
          setNote(zh ? "已经提交。回执还没读到，先不要再签同一笔。" : "Submitted. The receipt is not back. Do not sign the same order again.");
        } else if (/rejected|denied|4001/i.test(message)) setNote(zh ? "你取消了。" : "You cancelled.");
        else setNote(zh ? "没有成交。" : "No fill.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="border border-gold bg-card">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/30 px-3 py-3">
          <div>
            <p className="text-[11px] tracking-[0.16em] text-gold">{zh ? ZH[coin] : symbol} · BSC · USDT</p>
            <h2 className="font-display text-3xl italic leading-none">{symbol} / USDT</h2>
            <p className="mt-2 font-mono text-xs leading-5 text-ink/70">
              {zh ? `币 ${symbol} · 链 BSC · 保证金 USDT` : `Coin ${symbol} · chain BSC · margin USDT`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] tracking-widest text-gold">{zh ? "池子价" : "Pool"}</p>
            <p className="font-mono text-3xl tabular-nums leading-none">{mark ?? "—"}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px bg-gold/30 sm:grid-cols-4">
          {[
            [zh ? "币" : "Coin", symbol],
            [zh ? "链" : "Chain", "BSC"],
            [zh ? "买到" : "Lands as", coin === "btc" ? "BTCB" : symbol],
            [zh ? "池费率" : "Pool fee", `${(book.fee / 10000).toFixed(2)}%`],
          ].map(([k, v]) => (
            <p key={k} className="bg-card px-3 py-2">
              <span className="block text-[10px] text-ink/45">{k}</span>
              <span className="font-mono text-sm">{v}</span>
            </p>
          ))}
        </div>
        </div>
      <form className="border border-gold bg-card p-3" onSubmit={(event) => { event.preventDefault(); trade(); }}>
        <div className="grid grid-cols-2 border border-gold">
          <button type="button" className={`min-h-11 text-sm ${side === "buy" ? "bg-ink text-white" : "text-up"}`} onClick={() => { setSide("buy"); setAmount(""); }}>{zh ? "买入" : "Buy"}</button>
          <button type="button" className={`min-h-11 text-sm ${side === "sell" ? "bg-sell text-white" : "text-sell"}`} onClick={() => { setSide("sell"); setAmount(""); }}>{zh ? "卖出" : "Sell"}</button>
        </div>
        <TradeQuota
          zh={zh}
          buy={usdt == null ? "—" : `${pretty(usdt, BSC.usdtDecimals, 2)} USDT`}
          sell={asset == null ? "—" : `${pretty(asset, book.decimals, 4)} ${symbol}`}
        />
        <label className="mt-3 grid gap-1 text-xs text-ink/55">
          {zh ? `付出 ${side === "buy" ? "USDT" : symbol}` : `Pay ${side === "buy" ? "USDT" : symbol}`}
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base" />
        </label>
        <p className="mt-2 font-mono text-xs text-ink/60">
          {zh ? "钱包" : "Wallet"} {purse == null ? "—" : pretty(purse, payDecimals, side === "buy" ? 2 : 4)} {side === "buy" ? "USDT" : symbol}
        </p>
        <p className="mt-2 font-mono text-sm">
          {zh ? "预计到账" : "Est."} {out ?? "—"} {side === "buy" ? symbol : "USDT"}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink/60">
          {zh ? "台费" : "Fee"} {gross > 0n ? pretty(referred ? cut.charge : gross, payDecimals, 4) : "—"} {side === "buy" ? "USDT" : symbol}
        </p>
        {over ? <p className="mt-2 text-sm text-sell">{zh ? "余额不够。" : "Not enough balance."}</p> : null}
        <button type="submit" disabled={busy || over || !amount.trim() || !floor} className={`mt-3 min-h-12 w-full text-sm text-white disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell"}`}>
          {busy ? (zh ? "等待钱包" : "Waiting") : side === "buy" ? (zh ? `买入 ${symbol}` : `Buy ${symbol}`) : (zh ? `卖出 ${symbol}` : `Sell ${symbol}`)}
        </button>
        {note ? <p className={`mt-2 text-xs leading-5 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        <TradeLog zh={zh} />
        {hash ? <a className="mt-2 block text-xs underline" href={txUrl(hash)} target="_blank" rel="noreferrer">{zh ? "链上" : "Tx"}</a> : null}
      </form>
    </section>
  );
}
