import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "viem";
import {
  bscBemBalance,
  BSC_BRIDGE,
  quoteBridge,
  sendBridge,
  type BridgeQuote,
} from "@/lib/bem-bridge";
import { deskParts } from "@/lib/invite-cut";
import { bemPrice, BSC, quoteExact } from "@/lib/bsc";
import { quoteOkb } from "@/lib/okb";
import { TAPE_BEM } from "@/lib/tape-pool";
import { readOpenBook } from "@/lib/tape-open-candles";
import {
  deployDesk,
  deskAddress,
  deskText,
  fundUsdt,
  readDesk,
  sellTape,
  TAPE_BUYER,
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
  claimOldBem,
  claimOldTape,
  deployTerm,
  fundTermBem,
  fundTermTape,
  OLD_TERM,
  readTerm,
  stakeTermBem,
  stakeTermTape,
  termAddress,
  unstakeTermBem,
  unstakeTermTape,
  unstakeOldBem,
  unstakeOldTape,
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

function GasDesk({ account, zh }: { account: string | null; zh: boolean }) {
  const [toBnb, setToBnb] = useState(true);
  const [amt, setAmt] = useState("");
  const [rate, setRate] = useState(0);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const amount = /^[0-9]*\.?[0-9]+$/.test(amt.trim()) ? Number(amt.trim()) : 0;
  const net = amount > 0 ? amount * 0.998 : 0;
  const out = toBnb ? net * rate : rate > 0 ? net / rate : 0;
  const fee = amount > 0 ? amount * 0.002 : 0;
  const pay = toBnb ? "OKB" : "BNB";
  const get = toBnb ? "BNB" : "OKB";

  useEffect(() => {
    let dead = false;
    Promise.all([
      quoteOkb("sell", 10n ** 18n).catch(() => 0n),
      quoteExact(BSC.wbnb, BSC.usdt, 10n ** 18n, BSC.bnbFee).catch(() => 0n),
    ])
      .then(([okbRaw, bnbRaw]) => {
        if (dead) return;
        const okbUsd = Number(formatUnits(okbRaw, 6));
        const bnbUsd = Number(formatUnits(bnbRaw, 18));
        setRate(okbUsd > 0 && bnbUsd > 0 ? okbUsd / bnbUsd : 0);
      })
      .catch(() => {
        if (!dead) setRate(0);
      });
    return () => {
      dead = true;
    };
  }, []);

  const cut = (n: number) =>
    n > 0 ? n.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—";

  return (
    <div className="mt-3 grid gap-2 border border-gold/40 px-3 py-3">
      <p className="text-sm">{zh ? "OKB 与 BNB" : "OKB and BNB"}</p>
      <p className="font-mono text-xs text-ink/60">
        {zh ? "1 OKB ≈" : "1 OKB ≈"}{" "}
        {rate > 0 ? rate.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"} BNB ·{" "}
        {zh ? "台费 0.20%" : "Fee 0.20%"}
      </p>
      <div className="grid grid-cols-2 border border-gold text-sm">
        <button
          type="button"
          className={`min-h-11 ${toBnb ? "bg-ink text-paper" : ""}`}
          onClick={() => setToBnb(true)}
        >
          OKB → BNB
        </button>
        <button
          type="button"
          className={`min-h-11 ${!toBnb ? "bg-ink text-paper" : ""}`}
          onClick={() => setToBnb(false)}
        >
          BNB → OKB
        </button>
      </div>
      <input
        value={amt}
        onChange={(event) => setAmt(event.target.value)}
        inputMode="decimal"
        placeholder={pay}
        className="min-h-11 border border-gold/50 bg-transparent px-2 font-mono text-sm"
      />
      <p className="font-mono text-xs text-ink/70">
        {zh ? "台费" : "Fee"} {cut(fee)} {pay} · {zh ? "到账约" : "About"} {cut(out)} {get}
      </p>
      <button type="button" disabled className="min-h-11 border border-gold/40 text-sm text-ink/50">
        {zh
          ? "两边库存还没部署，这一笔不会签名"
          : "No inventory is deployed, so this does not sign"}
      </button>
      {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );
}

export function OfficialBridge({
  account,
  zh,
  xBem,
  startOpen = false,
}: {
  account: string | null;
  zh: boolean;
  xBem: bigint | null;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [toX, setToX] = useState(true);
  const [amt, setAmt] = useState("");
  const [bscBal, setBscBal] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<BridgeQuote | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const amount = /^[0-9]*\.?[0-9]+$/.test(amt.trim())
    ? (() => {
        try {
          return units(amt, 8);
        } catch {
          return null;
        }
      })()
    : null;

  useEffect(() => {
    if (!open || !account) return;
    let dead = false;
    bscBemBalance(account)
      .then((value) => {
        if (!dead) setBscBal(value);
      })
      .catch(() => {
        if (!dead) setBscBal(null);
      });
    return () => {
      dead = true;
    };
  }, [open, account, busy]);

  useEffect(() => {
    if (!open || !account || !amount) {
      setQuote(null);
      setFee(null);
      return;
    }
    let dead = false;
    deskParts(toX ? "bsc" : "xlayer", account, amount)
      .then((parts) => {
        if (dead) return;
        setFee(parts.desk + parts.reward);
        if (parts.swapIn <= 0n) {
          setQuote(null);
          return;
        }
        return quoteBridge(toX, account, parts.swapIn).then((next) => {
          if (!dead) setQuote(next);
        });
      })
      .catch(() => {
        if (!dead) {
          setQuote(null);
          setFee(null);
        }
      });
    return () => {
      dead = true;
    };
  }, [open, account, toX, amount]);

  return (
    <div className="mt-3 border border-gold/40">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between px-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="text-sm">{zh ? "TapeOut 跨链" : "TapeOut bridge"}</span>
        <span className="text-xs text-ink/50">
          {open ? (zh ? "收起" : "Hide") : zh ? "打开" : "Open"}
        </span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-gold/30 px-3 py-3">
          <div className="grid grid-cols-2 border border-gold text-sm">
            <button
              type="button"
              className={`min-h-11 ${toX ? "bg-ink text-paper" : ""}`}
              onClick={() => setToX(true)}
            >
              BSC → X Layer
            </button>
            <button
              type="button"
              className={`min-h-11 ${!toX ? "bg-ink text-paper" : ""}`}
              onClick={() => setToX(false)}
            >
              X Layer → BSC
            </button>
          </div>
          <input
            value={amt}
            onChange={(event) => setAmt(event.target.value)}
            inputMode="decimal"
            placeholder={zh ? "BEM 数量" : "BEM amount"}
            className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-sm"
          />
          <p className="text-xs text-ink/55">
            {zh ? "可转" : "Available"}{" "}
            {toX
              ? bscBal == null
                ? "—"
                : deskText(bscBal, 8)
              : xBem == null
                ? "—"
                : deskText(xBem, 8)}{" "}
            BEM
          </p>
          <p className="text-xs leading-5">
            {zh ? "台费" : "Fee"} 0.20% {fee == null ? "—" : deskText(fee, 8)} BEM ·{" "}
            {zh ? "这次到账" : "Arrives"} {quote ? deskText(quote.received, 8) : "—"} ·{" "}
            {zh ? "桥留下" : "Bridge keeps"}{" "}
            {quote ? deskText(quote.sent - quote.received, 8) : "—"} · {toX ? "BNB" : "OKB"}{" "}
            {quote ? formatEther(quote.nativeFee) : "—"}
          </p>
          <button
            type="button"
            disabled={busy || !account || !amount}
            className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40"
            onClick={() => {
              if (!account || !amount) return;
              setBusy(true);
              sendBridge(toX, account, amount)
                .then(() => {
                  setBad(false);
                  setNote(
                    zh
                      ? "台费已付，桥已提交。到账要等桥的消息。"
                      : "The fee is paid and the bridge is submitted. It arrives with the bridge message.",
                  );
                })
                .catch((err) => {
                  setBad(true);
                  setNote(
                    err instanceof Error && err.message === "fee-kept"
                      ? zh
                        ? "台费已经转出，不退。桥没有提交。"
                        : "The fee was sent and is not returned. The bridge was not submitted."
                      : zh
                        ? "没有跨过去。BEM 还在原来的链上。"
                        : "It did not cross. The BEM is still on the original chain.",
                  );
                })
                .finally(() => setBusy(false));
            }}
          >
            {toX
              ? zh
                ? "签名转到 X Layer"
                : "Sign to X Layer"
              : zh
                ? "签名转回 BSC"
                : "Sign back to BSC"}
          </button>
          <p className="break-all font-mono text-[11px] text-ink/40">
            <a
              className="underline"
              href={`${BSC.explorer}/address/${BSC_BRIDGE}`}
              target="_blank"
              rel="noreferrer"
            >
              BSC {BSC_BRIDGE}
            </a>
            {" · "}
            <a
              className="underline"
              href={`${XLAYER.explorer}/address/${TAPE_BEM}`}
              target="_blank"
              rel="noreferrer"
            >
              X Layer {TAPE_BEM}
            </a>
          </p>
          {note ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
        </div>
      ) : null}
      <GasDesk account={account} zh={zh} />
    </div>
  );
}

function LockList({
  locks,
  zh,
  busy,
  empty,
  onTake,
}: {
  locks: TermLock[];
  zh: boolean;
  busy: boolean;
  empty: string;
  onTake: (index: number) => void;
}) {
  const open = locks.filter((row) => row.open);
  if (open.length === 0) return <p className="text-xs text-ink/50">{empty}</p>;
  const now = BigInt(Math.floor(Date.now() / 1000));
  return (
    <ul className="grid gap-2">
      {open.map((row) => {
        const ready = now >= row.unlock;
        return (
          <li
            key={row.index}
            className="grid gap-2 border border-gold/40 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
          >
            <p className="min-w-0 text-xs leading-5">
              <span className="font-mono">{deskText(row.amount, 8)}</span>
              {" · "}
              {termLabel(row.term, zh)}
              <span className="block text-ink/55">
                {zh ? "到期，新加坡时间" : "Unlocks, Singapore"} {sgWhen(row.unlock)}
              </span>
            </p>
            <button
              type="button"
              disabled={busy || !ready}
              className="min-h-11 w-full border border-gold px-3 text-sm disabled:opacity-40 sm:w-auto"
              onClick={() => onTake(row.index)}
            >
              {ready ? (zh ? "取回本金" : "Take principal") : zh ? "到期再取" : "After expiry"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Figure({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="min-w-0 border border-gold px-3 py-2">
      <p className="text-[11px] tracking-[0.16em] text-gold">{k}</p>
      <p className="break-all font-mono text-base leading-7 sm:text-lg">{v}</p>
      {sub ? <p className="break-all text-xs leading-5 text-ink/70">{sub}</p> : null}
    </div>
  );
}

function apy(
  pot: bigint,
  potDec: number,
  potPx: number | null,
  staked: bigint,
  stakeDec: number,
  stakePx: number | null,
): string {
  if (!potPx || !stakePx || staked === 0n) return "—";
  if (pot === 0n) return "0";
  const reward = (Number(pot) / 10 ** potDec) * potPx;
  const base = (Number(staked) / 10 ** stakeDec) * stakePx;
  if (!Number.isFinite(reward) || !Number.isFinite(base) || base <= 0) return "—";
  return ((reward / base) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function TapeDesk({ account, zh }: { account: string | null; zh: boolean }) {
  const [desk, setDesk] = useState<string | null>(() => deskAddress());
  const [term, setTerm] = useState<string | null>(() => termAddress());
  const [row, setRow] = useState<DeskState | null>(null);
  const [stake, setStake] = useState<TermState | null>(null);
  const [oldStake, setOldStake] = useState<TermState | null>(null);
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
        readDesk(account)
          .then((next) => {
            if (!dead && next) {
              setRow(next);
              setMiss(false);
            }
          })
          .catch(() => {
            if (!dead) setMiss(true);
          });
      }
      readTerm(account, OLD_TERM)
        .then((next) => {
          if (!dead && next) setOldStake(next);
        })
        .catch(() => undefined);
      if (term) {
        readTerm(account)
          .then((next) => {
            if (!dead && next) {
              setStake(next);
              setStakeMiss(false);
            }
          })
          .catch(() => {
            if (!dead) setStakeMiss(true);
          });
      }
      readOpenBook()
        .then((book) => {
          if (!dead && book.price > 0) setTapePx(book.price);
        })
        .catch(() => {
          if (!dead) setTapePx(null);
        });
      bemPrice()
        .then((text) => {
          if (!dead) setBemPx(Number(text.replace(/,/g, "")) || null);
        })
        .catch(() => {
          if (!dead) setBemPx(null);
        });
    };
    pull();
    const id = window.setInterval(pull, 15000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [account, desk, term]);

  const run = (
    task: () => Promise<unknown>,
    ok: string,
    refresh: "desk" | "term",
    kind: "usdt" | "stake" | "reward" | "unvest" = "usdt",
  ) => {
    if (!account) {
      setBad(true);
      setNote(
        zh
          ? "先在右上角登入。这一页不会跳进 OKX。"
          : "Sign in at the top right. This page stays here.",
      );
      return;
    }
    setBusy(true);
    Promise.resolve()
      .then(task)
      .then(async () => {
        setBad(false);
        setNote(ok);
        if (refresh === "desk") {
          const next = await readDesk(account);
          if (next) setRow(next);
        } else {
          const next = await readTerm(account);
          if (next) setStake(next);
          const old = await readTerm(account, OLD_TERM);
          if (old) setOldStake(old);
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "";
        const code = (err as { code?: number }).code;
        setBad(true);
        if (message === "amount" || message === "integer") {
          setNote(
            kind === "stake"
              ? zh
                ? "先填要锁的数量，或点全部。"
                : "Enter the amount to lock, or tap All."
              : kind === "reward"
                ? zh
                  ? "先填要充入的奖励数量。"
                  : "Enter the reward amount."
                : zh
                  ? "数量是空的，或不是数字。充 USDT0 先在右边那一格填写，或点全部。卖 TAPE 只能填整数。"
                  : "The amount is empty or not a number. Type the USDT0 on the right, or tap All. TAPE sells are whole numbers.",
          );
          return;
        }
        if (code === 4001) {
          setNote(
            kind === "usdt"
              ? zh
                ? "签名取消了。USDT0 还在钱包，没有充进去。"
                : "The signature was cancelled. The USDT0 is still in the wallet."
              : zh
                ? "签名取消了。币还在钱包，没有锁上，也没有充进奖励。"
                : "The signature was cancelled. The coins are still in the wallet.",
          );
          return;
        }
        setNote(
          kind === "stake"
            ? zh
              ? "没有锁上。要签两笔：第一笔只授权，币还在钱包；第二笔才锁进期限合约。两笔都要确认。Gas Limit 填 500000。"
              : "It did not lock. Two signatures: the first only approves and the coins stay in the wallet; the second locks them. Confirm both. Set Gas Limit to 500000."
            : kind === "unvest"
              ? zh
                ? "没有取回来。刷新后再点一次。已经按 365 天开始分出去的那一点不能退，其余的可以退。"
                : "It did not come back. Refresh and tap it once more. The trace that already started vesting over 365 days cannot be returned. The rest can."
              : kind === "reward"
                ? zh
                  ? "奖励没有充进去。要签两笔：第一笔只授权；第二笔才充入。两笔都要确认。Gas Limit 填 500000。"
                  : "The reward did not go in. Two signatures: approve, then deposit. Confirm both. Set Gas Limit to 500000."
                : zh
                  ? "没有充进去。要签两笔：第一笔只授权，币还在钱包；第二笔才进回购。两笔都要确认。地址是上面这一份。Gas Limit 填 500000。"
                  : "It did not go in. Two signatures: the first only approves, the coins stay in the wallet; the second deposits. Confirm both. The address is the one above. Set Gas Limit to 500000.",
        );
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
    deployDesk(account)
      .then((addr) => {
        setDesk(addr);
        setBad(false);
        setNote(
          zh
            ? `已部署 ${addr}。把这行地址发我，写进页面之后别人用的才是这一份。`
            : `Deployed ${addr}. Send me this address so everyone else uses this one.`,
        );
      })
      .catch(() => {
        setBad(true);
        setNote(
          zh
            ? "没有部署。留在这一页。Gas Limit 填 5000000。"
            : "It did not deploy. Stay on this page. Set Gas Limit to 5000000.",
        );
      })
      .finally(() => setBusy(false));
  };

  const deployLocks = () => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先在右上角登入。" : "Sign in at the top right.");
      return;
    }
    setBusy(true);
    deployTerm(account)
      .then((addr) => {
        setTerm(addr);
        setBad(false);
        setNote(
          zh
            ? `期限质押已部署 ${addr}。把这行地址发我写进页面。现在只有你这个浏览器看得到这一份。`
            : `Timed stake deployed at ${addr}. Send me this address to hardcode it. Only this browser can see it until then.`,
        );
      })
      .catch(() => {
        setBad(true);
        setNote(
          zh
            ? "期限质押没有部署。留在这一页。Gas Limit 填 5000000。"
            : "Timed stake did not deploy. Stay on this page. Set Gas Limit to 5000000.",
        );
      })
      .finally(() => setBusy(false));
  };

  const lock = (side: "tape" | "bem") => {
    const ack = side === "tape" ? tapeAck : bemAck;
    const text = side === "tape" ? tapeAmt : bemAmt;
    const wallet = side === "tape" ? stake?.tapeBal : stake?.bemBal;
    const coin = side === "tape" ? "TAPE" : "BEM";
    if (!ack) {
      setBad(true);
      setNote(
        zh
          ? `先勾确认。这笔 ${coin} 到期前不能取回本金。`
          : `Tick the box first. This ${coin} cannot leave before the term ends.`,
      );
      return;
    }
    let amount: bigint;
    try {
      amount = units(text, 8);
    } catch {
      setBad(true);
      setNote(zh ? `先填要锁的 ${coin}，或点全部。` : `Enter the ${coin} to lock, or tap All.`);
      return;
    }
    if (wallet !== undefined && amount > wallet) {
      setBad(true);
      setNote(zh ? `钱包里的 ${coin} 不够这一笔。` : `The wallet does not have enough ${coin}.`);
      return;
    }
    if (side === "tape") {
      run(
        () => stakeTermTape(account ?? "", amount, asTerm(tapeTerm)),
        zh ? "TAPE 已按期限锁定。" : "TAPE is locked for the term.",
        "term",
        "stake",
      );
    } else {
      run(
        () => stakeTermBem(account ?? "", amount, asTerm(bemTerm)),
        zh ? "BEM 已按期限锁定。" : "BEM is locked for the term.",
        "term",
        "stake",
      );
    }
  };

  const maxTape = row && row.usdtPool > 0n ? row.usdtPool / 100_000n : 0n;
  const tapeApy = stake ? apy(stake.bemPot, 8, bemPx, stake.tapeStakedTotal, 8, tapePx) : "—";
  const bemApy = stake ? apy(stake.tapePot, 8, tapePx, stake.bemStakedTotal, 8, bemPx) : "—";
  const openTape = stake?.tapeLocks.filter((lock) => lock.open).length ?? 0;
  const openBem = stake?.bemLocks.filter((lock) => lock.open).length ?? 0;

  return (
    <section className="grid gap-3">
      {!term ? (
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">
            {zh ? "期限质押还没部署" : "Timed stake is not deployed"}
          </h3>
          <p className="mt-2 text-sm leading-6">
            {zh
              ? "六档写死：三个月、六个月、九个月、一年、两年、三年。到期才能取本金，奖励可以先领。"
              : "Six terms are fixed: 3, 6 and 9 months, then 1, 2 and 3 years. Principal waits until expiry. Rewards can be claimed earlier."}
          </p>
          <button
            type="button"
            disabled={busy}
            className="mt-3 min-h-12 w-full bg-ink text-sm text-paper disabled:opacity-40 sm:w-auto sm:px-6"
            onClick={deployLocks}
          >
            {zh ? "部署期限质押" : "Deploy timed stake"}
          </button>
        </article>
      ) : (
        <p className="break-all font-mono text-[11px] text-ink/50">
          {zh ? "期限质押" : "Timed stake"}{" "}
          <a
            className="underline"
            href={`${XLAYER.explorer}/address/${term}`}
            target="_blank"
            rel="noreferrer"
          >
            {term}
          </a>
        </p>
      )}
      <details className="border border-gold/40 bg-card px-3 py-2">
        <summary className="cursor-pointer text-sm">{zh ? "以前的质押" : "Earlier stake"}</summary>
        <p className="mt-2 break-all font-mono text-[11px] text-ink/50">{OLD_TERM}</p>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <div>
            <p className="text-xs text-ink/60">
              {zh ? "TAPE 本金。到期才能取回。" : "TAPE principal. Take it only after the date."}
            </p>
            <LockList
              locks={oldStake?.tapeLocks ?? []}
              zh={zh}
              busy={busy}
              empty={zh ? "没有以前的 TAPE 锁仓。" : "No earlier TAPE lock."}
              onTake={(index) =>
                run(
                  () => unstakeOldTape(account ?? "", index),
                  zh ? "到期本金已取回。" : "Expired principal is back.",
                  "term",
                  "stake",
                )
              }
            />
            <button
              type="button"
              disabled={busy || !oldStake || oldStake.bemOwed === 0n}
              className="mt-2 h-10 border border-gold px-3 text-sm disabled:opacity-40"
              onClick={() =>
                run(
                  () => claimOldBem(account ?? ""),
                  zh ? "BEM 已领取。" : "BEM claimed.",
                  "term",
                  "stake",
                )
              }
            >
              {zh ? "领以前的 BEM" : "Claim earlier BEM"}
            </button>
          </div>
          <div>
            <p className="text-xs text-ink/60">
              {zh ? "BEM 本金。到期才能取回。" : "BEM principal. Take it only after the date."}
            </p>
            <LockList
              locks={oldStake?.bemLocks ?? []}
              zh={zh}
              busy={busy}
              empty={zh ? "没有以前的 BEM 锁仓。" : "No earlier BEM lock."}
              onTake={(index) =>
                run(
                  () => unstakeOldBem(account ?? "", index),
                  zh ? "到期本金已取回。" : "Expired principal is back.",
                  "term",
                  "stake",
                )
              }
            />
            <button
              type="button"
              disabled={busy || !oldStake || oldStake.tapeOwed === 0n}
              className="mt-2 h-10 border border-gold px-3 text-sm disabled:opacity-40"
              onClick={() =>
                run(
                  () => claimOldTape(account ?? ""),
                  zh ? "TAPE 已领取。" : "TAPE claimed.",
                  "term",
                  "stake",
                )
              }
            >
              {zh ? "领以前的 TAPE" : "Claim earlier TAPE"}
            </button>
          </div>
        </div>
      </details>
      <div className="grid gap-3 lg:grid-cols-2">
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">
            {zh ? "质押 TAPE，领 BEM" : "Stake TAPE, earn BEM"}
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Figure
              k={zh ? "可质押" : "Available"}
              v={
                !account
                  ? zh
                    ? "未登入"
                    : "Sign in"
                  : stake
                    ? `${deskText(stake.tapeBal, 8)} TAPE`
                    : row
                      ? `${deskText(row.tapeBal, 8)} TAPE`
                      : "—"
              }
            />
            <Figure
              k={zh ? "已质押" : "Staked"}
              v={
                !account
                  ? zh
                    ? "未登入"
                    : "Sign in"
                  : stake
                    ? `${deskText(stake.tapeStaked, 8)} TAPE`
                    : "—"
              }
              sub={
                zh
                  ? `全池 ${stake ? deskText(stake.tapeStakedTotal, 8) : "—"} TAPE`
                  : `Pool ${stake ? deskText(stake.tapeStakedTotal, 8) : "—"} TAPE`
              }
            />
          </div>
          <div className="mt-3 grid gap-2">
            <p className="text-xs text-ink/70">
              {zh
                ? "你的锁仓。到期前按钮是「未到期」。到期后变成「取回本金」。领取只领奖励，不退本金。"
                : "Your locks. The button stays locked until expiry, then it becomes Take principal. Claim pays rewards only, not principal."}
            </p>
            <LockList
              locks={stake?.tapeLocks ?? []}
              zh={zh}
              busy={busy || !term}
              empty={
                zh
                  ? !account
                    ? "登入后显示你已经质押的。"
                    : stake && stake.tapeStaked > 0n
                      ? "本金已记上。锁仓明细这一次没列出来。"
                      : term
                        ? "你还没有锁仓。"
                        : "部署之后记在这里。"
                  : !account
                    ? "Shown after sign-in."
                    : stake && stake.tapeStaked > 0n
                      ? "Principal is recorded. The lock rows missed this read."
                      : term
                        ? "You have no lock yet."
                        : "Shown after deploy."
              }
              onTake={(index) =>
                run(
                  () => unstakeTermTape(account ?? "", index),
                  zh ? "到期本金已取回。" : "Expired principal is back.",
                  "term",
                  "stake",
                )
              }
            />
          </div>
          <p className="mt-2 text-sm leading-6">
            {zh
              ? "可质押是这个钱包里的 TAPE。已质押是你已经锁上的本金。全池不需要登入也能看见。"
              : "Available is the TAPE in this wallet. Staked is the principal you already locked. The pool total does not need a sign-in."}
          </p>
          <p className="mt-2 text-sm">
            {zh ? "年化" : "APY"}{" "}
            <span className="font-mono">
              {tapeApy === "—"
                ? stake && stake.tapeStakedTotal > 0n
                  ? zh
                    ? "价格没读到"
                    : "Price missed"
                  : zh
                    ? "还没有质押本金，现在算不出来"
                    : "No principal yet"
                : `${tapeApy}%`}
            </span>
          </p>
          <p className="mt-1 text-xs leading-5">
            {zh
              ? `未分完 ${stake ? deskText(stake.bemPot, 8) : "—"} BEM。待领 ${stake ? deskText(stake.bemOwed, 8) : "—"} BEM。你还没分完的奖励 ${stake ? deskText(stake.bemSponsor, 8) : "—"} BEM。`
              : `Unvested ${stake ? deskText(stake.bemPot, 8) : "—"} BEM. Pending ${stake ? deskText(stake.bemOwed, 8) : "—"} BEM. Your unvested reward ${stake ? deskText(stake.bemSponsor, 8) : "—"} BEM.`}
          </p>
          {stakeMiss ? (
            <p className="mt-1 text-xs text-ink/55">
              {zh
                ? "期限这一次没读到。不写成 0。"
                : "This stake read missed. It is not shown as zero."}
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {TERMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`min-h-11 px-1 text-sm ${tapeTerm === item.id ? "bg-ink text-paper" : "border border-gold"}`}
                onClick={() => {
                  setTapeTerm(item.id);
                  setTapeAck(false);
                }}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/55">
            {zh ? `同时未到期 ${openTape}/16` : `Open locks ${openTape}/16`}
          </p>
          <div className="mt-3 grid gap-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={tapeAmt}
                onChange={(event) => setTapeAmt(event.target.value)}
                inputMode="decimal"
                placeholder={zh ? "锁入 TAPE 数量" : "TAPE to lock"}
                className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm"
              />
              <button
                type="button"
                disabled={!stake || stake.tapeBal === 0n}
                className="min-h-12 border border-gold px-3 text-sm disabled:opacity-40"
                onClick={() => setTapeAmt(stake ? formatUnits(stake.tapeBal, 8) : "")}
              >
                {zh ? "全部" : "All"}
              </button>
            </div>
            <p className="text-xs leading-5 text-ink/70">
              {zh
                ? "填数量，或点全部。不会按可质押自动锁定。要签两笔：第一笔授权，币还在钱包；第二笔才锁上。"
                : "Enter an amount, or tap All. It does not lock the available balance by itself. Two signatures: approve first; the second locks."}
            </p>
            <label className="flex min-h-11 items-start gap-2 text-xs leading-5">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0"
                checked={tapeAck}
                onChange={(event) => setTapeAck(event.target.checked)}
              />
              <span>
                {zh
                  ? `我知道这笔 TAPE 锁 ${termLabel(tapeTerm, true)}，到期前不能取回本金。`
                  : `I know this TAPE locks for ${termLabel(tapeTerm, false)}. Principal cannot leave early.`}
              </span>
            </label>
            <button
              type="button"
              disabled={busy || !term}
              className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40"
              onClick={() => lock("tape")}
            >
              {zh ? `质押 ${termLabel(tapeTerm, true)}` : `Stake ${termLabel(tapeTerm, false)}`}
            </button>
            <input
              value={rewardBem}
              onChange={(event) => setRewardBem(event.target.value)}
              inputMode="decimal"
              placeholder={zh ? "这次充入的 BEM" : "BEM to add now"}
              className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <Figure
                k={zh ? "已充入还可取" : "Deposited, still yours"}
                v={stake ? `${deskText(stake.bemSponsor, 8, 8)} BEM` : "—"}
              />
              <Figure
                k={zh ? "待领" : "Claimable"}
                v={stake ? `${deskText(stake.bemOwed, 8, 8)} BEM` : "—"}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy || !term}
                className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40"
                onClick={() =>
                  run(
                    () => fundTermBem(account ?? "", units(rewardBem, 8)),
                    zh ? "BEM 奖励已充入。" : "BEM reward added.",
                    "term",
                    "reward",
                  )
                }
              >
                {zh ? "充奖励" : "Add"}
              </button>
              <button
                type="button"
                disabled={busy || !term || !stake || stake.bemSponsor === 0n}
                className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40"
                onClick={() =>
                  run(
                    () => withdrawTermBem(account ?? "", stake?.bemSponsor ?? 0n),
                    zh
                      ? "能退的 BEM 已取回。已经开始分给质押的那一点留在池子里。"
                      : "The BEM that can be returned is back. The part that already started vesting stays in the pool.",
                    "term",
                    "unvest",
                  )
                }
              >
                {zh ? "取未分完" : "Unvested"}
              </button>
              <button
                type="button"
                disabled={busy || !term || !stake || stake.bemOwed === 0n}
                className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40"
                onClick={() =>
                  run(
                    () => claimTermBem(account ?? ""),
                    zh ? "BEM 已领取。本金还锁着。" : "BEM claimed. Principal stays locked.",
                    "term",
                    "stake",
                  )
                }
              >
                {zh ? "领取" : "Claim"}
              </button>
            </div>
          </div>
        </article>
        <article className="border border-gold bg-card px-3 py-4 sm:px-4">
          <h3 className="font-display text-2xl italic">
            {zh ? "质押 BEM，领 TAPE" : "Stake BEM, earn TAPE"}
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Figure
              k={zh ? "可质押" : "Available"}
              v={
                !account
                  ? zh
                    ? "未登入"
                    : "Sign in"
                  : stake
                    ? `${deskText(stake.bemBal, 8)} BEM`
                    : row
                      ? `${deskText(row.bemBal, 8)} BEM`
                      : "—"
              }
            />
            <Figure
              k={zh ? "已质押" : "Staked"}
              v={
                !account
                  ? zh
                    ? "未登入"
                    : "Sign in"
                  : stake
                    ? `${deskText(stake.bemStaked, 8)} BEM`
                    : "—"
              }
              sub={
                zh
                  ? `全池 ${stake ? deskText(stake.bemStakedTotal, 8) : "—"} BEM`
                  : `Pool ${stake ? deskText(stake.bemStakedTotal, 8) : "—"} BEM`
              }
            />
          </div>
          <div className="mt-3 grid gap-2">
            <p className="text-xs text-ink/70">
              {zh
                ? "你的锁仓。到期后这一行才能取回本金。"
                : "Your locks. Principal can be taken from this row only after expiry."}
            </p>
            <LockList
              locks={stake?.bemLocks ?? []}
              zh={zh}
              busy={busy || !term}
              empty={
                zh
                  ? !account
                    ? "登入后显示你已经质押的。"
                    : stake && stake.bemStaked > 0n
                      ? "本金已记上。锁仓明细这一次没列出来。"
                      : term
                        ? "你还没有锁仓。"
                        : "部署之后记在这里。"
                  : !account
                    ? "Shown after sign-in."
                    : stake && stake.bemStaked > 0n
                      ? "Principal is recorded. The lock rows missed this read."
                      : term
                        ? "You have no lock yet."
                        : "Shown after deploy."
              }
              onTake={(index) =>
                run(
                  () => unstakeTermBem(account ?? "", index),
                  zh ? "到期本金已取回。" : "Expired principal is back.",
                  "term",
                  "stake",
                )
              }
            />
          </div>
          <p className="mt-2 text-sm leading-6">
            {zh
              ? "可质押是这个钱包里的 X Layer BEM。已质押是你已经锁上的本金。BSC 的 BEM 要先过下面的桥，过桥前收千分之二。"
              : "Available is the X Layer BEM in this wallet. Staked is the principal you already locked. BSC BEM crosses on the bridge below. The 0.20% fee is paid first."}
          </p>
          <p className="mt-2 text-sm">
            {zh ? "年化" : "APY"}{" "}
            <span className="font-mono">
              {bemApy === "—"
                ? stake && stake.bemStakedTotal > 0n
                  ? zh
                    ? "价格没读到"
                    : "Price missed"
                  : zh
                    ? "还没有质押本金，现在算不出来"
                    : "No principal yet"
                : `${bemApy}%`}
            </span>
          </p>
          <p className="mt-1 text-xs leading-5">
            {zh
              ? `未分完 ${stake ? deskText(stake.tapePot, 8) : "—"} TAPE。待领 ${stake ? deskText(stake.tapeOwed, 8) : "—"} TAPE。你还没分完的奖励 ${stake ? deskText(stake.tapeSponsor, 8) : "—"} TAPE。`
              : `Unvested ${stake ? deskText(stake.tapePot, 8) : "—"} TAPE. Pending ${stake ? deskText(stake.tapeOwed, 8) : "—"} TAPE. Your unvested reward ${stake ? deskText(stake.tapeSponsor, 8) : "—"} TAPE.`}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {TERMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`min-h-11 px-1 text-sm ${bemTerm === item.id ? "bg-ink text-paper" : "border border-gold"}`}
                onClick={() => {
                  setBemTerm(item.id);
                  setBemAck(false);
                }}
              >
                {zh ? item.zh : item.en}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/55">
            {zh ? `同时未到期 ${openBem}/16` : `Open locks ${openBem}/16`}
          </p>
          <div className="mt-3 grid gap-2">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={bemAmt}
                onChange={(event) => setBemAmt(event.target.value)}
                inputMode="decimal"
                placeholder={zh ? "锁入 BEM 数量" : "BEM to lock"}
                className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm"
              />
              <button
                type="button"
                disabled={!stake || stake.bemBal === 0n}
                className="min-h-12 border border-gold px-3 text-sm disabled:opacity-40"
                onClick={() => setBemAmt(stake ? formatUnits(stake.bemBal, 8) : "")}
              >
                {zh ? "全部" : "All"}
              </button>
            </div>
            <p className="text-xs leading-5 text-ink/70">
              {zh
                ? "填数量，或点全部。不会按可质押自动锁定。要签两笔：第一笔授权，币还在钱包；第二笔才锁上。"
                : "Enter an amount, or tap All. It does not lock the available balance by itself. Two signatures: approve first; the second locks."}
            </p>
            <label className="flex min-h-11 items-start gap-2 text-xs leading-5">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0"
                checked={bemAck}
                onChange={(event) => setBemAck(event.target.checked)}
              />
              <span>
                {zh
                  ? `我知道这笔 BEM 锁 ${termLabel(bemTerm, true)}，到期前不能取回本金。`
                  : `I know this BEM locks for ${termLabel(bemTerm, false)}. Principal cannot leave early.`}
              </span>
            </label>
            <button
              type="button"
              disabled={busy || !term}
              className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40"
              onClick={() => lock("bem")}
            >
              {zh ? `质押 ${termLabel(bemTerm, true)}` : `Stake ${termLabel(bemTerm, false)}`}
            </button>
            <input
              value={rewardTape}
              onChange={(event) => setRewardTape(event.target.value)}
              inputMode="decimal"
              placeholder={zh ? "这次充入的 TAPE" : "TAPE to add now"}
              className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink sm:text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <Figure
                k={zh ? "已充入还可取" : "Deposited, still yours"}
                v={stake ? `${deskText(stake.tapeSponsor, 8, 8)} TAPE` : "—"}
              />
              <Figure
                k={zh ? "待领" : "Claimable"}
                v={stake ? `${deskText(stake.tapeOwed, 8, 8)} TAPE` : "—"}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                disabled={busy || !term}
                className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40"
                onClick={() =>
                  run(
                    () => fundTermTape(account ?? "", units(rewardTape, 8)),
                    zh ? "TAPE 奖励已充入。" : "TAPE reward added.",
                    "term",
                    "reward",
                  )
                }
              >
                {zh ? "充奖励" : "Add"}
              </button>
              <button
                type="button"
                disabled={busy || !term || !stake || stake.tapeSponsor === 0n}
                className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40"
                onClick={() =>
                  run(
                    () => withdrawTermTape(account ?? "", stake?.tapeSponsor ?? 0n),
                    zh
                      ? "能退的 TAPE 已取回。已经开始分给质押的那一点留在池子里。"
                      : "The TAPE that can be returned is back. The part that already started vesting stays in the pool.",
                    "term",
                    "unvest",
                  )
                }
              >
                {zh ? "取未分完" : "Unvested"}
              </button>
              <button
                type="button"
                disabled={busy || !term || !stake || stake.tapeOwed === 0n}
                className="min-h-12 border border-gold px-1 text-sm disabled:opacity-40"
                onClick={() =>
                  run(
                    () => claimTermTape(account ?? ""),
                    zh ? "TAPE 已领取。本金还锁着。" : "TAPE claimed. Principal stays locked.",
                    "term",
                    "stake",
                  )
                }
              >
                {zh ? "领取" : "Claim"}
              </button>
            </div>
          </div>
          <OfficialBridge
            account={account}
            zh={zh}
            xBem={stake ? stake.bemBal : row ? row.bemBal : null}
          />
        </article>
      </div>
      <p className="text-xs leading-5 text-ink/55">
        {zh
          ? "年化按现在还没分完的奖励、365 天分完、池子现价来算。TAPE 用 TAPE/USDT0，BEM 用 BSC 池子价，X Layer 的 BEM 按 1:1。有人再质押，或取走还没分完的奖励，这个数就变。价格没读到写成 —，不写成 0。不是承诺。到期时间是新加坡时间。签名停在这一页。"
          : "APY assumes the unvested pot pays out over 365 days at the current pool price. TAPE uses TAPE/USDT0. BEM uses the BSC pool, and X Layer BEM is counted 1:1. It changes when someone stakes or takes unvested rewards back. A missing price is —, not zero. It is not a promise. Unlock times are Singapore. Signing stays on this page."}
      </p>
      {note ? (
        <p className={`break-all text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p>
      ) : null}
    </section>
  );
}
