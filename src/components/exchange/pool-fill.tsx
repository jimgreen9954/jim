import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { connectXLayer } from "@/lib/xlayer";
import { currentAccount } from "@/lib/wallet";
import { rememberFill, TradeLog, TradeQuota } from "@/components/exchange/trade-foot";
import {
  poolAmount,
  poolBalances,
  poolText,
  previewPool,
  swapPool,
  type PoolQuote,
} from "@/lib/tape-open-swap";

export function PoolFill({ zh, side }: { zh: boolean; side: "buy" | "sell" }) {
  const [quote, setQuote] = useState<PoolQuote>(0);
  const [amount, setAmount] = useState("");
  const [out, setOut] = useState("");
  const [bal, setBal] = useState<{ bem: bigint; okb: bigint; tape: bigint } | null>(null);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const tapeIn = side === "sell";
  const decimals = tapeIn ? 8 : quote === 0 ? 8 : 18;
  const unit = tapeIn ? "TAPE" : quote === 0 ? "BEM" : "OKB";

  useEffect(() => {
    let dead = false;
    const pull = async () => {
      try {
        const from = account;
        if (!from || dead) return;
        setAccount(from);
        setBal(await poolBalances(from as Hex));
      } catch {
        if (!dead) setBal(null);
      }
    };
    void pull();
    const id = window.setInterval(pull, 12_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [account]);

  useEffect(() => {
    let dead = false;
    const raw = amount.trim();
    if (!raw) {
      setOut("");
      return;
    }
    let amountIn = 0n;
    try {
      amountIn = poolAmount(raw, decimals);
    } catch {
      setOut("");
      return;
    }
    previewPool(quote, tapeIn, amountIn)
      .then((got) => {
        if (!dead) setOut(got > 0n ? poolText(got, tapeIn ? (quote === 0 ? 8 : 18) : 8) : "");
      })
      .catch(() => {
        if (!dead) setOut("");
      });
    return () => {
      dead = true;
    };
  }, [amount, quote, tapeIn, decimals]);

  const held = !bal
    ? 0n
    : tapeIn
      ? bal.tape
      : quote === 0
        ? bal.bem
        : bal.okb > 2_000_000_000_000_000n
          ? bal.okb - 2_000_000_000_000_000n
          : 0n;

  const fill = (pct: number) => {
    if (held <= 0n) return;
    setAmount(poolText((held * BigInt(pct)) / 100n, decimals));
  };

  const go = async () => {
    setBusy(true);
    setBad(false);
    setNote("");
    try {
      const from = account ?? (await connectXLayer());
      setAccount(from);
      const amountIn = poolAmount(amount, decimals);
      if (amountIn <= 0n || amountIn > held) throw new Error("amount");
      await swapPool(from, quote, tapeIn, amountIn);
      rememberFill(`${zh ? (side === "buy" ? "买入" : "卖出") : side} ${amount} ${unit}`);
      setAmount("");
      setOut("");
      setBal(await poolBalances(from as Hex));
    } catch (err) {
      setBad(true);
      const message = err instanceof Error ? err.message : "";
      setNote(
        message === "fee"
          ? zh
            ? "收费地址不对，没有签名。"
            : "Fee address mismatch. Not signed."
          : message === "gas"
            ? zh
              ? "OKB 要留下手续费。"
              : "Keep OKB for gas."
            : zh
              ? "没有成交。"
              : "No fill.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setQuote(0)}
          className={`h-9 text-sm ${quote === 0 ? "bg-ink" : "border border-gold/40 text-ink/70"}`}
        >
          BEM
        </button>
        <button
          type="button"
          onClick={() => setQuote(1)}
          className={`h-9 text-sm ${quote === 1 ? "bg-ink" : "border border-gold/40 text-ink/70"}`}
        >
          OKB
        </button>
      </div>
      <TradeQuota
        zh={zh}
        buy={
          bal
            ? `${poolText(quote === 0 ? bal.bem : bal.okb > 2_000_000_000_000_000n ? bal.okb - 2_000_000_000_000_000n : 0n, quote === 0 ? 8 : 18)} ${quote === 0 ? "BEM" : "OKB"}`
            : "—"
        }
        sell={bal ? `${poolText(bal.tape, 8)} TAPE` : "—"}
      />
      <label className="mt-2 block border border-gold/40 px-2 py-2">
        <span className="text-[11px] text-ink/45">{unit}</span>
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          className="w-full bg-transparent font-mono text-xl outline-none"
        />
      </label>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {[25, 50, 75, 100].map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => fill(pct)}
            className="h-7 border border-gold/30 font-mono text-[11px] text-ink/60"
          >
            {pct}%
          </button>
        ))}
      </div>
      <p className="mt-2 font-mono text-sm">
        {out ? `→ ${out} ${tapeIn ? (quote === 0 ? "BEM" : "OKB") : "TAPE"}` : "—"}
      </p>
      <button
        type="button"
        disabled={busy || !amount.trim()}
        onClick={() => void go()}
        className={`mt-2 h-11 w-full text-sm disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell text-[#fff7f8]"}`}
      >
        {busy
          ? zh
            ? "等待钱包"
            : "Waiting"
          : side === "buy"
            ? zh
              ? "买入 TAPE"
              : "Buy TAPE"
            : zh
              ? "卖出 TAPE"
              : "Sell TAPE"}
      </button>
      {note ? <p className={`mt-2 text-xs ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      <TradeLog zh={zh} />
    </div>
  );
}
