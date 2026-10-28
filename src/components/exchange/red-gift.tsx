import { useEffect, useState } from "react";
import {
  GIFT_ASSETS,
  RED_PACKET,
  claimRed,
  claimedHere,
  deployRed,
  filledToday,
  fundRed,
  giftDeployer,
  giftText,
  readRed,
  setRedRule,
  sgDay,
  type GiftAsset,
  type GiftChain,
  type RedRule,
} from "@/lib/red-packet";
import { ensureProvider } from "@/lib/wallet";

function modeLine(rule: RedRule, zh: boolean): string {
  const name = rule.asset ? (zh ? rule.asset.zh : rule.asset.en) : "—";
  if (!rule.deployed || !rule.asset) return zh ? "部署者还没定今天发什么。" : "The deployer has not chosen an asset.";
  if (rule.mode === 0) return zh ? `固定 ${giftText(rule.fixedAmt, rule.asset)} ${name}` : `Fixed ${giftText(rule.fixedAmt, rule.asset)} ${name}`;
  if (rule.mode === 1) return zh ? `随机 ${giftText(rule.lo, rule.asset)} 到 ${giftText(rule.hi, rule.asset)} ${name}` : `Random ${giftText(rule.lo, rule.asset)}–${giftText(rule.hi, rule.asset)} ${name}`;
  return zh ? `拼手气，还剩 ${rule.packetsLeft.toString()} 个 ${name}` : `Lucky draw, ${rule.packetsLeft.toString()} left, ${name}`;
}

export function RedGift({ account, zh }: { account: string | null; zh: boolean }) {
  const [open, setOpen] = useState(false);
  const [desk, setDesk] = useState(false);
  const [books, setBooks] = useState<RedRule[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [fund, setFund] = useState("");
  const [pop, setPop] = useState<{ name: string } | null>(null);
  const [assetId, setAssetId] = useState("usdt");
  const [mode, setMode] = useState(0);
  const [fixedText, setFixedText] = useState("1");
  const [loText, setLoText] = useState("0.1");
  const [hiText, setHiText] = useState("1");
  const [packets, setPackets] = useState("10");
  const [dayCap, setDayCap] = useState("0");
  const day = sgDay();
  const used = claimedHere() || (books ?? []).some((book) => book.lastDay === BigInt(day));
  const mine = (books ?? []).find((book) => account && giftDeployer(book.chain).toLowerCase() === account.toLowerCase()) ?? null;

  const reload = () => {
    void Promise.all([readRed("xlayer", account), readRed("bsc", account)]).then(setBooks).catch(() => setBooks(null));
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

  const run = async (job: () => Promise<unknown>, cheer?: string) => {
    setBusy(true);
    setBad(false);
    setNote("");
    try {
      await job();
      if (cheer) setPop({ name: cheer });
      else setNote(zh ? "已提交。" : "Submitted.");
      reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setBad(true);
      if ((err as { code?: number }).code === 4001) setNote(zh ? "没有签名。" : "Not signed.");
      else if (message === "day") setNote(zh ? "今天已经领过。BSC 和 X Layer 算同一天，明天再来。" : "Already claimed today. BSC and X Layer share the day.");
      else if (message === "empty") setNote(zh ? "池子不够这一份。" : "The pool cannot cover this packet.");
      else if (message === "safe") setNote(zh ? "要用这条链的多签来部署。" : "Deploy with this chain's multisig.");
      else if (message === "deployer") setNote(zh ? "只有部署者能改规则。" : "Only the deployer can change the rules.");
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
    if (!filledToday(chain)) {
      setBad(true);
      setNote(zh ? "先在这条链做成一笔现货或合约。换了浏览器要再成交一次。" : "Fill a spot or perp on this chain first. A new browser needs another fill.");
      return;
    }
    void run(async () => claimRed(chain, await who()), asset ? (zh ? asset.zh : asset.en) : "");
  };

  return (
    <div className="border border-gold">
      <button type="button" className="flex min-h-12 w-full items-center justify-between px-4 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="text-[11px] tracking-[0.22em] text-gold">{zh ? "新手礼包" : "Gift"}</span>
        <span className="text-xs text-ink/50">{open ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
      </button>
      {open ? (
        <div className="border-t border-gold/30 px-4 py-4">
          <p className="text-sm leading-6 text-ink/80">
            {zh ? "每天只能参加一次。BSC 和 X Layer 算同一天，领了一条，另一条今天就不能再领。" : "One claim a day. BSC and X Layer count as the same day."}
          </p>
          {(books ?? []).map((book) => (
            <div key={book.chain} className="mt-3 border border-gold/30 px-3 py-3 text-sm">
              <p className="text-xs tracking-[0.16em] text-ink/50">{book.chain === "xlayer" ? "X Layer" : "BSC"}</p>
              <p className="mt-1 text-ink/80">{modeLine(book, zh)}</p>
              <p className="mt-1 font-mono text-xs text-ink/50">
                {zh ? "池子" : "Pool"} {book.asset ? `${giftText(book.balance, book.asset)} ${zh ? book.asset.zh : book.asset.en}` : "—"}
                {book.dayCap > 0n ? (zh ? ` · 今日已领 ${book.claimedToday.toString()}/${book.dayCap.toString()}` : ` · today ${book.claimedToday.toString()}/${book.dayCap.toString()}`) : ""}
              </p>
              {book.deployed && book.asset ? (
                <div className="mt-2 flex gap-2">
                  <input value={fund} onChange={(e) => setFund(e.target.value)} inputMode="decimal" placeholder={zh ? "充入金额" : "Deposit"} className="h-11 min-w-0 flex-1 border border-gold/40 bg-transparent px-3 font-mono text-sm outline-none" />
                  <button type="button" className="h-11 shrink-0 border border-gold px-3 text-sm disabled:opacity-40" disabled={busy} onClick={() => { void run(async () => fundRed(book.chain, await who(), fund, book.asset as GiftAsset)); }}>{zh ? "充入" : "Deposit"}</button>
                </div>
              ) : null}
              <button type="button" className="mt-2 min-h-11 w-full border border-gold px-3 text-sm disabled:opacity-40" disabled={busy || !book.deployed || !book.asset || used} onClick={() => claim(book.chain, book.asset)}>
                {used ? (zh ? "今天已经参加过" : "Already joined today") : zh ? "领红包" : "Open the packet"}
              </button>
            </div>
          ))}
          {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : "text-ink/70"}`}>{note}</p> : null}
          {mine ? (
            <div className="mt-4 border-t border-gold/30 pt-3">
              <button type="button" className="flex min-h-11 w-full items-center justify-between border border-gold/40 px-3 text-left text-sm" onClick={() => setDesk((v) => !v)}>
                <span>{zh ? "发红包" : "Set the packet"}</span>
                <span className="text-ink/50">{desk ? (zh ? "收起" : "Hide") : (zh ? "打开" : "Open")}</span>
              </button>
              {desk ? (
                <DeployerDesk zh={zh} chain={mine.chain} busy={busy} assetId={assetId} setAssetId={setAssetId} mode={mode} setMode={setMode} fixedText={fixedText} setFixedText={setFixedText} loText={loText} setLoText={setLoText} hiText={hiText} setHiText={setHiText} packets={packets} setPackets={setPackets} dayCap={dayCap} setDayCap={setDayCap} deployed={mine.deployed} onSave={() => {
                  const asset = GIFT_ASSETS[mine.chain].find((row) => row.id === assetId) ?? GIFT_ASSETS[mine.chain][0];
                  void run(async () => setRedRule(mine.chain, await who(), asset, mode, fixedText, loText, hiText, packets, dayCap));
                }} onDeploy={() => { void run(async () => deployRed(mine.chain)); }} />
              ) : null}
              <p className="mt-2 break-all font-mono text-[11px] text-ink/40">{RED_PACKET[mine.chain]}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {pop ? <Cheer name={pop.name} zh={zh} onClose={() => setPop(null)} /> : null}
    </div>
  );
}

function DeployerDesk({
  zh, chain, busy, assetId, setAssetId, mode, setMode, fixedText, setFixedText, loText, setLoText, hiText, setHiText, packets, setPackets, dayCap, setDayCap, deployed, onSave, onDeploy,
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
  deployed: boolean;
  onSave: () => void;
  onDeploy: () => void;
}) {
  const assets = GIFT_ASSETS[chain];
  return (
    <div className="mt-2 border border-gold/30 px-3 py-3 text-sm">
      <p className="text-xs text-ink/50">{zh ? "这一页只在多签钱包里出现。" : "This form is shown only to the multisig."}</p>
      <label className="mt-2 block text-xs text-ink/50">{zh ? "资产" : "Asset"}
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className="mt-1 h-11 w-full border border-gold/40 bg-paper px-2">
          {assets.map((row) => <option key={row.id} value={row.id}>{zh ? row.zh : row.en}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-xs text-ink/50">{zh ? "玩法" : "Game"}
        <select value={mode} onChange={(e) => setMode(Number(e.target.value))} className="mt-1 h-11 w-full border border-gold/40 bg-paper px-2">
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
      <Field label={zh ? "每天最多几人，0 是不限" : "Daily cap, 0 is none"} value={dayCap} set={setDayCap} />
      <button type="button" className="mt-3 min-h-11 w-full border border-gold text-sm disabled:opacity-40" disabled={busy || !deployed} onClick={onSave}>{zh ? "写入规则" : "Save"}</button>
      {!deployed ? <button type="button" className="mt-2 min-h-11 w-full border border-gold/40 text-sm disabled:opacity-40" disabled={busy} onClick={onDeploy}>{zh ? "用多签部署" : "Deploy"}</button> : null}
    </div>
  );
}

function Field({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return (
    <label className="mt-2 block text-xs text-ink/50">{label}
      <input value={value} onChange={(e) => set(e.target.value)} className="mt-1 h-11 w-full border border-gold/40 bg-transparent px-2 font-mono" />
    </label>
  );
}

function Cheer({ name, zh, onClose }: { name: string; zh: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6" onClick={onClose}>
      <div className="w-full max-w-sm border border-gold bg-paper px-6 py-8 text-center" onClick={(e) => e.stopPropagation()}>
        <svg viewBox="0 0 120 140" className="mx-auto h-36 w-28" aria-hidden="true">
          <rect x="28" y="48" width="64" height="78" rx="4" fill="#8c1c1c" />
          <rect x="28" y="78" width="64" height="14" fill="#e6c36a" />
          <rect x="54" y="48" width="12" height="78" fill="#e6c36a" />
          <path d="M40 48c8-18 32-18 40 0" fill="none" stroke="#e6c36a" strokeWidth="4" />
          <circle cx="60" cy="28" r="16" fill="#f3d2b3" />
          <path d="M44 24h32v8H44z" fill="#111" />
          <path d="M48 18h24l4 8H44z" fill="#c9a227" />
          <path d="M46 36c6 10 22 10 28 0" fill="none" stroke="#111" strokeWidth="2" />
          <circle cx="54" cy="30" r="1.5" fill="#111" />
          <circle cx="66" cy="30" r="1.5" fill="#111" />
        </svg>
        <p className="mt-3 font-display text-3xl italic text-gold">{zh ? "恭喜发财" : "Fortune"}</p>
        <p className="mt-2 text-sm text-ink/70">{zh ? `财神爷把 ${name} 红包送到这个钱包。` : `The packet of ${name} is in this wallet.`}</p>
        <button type="button" className="mt-4 min-h-11 border border-gold px-4 text-sm" onClick={onClose}>{zh ? "收下" : "Close"}</button>
      </div>
    </div>
  );
}
