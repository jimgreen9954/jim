import { useEffect, useState } from "react";
import { connectKind, currentAccount, disconnectWallet, onAccount, onOpenLink } from "@/lib/wallet";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import {
  CANVAS,
  connectXLayer,
  DEPLOYED,
  mintCost,
  mintTransistor,
  processorUrl,
  readProcessor,
  tapeRecipe,
  transistorHeld,
  catchKindSupply,
  txUrl,
  type KindSupply,
  type ProcessorStatus,
} from "@/lib/xlayer";

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectButton() {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => onOpenLink(setLink), []);
  if (link) {
    const binance = link.includes("binance.com");
    return (
      <a href={link} className="inline-flex min-h-11 items-center border border-gold bg-ink px-3 text-sm text-paper">
        {binance ? (lang === "zh" ? "打开币安" : "Open Binance") : lang === "zh" ? "打开 OKX" : "Open OKX"}
      </a>
    );
  }
  if (account) {
    return (
      <span className="flex max-w-[11rem] gap-1 sm:max-w-none sm:gap-2">
        <span className="inline-flex min-h-10 max-w-28 items-center truncate border border-gold bg-card px-2 font-mono text-xs sm:min-h-11 sm:max-w-40 sm:px-3 sm:text-sm">{short(account)}</span>
        <button type="button" className="min-h-10 shrink-0 border border-gold px-2 text-xs sm:min-h-11 sm:px-3 sm:text-sm" onClick={() => void disconnectWallet()}>
          {lang === "zh" ? "退出" : "Out"}
        </button>
      </span>
    );
  }
  return (
    <span className="flex gap-1 sm:gap-2">
      {(["okx", "binance"] as const).map((which) => (
        <button
          key={which}
          type="button"
          className="min-h-10 border border-gold px-2 text-xs sm:min-h-11 sm:px-3 sm:text-sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setNote(lang === "zh" ? "正在打开钱包…" : "Opening the wallet…");
            connectKind(which)
              .catch((err: unknown) => {
                if (err instanceof Error && err.message === "binanceapp") return;
                const code = (err as { code?: number }).code;
                const message = err instanceof Error ? err.message : "";
                setNote(code === 4001 ? c.walletReject : message || c.walletNo);
              })
              .finally(() => setBusy(false));
          }}
        >
          {which === "okx" ? "OKX" : lang === "zh" ? "币安" : "Binance"}
        </button>
      ))}
      {note ? <span className="self-center text-xs text-sell">{note}</span> : null}
    </span>
  );
}

export function WalletBar() {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [account, setAccount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [hash, setHash] = useState<string | null>(null);
  const [cpu, setCpu] = useState<ProcessorStatus | null>(null);
  const [kind, setKind] = useState<0 | 1>(0);
  const [qtyText, setQtyText] = useState("100");
  const [held, setHeld] = useState<{ nand: bigint; latch: bigint } | null>(null);
  const [kinds, setKinds] = useState<KindSupply | null>(null);

  useEffect(() => {
    let dead = false;
    readProcessor()
      .then((status) => {
        if (!dead) setCpu(status);
      })
      .catch(() => {
        if (!dead) setCpu(null);
      });
    return () => {
      dead = true;
    };
  }, [hash]);

  useEffect(() => {
    if (!account) {
      setHeld(null);
      return;
    }
    let dead = false;
    const pull = () => {
      transistorHeld(account)
        .then((row) => {
          if (!dead) setHeld(row);
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 5000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [account, hash]);

  useEffect(() => {
    let dead = false;
    catchKindSupply((row) => {
      if (!dead) setKinds(row);
    }).catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [hash]);

  const fail = (err: unknown) => {
    const code = (err as { code?: number }).code;
    const message = err instanceof Error ? err.message : "";
    if (message === "nowallet") {
      setNote(c.walletNo);
    } else if (message === "cap") {
      setNote(lang === "zh" ? "超过还能铸的数量。" : "That is more than the supply still left.");
    } else if (message === "amount") {
      setNote(lang === "zh" ? "数量要是整数。" : "Use a whole number.");
    } else if (code === 4001 || message === "minprice") {
      setNote(message === "minprice" ? c.walletMin : c.walletReject);
    } else {
      setNote(message || c.walletReject);
    }
    setBad(true);
  };

  const connect = async () => {
    setBusy(true);
    setBad(false);
    setNote(c.walletBusy);
    try {
      const addr = await connectXLayer();
      setAccount(addr);
      setNote(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const mint = async () => {
    setBusy(true);
    setBad(false);
    setNote(c.walletBusy);
    try {
      const from = account ?? (await connectXLayer());
      setAccount(from);
      const tx = await mintTransistor(from, kind, qty);
      setHash(tx);
      setNote(null);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const left = cpu ? BigInt(cpu.cap) - BigInt(cpu.minted) : null;
  const qty = /^\d+$/.test(qtyText.trim()) ? BigInt(qtyText.trim()) : 0n;
  const cost = cpu && qty > 0n ? mintCost(cpu.price, cpu.fee, qty) : null;
  const label = kind === 0 ? "NAND" : "LATCH";
  const tooMany = left !== null && qty > left;

  return (
    <section className="border border-gold bg-card shadow-plate">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-gold/40 px-3 py-3">
        <div>
          <h2 className="font-display text-2xl italic">{c.walletTitle}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink/80">{c.walletNote}</p>
        </div>
        <a className="min-h-11 underline decoration-gold underline-offset-4" href={processorUrl()} target="_blank" rel="noreferrer">
          {c.walletCpu}
        </a>
      </header>
      <div className="flex flex-col gap-3 p-3">
        <p className="text-sm leading-relaxed">{c.nextHint}</p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
          <p className="border border-gold/40 px-3 py-2">
            <span className="block text-xs tracking-widest text-gold">{c.liveCpu}</span>
            <span className="font-mono text-lg">{cpu?.name ?? "TAPELIQUID"}</span>
          </p>
          <p className="border border-gold/40 px-3 py-2">
            <span className="block text-xs tracking-widest text-gold">{c.liveMinted}</span>
            <span className="font-mono text-lg tabular-nums">
              {cpu ? `${Number(cpu.minted).toLocaleString("en-US")} / ${Number(cpu.cap).toLocaleString("en-US")}` : "—"}
            </span>
          </p>
          <p className="border border-gold/40 px-3 py-2">
            <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "NAND 剩余" : "NAND left"}</span>
            <span className="font-mono text-lg tabular-nums">
              {kinds ? Number(kinds.nandMint - kinds.nandBurn).toLocaleString("en-US") : "—"}
            </span>
            <span className="mt-1 block text-xs text-ink/60">
              {kinds
                ? lang === "zh"
                  ? `已铸 ${Number(kinds.nandMint).toLocaleString("en-US")} · 烧掉 ${Number(kinds.nandBurn).toLocaleString("en-US")}`
                  : `Minted ${Number(kinds.nandMint).toLocaleString("en-US")} · Burned ${Number(kinds.nandBurn).toLocaleString("en-US")}`
                : lang === "zh"
                  ? "正在按铸造记录拆"
                  : "Reading mint records"}
            </span>
          </p>
          <p className="border border-gold/40 px-3 py-2">
            <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "LATCH 剩余" : "LATCH left"}</span>
            <span className="font-mono text-lg tabular-nums">
              {kinds ? Number(kinds.latchMint - kinds.latchBurn).toLocaleString("en-US") : "—"}
            </span>
            <span className="mt-1 block text-xs text-ink/60">
              {kinds
                ? lang === "zh"
                  ? `已铸 ${Number(kinds.latchMint).toLocaleString("en-US")} · 烧掉 ${Number(kinds.latchBurn).toLocaleString("en-US")}`
                  : `Minted ${Number(kinds.latchMint).toLocaleString("en-US")} · Burned ${Number(kinds.latchBurn).toLocaleString("en-US")}`
                : "—"}
            </span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <p className="border border-gold/40 px-3 py-2">
              <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "可流片 NAND" : "NAND you can tape"}</span>
              <span className="font-mono text-3xl tabular-nums">{held ? Number(held.nand).toLocaleString("en-US") : "—"}</span>
              <span className="mt-1 block text-xs text-ink/60">{lang === "zh" ? "这个地址的 balanceOf，5 秒重读。不是上面的剩余。" : "balanceOf for this address, every 5s. Not the supply above."}</span>
            </p>
            <p className="border border-gold/40 px-3 py-2">
              <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "可流片 LATCH" : "LATCH you can tape"}</span>
              <span className="font-mono text-3xl tabular-nums">{held ? Number(held.latch).toLocaleString("en-US") : "—"}</span>
              <span className="mt-1 block text-xs text-ink/60">{lang === "zh" ? "流片从这里扣，不是铸造剩余" : "Tape-out spends this, not the mint left"}</span>
            </p>
          </div>
          <p className="border border-gold/40 px-3 py-2">
            <span className="block text-xs tracking-widest text-gold">{c.liveCircuits}</span>
            <span className="font-mono text-lg tabular-nums">{cpu?.circuits ?? "—"}</span>
          </p>
        </div>
        <p className="break-all font-mono text-xs">
          {c.walletCpu} {DEPLOYED.circuits}
        </p>
        <div className="grid grid-cols-2 gap-2">
          {([0, 1] as const).map((id) => (
            <button key={id} type="button" onClick={() => setKind(id)} className={`min-h-11 border border-gold ${kind === id ? "bg-ink text-paper" : ""}`}>
              {id === 0 ? "NAND" : "LATCH"}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(["100", "1000", "10000"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setQtyText(item)} className={`min-h-11 border border-gold font-mono ${qtyText === item ? "bg-ink text-paper" : ""}`}>
              {Number(item).toLocaleString("en-US")}
            </button>
          ))}
        </div>
        <label className="border border-gold/40 px-3 py-2">
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "自定义数量" : "Custom amount"}</span>
          <input
            value={qtyText}
            onChange={(event) => setQtyText(event.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="w-full bg-transparent font-mono text-3xl outline-none"
          />
        </label>
        {tooMany ? <p className="text-sm text-sell">{lang === "zh" ? "超过还能铸的数量。" : "More than the supply still left."}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="min-h-14 bg-ink px-4 font-display text-2xl italic text-paper disabled:opacity-40" disabled={busy || qty < 1n || tooMany} onClick={mint}>
            {lang === "zh" ? `铸造 ${qty.toString()} 颗 ${label}` : `Mint ${qty.toString()} ${label}`}
            {cost ? ` · ${cost} OKB` : ""}
          </button>
          <a className="inline-flex min-h-11 items-center border border-gold px-3" href={CANVAS} target="_blank" rel="noreferrer">
            {c.openCanvas}
          </a>
          <a className="inline-flex min-h-11 items-center border border-gold px-3" href={processorUrl()} target="_blank" rel="noreferrer">
            {c.walletOfficial}
          </a>
          {!account ? (
            <button type="button" className="min-h-11 border border-gold px-3" disabled={busy} onClick={connect}>
              {c.walletConnect}
            </button>
          ) : (
            <span className="font-mono text-sm tabular-nums">{short(account)}</span>
          )}
        </div>
        {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        {hash ? (
          <a className="underline decoration-gold underline-offset-4" href={txUrl(hash)} target="_blank" rel="noreferrer">
            {c.walletTx}
          </a>
        ) : null}
        {cpu ? (
          <a className="break-all underline decoration-gold underline-offset-4" href={processorUrl()} target="_blank" rel="noreferrer">
            {c.walletPrice} {cpu.price} OKB
          </a>
        ) : null}
        <RecipeGrid held={held} lang={lang} onDone={setHash} />
      </div>
    </section>
  );
}

const RECIPES: [number, number][] = [
  [1, 0],
  [1, 1],
  [2, 0],
  [3, 0],
  [1, 9],
  [1, 60],
  [4, 0],
  [7, 0],
  [9, 0],
  [11, 0],
  [20, 0],
  [25, 0],
  [21, 9],
  [31, 0],
  [38, 0],
  [41, 0],
  [49, 0],
  [6, 54],
  [2, 64],
  [72, 0],
  [100, 0],
  [207, 0],
  [318, 0],
  [400, 0],
];

function RecipeGrid({
  held,
  lang,
  onDone,
}: {
  held: { nand: bigint; latch: bigint } | null;
  lang: "zh" | "en";
  onDone: (hash: string) => void;
}) {
  const [pick, setPick] = useState<[number, number] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const short = (n: number, l: number) => `${n}N + ${l}L`;
  const go = async () => {
    if (!pick) return;
    const [n, l] = pick;
    setBusy(true);
    setBad(false);
    setNote(lang === "zh" ? "正在连接钱包。" : "Connecting the wallet.");
    try {
      const from = currentAccount() ?? (await connectXLayer());
      if (held && (held.nand < BigInt(n) || held.latch < BigInt(l))) {
        throw new Error("short");
      }
      setNote(lang === "zh" ? `正在流片 ${short(n, l)}。钱包确认后不能撤回。` : `Taping ${short(n, l)}. It cannot be undone after you confirm.`);
      const hash = await tapeRecipe(from, n, l);
      setNote(lang === "zh" ? `流片完成 ${short(n, l)}。烧掉的是本台晶体管，不是官网算力。` : `Taped ${short(n, l)}. This burned this processor's transistors, not official hashrate.`);
      setPick(null);
      onDone(hash);
      window.open(txUrl(hash), "_blank", "noopener,noreferrer");
    } catch (error) {
      setBad(true);
      const message = error instanceof Error ? error.message : "";
      setNote(
        message === "short"
          ? lang === "zh"
            ? "这个地址的 NAND 或 LATCH 不够。"
            : "This address does not hold enough NAND or LATCH."
          : message.includes("rejected") || message.includes("denied")
            ? lang === "zh"
              ? "你取消了。"
              : "You cancelled."
            : lang === "zh"
              ? "流片没有完成。颗数还在。"
              : "Tape-out did not finish. The transistors are still there.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-t border-gold/40 pt-3">
      <h3 className="font-display text-xl italic">{lang === "zh" ? "按配方直接流片" : "Tape a recipe directly"}</h3>
      <p className="mt-1 text-sm leading-relaxed text-ink/80">
        {lang === "zh"
          ? "要自己接线，点页顶「流片 TAPELIQUID」进画布。下面这些配方不画图，确认后直接烧掉。工本 H 等于 NAND 加 LATCH，不是官网 BEM 算力。每次另付 0.0013 OKB，不能撤回。"
          : "To draw the wires yourself, use Tape TAPELIQUID at the top. These recipes skip the drawing and burn on confirm. H is NAND plus LATCH, not official BEM hashrate. Each one also pays 0.0013 OKB and cannot be undone."}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {RECIPES.map(([n, l]) => {
          const on = pick?.[0] === n && pick?.[1] === l;
          const enough = !held || (held.nand >= BigInt(n) && held.latch >= BigInt(l));
          return (
            <button
              key={`${n}-${l}`}
              type="button"
              onClick={() => setPick([n, l])}
              className={`flex items-center justify-between border px-3 py-2 text-left ${on ? "border-ink bg-ink text-paper" : "border-gold"} ${enough ? "" : "opacity-50"}`}
            >
              <span className="font-mono">{short(n, l)}</span>
              <span className="font-mono text-sm tabular-nums">{n + l} H</span>
            </button>
          );
        })}
      </div>
      <button type="button" className="mt-3 min-h-12 w-full bg-ink font-display text-xl italic text-paper disabled:opacity-40" disabled={!pick || busy} onClick={() => void go()}>
        {pick
          ? lang === "zh"
            ? `流片 ${pick[0]}N + ${pick[1]}L`
            : `Tape ${pick[0]}N + ${pick[1]}L`
          : lang === "zh"
            ? "先选一个配方"
            : "Pick a recipe"}
      </button>
      {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );
}
