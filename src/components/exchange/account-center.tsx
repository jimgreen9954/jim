import { useEffect, useState } from "react";
import { formatEther, formatUnits, type Hex } from "viem";
import { bemPrice, bnbPrice, ERC_BOOKS, ercPrice, readAsset, readBalances, txUrl as bscTx, type ErcKey } from "@/lib/bsc";
import { useExchange } from "@/lib/exchange-store";
import { getHoldings, type ChipRow, type CircuitRow, type Holdings } from "@/lib/holdings";
import { readGateChain } from "@/lib/gate-chain";
import { getOfficialBooks } from "@/lib/official-books";
import { transferBscCircuit, transferBscTransistor } from "@/lib/official-trade";
import { okbPrice, readOkbPurse } from "@/lib/okb";
import { KNOWN_PERP, KNOWN_XPERP, readPerp } from "@/lib/perp";
import { currentAccount, onAccount } from "@/lib/wallet";
import { transferCircuit, transferTransistor, txUrl } from "@/lib/xlayer";
import { LOCK_TERMS, readLocks, type LockSeat } from "@/lib/tape-lock";
import { readTapePool, showQuote, showTape, TAPE_TERMS, type TapePosition } from "@/lib/tape-pool";
import { NewbieGift } from "@/components/exchange/newbie-gift";
import { tapeText } from "@/lib/tape-mine";

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(value: string): number {
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

function qtyOf(amount: bigint, decimals: number, digits = 4): string {
  const n = Number(formatUnits(amount, decimals));
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

const ERC_NAME: Record<ErcKey, string> = {
  btc: "BTCB",
  xau: "黄金",
  spy: "标普",
  qqq: "纳指",
  aapl: "苹果",
  nvda: "英伟达",
  intc: "英特尔",
  msft: "微软",
  tsla: "特斯拉",
  spcx: "SpaceX",
  googl: "谷歌",
};

type Worth = { name: string; qty: string; px: string; usd: number | null };

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function scan(chain: "bsc" | "xlayer", addr: string): string {
  return chain === "xlayer" ? `https://www.oklink.com/xlayer/address/${addr}` : `https://bscscan.com/address/${addr}`;
}

export function AccountCenter() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [tab, setTab] = useState<"chips" | "circuits" | "book">("chips");
  const [book, setBook] = useState<Holdings | null>(null);
  const [worth, setWorth] = useState<Worth[] | null>(null);
  const [worthAt, setWorthAt] = useState("");
  const [spot, setSpot] = useState<string>("—");
  const [perp, setPerp] = useState<string>("—");
  const [to, setTo] = useState("");
  const [nandQty, setNandQty] = useState("");
  const [latchQty, setLatchQty] = useState("");
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [chipMode, setChipMode] = useState<"one" | "many">("one");
  const [many, setMany] = useState<{ to: string; nand: string; latch: string }[]>([{ to: "", nand: "", latch: "" }]);
  const [picks, setPicks] = useState<Record<string, { on: boolean; to: string }>>({});
  const [stakes, setStakes] = useState<{ lp: TapePosition[]; seats: LockSeat[]; usdtShares: bigint; usdtTape: bigint; usdtQuote: bigint; bemShares: bigint; bemTape: bigint; bemQuote: bigint } | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => onAccount(setAccount), []);

  const pull = (who: string) => {
    setBook((prev) => prev ?? { ok: false, error: null, asOf: "", scanned: 0, bnb: "0", chips: [], circuits: [] });
    getHoldings({ data: { account: who } })
      .then(setBook)
      .catch((err: unknown) => setBook({ ok: false, error: err instanceof Error ? err.message : "read", asOf: "", scanned: 0, bnb: "0", chips: [], circuits: [] }));
  };

  useEffect(() => {
    if (!account) return;
    pull(account);
    const id = window.setInterval(() => pull(account), 20000);
    readBalances(account)
      .then(async (row) => {
        const [bem, bnb] = await Promise.all([bemPrice().catch(() => "0"), bnbPrice().catch(() => "0")]);
        const usd = Number(formatUnits(row.usdt, 18)) + Number(formatEther(row.bnb)) * (Number(bnb) || 0) + Number(formatUnits(row.bem, 8)) * (Number(bem) || 0);
        setSpot(`USDT ${money(Number(formatUnits(row.usdt, 18)))} · BNB ${Number(formatEther(row.bnb)).toFixed(4)} · BEM ${Number(formatUnits(row.bem, 8)).toFixed(4)} · ${money(usd)} USDT`);
      })
      .catch(() => undefined);
    readPerp(KNOWN_PERP, account)
      .then((view) => setPerp(`BSC ${Number(formatUnits(view.margin, 18)).toFixed(2)} USDT`))
      .catch(() => setPerp(zh ? "BSC 没读到" : "BSC unread"));
    readGateChain(KNOWN_XPERP)
      .then((rows) => {
        const mine = rows.deals.filter((row) => row.longUser.toLowerCase() === account.toLowerCase() || row.shortUser.toLowerCase() === account.toLowerCase()).length;
        setPerp((prev) => `${prev} · X Layer ${mine}`);
      })
      .catch(() => undefined);
    return () => window.clearInterval(id);
  }, [account, zh]);

  useEffect(() => {
    if (!account) {
      setStakes(null);
      return;
    }
    let dead = false;
    const pullStakes = () => {
      Promise.all([readTapePool(account), readLocks(account)]).then(([pool, locks]) => {
        if (dead) return;
        setStakes({
          lp: pool.positions,
          seats: locks.seats,
          usdtShares: pool.usdt.shares,
          usdtTape: pool.usdt.tape,
          usdtQuote: pool.usdt.quote,
          bemShares: pool.bem.shares,
          bemTape: pool.bem.tape,
          bemQuote: pool.bem.quote,
        });
      }).catch(() => { if (!dead) setStakes(null); });
    };
    pullStakes();
    const id = window.setInterval(pullStakes, 15000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account]);

  useEffect(() => {
    if (!account || !book?.ok) return;
    let dead = false;
    const keys = Object.keys(ERC_BOOKS) as ErcKey[];
    (async () => {
      const [bal, purse, bemRaw, bnbRaw, okbRaw, bids, perpView, ercBal, gate] = await Promise.all([
        readBalances(account).catch(() => null),
        readOkbPurse(account).catch(() => null),
        bemPrice().catch(() => ""),
        bnbPrice().catch(() => ""),
        okbPrice().catch(() => ""),
        getOfficialBooks().catch(() => null),
        readPerp(KNOWN_PERP, account).catch(() => null),
        Promise.all(keys.map((key) => readAsset(account, ERC_BOOKS[key].token).catch(() => 0n))),
        readGateChain(KNOWN_XPERP).catch(() => null),
      ]);
      const priced = await Promise.all(keys.map((key, index) => (ercBal[index] > 0n ? ercPrice(key).catch(() => "") : Promise.resolve(""))));
      if (dead) return;
      const bnbUsd = num(bnbRaw);
      const lines: Worth[] = [];
      const add = (name: string, qty: string, px: string, usd: number | null) => {
        if (!(num(qty) > 0)) return;
        lines.push({ name, qty, px, usd: usd != null && Number.isFinite(usd) ? usd : null });
      };
      if (bal) {
        const usdt = Number(formatUnits(bal.usdt, 18));
        add("USDT", qtyOf(bal.usdt, 18, 2), "1 USDT", usdt);
        add("BNB", qtyOf(bal.bnb, 18, 6), bnbRaw ? `${bnbRaw} USDT` : "—", Number(formatEther(bal.bnb)) * bnbUsd);
        add("BEM", qtyOf(bal.bem, 8, 4), bemRaw ? `${bemRaw} USDT` : "—", Number(formatUnits(bal.bem, 8)) * num(bemRaw));
      }
      if (purse) {
        add("OKB", qtyOf(purse.okb, 18, 6), okbRaw ? `${okbRaw} USDT` : "—", Number(formatEther(purse.okb)) * num(okbRaw));
        add("X Layer USDT", qtyOf(purse.usdt, 18, 2), "1 USDT", Number(formatUnits(purse.usdt, 18)));
      }
      keys.forEach((key, index) => {
        const token = ERC_BOOKS[key];
        add(ERC_NAME[key], qtyOf(ercBal[index], token.decimals, 4), priced[index] ? `${priced[index]} USDT` : "—", Number(formatUnits(ercBal[index], token.decimals)) * num(priced[index]));
      });
      const pool = await readTapePool(account).catch(() => null);
      if (pool && !dead) {
        const tapePx = pool.usdt.tape > 0n && pool.usdt.quote > 0n
          ? Number(formatUnits(pool.usdt.quote, 6)) / Number(formatUnits(pool.usdt.tape, 8))
          : 0;
        add("TAPE", qtyOf(pool.tape, 8, 4), tapePx > 0 ? `${tapePx.toFixed(4)} USDT` : "—", tapePx > 0 ? Number(formatUnits(pool.tape, 8)) * tapePx : null);
        const bemPx = num(bemRaw);
        for (const pos of pool.positions) {
          if (typeof pos.shares !== "bigint") continue;
          const side = pos.quote === 0 ? pool.usdt : pool.bem;
          if (side.shares === 0n) continue;
          const tape = (pos.shares * side.tape) / side.shares;
          const other = (pos.shares * side.quote) / side.shares;
          const tapeUsd = tapePx > 0 ? Number(formatUnits(tape, 8)) * tapePx : 0;
          const otherUsd = pos.quote === 0 ? Number(formatUnits(other, 6)) : Number(formatUnits(other, 8)) * (Number.isFinite(bemPx) ? bemPx : 0);
          lines.push({
            name: zh ? (pos.quote === 0 ? "TAPE/USDT0 质押" : "TAPE/BEM 质押") : pos.quote === 0 ? "TAPE/USDT0 stake" : "TAPE/BEM stake",
            qty: `${qtyOf(tape, 8, 4)} TAPE`,
            px: tapePx > 0 ? `${tapePx.toFixed(4)} USDT` : "—",
            usd: tapeUsd + otherUsd > 0 ? tapeUsd + otherUsd : null,
          });
        }
      }
      const bidOf = (transistors: string, tokenId: number) => {
        const rows = (bids?.bids ?? []).filter((row) => row.transistors.toLowerCase() === transistors.toLowerCase() && row.tokenId === tokenId && row.remaining > 0);
        return rows.reduce<null | (typeof rows)[number]>((best, row) => (!best || row.priceBnb > best.priceBnb ? row : best), null);
      };
      for (const chip of book.chips) {
        ([["NAND", 0, chip.nand], ["LATCH", 1, chip.latch]] as const).forEach(([label, id, raw]) => {
          const q = Number(raw);
          if (!(q > 0)) return;
          const bid = bidOf(chip.transistors, id);
          lines.push({
            name: `${chip.name} ${label}`,
            qty: q.toLocaleString("en-US"),
            px: bid ? `${bid.priceBnb} BNB` : (zh ? "无买单" : "No bid"),
            usd: bid && bnbUsd > 0 ? q * bid.priceBnb * bnbUsd : null,
          });
        });
      }
      if (perpView && perpView.margin > 0n) {
        const q = Number(formatUnits(perpView.margin, 18));
        add(zh ? "BSC 永续保证金" : "BSC perp margin", q.toFixed(2), "1 USDT", q);
      }
      if (gate) {
        const who = account.toLowerCase();
        let locked = 0;
        for (const order of gate.orders) if (order.user.toLowerCase() === who) locked += order.margin;
        for (const deal of gate.deals) {
          if (deal.longUser.toLowerCase() === who) locked += deal.marginL;
          if (deal.shortUser.toLowerCase() === who) locked += deal.marginS;
        }
        add(zh ? "X Layer 永续保证金" : "X Layer perp margin", locked.toFixed(2), "1 USDT", locked);
      }
      setWorth(lines);
      setWorthAt(new Date().toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Singapore" }));
    })().catch(() => {
      if (!dead) setWorth([]);
    });
    return () => {
      dead = true;
    };
  }, [account, book, zh]);

  if (!account) {
    return <p className="border border-gold px-3 py-4 text-sm">{zh ? "右上角先登入。这一页只读你的地址，不保管资产。" : "Sign in at the top right. This page only reads your address."}</p>;
  }

  const sendChip = async (row: ChipRow) => {
    setBusy(true);
    setBad(false);
    try {
      const n = BigInt(nandQty || "0");
      const l = BigInt(latchQty || "0");
      if (n < 1n && l < 1n) throw new Error("amount");
      const hashes: string[] = [];
      if (n > 0n) {
        hashes.push(row.ours ? await transferTransistor(account, to.trim(), 0, n) : await transferBscTransistor(account, row.transistors as Hex, 0, n, to.trim()));
      }
      if (l > 0n) {
        hashes.push(row.ours ? await transferTransistor(account, to.trim(), 1, l) : await transferBscTransistor(account, row.transistors as Hex, 1, l, to.trim()));
      }
      setNote(zh ? "已转出。" : "Sent.");
      const hash = hashes[0];
      window.open(row.ours ? txUrl(hash) : bscTx(hash), "_blank", "noopener,noreferrer");
      pull(account);
    } catch (error) {
      setBad(true);
      setNote(say(error, zh));
    } finally {
      setBusy(false);
    }
  };

  const sendMany = async (row: ChipRow) => {
    const lines = many
      .map((item) => ({ to: item.to.trim(), nand: BigInt(item.nand || "0"), latch: BigInt(item.latch || "0") }))
      .filter((item) => item.nand > 0n || item.latch > 0n);
    if (lines.length === 0 || lines.length > 20) {
      setBad(true);
      setNote(zh ? "一次 1 到 20 行，每行至少填一个数量。" : "Use 1 to 20 rows, and put a quantity on each.");
      return;
    }
    let nandSum = 0n;
    let latchSum = 0n;
    for (const line of lines) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(line.to)) {
        setBad(true);
        setNote(zh ? "有一行地址不对。" : "One address is not valid.");
        return;
      }
      if (line.to.toLowerCase() === account.toLowerCase()) {
        setBad(true);
        setNote(zh ? "不能转给自己。" : "You cannot send it to yourself.");
        return;
      }
      nandSum += line.nand;
      latchSum += line.latch;
    }
    if (nandSum > BigInt(row.nand || "0") || latchSum > BigInt(row.latch || "0")) {
      setBad(true);
      setNote(zh ? "加起来超过这个钱包的余额。" : "The rows add up to more than this wallet holds.");
      return;
    }
    const jobs: { id: 0 | 1; amount: bigint; to: string }[] = [];
    for (const line of lines) {
      if (line.nand > 0n) jobs.push({ id: 0, amount: line.nand, to: line.to });
      if (line.latch > 0n) jobs.push({ id: 1, amount: line.latch, to: line.to });
    }
    setBusy(true);
    setBad(false);
    try {
      for (let i = 0; i < jobs.length; i += 1) {
        const job = jobs[i];
        setNote(zh ? `第 ${i + 1} / ${jobs.length} 笔，请在钱包里确认。` : `Signature ${i + 1} of ${jobs.length}. Confirm it in the wallet.`);
        const hash = row.ours
          ? await transferTransistor(account, job.to, job.id, job.amount)
          : await transferBscTransistor(account, row.transistors as Hex, job.id, job.amount, job.to);
        window.open(row.ours ? txUrl(hash) : bscTx(hash), "_blank", "noopener,noreferrer");
      }
      setNote(zh ? `${jobs.length} 笔都已转出。` : `Sent ${jobs.length}.`);
      setAck(false);
      pull(account);
    } catch (error) {
      setBad(true);
      setNote(say(error, zh));
    } finally {
      setBusy(false);
    }
  };

  const sendPicked = async () => {
    const chosen = circuits.filter((row) => row.id && !row.listed && picks[`${row.chain}:${row.circuits}:${row.id}`]?.on);
    if (chosen.length === 0 || chosen.length > 20) {
      setBad(true);
      setNote(zh ? "勾 1 到 20 片。" : "Pick 1 to 20 circuits.");
      return;
    }
    const jobs = chosen.map((row) => ({ row, to: (picks[`${row.chain}:${row.circuits}:${row.id}`]?.to ?? "").trim() }));
    for (const job of jobs) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(job.to) || job.to.toLowerCase() === account.toLowerCase()) {
        setBad(true);
        setNote(zh ? `电路 #${job.row.id} 的地址不对，或是你自己。` : `Circuit #${job.row.id} has a bad address, or it is your own.`);
        return;
      }
    }
    setBusy(true);
    setBad(false);
    try {
      for (let i = 0; i < jobs.length; i += 1) {
        const job = jobs[i];
        setNote(zh ? `第 ${i + 1} / ${jobs.length} 片，#${job.row.id}。请在钱包确认。` : `Circuit ${i + 1} of ${jobs.length}, #${job.row.id}. Confirm it in the wallet.`);
        const hash = job.row.chain === "xlayer"
          ? await transferCircuit(account, job.to, BigInt(job.row.id!))
          : await transferBscCircuit(account, job.row.circuits as Hex, BigInt(job.row.id!), job.to);
        window.open(job.row.chain === "xlayer" ? txUrl(hash) : bscTx(hash), "_blank", "noopener,noreferrer");
      }
      setPicks({});
      setNote(zh ? `${jobs.length} 片都已转出。每片只去了你填的那个地址。` : `Sent ${jobs.length}. Each one went only to the address on its row.`);
      pull(account);
    } catch (error) {
      setBad(true);
      setNote(say(error, zh) + (zh ? " 已经确认成功的那几片不会退回。" : " Ones that already confirmed do not come back."));
    } finally {
      setBusy(false);
    }
  };

  const chips = book?.chips ?? [];
  const circuits = book?.circuits ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border border-gold px-3 py-3">
        <div>
          <p className="text-xs tracking-widest text-gold">{zh ? "资产" : "Assets"}</p>
          <h2 className="font-mono text-xl">{short(account)}</h2>
          <p className="text-sm text-ink/70">{zh ? `BSC 钱包 ${book?.bnb ?? "—"} BNB` : `BSC wallet ${book?.bnb ?? "—"} BNB`}</p>
        </div>
        <button type="button" className="min-h-10 border border-gold px-3 text-sm" onClick={() => pull(account)}>{zh ? "刷新" : "Refresh"}</button>
      </div>
      <NewbieGift account={account} zh={zh} />
      <div className="border border-gold">
        <div className="flex items-end justify-between gap-3 px-3 py-3">
          <div>
            <p className="text-xs tracking-widest text-gold">{zh ? "资产统计" : "Assets"}</p>
            <p className="font-display text-3xl italic">{worth ? `${money(worth.reduce((sum, row) => sum + (row.usd ?? 0), 0))} USDT` : "—"}</p>
          </div>
          <p className="text-xs text-ink/50">{worthAt ? (zh ? `现价 ${worthAt}` : `Prices ${worthAt}`) : (zh ? "正在取现价" : "Reading prices")}</p>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs tracking-widest text-gold">
            <tr>
              <th className="px-3 py-2">{zh ? "资产" : "Asset"}</th>
              <th className="px-3 py-2">{zh ? "数量" : "Amount"}</th>
              <th className="px-3 py-2">{zh ? "现价" : "Price"}</th>
              <th className="px-3 py-2 text-right">USDT</th>
            </tr>
          </thead>
          <tbody>
            {(worth ?? []).map((row, index) => (
              <tr key={`${row.name}-${index}`} className="border-t border-gold/40">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 font-mono">{row.qty}</td>
                <td className="px-3 py-2 font-mono">{row.px}</td>
                <td className="px-3 py-2 text-right font-mono">{row.usd == null ? "—" : money(row.usd)}</td>
              </tr>
            ))}
            {worth && worth.length === 0 ? <tr><td className="px-3 py-3 text-ink/60" colSpan={4}>{zh ? "这个地址没有读到余额。" : "No balance on this address."}</td></tr> : null}
          </tbody>
        </table>
        </div>
        <p className="px-3 py-2 text-xs text-ink/60">{zh ? "USDT 和 X Layer USDT 按 1 枚 = 1 USDT。钱包里的 TAPE 用 TAPE/USDT0 池子价。加进池子的 TAPE 单独一行，叫质押，到期日在下面。BNB、BEM、OKB 和美股代币用各自池子现价。晶体管用这台处理器的最高买单，再乘 BNB 现价。没有买单的不计进合计。电路和未实现盈亏不算。" : "USDT and X Layer USDT count at 1. Wallet TAPE uses the TAPE/USDT0 pool price. TAPE added to a pool is its own row, marked as a stake, with the expiry below. BNB, BEM, OKB and the stock tokens use their pool price. Transistors use that processor's best bid times the BNB price. No bid means it is left out. Circuits and unrealized PnL are not included."}</p>
      </div>
      <StakeLines zh={zh} stakes={stakes} />
      <p className="text-sm text-ink/70">
        {book?.ok
          ? zh
            ? `扫过官网 ${book.scanned} 台 BSC 处理器，加上本站 TAPELIQUID（X Layer）。20 秒重读。挂单中的卖单官网没有单独合约，所以可转等于总数。`
            : `Scanned ${book.scanned} official BSC processors plus TAPELIQUID on X Layer. Reread every 20s. There is no official ask contract, so transferable equals the total.`
          : zh ? `正在读链上${book?.error ? `（${book.error}）` : ""}` : "Reading the chain."}
      </p>
      <div className="grid grid-cols-3 border border-gold">
        {([
          ["chips", zh ? `晶体管 ${chips.length}` : `Transistors ${chips.length}`],
          ["circuits", zh ? `电路 ${circuits.length}` : `Circuits ${circuits.length}`],
          ["book", zh ? "现货和合约" : "Spot and perps"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={`min-h-11 text-sm ${tab === id ? "bg-ink text-paper" : ""}`}>{label}</button>
        ))}
      </div>
      {tab === "chips" ? (
        <div className="flex flex-col gap-3">
          {chips.length === 0 ? <p className="border border-gold px-3 py-3 text-sm text-ink/60">{zh ? "这个地址没有晶体管。" : "This address has no transistors."}</p> : null}
          {chips.map((row) => {
            const key = `${row.chain}:${row.transistors}`;
            const lines = many.filter((item) => BigInt(item.nand || "0") > 0n || BigInt(item.latch || "0") > 0n).length;
            return (
              <article key={key} className="border border-gold px-3 py-3">
                <p className="font-display text-lg italic">{row.name}{row.ours ? (zh ? " · 本站" : " · this site") : ""}</p>
                <p className="text-xs text-ink/60">{row.chain === "xlayer" ? "X Layer" : "BSC"} · {row.ours ? (zh ? "TAPELIQUID 的晶体管" : "TAPELIQUID transistors") : zh ? "官网这台的晶体管" : "Official transistors"}</p>
                <p className="mt-2 font-mono text-sm">NAND {row.nand} · LATCH {row.latch}</p>
                <a className="mt-1 block break-all font-mono text-xs underline decoration-gold" href={scan(row.chain, row.transistors)} target="_blank" rel="noreferrer">{row.transistors}</a>
                <div className="mt-3 grid grid-cols-2 border border-gold">
                  <button type="button" className={`min-h-10 text-sm ${chipMode === "one" ? "bg-ink text-paper" : ""}`} onClick={() => { setChipMode("one"); setAck(false); }}>{zh ? "一对一" : "One address"}</button>
                  <button type="button" className={`min-h-10 text-sm ${chipMode === "many" ? "bg-ink text-paper" : ""}`} onClick={() => { setChipMode("many"); setAck(false); }}>{zh ? "一对多" : "Many addresses"}</button>
                </div>
                {chipMode === "one" ? (
                  <div className="mt-2 grid gap-2">
                    <input value={to} onChange={(event) => setTo(event.target.value.trim())} placeholder={zh ? "一个接收地址" : "One recipient"} className="w-full border border-gold bg-card px-2 py-2 font-mono text-xs outline-none" />
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs">NAND
                        <input value={nandQty} onChange={(event) => setNandQty(event.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full border border-gold px-2 py-1 font-mono outline-none" />
                        <button type="button" className="mt-1 underline" onClick={() => setNandQty(row.nand)}>{zh ? "全部" : "All"}</button>
                      </label>
                      <label className="text-xs">LATCH
                        <input value={latchQty} onChange={(event) => setLatchQty(event.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full border border-gold px-2 py-1 font-mono outline-none" />
                        <button type="button" className="mt-1 underline" onClick={() => setLatchQty(row.latch)}>{zh ? "全部" : "All"}</button>
                      </label>
                    </div>
                    <p className="text-xs text-ink/60">{zh ? "NAND 和 LATCH 各签一笔，都进上面这一个地址。" : "NAND and LATCH are one signature each, both to the address above."}</p>
                    <label className="flex gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{zh ? "地址我核对过，不能撤回" : "I checked the address. This cannot be undone."}</label>
                    <button type="button" disabled={!ack || busy} onClick={() => void sendChip(row)} className="min-h-10 bg-ink text-paper disabled:opacity-40">{zh ? "签名转出" : "Sign and send"}</button>
                  </div>
                ) : (
                  <div className="mt-2 grid gap-2">
                    <p className="text-xs text-ink/60">{zh ? "每一行一个地址。这一行的 NAND、LATCH 只进这个地址。最多 20 行，按行签名。" : "One address per row. That row's NAND and LATCH go only there. Up to 20 rows, one signature per transfer."}</p>
                    <ul className="max-h-64 overflow-auto border border-gold/40">
                      {many.map((item, index) => (
                        <li key={index} className="grid gap-1 border-t border-gold/30 p-2">
                          <input value={item.to} onChange={(event) => setMany((cur) => cur.map((row, i) => i === index ? { ...row, to: event.target.value.trim() } : row))} placeholder="0x" className="border border-gold px-2 py-1 font-mono text-xs outline-none" />
                          <div className="grid grid-cols-2 gap-1">
                            <input value={item.nand} onChange={(event) => setMany((cur) => cur.map((row, i) => i === index ? { ...row, nand: event.target.value.replace(/[^\d]/g, "") } : row))} placeholder="NAND" className="border border-gold px-2 py-1 font-mono text-xs outline-none" />
                            <input value={item.latch} onChange={(event) => setMany((cur) => cur.map((row, i) => i === index ? { ...row, latch: event.target.value.replace(/[^\d]/g, "") } : row))} placeholder="LATCH" className="border border-gold px-2 py-1 font-mono text-xs outline-none" />
                          </div>
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="min-h-10 border border-gold text-sm" onClick={() => setMany((cur) => cur.length >= 20 ? cur : [...cur, { to: "", nand: "", latch: "" }])}>{zh ? "再加一行" : "Add a row"}</button>
                    <label className="flex gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{zh ? `我核对过这 ${lines} 行地址，不能撤回` : `I checked these ${lines} addresses. This cannot be undone.`}</label>
                    <button type="button" disabled={!ack || busy} onClick={() => void sendMany(row)} className="min-h-10 bg-ink text-paper disabled:opacity-40">{zh ? "按行签名转出" : "Sign each row"}</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
      {tab === "circuits" ? (
        <div className="flex flex-col gap-3">
          <div className="border border-sell/40 px-3 py-2 text-xs leading-5">
            {zh
              ? "上下滑动勾选具体的一片。每一片右边填一个地址，只转给这个地址。勾几片就签几笔，从你的钱包直接转出，不经过锁仓合约。地址填错取不回。"
              : "Scroll and tick the exact circuit. Each row has one address, and that circuit goes only there. One signature per circuit, straight from your wallet, not through the lock. A wrong address is gone."}
          </div>
          <ul className="max-h-[28rem] overflow-auto border border-gold">
            {circuits.length === 0 ? <li className="px-3 py-3 text-sm text-ink/60">{zh ? "这地址在 TAPELIQUID 和已扫到的官网处理器上没有电路。" : "No circuits on TAPELIQUID or the scanned processors."}</li> : null}
            {circuits.map((row, index) => {
              const key = `${row.chain}:${row.circuits}:${row.id ?? "n"}:${index}`;
              const pick = row.id ? picks[`${row.chain}:${row.circuits}:${row.id}`] : undefined;
              return (
                <li key={key} className="border-t border-gold/40 px-3 py-3">
                  <div className="flex items-start gap-2">
                    {row.id && !row.listed ? (
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={Boolean(pick?.on)}
                        onChange={(event) => {
                          const id = `${row.chain}:${row.circuits}:${row.id}`;
                          setPicks((cur) => ({ ...cur, [id]: { on: event.target.checked, to: cur[id]?.to ?? "" } }));
                          setAck(false);
                        }}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="font-display text-lg italic">{row.name}{row.chain === "xlayer" ? (zh ? " · 本站电路" : " · this site") : (zh ? " · 官网" : " · official")}</p>
                      <p className="font-mono text-sm">{row.chain === "xlayer" ? "X Layer" : "BSC"} · {row.id ? `#${row.id}` : zh ? `还有 ${row.count} 片没有编号，这里不能代选` : `${row.count} more have no id, so they cannot be picked here`}</p>
                      {row.listed ? <p className="text-xs text-ink/60">{zh ? "这片正在挂单。先撤单再转。" : "This one is listed. Delist it before sending."}</p> : null}
                      {row.id && !row.listed && pick?.on ? (
                        <input
                          value={pick.to}
                          onChange={(event) => setPicks((cur) => ({ ...cur, [`${row.chain}:${row.circuits}:${row.id}`]: { on: true, to: event.target.value.trim() } }))}
                          placeholder={zh ? "这一片的接收地址" : "Address for this circuit"}
                          className="mt-2 w-full border border-gold px-2 py-2 font-mono text-xs outline-none"
                        />
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <label className="flex gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{zh ? "每一片的地址我都核对过" : "I checked the address on every ticked circuit"}</label>
          <button type="button" disabled={busy || !ack} onClick={() => void sendPicked()} className="min-h-11 bg-ink text-paper disabled:opacity-40">{zh ? "按片签名转出" : "Sign each circuit"}</button>
        </div>
      ) : null}
      {tab === "book" ? (
        <div className="border border-gold px-3 py-3 text-sm">
          <p>{zh ? "现货" : "Spot"} {spot}</p>
          <p className="mt-2">{zh ? "合约保证金" : "Perp margin"} {perp}</p>
          <p className="mt-2 text-xs text-ink/60">{zh ? "这行是 BSC 现货和两本永续，不是晶体管。" : "This is BSC spot and the two perp books, not transistors."}</p>
        </div>
      ) : null}
      {note ? <p className={`text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
    </section>
  );
}

function StakeLines({ zh, stakes }: { zh: boolean; stakes: { lp: TapePosition[]; seats: LockSeat[]; usdtShares: bigint; usdtTape: bigint; usdtQuote: bigint; bemShares: bigint; bemTape: bigint; bemQuote: bigint } | null }) {
  const when = (ts: number) => {
    if (!Number.isFinite(ts) || ts < 1_000_000_000 || ts > 10_000_000_000) return "—";
    try {
      return new Date(ts * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Singapore", hour12: false });
    } catch {
      return "—";
    }
  };
  const slice = (shares: bigint, total: bigint, reserve: bigint) => (typeof shares === "bigint" && total > 0n ? (shares * reserve) / total : 0n);
  const rows: { key: string; name: string; qty: string; term: string | undefined; until: string }[] = stakes?.lp.map((row) => {
    const tape = slice(row.shares, row.quote === 0 ? stakes.usdtShares : stakes.bemShares, row.quote === 0 ? stakes.usdtTape : stakes.bemTape);
    const other = slice(row.shares, row.quote === 0 ? stakes.usdtShares : stakes.bemShares, row.quote === 0 ? stakes.usdtQuote : stakes.bemQuote);
    const term = TAPE_TERMS[row.term];
    return { key: `lp-${row.id}`, name: `TAPE/${row.quote === 0 ? "USDT0" : "BEM"} #${row.id}`, qty: `${showTape(tape)} TAPE · ${showQuote(row.quote as 0 | 1, other)} ${row.quote === 0 ? "USDT0" : "BEM"}`, term: zh ? term?.zh : term?.en, until: when(row.unlock) };
  }) ?? [];
  for (const seat of stakes?.seats ?? []) {
    const term = LOCK_TERMS[seat.term];
    if (seat.kind === 2) rows.push({ key: `c-${seat.id}`, name: zh ? `TAPELIQUID 电路 #${seat.ref}` : `TAPELIQUID circuit #${seat.ref}`, qty: `${seat.gates.toLocaleString("en-US")} ${zh ? "门" : "gates"} · TAPE ${Number(tapeText(seat.tape + seat.pending)).toLocaleString("en-US", { maximumFractionDigits: 4 })}`, term: zh ? term?.zh : term?.en, until: when(seat.unlock) });
    else rows.push({ key: `w-${seat.id}`, name: seat.kind === 0 ? "TAPELIQUID NAND" : "TAPELIQUID LATCH", qty: seat.amount.toLocaleString("en-US"), term: zh ? term?.zh : term?.en, until: when(seat.unlock) });
  }
  return (
    <div className="border border-gold">
      <p className="px-3 py-2 text-xs tracking-widest text-gold">{zh ? "我的质押" : "My stakes"}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs tracking-widest text-gold">
            <tr>
              <th className="px-3 py-2">{zh ? "质押的是" : "What"}</th>
              <th className="px-3 py-2">{zh ? "数量" : "Amount"}</th>
              <th className="px-3 py-2">{zh ? "期限" : "Term"}</th>
              <th className="px-3 py-2">{zh ? "解锁（新加坡）" : "Unlocks, Singapore"}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-gold/40">
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2 font-mono">{row.qty}</td>
                <td className="px-3 py-2">{row.term}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.until}</td>
              </tr>
            ))}
            {stakes && rows.length === 0 ? <tr><td className="px-3 py-3 text-ink/60" colSpan={4}>{zh ? "这个地址没有 TAPE 池、晶圆或电路质押。" : "This address has no TAPE pool, wafer, or circuit stake."}</td></tr> : null}
            {!stakes ? <tr><td className="px-3 py-3 text-ink/60" colSpan={4}>{zh ? "正在读链上质押。" : "Reading stakes."}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function say(error: unknown, zh: boolean): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "address") return zh ? "地址不对。" : "That address is not valid.";
  if (message === "self") return zh ? "不能转给自己。" : "You cannot send it to yourself.";
  if (message === "short" || message === "amount") return zh ? "数量不对。" : "That amount does not work.";
  if (message === "owner") return zh ? "这片不是这个钱包的。" : "This wallet does not own it.";
  if (message.includes("rejected") || message.includes("denied")) return zh ? "你取消了。" : "You cancelled.";
  return zh ? "没有转出。" : "It did not send.";
}
