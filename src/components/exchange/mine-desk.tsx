import { useEffect, useState } from "react";
import { BSC } from "@/lib/bsc";
import { useExchange } from "@/lib/exchange-store";
import { bemText, claimPod, getPodMiners, POD, readPodPending, readPodStats, type PodStats } from "@/lib/pod";
import { claimTape, openTape, readTapeMine, readTapeSeats, TAPE, TAPE_MINE, tapeText, type TapeSeat } from "@/lib/tape-mine";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

export function MineDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [stats, setStats] = useState<PodStats | null>(null);
  const [miners, setMiners] = useState<{ cpu: string; circuits: string; circuitId: number; taskId: number; pending: bigint; key: `0x${string}` }[]>([]);
  const [snap, setSnap] = useState("");
  const [seats, setSeats] = useState<TapeSeat[]>([]);
  const [tape, setTape] = useState<{ supply: bigint; weight: bigint; balance: bigint } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => onAccount((next) => setAccount(next)), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readPodStats().then((row) => { if (!dead) setStats(row); }).catch(() => undefined);
      readTapeMine(account).then((row) => { if (!dead) setTape(row); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

  useEffect(() => {
    if (!account) {
      setMiners([]);
      setSeats([]);
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
    readTapeSeats(account).then((rows) => { if (!dead) setSeats(rows); }).catch(() => undefined);
    return () => { dead = true; };
  }, [account]);

  const pendingBem = miners.reduce((sum, row) => sum + row.pending, 0n);
  const pendingTape = seats.reduce((sum, row) => sum + row.pending, 0n);
  const say = (text: string, failed = false) => { setBad(failed); setNote(text); };

  return (
    <section className="grid items-start gap-4 lg:grid-cols-2">
      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-xs tracking-widest text-gold">BSC · tapeout.net</p>
        <h2 className="font-display text-3xl italic">{zh ? "领官网 BEM" : "Claim official BEM"}</h2>
        <p className="mt-2 text-sm leading-relaxed">
          {zh
            ? "数字每 15 秒从挖矿合约重读。矿机名单用官网快照，大约一分钟。只有 Behemoth 和 TapeOut 上已经开挖的电路才有 BEM。这一页不替你做题，也不托管。"
            : "Figures are read from the mining contract every 15 seconds. The miner list is the official snapshot. Only circuits already mining on Behemoth or TapeOut earn BEM."}
        </p>
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
          {account && miners.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "官网快照里没有这个地址的矿机。" : "The official snapshot has no miner for this address."}</li> : null}
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
        <p className="mt-2 break-all text-xs text-ink/50">
          <a className="underline" href="https://tapeout.net/bridge" target="_blank" rel="noreferrer">{zh ? "官网 BEM 跨链" : "Official BEM bridge"}</a>
          {" · "}
          <a className="underline" href={`${BSC.explorer}/address/0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72`} target="_blank" rel="noreferrer">BSC</a>
          {" · "}
          <a className="underline" href={`${XLAYER.explorer}/address/0x60e62Efa9405d6873C5deaBD4E6CC91c25363952`} target="_blank" rel="noreferrer">X Layer BEM</a>
          <span className="mt-1 block">{zh ? "本站不经手。TAPE 没有自己的桥，所以这里没有 TAPE 跨链。" : "This site does not custody the bridge. TAPE has no bridge, so there is no TAPE transfer here."}</span>
        </p>
      </article>
      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-xs tracking-widest text-gold">X Layer · TAPELIQUID</p>
        <h2 className="font-display text-3xl italic">{zh ? "领 TAPE" : "Claim TAPE"}</h2>
        <p className="mt-2 text-sm leading-relaxed">
          {zh
            ? "发行写在规则里：硬顶 21,000,000，8 位小数，开盘日排放 1,000，收费地址连续 30 日有台费后一次性改为 7,200，之后每 210,000×600 秒减半。现在这份合约还不是那一档。它从部署起就是每天 7,200，权重是门数，q 不能大于 1。没有管理员，也不能把排放改掉。大张流片不产生官网 BEM。TAPE 还不能跨链。"
            : "The written schedule is a 21,000,000 cap, 8 decimals, 1,000 a day at the open, one switch to 7,200 after 30 days of desk fees, then a halving every 210,000×600 seconds. This contract is not that schedule. It emits 7,200 a day from deployment, weight is the gate count, and q cannot be above 1. There is no admin and no way to edit the rate. A large tape-out does not mint official BEM. TAPE cannot be bridged yet."}
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Cell k={zh ? "已铸" : "Minted"} v={tape ? `${tapeText(tape.supply)} TAPE` : "—"} />
          <Cell k={zh ? "全网权重" : "Weight"} v={tape ? tape.weight.toString() : "—"} />
          <Cell k={zh ? "这地址余额" : "Balance"} v={tape && account ? `${tapeText(tape.balance)} TAPE` : "—"} />
          <Cell k={zh ? "待领" : "Pending"} v={account ? `${tapeText(pendingTape)} TAPE` : "—"} />
        </dl>
        <ul className="mt-2 max-h-64 overflow-auto border border-gold/40">
          {seats.map((row) => (
            <li key={row.id} className="grid grid-cols-[4rem_5rem_1fr_auto] items-center gap-2 border-t border-gold/30 px-2 py-2 text-xs">
              <span className="font-mono">#{row.id}</span>
              <span>{row.gates} {zh ? "门" : "gates"}</span>
              <span className="text-right font-mono">{tapeText(row.pending)}</span>
              <button
                type="button"
                disabled={busy || row.on}
                className="min-h-8 border border-gold px-2 disabled:opacity-40"
                onClick={() => {
                  if (!account) return;
                  setBusy(true);
                  openTape(account, BigInt(row.id))
                    .then(() => readTapeSeats(account).then(setSeats))
                    .then(() => say(zh ? `#${row.id} 已开工。权重按门数。` : `#${row.id} is open. Weight is the gate count.`))
                    .catch(() => say(zh ? "开工没有完成。" : "Open did not finish.", true))
                    .finally(() => setBusy(false));
                }}
              >
                {row.on ? (zh ? "已开工" : "Open") : (zh ? "开工" : "Open")}
              </button>
            </li>
          ))}
          {account && seats.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "最近 40 张电路里没有这个地址的。先流片。" : "None of the latest 40 circuits belong to this address."}</li> : null}
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {!account ? (
            <button type="button" className="col-span-2 min-h-12 bg-ink font-display text-2xl italic text-paper" onClick={() => { setBusy(true); connectXLayer().then(setAccount).catch(() => say(zh ? "钱包没有连上。" : "The wallet did not connect.", true)).finally(() => setBusy(false)); }}>
              {zh ? "连接钱包" : "Connect"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || pendingTape === 0n}
              className="col-span-2 min-h-12 bg-ink font-display text-2xl italic text-paper disabled:opacity-40"
              onClick={() => {
                setBusy(true);
                claimTape(account, seats.filter((row) => row.on && row.pending > 0n).map((row) => BigInt(row.id)))
                  .then(() => readTapeMine(account).then((row) => setTape(row)))
                  .then(() => say(zh ? "TAPE 已领到这个钱包。" : "TAPE is in this wallet."))
                  .catch((error) => say(error instanceof Error && /rejected|denied/i.test(error.message) ? (zh ? "你取消了。" : "You cancelled.") : (zh ? "领取没有完成。TAPE 还在合约里。" : "The claim did not finish."), true))
                  .finally(() => setBusy(false));
              }}
            >
              {zh ? "签名领取 TAPE" : "Sign and claim TAPE"}
            </button>
          )}
        </div>
        {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        <p className="mt-2 break-all text-xs text-ink/50">
          <a className="underline" href={`${XLAYER.explorer}/address/${TAPE}`} target="_blank" rel="noreferrer">TAPE {TAPE}</a>
          <br />
          <a className="underline" href={`${XLAYER.explorer}/address/${TAPE_MINE}`} target="_blank" rel="noreferrer">Mine {TAPE_MINE}</a>
        </p>
      </article>
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
