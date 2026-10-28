import { useEffect, useState } from "react";
import { recoverMessageAddress, type Hex } from "viem";
import { DESK_LABEL, bestHeld, deskFeeBps, type Desk, type PunkCard } from "@/lib/punk-card";
import { readHeldPunks } from "@/lib/cpunk-held";
import { claimWindowOpen, feeText, rebateOf } from "@/lib/desk-fee-month";
import { CARD_POOL, claimPool, civilMonth, depositPool, poolDecimals, poolSymbol, readPool, withdrawPool, type PoolBooks, type PoolChain } from "@/lib/card-pool";
import { ensureProvider } from "@/lib/wallet";

const PASS = "tapeliquid-fee-pass";
const DESKS: Desk[] = ["spot", "perp", "circuit", "launch"];

type Ready = { card: PunkCard | null; ids: number[] };

function utf8Hex(text: string): Hex {
  const bytes = new TextEncoder().encode(text);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function matches(from: string, signature: Hex): Promise<boolean> {
  const plain = await recoverMessageAddress({ message: PASS, signature }).catch(() => null);
  if (plain?.toLowerCase() === from.toLowerCase()) return true;
  const raw = await recoverMessageAddress({ message: { raw: utf8Hex(PASS) }, signature }).catch(() => null);
  return raw?.toLowerCase() === from.toLowerCase();
}

export function FeePass({ account, zh }: { account: string | null; zh: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [plate, setPlate] = useState(false);
  const [rules, setRules] = useState(false);
  const [fund, setFund] = useState("");
  const [take, setTake] = useState("");
  const [books, setBooks] = useState<PoolBooks[] | null>(null);

  const confirm = async () => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "在钱包里签 tapeliquid-fee-pass。" : "Sign tapeliquid-fee-pass in the wallet.");
    try {
      const eth = await ensureProvider();
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const from = (accounts[0] || account || "") as Hex;
      if (!from) throw new Error("nowallet");
      const hex = utf8Hex(PASS);
      const attempts: unknown[][] = [[PASS, from], [hex, from], [from, PASS]];
      let signature: Hex | null = null;
      let last: unknown = null;
      for (const params of attempts) {
        try {
          signature = (await eth.request({ method: "personal_sign", params })) as Hex;
          if (await matches(from, signature)) break;
          signature = null;
        } catch (err) {
          if ((err as { code?: number }).code === 4001) throw err;
          last = err;
        }
      }
      if (!signature) throw last instanceof Error ? last : new Error("signer");
      setNote(zh ? "正在读这个钱包持有的编号。" : "Reading the numbers this wallet holds.");
      const ids = await readHeldPunks(from);
      setReady({ card: bestHeld(ids), ids });
      setNote("");
    } catch (err) {
      const code = (err as { code?: number }).code;
      const message = err instanceof Error ? err.message : "";
      setBad(true);
      if (code === 4001) setNote(zh ? "没有签名，身份没有确认。" : "Not signed. Identity was not confirmed.");
      else if (message === "signer") setNote(zh ? "签名不是这个钱包。" : "The signature is not this wallet.");
      else if (message === "nowallet" || message === "binanceapp") setNote(zh ? "先连接钱包。" : "Connect the wallet.");
      else if (message === "ids") setNote(zh ? "编号没读完，不能当成没有卡。再点一次。" : "The numbers did not finish. This is not 'no card'. Tap again.");
      else setNote(zh ? "这次没有确认。" : "It was not confirmed.");
    } finally {
      setBusy(false);
    }
  };

  const hold = (err: unknown) => {
    const message = err instanceof Error ? err.message : "";
    setBad(true);
    if (message === "safe") setNote(zh ? "部署要昨天的多签钱包来签。" : "Deploy has to be signed by yesterday's multisig.");
    else if (message === "deploy") setNote(zh ? "这一本还没部署。" : "This pool is not deployed.");
    else if (message === "credit") setNote(zh ? "只能取出你自己充进去的。" : "You can withdraw only what you deposited.");
    else if (message === "window") setNote(zh ? "不在领取窗口。次月 1 日 0 点到 8 日 0 点。" : "Outside the claim window.");
    else if (message === "once") setNote(zh ? "这个月已经领过。" : "Already claimed this month.");
    else if (message === "empty") setNote(zh ? "池子空了。这一轮停，下月 1 日再领新的一个月。" : "The pool is empty. This round stops. The next one opens on the 1st.");
    else if ((err as { code?: number }).code === 4001) setNote(zh ? "没有签名。" : "Not signed.");
    else setNote(zh ? "这一下没有完成。" : "It did not finish.");
  };

  const reload = () => {
    void readPool("xlayer", account).then((x) => readPool("bsc", account).then((b) => setBooks([x, b]))).catch(() => setBooks(null));
  };

  useEffect(() => {
    if (!plate) return;
    reload();
  }, [plate, account]);

  const who = async () => {
    if (account) return account;
    const eth = await ensureProvider();
    const rows = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!rows[0]) throw new Error("nowallet");
    return rows[0];
  };

  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setBad(false);
    setNote("");
    try {
      await job();
      setNote(zh ? "已提交。" : "Submitted.");
      reload();
    } catch (err) {
      hold(err);
    } finally {
      setBusy(false);
    }
  };

  const card = ready?.card ?? null;
  const desks: Desk[] = DESKS;
  const bps = desks.map((desk) => (card ? deskFeeBps(card, desk) : 20)) as [number, number, number, number];
  const clockNow = civilMonth();
  const windowOpen = claimWindowOpen({ y: clockNow.y, m: clockNow.m, d: clockNow.d });

  return (
    <div className="border border-gold">
      <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left" onClick={() => setPlate((open) => !open)} aria-expanded={plate}>
        <span className="text-[11px] tracking-[0.22em] text-gold">{zh ? "合成卡" : "Card"}</span>
        <span className="text-xs text-ink/50">{plate ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {plate ? (
        <div className="border-t border-gold/30 px-4 py-4">
          <button type="button" className="min-h-11 border border-gold px-3 text-sm disabled:opacity-40" disabled={busy} onClick={() => { void confirm(); }}>
            {busy ? (zh ? "等待钱包" : "Waiting") : zh ? "确认身份" : "Confirm"}
          </button>
          {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : "text-ink/70"}`}>{note}</p> : null}
          {ready ? (
            <div className="mt-4 border-t border-gold/30 pt-3 text-sm">
              {card ? (
                <div className="border px-3 py-3" style={{ borderColor: card.edge ?? "transparent" }}>
                  <p className="font-display text-2xl italic">{card.name}</p>
                  <p className="mt-1 font-mono text-xs text-ink/60">#{card.ids.join(" #")}</p>
                  <p className="mt-2 text-ink/70">
                    {zh ? "主属性" : "Main"} {card.main ? DESK_LABEL[card.main] : zh ? "没有" : "None"}
                    {card.edge ? (zh ? " · 绿边" : " · Green edge") : ""}
                  </p>
                </div>
              ) : (
                <p>{zh ? "没有卡。这个钱包持有的编号凑不出一张合格的。" : "No card. What this wallet holds does not make one."}</p>
              )}
              <p className="mt-2 text-xs text-ink/50">{zh ? `持有 ${ready.ids.length} 个。只认最高的一张。` : `Holding ${ready.ids.length}. Only the highest card counts.`}</p>
            </div>
          ) : null}
          <div className="mt-4 border-t border-gold/30 pt-3">
            {(books ?? (["xlayer", "bsc"] as PoolChain[]).map((chain) => ({
              chain, address: CARD_POOL[chain], deployed: false, credit: 0n, balance: 0n, paid: [0n, 0n, 0n, 0n], claimed: 0n, prevPaid: [0n, 0n, 0n, 0n], prevClaimed: 0n, prevDid: false, month: clockNow.id, prev: clockNow.id - 1,
            }))).map((book) => (
              <div key={book.chain} className="mt-3 border border-gold/30 px-3 py-3">
                <p className="text-xs tracking-[0.16em] text-ink/50">{book.chain === "xlayer" ? "X Layer" : "BSC"} · {poolSymbol(book.chain)}</p>
                <p className="mt-1 break-all font-mono text-[11px] text-ink/40">{book.address}</p>
                <p className="mt-2 text-xs text-ink/60">{zh ? `我充入的 ${feeText(book.credit, poolDecimals(book.chain))} · 池子 ${feeText(book.balance, poolDecimals(book.chain))}` : `My deposit ${feeText(book.credit, poolDecimals(book.chain))} · Pool ${feeText(book.balance, poolDecimals(book.chain))}`}</p>
                <table className="mt-2 w-full text-left font-mono text-xs">
                  <thead className="text-ink/40">
                    <tr>
                      <th className="py-1 font-normal">{zh ? "台" : "Desk"}</th>
                      <th className="py-1 text-right font-normal">{zh ? "基点" : "Bps"}</th>
                      <th className="py-1 text-right font-normal">{zh ? "本月已付" : "This month"}</th>
                      <th className="py-1 text-right font-normal">{zh ? "上月已付" : "Last"}</th>
                      <th className="py-1 text-right font-normal">{zh ? "应还" : "Owed"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {desks.map((desk, index) => (
                      <tr key={desk} className="border-t border-gold/20">
                        <td className="py-1.5">{DESK_LABEL[desk]}{card?.main === desk ? (zh ? " · 主" : " · main") : ""}</td>
                        <td className="py-1.5 text-right">{bps[index]}</td>
                        <td className="py-1.5 text-right">{book.deployed ? feeText(book.paid[index] ?? 0n, poolDecimals(book.chain)) : "—"}</td>
                        <td className="py-1.5 text-right">{book.deployed ? feeText(book.prevPaid[index] ?? 0n, poolDecimals(book.chain)) : "—"}</td>
                        <td className="py-1.5 text-right">{book.deployed ? feeText(rebateOf(book.prevPaid[index] ?? 0n, bps[index]), poolDecimals(book.chain)) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs leading-5 text-ink/70">
                  {zh
                    ? "每月 1 日 0 点开始领，新加坡时间，先到先得。池子还有钱，7 天里没领过的可以领。池子空了这一轮就停，下月 1 日再领新的一个月。有资格却 7 天不领，到 8 日 0 点算弃权，不补。下月重新算，不把弃掉的加进去。"
                    : "Claims open on the 1st at 00:00, Singapore time, first come. While the pool has funds, anyone who has not claimed can, for 7 days. An empty pool stops this round. The next round is the 1st of next month. Skipping the 7 days forfeits it. Nothing carries over."}
                </p>
                <p className="mt-1 text-[11px] text-ink/40">{zh ? `上月实领 ${book.deployed ? feeText(book.prevClaimed, poolDecimals(book.chain)) : "—"} ${poolSymbol(book.chain)}。应还按这张卡的基点，从已经记进这一本的台费算。这一笔领到多少就是多少。没经过这一本的，包括旧永续里扣掉的，是 0。` : `Claimed last month ${book.deployed ? feeText(book.prevClaimed, poolDecimals(book.chain)) : "—"}. Owed uses this card and only fees recorded here. A partial claim does not come back. Old perp fees stay 0.`}</p>
                <div className="mt-2 flex gap-2">
                  <input value={fund} onChange={(e) => setFund(e.target.value)} inputMode="decimal" placeholder={zh ? "充入金额" : "Deposit"} className="h-11 min-w-0 flex-1 border border-gold/40 bg-transparent px-3 font-mono text-sm outline-none" />
                  <button type="button" className="h-11 shrink-0 border border-gold px-3 text-sm disabled:opacity-40" disabled={busy} onClick={() => { void run(async () => depositPool(book.chain, await who(), fund)); }}>{zh ? "充入" : "Deposit"}</button>
                </div>
                <div className="mt-2 flex gap-2">
                  <input value={take} onChange={(e) => setTake(e.target.value)} inputMode="decimal" placeholder={zh ? "取出金额" : "Withdraw"} className="h-11 min-w-0 flex-1 border border-gold/40 bg-transparent px-3 font-mono text-sm outline-none" />
                  <button type="button" className="h-11 shrink-0 border border-gold px-3 text-sm disabled:opacity-40" disabled={busy} onClick={() => { void run(async () => withdrawPool(book.chain, await who(), take)); }}>{zh ? "取出" : "Withdraw"}</button>
                </div>
                <button type="button" className="mt-2 min-h-11 w-full border border-gold px-3 text-sm disabled:opacity-40" disabled={busy || !card || !windowOpen || book.prevDid || book.balance <= 0n} onClick={() => { void run(async () => claimPool(book.chain, await who(), book.prev, bps)); }}>
                  {!card
                    ? (zh ? "先确认身份" : "Confirm first")
                    : book.prevDid
                      ? (zh ? "这个月已经领过" : "Already claimed")
                      : !windowOpen
                        ? (zh ? "未到 1 日，或已过 7 天" : "Not the 1st, or the 7 days have passed")
                        : book.balance <= 0n
                          ? (zh ? "池子空了，下月 1 日再领" : "Empty. Next 1st")
                          : (zh ? "领取上月该还的台费" : "Claim last month")}
                </button>
                {!card ? <p className="mt-2 text-[11px] text-ink/40">{zh ? "没有确认到卡，应还按 0。" : "No card confirmed, so owed is 0."}</p> : null}
              </div>
            ))}
          </div>
          <button type="button" className="mt-4 flex min-h-11 w-full items-center justify-between border border-gold/40 px-3 text-left text-sm" onClick={() => setRules((open) => !open)} aria-expanded={rules}>
            <span>{zh ? "具体规则" : "Rules"}</span>
            <span className="text-ink/50">{rules ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
          </button>
          {rules ? (
            <div className="mt-2 border border-gold/30 px-3 py-3 text-xs leading-5 text-ink/70">
              <p>{zh ? "合成只在 nft.tapeliquid.net。那边点过的确定，这个网站读不到，不能当凭证。" : "Forging stays on nft.tapeliquid.net. A confirm clicked there cannot be read here."}</p>
              <p className="mt-2">{zh ? "铜片：两张普通，类型不同。全场 16，主属性 14。银盖：三张，至少一张少见，至少两种衬底。全场 12，主属性 10。金线：三张，至少一张稀有，类型各不相同。全场 8，主属性 6。极紫外：一张传说加任意两张，或一张史诗加三张少见及以上。全场 6，主属性 4，有绿边。仿极紫外：二十张普通，类型不能完全相同。全场 8，没有主属性再减。" : "Copper 16 / 14. Silver 12 / 10. Gold 8 / 6. EUV 6 / 4, green edge. Faux EUV 8, no main-desk cut."}</p>
              <p className="mt-2">{zh ? "主属性：衬底是现货，金属层是永续，键合是电路，对准是发射。只有这一台用更低的基点。不能叠加。" : "Substrate is spot, metal is perp, bond is circuits, alignment is launch. Only that desk uses the lower rate. Cards do not stack."}</p>
              <p className="mt-2">{zh ? "返还 = 该月已付台费 ×（20 − 这一台的基点）/ 20。基准仍是 0.20%。池子手续费、Gas、NFT 市场的 0.2% 不算。下单不减。" : "Return = fees paid that month × (20 − that desk's bps) / 20. Orders still pay 0.20%. Pool fees, gas, and the NFT market's 0.2% do not count."}</p>
              <p className="mt-2">{zh ? `现在是 ${clockNow.y} 年 ${clockNow.m} 月 ${clockNow.d} 日，窗口${windowOpen ? "开着" : "关着"}。每月 1 日 0 点到 8 日 0 点，先到先得。池子有钱就可以领，空了就停，下月 1 日领新的一个月。7 天不领算弃权，不补，下月重新算。谁充的谁取。台费进这本后全额转到多签，不减 0.20%。` : `Today the window is ${windowOpen ? "open" : "closed"}. The 1st 00:00 through the 8th 00:00, first come. An empty pool waits until the next 1st. Seven days without a claim is a forfeit. Nothing carries over.`}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
