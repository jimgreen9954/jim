import { useEffect, useState } from "react";
import { fundBookInsurance, syncBookState, type SyncBookState } from "@/lib/perp";
import {
  deployRebateClerk,
  deployRedCommit,
  deployShip,
  rebateClerkAddress,
  savedRedCommit,
  savedShip,
  type ShipKind,
  type ShipLanding,
} from "@/lib/sync-ship";

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
  const [ships, setShips] = useState<Partial<Record<ShipKind, ShipLanding | null>>>({});

  useEffect(() => {
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
    setShips({
      up: savedShip("up"),
      tape: savedShip("tape"),
      fab: savedShip("fab"),
      vault: savedShip("vault"),
    });
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [coin]);

  const run = (job: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true);
    setBad(false);
    setNote(zh ? "钱包正在打开。" : "The wallet is opening.");
    void job()
      .then(() => {
        setBad(false);
        if (ok) setNote(ok);
        setShips({
          up: savedShip("up"),
          tape: savedShip("tape"),
          fab: savedShip("fab"),
          vault: savedShip("vault"),
        });
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
    <section className="border border-gold bg-card px-3 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-2xl italic">{zh ? "保险金" : "Insurance"}</h2>
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
          ? "存进去拿不回来，保险金 × 20 不放宽。这笔进的是页面正在交易的这一本。BTC、ETH、ZEC、BEM 的手续费已经进了多签，那四本的收款地址写死了，合约改不了。多签把已经收到的手续费转进来，就用这里。"
          : "A deposit cannot be withdrawn, and insurance × 20 stays. This funds the book the page is trading. BTC, ETH, ZEC and BEM fees already go to the multisig. Those four books cannot be patched. The multisig moves fees it has already received with this button."}
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
      <p className="mt-3 text-xs leading-5 text-ink/70">
        {zh
          ? "现在这三本没有公开的 sync()。价格如果在没人交易时走开超过约 1%，开仓和强平会失败，记价也一起回滚。新本谁都能调 sync()，只记价，每 30 秒一次，每次最多约 0.5%。分叉上把价格走开 5% 之后，连记 21 次、大约 11 分钟，保护开关才重新打开。下面三颗是两签部署。页面不会改地址，等你核对后再换。"
          : "These three books have no public sync(). If spot walks more than about 1% while nobody trades, opens and liquidations fail and the price note rolls back with them. The new book lets anyone call sync(). It only records the price, once each 30 seconds, at most about 0.5%. On a fork, a 5% walk took 21 notes, about 11 minutes, before the guard opened again. The three buttons need two signatures. The page does not switch until you have checked them."}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {(["up", "tape", "fab"] as const).map((id) => (
          <button
            key={id}
            type="button"
            disabled={busy}
            className="min-h-11 border border-gold px-3 text-xs uppercase disabled:opacity-40"
            onClick={() =>
              run(async () => {
                const next = await deployShip(id);
                setNote(
                  zh
                    ? `${id.toUpperCase()} 已部署。标记 ${next.mark || "—"} 交易 ${next.book || "—"}。页面仍读旧地址。`
                    : `${id.toUpperCase()} deployed. Mark ${next.mark || "—"} book ${next.book || "—"}. The page still reads the old address.`,
                );
              }, "")
            }
          >
            {zh ? `部署 ${id.toUpperCase()} sync` : `Deploy ${id.toUpperCase()} sync`}
          </button>
        ))}
      </div>
      {ships.up?.book || ships.tape?.book || ships.fab?.book ? (
        <p className="mt-2 break-all font-mono text-[11px] leading-5 text-ink/60">
          {ships.up?.book ? `UP ${ships.up.book} ` : ""}
          {ships.tape?.book ? `TAPE ${ships.tape.book} ` : ""}
          {ships.fab?.book ? `FAB ${ships.fab.book}` : ""}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          className="min-h-11 border border-gold px-3 text-xs disabled:opacity-40"
          onClick={() =>
            run(async () => {
              const next = await deployShip("vault");
              setNote(
                zh
                  ? `新金库 ${next.book || "—"}，绑的是正在交易的 X Layer BEM。页面仍从旧金库 0x5d6e… 取钱，不改地址。`
                  : `New vault ${next.book || "—"}, bound to the live X Layer BEM book. Withdrawals stay on the old vault. The page does not switch.`,
              );
            }, "")
          }
        >
          {zh ? "部署新的 X Layer 金库" : "Deploy the new X Layer vault"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="min-h-11 border border-gold px-3 text-xs disabled:opacity-40"
          onClick={() =>
            run(async () => {
              const address = await deployRedCommit("xlayer");
              setNote(zh ? `新红包 ${address}。领取仍走旧合约。` : `New packet ${address}. Claims stay on the old contract.`);
            }, "")
          }
        >
          {zh ? "部署 commit-reveal 红包" : "Deploy commit-reveal packet"}
        </button>
        <button
          type="button"
          disabled={busy}
          className="min-h-11 border border-gold px-3 text-xs disabled:opacity-40"
          onClick={() =>
            run(async () => {
              const address = await deployRebateClerk("xlayer");
              setNote(zh ? `新领取合约 ${address}，clerk 是多签。现在的领取地址不变。` : `New claim contract ${address}. The clerk is the multisig. The live claim address stays.`);
            }, "")
          }
        >
          {zh ? "部署多签 clerk 领取" : "Deploy multisig clerk"}
        </button>
      </div>
      <p className="mt-2 break-all text-[11px] leading-5 text-ink/55">
        {zh ? "新金库还没核对，页面不读。" : "The new vault is not checked, so the page does not read it."}{" "}
        {ships.vault?.book || ""} {zh ? "新红包" : "New packet"} {savedRedCommit("xlayer") || "—"} {zh ? "新领取" : "New claim"} {rebateClerkAddress("xlayer")}
      </p>
      {note ? <p className={`mt-2 text-xs ${bad ? "text-sell" : "text-ink/80"}`}>{note}</p> : null}
    </section>
  );
}
