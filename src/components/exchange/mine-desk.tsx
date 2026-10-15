import { useEffect, useState, type ReactNode } from "react";
import { BSC } from "@/lib/bsc";
import { useExchange } from "@/lib/exchange-store";
import { bemText, claimPod, getPodMiners, POD, readPodPending, readPodStats, type PodStats } from "@/lib/pod";
import { claimTape, openTape, readTapeClaims, readTapeMine, TAPE, TAPE_BOOK, TAPE_MINE, tapeEra, tapeText, type TapeBoard, type TapeClaim } from "@/lib/tape-mine";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectXLayer, matchCircuitTask, rememberedCircuits, rememberTask, rememberedTasks, XLAYER } from "@/lib/xlayer";
import { StakeDesk } from "@/components/exchange/stake-desk";
import { BurnDesk } from "@/components/exchange/burn-desk";
import { TapeDesk } from "@/components/exchange/tape-desk";

export function MineDesk({ lock }: { lock?: "claim" | "stake" | "ash" | "bid" | "bem" } = {}) {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [stats, setStats] = useState<PodStats | null>(null);
  const [miners, setMiners] = useState<{ cpu: string; circuits: string; circuitId: number; taskId: number; pending: bigint; key: `0x${string}` }[]>([]);
  const [snap, setSnap] = useState("");
  const [tape, setTape] = useState<TapeBoard | null>(null);
  const [tapeErr, setTapeErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet] = useState<"claim" | "stake" | "ash" | "bid">("claim");
  const [networkOpen, setNetworkOpen] = useState(false);
  const [tasks, setTasks] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<string | null>(null);
  const [claimTab, setClaimTab] = useState<"all" | "log">("all");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [claims, setClaims] = useState<TapeClaim[]>([]);
  const [claimsReady, setClaimsReady] = useState(false);

  useEffect(() => onAccount((next) => setAccount(next)), []);
  useEffect(() => setTasks(rememberedTasks()), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      readPodStats().then((row) => { if (!dead) setStats(row); }).catch(() => undefined);
      if (sheet !== "claim") return;
      if (account) {
        const known = rememberedCircuits(account);
        if (known.length) {
          setTape((prev) => {
            const seen = new Set((prev?.seats ?? []).map((row) => row.id));
            const extra = known.filter((row) => !seen.has(row.id)).map((row) => ({ id: row.id, gates: row.gates, on: false, pending: 0n, share: "0" }));
            if (!extra.length) return prev;
            const seats = [...extra, ...(prev?.seats ?? [])];
            return prev ? { ...prev, seats, scanOk: true } : prev;
          });
        }
      }
      readTapeMine(account, (head) => {
        if (dead) return;
        const known = account ? rememberedCircuits(account) : [];
        const seen = new Set(head.seats.map((row) => row.id));
        const extra = known.filter((row) => !seen.has(row.id)).map((row) => ({ id: row.id, gates: row.gates, on: false, pending: 0n, share: "0" as const }));
        const seats = extra.length ? [...extra, ...head.seats] : head.seats;
        setTapeErr(null);
        setTape((prev) => prev && prev.seats.length > 0 ? { ...head, seats: prev.seats, open: prev.open, scanning: true, scanOk: prev.scanOk } : { ...head, seats });
      }).then((row) => {
        if (dead) return;
        setTapeErr(null);
        setTape((prev) => row.scanOk || !prev?.seats.length ? row : { ...prev, scanning: false });
      }).catch(() => { if (!dead) setTapeErr(zh ? "链上没读到。失败不会写成 0。" : "The chain did not answer. A miss is not written as zero."); });
    };
    pull();
    const id = window.setInterval(pull, sheet === "claim" ? 90_000 : 180_000);
    const onShow = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { dead = true; window.clearInterval(id); document.removeEventListener("visibilitychange", onShow); };
  }, [account, sheet]);

  useEffect(() => {
    if (!account) {
      setMiners([]);
      return;
    }
    let dead = false;
    getPodMiners({ data: { account } })
      .then(async (snapRow) => {
        if (dead) return;
        setSnap(snapRow.at);
        const live = await readPodPending(snapRow.miners.slice(0, 24));
        if (dead) return;
        setMiners(snapRow.miners.slice(0, 24).map((row, i) => ({ ...row, pending: live[i]?.pending ?? 0n, key: live[i]?.key ?? "0x" })));
      })
      .catch(() => { if (!dead) setMiners([]); });
    return () => { dead = true; };
  }, [account]);

  useEffect(() => {
    if (!account) { setClaims([]); setClaimsReady(true); return; }
    let dead = false;
    setClaimsReady(false);
    readTapeClaims(account).then((rows) => { if (!dead) setClaims(rows); }).catch(() => undefined).finally(() => { if (!dead) setClaimsReady(true); });
    return () => { dead = true; };
  }, [account]);

  const pendingBem = miners.reduce((sum, row) => sum + row.pending, 0n);
  const pendingTape = tape?.seats.reduce((sum, row) => sum + row.pending, 0n) ?? 0n;
  const myWeight = tape?.seats.reduce((sum, row) => sum + (row.on ? BigInt(row.gates) : 0n), 0n) ?? 0n;
  const myShare = tape && tape.weight > 0n ? (tape.daily * myWeight) / tape.weight : 0n;
  const say = (text: string, failed = false) => { setBad(failed); setNote(text); };

  const termParked = tape ? (tape.termHeld > 0n ? tape.termHeld : tape.termPrincipal + tape.termReward) : 0n;
  const termClaimable = tape && termParked > tape.termPrincipal + tape.termReward ? termParked - tape.termPrincipal - tape.termReward : 0n;
  const parked = tape ? tape.burned + tape.pooled + tape.circuitHeld + tape.waferHeld + termParked : 0n;
  const circulating = tape ? (tape.supply > parked ? tape.supply - parked : 0n) : 0n;
  const unmined = tape && tape.scanOk ? (tape.cap > tape.supply + tape.pendingNet ? tape.cap - tape.supply - tape.pendingNet : 0n) : 0n;
  const freePending = tape && tape.scanOk && tape.pendingNet > tape.pendingStaked ? tape.pendingNet - tape.pendingStaked : 0n;
  const freeWeight = tape && tape.scanOk && tape.weight > tape.stakedWeight ? tape.weight - tape.stakedWeight : 0n;
  const idle = tape && tape.scanOk ? Math.max(0, tape.circuits - tape.open) : 0;
  const stakedIdle = tape && tape.scanOk ? Math.max(0, tape.staked - tape.stakedLive) : 0;
  const todayStaked = tape && tape.scanOk && tape.weight > 0n ? (tape.daily * tape.stakedWeight) / tape.weight : 0n;
  const todayFree = tape && tape.scanOk ? tape.daily - todayStaked : 0n;
  const era = tape ? tapeEra(tape.start) : null;
  const view = lock === "bem" ? "bem" : (lock ?? sheet);
  const showNet = lock == null;
  const share = (part: bigint, whole: bigint) => (whole > 0n ? `${(Number((part * 10000n) / whole) / 100).toFixed(2)}%` : "—");
  const when = (sec: bigint) => new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(Number(sec) * 1000));

  return (
    <section className="flex flex-col gap-3">
      {showNet ? (
      <article className="border border-gold bg-card">
        <button type="button" onClick={() => setNetworkOpen((open) => !open)} className="flex min-h-11 w-full items-center justify-between px-3 text-left text-sm">
          <span>{zh ? "全网 TAPE" : "TAPE network"}</span>
          <span className="text-xs text-ink/50">{networkOpen ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
        </button>
        {networkOpen && tape ? (
          <div className="border-t border-gold/40 px-3 py-2">
            <Book title={zh ? "流通是这样减出来的" : "How circulation is subtracted"}>
              <Line k={zh ? "已领出" : "Claimed"} v={`${amount(tape.supply)} · ${share(tape.supply, tape.cap)} ${zh ? "硬顶" : "of cap"}`} />
              <Line k={zh ? "减 黑洞销毁" : "Minus burned"} v={`${amount(tape.burned)} · ${share(tape.burned, tape.supply)} ${zh ? "已领出" : "of claimed"}`} />
              <Line k={zh ? "减 TAPE 池" : "Minus the pool"} v={amount(tape.pooled)} />
              <Line k={zh ? "减 电路锁仓里已领未提出" : "Minus circuit lock"} v={amount(tape.circuitHeld)} />
              <Line k={zh ? "减 晶圆锁仓里的 TAPE" : "Minus wafer lock"} v={amount(tape.waferHeld)} />
              <Line k={zh ? "减 期限本金" : "Minus stake principal"} v={`${amount(tape.termPrincipal)} · ${zh ? "正在锁的，和到期还没取回的" : "Still locked, and matured but not taken"}`} />
              <Line k={zh ? "减 还没分完的奖励" : "Minus rewards not yet vested"} v={amount(tape.termReward)} />
              <Line k={zh ? "减 已经可以领、还没领走" : "Minus vested, not claimed"} v={amount(termClaimable)} />
              <Line k={zh ? "等于 实时流通" : "Equals circulating"} v={`${amount(circulating)} · ${share(circulating, tape.supply)} ${zh ? "已领出" : "of claimed"} · ${share(circulating, tape.cap)} ${zh ? "硬顶" : "of cap"}`} />
            </Book>
            <Book title={zh ? "还没进流通" : "Not circulating yet"}>
              <Line k={zh ? "已挖未领" : "Mined, not claimed"} v={tape.scanOk ? `${amount(tape.pendingNet)} · ${share(tape.pendingNet, tape.supply + tape.pendingNet)} ${zh ? "已挖" : "of mined"}` : "—"} />
              <Line k={zh ? "其中普通矿机未领" : "Of that, open wallets"} v={tape.scanOk ? amount(freePending) : "—"} />
              <Line k={zh ? "其中质押矿机未领" : "Of that, staked miners"} v={tape.scanOk ? amount(tape.pendingStaked) : "—"} />
              <Line k={zh ? "还没挖出" : "Not yet mined"} v={tape.scanOk ? `${amount(unmined)} · ${share(unmined, tape.cap)} ${zh ? "硬顶" : "of cap"}` : "—"} />
              <Line k={zh ? "硬顶" : "Cap"} v={amount(tape.cap)} />
              <Line k={zh ? "今日排放" : "Today"} v={amount(tape.daily)} />
            </Book>
            <Book title={zh ? "矿机和算力" : "Miners and weight"}>
              <Line k={zh ? "已流片" : "Taped"} v={tape.scanOk ? tape.circuits.toLocaleString("en-US") : "—"} />
              <Line k={zh ? "正在挖" : "Mining"} v={tape.scanOk ? `${tape.open.toLocaleString("en-US")} · ${share(BigInt(tape.open), BigInt(tape.circuits))}` : "—"} />
              <Line k={zh ? "没在挖" : "Not mining"} v={tape.scanOk ? idle.toLocaleString("en-US") : "—"} />
              <Line k={zh ? "质押中" : "Staked"} v={tape.scanOk ? tape.staked.toLocaleString("en-US") : "—"} />
              <Line k={zh ? "质押且正在挖" : "Staked and mining"} v={tape.scanOk ? tape.stakedLive.toLocaleString("en-US") : "—"} />
              <Line k={zh ? "质押但没在挖" : "Staked, not mining"} v={tape.scanOk ? stakedIdle.toLocaleString("en-US") : "—"} />
              <Line k={zh ? "全网算力" : "Network weight"} v={tape.scanOk ? tape.weight.toLocaleString("en-US") : "—"} />
              <Line k={zh ? "质押算力" : "Staked weight"} v={tape.scanOk ? `${tape.stakedWeight.toLocaleString("en-US")} · ${share(tape.stakedWeight, tape.weight)}` : "—"} />
              <Line k={zh ? "普通算力" : "Wallet weight"} v={tape.scanOk ? `${freeWeight.toLocaleString("en-US")} · ${share(freeWeight, tape.weight)}` : "—"} />
              <Line k={zh ? "质押约占今日" : "Stake about today"} v={tape.scanOk ? amount(todayStaked) : "—"} />
              <Line k={zh ? "普通约占今日" : "Wallets about today"} v={tape.scanOk ? amount(todayFree) : "—"} />
            </Book>
            <Book title={zh ? "减半" : "Halving"}>
              <Line k={zh ? "开始" : "Started"} v={when(tape.start)} />
              <Line k={zh ? "下一次减半" : "Next halving"} v={era ? `${when(era.next)} · ${zh ? "新加坡" : "Singapore"}` : "—"} />
              <Line k={zh ? "现在是第几期" : "Era"} v={era ? (era.era + 1n).toString() : "—"} />
            </Book>
            <details className="mt-2 text-xs text-ink/45">
              <summary className="cursor-pointer">{zh ? "说明" : "Notes"}</summary>
              <p className="mt-2 leading-5">{zh ? "期限合约里的整笔都不算流通。已挖未领还没铸出。时间是新加坡时间。" : "TAPE still in the term contract is not circulating. Unclaimed mined TAPE is not minted. Times are Singapore."}</p>
            </details>
            <p className="mt-1 break-all text-xs text-ink/40">
              <a className="underline" href={`${XLAYER.explorer}/address/${TAPE}`} target="_blank" rel="noreferrer">TAPE</a>
              {" · "}
              <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_BOOK.ash}`} target="_blank" rel="noreferrer">{zh ? "黑洞" : "Burn"}</a>
              {" · "}
              <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_BOOK.pool}`} target="_blank" rel="noreferrer">{zh ? "池" : "Pool"}</a>
              {" · "}
              <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_BOOK.circuit}`} target="_blank" rel="noreferrer">{zh ? "电路锁仓" : "Circuit lock"}</a>
              {" · "}
              <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_BOOK.wafer}`} target="_blank" rel="noreferrer">{zh ? "晶圆锁仓" : "Wafer lock"}</a>
            </p>
          </div>
        ) : networkOpen ? <p className="border-t border-gold/40 px-3 py-3 text-xs text-ink/55">{zh ? "链上还没读到。失败不会写成 0。" : "The chain has not answered. A miss is not written as zero."}</p> : null}
      </article>
      ) : null}
      {view === "stake" ? <StakeDesk /> : view === "ash" ? <BurnDesk /> : view === "bid" ? <TapeDesk account={account} zh={zh} /> : (
    <section className="grid items-start gap-4">
      {view === "bem" ? (
      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-xs tracking-widest text-gold">BSC · tapeout.net</p>
        <h2 className="font-display text-3xl italic">{zh ? "领 TapeOut BEM" : "Claim TapeOut BEM"}</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Cell k={zh ? "今天排放" : "Daily emission"} v={stats ? `${Number(stats.daily).toLocaleString("en-US", { maximumFractionDigits: 2 })} BEM` : "—"} />
          <Cell k={zh ? "已铸" : "Minted"} v={stats ? `${Number(stats.mined).toLocaleString("en-US", { maximumFractionDigits: 2 })} BEM` : "—"} />
          <Cell k={zh ? "作废" : "Forgone"} v={stats ? `${Number(stats.forgone).toLocaleString("en-US", { maximumFractionDigits: 4 })} BEM` : "—"} />
          <Cell k={zh ? "矿机" : "Miners"} v={stats ? `${stats.verified} / ${stats.miners}` : "—"} />
          <Cell k={zh ? "已验证权重" : "Verified weight"} v={stats?.verifWeight ?? "—"} />
          <Cell k={zh ? "未验证权重" : "Unverified weight"} v={stats?.unverWeight ?? "—"} />
        </dl>
        <p className="mt-3 text-sm">{zh ? "这个地址待领" : "Pending here"} <span className="font-mono">{account ? bemText(pendingBem) : "—"} BEM</span></p>
        <p className="mt-1 text-xs text-ink/50">{snap ? (zh ? `名单 ${snap}` : `List ${snap}`) : zh ? "连上钱包后读名单" : "The list is read after you connect"}</p>
        <ul className="mt-2 max-h-64 overflow-auto border border-gold/40">
          {miners.map((row) => (
            <li key={`${row.circuits}-${row.circuitId}`} className="grid grid-cols-[6rem_4rem_1fr] gap-2 border-t border-gold/30 px-2 py-2 font-mono text-xs">
              <span>{row.cpu}</span>
              <span>#{row.circuitId}</span>
              <span className="text-right">{bemText(row.pending)} BEM</span>
            </li>
          ))}
          {account && miners.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "TapeOut 快照里没有这个地址的矿机。" : "The TapeOut snapshot has no miner for this address."}</li> : null}
        </ul>
        <button
          type="button"
          disabled={busy || !account || pendingBem === 0n}
          className="mt-3 min-h-12 w-full bg-ink font-display text-2xl italic text-paper disabled:opacity-40"
          onClick={() => {
            if (!account) return;
            setBusy(true);
            claimPod(account, miners.filter((row) => row.pending > 0n).map((row) => row.key))
              .then((hash) => say(zh ? `BEM 已领。${hash}` : `BEM claimed. ${hash}`))
              .catch((error) => say(error instanceof Error && /rejected|denied/i.test(error.message) ? (zh ? "你取消了。" : "You cancelled.") : (zh ? "领取没有完成。BEM 还在合约里。" : "The claim did not finish. The BEM is still in the contract."), true))
              .finally(() => setBusy(false));
          }}
        >
          {zh ? "签名领取 BEM" : "Sign and claim BEM"}
        </button>
        <details className="mt-3 text-xs text-ink/45">
          <summary className="cursor-pointer">{zh ? "合约" : "Contracts"}</summary>
          <p className="mt-2">
            <a className="underline" href="https://tapeout.net/bridge" target="_blank" rel="noreferrer">{zh ? "跨链" : "Bridge"}</a>
            {" · "}
            <a className="underline" href={`${BSC.explorer}/address/0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72`} target="_blank" rel="noreferrer">BSC</a>
            {" · "}
            <a className="underline" href={`${XLAYER.explorer}/address/0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`} target="_blank" rel="noreferrer">X Layer</a>
          </p>
        </details>
      </article>
      ) : null}
      {view === "claim" ? (
      <section className="border border-gold bg-card">
        <div className="flex items-end justify-between gap-3 px-3 py-3">
          <div>
            <h2 className="font-display text-3xl italic leading-none">{zh ? "我的矿机" : "My miners"}</h2>
            <p className="mt-1 text-xs text-ink/45">TAPELIQUID · TAPE</p>
          </div>
          <span className="text-xs text-ink/45">{tape?.scanning ? (zh ? "读取中" : "Reading") : (zh ? "已同步" : "Live")}</span>
        </div>
        <div className="grid grid-cols-2 border-t border-gold/40 sm:grid-cols-3 lg:grid-cols-6">
          <p className="px-3 py-3 lg:border-r lg:border-gold/30"><span className="block text-[11px] text-ink/45">{zh ? "待领取" : "Pending"}</span><span className="font-mono text-base tabular-nums sm:text-lg">{account && tape ? amount(pendingTape) : "—"} <span className="text-sm">TAPE</span></span></p>
          <p className="px-3 py-3 lg:border-r lg:border-gold/30"><span className="block text-[11px] text-ink/45">{zh ? "活跃矿机" : "Live"}</span><span className="font-mono text-base tabular-nums sm:text-lg">{tape ? tape.seats.filter((row) => row.on).length : "—"}</span></p>
          <p className="px-3 py-3 lg:border-r lg:border-gold/30"><span className="block text-[11px] text-ink/45">{zh ? "钱包算力" : "Hash"}</span><span className="font-mono text-base tabular-nums sm:text-lg">{account && tape ? `${myWeight.toLocaleString("en-US")} H` : "—"}</span></p>
          <p className="px-3 py-3 lg:border-r lg:border-gold/30"><span className="block text-[11px] text-ink/45">{zh ? "全网占比" : "Share"}</span><span className="font-mono text-base tabular-nums sm:text-lg">{tape && tape.weight > 0n ? share(myWeight, tape.weight) : "—"}</span></p>
          <p className="px-3 py-3 lg:border-r lg:border-gold/30"><span className="block text-[11px] text-ink/45">{zh ? "预计 24h" : "24h"}</span><span className="font-mono text-base tabular-nums sm:text-lg">{account && tape ? `${amount(myShare)} TAPE` : "—"}</span></p>
          <div className="col-span-2 flex items-center px-3 py-3 sm:col-span-1">
            {!account ? (
              <button type="button" className="min-h-10 w-full bg-ink text-sm text-paper" onClick={() => { setBusy(true); connectXLayer().then(setAccount).catch(() => say(zh ? "钱包没有连上。" : "The wallet did not connect.", true)).finally(() => setBusy(false)); }}>{zh ? "连接钱包" : "Connect"}</button>
            ) : (
              <button
                type="button"
                disabled={busy || pendingTape === 0n}
                className="min-h-10 w-full bg-[#089981] text-sm text-white disabled:opacity-40"
                onClick={() => {
                  const ids = (tape?.seats ?? []).filter((row) => row.on && row.pending > 0n && (Object.values(picked).some(Boolean) ? picked[row.id] : true));
                  setBusy(true);
                  claimTape(account, ids.map((row) => BigInt(row.id)))
                    .then((hash) => {
                      setClaims((prev) => [{ tx: hash, amount: ids.reduce((sum, row) => sum + row.pending, 0n), ts: Math.floor(Date.now() / 1000) }, ...prev]);
                      say(zh ? "TAPE 已领到这个钱包。" : "TAPE is in this wallet.");
                      readTapeMine(account).then((row) => setTape(row)).catch(() => undefined);
                    })
                    .catch((error) => {
                      const message = error instanceof Error ? error.message : "";
                      say(/rejected|denied|4001/i.test(message) ? (zh ? "你取消了。" : "You cancelled.") : message === "chain" ? (zh ? "先把钱包切到 X Layer。" : "Switch the wallet to X Layer.") : (zh ? "领取没有完成。" : "The claim did not finish."), true);
                    })
                    .finally(() => setBusy(false));
                }}
              >
                {Object.values(picked).some(Boolean) ? (zh ? "领取所选" : "Claim selected") : (zh ? "全部领取" : "Claim all")}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-gold/40 px-2">
          <div className="flex">
            <button type="button" onClick={() => setClaimTab("all")} className={`min-h-10 px-3 text-sm ${claimTab === "all" ? "border-b-2 border-ink" : "text-ink/50"}`}>{zh ? "全部" : "All"}</button>
            <button type="button" onClick={() => setClaimTab("log")} className={`min-h-10 px-3 text-sm ${claimTab === "log" ? "border-b-2 border-ink" : "text-ink/50"}`}>{zh ? "领取记录" : "Claims"}</button>
          </div>
          <span className="px-2 text-[11px] text-ink/40">{claims[0]?.ts ? (zh ? `上次领取 ${when(BigInt(claims[0].ts))}` : when(BigInt(claims[0].ts))) : (zh ? "上次领取 暂无" : "No claim yet")}</span>
        </div>
        {claimTab === "log" ? (
          <ul className="min-h-48">
            {claims.length === 0 ? <li className="px-3 py-16 text-center text-sm text-ink/45">{claimsReady ? (zh ? "还没有领取记录。" : "No claims yet.") : (zh ? "读取中" : "Reading")}</li> : null}
            {claims.map((row) => (
              <li key={row.tx} className="flex items-center gap-2 border-t border-gold/30 px-3 py-2 font-mono text-xs">
                <span className="w-28 shrink-0 text-ink/55 sm:w-36">{row.ts ? when(BigInt(row.ts)) : "—"}</span>
                <span className="min-w-0 flex-1 truncate">{amount(row.amount)} TAPE</span>
                <a className="shrink-0 underline" href={`${XLAYER.explorer}/tx/${row.tx}`} target="_blank" rel="noreferrer">{zh ? "链上" : "Tx"}</a>
              </li>
            ))}
          </ul>
        ) : (
        <ul>
          <li className="hidden grid-cols-[2rem_5rem_minmax(0,1.2fr)_5rem_5.5rem_5.5rem_6.5rem_6.5rem] items-center px-3 py-2 text-[11px] text-ink/45 lg:grid">
            <span />
            <span>{zh ? "矿机" : "Miner"}</span>
            <span>{zh ? "任务 / 池" : "Task"}</span>
            <span>{zh ? "状态" : "State"}</span>
            <span className="text-right">{zh ? "算力" : "Hash"}</span>
            <span className="text-right">{zh ? "池内占比" : "Pool"}</span>
            <span className="text-right">{zh ? "待领取" : "Pending"}</span>
            <span className="text-right">{zh ? "预计 24h" : "24h"}</span>
          </li>
          {(tape?.seats ?? []).map((row) => (
            <li key={row.id} className="border-t border-gold/30">
              <div className="px-3 py-3 lg:hidden">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex min-w-0 items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(picked[row.id])} onChange={() => setPicked((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} aria-label={`#${row.id}`} />
                    <span className="font-mono">#{row.id}</span>
                    {row.on ? <span className="text-[#089981]">{zh ? "已开工" : "Live"}</span> : <span className="text-ink/45">{zh ? "未开工" : "Idle"}</span>}
                  </label>
                  <span className="font-mono text-sm">{amount(row.pending)} TAPE</span>
                </div>
                <p className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink/50">
                  <span>{Number(row.gates).toLocaleString("en-US")} H · {tape && tape.weight > 0n && row.on ? share(BigInt(row.gates), tape.weight) : "—"} · {zh ? "预计" : "24h"} {row.on ? row.share : "—"}</span>
                  {row.on ? null : (
                    <button type="button" disabled={opening === row.id} className="min-h-8 shrink-0 bg-ink px-2 text-paper disabled:opacity-40" onClick={() => {
                      if (!account) return;
                      setOpening(row.id);
                      openTape(account, BigInt(row.id))
                        .then(() => {
                          setTape((prev) => prev ? { ...prev, open: prev.open + (row.on ? 0 : 1), seats: prev.seats.map((seat) => seat.id === row.id ? { ...seat, on: true } : seat) } : prev);
                          say(zh ? `#${row.id} 已开工。` : `#${row.id} is open.`);
                          readTapeMine(account).then(setTape).catch(() => undefined);
                        })
                        .catch(() => say(zh ? "开工没有完成。" : "The open did not finish.", true))
                        .finally(() => setOpening(null));
                    }}>{opening === row.id ? "…" : (zh ? "开工" : "Open")}</button>
                  )}
                </p>
              </div>
              <div className="hidden grid-cols-[2rem_5rem_minmax(0,1.2fr)_5rem_5.5rem_5.5rem_6.5rem_6.5rem] items-center px-3 py-2 text-xs lg:grid">
              <input type="checkbox" checked={Boolean(picked[row.id])} onChange={() => setPicked((prev) => ({ ...prev, [row.id]: !prev[row.id] }))} aria-label={`#${row.id}`} />
              <span className="font-mono">#{row.id}</span>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate text-ink/70">{tasks[row.id] && tasks[row.id] !== "none" ? tasks[row.id] : "TAPELIQUID"}</span>
                <button type="button" disabled={busy} className="shrink-0 text-[11px] text-ink/45 underline disabled:opacity-40" onClick={() => {
                        setBusy(true);
                        matchCircuitTask(row.id)
                          .then((hit) => {
                            const name = hit ? hit.name : "none";
                            rememberTask(row.id, name);
                            setTasks((prev) => ({ ...prev, [row.id]: name }));
                            say(hit ? `#${row.id} ${hit.name}` : (zh ? `#${row.id} 没对上` : `#${row.id} no match`), !hit);
                          })
                          .catch(() => say(zh ? "题目没对完。" : "The task check did not finish.", true))
                          .finally(() => setBusy(false));
                      }}
                    >
                      {zh ? "核对" : "Match"}
                    </button>
              </span>
              {row.on ? <span className="text-[#089981]">{zh ? "已开工" : "Live"}</span> : (
                <button
                  type="button"
                  disabled={opening === row.id}
                  className="text-left text-ink/55 disabled:opacity-40"
                  onClick={() => {
                    if (!account) return;
                    setOpening(row.id);
                    openTape(account, BigInt(row.id))
                      .then(() => {
                        setTape((prev) => prev ? { ...prev, open: prev.open + (row.on ? 0 : 1), seats: prev.seats.map((seat) => seat.id === row.id ? { ...seat, on: true } : seat) } : prev);
                        say(zh ? `#${row.id} 已开工。权重按门数。` : `#${row.id} is open. Weight is the gate count.`);
                        readTapeMine(account).then(setTape).catch(() => undefined);
                      })
                      .catch((err) => {
                        const message = err instanceof Error ? err.message : "";
                        if (message === "listed") say(zh ? "这张已经挂在电路盘上，持有人是订单簿，不是这个钱包。先到电路页撤下，电路回到钱包再开工。" : "This one is listed. The book holds it, not this wallet. Cancel the listing, then open it.", true);
                        else if (message === "locked") say(zh ? "这张在锁仓合约里，不能从钱包开工。" : "This one is in the lock. It cannot be opened from the wallet.", true);
                        else if (message === "owner") say(zh ? "链上这张不在当前签名的钱包里。" : "The signing wallet does not hold this circuit.", true);
                        else if (message === "account") say(zh ? "签名的钱包和页面地址不是同一个。" : "The signing wallet is not the address on this page.", true);
                        else if (message === "open") say(zh ? "这张已经开工了。" : "This one is already open.");
                        else if (message === "chain") say(zh ? "钱包还不是 X Layer。在钱包里把网络改成 X Layer，再点开工。" : "The wallet is not on X Layer. Switch it there, then open again.", true);
                        else if (message === "nowallet") say(zh ? "没有检测到钱包。" : "No wallet.", true);
                        else if (message === "rejected") say(zh ? "你取消了签名。" : "You cancelled the signature.", true);
                        else if (message === "gas") say(zh ? "钱包里的 OKB 不够付这笔矿工费。" : "Not enough OKB for the fee.", true);
                        else if (message === "revert") say(zh ? "链上拒绝了这笔开工。电路还在，没有变成矿机。" : "The chain rejected this open. The circuit is unchanged.", true);
                        else say(zh ? "这笔开工没在 X Layer 上确认。网络选 X Layer 后再点一次。" : "The open was not confirmed on X Layer. Choose X Layer and tap again.", true);
                      })
                      .finally(() => setOpening(null));
                  }}
                >
                  {opening === row.id ? "…" : (zh ? "开工" : "Open")}
                </button>
              )}
              <span className="text-right font-mono">{Number(row.gates).toLocaleString("en-US")}</span>
              <span className="text-right font-mono">{tape && tape.weight > 0n && row.on ? share(BigInt(row.gates), tape.weight) : "—"}</span>
              <span className="text-right font-mono">{amount(row.pending)}</span>
              <span className="text-right font-mono">{row.on ? row.share : "—"}</span>
              </div>
            </li>
          ))}
          {account && tape?.scanOk && tape.seats.length === 0 ? <li className="px-3 py-16 text-center text-sm text-ink/45">{zh ? "这个筛选下没有矿机。" : "No miners in this view."}</li> : null}
          {!account ? <li className="px-3 py-16 text-center text-sm text-ink/45">{zh ? "先连接钱包。" : "Connect a wallet."}</li> : null}
          {account && tape && !tape.scanOk && tape.seats.length === 0 ? <li className="px-3 py-16 text-center text-sm text-ink/45">{zh ? "正在读矿机。" : "Reading miners."}</li> : null}
        </ul>
        )}
        <div className="flex items-center justify-between border-t border-gold/40 px-3 py-2 text-xs text-ink/50">
          <span>{zh ? `已选 ${Object.values(picked).filter(Boolean).length} 台` : `${Object.values(picked).filter(Boolean).length} selected`} <button type="button" className="ml-2 underline" onClick={() => setPicked({})}>{zh ? "清空选择" : "Clear"}</button></span>
          <span>{zh ? `可领取矿机 ${(tape?.seats ?? []).filter((row) => row.on && row.pending > 0n).length} 台` : `${(tape?.seats ?? []).filter((row) => row.on && row.pending > 0n).length} ready`}</span>
        </div>
        {note ? <p className={`px-3 pb-3 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </section>
      ) : null}
    </section>
      )}
    </section>
  );
}

function Book({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3">
      <h3 className="text-xs tracking-widest text-gold">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-gold/30 py-1.5 text-xs">
      <dt className="text-ink/60">{k}</dt>
      <dd className="text-right font-mono">{v}</dd>
    </div>
  );
}

function amount(value: bigint): string {
  const n = Number(tapeText(value));
  if (!Number.isFinite(n)) return tapeText(value);
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 4 });
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-gold/40 px-2 py-2">
      <dt className="text-xs text-ink/50">{k}</dt>
      <dd className="mt-1 font-mono text-sm">{v}</dd>
    </div>
  );
}
