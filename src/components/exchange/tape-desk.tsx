import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "viem";
import { bscBemBalance, BSC_BRIDGE, quoteBridge, sendBridge, type BridgeQuote } from "@/lib/bem-bridge";
import { bemPrice, BSC } from "@/lib/bsc";
import { readTapePool, TAPE_BEM } from "@/lib/tape-pool";
import {
  deployDesk,
  deskAddress,
  deskText,
  fundUsdt,
  readDesk,
  sellTape,
  units,
  wholeTape,
  withdrawBought,
  withdrawUsdt,
  type DeskState,
} from "@/lib/tape-desk";
import {
  asTerm,
  claimTermBem,
  claimTermTape,
  deployTerm,
  fundTermBem,
  fundTermTape,
  readTerm,
  stakeTermBem,
  stakeTermTape,
  termAddress,
  unstakeTermBem,
  unstakeTermTape,
  withdrawTermBem,
  withdrawTermTape,
  type TermLock,
  type TermState,
} from "@/lib/tape-term";
import { XLAYER } from "@/lib/xlayer";

const TERMS = [
  { id: 0, zh: "三个月", en: "3 mo" },
  { id: 1, zh: "六个月", en: "6 mo" },
  { id: 2, zh: "九个月", en: "9 mo" },
  { id: 3, zh: "一年", en: "1 yr" },
  { id: 4, zh: "两年", en: "2 yr" },
  { id: 5, zh: "三年", en: "3 yr" },
] as const;

function termLabel(id: number, zh: boolean): string {
  return TERMS.find((row) => row.id === id)?.[zh ? "zh" : "en"] ?? "—";
}

function sgWhen(unix: bigint): string {
  const ms = Number(unix) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const text = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
  return `${text} SGT`;
}

function OfficialBridge({ account, zh, xBem }: { account: string | null; zh: boolean; xBem: bigint | null }) {
  const [open, setOpen] = useState(false);
  const [toX, setToX] = useState(true);
  const [amt, setAmt] = useState("");
  const [bscBal, setBscBal] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const amount = /^[0-9]*\.?[0-9]+$/.test(amt.trim()) ? (() => { try { return units(amt, 8); } catch { return null; } })() : null;

  useEffect(() => {
    if (!open || !account) return;
    let dead = false;
    bscBemBalance(account).then((value) => { if (!dead) setBscBal(value); }).catch(() => { if (!dead) setBscBal(null); });
    return () => { dead = true; };
  }, [open, account, busy]);

  useEffect(() => {
    if (!open || !account || !amount) { setQuote(null); return; }
    let dead = false;
    quoteBridge(toX, account, amount).then((next) => { if (!dead) setQuote(next); }).catch(() => { if (!dead) setQuote(null); });
    return () => { dead = true; };
  }, [open, account, toX, amount]);

  return (
    <div className="mt-3 border border-gold/40">
      <button type="button" className="flex min-h-11 w-full items-center justify-between px-3 text-left" onClick={() => setOpen((value) => !value)}>
        <span className="text-sm">{zh ? "官方跨链" : "Official bridge"}</span>
        <span className="text-xs text-ink/50">{open ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-gold/30 px-3 py-3">
          <p className="text-xs leading-5 text-ink/60">{zh ? "调用 TapeOut 已经在用的桥。BSC 锁 BEM，X Layer 铸出等量再扣桥自己的费。回来则烧掉 X Layer 的 BEM。只进当前这个钱包。本站不经手，不另收费。TAPE 不能走。" : "This calls the bridge TapeOut already runs. BSC locks BEM and X Layer mints the same amount minus the bridge's own fee. The return trip burns X Layer BEM. It arrives in this wallet. This site does not custody it and adds no fee. TAPE cannot use it."}</p>
          <div className="grid grid-cols-2 border border-gold text-sm">
            <button type="button" className={`min-h-11 ${toX ? "bg-ink text-paper" : ""}`} onClick={() => setToX(true)}>BSC → X Layer</button>
            <button type="button" className={`min-h-11 ${!toX ? "bg-ink text-paper" : ""}`} onClick={() => setToX(false)}>X Layer → BSC</button>
          </div>
          <input value={amt} onChange={(event) => setAmt(event.target.value)} inputMode="decimal" placeholder={zh ? "BEM 数量" : "BEM amount"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-sm" />
          <p className="text-xs text-ink/55">{zh ? "可转" : "Available"} {toX ? (bscBal == null ? "—" : deskText(bscBal, 8)) : (xBem == null ? "—" : deskText(xBem, 8))} BEM</p>
          <p className="text-xs leading-5">{zh ? "这次到账" : "This quote arrives"} {quote ? deskText(quote.received, 8) : "—"} BEM · {zh ? "桥留下" : "Bridge keeps"} {quote ? deskText(quote.sent - quote.received, 8) : "—"} · {toX ? "BNB" : "OKB"} {quote ? formatEther(quote.nativeFee) : "—"}</p>
          <button type="button" disabled={busy || !account || !amount || !quote} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => {
            if (!account || !amount) return;
            setBusy(true);
            sendBridge(toX, account, amount).then(() => { setBad(false); setNote(zh ? "已提交。到账要等桥的消息，不是这一笔里立刻到。" : "Submitted. It arrives with the bridge message, not in this transaction."); }).catch(() => { setBad(true); setNote(zh ? "没有跨过去。签名留在这一页。BEM 还在原来的链上。" : "It did not cross. Stay on this page. The BEM is still on the original chain."); }).finally(() => setBusy(false));
          }}>{toX ? (zh ? "签名转到 X Layer" : "Sign to X Layer") : (zh ? "签名转回 BSC" : "Sign back to BSC")}</button>
          <p className="break-all font-mono text-[11px] text-ink/40">
            <a className="underline" href={`${BSC.explorer}/address/${BSC_BRIDGE}`} target="_blank" rel="noreferrer">BSC {BSC_BRIDGE}</a>
            {" · "}
            <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_BEM}`} target="_blank" rel="noreferrer">X Layer {TAPE_BEM}</a>
          </p>
          {note ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function LockList({ locks, zh, busy, empty, onTake }: { locks: TermLock[]; zh: boolean; busy: boolean; empty: string; onTake: (index: number) => void }) {
  const open = locks.filter((row) => row.open);
  if (open.length === 0) return <p className="text-xs text-ink/50">{empty}</p>;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return (
    <ul className="grid gap-2">
      {open.map((row) => {
        const ready = now >= row.unlock;
        return (
          <li key={row.index} className="grid gap-2 border border-gold/40 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <p className="min-w-0 text-xs leading-5">
              <span className="font-mono">{deskText(row.amount, 8)}</span>
              {" · "}
              {termLabel(row.term, zh)}
              <span className="block text-ink/55">{zh ? "到期，新加坡时间" : "Unlocks, Singapore"} {sgWhen(row.unlock)}</span>
            </p>
            <button type="button" disabled={busy || !ready} className="min-h-11 w-full border border-gold px-3 text-sm disabled:opacity-40 sm:w-auto" onClick={() => onTake(row.index)}>
              {ready ? (zh ? "取回本金" : "Take principal") : (zh ? "未到期" : "Locked")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function apy(pot: bigint, potDec: number, potPx: number | null, staked: bigint, stakeDec: number, stakePx: number | null): string {
  if (!potPx || !stakePx || staked === 0n) return "—";
  if (pot === 0n) return "0";
  const reward = Number(pot) / 10 ** potDec * potPx;
  const base = Number(staked) / 10 ** stakeDec * stakePx;
  if (!Number.isFinite(reward) || !Number.isFinite(base) || base <= 0) return "—";
  return (reward / base * 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function TapeDesk({ account, zh }: { account: string | null; zh: boolean }) {
  const [desk, setDesk] = useState<string | null>(() => deskAddress());
  const [term, setTerm] = useState<string | null>(() => termAddress());
  const [row, setRow] = useState<DeskState | null>(null);
  const [stake, setStake] = useState<TermState | null>(null);
  const [miss, setMiss] = useState(false);
  const [stakeMiss, setStakeMiss] = useState(false);
  const [tapePx, setTapePx] = useState<number | null>(null);
  const [bemPx, setBemPx] = useState<number | null>(null);
  const [sellAmt, setSellAmt] = useState("");
  const [usdtAmt, setUsdtAmt] = useState("");
  const [tapeAmt, setTapeAmt] = useState("");
  const [bemAmt, setBemAmt] = useState("");
  const [tapeTerm, setTapeTerm] = useState(0);
  const [bemTerm, setBemTerm] = useState(0);
  const [tapeAck, setTapeAck] = useState(false);
  const [bemAck, setBemAck] = useState(false);
  const [rewardTape, setRewardTape] = useState("");
  const [rewardBem, setRewardBem] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDesk(deskAddress());
    setTerm(termAddress());
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (desk) {
        readDesk(account).then((next) => { if (!dead && next) { setRow(next); setMiss(false); } }).catch(() => { if (!dead) setMiss(true); });
      }
      if (term) {
        readTerm(account).then((next) => { if (!dead && next) { setStake(next); setStakeMiss(false); } }).catch(() => { if (!dead) setStakeMiss(true); });
      }
      readTapePool(null).then((pool) => {
        if (dead) return;
        setTapePx(pool.usdt.tape > 0n ? Number(pool.usdt.quote) * 100 / Number(pool.usdt.tape) : null);
      }).catch(() => { if (!dead) setTapePx(null); });
      bemPrice().then((text) => { if (!dead) setBemPx(Number(text.replace(/,/g, "")) || null); }).catch(() => { if (!dead) setBemPx(null); });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account, desk, term]);

  const run = (task: () => Promise<unknown>, ok: string, refresh: "desk" | "term") => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。这一页不会跳进 OKX。" : "Sign in at the top right. This page stays here.");
      return;
    }
    setBusy(true);
    task()
      .then(async () => {
        setBad(false);
        setNote(ok);
        if (refresh === "desk") {
          const next = await readDesk(account);
          if (next) setRow(next);
        } else {
          const next = await readTerm(account);
          if (next) setStake(next);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        const code = (err as { code?: number }).code;
        setBad(true);
        if (message === "amount" || message === "integer") {
          setNote(zh ? "数量是空的，或不是数字。充 USDT0 先在右边那一格填写，或点全部。卖 TAPE 只能填整数。" : "The amount is empty or not a number. Type the USDT0 on the right, or tap All. TAPE sells are whole numbers.");
          return;
        }
        if (code === 4001) {
          setNote(zh ? "签名取消了。USDT0 还在钱包，没有充进去。" : "The signature was cancelled. The USDT0 is still in the wallet.");
          return;
        }
        setNote(zh ? "没有充进去。要签两笔：第一笔只授权，币还在钱包；第二笔才进回购。两笔都要确认。地址是上面这一份。Gas Limit 填 500000。" : "It did not go in. Two signatures: the first only approves, the coins stay in the wallet; the second deposits. Confirm both. The address is the one above. Set Gas Limit to 500000.");
      })
      .finally(() => setBusy(false));
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
      setNote(zh ? "没有部署。留在这一页。Gas Limit 填 5000000。" : "It did not deploy. Stay on this page. Set Gas Limit to 5000000.");
    }).finally(() => setBusy(false));
  };

  const deployLocks = () => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。" : "Sign in at the top right.");
      return;
    }
    setBusy(true);
    deployTerm(account).then((addr) => {
      setTerm(addr);
      setBad(false);
      setNote(zh ? `期限质押已部署 ${addr}。把这行地址发我写进页面。现在只有你这个浏览器看得到这一份。` : `Timed stake deployed at ${addr}. Send me this address to hardcode it. Only this browser can see it until then.`);
    }).catch(() => {
      setBad(true);
      setNote(zh ? "期限质押没有部署。留在这一页。Gas Limit 填 5000000。" : "Timed stake did not deploy. Stay on this page. Set Gas Limit to 5000000.");
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
        <OfficialBridge account={account} zh={zh} xBem={null} />
        {note ? <p className={`mt-2 break-all text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </section>
    );
  }

  const maxTape = row && row.usdtPool > 0n ? row.usdtPool / 100_000n : 0n;
  const tapeApy = stake ? apy(stake.bemPot, 8, bemPx, stake.tapeStakedTotal, 8, tapePx) : "—";
  const bemApy = stake ? apy(stake.tapePot, 8, tapePx, stake.bemStakedTotal, 8, bemPx) : "—";
  const openTape = stake?.tapeLocks.filter((lock) => lock.open).length ?? 0;
  const openBem = stake?.bemLocks.filter((lock) => lock.open).length ?? 0;

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
            <button type="button" disabled={busy} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => sellTape(account ?? "", wholeTape(sellAmt)), zh ? "已换成 USDT0。" : "Sold for USDT0.", "desk")}>{zh ? "卖出" : "Sell"}</button>
          </label>
          <label className="grid gap-1 text-xs text-ink/55">
            {zh ? "充入 USDT0，用来买 TAPE" : "Add USDT0 to buy TAPE"}
            <input value={usdtAmt} onChange={(event) => setUsdtAmt(event.target.value)} inputMode="decimal" placeholder="100" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            <span>{zh ? "钱包" : "Wallet"} {row ? deskText(row.usdtBal, 6, 2) : "—"} · {zh ? "可取回" : "Yours"} {row ? deskText(row.usdtLeft, 6, 2) : "—"} USDT0 · {zh ? "已买到" : "Bought"} {row ? deskText(row.tapeOwed, 8) : "—"} TAPE</span>
            <p className="leading-5">{zh ? "不会自动把钱包里的 USDT0 充进去。先填数量。点充入要签两笔：第一笔授权，币还在钱包；第二笔才进这个回购合约。" : "It does not deposit the wallet balance by itself. Type an amount. Add asks for two signatures: approve first, the coins stay put; the second one deposits."}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button type="button" disabled={busy || !row || row.usdtBal === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => setUsdtAmt(row ? formatUnits(row.usdtBal, 6) : "")}>{zh ? "全部" : "All"}</button>
              <button type="button" disabled={busy} className="min-h-12 bg-ink px-1 text-sm text-paper disabled:opacity-40" onClick={() => run(() => fundUsdt(account ?? "", units(usdtAmt, 6)), zh ? "USDT0 已充入。池子要等这一页重新读到才变。" : "USDT0 is in. The pool changes when this page reads it again.", "desk")}>{zh ? "充入" : "Add"}</button>
              <button type="button" disabled={busy || !row || row.usdtLeft === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawUsdt(account ?? "", row?.usdtLeft ?? 0n), zh ? "没花掉的 USDT0 已取回。" : "Unspent USDT0 is back.", "desk")}>{zh ? "取 USDT0" : "Take USDT0"}</button>
              <button type="button" disabled={busy || !row || row.tapeOwed === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawBought(account ?? "", row?.tapeOwed ?? 0n), zh ? "买到的 TAPE 已取回。" : "Bought TAPE is back.", "desk")}>{zh ? "取 TAPE" : "Take TAPE"}</button>
            </div>
          </label>
        </div>
      </article>
      {!term ? (
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">{zh ? "期限质押还没部署" : "Timed stake is not deployed"}</h3>
          <p className="mt-2 text-sm leading-6">
            {zh
              ? "六档写死：三个月、六个月、九个月、一年、两年、三年。到期才能取本金，奖励可以先领。和上面的回购不是同一份合约。上面那份旧质押没有期限，页面不再往那里存。点一次部署。Gas Limit 填 5000000。部署完把地址发我写进页面。"
              : "Six terms are fixed: 3, 6 and 9 months, then 1, 2 and 3 years. Principal waits until expiry. Rewards can be claimed earlier. This is not the buyback contract. The old stake had no lock, and this page no longer deposits there. Deploy once. Set Gas Limit to 5000000, then send me the address to hardcode."}
          </p>
          <button type="button" disabled={busy} className="mt-3 min-h-12 w-full bg-ink text-sm text-paper disabled:opacity-40 sm:w-auto sm:px-6" onClick={deployLocks}>{zh ? "部署期限质押" : "Deploy timed stake"}</button>
        </article>
      ) : (
        <p className="break-all font-mono text-[11px] text-ink/50">
          {zh ? "期限质押" : "Timed stake"}{" "}
          <a className="underline" href={`${XLAYER.explorer}/address/${term}`} target="_blank" rel="noreferrer">{term}</a>
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">{zh ? "质押 TAPE，领 BEM" : "Stake TAPE, earn BEM"}</h3>
          <p className="mt-2 text-sm leading-6">{zh ? "先选期限，再勾确认。到期前本金取不出。BEM 奖励不用等到期。谁充的奖励，没分完的只有谁能取。" : "Pick a term, then tick the box. Principal cannot leave early. BEM rewards do not wait. Only the address that added a reward can take back what has not vested."}</p>
          <p className="mt-2 text-sm">{zh ? "年化" : "APY"} <span className="font-mono">{tapeApy}{tapeApy === "—" ? "" : "%"}</span></p>
          <p className="mt-1 text-xs leading-5 text-ink/55">{zh ? `已质押 ${stake ? deskText(stake.tapeStakedTotal, 8) : "—"} TAPE。未分完 ${stake ? deskText(stake.bemPot, 8) : "—"} BEM。你的本金 ${stake ? deskText(stake.tapeStaked, 8) : "—"}，待领 ${stake ? deskText(stake.bemOwed, 8) : "—"} BEM。你还没分完的奖励 ${stake ? deskText(stake.bemSponsor, 8) : "—"} BEM。` : `Staked ${stake ? deskText(stake.tapeStakedTotal, 8) : "—"} TAPE. Unvested ${stake ? deskText(stake.bemPot, 8) : "—"} BEM. Yours ${stake ? deskText(stake.tapeStaked, 8) : "—"}, pending ${stake ? deskText(stake.bemOwed, 8) : "—"} BEM. Your unvested reward ${stake ? deskText(stake.bemSponsor, 8) : "—"} BEM.`}</p>
          {stakeMiss ? <p className="mt-1 text-xs text-ink/55">{zh ? "期限这一次没读到。不写成 0。" : "This stake read missed. It is not shown as zero."}</p> : null}
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {TERMS.map((item) => (
              <button key={item.id} type="button" className={`min-h-11 px-1 text-sm ${tapeTerm === item.id ? "bg-ink text-paper" : "border border-gold"}`} onClick={() => { setTapeTerm(item.id); setTapeAck(false); }}>{zh ? item.zh : item.en}</button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/55">{zh ? `同时未到期 ${openTape}/16` : `Open locks ${openTape}/16`}</p>
          <div className="mt-3 grid gap-2">
            <input value={tapeAmt} onChange={(event) => setTapeAmt(event.target.value)} inputMode="decimal" placeholder={zh ? "质押 TAPE" : "TAPE to stake"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm" />
            <label className="flex min-h-11 items-start gap-2 text-xs leading-5">
              <input type="checkbox" className="mt-1 size-4 shrink-0" checked={tapeAck} onChange={(event) => setTapeAck(event.target.checked)} />
              <span>{zh ? `我知道这笔 TAPE 锁 ${termLabel(tapeTerm, true)}，到期前不能取回本金。` : `I know this TAPE locks for ${termLabel(tapeTerm, false)}. Principal cannot leave early.`}</span>
            </label>
            <button type="button" disabled={busy || !term || !tapeAck} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => stakeTermTape(account ?? "", units(tapeAmt, 8), asTerm(tapeTerm)), zh ? "TAPE 已按期限质押。" : "TAPE is locked for the term.", "term")}>{zh ? `质押 ${termLabel(tapeTerm, true)}` : `Stake ${termLabel(tapeTerm, false)}`}</button>
            <LockList locks={stake?.tapeLocks ?? []} zh={zh} busy={busy || !term} empty={zh ? (term ? "还没有锁仓。" : "部署之后记在这里。") : (term ? "No lock yet." : "Shown after deploy.")} onTake={(index) => run(() => unstakeTermTape(account ?? "", index), zh ? "到期本金已取回。" : "Expired principal is back.", "term")} />
            <input value={rewardBem} onChange={(event) => setRewardBem(event.target.value)} inputMode="decimal" placeholder={zh ? "充入 BEM 奖励" : "BEM reward"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={busy || !term} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => fundTermBem(account ?? "", units(rewardBem, 8)), zh ? "BEM 奖励已充入。" : "BEM reward added.", "term")}>{zh ? "充奖励" : "Add"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.bemSponsor === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawTermBem(account ?? "", stake?.bemSponsor ?? 0n), zh ? "未分完的 BEM 已取回。" : "Unvested BEM is back.", "term")}>{zh ? "取未分完" : "Unvested"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.bemOwed === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => claimTermBem(account ?? ""), zh ? "BEM 已领取。本金还锁着。" : "BEM claimed. Principal stays locked.", "term")}>{zh ? "领取" : "Claim"}</button>
            </div>
          </div>
        </article>
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">{zh ? "质押 BEM，领 TAPE" : "Stake BEM, earn TAPE"}</h3>
          <p className="mt-2 text-sm leading-6">{zh ? "这里的 BEM 是 X Layer 上的。BSC 的先用下面收起的官方桥转过来。本站不经手。本金按期限锁，TAPE 奖励可以先领。" : "This BEM is on X Layer. Move BSC BEM with the official bridge below. This site does not custody it. Principal follows the term. TAPE rewards can be claimed earlier."}</p>
          <p className="mt-2 text-sm">{zh ? "年化" : "APY"} <span className="font-mono">{bemApy}{bemApy === "—" ? "" : "%"}</span></p>
          <p className="mt-1 text-xs leading-5 text-ink/55">{zh ? `已质押 ${stake ? deskText(stake.bemStakedTotal, 8) : "—"} BEM。未分完 ${stake ? deskText(stake.tapePot, 8) : "—"} TAPE。你的本金 ${stake ? deskText(stake.bemStaked, 8) : "—"}，待领 ${stake ? deskText(stake.tapeOwed, 8) : "—"} TAPE。你还没分完的奖励 ${stake ? deskText(stake.tapeSponsor, 8) : "—"} TAPE。` : `Staked ${stake ? deskText(stake.bemStakedTotal, 8) : "—"} BEM. Unvested ${stake ? deskText(stake.tapePot, 8) : "—"} TAPE. Yours ${stake ? deskText(stake.bemStaked, 8) : "—"}, pending ${stake ? deskText(stake.tapeOwed, 8) : "—"} TAPE. Your unvested reward ${stake ? deskText(stake.tapeSponsor, 8) : "—"} TAPE.`}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {TERMS.map((item) => (
              <button key={item.id} type="button" className={`min-h-11 px-1 text-sm ${bemTerm === item.id ? "bg-ink text-paper" : "border border-gold"}`} onClick={() => { setBemTerm(item.id); setBemAck(false); }}>{zh ? item.zh : item.en}</button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/55">{zh ? `同时未到期 ${openBem}/16` : `Open locks ${openBem}/16`}</p>
          <div className="mt-3 grid gap-2">
            <input value={bemAmt} onChange={(event) => setBemAmt(event.target.value)} inputMode="decimal" placeholder={zh ? "质押 BEM" : "BEM to stake"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm" />
            <label className="flex min-h-11 items-start gap-2 text-xs leading-5">
              <input type="checkbox" className="mt-1 size-4 shrink-0" checked={bemAck} onChange={(event) => setBemAck(event.target.checked)} />
              <span>{zh ? `我知道这笔 BEM 锁 ${termLabel(bemTerm, true)}，到期前不能取回本金。` : `I know this BEM locks for ${termLabel(bemTerm, false)}. Principal cannot leave early.`}</span>
            </label>
            <button type="button" disabled={busy || !term || !bemAck} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={() => run(() => stakeTermBem(account ?? "", units(bemAmt, 8), asTerm(bemTerm)), zh ? "BEM 已按期限质押。" : "BEM is locked for the term.", "term")}>{zh ? `质押 ${termLabel(bemTerm, true)}` : `Stake ${termLabel(bemTerm, false)}`}</button>
            <LockList locks={stake?.bemLocks ?? []} zh={zh} busy={busy || !term} empty={zh ? (term ? "还没有锁仓。" : "部署之后记在这里。") : (term ? "No lock yet." : "Shown after deploy.")} onTake={(index) => run(() => unstakeTermBem(account ?? "", index), zh ? "到期本金已取回。" : "Expired principal is back.", "term")} />
            <input value={rewardTape} onChange={(event) => setRewardTape(event.target.value)} inputMode="decimal" placeholder={zh ? "充入 TAPE 奖励" : "TAPE reward"} className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <button type="button" disabled={busy || !term} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => fundTermTape(account ?? "", units(rewardTape, 8)), zh ? "TAPE 奖励已充入。" : "TAPE reward added.", "term")}>{zh ? "充奖励" : "Add"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.tapeSponsor === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => withdrawTermTape(account ?? "", stake?.tapeSponsor ?? 0n), zh ? "未分完的 TAPE 已取回。" : "Unvested TAPE is back.", "term")}>{zh ? "取未分完" : "Unvested"}</button>
              <button type="button" disabled={busy || !term || !stake || stake.tapeOwed === 0n} className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40" onClick={() => run(() => claimTermTape(account ?? ""), zh ? "TAPE 已领取。本金还锁着。" : "TAPE claimed. Principal stays locked.", "term")}>{zh ? "领取" : "Claim"}</button>
            </div>
          </div>
          <OfficialBridge account={account} zh={zh} xBem={stake ? stake.bemBal : row ? row.bemBal : null} />
        </article>
      </div>
      <p className="text-xs leading-5 text-ink/55">
        {zh
          ? "年化按现在还没分完的奖励、365 天分完、池子现价来算。TAPE 用 TAPE/USDT0，BEM 用 BSC 池子价，X Layer 的 BEM 按 1:1。有人再质押，或取走还没分完的奖励，这个数就变。价格没读到写成 —，不写成 0。不是承诺。到期时间是新加坡时间。签名停在这一页。"
          : "APY assumes the unvested pot pays out over 365 days at the current pool price. TAPE uses TAPE/USDT0. BEM uses the BSC pool, and X Layer BEM is counted 1:1. It changes when someone stakes or takes unvested rewards back. A missing price is —, not zero. It is not a promise. Unlock times are Singapore. Signing stays on this page."}
      </p>
      {note ? <p className={`break-all text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </section>
  );
}
