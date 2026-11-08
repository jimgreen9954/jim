import { useEffect, useState } from "react";
import { formatUnits, type Hex } from "viem";
import { tapeText, readTapePace } from "@/lib/tape-mine";
import { usdtText } from "@/lib/tape-spot";
import { poolBalances, poolText } from "@/lib/tape-open-swap";
import { Kline, type Bar } from "@/components/exchange/kline";
import { PhoneChrome, wantedPane, type PhonePane } from "@/components/exchange/phone-desk";
import { CoinMark } from "@/components/exchange/coin-mark";
import { SpotStats } from "@/components/exchange/spot-stats";
import { PairChevron } from "@/components/exchange/pair-chevron";
import type { DeskView } from "@/components/exchange/desk-chrome";
import { currentAccount, onAccount } from "@/lib/wallet";
import { connectXLayer } from "@/lib/xlayer";
import {
  cancelShare,
  claimSplitMany,
  hashDayUsd,
  hashYield,
  forgetSplitPieces,
  listSplitPieces,
  peekSplitPieces,
  placeShare,
  readAllShareBooks,
  readShareOrders,
  readShareSeats,
  readSplit,
  sharePrice,
  shareSize,
  transferShare,
  type ShareLevel,
  type ShareSeat,
  type SplitPiece,
} from "@/lib/circuit-split";

function cutTape(amount: bigint): string {
  const [whole, frac = ""] = tapeText(amount).split(".");
  const tail = frac.slice(0, 4).replace(/0+$/, "");
  return tail ? `${whole}.${tail}` : whole;
}

function Note({ zh }: { zh: boolean }) {
  return (
    <div className="mt-3 grid gap-2 text-xs leading-5 text-ink/60">
      <p>
        {zh
          ? "算力是电路拆分后的份额。1 份等于 1 点算力，登记在持有地址，可以转让，也可以在现货买卖。"
          : "Hashrate is the shares of a split circuit. One share is one point, recorded on the holder’s address. It can be transferred or traded on the spot."}
      </p>
      <p>
        {zh
          ? "份额记入你的地址后，TAPE 立即开始计提。随时可领，不必等到次日。"
          : "TAPE starts accruing as soon as the shares are in your address. Claim any time. No need to wait until the next day."}
      </p>
      <p>
        {zh
          ? "卖出或转出的份额立即停止计提。已计提、尚未领取的 TAPE 留在原地址，没有期限。"
          : "Shares you sell or transfer stop accruing at once. Accrued TAPE not yet claimed stays on the original address, with no deadline."}
      </p>
    </div>
  );
}

export function HashClaim({ zh, account }: { zh: boolean; account: string | null }) {
  const [seats, setSeats] = useState<ShareSeat[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [tick, setTick] = useState(0);
  const [miss, setMiss] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!account) {
      setSeats([]);
      return;
    }
    let dead = false;
    listSplitPieces()
      .then((pieces) => readShareSeats(account, pieces))
      .then((rows) => {
        if (!dead) {
          setSeats(rows);
          setMiss(false);
        }
      })
      .catch(() => {
        if (!dead) {
          setSeats([]);
          setMiss(true);
        }
      });
    return () => {
      dead = true;
    };
  }, [account, tick]);

  const due = seats.filter((seat) => seat.pending > 0n);
  const chosen = due.filter((seat) => picked[seat.id] !== false);
  const allOn = due.length > 0 && due.every((seat) => picked[seat.id] !== false);

  const claim = (ids: string[]) => {
    if (!account || ids.length === 0) return;
    setBusy(true);
    setBad(false);
    setNote(ids.length > 1 ? (zh ? "签完这一笔，再签下一笔。" : "Sign this one, then the next.") : "");
    claimSplitMany(
      account,
      ids.map((id) => BigInt(id)),
    )
      .then(() => {
        setNote(zh ? (ids.length > 1 ? `已领 ${ids.length} 笔。` : "领取已提交。") : ids.length > 1 ? `Claimed ${ids.length}.` : "Claim sent.");
        setTick((n) => n + 1);
      })
      .catch((err: unknown) => {
        const done = err && typeof err === "object" && "done" in err ? Number((err as { done?: number }).done) : 0;
        setBad(true);
        setNote(
          done > 0
            ? zh
              ? `已领 ${done} 笔，后面没签。`
              : `${done} claimed. The rest was not signed.`
            : zh
              ? "没有领走。"
              : "Not claimed.",
        );
        if (done > 0) setTick((n) => n + 1);
      })
      .finally(() => setBusy(false));
  };

  const pending = seats.reduce((sum, seat) => sum + seat.pending, 0n);

  return (
    <article className="order-1 flex min-w-0 flex-col earn-hash md:order-2">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <p className="text-[11px] tracking-[0.16em] text-ink/40">X LAYER</p>
          <h2 className="mt-1 text-lg font-medium">{zh ? "算力 TAPE" : "Hashrate TAPE"}</h2>
          <span className="earn-kicker earn-kicker-hash mt-2">HASH</span>
        </div>
        <div className="text-right">
          <p className="text-[10px] tracking-wide text-ink/40">{zh ? "可领" : "Pending"}</p>
          <p className="font-mono text-2xl leading-none tabular-nums text-up">{account ? cutTape(pending) : "—"}</p>
          <p className="mt-1 text-[11px] text-ink/40">TAPE</p>
        </div>
      </div>
      <p className="px-4 pt-2 text-xs leading-5 text-ink/50">
        {zh ? "勾选份额，一次领所选。多张各签一笔，上一笔完成再签下一笔。" : "Select the shares and claim those, or claim one. Each circuit is its own signature."}
      </p>
      <div className="flex items-center justify-between px-4 pt-3 text-xs text-ink/45">
        <span>
          {account
            ? zh
              ? `${due.length} 笔可领 · 已选 ${chosen.length}`
              : `${due.length} pending · ${chosen.length} selected`
            : zh
              ? "连上后显示份额"
              : "Connect to see shares"}
        </span>
        {due.length > 0 ? (
          <button
            type="button"
            className="underline"
            onClick={() => setPicked(Object.fromEntries(due.map((seat) => [seat.id, !allOn])))}
          >
            {allOn ? (zh ? "取消全选" : "Clear") : zh ? "全选" : "All"}
          </button>
        ) : null}
      </div>
      <ul className="mx-4 mt-2 max-h-72 overflow-auto border border-gold/30">
        {!account ? (
          <li className="px-3 py-4 text-sm text-ink/50">{zh ? "连上钱包后读你的算力。" : "Connect to read your hashrate."}</li>
        ) : seats.length === 0 ? (
          <li className="px-3 py-4 text-sm text-ink/50">
            {miss
              ? zh
                ? "名单这次没读到。刷新后再看，不要当成没有算力。"
                : "The list did not load. Refresh before treating it as empty."
              : zh
                ? "这个地址还没有算力份额。"
                : "This address has no shares yet."}
          </li>
        ) : (
          seats.map((seat) => {
            const leftover = seat.shares === 0n && seat.pending > 0n;
            const on = seat.pending > 0n && picked[seat.id] !== false;
            return (
              <li key={seat.id} className="flex items-center justify-between gap-3 border-t border-gold/25 px-3 py-2.5 first:border-t-0">
                <label className="flex min-w-0 items-center gap-2">
                  {seat.pending > 0n ? (
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setPicked((prev) => ({ ...prev, [seat.id]: !on }))}
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block font-mono text-sm">#{seat.id}</span>
                    <span className="text-[11px] text-ink/45">
                      {leftover ? (zh ? "只剩可领" : "Claim only") : `${seat.shares.toLocaleString("en-US")} / ${seat.supply.toLocaleString("en-US")}`}
                    </span>
                  </span>
                </label>
                <span className="text-right">
                  <p className="font-mono text-sm tabular-nums">{cutTape(seat.pending)}</p>
                  <button
                    type="button"
                    disabled={busy || seat.pending === 0n}
                    className="mt-1 min-h-8 px-1 text-xs text-ink/55 underline disabled:opacity-40"
                    onClick={() => claim([seat.id])}
                  >
                    {zh ? "只领这笔" : "This one"}
                  </button>
                </span>
              </li>
            );
          })
        )}
      </ul>
      {account && due.length > 0 ? (
        <div className="mt-auto p-4">
          <button
            type="button"
            disabled={busy || chosen.length === 0}
            className="min-h-11 w-full border border-[#c6a15a] bg-ink text-sm text-paper disabled:opacity-40"
            onClick={() => claim(chosen.map((seat) => seat.id))}
          >
            {zh ? `领取算力 TAPE · ${chosen.length}` : `Claim hash TAPE · ${chosen.length}`}
          </button>
        </div>
      ) : null}
      <div className="px-4 pb-4">
        <Note zh={zh} />
      </div>
      {note ? <p className={`px-4 py-3 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </article>
  );
}

export function HashWallet({ zh, account }: { zh: boolean; account: string | null }) {
  const [seats, setSeats] = useState<ShareSeat[]>([]);
  const [to, setTo] = useState<Record<string, string>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<"load" | "ok" | "miss">("load");

  useEffect(() => {
    if (!account) {
      setSeats([]);
      setPhase("ok");
      return;
    }
    let dead = false;
    const pull = () => {
      listSplitPieces()
        .then((pieces) => readShareSeats(account, pieces))
        .then((rows) => {
          if (dead) return;
          setSeats(rows.filter((row) => row.shares > 0n || row.pending > 0n));
          setPhase("ok");
        })
        .catch(() => {
          if (!dead) setPhase((cur) => (cur === "ok" ? "ok" : "miss"));
        });
    };
    pull();
    const id = window.setInterval(pull, 8000);
    const onSplit = () => {
      forgetSplitPieces();
      pull();
    };
    window.addEventListener("tape-split", onSplit);
    return () => {
      dead = true;
      window.clearInterval(id);
      window.removeEventListener("tape-split", onSplit);
    };
  }, [account, tick]);

  const send = (seat: ShareSeat) => {
    if (!account) return;
    let amount = 0n;
    try {
      amount = shareSize(qty[seat.id] ?? "");
    } catch {
      setBad(true);
      setNote(zh ? "份数用整数。" : "Shares are a whole number.");
      return;
    }
    if (amount > seat.shares) {
      setBad(true);
      setNote(zh ? "份数超过你持有的。" : "That is more than you hold.");
      return;
    }
    setBusy(true);
    setBad(false);
    setNote("");
    transferShare(account, BigInt(seat.id), (to[seat.id] ?? "").trim(), amount)
      .then(() => {
        setNote(zh ? "转账已提交。还没领的 TAPE 留在这个地址，到赚取里领。" : "Sent. Unclaimed TAPE stays here. Claim it under Earn.");
        setTick((n) => n + 1);
      })
      .catch(() => {
        setBad(true);
        setNote(zh ? "没转出去。地址要是别的钱包，份数不能超过持有。" : "Not sent. Use another wallet, and not more than you hold.");
      })
      .finally(() => setBusy(false));
  };

  if (!account) return <p className="border border-gold px-4 py-3 text-sm text-ink/60">{zh ? "先连接钱包。" : "Connect a wallet."}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs leading-5 text-ink/55">
        {zh
          ? "点开这一项，填接收地址和份数。转出的是算力，已经记下的 TAPE 仍留在这里。"
          : "Open the row, then give an address and a number of shares. TAPE already earned stays here."}
      </p>
      {phase === "load" ? (
        <p className="border border-gold px-4 py-3 text-sm text-ink/60">{zh ? "正在读这个地址的算力。" : "Reading this address."}</p>
      ) : seats.length === 0 ? (
        <p className="border border-gold px-4 py-3 text-sm text-ink/60">
          {phase === "miss"
            ? zh
              ? "名单这次没读到。过几秒会再读，不要当成没有算力。"
              : "The list missed. It tries again in a few seconds."
            : zh
              ? "这个地址没有电路算力。"
              : "No circuit hashrate here."}
        </p>
      ) : null}
      {seats.map((seat) => (
        <article key={seat.id} className="border border-gold px-4 py-3">
          <p className="font-mono text-sm">
            #{seat.id} · {seat.shares.toLocaleString("en-US")} {zh ? "份" : "shares"}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
            <input
              value={to[seat.id] ?? ""}
              onChange={(event) => setTo((cur) => ({ ...cur, [seat.id]: event.target.value }))}
              placeholder={zh ? "接收地址" : "Recipient"}
              className="h-11 border border-gold bg-card px-2 font-mono text-xs outline-none"
            />
            <input
              value={qty[seat.id] ?? ""}
              onChange={(event) => setQty((cur) => ({ ...cur, [seat.id]: event.target.value }))}
              inputMode="numeric"
              placeholder={zh ? "份数" : "Shares"}
              className="h-11 border border-gold bg-card px-2 font-mono text-sm outline-none"
            />
            <button type="button" disabled={busy} className="min-h-11 bg-ink px-3 text-sm text-paper disabled:opacity-40" onClick={() => send(seat)}>
              {zh ? "转出" : "Send"}
            </button>
          </div>
        </article>
      ))}
      {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </div>
  );
}

export function HashSpot({
  zh,
  onMarkets,
  onJump,
}: {
  zh: boolean;
  onMarkets?: () => void;
  onJump?: (view: DeskView) => void;
}) {
  const [account, setAccount] = useState<string | null>(null);
  const [pieces, setPieces] = useState<SplitPiece[]>(() => peekSplitPieces());
  const [mine, setMine] = useState<ShareSeat[]>([]);
  const [id, setId] = useState("80");
  const [bids, setBids] = useState<ShareLevel[]>([]);
  const [asks, setAsks] = useState<ShareLevel[]>([]);
  const [held, setHeld] = useState<bigint | null>(null);
  const [orders, setOrders] = useState<bigint[]>([]);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [tick, setTick] = useState(0);
  const [phone, setPhone] = useState<PhonePane>(wantedPane());
  const [frame, setFrame] = useState("1h");
  const [mode, setMode] = useState<"market" | "limit" | "chase" | "scale" | "twap">("market");
  const [menu, setMenu] = useState(false);
  const [pairMenu, setPairMenu] = useState(false);
  const [tab, setTab] = useState<"book" | "tape">("book");
  const [dock, setDock] = useState<"bal" | "rest" | "twap" | "chase" | "fills">("bal");
  const [hideDust, setHideDust] = useState(false);
  const [pct, setPct] = useState(0);
  const [bal, setBal] = useState<{ bem: bigint; okb: bigint; tape: bigint; usdt: bigint } | null>(null);
  const [bars, setBars] = useState<Bar[]>([]);
  const [chase, setChase] = useState("");
  const [pace, setPace] = useState<{ daily: bigint; weight: bigint } | null>(null);
  const [scaleA, setScaleA] = useState("");
  const [scaleB, setScaleB] = useState("");
  const [scaleN, setScaleN] = useState(4);

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    const now = currentAccount();
    if (now) setAccount(now);
  }, []);
  useEffect(() => {
    const chart = () => setPhone("chart");
    const trade = () => setPhone("ticket");
    window.addEventListener("tape-chart", chart);
    window.addEventListener("tape-trade", trade);
    return () => {
      window.removeEventListener("tape-chart", chart);
      window.removeEventListener("tape-trade", trade);
    };
  }, []);
  useEffect(() => {
    let dead = false;
    const pull = () => {
      listSplitPieces()
        .then(async (rows) => {
          if (dead) return;
          setPieces(rows);
          setId((cur) => (rows.some((row) => row.id === cur) ? cur : rows[0]?.id ?? cur));
          const who = currentAccount();
          if (!who) {
            setMine([]);
            return;
          }
          const seats = await readShareSeats(who, rows);
          if (!dead) setMine(seats.filter((row) => row.shares > 0n));
        })
        .catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 8000);
    const onSplit = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      forgetSplitPieces();
      if (next) setId(String(next));
      pull();
    };
    window.addEventListener("tape-split", onSplit);
    return () => {
      dead = true;
      window.clearInterval(id);
      window.removeEventListener("tape-split", onSplit);
    };
  }, [tick]);

  useEffect(() => {
    let dead = false;
    readTapePace()
      .then((row) => {
        if (!dead) setPace(row);
      })
      .catch(() => {
        if (!dead) setPace(null);
      });
    return () => {
      dead = true;
    };
  }, [tick]);

  useEffect(() => {
    if (!/^\d+$/.test(id)) return;
    let dead = false;
    const token = BigInt(id);
    const pull = () => {
      if (!account) {
        setHeld(null);
        setOrders([]);
        setBal(null);
        return;
      }
      readSplit(token, account)
        .then((row) => {
          if (!dead) setHeld(row.shares);
        })
        .catch(() => {
          if (!dead) setHeld(null);
        });
      readShareOrders(account)
        .then((ids) => {
          if (!dead) setOrders(ids);
        })
        .catch(() => {
          if (!dead) setOrders([]);
        });
      poolBalances(account as Hex)
        .then((row) => {
          if (!dead) setBal(row);
        })
        .catch(() => {
          if (!dead) setBal(null);
        });
    };
    pull();
    const timer = window.setInterval(pull, 8000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [id, account, tick]);

  useEffect(() => {
    if (pieces.length === 0) return;
    let dead = false;
    const pull = () => {
      readAllShareBooks(pieces)
        .then((book) => {
          if (dead) return;
          setBids(book.bids);
          setAsks(book.asks);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 3000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [pieces]);

  const askView = [...asks].reverse();
  const bestAsk = asks[0]?.price ?? 0n;
  const bestBid = bids[0]?.price ?? 0n;
  const buyId = asks[0]?.id || id;
  const sellId = (() => {
    const heldIds = new Set(mine.filter((row) => row.shares > 0n).map((row) => row.id));
    return bids.find((row) => heldIds.has(row.id))?.id || mine.find((row) => row.shares > 0n)?.id || id;
  })();
  const midN =
    bestAsk > 0n && bestBid > 0n
      ? Number(formatUnits((bestAsk + bestBid) / 2n, 6))
      : bestAsk > 0n
        ? Number(formatUnits(bestAsk, 6))
        : bestBid > 0n
          ? Number(formatUnits(bestBid, 6))
          : 0;
  useEffect(() => {
    if (!(midN > 0)) return;
    setBars((rows) => {
      const now = Math.floor(Date.now() / 60_000) * 60;
      const last = rows[rows.length - 1];
      if (!last || last.t !== now) {
        const open = last?.c ?? midN;
        return [...rows, { t: now, o: open, h: Math.max(open, midN), l: Math.min(open, midN), c: midN, v: 0 }].slice(-240);
      }
      const next = rows.slice();
      next[next.length - 1] = { ...last, h: Math.max(last.h, midN), l: Math.min(last.l, midN), c: midN };
      return next;
    });
  }, [midN]);

  let typed = 0n;
  if (price.trim()) {
    try {
      typed = sharePrice(price);
    } catch {
      typed = 0n;
    }
  }
  const dayUsd = pace ? hashDayUsd(pace.daily, pace.weight) : 0n;
  const yieldPrice = (() => {
    if (side !== "buy") return 0n;
    if ((mode === "limit" || mode === "scale") && typed > 0n) return typed;
    if (bestAsk > 0n) return bestAsk;
    return 0n;
  })();
  const yieldAt = hashYield(yieldPrice, dayUsd);
  const maxAsk = asks.reduce((n, row) => (row.size > n ? row.size : n), 1n);
  const maxBid = bids.reduce((n, row) => (row.size > n ? row.size : n), 1n);
  const money = (n: number) =>
    !(n > 0) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 6 });
  const pxText = (amount: bigint) => (amount > 0n ? money(Number(formatUnits(amount, 6))) : "—");

  const run = async (act: () => Promise<unknown>, ok: string) => {
    if (!account) {
      setBad(true);
      setNote(zh ? "先连接钱包。" : "Connect a wallet.");
      return;
    }
    setBusy(true);
    setBad(false);
    setNote("");
    try {
      await act();
      setNote(ok);
      setTick((n) => n + 1);
    } catch (error) {
      setBad(true);
      const name = error instanceof Error ? error.message : "";
      setNote(
        name === "fee"
          ? zh
            ? "这一档太小，手续费会变成 0。"
            : "That order is too small. The fee rounds to zero."
          : name === "funds"
            ? zh
              ? "USDT0 不够付这一笔，含 0.20% 费用。"
              : "Not enough USDT0 for this order, including the 0.20% fee."
            : name === "shares"
              ? zh
                ? "份数超过你持有的。"
                : "That is more shares than you hold."
              : zh
                ? "没发出去。看一下钱包是否在 X Layer，以及余额够不够。"
                : "Not sent. Check that the wallet is on X Layer and the balance covers it.",
      );
    } finally {
      setBusy(false);
    }
  };

  const fillPct = (next: number) => {
    setPct(next);
    if (side === "sell") {
      if (held == null) return;
      const cut = (held * BigInt(next)) / 100n;
      setSize(cut > 0n ? cut.toString() : "");
      return;
    }
    const px = typed > 0n ? typed : bestAsk;
    if (px <= 0n || !bal || next === 0) {
      if (next === 0) setSize("");
      return;
    }
    const budget = (bal.usdt * BigInt(next)) / 100n;
    const qty = budget / px;
    setSize(qty > 0n ? qty.toString() : "");
  };

  const sendOrder = () => {
    let qty = 0n;
    try {
      qty = shareSize(size);
    } catch {
      setBad(true);
      setNote(zh ? "数量用整数份。" : "Size is a whole number of shares.");
      return;
    }
    const bookPx = side === "buy" ? bestAsk : (bids.find((row) => row.id === sellId)?.price ?? (bestBid > 0n ? bestBid : bestAsk));
    const chasePx = (() => {
      const raw = Number(chase);
      if (!(raw > 0) || !(midN > 0)) return bookPx;
      const moved = midN * (1 + (side === "buy" ? raw : -raw) / 100);
      try {
        return sharePrice(moved.toFixed(6));
      } catch {
        return bookPx;
      }
    })();
    if (mode === "scale") {
      let a = 0n;
      let b = 0n;
      try {
        a = sharePrice(scaleA);
        b = sharePrice(scaleB);
      } catch {
        setBad(true);
        setNote(zh ? "分段要两个价格。" : "Scale needs two prices.");
        return;
      }
      const n = Math.min(8, Math.max(2, scaleN));
      const each = qty / BigInt(n);
      if (each < 1n) {
        setBad(true);
        setNote(zh ? "份数不够拆成这几档。" : "Not enough shares to split.");
        return;
      }
      void run(async () => {
        for (let i = 0; i < n; i += 1) {
          const px = a + ((b - a) * BigInt(i)) / BigInt(n - 1);
          await placeShare(account ?? "", BigInt(id), side === "buy", px, each);
        }
      }, zh ? "分段已提交。" : "Scale sent.");
      return;
    }
    const px = mode === "market" || mode === "twap" ? bookPx : mode === "chase" ? chasePx : typed;
    if (px <= 0n) {
      setBad(true);
      setNote(zh ? "先在限价里填一个价格。" : "Enter a limit price first.");
      return;
    }
    const tokenId = mode === "market" || mode === "twap" ? (side === "buy" ? buyId : sellId) : id;
    const owned = mine.find((row) => row.id === tokenId)?.shares ?? (tokenId === id ? held : null);
    if (side === "sell" && owned != null && qty > owned) {
      setBad(true);
      setNote(zh ? "份数超过你持有的。" : "That is more shares than you hold.");
      return;
    }
    const gross = px * qty;
    const fee = (gross * 20n) / 10_000n;
    if (side === "buy" && bal && gross + fee > bal.usdt) {
      setBad(true);
      setNote(
        zh
          ? `要 ${usdtText(gross + fee, 4)} USDT0，钱包里是 ${usdtText(bal.usdt, 4)}。`
          : `This needs ${usdtText(gross + fee, 4)} USDT0. The wallet has ${usdtText(bal.usdt, 4)}.`,
      );
      return;
    }
    void run(
      () => placeShare(account ?? "", BigInt(tokenId), side === "buy", px, qty),
      zh ? `委托已挂到 #${tokenId}。` : `The order is on #${tokenId}.`,
    );
  };

  const pay = (() => {
    let qty = 0n;
    try {
      qty = shareSize(size);
    } catch {
      return 0n;
    }
    const px = mode === "market" || mode === "twap" ? (side === "buy" ? bestAsk : bestBid) : typed > 0n ? typed : 0n;
    return px > 0n ? px * qty : 0n;
  })();
  const spread = bestAsk > bestBid && bestBid > 0n ? bestAsk - bestBid : 0n;
  const proLabel = mode === "chase" ? (zh ? "追价" : "Chase") : mode === "scale" ? (zh ? "分段" : "Scale") : mode === "twap" ? "TWAP" : zh ? "专业" : "Pro";
  const frames = [
    ["15s", "15秒", "15s"],
    ["1m", "1分", "1m"],
    ["5m", "5分", "5m"],
    ["15m", "15分", "15m"],
    ["1h", "1时", "1h"],
    ["4h", "4时", "4h"],
    ["1d", "1日", "1d"],
    ["1w", "一周", "1w"],
    ["1M", "一月", "1M"],
    ["3M", "三月", "3M"],
    ["1y", "一年", "1y"],
  ] as const;

  return (
    <section className="phone-desk spot-split min-w-0 overflow-hidden border border-gold bg-card" data-phone={phone}>
      <div className="relative flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-gold px-3 py-2">
        <button type="button" onClick={() => setPairMenu((on) => !on)} className="flex min-w-0 items-center gap-2">
          <CoinMark id="tape" />
          <span className="truncate text-lg font-medium tracking-tight">TAPE算力/USDT0</span>
          <PairChevron up={pairMenu} />
          <span className="lev-chip shrink-0 rounded px-1.5 py-0.5 text-[11px]">{zh ? "现货" : "Spot"}</span>
        </button>
        {pairMenu ? (
          <div className="absolute left-2 top-12 z-30 w-52 border border-gold bg-card shadow-plate">
            <p className="px-3 pt-2 text-[10px] text-ink/40">{zh ? "热门" : "Hot"}</p>
            <button type="button" className="block h-10 w-full px-3 text-left text-sm hover:bg-foil/70" onClick={() => { setPairMenu(false); onJump?.({ kind: "pancake", pair: "bem" }); }}>BEM/USDT</button>
            <button type="button" className="block h-10 w-full px-3 text-left text-sm hover:bg-foil/70" onClick={() => { setPairMenu(false); onJump?.({ kind: "pancake", pair: "upusdt" }); }}>UP/USDT</button>
            <button type="button" className="block h-10 w-full px-3 text-left text-sm hover:bg-foil/70" onClick={() => { setPairMenu(false); onJump?.({ kind: "tape", market: 0, pair: "usdt" }); }}>TAPE/USDT0</button>
            <button type="button" className="block h-10 w-full px-3 text-left text-sm hover:bg-foil/70" onClick={() => { setPairMenu(false); onJump?.({ kind: "pancake", pair: "fab" }); }}>FAB/BEM</button>
            <button type="button" className="block h-10 w-full bg-foil px-3 text-left text-sm" onClick={() => setPairMenu(false)}>TAPE算力/USDT0</button>
            <button type="button" className="block h-10 w-full border-t border-gold/40 px-3 text-left text-sm text-ink/60" onClick={() => { setPairMenu(false); onMarkets?.(); }}>{zh ? "全部市场" : "All markets"}</button>
          </div>
        ) : null}
        <p className="font-mono text-sm">{money(midN)} <span className="text-[11px] text-ink/40">USDT0</span></p>
        <SpotStats
          zh={zh}
          cap={
            midN > 0
              ? pieces.reduce((sum, row) => sum + Number(row.supply) * midN, 0)
              : null
          }
          vol={null}
          capUnit="USDT0"
          volUnit="USDT0"
        />
        <label className="text-[11px] text-ink/45">
          {zh ? "电路编号" : "Circuit"}
          <select className="ml-2 h-7 border border-gold/40 bg-transparent px-1 font-mono text-xs text-ink" value={id} onChange={(event) => setId(event.target.value)}>
            {(pieces.length ? pieces : [{ id, supply: 0n }]).map((row) => (
              <option key={row.id} value={row.id}>#{row.id}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => onJump?.({ kind: "otc", market: 0 })} className="ml-auto hidden h-7 shrink-0 border border-gold/40 px-2 text-xs text-ink/70 xl:inline-flex xl:items-center">OTC</button>
      </div>
      <PhoneChrome
        zh={zh}
        pane={phone}
        setPane={setPhone}
        sheet={false}
        onBuy={() => { setSide("buy"); setPhone("ticket"); }}
        onSell={() => { setSide("sell"); setPhone("ticket"); }}
      />
      <div className="spot-grid grid min-w-0 items-start xl:grid-cols-[minmax(0,1fr)_18rem_20rem]" data-phone={phone}>
        <div className="ph-chart order-1 min-w-0">
          <Kline
            bars={bars}
            mark={midN}
            lang={zh ? "zh" : "en"}
            desk="spot"
            frame={frame}
            frames={frames.map(([key, zhLabel, enLabel]) => ({ id: key, label: zh ? zhLabel : enLabel }))}
            onFrame={setFrame}
            onPrice={(px) => {
              setMode("limit");
              setPrice(px >= 1 ? px.toFixed(4) : px.toFixed(6));
              setPhone("ticket");
            }}
          />
        </div>
        <div className="ph-book order-3 min-w-0 border-t border-gold xl:order-2 xl:border-t-0 xl:border-l">
          <div className="flex h-9 items-center gap-3 border-b border-gold px-3 text-xs">
            <button type="button" onClick={() => setTab("book")} className={tab === "book" ? "tab-on" : "text-ink/45"}>{zh ? "深度" : "Depth"}</button>
            <button type="button" onClick={() => setTab("tape")} className={tab === "tape" ? "tab-on" : "text-ink/45"}>{zh ? "最新成交" : "Trades"}</button>
            <span className="ml-auto text-[10px] text-ink/40">{zh ? "同一本 · 约 3 秒" : "One book · 3s"}</span>
          </div>
          {tab === "book" ? (
            <>
              <div className="spot-book hash-book px-2 py-1 text-[10px] text-ink/40">
                <span>{zh ? "价格" : "Price"}</span>
                <span className="text-right">{zh ? "数量" : "Size"}</span>
                <span className="text-right">{zh ? "电路" : "Circuit"}</span>
                <span className="text-right">{zh ? "合计" : "Total"}</span>
              </div>
              <div className="book-scroll max-h-[28rem] overflow-auto">
                {askView.map((level) => (
                  <button
                    key={`a-${level.id}-${level.price}`}
                    type="button"
                    onClick={() => { setId(level.id); setMode("limit"); setSide("buy"); setPrice(formatUnits(level.price, 6)); setSize(level.size.toString()); setPhone("ticket"); }}
                    className="spot-book hash-book relative overflow-hidden px-2 py-[3px] text-left font-mono text-[12px] hover:bg-white/5"
                  >
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 bg-sell/15" style={{ width: `${Number((level.size * 100n) / maxAsk)}%` }} />
                    <span className="relative text-sell">{pxText(level.price)}</span>
                    <span className="relative text-right text-ink/80">{level.size.toLocaleString("en-US")}</span>
                    <span className="relative text-right text-ink/45">#{level.id}</span>
                    <span className="relative text-right text-ink/45">{pxText(level.price * level.size)}</span>
                  </button>
                ))}
                <p className="border-y border-gold/30 px-2 py-1 font-mono text-sm">
                  {money(midN)}
                  <span className="ml-2 text-[11px] text-ink/40">{spread > 0n ? pxText(spread) : ""}</span>
                </p>
                {bids.map((level) => (
                  <button
                    key={`b-${level.id}-${level.price}`}
                    type="button"
                    onClick={() => { setId(level.id); setMode("limit"); setSide("sell"); setPrice(formatUnits(level.price, 6)); setSize(level.size.toString()); setPhone("ticket"); }}
                    className="spot-book hash-book relative overflow-hidden px-2 py-[3px] text-left font-mono text-[12px] hover:bg-white/5"
                  >
                    <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 bg-up/15" style={{ width: `${Number((level.size * 100n) / maxBid)}%` }} />
                    <span className="relative text-up">{pxText(level.price)}</span>
                    <span className="relative text-right text-ink/80">{level.size.toLocaleString("en-US")}</span>
                    <span className="relative text-right text-ink/45">#{level.id}</span>
                    <span className="relative text-right text-ink/45">{pxText(level.price * level.size)}</span>
                  </button>
                ))}
                {asks.length === 0 && bids.length === 0 ? (
                  <p className="px-2 py-3 text-xs text-ink/45">{zh ? "这一本还没有挂单。挂上去，别人马上能看见。" : "No orders yet. A new one shows up here."}</p>
                ) : null}
              </div>
            </>
          ) : (
            <p className="px-3 py-4 text-xs text-ink/45">{zh ? "成交记在链上，这一本还没有成交带。" : "Fills stay on the chain. This book has no print tape yet."}</p>
          )}
        </div>
        <div className="ph-ticket relative order-2 border-t border-gold p-3 xl:order-3 xl:border-t-0 xl:border-l">
          <div className="grid grid-cols-3 gap-1">
            <button type="button" onClick={() => { setMode("market"); setMenu(false); }} className={`h-10 text-sm ${mode === "market" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zh ? "市价" : "Market"}</button>
            <button type="button" onClick={() => { setMode("limit"); setMenu(false); }} className={`h-10 text-sm ${mode === "limit" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>{zh ? "限价" : "Limit"}</button>
            <button type="button" onClick={() => setMenu((on) => !on)} className={`inline-flex h-10 items-center justify-center gap-1 text-sm ${mode === "chase" || mode === "scale" || mode === "twap" ? "bg-ink" : "border border-gold/40 text-ink/70"}`}>
              {proLabel}
              <PairChevron up={menu} />
            </button>
          </div>
          {menu ? (
            <div className="absolute right-3 z-20 mt-1 w-36 border border-gold bg-card">
              {(
                [
                  ["chase", zh ? "追价" : "Chase"],
                  ["scale", zh ? "分段订单" : "Scale"],
                  ["twap", "TWAP"],
                ] as const
              ).map(([key, label]) => (
                <button key={key} type="button" onClick={() => { setMode(key); setMenu(false); }} className="block h-9 w-full px-3 text-left text-sm hover:bg-white/5">{label}</button>
              ))}
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-2 gap-1">
            <button type="button" onClick={() => setSide("buy")} className={`h-10 text-sm ${side === "buy" ? "bg-ink" : "quiet-buy"}`}>{zh ? "买入" : "Buy"}</button>
            <button type="button" onClick={() => setSide("sell")} className={`h-10 text-sm ${side === "sell" ? "bg-sell text-[#fff7f8]" : "quiet-sell"}`}>{zh ? "卖出" : "Sell"}</button>
          </div>
          <p className="mt-3 font-mono text-lg tabular-nums">{money(midN)} <span className="text-xs text-ink/45">USDT0</span></p>
          {side === "buy" && yieldAt ? (
            <div className="yield-strip">
              <span className="text-[11px] leading-4 text-ink/55">
                {mode === "limit" && typed > 0n
                  ? zh
                    ? "按你填的价"
                    : "At your price"
                  : zh
                    ? "按卖一"
                    : "At the ask"}
                <span className="mt-0.5 block text-[10px] tracking-wide text-ink/40">
                  {zh ? "按当前排放估算" : "From today's emission"}
                </span>
              </span>
              <span className="text-right font-mono text-sm text-up">
                {zh ? `年化 ${yieldAt.apy}%` : `${yieldAt.apy}% / yr`}
                <span className="mt-0.5 block text-[11px] text-ink/70">
                  {zh ? `${yieldAt.days.toLocaleString("en-US")} 天回本` : `${yieldAt.days.toLocaleString("en-US")} days back`}
                </span>
              </span>
            </div>
          ) : null}
          <div className="mt-2 grid grid-cols-2 border border-gold/40 font-mono text-sm">
            <p className="px-2 py-2">
              <span className="block text-[10px] text-ink/45">{zh ? "可用" : "Available"} USDT0</span>
              {bal ? poolText(bal.usdt, 6) : "—"}
            </p>
            <p className="border-l border-gold/40 px-2 py-2">
              <span className="block text-[10px] text-ink/45">{zh ? "可用" : "Available"} {zh ? "算力" : "Shares"}</span>
              {held == null ? "—" : held.toLocaleString("en-US")}
            </p>
          </div>
          {mode === "market" || mode === "twap" ? (
            <p className="mt-2 flex items-center justify-between border border-gold/40 px-2 py-2 font-mono">
              <span className="text-[11px] text-ink/45">{zh ? "价格" : "Price"}</span>
              <span>{money(midN)} <span className="text-[11px] text-ink/40">{side === "buy" ? (zh ? "卖一" : "Ask") : zh ? "买一" : "Bid"}</span></span>
            </p>
          ) : mode === "limit" ? (
            <label className="mt-2 block border border-gold/40 px-2 py-2">
              <span className="text-[11px] text-ink/45">{zh ? "价格" : "Price"}</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className="w-full bg-transparent text-right font-mono text-lg outline-none" />
            </label>
          ) : null}
          {mode === "chase" ? (
            <label className="mt-2 block border border-gold/40 px-2 py-2">
              <span className="text-[11px] text-ink/45">{zh ? "追价 %" : "Chase %"}</span>
              <input value={chase} onChange={(event) => setChase(event.target.value)} inputMode="decimal" className="w-full bg-transparent font-mono text-lg outline-none" />
            </label>
          ) : null}
          {mode === "scale" ? (
            <div className="mt-2 grid grid-cols-2 gap-1">
              <input value={scaleA} onChange={(event) => setScaleA(event.target.value)} inputMode="decimal" placeholder={zh ? "开始" : "Start"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={scaleB} onChange={(event) => setScaleB(event.target.value)} inputMode="decimal" placeholder={zh ? "结束" : "End"} className="h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
              <input value={String(scaleN)} onChange={(event) => setScaleN(Math.min(8, Math.max(2, Number(event.target.value) || 2)))} inputMode="numeric" className="col-span-2 h-10 border border-gold/40 bg-transparent px-2 font-mono outline-none" />
            </div>
          ) : null}
          <label className="mt-2 block border border-gold/40 px-2 py-2">
            <span className="text-[11px] text-ink/45">{zh ? "数量 算力" : "Shares"}</span>
            <input value={size} onChange={(event) => { setSize(event.target.value); setPct(0); }} inputMode="numeric" placeholder={zh ? "输入数量" : "Size"} className="w-full bg-transparent font-mono text-lg outline-none placeholder:text-ink/35" />
          </label>
          <input type="range" min={0} max={100} value={pct} onChange={(event) => fillPct(Number(event.target.value))} className="mt-2 w-full" />
          <div className="mt-1 grid grid-cols-4 gap-1">
            {[25, 50, 75, 100].map((item) => (
              <button key={item} type="button" onClick={() => fillPct(item)} className="h-7 border border-gold/30 font-mono text-[11px] text-ink/60">{item}%</button>
            ))}
          </div>
          <div className="mt-2 space-y-1 font-mono text-[11px] text-ink/55">
            <p className="flex justify-between">
              <span>{side === "buy" ? (zh ? "实付" : "You pay") : zh ? "实收" : "You receive"}</span>
              <span>{pay > 0n ? `${usdtText(pay, 4)} USDT0` : "—"}</span>
            </p>
            <p className="flex justify-between"><span>{zh ? "费用" : "Fee"}</span><span>0.20%</span></p>
          </div>
          <button
            type="button"
            disabled={busy || (!!account && !size.trim())}
            onClick={() => {
              if (!account) {
                setBusy(true);
                connectXLayer()
                  .then((next) => setAccount(next))
                  .catch(() => {
                    setBad(true);
                    setNote(zh ? "钱包没有连上。" : "The wallet did not connect.");
                  })
                  .finally(() => setBusy(false));
                return;
              }
              sendOrder();
            }}
            className={`mt-3 h-11 w-full text-sm disabled:opacity-40 ${side === "buy" ? "bg-ink" : "bg-sell text-[#fff7f8]"}`}
          >
            {busy
              ? zh
                ? "等待钱包"
                : "Waiting"
              : !account
                ? zh
                  ? "连接钱包"
                  : "Connect"
                : !size.trim()
                  ? zh
                    ? "输入数量"
                    : "Enter size"
                  : side === "buy"
                    ? zh
                      ? "买入算力"
                      : "Buy shares"
                    : zh
                      ? "卖出算力"
                      : "Sell shares"}
          </button>
          {note ? <p className={`mt-2 text-xs leading-5 ${bad ? "text-sell" : "text-ink/70"}`}>{note}</p> : null}
        </div>
      </div>
      <div className="border-t border-gold">
        <div className="flex items-center gap-1 overflow-x-auto px-2 pt-1">
          {(
            [
              ["bal", zh ? "余额" : "Balances"],
              ["rest", zh ? `当前委托 (${orders.length})` : `Orders (${orders.length})`],
              ["twap", "TWAP"],
              ["chase", zh ? "追价" : "Chase"],
              ["fills", zh ? "成交" : "Trades"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setDock(key)} className={`h-8 shrink-0 px-2 text-xs ${dock === key ? "tab-on" : "text-ink/45"}`}>{label}</button>
          ))}
          {dock === "bal" ? (
            <label className="ml-auto flex shrink-0 items-center gap-1 px-2 text-[11px] text-ink/45">
              <input type="checkbox" checked={hideDust} onChange={(event) => setHideDust(event.target.checked)} />
              {zh ? "隐藏小额" : "Hide small"}
            </label>
          ) : null}
        </div>
        <div className="min-h-28 overflow-x-auto px-3 py-2 text-xs">
          {dock === "bal" ? (
            <table className="w-full min-w-[32rem] text-left font-mono">
              <thead className="text-[11px] text-ink/40">
                <tr>
                  <th className="py-1 font-normal">{zh ? "资产" : "Asset"}</th>
                  <th className="py-1 font-normal">{zh ? "总余额" : "Total"}</th>
                  <th className="py-1 font-normal">{zh ? "可用余额" : "Available"}</th>
                  <th className="py-1 text-right font-normal">{zh ? "价值" : "Value"}</th>
                </tr>
              </thead>
              <tbody>
                {!account ? (
                  <tr><td colSpan={4} className="py-3 text-ink/55">{zh ? "连接后显示余额" : "Connect to see balances"}</td></tr>
                ) : (
                  [
                    ...(mine.length
                      ? mine.map((seat) => ({
                          sym: zh ? `算力 #${seat.id}` : `Hash #${seat.id}`,
                          total: seat.shares.toLocaleString("en-US"),
                          value:
                            seat.id === id && midN > 0
                              ? `$${(Number(seat.shares) * midN).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                              : "—",
                          dust: seat.shares < 1n,
                        }))
                      : [
                          {
                            sym: zh ? "算力" : "Shares",
                            total: held == null ? "—" : held.toLocaleString("en-US"),
                            value: held != null && midN > 0 ? `$${(Number(held) * midN).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "—",
                            dust: held == null || held < 1n,
                          },
                        ]),
                    { sym: "USDT0", total: bal ? poolText(bal.usdt, 6) : "—", value: bal ? `$${poolText(bal.usdt, 6)}` : "—", dust: !bal || bal.usdt < 1_000_000n },
                    { sym: "TAPE", total: bal ? poolText(bal.tape, 8) : "—", value: "—", dust: !bal || bal.tape < 100_000_000n },
                    { sym: "BEM", total: bal ? poolText(bal.bem, 8) : "—", value: "—", dust: !bal || bal.bem < 100_000_000n },
                    { sym: "OKB", total: bal ? poolText(bal.okb, 18) : "—", value: "—", dust: !bal || bal.okb < 10n ** 15n },
                  ]
                    .filter((row) => !hideDust || !row.dust)
                    .map((row) => (
                      <tr key={row.sym} className="border-t border-gold/20">
                        <td className="py-1.5">{row.sym}</td>
                        <td className="py-1.5">{row.total} {row.sym}</td>
                        <td className="py-1.5">{row.total} {row.sym}</td>
                        <td className="py-1.5 text-right">{row.value}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          ) : null}
          {dock === "rest" ? (
            orders.length === 0 ? (
              <p className="py-3 text-ink/45">{zh ? "没有未成交的委托" : "No open orders"}</p>
            ) : (
              <ul>
                {orders.map((order) => (
                  <li key={order.toString()} className="flex items-center justify-between border-t border-gold/20 py-1.5 font-mono">
                    <span>#{order.toString()}</span>
                    <button type="button" disabled={busy} className="underline disabled:opacity-40" onClick={() => void run(() => cancelShare(account ?? "", order), zh ? "撤单已提交。" : "Cancel sent.")}>{zh ? "撤单" : "Cancel"}</button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
          {dock === "twap" || dock === "chase" ? <p className="py-3 text-ink/45">{zh ? "挂出去就是订单簿上的限价，这里不另记一笔。" : "Those go on the book as limits. Nothing else is stored here."}</p> : null}
          {dock === "fills" ? <p className="py-3 text-ink/45">{zh ? "成交记在链上。" : "Fills stay on the chain."}</p> : null}
        </div>
      </div>
    </section>
  );
}
