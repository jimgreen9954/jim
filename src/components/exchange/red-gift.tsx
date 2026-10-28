import { useEffect, useState } from "react";
import {
  GIFT_ASSETS,
  RED_PACKET,
  claimRed,
  claimedHere,
  deployRed,
  fundRed,
  giftDeployer,
  giftText,
  meetsVolume,
  needUsd,
  readDeskVolume,
  readRed,
  redCode,
  setRedRule,
  sgDay,
  withdrawRed,
  type GiftAsset,
  type GiftChain,
  type RedRule,
} from "@/lib/red-packet";
import { ensureProvider } from "@/lib/wallet";
import { useExchange } from "@/lib/exchange-store";

function modeLine(rule: RedRule, zh: boolean): string {
  const name = rule.asset ? (zh ? rule.asset.zh : rule.asset.en) : "—";
  if (!rule.deployed) return zh ? "这一本还没部署。" : "This pool is not deployed.";
  if (!rule.ready || !rule.asset) return zh ? "部署者还没定今天发什么。" : "The deployer has not chosen an asset.";
  if (rule.mode === 0) return zh ? `固定 ${giftText(rule.fixedAmt, rule.asset)} ${name}` : `Fixed ${giftText(rule.fixedAmt, rule.asset)} ${name}`;
  if (rule.mode === 1) return zh ? `随机 ${giftText(rule.lo, rule.asset)} 到 ${giftText(rule.hi, rule.asset)} ${name}` : `Random ${giftText(rule.lo, rule.asset)}–${giftText(rule.hi, rule.asset)} ${name}`;
  return zh ? `拼手气，还剩 ${rule.packetsLeft.toString()} 个 ${name}。最后一份拿走剩余。` : `Lucky draw, ${rule.packetsLeft.toString()} ${name} left. The last one takes the rest.`;
}

function blockReason(rule: RedRule, used: boolean, vol: { spot: number; perp: number }, zh: boolean): string | null {
  if (!rule.deployed) return zh ? "还没部署" : "Not deployed";
  if (!rule.ready || !rule.asset) return zh ? "部署者还没定" : "No rule yet";
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

function blankRule(chain: GiftChain): RedRule {
  return {
    chain,
    address: RED_PACKET[chain],
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
    credit: 0n,
    claimedToday: 0n,
    balance: 0n,
    lastDay: 0n,
    ready: false,
    asset: null,
  };
}

export function RedGift({ account, zh, forceOpen = false }: { account: string | null; zh: boolean; forceOpen?: boolean }) {
  const [open, setOpen] = useState(forceOpen);
  const [desk, setDesk] = useState(false);
  const [books, setBooks] = useState<RedRule[]>([blankRule("xlayer"), blankRule("bsc")]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [fund, setFund] = useState<Record<GiftChain, string>>({ xlayer: "", bsc: "" });
  const [pop, setPop] = useState<{ name: string; amount: string } | null>(null);
  const [assetId, setAssetId] = useState("usdt");
  const [mode, setMode] = useState(0);
  const [fixedText, setFixedText] = useState("1");
  const [loText, setLoText] = useState("0.1");
  const [hiText, setHiText] = useState("1");
  const [packets, setPackets] = useState("10");
  const [dayCap, setDayCap] = useState("0");
  const [spotText, setSpotText] = useState("100");
  const [perpText, setPerpText] = useState("100");
  const [gate, setGate] = useState(0);
  const day = sgDay();
  const used = claimedHere() || (books ?? []).some((book) => book.lastDay === BigInt(day));
  const mine = (books ?? []).find((book) => account && giftDeployer(book.chain).toLowerCase() === account.toLowerCase()) ?? null;

  const reload = () => {
    void Promise.all([
      readRed("xlayer", account).catch(() => blankRule("xlayer")),
      readRed("bsc", account).catch(() => blankRule("bsc")),
    ]).then(setBooks);
  };

  useEffect(() => {
    if (!open) return;
    reload();
  }, [open, account]);

  const who = async () => {
    if (account) return account;
    const eth = await ensureProvider();
    const rows = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    if (!rows[0]) throw new Error("nowallet");
    return rows[0];
  };

  const run = async (job: () => Promise<"cheer" | void>) => {
    setBusy(true);
    setBad(false);
    setNote("");
    try {
      const kind = await job();
      if (kind !== "cheer") setNote(zh ? "已提交。" : "Submitted.");
      reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setBad(true);
      if ((err as { code?: number }).code === 4001) setNote(zh ? "没有签名。" : "Not signed.");
      else if (message === "day") setNote(zh ? "今天已经领过。BSC 和 X Layer 算同一天，明天再来。" : "Already claimed today. BSC and X Layer share the day.");
      else if (message === "empty") setNote(zh ? "池子不够这一份。" : "The pool cannot cover this packet.");
      else if (message === "safe") setNote(zh ? "要用这条链的多签来部署。" : "Deploy with this chain's multisig.");
      else if (message === "cap") setNote(zh ? "今天的名额满了。明天 0 点重新开始。" : "Today's places are full. It starts again at midnight.");
      else if (message === "rule") setNote(zh ? "部署者还没写入规则。" : "The deployer has not saved a rule.");
      else if (message === "dust") setNote(zh ? "池子里还有上一种资产，先领完再换。" : "The pool still holds the previous asset. Claim it before switching.");
      else if (message === "packets") setNote(zh ? "拼手气要写这一轮有几个。" : "Lucky draw needs a packet count.");
      else setNote(zh ? "这一下没有完成。" : "It did not finish.");
    } finally {
      setBusy(false);
    }
  };

  const claim = (chain: GiftChain, asset: GiftAsset | null) => {
    if (used) {
      setBad(true);
      setNote(zh ? "每天只能参加一次。今天在另一条链领过，这一条也关掉。" : "One claim a day. The other chain was already used today.");
      return;
    }
    const rule = books.find((book) => book.chain === chain);
    const vol = readDeskVolume(chain, account);
    if (!rule || !meetsVolume(rule.gate, rule.spotNeed, rule.perpNeed, vol)) {
      setBad(true);
      setNote(zh ? "今天的交易量还没到部署者写的门槛。" : "Today's volume is still under the deployer's line.");
      return;
    }
    void run(async () => {
      const from = await who();
      const got = await claimRed(chain, from);
      const text = asset ? `${giftText(got.amount, asset)} ${zh ? asset.zh : asset.en}` : "";
      setPop({ name: asset ? (zh ? asset.zh : asset.en) : "", amount: text });
      return "cheer" as const;
    });
  };

  return (
    <div className="border border-[#e6c36a]/50 bg-card text-ink">
      <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="text-sm text-ink">{zh ? "新手礼包" : "Gift"}</span>
        <span className="text-sm text-ink">{open ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {open ? (
        <div className="border-t border-gold/30 px-4 py-4">
          <p className="text-base leading-7 text-ink">
            {zh
              ? "X Layer 和 BSC 两本都在下面。先看今天的现货和合约成交额够不够，够了才能拆。每天一次，两条链算同一天。交易额是这台浏览器记下的、今天这个钱包签成功的成交。"
              : "X Layer and BSC are both listed. Check today's spot and perp volume before opening. One claim a day across both chains. Volume is what this browser recorded for this wallet today."}
          </p>
          {books.map((book) => {
            const vol = readDeskVolume(book.chain, account);
            const why = blockReason(book, used, vol, zh);
            const name = book.asset ? (zh ? book.asset.zh : book.asset.en) : "";
            const spot = needUsd(book.spotNeed);
            const perp = needUsd(book.perpNeed);
            return (
            <div key={book.chain} className="mt-3 border border-[#e6c36a]/40 bg-paper px-3 py-3 text-base text-ink">
              <p className="text-sm text-[#e6c36a]">{book.chain === "xlayer" ? "X Layer" : "BSC"}</p>
              <p className="mt-1 text-ink">{modeLine(book, zh)}</p>
              <p className="mt-1 text-ink">
                {zh ? "现货" : "Spot"} {vol.spot.toFixed(2)} / {spot.toFixed(2)} USDT
                <span className="mx-1">{book.gate === 1 ? (zh ? "并且" : "and") : (zh ? "或者" : "or")}</span>
                {zh ? "合约" : "Perp"} {vol.perp.toFixed(2)} / {perp.toFixed(2)} USDT
              </p>
              <p className={`mt-1 text-xs ${meetsVolume(book.gate, book.spotNeed, book.perpNeed, vol) ? "text-up" : "text-sell"}`}>
                {meetsVolume(book.gate, book.spotNeed, book.perpNeed, vol) ? (zh ? "交易量符合" : "Volume qualifies") : (zh ? "交易量还不符合" : "Volume does not qualify")}
              </p>
              <p className="mt-1 font-mono text-sm text-ink">
                {zh ? "池子" : "Pool"} {book.asset ? `${giftText(book.balance, book.asset)} ${name}` : "—"}
                {book.credit > 0n && book.asset ? (zh ? ` · 你可取回 ${giftText(book.credit, book.asset)}` : ` · you can take back ${giftText(book.credit, book.asset)}`) : ""}
                {book.dayCap > 0n ? (zh ? ` · 今日 ${book.claimedToday.toString()}/${book.dayCap.toString()}` : ` · today ${book.claimedToday.toString()}/${book.dayCap.toString()}`) : ""}
              </p>
              {book.deployed && book.asset ? (
                <div className="mt-2 flex gap-2">
                  <input value={fund[book.chain]} onChange={(e) => setFund((prev) => ({ ...prev, [book.chain]: e.target.value }))} inputMode="decimal" placeholder={zh ? `充入 ${name}` : `Deposit ${name}`} className="h-11 min-w-0 flex-1 border border-[#e6c36a]/40 bg-card px-3 font-mono text-base text-ink outline-none placeholder:text-ink/80" />
                  <button type="button" className="h-11 shrink-0 border border-gold px-3 text-sm disabled:opacity-40" disabled={busy} onClick={() => { const asset = book.asset; if (!asset) return; void run(async () => { await fundRed(book.chain, await who(), fund[book.chain], asset); setFund((prev) => ({ ...prev, [book.chain]: "" })); }); }}>{zh ? "充入" : "Deposit"}</button>
                  {book.credit > 0n ? <button type="button" className="h-11 shrink-0 border border-gold/40 px-3 text-sm disabled:opacity-40" disabled={busy} onClick={() => { const asset = book.asset; if (!asset) return; void run(async () => { await withdrawRed(book.chain, await who(), fund[book.chain], asset); }); }}>{zh ? "取回" : "Take back"}</button> : null}
                </div>
              ) : null}
              <button type="button" className="mt-2 min-h-11 w-full border border-gold px-3 text-sm disabled:opacity-40" disabled={busy || why != null} onClick={() => claim(book.chain, book.asset)}>
                {why ?? (zh ? "打开红包" : "Open the packet")}
              </button>
            </div>
            );
          })}
          {note ? <p className={`mt-2 text-base ${bad ? "text-sell" : "text-ink"}`}>{note}</p> : null}
          {mine ? (
            <div className="mt-4 border-t border-gold/30 pt-3">
              <button type="button" className="flex min-h-11 w-full items-center justify-between border border-[#e6c36a]/40 px-3 text-left text-base text-ink" onClick={() => setDesk((v) => !v)}>
                <span>{zh ? "发红包" : "Set the packet"}</span>
                <span>{desk ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
              </button>
              {desk ? (
                <DeployerDesk zh={zh} chain={mine.chain} busy={busy} assetId={assetId} setAssetId={setAssetId} mode={mode} setMode={setMode} fixedText={fixedText} setFixedText={setFixedText} loText={loText} setLoText={setLoText} hiText={hiText} setHiText={setHiText} packets={packets} setPackets={setPackets} dayCap={dayCap} setDayCap={setDayCap} spotText={spotText} setSpotText={setSpotText} perpText={perpText} setPerpText={setPerpText} gate={gate} setGate={setGate} deployed={mine.deployed} onSave={() => {
                  const asset = GIFT_ASSETS[mine.chain].find((row) => row.id === assetId) ?? GIFT_ASSETS[mine.chain][0];
                  void run(async () => { await setRedRule(mine.chain, await who(), asset, mode, fixedText, loText, hiText, packets, dayCap, spotText, perpText, gate); });
                }} onDeploy={() => { void run(async () => { await deployRed(mine.chain); }); }} />
              ) : null}
              <p className="mt-2 break-all font-mono text-sm text-ink">{RED_PACKET[mine.chain]}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {pop ? <Cheer name={pop.name} amount={pop.amount} zh={zh} onClose={() => setPop(null)} /> : null}
    </div>
  );
}

function DeployerDesk({
  zh, chain, busy, assetId, setAssetId, mode, setMode, fixedText, setFixedText, loText, setLoText, hiText, setHiText, packets, setPackets, dayCap, setDayCap, spotText, setSpotText, perpText, setPerpText, gate, setGate, deployed, onSave, onDeploy,
}: {
  zh: boolean;
  chain: GiftChain;
  busy: boolean;
  assetId: string;
  setAssetId: (v: string) => void;
  mode: number;
  setMode: (v: number) => void;
  fixedText: string;
  setFixedText: (v: string) => void;
  loText: string;
  setLoText: (v: string) => void;
  hiText: string;
  setHiText: (v: string) => void;
  packets: string;
  setPackets: (v: string) => void;
  dayCap: string;
  setDayCap: (v: string) => void;
  spotText: string;
  setSpotText: (v: string) => void;
  perpText: string;
  setPerpText: (v: string) => void;
  gate: number;
  setGate: (v: number) => void;
  deployed: boolean;
  onSave: () => void;
  onDeploy: () => void;
}) {
  const assets = GIFT_ASSETS[chain];
  return (
    <div className="mt-2 border border-[#e6c36a]/40 bg-paper px-3 py-3 text-base text-ink">
      <p>{zh ? "这一页只在多签钱包里出现。" : "This form is shown only to the multisig."}</p>
      <label className="mt-2 block text-ink">{zh ? "资产" : "Asset"}
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="mt-1 h-11 w-full border border-[#e6c36a]/40 bg-card px-2 text-ink">
          {assets.map((row) => <option key={row.id} value={row.id}>{zh ? row.zh : row.en}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-ink">{zh ? "玩法" : "Game"}
        <select value={mode} onChange={(e) => setMode(Number(e.target.value))} className="mt-1 h-11 w-full border border-[#e6c36a]/40 bg-card px-2 text-ink">
          <option value={0}>{zh ? "固定金额" : "Fixed"}</option>
          <option value={1}>{zh ? "随机区间" : "Random range"}</option>
          <option value={2}>{zh ? "拼手气" : "Lucky"}</option>
        </select>
      </label>
      {mode === 0 ? <Field label={zh ? "每个红包" : "Each packet"} value={fixedText} set={setFixedText} /> : null}
      {mode === 1 ? (
        <>
          <Field label={zh ? "最少" : "Min"} value={loText} set={setLoText} />
          <Field label={zh ? "最多" : "Max"} value={hiText} set={setHiText} />
        </>
      ) : null}
      {mode === 2 ? <Field label={zh ? "这一轮几个" : "Packets"} value={packets} set={setPackets} /> : null}
      <Field label={zh ? "今天现货至少多少 USDT" : "Spot volume today, USDT"} value={spotText} set={setSpotText} />
      <Field label={zh ? "今天合约至少多少 USDT" : "Perp volume today, USDT"} value={perpText} set={setPerpText} />
      <label className="mt-2 block text-ink">{zh ? "怎样才算够" : "How it qualifies"}
        <select value={gate} onChange={(e) => setGate(Number(e.target.value))} className="mt-1 h-11 w-full border border-[#e6c36a]/40 bg-card px-2 text-ink">
          <option value={0}>{zh ? "现货或者合约，达到一样" : "Spot or perp"}</option>
          <option value={1}>{zh ? "现货和合约都要达到" : "Spot and perp"}</option>
        </select>
      </label>
      <Field label={zh ? "每天最多几人，0 是不限" : "Daily cap, 0 is none"} value={dayCap} set={setDayCap} />
      <button type="button" className="mt-3 min-h-11 w-full border border-gold text-sm disabled:opacity-40" disabled={busy || !deployed || (mode === 2 && !(Number(packets) > 0)) || (mode === 1 && Number(hiText) < Number(loText))} onClick={onSave}>{zh ? "写入规则" : "Save"}</button>
      <p className="mt-2 text-sm leading-6 text-ink">
        {mode === 0 ? (zh ? `将写成：每个红包固定 ${fixedText || "0"}。` : `Each packet will be ${fixedText || "0"}.`) : null}
        {mode === 1 ? (zh ? `将写成：每个红包在 ${loText || "0"} 和 ${hiText || "0"} 之间随机。` : `Each packet will be random from ${loText || "0"} to ${hiText || "0"}.`) : null}
        {mode === 2 ? (zh ? `将写成：这一轮 ${packets || "0"} 个，前面不超过当时人均的两倍，最后一份拿走剩余。` : `${packets || "0"} packets. Earlier ones stay within twice the average. The last takes the rest.`) : null}
        {zh ? ` ${chain === "bsc" ? "BSC" : "X Layer"} 今天现货 ${spotText || "0"} USDT，合约 ${perpText || "0"} USDT，${gate === 1 ? "两样都要达到" : "达到一样即可"}。0 表示这一样不要求。` : ` ${chain === "bsc" ? "BSC" : "X Layer"} spot ${spotText || "0"}, perp ${perpText || "0"}. ${gate === 1 ? "Both." : "Either."}`}
      </p>
      {!deployed ? <button type="button" className="mt-2 min-h-11 w-full border border-gold/40 text-sm disabled:opacity-40" disabled={busy} onClick={onDeploy}>{zh ? "用多签部署" : "Deploy"}</button> : null}
    </div>
  );
}

function Field({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <label className="mt-2 block text-ink">{label}
      <input value={value} onChange={(e) => set(e.target.value)} className="mt-1 h-11 w-full border border-[#e6c36a]/40 bg-card px-2 font-mono text-ink" />
    </label>
  );
}

function Cheer({ amount, zh, onClose }: { name: string; amount: string; zh: boolean; onClose: () => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6" onClick={onClose}>
      <button type="button" className="w-full max-w-sm border border-gold bg-paper px-6 py-8 text-center" onClick={(e) => { e.stopPropagation(); setOpened(true); }}>
        <svg viewBox="0 0 120 150" className={`mx-auto h-40 w-32 ${opened ? "tl-god" : ""}`} aria-hidden="true">
          <rect x="28" y="58" width="64" height="78" rx="4" fill="#8c1c1c" />
          <rect x="28" y="88" width="64" height="14" fill="#e6c36a" />
          <rect x="54" y="58" width="12" height="78" fill="#e6c36a" />
          {opened ? (
            <>
              <circle cx="60" cy="34" r="16" fill="#f3d2b3" />
              <path d="M44 30h32v8H44z" fill="#111" />
              <path d="M48 22h24l4 8H44z" fill="#c9a227" />
              <path d="M46 42c6 8 22 8 28 0" fill="none" stroke="#111" strokeWidth="2" />
              <circle cx="54" cy="36" r="1.5" fill="#111" />
              <circle cx="66" cy="36" r="1.5" fill="#111" />
            </>
          ) : (
            <path d="M40 58c8-16 32-16 40 0" fill="#6e1212" stroke="#e6c36a" strokeWidth="3" />
          )}
        </svg>
        {opened ? (
          <>
            <p className="mt-3 font-display text-3xl text-[#e6c36a]">{zh ? "恭喜发财" : "Fortune"}</p>
            <p className="mt-2 font-mono text-lg text-ink">{amount}</p>
            <p className="mt-1 text-base text-ink">{zh ? "财神爷把这一份送到这个钱包。" : "This packet is in the wallet."}</p>
          </>
        ) : (
          <p className="mt-3 text-base text-ink">{zh ? "点开红包" : "Tap the packet"}</p>
        )}
      </button>
    </div>
  );
}

export function RedDeploy() {
  const zh = useExchange((s) => s.lang) === "zh";
  const [left, setLeft] = useState<GiftChain[] | null>(null);
  const [busy, setBusy] = useState<GiftChain | null>(null);
  const [note, setNote] = useState("");
  const look = () => {
    void Promise.all([redCode("xlayer"), redCode("bsc")])
      .then(([x, b]) => {
        const open: GiftChain[] = [];
        if (!x) open.push("xlayer");
        if (!b) open.push("bsc");
        setLeft(open);
      })
      .catch(() => setLeft(["xlayer", "bsc"]));
  };
  useEffect(() => { look(); }, []);
  if (!left || left.length === 0) return null;
  const go = async (chain: GiftChain) => {
    setBusy(chain);
    setNote("");
    try {
      await deployRed(chain);
      setNote(zh ? "这一本已经上链。" : "This one is on chain.");
      look();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setNote(message === "safe" ? (zh ? "要用这条链的多签来签。" : "Sign with this chain's multisig.") : (zh ? "没有部署成功。" : "Deploy did not finish."));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="border border-[#e6c36a] bg-card px-4 py-4 text-base text-ink">
      <h2 className="text-lg text-[#e6c36a]">{zh ? "部署红包池" : "Deploy the pools"}</h2>
      <p className="mt-2 leading-7">
        {zh
          ? "每条链只部署一次。X Layer 连 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c。BSC 连 0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd。两本都上链后，这一页自己消失。"
          : "Deploy each chain once, with that chain's multisig. This page leaves after both are on chain."}
      </p>
      {left.map((chain) => (
        <div key={chain} className="mt-3 border border-[#e6c36a]/40 bg-paper px-3 py-3">
          <p>{chain === "xlayer" ? "X Layer" : "BSC"}</p>
          <p className="mt-1 break-all font-mono text-sm">{RED_PACKET[chain]}</p>
          <button type="button" className="mt-2 min-h-11 w-full border border-[#e6c36a] text-ink disabled:opacity-40" disabled={busy != null} onClick={() => { void go(chain); }}>
            {zh ? "用多签部署" : "Deploy"}
          </button>
        </div>
      ))}
      {note ? <p className="mt-2">{note}</p> : null}
    </section>
  );
}
