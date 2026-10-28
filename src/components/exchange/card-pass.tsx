import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useExchange } from "@/lib/exchange-store";
import { readGateChain } from "@/lib/gate-chain";
import { BSC_REBATE, KNOWN_XPERP, readPerp, type LiveDeal } from "@/lib/perp";
import { bestHeld, DESK_LABEL, deskFeeBps, type PunkCard } from "@/lib/punk-card";
import { readCpunkWallet } from "@/lib/cpunk-desk";
import { currentAccount, getProvider, onAccount } from "@/lib/wallet";

const PASS = "tapeliquid-fee-pass";

function passKey(address: string) {
  return `${PASS}:${address.toLowerCase()}`;
}

function money(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function perpFee(deals: LiveDeal[], account: string) {
  const who = account.toLowerCase();
  let usd = 0;
  for (const deal of deals) {
    if (deal.long.toLowerCase() === who) usd += Number(formatUnits(deal.marginL, 18)) * 0.002;
    if (deal.short.toLowerCase() === who) usd += Number(formatUnits(deal.marginS, 18)) * 0.002;
  }
  return usd;
}

export function CardPass() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [ids, setIds] = useState<number[] | null>(null);
  const [card, setCard] = useState<PunkCard | null>(null);
  const [spent, setSpent] = useState<number | null>(null);

  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    const jump = () => {
      if (window.location.hash === "#card") document.getElementById("card-pass")?.scrollIntoView({ block: "start" });
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);
  useEffect(() => {
    setSigned(Boolean(account && window.localStorage.getItem(passKey(account))));
    setIds(null);
    setCard(null);
    setSpent(null);
    setNote("");
    if (!account) return;
    let dead = false;
    readCpunkWallet(account as `0x${string}`)
      .then((wallet) => {
        if (dead) return;
        setIds(wallet.ids);
        setCard(bestHeld(wallet.ids));
      })
      .catch(() => {
        if (!dead) setNote(zh ? "持有的 Circuit Punk 这次没读到。" : "Owned Circuit Punks did not load.");
      });
    Promise.all([
      readPerp(BSC_REBATE, account).then((view) => perpFee(view.liveDeals, account)).catch(() => 0),
      readGateChain(KNOWN_XPERP)
        .then((book) => book.deals.reduce((sum, deal) => {
          const who = account.toLowerCase();
          if (deal.longUser.toLowerCase() === who) return sum + deal.marginL * 0.002;
          if (deal.shortUser.toLowerCase() === who) return sum + deal.marginS * 0.002;
          return sum;
        }, 0))
        .catch(() => 0),
    ]).then(([bsc, xlayer]) => {
      if (!dead) setSpent(bsc + xlayer);
    });
    return () => {
      dead = true;
    };
  }, [account, zh]);

  const sign = async () => {
    if (!account) return;
    const eth = getProvider();
    if (!eth) {
      setNote(zh ? "先连接钱包。" : "Connect a wallet first.");
      return;
    }
    setBusy(true);
    try {
      const signature = await eth.request({ method: "personal_sign", params: [PASS, account] });
      window.localStorage.setItem(passKey(account), String(signature));
      setSigned(true);
      setNote(zh ? "这个钱包已确认。卡还没锁进合约，成交仍收 0.20%。" : "This wallet is confirmed. The card is not locked yet, so fills still pay 0.20%.");
    } catch (error) {
      setNote(error instanceof Error ? error.message : (zh ? "没有签成。" : "The signature did not finish."));
    } finally {
      setBusy(false);
    }
  };

  const bps = card ? deskFeeBps(card, "perp") : 20;
  const back = spent == null || !card ? null : spent * (20 - bps) / 20;
  const mainName = card?.main ? DESK_LABEL[card.main] : "";

  return (
    <section id="card-pass" className="border border-gold px-4 py-4">
      <p className="text-[11px] tracking-[0.22em] text-gold">{zh ? "合成卡" : "Crafted card"}</p>
      <h2 className="mt-1 text-lg">{zh ? "确认身份" : "Confirm this wallet"}</h2>
      <p className="mt-2 text-sm leading-6 text-ink/70">
        {zh
          ? "签一笔 tapeliquid-fee-pass，不另开账户。签完按这个钱包链上的 Circuit Punk 认出最高的一张。一个钱包只认最高的，不能叠加。只减本站 0.20% 的台费。"
          : "Sign tapeliquid-fee-pass. No new account. The highest card is read from the Circuit Punks this wallet holds. One wallet, the highest card only. Only the 0.20% site fee can come back."}
      </p>
      {!account ? <p className="mt-3 text-sm">{zh ? "先在右上角连接钱包。" : "Connect a wallet at the top right."}</p> : null}
      {account ? (
        <button type="button" className="mt-3 min-h-10 border border-gold px-3 text-sm disabled:opacity-40" disabled={busy || signed} onClick={() => void sign()}>
          {signed ? (zh ? "已确认" : "Confirmed") : busy ? (zh ? "等待签名" : "Waiting") : (zh ? "确认这个钱包" : "Confirm this wallet")}
        </button>
      ) : null}
      {ids && card ? (
        <div className="mt-4 border border-gold/40 p-3" style={{ borderLeftWidth: 6, borderLeftColor: card.edge ?? card.color }}>
          <p className="text-base font-medium" style={{ color: card.color }}>{card.name}</p>
          <p className="mt-1 text-sm leading-6">
            {zh ? `全场台费 ${(card.feeAll / 100).toFixed(2)}%。` : `All desks ${(card.feeAll / 100).toFixed(2)}%. `}
            {card.main ? (zh ? `主属性是${mainName}，这一边 ${(card.feeMain / 100).toFixed(2)}%。` : `Main desk ${card.main} is ${(card.feeMain / 100).toFixed(2)}%.`) : (zh ? "没有主属性再减。" : "No extra main-desk cut.")}
          </p>
          <p className="mt-1 text-xs leading-5 text-ink/60">
            {DESK_LABEL.spot} {card.stats.spot} · {DESK_LABEL.perp} {card.stats.perp} · {DESK_LABEL.circuit} {card.stats.circuit} · {DESK_LABEL.launch} {card.stats.launch}
          </p>
          <p className="mt-1 text-xs text-ink/50">{zh ? "材料" : "Inputs"} #{card.ids.join(" #")}</p>
        </div>
      ) : null}
      {ids && !card ? <p className="mt-3 text-sm">{zh ? `这个钱包有 ${ids.length} 张，还组不出一张卡。` : `This wallet holds ${ids.length}. They do not make a card yet.`}</p> : null}
      {ids === null && account ? <p className="mt-3 text-sm text-ink/60">{zh ? "正在读链上的 Circuit Punk。" : "Reading Circuit Punks on chain."}</p> : null}
      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        <p className="border-t border-gold/30 pt-2"><span className="block text-xs text-ink/50">{zh ? "看到的永续台费" : "Perp desk fee seen"}</span>{spent == null ? "—" : `${money(spent)} USDT`}</p>
        <p className="border-t border-gold/30 pt-2"><span className="block text-xs text-ink/50">{zh ? "这张卡应取回" : "This card would return"}</span>{back == null ? "—" : `${money(back)} USDT`}</p>
        <p className="border-t border-gold/30 pt-2"><span className="block text-xs text-ink/50">{zh ? "现在能取回" : "Claimable now"}</span>0 USDT</p>
      </div>
      <p className="mt-3 text-xs leading-5 text-ink/55">
        {zh
          ? "只数最近还开着的永续，按保证金的 0.20% 估算。现货、电路、发射和已经平掉的单没有按钱包汇总，这里不猜。锁卡合约上线前，应取回只是预览，现在能取回是 0。成交仍先收 0.20%。"
          : "Only recent open perpetuals, estimated at 0.20% of margin. Spot, circuits, launch, and closed fills are not summed. Until the lock contract is deployed, the return is a preview and nothing can be claimed. Fills still charge 0.20% first."}
      </p>
      {note ? <p className="mt-2 text-xs leading-5">{note}</p> : null}
    </section>
  );
}
