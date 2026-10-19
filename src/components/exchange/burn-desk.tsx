import { useEffect, useState } from "react";
import { ashTape, ashWafer, ASH, readAsh, type AshBoard } from "@/lib/burn";
import { claimTape, tapeText, readTapeMine, type TapeSeat } from "@/lib/tape-mine";
import { tapeUnits } from "@/lib/tape-pool";
import { currentAccount, onAccount } from "@/lib/wallet";
import { catchKindSupply, connectXLayer, transferCircuit, transistorHeld, type KindSupply } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

function pct(part: bigint, whole: bigint): string {
  if (whole <= 0n) return "—";
  const bps = (part * 10000n) / whole;
  return `${(Number(bps) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function num(value: bigint): string {
  return value.toLocaleString("en-US");
}

function tapeShow(value: bigint): string {
  const n = Number(tapeText(value));
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : tapeText(value);
}

export function BurnDesk() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [board, setBoard] = useState<AshBoard | null>(null);
  const [kind, setKind] = useState<KindSupply | null>(null);
  const [held, setHeld] = useState({ tape: 0n, nand: 0n, latch: 0n });
  const [owned, setOwned] = useState<TapeSeat[]>([]);
  const [asset, setAsset] = useState<"tape" | "nand" | "latch" | "circuit">("tape");
  const [amount, setAmount] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readAsh().then((row) => { if (!dead) setBoard(row); }).catch(() => undefined);
      if (!account) return;
      readTapeMine(account).then((row) => { if (!dead) { setOwned(row.seats); setHeld((prev) => ({ ...prev, tape: row.balance })); } }).catch(() => undefined);
      transistorHeld(account).then((row) => { if (!dead) setHeld((prev) => ({ ...prev, nand: row.nand, latch: row.latch })); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 30_000);
    catchKindSupply((row) => { if (!dead) setKind(row); }).catch(() => undefined);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

  const say = (text: string, failed = false) => { setBad(failed); setNote(text); };
  const nandGone = (kind?.nandBurn ?? 0n) + (board?.nand ?? 0n);
  const latchGone = (kind?.latchBurn ?? 0n) + (board?.latch ?? 0n);
  const live = owned.filter((row) => picked.includes(row.id) && row.on).length;

  return (
    <section className="grid items-start gap-4 lg:grid-cols-2">
      <article className="border border-gold bg-card px-3 py-3">
        <p className="text-xs tracking-widest text-gold">X Layer · {ASH}</p>
        <h2 className="font-display text-3xl italic">{zh ? "已经销毁" : "Already destroyed"}</h2>
        <p className="mt-2 text-sm leading-relaxed">
          {zh
            ? "合约没有 burn。自愿销毁就是打进这个黑洞地址，任何人取不回。流片烧掉的 NAND、LATCH 另从铸币日志算，不和黑洞重复。"
            : "There is no burn function. A voluntary burn is a transfer into this dead address. Nobody can take it back. NAND and LATCH burned by tape-out are counted from mint logs, not twice."}
        </p>
        <dl className="mt-3 grid gap-2 text-sm">
          <Row k="TAPE" v={board ? `${tapeShow(board.tape)} · ${pct(board.tape, board.tapeSupply)}` : "—"} sub={board ? (zh ? `占已领出。上限 ${pct(board.tape, board.tapeCap)}` : `Of claimed supply. ${pct(board.tape, board.tapeCap)} of the cap`) : ""} />
          <Row k={zh ? "电路" : "Circuits"} v={board ? `${board.circuits.toLocaleString("en-US")} · ${pct(BigInt(board.circuits), BigInt(board.taped))}` : "—"} sub={board ? (zh ? `占已流片 ${board.taped.toLocaleString("en-US")} 片${board.scanOk ? "" : "。这次没扫全"}` : `Of ${board.taped.toLocaleString("en-US")} taped${board.scanOk ? "" : ". Scan incomplete"}`) : ""} />
          <Row k="NAND" v={kind && board ? `${num(nandGone)} · ${pct(nandGone, kind.nandMint)}` : board ? num(board.nand) : "—"} sub={kind ? (zh ? `流片烧掉 ${num(kind.nandBurn)} · 黑洞 ${num(board?.nand ?? 0n)} · 已铸 ${num(kind.nandMint)}` : `Tape-out ${num(kind.nandBurn)} · dead ${num(board?.nand ?? 0n)} · minted ${num(kind.nandMint)}`) : (zh ? "铸币日志还在补。上面先是黑洞里的。" : "Mint logs are still loading. The figure above is only the dead address.")} />
          <Row k="LATCH" v={kind && board ? `${num(latchGone)} · ${pct(latchGone, kind.latchMint)}` : board ? num(board.latch) : "—"} sub={kind ? (zh ? `流片烧掉 ${num(kind.latchBurn)} · 黑洞 ${num(board?.latch ?? 0n)} · 已铸 ${num(kind.latchMint)}` : `Tape-out ${num(kind.latchBurn)} · dead ${num(board?.latch ?? 0n)} · minted ${num(kind.latchMint)}`) : (zh ? "铸币日志还在补。上面先是黑洞里的。" : "Mint logs are still loading. The figure above is only the dead address.")} />
        </dl>
      </article>
      <article className="border border-gold bg-card px-3 py-3">
        <h2 className="font-display text-3xl italic">{zh ? "自愿销毁" : "Burn"}</h2>
        <div className="mt-3 grid grid-cols-4 border border-gold">
          {(["tape", "nand", "latch", "circuit"] as const).map((id) => (
            <button key={id} type="button" onClick={() => { setAsset(id); setAck(false); }} className={`min-h-11 text-xs sm:text-sm ${asset === id ? "bg-ink text-paper" : ""}`}>
              {id === "tape" ? "TAPE" : id === "nand" ? "NAND" : id === "latch" ? "LATCH" : zh ? "电路" : "Circuit"}
            </button>
          ))}
        </div>
        {asset === "circuit" ? (
          <>
            <p className="mt-3 text-xs text-ink/60">{zh ? `这个钱包还能销毁 ${owned.length} 片。勾选。挖矿中的要签三笔，每一笔都会先出钱包，不会三笔叠在一起才弹。` : `${owned.length} can be burned from this wallet. A live one takes three signatures. The wallet opens for each one. They are not held until all three are ready.`}</p>
            <ul className="mt-2 max-h-48 overflow-auto border border-gold/40">
              {owned.map((row) => (
                <li key={row.id}>
                  <label className={`flex items-center justify-between gap-2 px-2 py-2 text-xs ${picked.includes(row.id) ? "bg-ink text-paper" : ""}`}>
                    <span>#{row.id} · {Number(row.gates).toLocaleString("en-US")} {zh ? "门" : "gates"} · {row.on ? (zh ? "挖矿中" : "Mining") : (zh ? "未开工" : "Off")}</span>
                    <input type="checkbox" checked={picked.includes(row.id)} onChange={() => { setPicked((cur) => cur.includes(row.id) ? cur.filter((id) => id !== row.id) : [...cur, row.id]); setAck(false); }} />
                  </label>
                </li>
              ))}
              {account && owned.length === 0 ? <li className="px-2 py-3 text-sm text-ink/60">{zh ? "这个地址没有还能销毁的电路。" : "This address has no circuit left to burn."}</li> : null}
            </ul>
          </>
        ) : (
          <label className="mt-3 block text-xs">
            {zh ? "数量" : "Amount"}
            <input value={amount} onChange={(event) => setAmount(asset === "tape" ? event.target.value.replace(/[^\d.]/g, "") : event.target.value.replace(/[^\d]/g, ""))} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold bg-transparent px-2 font-mono outline-none" />
            <button type="button" className="mt-1 underline" onClick={() => setAmount(asset === "tape" ? tapeText(held.tape) : (asset === "nand" ? held.nand : held.latch).toString())}>
              {zh ? "全部" : "All"} {asset === "tape" ? tapeShow(held.tape) : num(asset === "nand" ? held.nand : held.latch)}
            </button>
          </label>
        )}
        <p className="mt-3 border border-sell/40 px-2 py-2 text-xs leading-5">
          {zh
            ? `打进 ${ASH}。不能撤回。电路销毁后不能再转、不能再挖。TAPE 的已领出总量不会变小，占比按黑洞余额除以已领出。`
            : `This goes to ${ASH}. It cannot be undone. A burned circuit cannot be moved or mined. Claimed TAPE supply does not shrink. The share is the dead balance divided by claimed supply.`}
          {live > 0 ? (zh ? ` 选中的 ${live} 片正在挖矿。` : ` ${live} selected are mining.`) : ""}
        </p>
        <label className="mt-2 flex gap-2 text-xs">
          <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />
          {zh ? "我知道这笔销毁取不回来" : "I know this burn cannot be reversed"}
        </label>
        {!account ? (
          <button type="button" className="mt-3 min-h-12 w-full bg-ink text-paper" disabled={busy} onClick={() => { setBusy(true); connectXLayer().then(setAccount).catch(() => say(zh ? "钱包没有连上。" : "The wallet did not connect.", true)).finally(() => setBusy(false)); }}>{zh ? "连接钱包" : "Connect"}</button>
        ) : (
          <button
            type="button"
            disabled={busy || !ack || (asset === "circuit" ? picked.length === 0 : !amount)}
            className="mt-3 min-h-12 w-full bg-ink text-paper disabled:opacity-40"
            onClick={() => {
              setBusy(true);
              const run = async () => {
                if (asset === "tape") return ashTape(account, tapeUnits(amount));
                if (asset === "nand" || asset === "latch") return ashWafer(account, asset === "nand" ? 0 : 1, BigInt(amount || "0"));
                for (let i = 0; i < picked.length; i += 1) {
                  const id = picked[i];
                  const row = owned.find((item) => item.id === id);
                  const mark = zh ? `第 ${i + 1} / ${picked.length} 片` : `${i + 1} / ${picked.length}`;
                  if (row?.on) {
                    say(zh ? `${mark}：先领走待领的 TAPE。` : `${mark}: claim the pending TAPE first.`);
                    await claimTape(account, [BigInt(id)]);
                  }
                  say(zh ? `${mark}：打进黑洞。` : `${mark}: send it to the dead address.`);
                  await transferCircuit(account, ASH, BigInt(id));
                  if (row?.on) {
                    say(zh ? `${mark}：退出算力。` : `${mark}: drop the weight.`);
                    await claimTape(account, [BigInt(id)]);
                  }
                }
              };
              run()
                .then(() => { setPicked([]); setAmount(""); setAck(false); say(zh ? "已打进黑洞。数字等下一轮链上读取。" : "It is in the dead address. The figures update on the next read."); })
                .catch((error) => say(error instanceof Error && /rejected|denied/i.test(error.message) ? (zh ? "你取消了。没销毁的还在钱包里。" : "You cancelled. What was not burned is still in the wallet.") : (zh ? "没有完成。已签成功的那一笔不会退回。" : "It did not finish. A signature that already landed does not come back."), true))
                .finally(() => setBusy(false));
            }}
          >
            {zh ? "签名并销毁" : "Sign and burn"}
          </button>
        )}
        {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </article>
    </section>
  );
}

function Row({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="border border-gold/40 px-2 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs tracking-widest text-gold">{k}</dt>
        <dd className="font-mono">{v}</dd>
      </div>
      {sub ? <p className="mt-1 text-xs text-ink/60">{sub}</p> : null}
    </div>
  );
}
