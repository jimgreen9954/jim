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
import { fanCircuits } from "@/lib/tape-lock";

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
  const [open, setOpen] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [nandQty, setNandQty] = useState("");
  const [latchQty, setLatchQty] = useState("");
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [fanText, setFanText] = useState("");
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

  const sendCircuit = async (row: CircuitRow) => {
    if (!row.id) return;
    setBusy(true);
    setBad(false);
    try {
      const hash = row.chain === "xlayer"
        ? await transferCircuit(account, to.trim(), BigInt(row.id))
        : await transferBscCircuit(account, row.circuits as Hex, BigInt(row.id), to.trim());
      setNote(zh ? "电路已转出。" : "Circuit sent.");
      window.open(row.chain === "xlayer" ? txUrl(hash) : bscTx(hash), "_blank", "noopener,noreferrer");
      pull(account);
    } catch (error) {
      setBad(true);
      setNote(say(error, zh));
    } finally {
      setBusy(false);
    }
  };

  const sendFan = async () => {
    const rows = fanText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (rows.length === 0 || rows.length > 30) {
      setBad(true);
      setNote(zh ? "一次 1 到 30 行。" : "Use 1 to 30 lines.");
      return;
    }
    const ids: bigint[] = [];
    const tos: Hex[] = [];
    for (const line of rows) {
      const [id, dest] = line.split(/\s+/);
      if (!/^\d+$/.test(id ?? "") || !/^0x[a-fA-F0-9]{40}$/.test(dest ?? "")) {
        setBad(true);
        setNote(zh ? "每行要是「编号 地址」。" : "Each line must be an id and an address.");
        return;
      }
      ids.push(BigInt(id));
      tos.push(dest as Hex);
    }
    setBusy(true);
    setBad(false);
    try {
      const hash = await fanCircuits(account, ids, tos);
      setNote(zh ? `已转出 ${ids.length} 片。` : `Sent ${ids.length}.`);
      window.open(txUrl(hash), "_blank", "noopener,noreferrer");
      pull(account);
    } catch (error) {
      setBad(true);
      setNote(say(error, zh));
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
        <p className="px-3 py-2 text-xs text-ink/60">{zh ? "USDT 和 X Layer USDT 按 1 枚 = 1 USDT。BNB、BEM、OKB 和美股代币用池子现价。晶体管用这台处理器的最高买单，再乘 BNB 现价。没有买单的不计进合计。电路和未实现盈亏不算。" : "USDT and X Layer USDT are counted at 1. BNB, BEM, OKB and the stock tokens use the pool price. Transistors use that processor's best bid times the BNB price. No bid means it is left out. Circuits and unrealized PnL are not included."}</p>
      </div>
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
        <div className="overflow-x-auto border border-gold">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs tracking-widest text-gold">
              <tr>
                <th className="px-3 py-2">{zh ? "处理器" : "Processor"}</th>
                <th className="px-3 py-2">NAND</th>
                <th className="px-3 py-2">LATCH</th>
                <th className="px-3 py-2">{zh ? "操作" : "Action"}</th>
              </tr>
            </thead>
            <tbody>
              {chips.map((row) => {
                const key = `${row.chain}:${row.transistors}`;
                return (
                  <tr key={key} className="border-t border-gold/40 align-top">
                    <td className="px-3 py-3">
                      <p className="font-display text-lg italic">{row.name}{row.ours ? (zh ? " · 本站" : " · this site") : ""}</p>
                      <p className="text-xs text-ink/60">{row.chain === "xlayer" ? "X Layer" : "BSC"} · {row.ours ? (zh ? "TAPELIQUID 的晶体管" : "TAPELIQUID transistors") : zh ? "官网这台的晶体管" : "Official transistors"}</p>
                      <a className="mt-1 block break-all font-mono text-xs underline decoration-gold" href={scan(row.chain, row.transistors)} target="_blank" rel="noreferrer">{zh ? "晶体管合约" : "Transistor contract"} {row.transistors}</a>
                      <a className="block break-all font-mono text-xs underline decoration-gold" href={scan(row.chain, row.circuits)} target="_blank" rel="noreferrer">{zh ? "电路合约" : "Circuit contract"} {row.circuits}</a>
                    </td>
                    <td className="px-3 py-3 font-mono">
                      <p>{zh ? "总数" : "Total"} {row.nand}</p>
                      <p className="text-xs text-ink/60">{zh ? `可转 ${row.nand} · 挂单中 0` : `Free ${row.nand} · listed 0`}</p>
                    </td>
                    <td className="px-3 py-3 font-mono">
                      <p>{zh ? "总数" : "Total"} {row.latch}</p>
                      <p className="text-xs text-ink/60">{zh ? `可转 ${row.latch} · 挂单中 0` : `Free ${row.latch} · listed 0`}</p>
                    </td>
                    <td className="px-3 py-3">
                      <button type="button" className="min-h-10 border border-gold px-3" onClick={() => { setOpen(open === key ? null : key); setNandQty(""); setLatchQty(""); setAck(false); }}>{zh ? "转账" : "Send"}</button>
                      {open === key ? (
                        <div className="mt-2 border border-gold bg-paper p-2">
                          <input value={to} onChange={(event) => setTo(event.target.value.trim())} placeholder={zh ? "接收地址" : "Recipient"} className="w-full border border-gold bg-card px-2 py-2 font-mono text-xs outline-none" />
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="text-xs">NAND
                              <input value={nandQty} onChange={(event) => setNandQty(event.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full border border-gold px-2 py-1 font-mono outline-none" />
                              <button type="button" className="mt-1 underline" onClick={() => setNandQty(row.nand)}>{zh ? "全部" : "All"}</button>
                            </label>
                            <label className="text-xs">LATCH
                              <input value={latchQty} onChange={(event) => setLatchQty(event.target.value.replace(/[^\d]/g, ""))} className="mt-1 w-full border border-gold px-2 py-1 font-mono outline-none" />
                              <button type="button" className="mt-1 underline" onClick={() => setLatchQty(row.latch)}>{zh ? "全部" : "All"}</button>
                            </label>
                          </div>
                          <label className="mt-2 flex gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{zh ? "地址我核对过，不能撤回" : "I checked the address. This cannot be undone."}</label>
                          <button type="button" disabled={!ack || busy} onClick={() => void sendChip(row)} className="mt-2 min-h-10 w-full bg-ink text-paper disabled:opacity-40">{zh ? "签名转出" : "Sign and send"}</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {tab === "circuits" ? (
        <div className="flex flex-col gap-3">
          <div className="border border-gold p-3">
            <p className="font-display text-xl italic">{zh ? "一对多转出" : "Send to many"}</p>
            <p className="mt-1 text-xs leading-5 text-ink/60">{zh ? "只限 TAPELIQUID 的电路。每行一片：编号 空格 地址。一次最多 30 行，一笔签名。有一片不是这个钱包的，整笔退回，已经成功的不会出现。官网电路仍用下面的单笔。" : "TAPELIQUID circuits only. One line each: id, space, address. Up to 30 lines, one signature. If one is not yours, the whole transaction returns."}</p>
            <textarea value={fanText} onChange={(event) => setFanText(event.target.value)} rows={4} placeholder={"12 0x...\n13 0x..."} className="mt-2 w-full border border-gold bg-transparent px-2 py-2 font-mono text-xs outline-none" />
            <button type="button" disabled={busy} onClick={() => void sendFan()} className="mt-2 min-h-10 bg-ink px-3 text-paper disabled:opacity-40">{zh ? "签名并按行转出" : "Sign and send the lines"}</button>
          </div>
        <ul className="border border-gold">
          {circuits.length === 0 ? <li className="px-3 py-3 text-sm text-ink/60">{zh ? "这地址在 TAPELIQUID 和已扫到的官网处理器上没有电路。" : "No circuits on TAPELIQUID or the scanned processors."}</li> : null}
          {circuits.map((row, index) => (
            <li key={`${row.circuits}-${row.id ?? "n"}-${index}`} className="border-t border-gold/40 px-3 py-3">
              <p className="font-display text-lg italic">{row.name}{row.chain === "xlayer" ? (zh ? " · 本站电路" : " · this site's circuit") : row.listed ? (zh ? " · 官网挂单中的电路" : " · listed official circuit") : (zh ? " · 官网这台的电路" : " · official circuit")}</p>
              <p className="font-mono text-sm">{row.chain === "xlayer" ? "X Layer" : "BSC"} · {row.id ? `#${row.id}` : zh ? `持有 ${row.count} 片，编号没有逐个展开` : `Holds ${row.count}. Ids are not listed one by one.`}</p>
              {row.priceBnb != null ? <p className="text-sm">{zh ? `挂单价 ${row.priceBnb} BNB` : `Listed at ${row.priceBnb} BNB`}</p> : null}
              <a className="break-all font-mono text-xs underline decoration-gold" href={scan(row.chain, row.circuits)} target="_blank" rel="noreferrer">{row.circuits}</a>
              {row.id && !row.listed ? (
                <div className="mt-2">
                  <button type="button" className="min-h-10 border border-gold px-3 text-sm" onClick={() => setOpen(open === `c:${row.circuits}:${row.id}` ? null : `c:${row.circuits}:${row.id}`)}>{zh ? "转账" : "Send"}</button>
                  {open === `c:${row.circuits}:${row.id}` ? (
                    <div className="mt-2 grid gap-2 border border-gold p-2">
                      <input value={to} onChange={(event) => setTo(event.target.value.trim())} placeholder="0x" className="border border-gold px-2 py-2 font-mono text-xs outline-none" />
                      <label className="flex gap-2 text-xs"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} />{zh ? "确认转出这片电路" : "Confirm sending this circuit"}</label>
                      <button type="button" disabled={!ack || busy} onClick={() => void sendCircuit(row)} className="min-h-10 bg-ink text-paper disabled:opacity-40">{zh ? "签名转出" : "Sign and send"}</button>
                    </div>
                  ) : null}
                </div>
              ) : row.listed ? <p className="text-xs text-ink/60">{zh ? "这片正在官网挂单。先在电路现货撤了再转。" : "This one is listed. Delist it before sending."}</p> : null}
            </li>
          ))}
        </ul>
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

function say(error: unknown, zh: boolean): string {
  const message = error instanceof Error ? error.message : "";
  if (message === "address") return zh ? "地址不对。" : "That address is not valid.";
  if (message === "self") return zh ? "不能转给自己。" : "You cannot send it to yourself.";
  if (message === "short" || message === "amount") return zh ? "数量不对。" : "That amount does not work.";
  if (message === "owner") return zh ? "这片不是这个钱包的。" : "This wallet does not own it.";
  if (message.includes("rejected") || message.includes("denied")) return zh ? "你取消了。" : "You cancelled.";
  return zh ? "没有转出。" : "It did not send.";
}
