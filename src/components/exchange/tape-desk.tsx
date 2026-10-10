import { useEffect, useState } from "react";
import { bemPrice } from "@/lib/bsc";
import { readTapePool } from "@/lib/tape-pool";
import {
  claimStakeBem,
  claimStakeTape,
  deployDesk,
  deskAddress,
  deskText,
  fundBemReward,
  fundTapeReward,
  fundUsdt,
  readDesk,
  sellTape,
  stakeBem,
  stakeTape,
  units,
  unstakeBem,
  unstakeTape,
  wholeTape,
  withdrawBemReward,
  withdrawBought,
  withdrawTapeReward,
  withdrawUsdt,
  type DeskState,
} from "@/lib/tape-desk";
import { XLAYER } from "@/lib/xlayer";

function apy(pot: bigint, potDec: number, potPx: number | null, staked: bigint, stakeDec: number, stakePx: number | null): string {
  if (potPx == null || stakePx == null || staked === 0n) return "—";
  if (pot === 0n) return "0";
  const reward = Number(pot) / 10 ** potDec * potPx;
  const base = Number(staked) / 10 ** stakeDec * stakePx;
  if (!Number.isFinite(reward) || !Number.isFinite(base) || base <= 0) return "—";
  return (reward / base * 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function TapeDesk({ account, zh }: { account: string | null; zh: boolean }) {
  const [desk, setDesk] = useState<string | null>(null);
  const [row, setRow] = useState<DeskState | null>(null);
  const [miss, setMiss] = useState(false);
  const [tapePx, setTapePx] = useState<number | null>(null);
  const [bemPx, setBemPx] = useState<number | null>(null);
  const [sellAmt, setSellAmt] = useState("");
  const [usdtAmt, setUsdtAmt] = useState("");
  const [tapeAmt, setTapeAmt] = useState("");
  const [bemAmt, setBemAmt] = useState("");
  const [rewardTape, setRewardTape] = useState("");
  const [rewardBem, setRewardBem] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = deskAddress();
    if (saved) setDesk(saved);
  }, []);

  useEffect(() => {
    if (!desk) return;
    let dead = false;
    const pull = () => {
      readDesk(account).then((next) => { if (!dead && next) { setRow(next); setMiss(false); } }).catch(() => { if (!dead) setMiss(true); });
      readTapePool(null).then((pool) => {
        if (dead) return;
        setTapePx(pool.usdt.tape > 0n ? Number(pool.usdt.quote) * 100 / Number(pool.usdt.tape) : null);
      }).catch(() => { if (!dead) setTapePx(null); });
      bemPrice().then((text) => { if (!dead) setBemPx(Number(text.replace(/,/g, "")) || null); }).catch(() => { if (!dead) setBemPx(null); });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account, desk]);

  const run = (task: () => Promise<unknown>, ok: string) => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。" : "Sign in at the top right.");
      return;
    }
    setBusy(true);
    task().then(() => { setBad(false); setNote(ok); return readDesk(account); }).then((next) => { if (next) setRow(next); }).catch(() => {
      setBad(true);
      setNote(zh ? "没有完成。签名留在这一页。Gas Limit 填 5000000。资产还在原处。" : "It did not finish. Stay on this page. Set Gas Limit to 5000000. The assets stayed put.");
    }).finally(() => setBusy(false));
  };

  const deploy = () => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。" : "Sign in at the top right.");
      return;
    }
    setBusy(true);
    deployDesk(account).then((addr) => {
      setDesk(addr);
      setBad(false);
      setNote(zh ? `已部署 ${addr}。把这行地址发我，写进页面之后别人用的才是这一份。` : `Deployed ${addr}. Send me this address so everyone else uses this one.`);
    }).catch(() => {
      setBad(true);
      setNote(zh ? "没有部署。Gas Limit 填 5000000。" : "It did not deploy. Set Gas Limit to 5000000.");
    }).finally(() => setBusy(false));
  };

  if (!desk) {
    return (
      <section className="border border-gold bg-card px-3 py-4 sm:px-4">
        <p className="text-[11px] tracking-[0.22em] text-gold">{zh ? "回购" : "Buyback"}</p>
        <h2 className="mt-1 font-display text-3xl italic">{zh ? "0.1 美元收一枚 TAPE" : "0.1 dollar for one TAPE"}</h2>
        <p className="mt-2 text-sm leading-6">
          {zh
            ? "固定价，不是现货价。先部署这一份 X Layer 合约。没有管理员。谁充进的 USDT0，只有谁能取回没花掉的。卖家当时换成 USDT0，TAPE 不能再取回。"
            : "A fixed bid, not the spot price. Deploy this X Layer contract first. It has no admin. Only the address that added USDT0 can take back what is unspent. A seller is paid USDT0 at once and cannot take the TAPE back."}
        </p>
        <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-ink text-sm text-paper disabled:opacity-40 sm:w-auto sm:px-6" onClick={deploy}>{zh ? "部署回购合约" : "Deploy the buyback"}</button>
        {note ? <p className={`mt-2 break-all text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </section>
    );
  }

  const maxTape = row && row.usdtPool > 0n ? row.usdtPool / 100_000n : 0n;
  const tapeApy = row ? apy(row.bemPot, 8, bemPx, row.tapeStakedTotal, 8, tapePx) : "—";
  const bemApy = row ? apy(row.tapePot, 8, tapePx, row.bemStakedTotal, 8, bemPx) : "—";

  return (
    <section className="grid gap-3">
      <article className="border border-gold bg-card px-3 py-4 sm:px-4">
        <p className="text-[11px] tracking-[0.22em] text-gold">X Layer · 1 TAPE = 0.1 USDT0</p>
        <h2 className="mt-1 font-display text-3xl italic">{zh ? "回购" : "Buyback"}</h2>
        <p className="mt-2 text-sm leading-6">
          {zh
            ? "只收整数枚。池子里的 USDT0 不够，这一笔不会成交，也不会先收 TAPE。买到的 TAPE 记在充 USDT0 的地址上，只有这个地址能取，取回去自己加池。这份合约不加池。"
            : "Whole TAPE only. If the USDT0 in the pool is short, the sale does not happen and no TAPE is taken. Bought TAPE is owed to the address that funded the USDT0. Only that address can take it out and add it to a pool. This contract does not add liquidity."}
        </p>
        <p className="mt-2 break-all font-mono text-[11px] text-ink/50">
          <a className="underline" href={`${XLAYER.explorer}/address/${desk}`} target="_blank" rel="noreferrer">{desk}</a>
        </p>
        <p className="mt-3 text-sm">{zh ? "池子可付" : "Pool can pay"} <span className="font-mono">{row ? deskText(row.usdtPool, 6, 2) : "—"} USDT0</span> · {zh ? "最多再收" : "Room for"} <span className="font-mono">{row ? maxTape.toLocaleString("en-US") : "—"} TAPE</span></p>
        {miss ? <p className="mt-1 text-xs text-ink/55">{zh ? "这一次没读到。不写成 0。" : "This read missed. It is not shown as zero."}</p> : null}
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <label className="grid gap-1 text-xs text-ink/55">
            {zh ? "卖出 TAPE，整数" : "Sell whole TAPE"}
            <input value={sellAmt} onChange={(event) => setSellAmt(event.target.value)} inputMode="numeric" placeholder="1" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            <span>{zh ? "钱包" : "Wallet"} {row ? deskText(row.tapeBal, 8) : "—"} TAPE · {zh ? "到账" : "You get"} {/^[1-9]\d*$/.test(sellAmt.trim()) ? (Number(sellAmt.trim()) * 0.1).toLocaleString("en-US", { maximumFractionDigits: 1 }) : "—"} USDT0</span>
            <button type="button" disabled={busy} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => sellTape(account ?? "", wholeTape(sellAmt)), zh ? "已换成 USDT0。" : "Sold for USDT0.")}>{zh ? "卖出" : "Sell"}</button>
          </label>
          <label className="grid gap-1 text-xs text-ink/55">
            {zh ? "充入 USDT0，用来买 TAPE" : "Add USDT0 to buy TAPE"}
            <input value={usdtAmt} onChange={(event) => setUsdtAmt(event.target.value)} inputMode="decimal" placeholder="0.1" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            <span>{zh ? "钱包" : "Wallet"} {row ? deskText(row.usdtBal, 6, 2) : "—"} · {zh ? "可取回" : "Yours"} {row ? deskText(row.usdtLeft, 6, 2) : "—"} USDT0 · {zh ? "已买到" : "Bought"} {row ? deskText(row.tapeOwed, 8) : "—"} TAPE</span>
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={busy} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => fundUsdt(account ?? "", units(usdtAmt, 6)), zh ? "USDT0 已充入。" : "USDT0 added.")}>{zh ? "充入" : "Add"}</button>
              <button type="button" disabled={busy || !row || row.usdtLeft === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => withdrawUsdt(account ?? "", row?.usdtLeft ?? 0n), zh ? "没花掉的 USDT0 已取回。" : "Unspent USDT0 is back.")}>{zh ? "取 USDT0" : "Take USDT0"}</button>
              <button type="button" disabled={busy || !row || row.tapeOwed === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => withdrawBought(account ?? "", row?.tapeOwed ?? 0n), zh ? "买到的 TAPE 已取回。" : "Bought TAPE is back.")}>{zh ? "取 TAPE" : "Take TAPE"}</button>
            </div>
          </label>
        </div>
      </article>
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">{zh ? "质押 TAPE，领 BEM" : "Stake TAPE, earn BEM"}</h3>
          <p className="mt-2 text-sm leading-6">{zh ? "本金只有你能取。BEM 奖励谁都可以充，还没分出去的只有充的人能取。" : "Only you can take your principal back. Anyone can add BEM. Only that address can take back BEM that has not vested."}</p>
          <p className="mt-2 text-sm">{zh ? "年化" : "APY"} <span className="font-mono">{tapeApy}{tapeApy === "—" ? "" : "%"}</span></p>
          <p className="mt-1 text-xs leading-5 text-ink/55">{zh ? `已质押 ${row ? deskText(row.tapeStakedTotal, 8) : "—"} TAPE。未分完 ${row ? deskText(row.bemPot, 8) : "—"} BEM。你的本金 ${row ? deskText(row.tapeStaked, 8) : "—"}，待领 ${row ? deskText(row.bemOwed, 8) : "—"} BEM。你还没分完的奖励 ${row ? deskText(row.bemSponsor, 8) : "—"} BEM。` : `Staked ${row ? deskText(row.tapeStakedTotal, 8) : "—"} TAPE. Unvested ${row ? deskText(row.bemPot, 8) : "—"} BEM. Yours ${row ? deskText(row.tapeStaked, 8) : "—"}, pending ${row ? deskText(row.bemOwed, 8) : "—"} BEM. Your unvested reward ${row ? deskText(row.bemSponsor, 8) : "—"} BEM.`}</p>
          <div className="mt-3 grid gap-2">
            <input value={tapeAmt} onChange={(event) => setTapeAmt(event.target.value)} inputMode="decimal" placeholder={zh ? "质押 TAPE" : "TAPE to stake"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => stakeTape(account ?? "", units(tapeAmt, 8)), zh ? "TAPE 已质押。" : "TAPE staked.")}>{zh ? "质押" : "Stake"}</button>
              <button type="button" disabled={busy || !row || row.tapeStaked === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => unstakeTape(account ?? "", row?.tapeStaked ?? 0n), zh ? "本金已取回。" : "Principal is back.")}>{zh ? "取回本金" : "Take principal"}</button>
            </div>
            <input value={rewardBem} onChange={(event) => setRewardBem(event.target.value)} inputMode="decimal" placeholder={zh ? "充入 BEM 奖励" : "BEM reward"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={busy} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => fundBemReward(account ?? "", units(rewardBem, 8)), zh ? "BEM 奖励已充入。" : "BEM reward added.")}>{zh ? "充奖励" : "Add"}</button>
              <button type="button" disabled={busy || !row || row.bemSponsor === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => withdrawBemReward(account ?? "", row?.bemSponsor ?? 0n), zh ? "未分完的 BEM 已取回。" : "Unvested BEM is back.")}>{zh ? "取未分完" : "Take unvested"}</button>
              <button type="button" disabled={busy || !row || row.bemOwed === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => claimStakeBem(account ?? ""), zh ? "BEM 已领取。" : "BEM claimed.")}>{zh ? "领取" : "Claim"}</button>
            </div>
          </div>
        </article>
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">{zh ? "质押 BEM，领 TAPE" : "Stake BEM, earn TAPE"}</h3>
          <p className="mt-2 text-sm leading-6">{zh ? "这里的 BEM 是 X Layer 上的。BSC 的 BEM 先用官方桥转过来，本站不经手。本金只有你能取。TAPE 奖励还没分出去的，只有充的人能取。" : "This BEM is on X Layer. Bridge BSC BEM yourself. This site does not touch that bridge. Only you can take your principal. Unvested TAPE goes back only to the address that added it."}</p>
          <p className="mt-2 text-sm">{zh ? "年化" : "APY"} <span className="font-mono">{bemApy}{bemApy === "—" ? "" : "%"}</span></p>
          <p className="mt-1 text-xs leading-5 text-ink/55">{zh ? `已质押 ${row ? deskText(row.bemStakedTotal, 8) : "—"} BEM。未分完 ${row ? deskText(row.tapePot, 8) : "—"} TAPE。你的本金 ${row ? deskText(row.bemStaked, 8) : "—"}，待领 ${row ? deskText(row.tapeOwedStake, 8) : "—"} TAPE。你还没分完的奖励 ${row ? deskText(row.tapeSponsor, 8) : "—"} TAPE。` : `Staked ${row ? deskText(row.bemStakedTotal, 8) : "—"} BEM. Unvested ${row ? deskText(row.tapePot, 8) : "—"} TAPE. Yours ${row ? deskText(row.bemStaked, 8) : "—"}, pending ${row ? deskText(row.tapeOwedStake, 8) : "—"} TAPE. Your unvested reward ${row ? deskText(row.tapeSponsor, 8) : "—"} TAPE.`}</p>
          <div className="mt-3 grid gap-2">
            <input value={bemAmt} onChange={(event) => setBemAmt(event.target.value)} inputMode="decimal" placeholder={zh ? "质押 BEM" : "BEM to stake"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => stakeBem(account ?? "", units(bemAmt, 8)), zh ? "BEM 已质押。" : "BEM staked.")}>{zh ? "质押" : "Stake"}</button>
              <button type="button" disabled={busy || !row || row.bemStaked === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => unstakeBem(account ?? "", row?.bemStaked ?? 0n), zh ? "本金已取回。" : "Principal is back.")}>{zh ? "取回本金" : "Take principal"}</button>
            </div>
            <input value={rewardTape} onChange={(event) => setRewardTape(event.target.value)} inputMode="decimal" placeholder={zh ? "充入 TAPE 奖励" : "TAPE reward"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={busy} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => fundTapeReward(account ?? "", units(rewardTape, 8)), zh ? "TAPE 奖励已充入。" : "TAPE reward added.")}>{zh ? "充奖励" : "Add"}</button>
              <button type="button" disabled={busy || !row || row.tapeSponsor === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => withdrawTapeReward(account ?? "", row?.tapeSponsor ?? 0n), zh ? "未分完的 TAPE 已取回。" : "Unvested TAPE is back.")}>{zh ? "取未分完" : "Take unvested"}</button>
              <button type="button" disabled={busy || !row || row.tapeOwedStake === 0n} className="min-h-12 border border-gold text-sm disabled:opacity-40" onClick={() => run(() => claimStakeTape(account ?? ""), zh ? "TAPE 已领取。" : "TAPE claimed.")}>{zh ? "领取" : "Claim"}</button>
            </div>
          </div>
        </article>
      </div>
      <p className="text-xs leading-5 text-ink/55">
        {zh
          ? "年化按现在还没分完的奖励、365 天分完、池子现价来算。TAPE 用 TAPE/USDT0，BEM 用 BSC 池子价，X Layer 的 BEM 按 1:1。有人再质押，或取走还没分完的奖励，这个数就变。价格没读到写成 —，不写成 0。不是承诺。"
          : "APY assumes the unvested pot pays out over 365 days at the current pool price. TAPE uses TAPE/USDT0. BEM uses the BSC pool, and X Layer BEM is counted 1:1. It changes when someone stakes or takes unvested rewards back. A missing price is —, not zero. It is not a promise."}
      </p>
      {note ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </section>
  );
}
