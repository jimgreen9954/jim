import { useEffect, useState } from "react";
import { fundBookInsurance, HALF_BOOK_CAP, lowerBookCap, syncBookState, type SyncBookState } from "@/lib/perp";

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
  if (code === "cap") return zh ? "只有这一本的收费多签能调低上限。" : "Only this book's fee multisig can lower the cap.";
  return zh ? "没发出去。" : "Not sent.";
}

export function SyncDesk({ zh }: { zh: boolean }) {
  const [coin, setCoin] = useState<(typeof COINS)[number]>("up");
  const [row, setRow] = useState<SyncBookState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [fundOpen, setFundOpen] = useState(false);
  const [about, setAbout] = useState(false);

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
    <article className="border border-gold bg-card px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-3xl italic">{zh ? "保险金" : "Insurance"}</h2>
        <button
          type="button"
          className="min-h-11 border border-gold px-3 text-xs"
          onClick={() => setFundOpen((open) => !open)}
        >
          {fundOpen ? (zh ? "收起" : "Hide") : zh ? "充值" : "Add"}
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
          <button type="button" className="mt-2 min-h-9 text-xs text-ink/70" onClick={() => setAbout((open) => !open)}>
            {about ? (zh ? "收起说明" : "Hide notes") : zh ? "说明" : "Notes"}
          </button>
          {about ? (
            <div className="mt-2 grid gap-2 text-xs leading-5 text-ink/70">
              <p>
                {zh
                  ? "这是 UP、TAPE、FAB 交易合约的公共保险金，不是跟单金库的份额。存进去没有份额，也不能取回。"
                  : "This is the shared insurance of the UP, TAPE and FAB books. It is not a copy-vault share. A deposit mints no shares and cannot be withdrawn."}
              </p>
              <p>
                {zh
                  ? `钱进当前选中的这一本，三本互不相通。全体可开名义是上限和保险金 × 20 里较小的那个。1 ${unit} 保险金，这一本全体只能开 20 ${unit} 名义。一个人一个方向最多是整本上限的五分之一。保险金不够时先被上面的额度卡住。多签上限现在如果高于库存的一半，可以用下面的按钮调低。调高要等 1 天。`
                  : `The payment enters only the selected book. The three books are separate. Open notional is the smaller of the cap and insurance × 20. One ${unit} of insurance lets the whole book open 20 ${unit} of notional. One address on one side stops at one fifth of the cap, or sooner when insurance is tighter. If the multisig cap is above half the pool, the button below lowers it. A raise waits one day.`}
              </p>
              <p>
                {zh
                  ? "平常平仓赚的是对手的保证金，不动保险金。只有一边穿仓、保证金变成负数时，欠下的那一截才从保险金补给赢的一边，不补给亏的人。补到 0 为止。"
                  : "A normal close is paid from the other side's margin. Insurance moves only when one side is through zero. That shortfall is paid to the winner, not to the loser, and only up to the balance."}
              </p>
              {coin === "tape" ? (
                <p>
                  {zh
                    ? "TAPE 池子很浅。把价格压过约 1% 再买回，测到的成本大约 0.058 美元。多签上限如果还是 3000，就高于库存的一半。先把上限降下来，再谈加流动性。"
                    : "The TAPE pool is thin. A measured round trip through about 1% cost about 0.058 dollars. A multisig cap of 3000 is above half the inventory. Lower the cap before adding liquidity."}
                </p>
              ) : null}
            </div>
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
            {row && row.cap > HALF_BOOK_CAP[coin] ? (
              <button
                type="button"
                disabled={busy}
                className="min-h-11 border border-gold px-3 text-xs disabled:opacity-40"
                onClick={() => run(() => lowerBookCap(coin), zh ? "上限已降到库存的一半以下。" : "The cap is now at or under half the inventory.")}
              >
                {zh ? `上限降到 ${whole(HALF_BOOK_CAP[coin], row.decimals)}` : `Lower cap to ${whole(HALF_BOOK_CAP[coin], row.decimals)}`}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      {note ? <p className={`mt-2 text-xs ${bad ? "text-sell" : "text-ink/80"}`}>{note}</p> : null}
    </article>
  );
}
