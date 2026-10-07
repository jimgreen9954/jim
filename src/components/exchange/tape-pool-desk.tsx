import { useEffect, useState } from "react";
import { useExchange } from "@/lib/exchange-store";
import { connectXLayer, XLAYER } from "@/lib/xlayer";
import { currentAccount, onAccount } from "@/lib/wallet";
import {
  addTapePool,
  OPEN_USDT,
  previewTapeSwap,
  quoteUnits,
  readTapePool,
  removeTapePool,
  showQuote,
  showTape,
  swapTapePool,
  TAPE_FEE,
  TAPE_POOL,
  TAPE_TERMS,
  tapeUnits,
  type TapePosition,
} from "@/lib/tape-pool";

function when(ts: number): string {
  if (!Number.isFinite(ts) || ts < 1_000_000_000 || ts > 10_000_000_000) return "—";
  try {
    return new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Singapore", hour12: false });
  } catch {
    return "—";
  }
}

export function TapePoolDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [quote, setQuote] = useState<0 | 1>(0);
  const [mode, setMode] = useState<"add" | "swap">("add");
  const [term, setTerm] = useState(0);
  const [tapeAmt, setTapeAmt] = useState("");
  const [quoteAmt, setQuoteAmt] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [live, setLive] = useState(false);
  const [usdtQuote, setUsdtQuote] = useState(0n);
  const [tapeReserve, setTapeReserve] = useState(0n);
  const [otherReserve, setOtherReserve] = useState(0n);
  const [balTape, setBalTape] = useState(0n);
  const [balQuote, setBalQuote] = useState(0n);
  const [positions, setPositions] = useState<TapePosition[]>([]);
  const [out, setOut] = useState<string>("—");
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const unit = quote === 0 ? "USDT0" : "BEM";

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readTapePool(account)
        .then((row) => {
          if (dead) return;
          setLive(row.live);
          setUsdtQuote(row.usdt.quote);
          const pool = quote === 0 ? row.usdt : row.bem;
          setTapeReserve(pool.tape);
          setOtherReserve(pool.quote);
          setBalTape(row.tape);
          setBalQuote(quote === 0 ? row.usdtBal : row.bemBal);
          setPositions(row.positions);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [account, quote]);

  useEffect(() => {
    const amount = side === "sell" ? tapeUnits(tapeAmt) : quoteUnits(quote, quoteAmt);
    if (amount <= 0n || !live) {
      setOut("—");
      return;
    }
    let dead = false;
    previewTapeSwap(quote, side === "sell", amount)
      .then((row) => {
        if (!dead) setOut(side === "sell" ? showQuote(quote, row.out) : showTape(row.out));
      })
      .catch(() => {
        if (!dead) setOut("—");
      });
    return () => {
      dead = true;
    };
  }, [quote, side, tapeAmt, quoteAmt, live]);

  const say = (text: string, failed = false) => {
    setBad(failed);
    setNote(text);
  };

  const go = async () => {
    setBusy(true);
    setBad(false);
    try {
      const from = account ?? (await connectXLayer());
      setAccount(from);
      if (mode === "add") {
        const tapeIn = tapeUnits(tapeAmt);
        const quoteIn = quoteUnits(quote, quoteAmt);
        if (tapeIn <= 0n || quoteIn <= 0n) throw new Error("amt");
        const hash = await addTapePool(from, quote, term, tapeIn, quoteIn);
        say(zh ? `已质押。到期前不能撤。${hash}` : `Staked. It cannot be removed early. ${hash}`);
      } else {
        if (!live) throw new Error("closed");
        const amount = side === "sell" ? tapeUnits(tapeAmt) : quoteUnits(quote, quoteAmt);
        if (amount <= 0n) throw new Error("amt");
        const hash = await swapTapePool(from, quote, side === "sell", amount);
        say(zh ? `已成交。${hash}` : `Filled. ${hash}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      say(
        message === "closed"
          ? zh ? "USDT0 还没到 5,000，买卖不开。" : "USDT0 is still under 5,000, so trading is off."
          : message === "amt"
            ? zh ? "两边都要填大于 0 的数量。" : "Both amounts have to be above zero."
            : /rejected|denied/i.test(message)
              ? zh ? "你取消了。" : "You cancelled."
              : zh ? "没有完成。币还在原处。" : "It did not finish. The tokens stayed put.",
        true,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-4 p-3 lg:grid-cols-12">
      <div className="flex flex-col gap-3 lg:col-span-7">
        <div>
          <p className="text-xs tracking-widest text-gold">X Layer · TAPE</p>
          <h2 className="font-display text-3xl italic">{zh ? "TAPE 池" : "TAPE pool"}</h2>
          <p className="mt-2 text-sm leading-relaxed">
            {zh
              ? "吃进池子的 TAPE 只能是已经领到、自己加进去的。对手是 USDT0 或 X Layer 的 BEM。加池就是质押，期限只有五档，到期才能撤回。池子合约没有管理员。USDT0 一边到 5,000，按两边等值大约 10,000 美元，买卖才打开。"
              : "TAPE in the pool is only TAPE someone already claimed and added. The other side is USDT0 or X Layer BEM. Adding is a stake, with five terms, and it comes out only at expiry. The pool has no admin. Trading opens once the USDT0 side reaches 5,000, about 10,000 dollars if both sides match."}
          </p>
        </div>
        <div className="grid grid-cols-2 border border-gold">
          {([0, 1] as const).map((id) => (
            <button key={id} type="button" onClick={() => setQuote(id)} className={`min-h-11 text-sm ${quote === id ? "bg-ink text-paper" : ""}`}>
              TAPE / {id === 0 ? "USDT0" : "BEM"}
            </button>
          ))}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="border border-gold/40 px-2 py-2">
            <dt className="text-xs text-ink/50">{zh ? "池中 TAPE" : "TAPE in pool"}</dt>
            <dd className="mt-1 font-mono">{showTape(tapeReserve)}</dd>
          </div>
          <div className="border border-gold/40 px-2 py-2">
            <dt className="text-xs text-ink/50">{zh ? `池中 ${unit}` : `${unit} in pool`}</dt>
            <dd className="mt-1 font-mono">{showQuote(quote, otherReserve)}</dd>
          </div>
          <div className="border border-gold/40 px-2 py-2">
            <dt className="text-xs text-ink/50">{zh ? "USDT0 一边" : "USDT0 side"}</dt>
            <dd className="mt-1 font-mono">{showQuote(0, usdtQuote)} / 5,000</dd>
          </div>
          <div className="border border-gold/40 px-2 py-2">
            <dt className="text-xs text-ink/50">{zh ? "买卖" : "Trading"}</dt>
            <dd className="mt-1">{live ? (zh ? "已打开" : "Open") : (zh ? "未打开" : "Closed")}</dd>
          </div>
        </dl>
        <p className="break-all text-xs text-ink/50">
          <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_POOL}`} target="_blank" rel="noreferrer">{TAPE_POOL}</a>
          {" · "}
          {zh ? "台费" : "Fee"} {TAPE_FEE}
        </p>
        <ul className="max-h-64 overflow-auto border border-gold/40">
          {positions.map((row) => {
            const due = row.unlock * 1000 <= Date.now();
            return (
              <li key={row.id} className="flex flex-col gap-2 border-t border-gold/30 px-2 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-all">
                  #{row.id} · TAPE/{row.quote === 0 ? "USDT0" : "BEM"} · {zh ? TAPE_TERMS[row.term]?.zh : TAPE_TERMS[row.term]?.en}
                  <span className="mt-1 block font-mono text-ink/50">{zh ? "到期" : "Unlocks"} {when(row.unlock)}</span>
                </span>
                <button
                  type="button"
                  disabled={busy || !due}
                  className="min-h-8 border border-gold px-2 disabled:opacity-40"
                  onClick={() => {
                    if (!account) return;
                    setBusy(true);
                    removeTapePool(account, BigInt(row.id))
                      .then((hash) => say(zh ? `已撤回。${hash}` : `Removed. ${hash}`))
                      .catch((error) => say(error instanceof Error && /rejected|denied/i.test(error.message) ? (zh ? "你取消了。" : "You cancelled.") : (zh ? "撤回没有完成。" : "Remove did not finish."), true))
                      .finally(() => setBusy(false));
                  }}
                >
                  {due ? (zh ? "撤回" : "Remove") : (zh ? "未到期" : "Locked")}
                </button>
              </li>
            );
          })}
          {account && positions.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "这个地址还没有质押。" : "This address has no stake."}</li> : null}
        </ul>
      </div>
      <form
        className="flex flex-col gap-3 border border-gold bg-card p-3 lg:col-span-5"
        onSubmit={(event) => {
          event.preventDefault();
          void go();
        }}
      >
        <div className="grid grid-cols-2 border border-gold">
          {(["add", "swap"] as const).map((id) => (
            <button key={id} type="button" onClick={() => { setMode(id); setAck(false); }} className={`min-h-10 text-sm ${mode === id ? "bg-ink text-paper" : ""}`}>
              {id === "add" ? (zh ? "加池质押" : "Add and stake") : (zh ? "买卖" : "Trade")}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink/60">
          {zh ? `钱包 TAPE ${showTape(balTape)} · ${unit} ${showQuote(quote, balQuote)}` : `Wallet TAPE ${showTape(balTape)} · ${unit} ${showQuote(quote, balQuote)}`}
        </p>
        {mode === "swap" ? (
          <div className="grid grid-cols-2 border border-gold">
            {(["buy", "sell"] as const).map((id) => (
              <button key={id} type="button" onClick={() => setSide(id)} className={`min-h-10 text-sm ${side === id ? "bg-ink text-paper" : ""}`}>
                {id === "buy" ? (zh ? "买入 TAPE" : "Buy TAPE") : (zh ? "卖出 TAPE" : "Sell TAPE")}
              </button>
            ))}
          </div>
        ) : null}
        {mode === "add" || side === "sell" ? (
          <label className="text-sm">
            TAPE
            <input value={tapeAmt} onChange={(event) => setTapeAmt(event.target.value)} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold bg-transparent px-2 font-mono outline-none" />
          </label>
        ) : null}
        {mode === "add" || side === "buy" ? (
          <label className="text-sm">
            {unit}
            <input value={quoteAmt} onChange={(event) => setQuoteAmt(event.target.value)} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold bg-transparent px-2 font-mono outline-none" />
          </label>
        ) : null}
        {mode === "add" ? (
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
            {TAPE_TERMS.map((row) => (
              <button key={row.id} type="button" onClick={() => { setTerm(row.id); setAck(false); }} className={`min-h-10 border px-1 text-xs ${term === row.id ? "border-ink bg-ink text-paper" : "border-gold"}`}>
                {zh ? row.zh : row.en}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm">{zh ? "预计得到" : "Estimated"} <span className="font-mono">{out} {side === "sell" ? unit : "TAPE"}</span></p>
        )}
        <p className="text-xs leading-5 text-ink/60">
          {mode === "add"
            ? zh ? `锁到 ${when(Math.floor(Date.now() / 1000) + TAPE_TERMS[term].days * 86400)}（新加坡）。到期前不能撤。两边各扣 0.20%，对不上比例的退回。撤的时候再扣一次。` : `Locked until ${when(Math.floor(Date.now() / 1000) + TAPE_TERMS[term].days * 86400)} Singapore time. It cannot be removed early. Each side pays 0.20%, and a mismatch is returned. Removing pays 0.20% again.`
            : zh ? "付出金额的 0.20% 进收费地址。滑点 1%。未开盘不能签。这一笔不是质押。" : "0.20% of the input goes to the fee address. Slippage is 1%. A closed pool cannot be signed. This is not a stake."}
        </p>
        {mode === "add" ? <label className="flex gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{zh ? "我知道到期前取不出来" : "I know this cannot be removed early"}</label> : null}
        {!account ? (
          <button type="button" disabled={busy} className="min-h-12 bg-ink font-display text-2xl italic text-paper" onClick={() => { setBusy(true); connectXLayer().then(setAccount).catch(() => say(zh ? "钱包没有连上。" : "The wallet did not connect.", true)).finally(() => setBusy(false)); }}>
            {zh ? "连接钱包" : "Connect"}
          </button>
        ) : (
          <button type="submit" disabled={busy || (mode === "swap" && !live) || (mode === "add" && !ack)} className="min-h-12 bg-ink font-display text-2xl italic text-paper disabled:opacity-40">
            {busy ? (zh ? "等待钱包" : "Waiting") : mode === "swap" && !live ? (zh ? "买卖还没打开" : "Trading is closed") : mode === "add" ? (zh ? "签名并质押" : "Sign and stake") : (zh ? "签名并成交" : "Sign and trade")}
          </button>
        )}
        {note ? <p className={`break-all text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        <p className="text-xs text-ink/50">{zh ? `开盘线 ${OPEN_USDT.toString()} 最小单位，也就是 5,000 USDT0。` : "The gate is 5,000 USDT0."}</p>
      </form>
    </div>
  );
}
