import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
  GIFT_ASSETS,
  claimRed,
  fundRed,
  giftDeployer,
  giftText,
  noteClaim,
  readMyClaims,
  readPaid,
  type ClaimRow,
  meetsVolume,
  packetOf,
  readAssetVolume,
  readRed,
  setRedRule,
  sgClock,
  sgDay,
  taskAsset,
  taskLine,
  withdrawRed,
  type GiftAsset,
  type GiftChain,
  type GiftLane,
  type RedRule,
} from "@/lib/red-packet";
import { ensureProvider } from "@/lib/wallet";
import { TxPending } from "@/lib/chain-marks";

function blockReason(rule: RedRule, used: boolean, vol: { spot: number; perp: number }, zh: boolean): string | null {
  if (!rule.deployed) return zh ? "链上没有代码" : "No code";
  if (!rule.ready || !rule.asset) return zh ? "已部署，去创建活动" : "Deployed. Create the game";
  if (rule.spotNeed === 0n && rule.perpNeed === 0n) return zh ? "部署者还没写交易量" : "No volume rule";
  if (used) return zh ? "今天已经参加过" : "Already joined today";
  if (!meetsVolume(rule.gate, rule.spotNeed, rule.perpNeed, vol)) return zh ? "交易量还没到" : "Volume is short";
  if (rule.dayCap > 0n && rule.claimedToday >= rule.dayCap) return zh ? "今天名额满了" : "Today is full";
  if (rule.mode === 2 && rule.packetsLeft === 0n) return zh ? "这一轮领完了" : "This round is finished";
  if (rule.mode === 0 && rule.balance < rule.fixedAmt) return zh ? "池子不够这一份" : "Pool is short";
  if (rule.mode === 1 && rule.balance < rule.lo) return zh ? "池子不够最少的一份" : "Pool is under the minimum";
  if (rule.balance === 0n) return zh ? "池子是空的" : "Pool is empty";
  return null;
}

function blankRule(chain: GiftChain, lane: GiftLane): RedRule {
  return {
    chain,
    lane,
    address: packetOf(chain, lane),
    deployed: false,
    token: "0x0000000000000000000000000000000000000000",
    mode: 0,
    fixedAmt: 0n,
    lo: 0n,
    hi: 0n,
    packetsLeft: 0n,
    dayCap: 0n,
    spotNeed: 0n,
    perpNeed: 0n,
    gate: chain === "bsc" ? 1 : 0,
    endsAt: 0n,
    credit: 0n,
    maker: "0x0000000000000000000000000000000000000000",
    claimedToday: 0n,
    balance: 0n,
    lastDay: 0n,
    ready: false,
    asset: null,
  };
}

const SLOTS: { chain: GiftChain; lane: GiftLane }[] = [
  { chain: "xlayer", lane: "official" },
  { chain: "bsc", lane: "official" },
  { chain: "xlayer", lane: "volunteer" },
  { chain: "bsc", lane: "volunteer" },
];

export function RedGift({ account, zh, forceOpen = false, onIdle }: { account: string | null; zh: boolean; forceOpen?: boolean; onIdle?: () => void }) {
  const [open, setOpen] = useState(forceOpen);
  const [books, setBooks] = useState<RedRule[]>(SLOTS.map((slot) => blankRule(slot.chain, slot.lane)));
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [pop, setPop] = useState<{ name: string; amount: string } | null>(null);
  const [lane, setLane] = useState<GiftLane>("official");
  const [assetId, setAssetId] = useState("usdt");
  const [fixedText, setFixedText] = useState("1");
  const [packets, setPackets] = useState("10");
  const [spotText, setSpotText] = useState("100");
  const [perpText, setPerpText] = useState("100");
  const [gate, setGate] = useState(0);
  const [taskId, setTaskId] = useState("bem");
  const [life, setLife] = useState(86_400);
  const [pick, setPick] = useState<GiftChain>("bsc");
  const [tab, setTab] = useState<"send" | "claim">("claim");
  const [info, setInfo] = useState<string | null>(null);
  const [seal, setSeal] = useState<RedRule | null>(null);
  const [boom, setBoom] = useState(false);
  const [logStamp, setLogStamp] = useState(0);
  const [paid, setPaid] = useState<Record<string, bigint | null>>({});
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [self, setSelf] = useState(account);
  useEffect(() => setSelf(account), [account]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const day = sgDay();
  const safeChain: GiftChain | null = !self ? null : giftDeployer("bsc").toLowerCase() === self.toLowerCase() ? "bsc" : giftDeployer("xlayer").toLowerCase() === self.toLowerCase() ? "xlayer" : null;
  const sendChain: GiftChain = pick;
  const mine = books.find((book) => book.chain === sendChain && book.lane === lane) ?? null;

  const reload = () => {
    void Promise.all(SLOTS.map((slot) => readRed(slot.chain, account, slot.lane).catch(() => blankRule(slot.chain, slot.lane)))).then((rows) => {
      setBooks(rows);
      setSeen(true);
      void Promise.all(SLOTS.map(async (slot) => [`${slot.lane}-${slot.chain}`, await readPaid(slot.chain, slot.lane)] as const)).then((pairs) => {
        const next: Record<string, bigint | null> = {};
        for (const [key, sum] of pairs) next[key] = sum;
        setPaid(next);
      });
    });
  };

  useEffect(() => {
    if (!open) return;
    reload();
  }, [open, account]);

  useEffect(() => {
    if (safeChain) setPick(safeChain);
  }, [safeChain]);

  const who = async () => {
    const eth = await ensureProvider();
    let rows = (await eth.request({ method: "eth_accounts" })) as string[];
    if (!rows[0]) rows = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!rows[0]) throw new Error("nowallet");
    setSelf(rows[0]);
    return rows[0];
  };

  const run = async (job: () => Promise<"cheer" | "ok" | void>) => {
    setBusy(true);
    setBad(false);
    setNote("");
    try {
      const kind = await job();
      if (kind === "cheer" || kind === "ok") return;
      setNote("");
    } catch (err) {
      const message = err instanceof Error ? `${err.message} ${String((err as { cause?: unknown }).cause ?? "")}` : "";
      setBad(true);
      if ((err as { code?: number }).code === 4001) setNote(zh ? "没有签名。" : "Not signed.");
      else if (err instanceof TxPending || message.includes("pending")) setNote(zh ? "这笔还在等钱包确认。" : "The wallet has not confirmed yet.");
      else if (message.includes("nowallet")) setNote(zh ? "先连接钱包。" : "Connect a wallet.");
      else if (message.includes("deployer") || message === "safe") setNote(zh ? "官方创建只认部署地址。" : "Official rounds use the deployer address.");
      else if (message.startsWith("day")) setNote(zh ? "这个红包今天领过了。别的活动还能领。" : "This one was claimed today. The others are still open.");
      else if (message === "empty") setNote(zh ? "池子不够这一份。" : "The pool cannot cover this packet.");
      else if (message === "safe") setNote(zh ? "要用这条链的多签来部署。" : "Deploy with this chain's multisig.");
      else if (message === "cap") setNote(zh ? "今天的名额满了。创建者点放开领取。" : "Today's quota is full. The creator can reopen it.");
      else if (message === "rule") setNote(zh ? "部署者还没写入规则。" : "The deployer has not saved a rule.");
      else if (message === "dust") setNote(zh ? "池子里还有上一种资产，先领完再换。" : "The pool still holds the previous asset. Claim it before switching.");
      else if (message === "packets") setNote(zh ? "拼手气要写这一轮有几个。" : "Lucky draw needs a packet count.");
      else if (message === "fund") setNote(zh ? "奖金没有进池。再点确定。" : "The prize did not enter the pool. Confirm again.");
      else if (message === "amount") setNote(zh ? "奖金数量不对。" : "Prize amount is not valid.");
      else if (message === "early") setNote(zh ? "领取时间还没过，还不能取回。" : "The claim window is still open.");
      else if (message === "late") setNote(zh ? "领取时间已经过了。" : "The claim window is over.");
      else if (message === "life") setNote(zh ? "领取时间只能是 24 小时、一星期或一个月。" : "The window must be a day, a week, or a month.");
      else if (message === "bot") setNote(zh ? "合约地址不能领。" : "A contract cannot claim.");
      else if (message === "pace") setNote(zh ? "上一笔刚领完，请等三分钟。" : "Wait three minutes after the last claim.");
      else if (message === "task" || message === "buy" || message === "pull") setNote(zh ? "买入没有完成。确认余额够。" : "The buy did not finish. Check the balance.");
      else if (message === "fee") setNote(zh ? "这个资产没有对应的池子。" : "This asset has no pool.");
      else if (message.includes("creator")) setNote(zh ? "这一轮还有奖金，只有创建的人能改。" : "This round still has a prize. Only its creator can change it.");
      else setNote(zh ? "这一下没有完成。" : "It did not finish.");
    } finally {
      setBusy(false);
      reload();
    }
  };

  const whyNot = (book: RedRule, who = self): string | null => {
    if (book.lastDay === BigInt(day)) return zh ? "这个已经领过。" : "Already claimed this one.";
    if (book.endsAt > 0n && BigInt(Math.floor(Date.now() / 1000)) > book.endsAt) return zh ? "领取时间已经过了。" : "The claim window is over.";
    if (book.balance === 0n) return zh ? "奖金还没进池。" : "The prize is not in the pool.";
    if (book.dayCap > 0n && book.claimedToday >= book.dayCap) return zh ? "今天的名额满了。创建者点放开领取。" : "Today's quota is full. The creator can reopen it.";
    const task = taskAsset(book.chain, book.hi) ?? book.asset;
    if (!task) return zh ? "活动没有指定资产。" : "This round does not name an asset.";
    if (book.spotNeed === 0n && book.perpNeed === 0n) return zh ? "活动没有买入金额。" : "This round has no buy amount.";
    return null;
  };

  const verify = async (book: RedRule) => {
    const from = self ?? await who().catch(() => null);
    if (from && from !== self) setSelf(from);
    const why = whyNot(book, from);
    if (why) {
      setBad(true);
      setNote(why);
      return;
    }
    setBad(false);
    setNote("");
    setSeal(book);
  };

  const claim = (book: RedRule) => {
    const why = whyNot(book);
    if (why) {
      setBad(true);
      setNote(why);
      setSeal(null);
      return;
    }
    void run(async () => {
      const from = await who();
      const got = await claimRed(book.chain, from, book.lane);
      const text = book.asset ? `${giftText(got.amount, book.asset)} ${zh ? book.asset.zh : book.asset.en}` : "";
      noteClaim(from, { chain: book.chain, lane: book.lane, amount: book.asset ? giftText(got.amount, book.asset) : "", name: book.asset ? (zh ? book.asset.zh : book.asset.en) : "", at: Date.now(), tx: got.hash });
      setLogStamp((n) => n + 1);
      setSeal(null);
      setPop({ name: book.asset ? (zh ? book.asset.zh : book.asset.en) : "", amount: text });
      return "cheer" as const;
    });
  };

  return (
    <div className={forceOpen ? "bg-card px-4 py-4 text-base text-ink" : "border border-[#e6c36a]/50 bg-card text-base text-ink"}>
      {forceOpen ? null : (
        <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <span className="text-sm text-ink">{zh ? "新手礼包" : "Gift"}</span>
          <span className="text-sm text-ink">{open ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
        </button>
      )}
      {open ? (
        <div className={forceOpen ? "" : "border-t border-gold/30 px-4 py-4"}>
          {books.filter((book) => book.asset && self && book.credit > 0n).sort((a, b) => (a.endsAt < b.endsAt ? -1 : 1)).map((book) => {
            const ended = book.endsAt > 0n && BigInt(now) > book.endsAt;
            const name = book.asset ? (zh ? book.asset.zh : book.asset.en) : "";
            const sum = purse(book, paid[`${book.lane}-${book.chain}`] ?? null);
            return (
              <div key={`mine-${book.lane}-${book.chain}`} className="mb-3 bg-paper px-3 py-3 text-base text-ink">
                <p>{book.chain === "bsc" ? "BSC" : "X Layer"} · {book.lane === "volunteer" ? (zh ? "个人创建" : "Personal") : (zh ? "官方创建" : "Official")}</p>
                {sum ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <p className="font-mono text-xl">{zh ? "领取金额" : "Each"} {sum.each}</p>
                    <p className="font-mono text-xl">{zh ? "剩余" : "Left"} {sum.left}</p>
                  </div>
                ) : null}
                <p className="font-mono text-xl">{zh ? "已领" : "Claimed"} {sum ? sum.claimed : "—"} {name}</p>
                <p className="font-mono">{zh ? "没领完" : "Left"} {giftText(book.credit, book.asset)} {name}</p>
                <p className="mt-1 text-base text-ink">{ended ? (zh ? "领取已结束，可以取回。" : "The window is over. You can take it back.") : (zh ? "领取结束后，没领的可以取回。" : "After the window, what is left can be taken back.")}</p>
                {ended ? (
                  <button type="button" className="mt-2 min-h-11 w-full bg-[#8c1c1c] text-base text-[#fff7ea] disabled:opacity-40" disabled={busy} onClick={() => { const asset = book.asset; if (!asset) return; void run(async () => { await withdrawRed(book.chain, await who(), formatUnits(book.credit, asset.decimals), asset, book.lane); setNote(zh ? "资金已经取回。" : "Funds received."); return "ok" as const; }); }}>{zh ? "取回" : "Take back"}</button>
                ) : book.endsAt > 0n ? <DayClock until={Number(book.endsAt)} /> : null}
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={`min-h-11 text-base transition active:scale-[0.98] ${tab === "send" ? "bg-[#8c1c1c] text-[#fff7ea]" : "bg-card text-ink"}`} onClick={() => setTab("send")}>{zh ? "发红包" : "Send"}</button>
            <button type="button" className={`min-h-11 text-base transition active:scale-[0.98] ${tab === "claim" ? "bg-[#8c1c1c] text-[#fff7ea]" : "bg-card text-ink"}`} onClick={() => setTab("claim")}>{zh ? "领红包" : "Claim"}</button>
          </div>
          {tab === "claim" ? (
            <>
              <MineLog zh={zh} account={self} stamp={logStamp} />
              <ClaimBoard zh={zh} books={books} paid={paid} now={now} seen={seen} info={info} setInfo={setInfo} busy={busy} self={self} verify={verify} take={(book) => { const asset = book.asset; if (!asset) return; void run(async () => { await withdrawRed(book.chain, await who(), formatUnits(book.credit, asset.decimals), asset, book.lane); setNote(zh ? "资金已经取回。" : "Funds received."); return "ok" as const; }); }} lift={(book) => { const asset = book.asset; if (!asset) return; void run(async () => { const from = await who(); const each = formatUnits(book.mode === 0 ? book.fixedAmt : book.lo, asset.decimals); await setRedRule(book.chain, from, asset, 0, each, "0", "0", "0", "0", formatUnits(book.spotNeed, 6), formatUnits(book.perpNeed, 6), book.gate, 86_400, book.lane, book.hi > 0n ? book.hi : undefined); setNote(zh ? "名额已经放开。" : "The quota is open."); return "ok" as const; }); }} />
            </>
          ) : (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className={`min-h-11 text-base transition active:scale-[0.98] ${lane === "official" ? "bg-[#8c1c1c] text-[#fff7ea]" : "bg-card text-ink"}`} onClick={() => setLane("official")}>{zh ? "官方创建" : "Official"}</button>
                <button type="button" className={`min-h-11 text-base transition active:scale-[0.98] ${lane === "volunteer" ? "bg-[#1f6b4a] text-[#fff7ea]" : "bg-card text-ink"}`} onClick={() => setLane("volunteer")}>{zh ? "个人创建" : "Personal"}</button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className={`min-h-11 text-base transition active:scale-[0.98] ${pick === "bsc" ? "bg-[#8c1c1c] text-[#fff7ea]" : "bg-card text-ink"}`} onClick={() => setPick("bsc")}>BSC</button>
                <button type="button" className={`min-h-11 text-base transition active:scale-[0.98] ${pick === "xlayer" ? "bg-[#8c1c1c] text-[#fff7ea]" : "bg-card text-ink"}`} onClick={() => setPick("xlayer")}>X Layer</button>
              </div>
              {mine ? (
                <>
                  <DeployerDesk zh={zh} chain={mine.chain} busy={busy} assetId={assetId} setAssetId={setAssetId} eachText={fixedText} setEachText={setFixedText} countText={packets} setCountText={setPackets} spotText={spotText} setSpotText={setSpotText} perpText={perpText} setPerpText={setPerpText} gate={gate} setGate={setGate} life={life} setLife={setLife} taskId={taskId} setTaskId={setTaskId} onSave={() => {
                    const chain = pick;
                    const asset = GIFT_ASSETS[chain].find((row) => row.id === assetId) ?? GIFT_ASSETS[chain][0];
                    const task = GIFT_ASSETS[chain].find((row) => row.id === taskId && row.id !== "usdt") ?? GIFT_ASSETS[chain].find((row) => row.id !== "usdt");
                    const total = payTotal(fixedText, packets);
                    void run(async () => {
                      const from = await who();
                      if (lane === "official" && giftDeployer(chain).toLowerCase() !== from.toLowerCase()) throw new Error("deployer");
                      if (!total || !task) throw new Error("amount");
                      if (!(Number(spotText) > 0) && !(Number(perpText) > 0)) throw new Error("amount");
                      const taskHi = task.token === "0x0000000000000000000000000000000000000000" ? 1n : BigInt(task.token);
                      await setRedRule(chain, from, asset, 0, fixedText, "0", "0", packets, "0", spotText, perpText, gate, life, lane, taskHi);
                      try {
                        await fundRed(chain, from, total, asset, lane);
                      } catch (err) {
                        if (err instanceof TxPending) throw err;
                        throw new Error("fund");
                      }
                      const after = await readRed(chain, from, lane);
                      if (!after.ready || after.balance === 0n) throw new Error("fund");
                      setBoom(true);
                      window.setTimeout(() => setBoom(false), 1600);
                      setTab("claim");
                      return "ok" as const;
                    });
                  }} />
                </>
              ) : (
                <p className="mt-3 text-center text-base text-ink">{zh ? "官方创建只认部署地址。" : "Official rounds use the deployer address."}</p>
              )}
            </div>
          )}
          {note ? <p className={`mt-2 text-center text-base ${bad ? "text-sell" : "text-ink"}`}>{note}</p> : null}
        </div>
      ) : null}
      {pop ? <Cheer name={pop.name} amount={pop.amount} zh={zh} onClose={() => setPop(null)} /> : null}
      {seal ? <WxSeal personal={seal.lane === "volunteer"} zh={zh} busy={busy} onOpen={() => claim(seal)} onClose={() => setSeal(null)} /> : null}
      {boom ? <Fireworks /> : null}
    </div>
  );
}

function MineLog({ zh, account, stamp }: { zh: boolean; account: string | null; stamp: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  useEffect(() => {
    if (!open || !account) return;
    let dead = false;
    setRows(null);
    readMyClaims(account).then((next) => { if (!dead) setRows(next); }).catch(() => { if (!dead) setRows([]); });
    return () => { dead = true; };
  }, [open, account, stamp]);
  return (
    <div className="mt-3">
      <button type="button" className="flex min-h-11 w-full items-center justify-between text-base text-ink" onClick={() => setOpen((v) => !v)}>
        <span>{zh ? "领取记录" : "Claims"}</span>
        <span>{open ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {open ? (
        !account ? <p className="text-center text-ink">{zh ? "先连接钱包" : "Connect a wallet"}</p>
          : rows === null ? <p className="text-center text-ink">{zh ? "正在读" : "Reading"}</p>
            : rows.length === 0 ? <p className="text-center text-ink">{zh ? "还没有领取" : "None yet"}</p>
              : rows.map((row) => (
                <p key={row.tx} className="mt-2 bg-paper px-3 py-2 font-mono text-base text-ink">
                  {row.at ? new Date(row.at).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                  {" "}{row.chain === "bsc" ? "BSC" : "X Layer"} · {row.lane === "volunteer" ? (zh ? "个人" : "Personal") : (zh ? "官方" : "Official")}
                  {" "}{row.amount} {row.name}
                </p>
              ))
      ) : null}
    </div>
  );
}

function purse(book: RedRule, paid: bigint | null): { claimed: string; each: string; left: string } | null {
  if (!book.asset) return null;
  const unit = book.mode === 0 ? book.fixedAmt : book.lo;
  return {
    claimed: paid == null ? "—" : giftText(paid, book.asset),
    each: giftText(unit, book.asset),
    left: giftText(book.balance, book.asset),
  };
}

function ClaimBoard({
  zh, books, paid, now, seen, info, setInfo, busy, self, verify, take, lift,
}: {
  zh: boolean;
  books: RedRule[];
  paid: Record<string, bigint | null>;
  now: number;
  seen: boolean;
  info: string | null;
  setInfo: (v: string | null) => void;
  busy: boolean;
  self: string | null;
  verify: (book: RedRule) => void;
  take: (book: RedRule) => void;
  lift: (book: RedRule) => void;
}) {
  const stamp = BigInt(now);
  const [showLive, setShowLive] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const live = books.filter((book) => book.ready && book.asset && book.balance > 0n && book.endsAt > 0n && stamp <= book.endsAt).sort((a, b) => (a.endsAt < b.endsAt ? -1 : 1));
  const done = books.filter((book) => book.ready && book.asset && (stamp > book.endsAt || (book.balance === 0n && book.claimedToday > 0n))).sort((a, b) => (a.endsAt > b.endsAt ? -1 : 1));
  return (
    <div className="mt-3 flex flex-col gap-3">
      <button type="button" className="flex min-h-11 w-full items-center justify-between text-base text-ink" onClick={() => setShowLive((v) => !v)}>
        <span>{zh ? "正在进行" : "Open"}</span>
        <span>{showLive ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {showLive ? (live.length ? live.map((book) => <PacketCard key={`${book.lane}-${book.chain}`} book={book} paid={paid[`${book.lane}-${book.chain}`] ?? null} zh={zh} info={info} setInfo={setInfo} busy={busy} self={self} verify={verify} take={take} lift={lift} ended={false} />) : <p className="text-center text-ink">{seen ? (zh ? "没有进行中的" : "None open") : ""}</p>) : null}
      <button type="button" className="flex min-h-11 w-full items-center justify-between text-base text-ink" onClick={() => setShowDone((v) => !v)}>
        <span>{zh ? "已经结束" : "Ended"}</span>
        <span>{showDone ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {showDone ? (done.length ? done.map((book) => <PacketCard key={`${book.lane}-${book.chain}`} book={book} paid={paid[`${book.lane}-${book.chain}`] ?? null} zh={zh} info={info} setInfo={setInfo} busy={busy} self={self} verify={verify} take={take} lift={lift} ended />) : <p className="text-center text-ink">{seen ? (zh ? "没有结束的" : "None ended") : ""}</p>) : null}
    </div>
  );
}

function PacketCard({
  book, paid, zh, info, setInfo, busy, self, verify, take, lift, ended,
}: {
  book: RedRule;
  paid: bigint | null;
  zh: boolean;
  info: string | null;
  setInfo: (v: string | null) => void;
  busy: boolean;
  self: string | null;
  verify: (book: RedRule) => void;
  take: (book: RedRule) => void;
  lift: (book: RedRule) => void;
  ended: boolean;
}) {
  const personal = book.lane === "volunteer";
  const key = `${book.lane}-${book.chain}`;
  const owner = Boolean(self && book.credit > 0n);
  const maker = Boolean(self && book.maker.toLowerCase() === self.toLowerCase());
  const mineToday = book.lastDay === BigInt(sgDay());
  const stuck = book.dayCap > 0n && book.claimedToday >= book.dayCap && book.balance > 0n;
  const sum = purse(book, paid);
  const name = book.asset ? (zh ? book.asset.zh : book.asset.en) : "";
  return (
    <div className="bg-card px-3 py-3 text-center text-base text-ink">
      <div className="mx-auto grid h-28 w-24 place-items-center">
        <svg viewBox="0 0 64 72" className="h-24 w-20" aria-hidden="true">
          <rect x="8" y="16" width="48" height="48" rx="4" fill={ended ? "#6b5a4a" : personal ? "#1f6b4a" : "#8c1c1c"} />
          <path d="M8 32h48" stroke="#e6c36a" strokeWidth="3" />
          <path d="M32 16v48" stroke="#e6c36a" strokeWidth="3" />
          <path d="M16 16c6-10 26-10 32 0" fill={ended ? "#4a3d32" : personal ? "#164e36" : "#6e1212"} stroke="#e6c36a" strokeWidth="2" />
        </svg>
      </div>
      <p className="text-base text-ink">{book.chain === "bsc" ? "BSC" : "X Layer"} · {personal ? (zh ? "个人创建" : "Personal") : (zh ? "官方创建" : "Official")}</p>
      {sum ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-ink">
          <div className="bg-paper px-2 py-2">
            <p>{zh ? "领取金额" : "Each"}</p>
            <p className="font-mono text-xl">{sum.each}</p>
            <p>{name}</p>
          </div>
          <div className="bg-paper px-2 py-2">
            <p>{zh ? "剩余" : "Left"}</p>
            <p className="font-mono text-xl">{sum.left}</p>
            <p>{name}</p>
          </div>
        </div>
      ) : null}
      {sum ? <p className="mt-2 font-mono text-xl text-ink">{zh ? "已领" : "Claimed"} {sum.claimed} {name}</p> : null}
      {!ended && book.endsAt > 0n ? <DayClock until={Number(book.endsAt)} /> : null}
      <button type="button" className="mt-2 min-h-11 w-full text-base text-ink" onClick={() => setInfo(info === key ? null : key)}>{zh ? "活动介绍" : "Rules"}</button>
      {info === key ? <p className="mt-1 bg-paper px-3 py-3 text-left text-base text-ink">{taskLine(book.chain, book.hi, book.spotNeed, book.perpNeed, book.gate, zh)}</p> : null}
      {ended && owner ? (
        <button type="button" className="mt-2 min-h-11 w-full bg-[#8c1c1c] text-base text-[#fff7ea] disabled:opacity-40" disabled={busy} onClick={() => take(book)}>{zh ? "取回" : "Take back"}</button>
      ) : stuck && maker ? (
        <button type="button" className="mt-2 min-h-11 w-full bg-[#8c1c1c] text-base text-[#fff7ea] disabled:opacity-40" disabled={busy} onClick={() => lift(book)}>{zh ? "放开领取" : "Reopen"}</button>
      ) : ended ? null : (
        <button type="button" className="mt-2 min-h-11 w-full bg-[#8c1c1c] text-base text-[#fff7ea] disabled:opacity-40" disabled={busy || mineToday} onClick={() => verify(book)}>{mineToday ? (zh ? "领过了" : "Done") : (zh ? "参与" : "Join")}</button>
      )}
    </div>
  );
}

function payTotal(each: string, count: string): string {
  const amount = Number(each);
  const people = Number(count);
  if (!(amount > 0) || !Number.isInteger(people) || people < 1) return "";
  return (Math.round(amount * people * 1e8) / 1e8).toString();
}

function DeployerDesk({
  zh, chain, busy, assetId, setAssetId, eachText, setEachText, countText, setCountText, spotText, setSpotText, perpText, setPerpText, gate, setGate, life, setLife, taskId, setTaskId, onSave,
}: {
  zh: boolean;
  chain: GiftChain;
  busy: boolean;
  assetId: string;
  setAssetId: (v: string) => void;
  eachText: string;
  setEachText: (v: string) => void;
  countText: string;
  setCountText: (v: string) => void;
  spotText: string;
  setSpotText: (v: string) => void;
  perpText: string;
  setPerpText: (v: string) => void;
  gate: number;
  setGate: (v: number) => void;
  life: number;
  setLife: (v: number) => void;
  taskId: string;
  setTaskId: (v: string) => void;
  onSave: () => void;
}) {
  const assets = GIFT_ASSETS[chain];
  const tasks = assets.filter((row) => row.id !== "usdt");
  const asset = assets.find((row) => row.id === assetId) ?? assets[0];
  const task = tasks.find((row) => row.id === taskId) ?? tasks[0];
  const total = payTotal(eachText, countText);
  const spot = Number(spotText);
  const perp = Number(perpText);
  const ready = Boolean(total) && (spot > 0 || perp > 0);
  return (
    <div className="mt-2 bg-paper px-3 py-3 text-base text-ink">
      <label className="block text-base text-ink">{zh ? "资产" : "Asset"}
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="mt-1 h-11 w-full bg-card px-2 text-base text-ink">
          {assets.map((row) => <option key={row.id} value={row.id}>{zh ? row.zh : row.en}</option>)}
        </select>
      </label>
      <Field label={zh ? "每个人" : "Each"} value={eachText} set={setEachText} />
      <Field label={zh ? "人数" : "People"} value={countText} set={setCountText} />
      <p className="mt-3 font-mono text-2xl text-ink">{total ? `${total} ${zh ? asset.zh : asset.en}` : "—"}</p>
      <label className="mt-2 block text-base text-ink">{zh ? "领取" : "Window"}
        <select value={life} onChange={(e) => setLife(Number(e.target.value))} className="mt-1 h-11 w-full bg-card px-2 text-base text-ink">
          <option value={86_400}>{zh ? "24小时" : "24 hours"}</option>
          <option value={604_800}>{zh ? "一星期" : "One week"}</option>
          <option value={2_592_000}>{zh ? "一个月" : "One month"}</option>
        </select>
      </label>
      <label className="mt-3 block text-base text-ink">{zh ? "任务资产" : "Task asset"}
        <select value={task.id} onChange={(e) => setTaskId(e.target.value)} className="mt-1 h-11 w-full bg-card px-2 text-base text-ink">
          {tasks.map((row) => <option key={row.id} value={row.id}>{zh ? row.zh : row.en}</option>)}
        </select>
      </label>
      <Field label={zh ? "现货 USDT" : "Spot USDT"} value={spotText} set={setSpotText} />
      <Field label={zh ? "合约 USDT" : "Perp USDT"} value={perpText} set={setPerpText} />
      <label className="mt-2 block text-base text-ink">{zh ? "门槛" : "Gate"}
        <select value={gate} onChange={(e) => setGate(Number(e.target.value))} className="mt-1 h-11 w-full bg-card px-2 text-base text-ink">
          <option value={0}>{zh ? "一样即可" : "Either"}</option>
          <option value={1}>{zh ? "两样都要" : "Both"}</option>
        </select>
      </label>
      <p className="mt-3 text-base text-ink">{taskLine(chain, task.token === "0x0000000000000000000000000000000000000000" ? 1n : BigInt(task.token), BigInt(Math.round((spot > 0 ? spot : 0) * 1e6)), BigInt(Math.round((perp > 0 ? perp : 0) * 1e6)), gate, zh)}</p>
      <button type="button" className="mt-3 min-h-11 w-full bg-[#8c1c1c] text-base text-[#fff7ea] transition active:scale-[0.98] disabled:opacity-40" disabled={busy || !ready} onClick={onSave}>{busy ? (zh ? "等待钱包" : "Waiting") : (zh ? "确定" : "Confirm")}</button>
    </div>
  );
}

function DayClock({ until }: { until: number }) {
  const [left, setLeft] = useState(() => Math.max(0, until * 1000 - Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setLeft(Math.max(0, until * 1000 - Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return <p className="font-mono text-2xl text-ink">{sgClock(left)}</p>;
}

function Field({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <label className="mt-2 block text-base text-ink">{label}
      <input value={value} onChange={(e) => set(e.target.value)} placeholder={label} className="mt-1 h-11 w-full border border-[#e6c36a]/40 bg-paper px-2 font-mono text-base text-ink placeholder:text-ink/70" />
    </label>
  );
}

function WxSeal({ personal, zh, busy, onOpen, onClose }: { personal: boolean; zh: boolean; busy: boolean; onOpen: () => void; onClose: () => void }) {
  const fill = personal ? "#1f6b4a" : "#c83c3c";
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-6" onClick={onClose}>
      <div className="relative h-96 w-64 overflow-hidden" style={{ background: fill }} onClick={(event) => event.stopPropagation()}>
        <div className="absolute inset-x-0 top-0 h-52 rounded-b-[50%]" style={{ background: personal ? "#26845c" : "#e15a4a" }} />
        <button type="button" className="absolute left-1/2 top-40 grid h-20 w-20 -translate-x-1/2 place-items-center rounded-full bg-[#e6c36a] text-3xl text-[#6b1d12] shadow active:scale-95 disabled:opacity-40" disabled={busy} onClick={onOpen}>{zh ? "开" : "Open"}</button>
        <p className="absolute inset-x-0 bottom-10 text-center text-xl text-[#fff7ea]">{zh ? "恭喜发财" : "Fortune"}</p>
      </div>
    </div>
  );
}

function Fireworks() {
  const sparks = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * Math.PI * 2;
    const dist = 90 + (i % 5) * 28;
    return { dx: `${Math.cos(angle) * dist}px`, dy: `${Math.sin(angle) * dist}px`, color: ["#e6c36a", "#ff6b84", "#fff7ea", "#8c1c1c"][i % 4] };
  });
  return (
    <div className="tl-firework" aria-hidden="true">
      {sparks.map((spark, i) => (
        <span key={i} className="tl-spark" style={{ background: spark.color, ["--dx" as string]: spark.dx, ["--dy" as string]: spark.dy, animationDelay: `${(i % 4) * 40}ms` }} />
      ))}
    </div>
  );
}

function Cheer({ amount, zh, onClose }: { name: string; amount: string; zh: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-6" onClick={onClose}>
      <button type="button" className="w-full max-w-sm border border-gold bg-paper px-6 py-8 text-center" onClick={(e) => e.stopPropagation()}>
        <svg viewBox="0 0 120 150" className="tl-god mx-auto h-40 w-32" aria-hidden="true">
          <rect x="28" y="58" width="64" height="78" rx="4" fill="#8c1c1c" />
          <rect x="28" y="88" width="64" height="14" fill="#e6c36a" />
          <rect x="54" y="58" width="12" height="78" fill="#e6c36a" />
          <circle cx="60" cy="34" r="16" fill="#f3d2b3" />
          <path d="M44 30h32v8H44z" fill="#111" />
          <path d="M48 22h24l4 8H44z" fill="#c9a227" />
          <path d="M46 42c6 8 22 8 28 0" fill="none" stroke="#111" strokeWidth="2" />
          <circle cx="54" cy="36" r="1.5" fill="#111" />
          <circle cx="66" cy="36" r="1.5" fill="#111" />
        </svg>
        <p className="mt-3 font-display text-3xl text-[#e6c36a]">{zh ? "恭喜发财" : "Fortune"}</p>
        <p className="mt-2 font-mono text-lg text-ink">{amount}</p>
      </button>
    </div>
  );
}
