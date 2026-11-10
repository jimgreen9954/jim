import { useEffect, useState, type ReactNode } from "react";
import { BSC } from "@/lib/bsc";
import { useExchange } from "@/lib/exchange-store";
import {
  bemText,
  claimPod,
  getPodMiners,
  POD,
  readPodPending,
  readPodStats,
  type PodStats,
} from "@/lib/pod";
import {
  claimTape,
  readTapeMine,
  TAPE,
  TAPE_BOOK,
  TAPE_MINE,
  tapeEra,
  tapeText,
  type TapeBoard,
} from "@/lib/tape-mine";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";
import { StakeDesk } from "@/components/exchange/stake-desk";
import { BurnDesk } from "@/components/exchange/burn-desk";
import { TapeDesk } from "@/components/exchange/tape-desk";
import { CopyVault } from "@/components/exchange/copy-vault";
import { LendDesk } from "@/components/exchange/lend-desk";
import { SideRail } from "@/components/exchange/side-rail";
import { HashClaim } from "@/components/exchange/share-spot";
import { claimSplitMany, listSplitPieces, readShareSeats, type ShareSeat } from "@/lib/circuit-split";

export function MineDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [stats, setStats] = useState<PodStats | null>(null);
  const [miners, setMiners] = useState<
    {
      cpu: string;
      circuits: string;
      circuitId: number;
      taskId: number;
      pending: bigint;
      key: `0x${string}`;
    }[]
  >([]);
  const [snap, setSnap] = useState("");
  const [tape, setTape] = useState<TapeBoard | null>(null);
  const [tapeErr, setTapeErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"claim" | "stake" | "ash" | "bid" | "copy" | "lend">("claim");
  const [networkOpen, setNetworkOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [shares, setShares] = useState<ShareSeat[]>([]);
  const [shareTick, setShareTick] = useState(0);

  useEffect(() => onAccount((next) => setAccount(next)), []);
  useEffect(() => {
    const apply = () => {
      const named = window.location.hash.replace(/^#/, "");
      if (named === "stake") setSheet("stake");
      if (named === "vault") setSheet("copy");
      if (named === "lend") setSheet("lend");
      if (named === "bid") setSheet("bid");
      if (named === "ash") setSheet("ash");
      if (named === "mine" || named === "earn" || named === "net") setSheet("claim");
      setNetworkOpen(named === "net");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (document.hidden) return;
      readPodStats()
        .then((row) => {
          if (!dead) setStats(row);
        })
        .catch(() => undefined);
      if (sheet !== "claim") return;
      readTapeMine(account, (head) => {
        if (dead) return;
        setTapeErr(null);
        setTape((prev) =>
          prev && prev.seats.length > 0
            ? { ...head, seats: prev.seats, open: prev.open, scanning: true, scanOk: prev.scanOk }
            : head,
        );
      })
        .then((row) => {
          if (dead) return;
          setTapeErr(null);
          setTape((prev) =>
            row.scanOk || !prev?.seats.length ? row : { ...prev, scanning: false },
          );
        })
        .catch(() => {
          if (!dead)
            setTapeErr(
              zh
                ? "链上没读到。失败不会写成 0。"
                : "The chain did not answer. A miss is not written as zero.",
            );
        });
    };
    pull();
    const id = window.setInterval(pull, sheet === "claim" ? 90_000 : 180_000);
    const onShow = () => {
      if (!document.hidden) pull();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      dead = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onShow);
    };
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
        setMiners(
          snapRow.miners
            .slice(0, 24)
            .map((row, i) => ({
              ...row,
              pending: live[i]?.pending ?? 0n,
              key: live[i]?.key ?? "0x",
            })),
        );
      })
      .catch(() => {
        if (!dead) setMiners([]);
      });
    return () => {
      dead = true;
    };
  }, [account]);

  useEffect(() => {
    if (!account || sheet !== "claim") {
      if (!account) setShares([]);
      return;
    }
    let dead = false;
    listSplitPieces()
      .then((pieces) => readShareSeats(account, pieces))
      .then((rows) => {
        if (!dead) setShares(rows);
      })
      .catch(() => {
        if (!dead) setShares([]);
      });
    return () => {
      dead = true;
    };
  }, [account, sheet, shareTick]);

  const pendingBem = miners.reduce((sum, row) => sum + row.pending, 0n);
  const pendingTape = tape?.seats.reduce((sum, row) => sum + (row.on ? row.pending : 0n), 0n) ?? 0n;
  const liveSeats = (tape?.seats ?? []).filter((row) => row.on && row.pending > 0n);
  const shareRows = shares.filter((seat) => !liveSeats.some((row) => row.id === seat.id));
  const chosen = liveSeats.filter((row) => picked[row.id] !== false);
  const myWeight =
    tape?.seats.reduce((sum, row) => sum + (row.on ? BigInt(row.gates) : 0n), 0n) ?? 0n;
  const shareWeight = shareRows.reduce((sum, row) => sum + row.shares, 0n);
  const myHash = myWeight + shareWeight;
  const myShare = tape && tape.weight > 0n ? (tape.daily * myHash) / tape.weight : 0n;
  const jump = (hash: string, next: "claim" | "stake" | "ash" | "bid" | "copy" | "lend") => {
    setSheet(next);
    const url = `#${hash}`;
    if (window.location.hash !== url) window.history.replaceState(null, "", url);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const say = (text: string, failed = false) => {
    setBad(failed);
    setNote(text);
  };

  const termParked = tape
    ? tape.termHeld > 0n
      ? tape.termHeld
      : tape.termPrincipal + tape.termReward
    : 0n;
  const termClaimable =
    tape && termParked > tape.termPrincipal + tape.termReward
      ? termParked - tape.termPrincipal - tape.termReward
      : 0n;
  const parked = tape
    ? tape.burned + tape.pooled + tape.circuitHeld + tape.waferHeld + tape.spotHeld + tape.buybackHeld + tape.lendHeld + termParked
    : 0n;
  const circulating = tape ? (tape.supply > parked ? tape.supply - parked : 0n) : 0n;
  const unmined =
    tape && tape.scanOk
      ? tape.cap > tape.supply + tape.pendingNet
        ? tape.cap - tape.supply - tape.pendingNet
        : 0n
      : 0n;
  const freePending =
    tape && tape.scanOk && tape.pendingNet > tape.pendingStaked
      ? tape.pendingNet - tape.pendingStaked
      : 0n;
  const freeWeight =
    tape && tape.scanOk && tape.weight > tape.stakedWeight ? tape.weight - tape.stakedWeight : 0n;
  const idle = tape && tape.scanOk ? Math.max(0, tape.circuits - tape.open) : 0;
  const stakedIdle = tape && tape.scanOk ? Math.max(0, tape.staked - tape.stakedLive) : 0;
  const todayStaked =
    tape && tape.scanOk && tape.weight > 0n ? (tape.daily * tape.stakedWeight) / tape.weight : 0n;
  const todayFree = tape && tape.scanOk ? tape.daily - todayStaked : 0n;
  const era = tape ? tapeEra(tape.start) : null;
  const share = (part: bigint, whole: bigint) =>
    whole > 0n ? `${(Number((part * 10000n) / whole) / 100).toFixed(2)}%` : "—";
  const weightShare = (part: bigint, whole: bigint) => {
    if (whole <= 0n) return "—";
    if (part <= 0n) return "0%";
    const fine = (part * 1_000_000n) / whole;
    if (fine === 0n) return "<0.0001%";
    if (fine >= 10_000n) return `${(Number((part * 10000n) / whole) / 100).toFixed(2)}%`;
    return `${(Number(fine) / 10_000).toFixed(4)}%`;
  };
  const when = (sec: bigint) =>
    new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(Number(sec) * 1000));

  return (
    <section className="flex flex-col gap-3">
      <article className="border border-gold bg-card">
        <button
          type="button"
          onClick={() => setNetworkOpen((open) => !open)}
          className="grid w-full grid-cols-3 text-left"
        >
          <span className="px-4 py-3">
            <span className="block text-[10px] tracking-[0.16em] text-ink/40">{zh ? "今日排放" : "Today"}</span>
            <span className="mt-1 block font-mono text-lg tabular-nums">{tape ? amount(tape.daily) : "—"}</span>
          </span>
          <span className="border-l border-gold/30 px-4 py-3">
            <span className="block text-[10px] tracking-[0.16em] text-ink/40">{zh ? "实时流通" : "Circulating"}</span>
            <span className="mt-1 block font-mono text-lg tabular-nums">{tape ? amount(circulating) : "—"}</span>
          </span>
          <span className="flex items-center justify-between border-l border-gold/30 px-4 py-3">
            <span>
              <span className="block text-[10px] tracking-[0.16em] text-ink/40">{zh ? "全网" : "Network"}</span>
              <span className="mt-1 block text-sm">{networkOpen ? (zh ? "收起明细" : "Hide") : zh ? "看明细" : "Details"}</span>
            </span>
          </span>
        </button>
        {networkOpen && tape ? (
          <div className="border-t border-gold/40 px-3 py-2">
            <Book title={zh ? "流通是这样减出来的" : "How circulation is subtracted"}>
              <Line
                k={zh ? "已领出" : "Claimed"}
                v={`${amount(tape.supply)} · ${share(tape.supply, tape.cap)} ${zh ? "硬顶" : "of cap"}`}
              />
              <Line
                k={zh ? "减 黑洞销毁" : "Minus burned"}
                v={`${amount(tape.burned)} · ${share(tape.burned, tape.supply)} ${zh ? "已领出" : "of claimed"}`}
              />
              <Line k={zh ? "减 TAPE 池" : "Minus the pool"} v={amount(tape.pooled)} />
              <Line k={zh ? "减 现货账本" : "Minus spot books"} v={amount(tape.spotHeld)} />
              <Line k={zh ? "减 回购还没销毁" : "Minus buyback, not burned"} v={amount(tape.buybackHeld)} />
              <Line k={zh ? "减 借贷抵押" : "Minus lend collateral"} v={amount(tape.lendHeld)} />
              <Line
                k={zh ? "减 电路锁仓里已领未提出" : "Minus circuit lock"}
                v={amount(tape.circuitHeld)}
              />
              <Line
                k={zh ? "减 晶圆锁仓里的 TAPE" : "Minus wafer lock"}
                v={amount(tape.waferHeld)}
              />
              <Line
                k={zh ? "减 期限本金" : "Minus stake principal"}
                v={`${amount(tape.termPrincipal)} · ${zh ? "正在锁的，和到期还没取回的" : "Still locked, and matured but not taken"}`}
              />
              <Line
                k={zh ? "减 还没分完的奖励" : "Minus rewards not yet vested"}
                v={amount(tape.termReward)}
              />
              <Line
                k={zh ? "减 已经可以领、还没领走" : "Minus vested, not claimed"}
                v={amount(termClaimable)}
              />
              <Line
                k={zh ? "等于 实时流通" : "Equals circulating"}
                v={`${amount(circulating)} · ${share(circulating, tape.supply)} ${zh ? "已领出" : "of claimed"} · ${share(circulating, tape.cap)} ${zh ? "硬顶" : "of cap"}`}
              />
            </Book>
            <Book title={zh ? "还没进流通" : "Not circulating yet"}>
              <Line
                k={zh ? "已挖未领" : "Mined, not claimed"}
                v={
                  tape.scanOk
                    ? `${amount(tape.pendingNet)} · ${share(tape.pendingNet, tape.supply + tape.pendingNet)} ${zh ? "已挖" : "of mined"}`
                    : "—"
                }
              />
              <Line
                k={zh ? "其中普通矿机未领" : "Of that, open wallets"}
                v={tape.scanOk ? amount(freePending) : "—"}
              />
              <Line
                k={zh ? "其中质押矿机未领" : "Of that, staked miners"}
                v={tape.scanOk ? amount(tape.pendingStaked) : "—"}
              />
              <Line
                k={zh ? "还没挖出" : "Not yet mined"}
                v={
                  tape.scanOk
                    ? `${amount(unmined)} · ${share(unmined, tape.cap)} ${zh ? "硬顶" : "of cap"}`
                    : "—"
                }
              />
              <Line k={zh ? "硬顶" : "Cap"} v={amount(tape.cap)} />
              <Line k={zh ? "今日排放" : "Today"} v={amount(tape.daily)} />
            </Book>
            <Book title={zh ? "矿机和算力" : "Miners and weight"}>
              <Line
                k={zh ? "已流片" : "Taped"}
                v={`${tape.circuits.toLocaleString("en-US")} ${zh ? "片" : "sheets"}`}
              />
              <Line
                k={zh ? "正在挖" : "Mining"}
                v={
                  tape.scanOk
                    ? `${tape.open.toLocaleString("en-US")} · ${share(BigInt(tape.open), BigInt(tape.circuits))}`
                    : "—"
                }
              />
              <Line
                k={zh ? "没在挖" : "Not mining"}
                v={tape.scanOk ? idle.toLocaleString("en-US") : "—"}
              />
              <Line
                k={zh ? "质押电路" : "Staked circuits"}
                v={tape.scanOk || tape.staked > 0 ? `${tape.staked.toLocaleString("en-US")} ${zh ? "片" : "sheets"}` : "—"}
              />
              <Line
                k={zh ? "质押且正在挖" : "Staked and mining"}
                v={tape.scanOk ? tape.stakedLive.toLocaleString("en-US") : "—"}
              />
              <Line
                k={zh ? "质押但没在挖" : "Staked, not mining"}
                v={tape.scanOk ? stakedIdle.toLocaleString("en-US") : "—"}
              />
              <Line
                k={zh ? "全网算力" : "Network weight"}
                v={tape.scanOk ? tape.weight.toLocaleString("en-US") : "—"}
              />
              <Line
                k={zh ? "这地址占全网" : "This address"}
                v={
                  account && tape.scanOk
                    ? `${myHash.toLocaleString("en-US")} · ${weightShare(myHash, tape.weight)}`
                    : "—"
                }
              />
              <Line
                k={zh ? "质押算力" : "Staked weight"}
                v={
                  tape.scanOk
                    ? `${tape.stakedWeight.toLocaleString("en-US")} · ${share(tape.stakedWeight, tape.weight)}`
                    : "—"
                }
              />
              <Line
                k={zh ? "普通算力" : "Wallet weight"}
                v={
                  tape.scanOk
                    ? `${freeWeight.toLocaleString("en-US")} · ${share(freeWeight, tape.weight)}`
                    : "—"
                }
              />
              <Line
                k={zh ? "质押约占今日" : "Stake about today"}
                v={tape.scanOk ? amount(todayStaked) : "—"}
              />
              <Line
                k={zh ? "普通约占今日" : "Wallets about today"}
                v={tape.scanOk ? amount(todayFree) : "—"}
              />
            </Book>
            <Book title={zh ? "减半" : "Halving"}>
              <Line k={zh ? "开始" : "Started"} v={when(tape.start)} />
              <Line
                k={zh ? "下一次减半" : "Next halving"}
                v={era ? `${when(era.next)} · ${zh ? "新加坡" : "Singapore"}` : "—"}
              />
              <Line k={zh ? "现在是第几期" : "Era"} v={era ? (era.era + 1n).toString() : "—"} />
            </Book>
            <p className="mt-2 text-xs leading-5 text-ink/55">
              {zh
                ? "期限合约里的 TAPE 整笔都不在流通。本金一行同时包括还在锁的，和到期还没取回的，合约没有把这两笔分开记。奖励再拆成还没分完的，和已经可以领、还没领走的。已挖未领还没铸出。时间是新加坡时间。"
                : "Unclaimed mined TAPE is not minted, so it is not circulating. Staked principal and matured TAPE rewards still in the term contract are not circulating either. An unfinished miner total is not shown as zero. Times are Singapore."}
            </p>
            <p className="mt-1 break-all text-xs text-ink/40">
              <a
                className="underline"
                href={`${XLAYER.explorer}/address/${TAPE}`}
                target="_blank"
                rel="noreferrer"
              >
                TAPE
              </a>
              {" · "}
              <a
                className="underline"
                href={`${XLAYER.explorer}/address/${TAPE_BOOK.ash}`}
                target="_blank"
                rel="noreferrer"
              >
                {zh ? "黑洞" : "Burn"}
              </a>
              {" · "}
              <a
                className="underline"
                href={`${XLAYER.explorer}/address/${TAPE_BOOK.pool}`}
                target="_blank"
                rel="noreferrer"
              >
                {zh ? "池" : "Pool"}
              </a>
              {" · "}
              <a
                className="underline"
                href={`${XLAYER.explorer}/address/${TAPE_BOOK.circuit}`}
                target="_blank"
                rel="noreferrer"
              >
                {zh ? "电路锁仓" : "Circuit lock"}
              </a>
              {" · "}
              <a
                className="underline"
                href={`${XLAYER.explorer}/address/${TAPE_BOOK.wafer}`}
                target="_blank"
                rel="noreferrer"
              >
                {zh ? "晶圆锁仓" : "Wafer lock"}
              </a>
            </p>
          </div>
        ) : networkOpen ? (
          <p className="border-t border-gold/40 px-3 py-3 text-xs text-ink/55">
            {zh
              ? "链上还没读到。失败不会写成 0。"
              : "The chain has not answered. A miss is not written as zero."}
          </p>
        ) : null}
      </article>
      <SideRail
        items={[
          {
            key: "claim",
            label: zh ? "领取" : "Claim",
            on: sheet === "claim",
            run: () => jump("earn", "claim"),
          },
          {
            key: "stake",
            label: zh ? "质押" : "Stake",
            on: sheet === "stake",
            run: () => jump("stake", "stake"),
          },
          {
            key: "ash",
            label: zh ? "销毁" : "Burn",
            on: sheet === "ash",
            run: () => jump("ash", "ash"),
          },
          {
            key: "copy",
            label: zh ? "跟单" : "Vault",
            on: sheet === "copy",
            run: () => jump("vault", "copy"),
          },
          {
            key: "lend",
            label: zh ? "借贷" : "Lend",
            on: sheet === "lend",
            run: () => jump("lend", "lend"),
          },
        ]}
      >
        {sheet === "lend" ? (
          <LendDesk zh={zh} account={account} />
        ) : sheet === "copy" ? (
          <CopyVault zh={zh} account={account} />
        ) : sheet === "stake" ? (
          <StakeDesk />
        ) : sheet === "ash" ? (
          <BurnDesk />
        ) : sheet === "bid" ? (
          <TapeDesk account={account} zh={zh} />
        ) : (
          <section className="grid items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
            <article className="order-3 flex min-w-0 flex-col earn-bem">
              <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div>
                  <p className="text-[11px] tracking-[0.16em] text-ink/40">BSC</p>
                  <h2 className="mt-1 text-lg font-medium">{zh ? "TapeOut BEM" : "TapeOut BEM"}</h2>
                  <span className="earn-kicker earn-kicker-bem mt-2">BEM</span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-wide text-ink/40">{zh ? "可领" : "Pending"}</p>
                  <p className="font-mono text-2xl leading-none tabular-nums text-up">{account ? bemText(pendingBem) : "—"}</p>
                  <p className="mt-1 text-[11px] text-ink/40">BEM</p>
                </div>
              </div>
              <p className="px-4 pt-2 text-xs leading-5 text-ink/50">
                {zh ? "已经在挖的电路，BEM 在这里领取。" : "BEM from circuits already mining is claimed here."}
              </p>
              <dl className="mt-3 grid grid-cols-3 border-y border-gold/25">
                <Cell
                  k={zh ? "今天排放" : "Daily emission"}
                  v={
                    stats
                      ? `${Number(stats.daily).toLocaleString("en-US", { maximumFractionDigits: 2 })} BEM`
                      : "—"
                  }
                />
                <Cell
                  k={zh ? "已铸" : "Minted"}
                  v={
                    stats
                      ? `${Number(stats.mined).toLocaleString("en-US", { maximumFractionDigits: 2 })} BEM`
                      : "—"
                  }
                />
                <Cell
                  k={zh ? "作废" : "Forgone"}
                  v={
                    stats
                      ? `${Number(stats.forgone).toLocaleString("en-US", { maximumFractionDigits: 4 })} BEM`
                      : "—"
                  }
                />
                <Cell
                  k={zh ? "矿机" : "Miners"}
                  v={stats ? `${stats.verified} / ${stats.miners}` : "—"}
                />
                <Cell k={zh ? "已验证权重" : "Verified weight"} v={stats?.verifWeight ?? "—"} />
                <Cell k={zh ? "未验证权重" : "Unverified weight"} v={stats?.unverWeight ?? "—"} />
              </dl>
              <p className="px-4 pt-3 text-xs text-ink/45">
                {snap ? (zh ? `名单 ${snap}` : `List ${snap}`) : zh ? "连上钱包后读名单" : "The list is read after you connect"}
              </p>
              <ul className="mx-4 mt-2 max-h-64 overflow-auto border border-gold/30">
                {miners.map((row) => (
                  <li
                    key={`${row.circuits}-${row.circuitId}`}
                    className="grid grid-cols-[6rem_4rem_1fr] gap-2 border-t border-gold/30 px-2 py-2 font-mono text-xs"
                  >
                    <span>{row.cpu}</span>
                    <span>#{row.circuitId}</span>
                    <span className="text-right">{bemText(row.pending)} BEM</span>
                  </li>
                ))}
                {account && miners.length === 0 ? (
                  <li className="px-2 py-3 text-sm text-ink/60">
                    {zh
                      ? "TapeOut 快照里没有这个地址的矿机。"
                      : "The TapeOut snapshot has no miner for this address."}
                  </li>
                ) : null}
              </ul>
              <div className="mt-auto p-4">
              <button
                type="button"
                disabled={busy || !account || pendingBem === 0n}
                className="min-h-11 w-full text-sm earn-btn-bem disabled:opacity-40"
                onClick={() => {
                  if (!account) return;
                  setBusy(true);
                  claimPod(
                    account,
                    miners.filter((row) => row.pending > 0n).map((row) => row.key),
                  )
                    .then((hash) => say(zh ? `BEM 已领。${hash}` : `BEM claimed. ${hash}`))
                    .catch((error) =>
                      say(
                        error instanceof Error && /rejected|denied/i.test(error.message)
                          ? zh
                            ? "你取消了。"
                            : "You cancelled."
                          : zh
                            ? "领取没有完成。BEM 还在合约里。"
                            : "The claim did not finish. The BEM is still in the contract.",
                        true,
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {zh ? "领取 BEM" : "Claim BEM"}
              </button>
              </div>
              {account && pendingBem === 0n ? (
                <p className="px-4 pb-2 text-xs leading-5 text-ink/45">
                  {zh ? "没有待领。" : "Nothing is pending."}
                </p>
              ) : null}
              <p className="px-4 pb-4 text-[11px] leading-5 text-ink/40">
                <a className="underline" href="https://tapeout.net/bridge" target="_blank" rel="noreferrer">
                  {zh ? "跨链" : "Bridge"}
                </a>
                {" · "}
                <a className="underline" href={`${BSC.explorer}/address/0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72`} target="_blank" rel="noreferrer">
                  BSC
                </a>
                {" · "}
                <a className="underline" href={`${XLAYER.explorer}/address/0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`} target="_blank" rel="noreferrer">
                  X Layer
                </a>
              </p>
            </article>
            <article className="order-2 flex min-w-0 flex-col earn-tape md:order-1">
              <div className="flex items-start justify-between gap-3 px-4 pt-4">
                <div>
                  <p className="text-[11px] tracking-[0.16em] text-ink/40">X LAYER</p>
                  <h2 className="mt-1 text-lg font-medium">{zh ? "电路 TAPE" : "Circuit TAPE"}</h2>
                  <span className="earn-kicker earn-kicker-tape mt-2">TAPE</span>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-wide text-ink/40">{zh ? "可领" : "Pending"}</p>
                  <p className="font-mono text-2xl leading-none tabular-nums text-up">
                    {account && tape ? amount(pendingTape) : "—"}
                  </p>
                  <p className="mt-1 text-[11px] text-ink/40">TAPE</p>
                </div>
              </div>
              <p className="px-4 pt-2 text-xs leading-5 text-ink/50">
                {zh ? "整张电路和拆开的算力在这一张名单。勾选整张，一次签名。算力按笔签。" : "Whole circuits and split hashrate are on this list. Select whole circuits and sign once. Shares sign per circuit."}
              </p>
              <dl className="mt-3 grid grid-cols-3 border-y border-gold/25">
                <Cell
                  k={zh ? "今天排放" : "Daily emission"}
                  v={tape ? `${amount(tape.daily)} TAPE` : "—"}
                />
                <Cell
                  k={zh ? "已领出" : "Claimed"}
                  v={tape ? `${amount(tape.supply)} TAPE` : "—"}
                />
                <Cell
                  k={zh ? "全网权重" : "Network weight"}
                  v={tape ? tape.weight.toLocaleString("en-US") : "—"}
                />
                <Cell
                  k={zh ? "已开工 / 电路" : "Open / circuits"}
                  v={
                    tape
                      ? `${tape.open.toLocaleString("en-US")} / ${tape.circuits.toLocaleString("en-US")}`
                      : "—"
                  }
                />
                <Cell
                  k={zh ? "算力占全网" : "Share of network"}
                  v={
                    account && tape && tape.weight > 0n
                      ? `${myHash.toLocaleString("en-US")} · ${weightShare(myHash, tape.weight)}`
                      : "—"
                  }
                />
                <Cell
                  k={zh ? "这地址约占今日" : "About today"}
                  v={account && tape ? `${amount(myShare)} TAPE` : "—"}
                />
              </dl>
              <div className="flex items-center justify-between px-4 pt-3 text-xs text-ink/45">
                <span>
                  {account && tape
                    ? zh
                      ? `${liveSeats.length + shareRows.length} 笔可领 · 已选 ${chosen.length}`
                      : `${liveSeats.length + shareRows.length} paying · ${chosen.length} selected`
                    : zh
                      ? "连上后显示矿机"
                      : "Connect to see miners"}
                </span>
                {liveSeats.length > 0 ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      const allOn = liveSeats.every((row) => picked[row.id] !== false);
                      setPicked(Object.fromEntries(liveSeats.map((row) => [row.id, !allOn])));
                    }}
                  >
                    {liveSeats.every((row) => picked[row.id] !== false) ? (zh ? "取消全选" : "Clear") : zh ? "全选" : "All"}
                  </button>
                ) : null}
              </div>
              <ul className="mx-4 mt-2 max-h-72 overflow-auto border border-gold/30">
                {liveSeats.map((row) => {
                  const on = picked[row.id] !== false;
                  return (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 border-t border-gold/30 px-2 py-2"
                    >
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => setPicked((prev) => ({ ...prev, [row.id]: !on }))}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-sm">
                            #{row.id} · {Number(row.gates).toLocaleString("en-US")} H
                          </span>
                          <span className="text-[11px] text-up">
                            {zh ? "已开工 · 有收入" : "Mining · paying"}
                          </span>
                        </span>
                      </label>
                      <div className="text-right">
                        <p className="font-mono text-xs">{amount(row.pending)} TAPE</p>
                        <button
                          type="button"
                          disabled={busy}
                          className="min-h-8 px-1 text-xs text-ink/55 underline disabled:opacity-40"
                          onClick={() => {
                            if (!account) return;
                            setBusy(true);
                            claimTape(account, [BigInt(row.id)])
                              .then(() => {
                                say(
                                  zh
                                    ? `#${row.id} 已领到这个钱包。`
                                    : `#${row.id} is in this wallet.`,
                                );
                                readTapeMine(account)
                                  .then((next) => setTape(next))
                                  .catch(() => undefined);
                              })
                              .catch(() =>
                                say(zh ? "这一台没有领走。" : "This miner was not claimed.", true),
                              )
                              .finally(() => setBusy(false));
                          }}
                        >
                          {zh ? "只领这台" : "This one"}
                        </button>
                      </div>
                    </li>
                  );
                })}
                {shareRows.map((seat) => (
                  <li key={`share-${seat.id}`} className="flex items-center justify-between gap-3 border-t border-gold/30 px-2 py-2">
                    <span className="min-w-0">
                      <span className="block font-mono text-sm">
                        #{seat.id} · {seat.shares.toLocaleString("en-US")} H
                      </span>
                      <span className="text-[11px] text-up">{zh ? "算力份额" : "Hashrate shares"}</span>
                    </span>
                    <div className="text-right">
                      <p className="font-mono text-xs">{amount(seat.pending)} TAPE</p>
                      <button
                        type="button"
                        disabled={busy || !account || seat.pending === 0n}
                        className="min-h-8 px-1 text-xs text-ink/55 underline disabled:opacity-40"
                        onClick={() => {
                          if (!account) return;
                          setBusy(true);
                          claimSplitMany(account, [BigInt(seat.id)])
                            .then(() => {
                              say(zh ? `#${seat.id} 算力 TAPE 已领到这个钱包。` : `#${seat.id} hashrate TAPE is in this wallet.`);
                              setShareTick((n) => n + 1);
                            })
                            .catch(() => say(zh ? "这一笔没有领走。" : "This one was not claimed.", true))
                            .finally(() => setBusy(false));
                        }}
                      >
                        {zh ? "领取算力" : "Claim hash"}
                      </button>
                    </div>
                  </li>
                ))}
                {account && tape?.scanOk && liveSeats.length === 0 && shareRows.length === 0 ? (
                  <li className="px-2 py-3 text-sm text-ink/60">
                    {zh
                      ? "这个地址没有已经开工、还带着待领的矿机。"
                      : "This address has no running miner with a reward waiting."}
                  </li>
                ) : null}
              </ul>
              <div className="mt-auto p-4">
              {!account ? (
                <button
                  type="button"
                  className="min-h-11 w-full bg-ink text-sm text-paper"
                  onClick={() => {
                      setBusy(true);
                      connectXLayer()
                        .then(setAccount)
                        .catch(() =>
                          say(zh ? "钱包没有连上。" : "The wallet did not connect.", true),
                        )
                        .finally(() => setBusy(false));
                    }}
                  >
                    {zh ? "连接钱包" : "Connect"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || chosen.length === 0}
                    className="min-h-11 w-full border border-[#c6a15a] bg-ink text-sm text-paper disabled:opacity-40"
                    onClick={() => {
                      setBusy(true);
                      claimTape(
                        account,
                        chosen.map((row) => BigInt(row.id)),
                      )
                        .then(() => {
                          say(
                            zh
                              ? "TAPE 已领到这个钱包。名单随后再对。"
                              : "TAPE is in this wallet. The list refreshes after.",
                          );
                          readTapeMine(account)
                            .then((row) => setTape(row))
                            .catch(() => undefined);
                        })
                        .catch((error) => {
                          const message = error instanceof Error ? error.message : "";
                          say(
                            /rejected|denied|4001/i.test(message)
                              ? zh
                                ? "你取消了。"
                                : "You cancelled."
                              : message === "chain"
                                ? zh
                                  ? "电脑上的 OKX 还没到 X Layer。弹窗里切换并确认，再点领取。"
                                  : "OKX on this computer is not on X Layer. Switch in the prompt, then claim."
                                : zh
                                  ? "领取没有完成。TAPE 还在合约里。"
                                  : "The claim did not finish.",
                            true,
                          );
                        })
                        .finally(() => setBusy(false));
                    }}
                  >
                    {zh ? `领取电路 TAPE · ${chosen.length}` : `Claim circuit TAPE · ${chosen.length}`}
                  </button>
                )}
              </div>
              <p className="px-4 pb-4 text-[11px] leading-5 text-ink/40">
                {tapeErr
                  ? tapeErr
                  : tape?.scanning
                    ? zh
                      ? "正在对已经开工的矿机。"
                      : "Matching miners already running."
                    : !tape?.scanOk
                      ? zh
                        ? "名单没扫全。刷新再试。"
                        : "The list did not finish. Refresh."
                      : account && tape
                        ? zh
                          ? `钱包 ${amount(tape.balance)} TAPE`
                          : `Wallet ${amount(tape.balance)} TAPE`
                        : ""}
                {account && tape?.scanOk && liveSeats.length === 0 && shareRows.length === 0
                  ? zh
                    ? " 没有待领。"
                    : " Nothing is pending."
                  : ""}
                {" · "}
                <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_MINE}`} target="_blank" rel="noreferrer">
                  {zh ? "挖矿合约" : "Mine"}
                </a>
              </p>
              {note ? <p className={`px-4 pb-4 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
            </article>
            <HashClaim zh={zh} account={account} />
          </section>
        )}
      </SideRail>
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
    <div className="min-w-0 border-l border-gold/20 px-3 py-2 first:border-l-0 [&:nth-child(3n+1)]:border-l-0">
      <dt className="truncate text-[10px] tracking-wide text-ink/40">{k}</dt>
      <dd className="mt-0.5 font-mono text-[13px] tabular-nums break-words">{v}</dd>
    </div>
  );
}
