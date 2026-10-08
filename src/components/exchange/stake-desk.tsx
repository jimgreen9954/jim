import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useExchange } from "@/lib/exchange-store";
import {
  circuitLockReady,
  claimFreshCircuit,
  claimFreshTape,
  deployCircuitLock,
  harvestLock,
  LOCK_TERMS,
  lockFreshCircuit,
  lockWafer,
  readCircuitLocks,
  readLocks,
  releaseLock,
  TAPE_LOCK,
  type CircuitSeat,
  type LockSeat,
} from "@/lib/tape-lock";
import { FEE_TO } from "@/lib/bsc";
import { tapeText, readTapeMine, type TapeSeat } from "@/lib/tape-mine";
import {
  addTapePool,
  quoteUnits,
  readTapePool,
  removeTapePool,
  showQuote,
  showTape,
  TAPE_POOL,
  TAPE_TERMS,
  tapeUnits,
  type TapePosition,
} from "@/lib/tape-pool";
import { connectXLayer, transistorHeld, XLAYER } from "@/lib/xlayer";
import { currentAccount, onAccount } from "@/lib/wallet";

function sgt(ts: number): string {
  if (!Number.isFinite(ts) || ts < 1_000_000_000 || ts > 10_000_000_000) return "—";
  try {
    return new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Singapore", hour12: false });
  } catch {
    return "—";
  }
}

function amt(value: bigint): string {
  const n = Number(tapeText(value));
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 4 }) : tapeText(value);
}

export function StakeDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [quote, setQuote] = useState<0 | 1>(0);
  const [tapeAmt, setTapeAmt] = useState("");
  const [quoteAmt, setQuoteAmt] = useState("");
  const [lpTerm, setLpTerm] = useState(2);
  const [kind, setKind] = useState<0 | 1>(0);
  const [waferAmt, setWaferAmt] = useState("");
  const [waferTerm, setWaferTerm] = useState(0);
  const [nand, setNand] = useState(0n);
  const [latch, setLatch] = useState(0n);
  const [tapeBal, setTapeBal] = useState(0n);
  const [usdtBal, setUsdtBal] = useState(0n);
  const [bemBal, setBemBal] = useState(0n);
  const [owned, setOwned] = useState<TapeSeat[]>([]);
  const [weight, setWeight] = useState(0n);
  const [seats, setSeats] = useState<LockSeat[]>([]);
  const [fresh, setFresh] = useState<CircuitSeat[]>([]);
  const [circuitId, setCircuitId] = useState("");
  const [circuitTerm, setCircuitTerm] = useState(0);
  const [ackCircuit, setAckCircuit] = useState(false);
  const [lp, setLp] = useState<TapePosition[]>([]);
  const [reserves, setReserves] = useState({ usdtTape: 0n, usdtQuote: 0n, usdtShares: 0n, bemTape: 0n, bemQuote: 0n, bemShares: 0n });
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ackLp, setAckLp] = useState(false);
  const [ackWafer, setAckWafer] = useState(false);

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readLocks(account).then((row) => { if (!dead) { setWeight(row.weight); setSeats(row.seats); } }).catch(() => undefined);
      readCircuitLocks(account).then((row) => { if (!dead) setFresh(row); }).catch(() => undefined);
      readTapePool(account).then((row) => {
        if (dead) return;
        setLp(row.positions);
        setTapeBal(row.tape);
        setUsdtBal(row.usdtBal);
        setBemBal(row.bemBal);
        setReserves({
          usdtTape: row.usdt.tape,
          usdtQuote: row.usdt.quote,
          usdtShares: row.usdt.shares,
          bemTape: row.bem.tape,
          bemQuote: row.bem.quote,
          bemShares: row.bem.shares,
        });
      }).catch(() => undefined);
      readTapeMine(account).then((row) => { if (!dead) setOwned(row.seats); }).catch(() => undefined);
      if (account) transistorHeld(account).then((row) => { if (!dead) { setNand(row.nand); setLatch(row.latch); } }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

  const say = (text: string, failed = false) => { setBad(failed); setNote(text); };
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    say(/rejected|denied/i.test(message) ? (zh ? "你取消了。" : "You cancelled.") : zh ? "没有完成。资产还在原处。" : "It did not finish. The assets stayed put.", true);
  };
  const slice = (shares: bigint, total: bigint, reserve: bigint) => (typeof shares === "bigint" && total > 0n ? (shares * reserve) / total : 0n);
  const lpTape = lp.reduce((sum, row) => sum + slice(row.shares, row.quote === 0 ? reserves.usdtShares : reserves.bemShares, row.quote === 0 ? reserves.usdtTape : reserves.bemTape), 0n);
  const lpUsdt = lp.reduce((sum, row) => row.quote === 0 ? sum + slice(row.shares, reserves.usdtShares, reserves.usdtQuote) : sum, 0n);
  const lpBem = lp.reduce((sum, row) => row.quote === 1 ? sum + slice(row.shares, reserves.bemShares, reserves.bemQuote) : sum, 0n);
  const lockedNand = seats.filter((row) => row.kind === 0).reduce((sum, row) => sum + row.amount, 0n);
  const lockedLatch = seats.filter((row) => row.kind === 1).reduce((sum, row) => sum + row.amount, 0n);
  const circuits = seats.filter((row) => row.kind === 2);
  const lockedGates = circuits.reduce((sum, row) => sum + row.gates, 0n);
  const share = weight > 0n ? Number((lockedGates * 10000n) / weight) / 100 : 0;
  const nextUnlock = [...lp.map((row) => row.unlock), ...seats.map((row) => row.unlock)].filter((ts) => ts * 1000 > Date.now()).sort((a, b) => a - b)[0];
  const now = Math.floor(Date.now() / 1000);
  const lpUntil = sgt(now + (TAPE_TERMS[lpTerm]?.days ?? 0) * 86400);
  const waferUntil = sgt(now + (LOCK_TERMS[waferTerm]?.sec ?? 0));
  const circuitUntil = sgt(now + (LOCK_TERMS[circuitTerm]?.sec ?? 0));
  const ready = circuitLockReady();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-xs tracking-widest text-gold">X Layer · TAPELIQUID</p>
        <h2 className="font-display text-3xl italic">{zh ? "质押" : "Stake"}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed">
          {zh
            ? "三本账分开。TAPE 池是流动性，对手是 USDT0 或 BEM，期限是 90 天到 3 年。晶圆和电路是另一份锁仓，期限是 180 天到 5 年。时间都是新加坡时间。到期前不能提前取出。锁仓合约没有管理员。"
            : "Three books, kept apart. The TAPE pool is liquidity against USDT0 or BEM, for 90 days to 3 years. Wafers and circuits use the other lock, for 180 days to 5 years. Times are Singapore time. Nothing comes out early. The lock has no admin."}
        </p>
      </div>
      <div className="border border-sell/50 px-3 py-3 text-sm leading-6">
        <p className="text-xs tracking-widest text-sell">{zh ? "签名前看这三句" : "Read this before you sign"}</p>
        <p>{zh ? "到期前不能取。合约没有提前解锁，也没有人能帮你改日期。" : "Nothing comes out early. The contract has no early exit, and nobody can change the date."}</p>
        <p>{zh ? "只签这一页写出来的池子和锁仓。转到别的地址，包括已经停用的旧合约，谁都取不回。" : "Sign only the pool and the lock shown on this page. Anything sent elsewhere, including the retired contracts, cannot be recovered."}</p>
        <p>{zh ? "晶圆锁上不能流片。新电路锁着仍占全网算力，到期后 TAPE 和电路分开领。旧锁仓不能改。" : "Locked wafers cannot be taped. A circuit on the new lock keeps its weight. After unlock, TAPE and the circuit are claimed apart. The old lock cannot be changed."}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Cell k={zh ? "池中 TAPE" : "TAPE in pool"} v={amt(lpTape)} />
        <Cell k={zh ? "池中 USDT0" : "USDT0 in pool"} v={showQuote(0, lpUsdt)} />
        <Cell k={zh ? "池中 BEM" : "BEM in pool"} v={amt(lpBem)} />
        <Cell k={zh ? "锁着的 NAND" : "Locked NAND"} v={lockedNand.toLocaleString("en-US")} />
        <Cell k={zh ? "锁着的 LATCH" : "Locked LATCH"} v={lockedLatch.toLocaleString("en-US")} />
        <Cell k={zh ? "锁着的电路 / 全网算力" : "Locked circuits / weight"} v={`${circuits.length} · ${share.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`} />
      </dl>
      <p className="text-xs text-ink/60">{zh ? "下一笔解锁" : "Next unlock"} {nextUnlock ? sgt(nextUnlock) : zh ? "没有未到期的仓" : "Nothing is still locked"} · {zh ? "钱包 NAND" : "Wallet NAND"} {nand.toLocaleString("en-US")} · LATCH {latch.toLocaleString("en-US")}</p>

      <article className="border border-gold p-3">
        <h3 className="font-display text-2xl italic">{zh ? "TAPE 流动性" : "TAPE liquidity"}</h3>
        <p className="mt-1 text-xs text-ink/60">{zh ? "加池两边各扣 0.20%。和池子比例对不上的部分退回，不会送给别人。到期撤回再各扣 0.20%。" : "Adding takes 0.20% on each side. Amounts that do not match the pool ratio are returned, not given to other people. Removing takes 0.20% again."}</p>
        <ul className="mt-2 max-h-64 overflow-auto border border-gold/40">
          {lp.map((row) => {
            const poolShares = row.quote === 0 ? reserves.usdtShares : reserves.bemShares;
            const tape = slice(row.shares, poolShares, row.quote === 0 ? reserves.usdtTape : reserves.bemTape);
            const other = slice(row.shares, poolShares, row.quote === 0 ? reserves.usdtQuote : reserves.bemQuote);
            const due = row.unlock * 1000 <= Date.now();
            const term = TAPE_TERMS[row.term];
            return (
              <li key={row.id} className="grid gap-2 border-t border-gold/30 px-2 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                <span className="min-w-0 break-all">
                  <span className="block">#{row.id} TAPE/{row.quote === 0 ? "USDT0" : "BEM"}</span>
                  <span className="mt-1 block font-mono">{amt(tape)} TAPE · {showQuote(row.quote === 0 ? 0 : 1, other)} {row.quote === 0 ? "USDT0" : "BEM"} · {zh ? term?.zh : term?.en}</span>
                  <span className="mt-1 block font-mono text-ink/50">{sgt(row.unlock - (term?.days ?? 0) * 86400)} → {sgt(row.unlock)}</span>
                </span>
                <button type="button" disabled={busy || !due || !account} className="min-h-8 border border-gold px-2 disabled:opacity-40" onClick={() => { if (!account) return; setBusy(true); removeTapePool(account, BigInt(row.id)).then(() => say(zh ? "流动性已撤回。" : "Liquidity removed.")).catch(fail).finally(() => setBusy(false)); }}>{due ? (zh ? "撤回" : "Remove") : (zh ? "未到期" : "Locked")}</button>
              </li>
            );
          })}
          {account && lp.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "这个地址还没有 TAPE 池仓位。" : "This address has no TAPE pool position."}</li> : null}
        </ul>
        <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); if (!account) return; setBusy(true); addTapePool(account, quote, lpTerm, tapeUnits(tapeAmt), quoteUnits(quote, quoteAmt)).then(() => say(zh ? "已加进池子。到期前不能撤。" : "Added. It cannot be removed early.")).catch(fail).finally(() => setBusy(false)); }}>
          <div className="grid grid-cols-2 border border-gold">
            {([0, 1] as const).map((id) => <button key={id} type="button" onClick={() => setQuote(id)} className={`min-h-10 text-sm ${quote === id ? "bg-ink text-paper" : ""}`}>TAPE / {id === 0 ? "USDT0" : "BEM"}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">TAPE
              <input value={tapeAmt} onChange={(event) => setTapeAmt(event.target.value)} inputMode="decimal" placeholder="TAPE" className="mt-1 min-h-11 w-full border border-gold bg-transparent px-2 font-mono outline-none" />
              <button type="button" className="mt-1 underline" onClick={() => setTapeAmt(tapeText(tapeBal))}>{zh ? `全部 ${amt(tapeBal)}` : `All ${amt(tapeBal)}`}</button>
            </label>
            <label className="text-xs">{quote === 0 ? "USDT0" : "BEM"}
              <input value={quoteAmt} onChange={(event) => setQuoteAmt(event.target.value)} inputMode="decimal" placeholder={quote === 0 ? "USDT0" : "BEM"} className="mt-1 min-h-11 w-full border border-gold bg-transparent px-2 font-mono outline-none" />
              <button type="button" className="mt-1 underline" onClick={() => setQuoteAmt(quote === 0 ? formatUnits(usdtBal, 6) : tapeText(bemBal))}>{zh ? `全部 ${quote === 0 ? showQuote(0, usdtBal) : amt(bemBal)}` : `All ${quote === 0 ? showQuote(0, usdtBal) : amt(bemBal)}`}</button>
            </label>
          </div>
          <p className="text-xs text-ink/60">{zh ? `链上可质押：TAPE ${amt(tapeBal)} · USDT0 ${showQuote(0, usdtBal)} · BEM ${amt(bemBal)}。15 秒重读。` : `Stakeable on chain: TAPE ${amt(tapeBal)} · USDT0 ${showQuote(0, usdtBal)} · BEM ${amt(bemBal)}. Reread every 15 seconds.`}</p>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
            {TAPE_TERMS.map((row) => <button key={row.id} type="button" onClick={() => { setLpTerm(row.id); setAckLp(false); }} className={`min-h-10 border px-1 text-xs ${lpTerm === row.id ? "border-ink bg-ink text-paper" : "border-gold"}`}>{zh ? row.zh : row.en}</button>)}
          </div>
          <p className="border border-sell/40 px-2 py-2 text-xs leading-5">{zh ? `这一笔锁到 ${lpUntil}（新加坡）。到期前不能撤。两边各扣 0.20%，多出来的退回。` : `This stake unlocks ${lpUntil} Singapore time. It cannot be removed early. Each side pays 0.20%, and the extra is returned.`}</p>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={ackLp} onChange={(event) => setAckLp(event.target.checked)} />{zh ? "我知道到期前取不出来" : "I know this cannot be removed early"}</label>
          <button type="submit" disabled={busy || !account || !ackLp} className="min-h-11 bg-ink text-paper disabled:opacity-40">{zh ? "签名并质押流动性" : "Sign and stake liquidity"}</button>
        </form>
      </article>

      <article className="border border-gold p-3">
        <h3 className="font-display text-2xl italic">{zh ? "晶圆" : "Wafers"}</h3>
        <p className="mt-1 text-xs text-ink/60">{zh ? "只锁 TAPELIQUID 的 NAND 和 LATCH。锁着不能流片，也不算算力。NAND 和 LATCH 分开记账。" : "Only TAPELIQUID NAND and LATCH. Locked wafers cannot be taped and do not count as weight. NAND and LATCH are separate."}</p>
        <ul className="mt-2 max-h-56 overflow-auto border border-gold/40">
          {seats.filter((row) => row.kind < 2).map((row) => {
            const due = row.unlock * 1000 <= Date.now();
            return (
              <li key={row.id} className="grid gap-1 border-t border-gold/30 px-2 py-2 text-xs sm:grid-cols-[6rem_1fr_auto] sm:items-center">
                <span>{row.kind === 0 ? "NAND" : "LATCH"} #{row.id}</span>
                <span className="font-mono">{row.amount.toLocaleString("en-US")} · {zh ? LOCK_TERMS[row.term]?.zh : LOCK_TERMS[row.term]?.en}<span className="mt-1 block text-ink/50">{sgt(row.start)} → {sgt(row.unlock)}</span></span>
                <button type="button" disabled={busy || !due} className="min-h-8 border border-gold px-2 disabled:opacity-40" onClick={() => { if (!account) return; setBusy(true); releaseLock(account, BigInt(row.id)).then(() => say(zh ? "晶圆已退回这个钱包。" : "The wafers are back in this wallet.")).catch(fail).finally(() => setBusy(false)); }}>{due ? (zh ? "取回" : "Release") : (zh ? "未到期" : "Locked")}</button>
              </li>
            );
          })}
          {account && seats.every((row) => row.kind === 2) ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "没有锁着的晶圆。" : "No wafers are locked."}</li> : null}
        </ul>
        <form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); if (!account) return; setBusy(true); lockWafer(account, kind, BigInt(waferAmt || "0"), waferTerm).then(() => say(zh ? "晶圆已锁上。到期才能取回。" : "Wafers are locked until the date.")).catch(fail).finally(() => setBusy(false)); }}>
          <div className="grid grid-cols-2 border border-gold">
            {([0, 1] as const).map((id) => <button key={id} type="button" onClick={() => setKind(id)} className={`min-h-10 text-sm ${kind === id ? "bg-ink text-paper" : ""}`}>{id === 0 ? "NAND" : "LATCH"}</button>)}
          </div>
          <input value={waferAmt} onChange={(event) => setWaferAmt(event.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={zh ? "数量" : "Amount"} className="min-h-11 border border-gold bg-transparent px-2 font-mono outline-none" />
          <p className="text-xs text-ink/60">{zh ? `链上可质押：NAND ${nand.toLocaleString("en-US")} · LATCH ${latch.toLocaleString("en-US")}。锁着的不算在里面。` : `Stakeable on chain: NAND ${nand.toLocaleString("en-US")} · LATCH ${latch.toLocaleString("en-US")}. Locked ones are not included.`}</p>
          <button type="button" className="min-h-8 justify-self-start text-xs underline" onClick={() => setWaferAmt((kind === 0 ? nand : latch).toString())}>{zh ? "填入当前这种的全部" : "Fill all of this kind"}</button>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
            {LOCK_TERMS.map((row) => <button key={row.id} type="button" onClick={() => { setWaferTerm(row.id); setAckWafer(false); }} className={`min-h-10 border px-1 text-xs ${waferTerm === row.id ? "border-ink bg-ink text-paper" : "border-gold"}`}>{zh ? row.zh : row.en}</button>)}
          </div>
          <p className="border border-sell/40 px-2 py-2 text-xs leading-5">{zh ? `NAND 或 LATCH 锁到 ${waferUntil}（新加坡）。这段时间不能流片，也不算算力。` : `These wafers stay locked until ${waferUntil} Singapore time. They cannot be taped and do not count as weight.`}</p>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={ackWafer} onChange={(event) => setAckWafer(event.target.checked)} />{zh ? "我知道锁着不能流片" : "I know these cannot be taped while locked"}</label>
          <button type="submit" disabled={busy || !account || !ackWafer} className="min-h-11 bg-ink text-paper disabled:opacity-40">{zh ? "签名并质押晶圆" : "Sign and stake wafers"}</button>
        </form>
      </article>

      <article className="border border-gold p-3">
        <h3 className="font-display text-2xl italic">{zh ? "电路" : "Circuits"}</h3>
        <p className="mt-1 text-xs leading-5 text-ink/60">
          {zh
            ? "新锁仓没有管理员。锁上后算力记在这份合约上，继续占全网权重，继续挖 TAPE。到期前不能领。到期后可以只领 TAPE，电路还在，算力还在。领电路时，没领走的 TAPE 在同一笔里打进钱包，矿池席位也在这一笔里关掉。"
            : "The new lock has no admin. While locked, the weight sits on this contract and keeps mining TAPE. Nothing can be claimed early. After unlock, TAPE can be claimed alone and the circuit keeps mining. Claiming the circuit sends any unclaimed TAPE in the same transaction and closes the mine seat."}
        </p>
        {!ready ? (
          <div className="mt-2 border border-gold/40 px-2 py-2 text-xs leading-5">
            <p>{zh ? "这份新合约还没部署。旧的电路锁仓不再接受新的锁入。已经锁在旧合约上的，仍在下面按旧规则解锁。" : "This new contract is not deployed. The old circuit lock takes no new locks. A circuit already on the old lock is released below, under the old rule."}</p>
            <button type="button" className="mt-2 min-h-11 border border-gold px-3" disabled={busy} onClick={() => {
              setBusy(true);
              void (async () => {
                try {
                  const from = account ?? (await connectXLayer());
                  setAccount(from);
                  if (from.toLowerCase() !== FEE_TO.toLowerCase()) {
                    say(zh ? `只有收费地址能部署。当前是 ${from}` : `Only the fee address can deploy. This wallet is ${from}`, true);
                    return;
                  }
                  const addr = await deployCircuitLock(from);
                  say(zh ? `已部署 ${addr}。还没写进网页。把这串地址发我，我写上之后大家才能锁。` : `Deployed ${addr}. It is not written into the site yet. Send me this address and I will pin it.`);
                } catch {
                  say(zh ? "没有部署成。签名时把 Gas Limit 改成 3000000。" : "It did not deploy. Set Gas Limit to 3000000.", true);
                } finally {
                  setBusy(false);
                }
              })();
            }}>{zh ? "收费地址部署电路锁仓（Gas Limit 填 3000000）" : "Fee address deploys the circuit lock (Gas Limit 3000000)"}</button>
          </div>
        ) : (
          <ul className="mt-2 max-h-64 overflow-auto border border-gold/40">
            {fresh.map((row) => {
              const due = row.unlock * 1000 <= Date.now();
              const pct = weight > 0n ? Number((row.gates * 10000n) / weight) / 100 : 0;
              return (
                <li key={row.id} className="grid gap-1 border-t border-gold/30 px-2 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                  <span>
                    #{row.circuitId} · {row.gates.toLocaleString("en-US")} {zh ? "门" : "gates"} · {pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%
                    <span className="mt-1 block font-mono text-ink/50">{zh ? LOCK_TERMS[row.term]?.zh : LOCK_TERMS[row.term]?.en} · {sgt(row.start)} → {sgt(row.unlock)} · {zh ? "可领" : "Claimable"} {amt(row.pending)}</span>
                  </span>
                  <span className="flex gap-1">
                    <button type="button" disabled={busy || !due || row.pending === 0n} className="min-h-8 border border-gold px-2 disabled:opacity-40" onClick={() => { if (!account) return; setBusy(true); claimFreshTape(account, BigInt(row.id)).then(() => say(zh ? "TAPE 已进这个钱包。电路还锁着，算力还在。" : "TAPE is in this wallet. The circuit stays locked and keeps its weight.")).catch(fail).finally(() => setBusy(false)); }}>{due ? (zh ? "领 TAPE" : "Claim TAPE") : (zh ? "未到期" : "Locked")}</button>
                    <button type="button" disabled={busy || !due} className="min-h-8 border border-gold px-2 disabled:opacity-40" onClick={() => { if (!account) return; setBusy(true); claimFreshCircuit(account, BigInt(row.id)).then(() => say(zh ? "电路已退回。没领的 TAPE 在同一笔里进了钱包。算力已停，要再挖就去挖矿页开工。" : "The circuit is back. Unclaimed TAPE came with it. Weight has stopped. Open it on the mine page to mine again.")).catch(fail).finally(() => setBusy(false)); }}>{zh ? "领电路" : "Claim circuit"}</button>
                  </span>
                </li>
              );
            })}
            {account && fresh.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "没有锁在新合约上的电路。" : "No circuit is on the new lock."}</li> : null}
          </ul>
        )}
        <form className="mt-3 grid gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (!account || !ready || !circuitId) return;
          setBusy(true);
          lockFreshCircuit(account, BigInt(circuitId), circuitTerm).then(() => say(zh ? "电路已锁上。算力记在锁仓合约上。到期才能领。" : "The circuit is locked. Its weight sits on the lock. Claims wait until the date.")).catch(fail).finally(() => setBusy(false));
        }}>
          <ul className="max-h-48 overflow-auto border border-gold/40">
            {owned.map((row) => (
              <li key={row.id}>
                <button type="button" disabled={!ready} onClick={() => { setCircuitId(row.id); setAckCircuit(false); }} className={`flex w-full items-center justify-between gap-2 px-2 py-2 text-left text-xs ${circuitId === row.id ? "bg-ink text-paper" : ""}`}>
                  <span>#{row.id} · {Number(row.gates).toLocaleString("en-US")} {zh ? "门" : "gates"} · {row.on ? (zh ? "挖矿中" : "Mining") : (zh ? "未开工" : "Not open")}</span>
                </button>
              </li>
            ))}
            {account && owned.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "这个地址没有可锁的电路。" : "This address has no circuit it can lock."}</li> : null}
          </ul>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-5">
            {LOCK_TERMS.map((row) => <button key={row.id} type="button" onClick={() => { setCircuitTerm(row.id); setAckCircuit(false); }} className={`min-h-10 border px-1 text-xs ${circuitTerm === row.id ? "border-ink bg-ink text-paper" : "border-gold"}`}>{zh ? row.zh : row.en}</button>)}
          </div>
          <p className="border border-sell/40 px-2 py-2 text-xs leading-5">{zh ? `锁到 ${circuitUntil}（新加坡）。到期前不能领。锁上时，这张电路上已经记给你的 TAPE 会先打进钱包。` : `Locked until ${circuitUntil} Singapore time. Nothing can be claimed early. TAPE already booked to this wallet is paid out when you lock.`}</p>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={ackCircuit} onChange={(event) => setAckCircuit(event.target.checked)} />{zh ? "我知道到期前领不了，算力记在锁仓合约上" : "I know I cannot claim early, and the weight sits on the lock"}</label>
          <button type="submit" disabled={busy || !account || !ready || !ackCircuit || !circuitId} className="min-h-11 bg-ink text-paper disabled:opacity-40">{zh ? "签名并质押电路" : "Sign and stake the circuit"}</button>
        </form>
        <p className="mt-3 text-xs tracking-widest text-gold">{zh ? "旧锁仓" : "Old lock"}</p>
        <p className="text-xs leading-5 text-ink/60">{zh ? "已经锁在旧合约上的，到期仍可解锁。电路和当时结算的 TAPE 一起退回。之后再结算的部分，旧合约取不回。这里不再接受新的锁入。" : "A circuit already on the old contract can still be released. The circuit and the TAPE settled at that moment come back together. A later settlement can stay in the old contract. This page does not lock a new one there."}</p>
        <ul className="mt-2 max-h-64 overflow-auto border border-gold/40">
          {circuits.map((row) => {
            const due = row.unlock * 1000 <= Date.now();
            const pct = weight > 0n ? Number((row.gates * 10000n) / weight) / 100 : 0;
            return (
              <li key={row.id} className="grid gap-1 border-t border-gold/30 px-2 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                <span>
                  #{row.ref} · {row.gates.toLocaleString("en-US")} {zh ? "门" : "gates"} · {pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%
                  <span className="mt-1 block font-mono text-ink/50">{zh ? LOCK_TERMS[row.term]?.zh : LOCK_TERMS[row.term]?.en} · {sgt(row.start)} → {sgt(row.unlock)} · TAPE {amt(row.tape + row.pending)}</span>
                </span>
                <span className="flex gap-1">
                  <button type="button" disabled={busy || row.pending === 0n} className="min-h-8 border border-gold px-2 disabled:opacity-40" onClick={() => { if (!account) return; setBusy(true); harvestLock(account, BigInt(row.id)).then(() => say(zh ? "这笔 TAPE 已记在锁仓里，还没进钱包。" : "That TAPE is now recorded in the lock, not in the wallet yet.")).catch(fail).finally(() => setBusy(false)); }}>{zh ? "入账" : "Book"}</button>
                  <button type="button" disabled={busy || !due} className="min-h-8 border border-gold px-2 disabled:opacity-40" onClick={() => { if (!account) return; setBusy(true); releaseLock(account, BigInt(row.id)).then(() => say(zh ? "电路和 TAPE 已退回。要再挖，去挖矿页重新开工。" : "The circuit and TAPE are back. Open it again on the mine page to keep mining.")).catch(fail).finally(() => setBusy(false)); }}>{due ? (zh ? "解锁" : "Release") : (zh ? "未到期" : "Locked")}</button>
                </span>
              </li>
            );
          })}
          {account && circuits.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "旧合约上没有锁着的电路。" : "No circuit is on the old lock."}</li> : null}
        </ul>
      </article>

      {!account ? <button type="button" className="min-h-12 bg-ink text-paper" onClick={() => { setBusy(true); connectXLayer().then(setAccount).catch(() => say(zh ? "钱包没有连上。" : "The wallet did not connect.", true)).finally(() => setBusy(false)); }}>{zh ? "连接钱包" : "Connect"}</button> : null}
      {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      <p className="break-all text-xs text-ink/50">
        <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_LOCK}`} target="_blank" rel="noreferrer">{zh ? "锁仓" : "Lock"} {TAPE_LOCK}</a>
        {" · "}
        <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_POOL}`} target="_blank" rel="noreferrer">{zh ? "TAPE 池" : "TAPE pool"} {TAPE_POOL}</a>
      </p>
    </section>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-gold/40 px-2 py-2">
      <dt className="text-xs text-ink/50">{k}</dt>
      <dd className="mt-1 font-mono text-sm">{v}</dd>
    </div>
  );
}
