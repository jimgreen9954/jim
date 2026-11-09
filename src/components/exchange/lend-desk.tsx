import { useEffect, useState } from "react";
import {
  aprText,
  bpsText,
  borrowLend,
  closePrice,
  collQuote,
  debtBps,
  depositLend,
  lendAddress,
  lendChoices,
  lendPlain,
  lendSpec,
  lendText,
  liquidateLend,
  lockLend,
  pokeLend,
  readDebtors,
  readLend,
  repayLend,
  unlockLend,
  withdrawLend,
  type Debtor,
  type LendAsset,
  type LendChain,
  type LendView,
} from "@/lib/lend";
import { connectAny } from "@/lib/wallet";

type Mode = "in" | "out" | "lock" | "free" | "borrow" | "repay";

function failText(err: unknown, zh: boolean): string {
  const code = err instanceof Error ? err.message : "";
  if (code === "amount") return zh ? "数量不对。" : "That amount is not valid.";
  if (code === "usdt") return zh ? "稳定币余额不够。" : "Stablecoin balance is not enough.";
  if (code === "coll") return zh ? "抵押品余额不够。" : "Collateral balance is not enough.";
  if (code === "gas") return zh ? "要留下一点当网络费，不能全部抵押。" : "Leave a little for the network fee. You cannot lock all of it.";
  if (code === "idle") return zh ? "别人借走的部分现在取不出。" : "The part already borrowed cannot be withdrawn now.";
  if (code === "live") return zh ? "这口借贷还没部署。" : "This market is not deployed.";
  if (code === "posted") return zh ? "这一口还没有你的抵押。质押页锁上的不能拿来借。" : "This market has none of your collateral. A stake on the stake page cannot be borrowed against.";
  if (code === "dry") return zh ? "这口池子里现在没有这么多可借的稳定币。" : "This pool does not have that much stablecoin to lend.";
  if (code === "leader") return zh ? "这个钱包不是多签的签名地址。" : "This wallet is not a signer of the multisig.";
  if (code === "second") return zh ? "已记下这个地址的签名。换成另一个签名地址再点一次，才会从多签发出。" : "This signature is saved. Switch to the other signer and tap again. Then it is sent from the multisig.";
  if (code === "nowallet") return zh ? "先连接钱包。" : "Connect a wallet first.";
  if (code === "safe") return zh ? "还没过 75%，合约不让平仓。" : "Still at or under 75%. The contract will not liquidate it.";
  if (code === "self") return zh ? "这是你自己的仓。请还款，不要平自己。" : "This is your own position. Repay it. Do not liquidate yourself.";
  if (code === "revert") return zh ? "链上没有成交。看一下抵押、欠款和池子里还有没有现金。" : "The chain did not fill it. Check the collateral, the debt, and the cash left in the pool.";
  if (code === "pending") return zh ? "还在确认。不要重复提交。" : "Still confirming. Do not send it again.";
  if (/rejected|denied|cancel/i.test(code)) return zh ? "已取消。" : "Cancelled.";
  return zh ? "没有完成。请等待钱包弹出再确认。" : "It did not finish. Wait for the wallet, then confirm.";
}

export function LendDesk({ zh, account }: { zh: boolean; account: string | null }) {
  const [chain, setChain] = useState<LendChain>("xlayer");
  const [asset, setAsset] = useState<LendAsset>("gas");
  const [view, setView] = useState<LendView | null>(null);
  const [mode, setMode] = useState<Mode>("in");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [seats, setSeats] = useState<{ chain: LendChain; asset: LendAsset; view: LendView }[]>([]);
  const market = lendSpec(chain, asset);
  const collMode = mode === "lock" || mode === "free";
  const live = Boolean(lendAddress(chain, asset));

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readLend(chain, asset, account)
        .then((row) => {
          if (!dead) setView(row);
        })
        .catch(() => {
          if (!dead) setView(null);
        });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [chain, asset, account, busy]);

  useEffect(() => {
    if (!account) {
      setSeats([]);
      return;
    }
    let dead = false;
    const pull = () => {
      const jobs = (["xlayer", "bsc"] as const).flatMap((id) =>
        lendChoices(id).map((next) =>
          readLend(id, next, account)
            .then((row) => ({ chain: id, asset: next, view: row }))
            .catch(() => null),
        ),
      );
      Promise.all(jobs).then((rows) => {
        if (dead) return;
        setSeats(
          rows.filter(
            (row): row is { chain: LendChain; asset: LendAsset; view: LendView } =>
              Boolean(row && row.view.live && (row.view.supply > 0n || row.view.posted > 0n || row.view.debt > 0n)),
          ),
        );
      });
    };
    pull();
    const id = window.setInterval(pull, 20_000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [account, busy]);

  const run = (work: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    setBad(false);
    setNote(zh ? "请等待钱包弹出再确认。" : "Wait for the wallet, then confirm.");
    void (async () => {
      try {
        if (!account) await connectAny();
        await work();
        setAmount("");
        setNote(done);
        setBad(false);
      } catch (err) {
        setNote(failText(err, zh));
        setBad(true);
      } finally {
        setBusy(false);
      }
    })();
  };

  const money = (value: bigint | undefined, dec: number = market.usdtDec) => (view && value !== undefined ? lendText(value, dec) : "—");
  const gasFree = view && market.native && view.walletGas > market.reserve ? view.walletGas - market.reserve : view?.walletColl ?? 0n;
  const borrowRoom = (() => {
    if (!view) return undefined;
    let room = view.maxBorrow;
    if (!view.fresh && view.price && view.posted > 0n) {
      const cap = (view.posted * view.price) / 10n ** BigInt(market.collDec) / 2n;
      room = cap > view.debt ? cap - view.debt : 0n;
    }
    return room > view.cash ? view.cash : room;
  })();

  const act = () => {
    if (mode === "in") return depositLend(chain, asset, amount);
    if (mode === "out") return withdrawLend(chain, asset, amount);
    if (mode === "lock") return lockLend(chain, asset, amount);
    if (mode === "free") return unlockLend(chain, asset, amount);
    if (mode === "borrow") return borrowLend(chain, asset, amount);
    return repayLend(chain, asset, amount);
  };
  const book = view ? positionOf(chain, asset, view) : null;
  const goRepay = () => {
    if (!view) return;
    setMode("repay");
    setAmount(view.debt > 0n ? lendPlain(view.debt, market.usdtDec) : "");
  };

  return (
    <section className="grid gap-3">
      <article className="border border-gold bg-card px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-3xl italic">{zh ? "借贷" : "Lend"}</h2>
          <div className="flex gap-1">
            {(["xlayer", "bsc"] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`min-h-9 px-2 text-xs ${chain === id ? "bg-foil text-ink" : "text-ink/60"}`}
                onClick={() => {
                  setChain(id);
                  if (id === "bsc" && asset === "tape") setAsset("gas");
                }}
              >
                {id === "xlayer" ? "X Layer" : "BSC"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex gap-1">
          {lendChoices(chain).map((id) => (
            <button
              key={id}
              type="button"
              className={`min-h-9 px-2 text-xs ${asset === id ? "bg-ink text-paper" : "text-ink/60"}`}
              onClick={() => setAsset(id)}
            >
              {id === "gas" ? marketLabel(chain) : id === "tape" ? "TAPE" : "BEM"}
            </button>
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Cell k={zh ? "池子现金" : "Cash"} v={`${money(view?.cash)} ${market.usdtSym}`} />
          <Cell k={zh ? "池子已借出" : "Pool lent"} v={`${money(view ? view.assets - view.cash : undefined)} ${market.usdtSym}`} />
          <Cell k={zh ? "存款年化" : "Supply"} v={view ? aprText(view.supplyApr) : "—"} />
          <Cell k={zh ? "借款年化" : "Borrow"} v={view ? aprText(view.borrowApr) : "—"} />
        </dl>
        {view?.price ? <p className="mt-2 text-xs text-ink/60">{`1 ${market.collSym} = ${lendText(view.price, market.usdtDec)} ${market.usdtSym}`}</p> : null}
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          <article className="border border-gold/40 px-3 py-3">
            <p className="text-[11px] tracking-[0.14em] text-ink/45">{zh ? "借出" : "Lent"}</p>
            <p className="mt-1 font-mono text-xl tabular-nums">
              {money(view?.supply)} <span className="text-sm text-ink/50">{market.usdtSym}</span>
            </p>
            <p className="mt-1 text-xs leading-5 text-ink/55">
              {zh
                ? `这是你现在能取回的数，利息已经加进去，年化 ${view ? aprText(view.supplyApr) : "—"}。合约只记份额，不记你存入时的本金，所以不另写一笔盈亏。`
                : `This is what you can withdraw now. Interest is already inside it, at ${view ? aprText(view.supplyApr) : "—"}. The contract stores shares, not your original deposit, so it does not invent a profit figure.`}
            </p>
          </article>
          <article className="border border-gold/40 px-3 py-3">
            <p className="text-[11px] tracking-[0.14em] text-ink/45">{zh ? "抵押" : "Collateral"}</p>
            <p className="mt-1 font-mono text-xl tabular-nums">
              {money(view?.posted, market.collDec)} <span className="text-sm text-ink/50">{market.collSym}</span>
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <Cell k={zh ? "抵押市值" : "Mark"} v={book?.value == null ? "—" : `${lendText(book.value, market.usdtDec)} ${market.usdtSym}`} />
              <Cell k={zh ? "欠款" : "Debt"} v={`${money(view?.debt)} ${market.usdtSym}`} />
              <Cell
                k={zh ? "净值" : "Equity"}
                v={book?.equity == null ? "—" : `${book.equity < 0n ? "−" : ""}${lendText(book.equity < 0n ? -book.equity : book.equity, market.usdtDec)} ${market.usdtSym}`}
              />
              <Cell k={zh ? "负债率" : "Debt ratio"} v={book?.ratio == null ? "—" : bpsText(book.ratio)} />
              <Cell k={zh ? "平仓价" : "Close"} v={book?.liq == null ? (zh ? "没有欠款" : "No debt") : `${lendText(book.liq, market.usdtDec)} ${market.usdtSym}`} />
              <Cell k={zh ? "现价" : "Now"} v={view?.price ? `${lendText(view.price, market.usdtDec)} ${market.usdtSym}` : "—"} />
            </dl>
            {view && view.posted > 0n && !view.price ? (
              <p className="mt-2 text-xs text-sell">{zh ? "抵押价这次没读到。市值、负债率先空着，不当成 0。" : "The collateral price did not load. Mark and ratio are left blank, not shown as zero."}</p>
            ) : null}
            <p className="mt-2 text-xs leading-5 text-ink/55">
              {zh
                ? "净值 = 抵押市值 − 欠款。借款上限是 50%。负债率过 75%，别人可以替你还一笔，并按合约价多拿走大约 5% 的抵押。"
                : "Equity is collateral value minus debt. New borrows stop at 50%. Above 75%, someone can repay for you and take about 5% extra collateral."}
            </p>
            {book && book.ratio != null && book.ratio > 5000n ? (
              <div className={`mt-2 border px-2 py-2 text-xs leading-5 ${book.ratio > 7500n ? "border-sell text-sell" : "border-gold text-ink"}`}>
                {book.ratio > 7500n
                  ? zh
                    ? "负债率已经超过 75%。现在就可以被平仓。请马上还款。"
                    : "Debt ratio is over 75%. Liquidation is allowed now. Repay."
                  : book.ratio >= 6500n
                    ? zh
                      ? `负债率 ${bpsText(book.ratio)}，已经超过 65%。现价低于平仓价 ${book.liq ? lendText(book.liq, market.usdtDec) : "—"} 就可以被平仓。请还款。`
                      : `Debt ratio ${bpsText(book.ratio)}, over 65%. At the close price it can be liquidated. Repay.`
                    : zh
                      ? `负债率 ${bpsText(book.ratio)}，已超过 50% 的借款上限。还没到 75% 平仓线。`
                      : `Debt ratio ${bpsText(book.ratio)}. Above the 50% borrow cap, still under the 75% liquidation line.`}
                {book.ratio >= 6500n ? (
                  <button type="button" className="mt-1 block min-h-8 underline" onClick={goRepay}>
                    {zh ? "按欠款填入还款" : "Fill the debt and repay"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </article>
        </div>
        <div className="mt-3 border border-gold/30 px-3 py-2">
          <p className="text-[11px] text-ink/45">{zh ? "这个钱包在各池的仓位" : "This wallet, every pool"}</p>
          {!account ? (
            <p className="mt-1 text-xs text-ink/55">{zh ? "先连接钱包。" : "Connect a wallet."}</p>
          ) : seats.length === 0 ? (
            <p className="mt-1 text-xs text-ink/55">{zh ? "没有借出，也没有抵押。" : "Nothing lent and nothing locked."}</p>
          ) : (
            <ul className="mt-1">
              {seats.map((seat) => {
                const row = positionOf(seat.chain, seat.asset, seat.view);
                const on = seat.chain === chain && seat.asset === asset;
                return (
                  <li key={`${seat.chain}-${seat.asset}`} className="border-t border-gold/20 py-2 text-xs first:border-t-0">
                    <button
                      type="button"
                      className={`text-left ${on ? "text-ink" : "text-ink/70"}`}
                      onClick={() => {
                        setChain(seat.chain);
                        setAsset(seat.asset);
                      }}
                    >
                      <span className="font-mono">
                        {seat.chain === "xlayer" ? "X Layer" : "BSC"} · {assetName(seat.chain, seat.asset)}
                      </span>
                      {seat.view.supply > 0n ? (
                        <span className="mt-0.5 block">
                          {zh ? "借出" : "Lent"} {lendText(seat.view.supply, row.spec.usdtDec)} {row.spec.usdtSym}
                        </span>
                      ) : null}
                      {seat.view.posted > 0n || seat.view.debt > 0n ? (
                        <span className="mt-0.5 block">
                          {zh ? "抵押" : "Locked"} {lendText(seat.view.posted, row.spec.collDec)} {row.spec.collSym}
                          {" · "}
                          {zh ? "欠" : "Owes"} {lendText(seat.view.debt, row.spec.usdtDec)} {row.spec.usdtSym}
                          {" · "}
                          {row.ratio == null ? "—" : bpsText(row.ratio)}
                          {row.liq ? ` · ${zh ? "平仓价" : "Close"} ${lendText(row.liq, row.spec.usdtDec)}` : ""}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <BorrowBook
          zh={zh}
          busy={busy}
          account={account}
          onLiquidate={(row) => run(() => liquidateLend(row.chain, row.asset, row.account), zh ? "已平仓。" : "Liquidated.")}
        />
        <div className="mt-3 flex flex-wrap gap-1">
          {([
            ["in", zh ? "存入" : "Supply"],
            ["out", zh ? "取出" : "Withdraw"],
            ["lock", zh ? "抵押" : "Lock"],
            ["free", zh ? "取回" : "Unlock"],
            ["borrow", zh ? "借入" : "Borrow"],
            ["repay", zh ? "还款" : "Repay"],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" className={`min-h-9 px-2 text-xs ${mode === id ? "bg-ink text-paper" : "text-ink/60"}`} onClick={() => setMode(id)}>
              {label}
            </button>
          ))}
        </div>
        <label className="mt-2 block text-xs text-ink/55">
          {mode === "in"
            ? `${zh ? "可用" : "Available"} ${money(view?.walletUsdt)} ${market.usdtSym}`
            : mode === "out"
              ? `${zh ? "现在可取" : "Withdrawable"} ${money(view && view.supply < view.cash ? view.supply : view?.cash)} ${market.usdtSym}`
              : mode === "lock"
                ? `${zh ? "可用" : "Available"} ${money(market.native ? gasFree : view?.walletColl, market.collDec)} ${market.collSym}`
                : mode === "free"
                  ? `${zh ? "可取回" : "Free"} ${money(view?.freeColl, market.collDec)} ${market.collSym}`
                  : mode === "borrow"
                    ? `${zh ? "还能借" : "Room"} ${money(borrowRoom)} ${market.usdtSym}`
                    : `${zh ? "可用" : "Available"} ${money(view?.walletUsdt)} ${market.usdtSym}`}
          <input
            value={amount}
            inputMode="decimal"
            placeholder={collMode ? market.collSym : market.usdtSym}
            className="mt-1 min-h-11 w-full border border-gold/40 bg-transparent px-2 text-sm text-ink"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <button type="button" disabled={busy} className="mt-2 min-h-11 w-full bg-ink text-paper disabled:opacity-40" onClick={() => run(act, zh ? "已完成。" : "Done.")}>
          {mode === "in" ? (zh ? "存入" : "Supply") : mode === "out" ? (zh ? "取出" : "Withdraw") : mode === "lock" ? (zh ? "抵押" : "Lock") : mode === "free" ? (zh ? "取回" : "Unlock") : mode === "borrow" ? (zh ? "借入" : "Borrow") : zh ? "还款" : "Repay"}
        </button>
        {live && !market.native && market.mode !== 0 ? (
          <button
            type="button"
            disabled={busy}
            className="mt-2 min-h-9 w-full text-xs text-ink/70 disabled:opacity-40"
            onClick={() => run(() => pokeLend(chain, asset), zh ? "已完成。" : "Done.")}
          >
            {zh ? "记账" : "Post"}
          </button>
        ) : null}
        {note ? <p className={`mt-2 text-xs ${bad ? "text-down" : "text-ink/70"}`}>{note}</p> : null}
      </article>
    </section>
  );
}

function BorrowBook({
  zh,
  busy,
  account,
  onLiquidate,
  startOpen = false,
}: {
  zh: boolean;
  busy: boolean;
  account: string | null;
  onLiquidate: (row: Debtor) => void;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [rows, setRows] = useState<Debtor[] | null>(null);
  const [miss, setMiss] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let dead = false;
    const pull = () => {
      readDebtors()
        .then((next) => {
          if (dead) return;
          setRows(next);
          setMiss(false);
        })
        .catch(() => {
          if (!dead) setMiss(true);
        });
    };
    pull();
    const id = window.setInterval(pull, 20000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [open, busy]);
  const hot = rows?.filter((row) => row.open).length ?? 0;
  return (
    <div className="mt-3 border border-gold/30 px-3 py-2">
      <button type="button" className="flex min-h-9 w-full items-center justify-between text-left text-xs" onClick={() => setOpen((value) => !value)}>
        <span>{zh ? "别人的借款" : "Other debts"}</span>
        <span className="text-ink/45">
          {open ? (zh ? "收起" : "Hide") : rows ? (zh ? `${rows.length} 笔${hot ? `，${hot} 笔可平` : ""}` : `${rows.length}${hot ? `, ${hot} open` : ""}`) : zh ? "点开看地址" : "Open to see addresses"}
        </span>
      </button>
      {open ? (
        <>
          {miss ? <p className="mt-1 text-xs text-sell">{zh ? "地址这次没读全。" : "The address list did not load."}</p> : null}
          {rows == null ? (
            <p className="mt-2 text-xs text-ink/45">{zh ? "正在读取。" : "Loading."}</p>
          ) : rows.length === 0 ? (
            <p className="mt-2 text-xs text-ink/55">{zh ? "现在没有人欠款。" : "Nobody owes anything."}</p>
          ) : (
            <ul className="mt-2">
              {rows.map((row) => {
                const spec = lendSpec(row.chain, row.asset);
                const mine = Boolean(account && account.toLowerCase() === row.account.toLowerCase());
                const seize = row.seize;
                const id = `${row.chain}-${row.asset}-${row.account}`;
                const shown = picked === id;
                return (
                  <li key={id} className="border-t border-gold/25 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-xs leading-5">
                        <p>
                          {row.chain === "xlayer" ? "X Layer" : "BSC"} · {assetName(row.chain, row.asset)}
                        </p>
                        <p className="truncate font-mono" title={row.account}>
                          {`${row.account.slice(0, 6)}…${row.account.slice(-4)}`}
                        </p>
                        <p>
                          {zh ? "欠" : "Owes"} {lendText(row.debt, spec.usdtDec)} {spec.usdtSym}
                          {" · "}
                          {zh ? "抵押" : "Locked"} {lendText(row.posted, spec.collDec)} {spec.collSym}
                        </p>
                        <p className={row.open ? "text-sell" : ""}>
                          {zh ? "负债率" : "Ratio"} {row.ratio == null ? "—" : bpsText(row.ratio)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={`min-h-9 shrink-0 px-2 text-xs ${shown ? "bg-ink text-paper" : "border border-gold/40"}`}
                        onClick={() => setPicked(shown ? null : id)}
                      >
                        {zh ? "平仓" : "Liquidate"}
                      </button>
                    </div>
                    {shown ? (
                      <div className="mt-2 text-[11px] leading-5 text-ink/70">
                        {mine
                          ? zh
                            ? "这是你自己的仓。请还款，不要平自己。"
                            : "This is your own position. Repay it. Do not liquidate yourself."
                          : !row.open
                            ? zh
                              ? "负债率还没过 75%，现在点了也不会成交。过了 75% 之后，平仓的人替他还款，并多拿大约 5% 的抵押。他损失这 5%。平仓的人拿到的是抵押币，卖得出合约价才算赚到。"
                              : "The ratio is still at or under 75%, so the contract will refuse. Above 75%, the liquidator repays the debt and takes about 5% extra collateral. That 5% is the loss. The liquidator receives collateral, and it is profit only if it sells at the contract price."
                            : seize
                              ? zh
                                ? `你付出 ${lendText(seize.pay, spec.usdtDec)} ${spec.usdtSym}，得到 ${lendText(seize.seize, spec.collDec)} ${spec.collSym}。按合约价这些抵押值 ${lendText(seize.seizeValue, spec.usdtDec)} ${spec.usdtSym}，多出 ${lendText(seize.profit, spec.usdtDec)}。对方少了这份抵押，欠款勾掉 ${lendText(seize.wiped, spec.usdtDec)}。${seize.shortfall > 0n ? `还有 ${lendText(seize.shortfall, spec.usdtDec)} ${spec.usdtSym} 没人还，从存款里勾掉。` : ""}`
                                : `You pay ${lendText(seize.pay, spec.usdtDec)} ${spec.usdtSym} and receive ${lendText(seize.seize, spec.collDec)} ${spec.collSym}, worth ${lendText(seize.seizeValue, spec.usdtDec)}. The extra ${lendText(seize.profit, spec.usdtDec)} is the profit if you can sell it at that price. Their debt drops by ${lendText(seize.wiped, spec.usdtDec)}.${seize.shortfall > 0n ? ` ${lendText(seize.shortfall, spec.usdtDec)} ${spec.usdtSym} is written off the lenders.` : ""}`
                              : zh
                                ? "价格没读到，先不能算盈亏。"
                                : "The price did not load, so the result cannot be priced."}
                        {row.open && !mine && seize ? (
                          <button type="button" disabled={busy} className="mt-1 block min-h-9 bg-ink px-2 text-paper disabled:opacity-40" onClick={() => onLiquidate(row)}>
                            {zh ? "确认平仓" : "Confirm liquidation"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
function marketLabel(chain: LendChain) {
  return chain === "xlayer" ? "OKB" : "BNB";
}

function assetName(chain: LendChain, asset: LendAsset) {
  if (asset === "gas") return marketLabel(chain);
  if (asset === "tape") return "TAPE";
  return "BEM";
}

function positionOf(chain: LendChain, asset: LendAsset, view: LendView) {
  const spec = lendSpec(chain, asset);
  const value = collQuote(view.posted, view.price, spec.collDec);
  const ratio = debtBps(view.debt, value);
  const liq = closePrice(view.debt, view.posted, spec.collDec);
  const equity = value == null ? null : value - view.debt;
  return { spec, value, ratio, liq, equity };
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-gold/30 px-2 py-2">
      <dt className="text-[11px] text-ink/50">{k}</dt>
      <dd className="mt-1 text-sm">{v}</dd>
    </div>
  );
}
