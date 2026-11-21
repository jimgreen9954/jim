import { useEffect, useState } from "react";
import { fundBookInsurance, syncBookState, type SyncBookState } from "@/lib/perp";

const COINS = ["up", "tape", "fab"] as const;

function whole(n: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  return (n / base).toString();
}

function say(err: unknown, zh: boolean): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "second") return zh ? "还差一个签名。用另一个多签地址，在这个浏览器再点一次。" : "One more signature. Use the other multisig address in this browser and tap again.";
  if (code === "leader") return zh ? "这个地址不是多签的所有者。" : "This address is not a multisig owner.";
  if (code === "nowallet") return zh ? "先连接钱包。" : "Connect a wallet first.";
  if (code === "amount") return zh ? "金额不对。" : "Bad amount.";
  if (code === "usdt") return zh ? "余额不够。" : "Not enough balance.";
  return zh ? "没发出去。" : "Not sent.";
}

export function SyncDesk({ zh }: { zh: boolean }) {
  const [coin, setCoin] = useState<(typeof COINS)[number]>("up");
  const [row, setRow] = useState<SyncBookState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);

  useEffect(() => {
    if (!fundOpen) return;
    let dead = false;
    const pull = () => {
      syncBookState(coin)
        .then((next) => {
          if (!dead) setRow(next);
        })
        .catch(() => {
          if (!dead) setRow(null);
        });
    };
    pull();
    const id = window.setInterval(pull, 20_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [coin, fundOpen]);

  const run = (job: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setBad(false);
    setNote(zh ? "钱包正在打开。" : "The wallet is opening.");
    void job()
      .then(() => {
        setBad(false);
        if (ok) setNote(ok);
      })
      .catch((err: unknown) => {
        setBad(true);
        setNote(say(err, zh));
      })
      .finally(() => setBusy(false));
  };

  const unit = coin === "up" ? "USDT" : "USDT0";
  const cap = row ? whole(row.cap, row.decimals) : "—";
  const backed = row ? whole(row.backed, row.decimals) : "—";
  const open = row ? whole(row.openNotional, row.decimals) : "—";
  const left = row ? whole(row.room, row.decimals) : "—";
  const paused = row?.guard === false;
  const short = row?.room === 0n;
  const full = row != null && row.room > 0n && row.openNotional >= row.room;
  const warm = row?.samples != null && row.samples < 20;

  return (
    <div className="mt-3 border border-gold/40 px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="min-h-11 border border-gold px-3 text-xs"
          onClick={() => setFundOpen((open) => !open)}
        >
          {fundOpen ? (zh ? "收起保险金" : "Hide insurance") : zh ? "充值保险金" : "Add insurance"}
        </button>
      </div>
      {fundOpen ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {COINS.map((id) => (
              <button
                key={id}
                type="button"
                className={`min-h-9 px-2 text-xs uppercase ${coin === id ? "bg-ink text-paper" : "text-ink/60"}`}
                onClick={() => setCoin(id)}
              >
                {id}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs leading-5 text-ink/80">
            {zh
              ? `上限 ${cap} ${unit}。保险金 × 20 是 ${backed}。已开名义 ${open}。现在还能开 ${left}。`
              : `Cap ${cap} ${unit}. Insurance × 20 is ${backed}. Open notional ${open}. Room left ${left}.`}
          </p>
          {warm ? <p className="mt-1 text-xs text-ink">{zh ? `价格预热中。标记样本 ${row?.samples} / 20。` : `Price is warming up. Mark samples ${row?.samples} / 20.`}</p> : null}
          {paused ? <p className="mt-1 text-xs text-sell">{zh ? "价格暂停中，只能平仓。" : "The price is paused. Close only."}</p> : null}
          {short ? <p className="mt-1 text-xs text-sell">{zh ? "保险金不足，暂不能开仓。" : "Insurance is short, so a new open is refused."}</p> : null}
          {full ? <p className="mt-1 text-xs text-sell">{zh ? "暂时额满。" : "The book is full for now."}</p> : null}
          <p className="mt-2 text-xs leading-5 text-ink/70">
            {zh
              ? "存进去拿不回来。1 美元保险金，整本可开名义 20。这笔进的是上面选中的这一本。"
              : "A deposit cannot be withdrawn. 1 dollar of insurance opens 20 of notional on the selected book."}
          </p>
          {coin === "tape" ? (
            <p className="mt-1 text-xs leading-5 text-ink/70">
              {zh
                ? "TAPE 池子很浅。压住约 1% 再买回，测到的成本大约 0.058 美元。上限要变大，只能先往池子加流动性。现在的 3000 高于这条。"
                : "The TAPE pool is thin. A measured 1% round trip cost about 0.058 dollars. The cap only grows after liquidity is added. 3000 is above that line."}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="min-h-11 border border-gold px-3 text-xs disabled:opacity-40"
              onClick={() => run(() => fundBookInsurance(coin, 1), zh ? "已存 1。拿不回来。" : "Deposited 1. It cannot be withdrawn.")}
            >
              {zh ? "存入 1" : "Deposit 1"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="min-h-11 border border-gold px-3 text-xs disabled:opacity-40"
              onClick={() => run(() => fundBookInsurance(coin, 25), zh ? "已存 25。拿不回来。" : "Deposited 25. It cannot be withdrawn.")}
            >
              {zh ? "存入 25" : "Deposit 25"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="min-h-11 bg-ink px-3 text-xs text-paper disabled:opacity-40"
              onClick={() => run(() => fundBookInsurance(coin, 50), zh ? "已存 50。拿不回来。" : "Deposited 50. It cannot be withdrawn.")}
            >
              {zh ? "存入 50" : "Deposit 50"}
            </button>
          </div>
        </>
      ) : null}
      {note ? <p className={`mt-2 text-xs ${bad ? "text-sell" : "text-ink/80"}`}>{note}</p> : null}
    </div>
  );
}
