import { useEffect, useState } from "react";
import { copy } from "@/lib/copy";
import { pretty } from "@/lib/bsc";
import { useExchange } from "@/lib/exchange-store";
import { nickOf, readNicks, writeNick } from "@/lib/nicks";
import { getRebateBook, type RebateBook } from "@/lib/rebate-index";
import {
  bindCode,
  bookOf,
  claimRebate,
  claimTier,
  CLAIM_STEPS,
  codeText,
  deployBscBook,
  hasRebates,
  lookupCode,
  OLD_CLAIM_STEPS,
  readRebate,
  registerCode,
  type Desk,
} from "@/lib/perp";

const zero = "0x0000000000000000000000000000000000000000";

export function MineDesk({
  account,
  busy,
  addresses,
  chain,
  run,
  onBook,
  onChain,
}: {
  account: string | null;
  busy: boolean;
  addresses: string[];
  chain: Desk;
  run: (task: (from: string) => Promise<unknown>) => Promise<void>;
  onBook?: (addr: string) => void;
  onChain?: (next: Desk) => void;
}) {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [nicks, setNicks] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [bind, setBind] = useState("");
  const [live, setLive] = useState(false);
  const [accrued, setAccrued] = useState(0n);
  const [referrer, setReferrer] = useState("");
  const [mine, setMine] = useState("");
  const [tier, setTier] = useState(1);
  const [who, setWho] = useState("");
  const [ask, setAsk] = useState("");
  const [bindNote, setBindNote] = useState("");
  const [book, setBook] = useState<RebateBook | null>(null);
  const urlRef = useState(() => {
    if (typeof window === "undefined") return "";
    return (new URLSearchParams(window.location.hash.replace(/^#/, "")).get("ref") || new URLSearchParams(window.location.search).get("ref") || "").trim().slice(0, 16);
  })[0];
  const perp = bookOf(chain);
  const dec = chain === "xlayer" ? 6 : 18;

  useEffect(() => {
    const saved = readNicks();
    setNicks(saved);
    const next: Record<string, string> = {};
    for (const addr of addresses) next[addr.toLowerCase()] = nickOf(addr, saved);
    setDraft(next);
  }, [addresses]);

  useEffect(() => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(perp)) return;
    let dead = false;
    hasRebates(chain).then((ok) => {
      if (!dead) setLive(ok);
    });
    claimTier(chain).then((next) => {
      if (!dead) setTier(next);
    });
    if (account) {
      readRebate(chain, account)
        .then((row) => {
          if (dead) return;
          setAccrued(row.accrued);
          setReferrer(row.referrer);
          setMine(codeText(row.code));
        })
        .catch(() => undefined);
    }
    return () => {
      dead = true;
    };
  }, [account, busy, chain, perp]);

  useEffect(() => {
    if (!live || !urlRef || (referrer && referrer !== zero)) return;
    let dead = false;
    setBind(urlRef);
    lookupCode(chain, urlRef)
      .then((owner) => {
        if (dead) return;
        if (!owner || owner.toLowerCase() === zero) {
          setBindNote(c.rebateNone);
          return;
        }
        if (account && owner.toLowerCase() === account.toLowerCase()) {
          setBindNote(lang === "zh" ? "这是你自己的码" : "This is your own code");
          return;
        }
        setAsk(urlRef);
        setWho(owner);
      })
      .catch(() => {
        if (!dead) setBindNote(c.rebateNone);
      });
    return () => {
      dead = true;
    };
  }, [live, chain, urlRef, referrer, account, c.rebateNone, lang]);

  useEffect(() => {
    if (chain !== "xlayer" || !account) return;
    let dead = false;
    const tick = () => {
      getRebateBook({ data: { account } })
        .then((next) => {
          if (!dead) setBook(next);
        })
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, [account, chain, busy]);

  const locked = Boolean(referrer && referrer !== zero);
  const steps = tier >= 2 ? CLAIM_STEPS : OLD_CLAIM_STEPS;

  async function review() {
    setBindNote("");
    setWho("");
    setAsk("");
    try {
      const owner = await lookupCode(chain, bind);
      if (!owner || owner.toLowerCase() === zero) {
        setBindNote(c.rebateNone);
        return;
      }
      if (account && owner.toLowerCase() === account.toLowerCase()) {
        setBindNote(lang === "zh" ? "不能绑定自己的推荐码" : "You cannot bind your own code");
        return;
      }
      setAsk(bind.trim());
      setWho(owner);
    } catch {
      setBindNote(c.rebateNone);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="border border-gold p-3">
        <p className="text-xs tracking-widest text-gold">{c.nickTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink/70">{c.nickHint}</p>
        {addresses.length === 0 ? <p className="mt-2 text-sm text-ink/60">—</p> : null}
        {addresses.map((addr) => (
          <label key={addr} className="mt-2 block">
            <span className="break-all font-mono text-xs">{nickOf(addr, nicks) ? `${nickOf(addr, nicks)} · ` : ""}{addr}</span>
            <span className="mt-1 flex gap-2">
              <input
                value={draft[addr.toLowerCase()] ?? ""}
                onChange={(event) => setDraft((prev) => ({ ...prev, [addr.toLowerCase()]: event.target.value.slice(0, 16) }))}
                className="min-h-11 min-w-0 flex-1 border border-gold bg-transparent px-2 font-mono outline-none"
              />
              <button
                type="button"
                className="min-h-11 border border-gold px-3"
                onClick={() => {
                  writeNick(addr, draft[addr.toLowerCase()] ?? "");
                  setNicks(readNicks());
                }}
              >
                {c.nickSave}
              </button>
            </span>
          </label>
        ))}
      </section>
      <section className="border border-gold p-3">
        <p className="text-xs tracking-widest text-gold">{c.rebateTitle}</p>
        <p className="mt-1 text-sm leading-relaxed text-ink/70">{c.rebateHint}</p>
        {!live && chain === "bsc" ? (
          <div className="mt-2 flex flex-col gap-2">
            <button type="button" className="min-h-11 bg-ink px-3 text-paper" onClick={() => onChain?.("xlayer")}>
              {c.inviteGo}
            </button>
            <p className="text-sm leading-relaxed">{c.rebateBsc}</p>
            <button
              type="button"
              className="min-h-11 border border-gold px-3"
              disabled={busy}
              onClick={() =>
                run(async (from) => {
                  const addr = await deployBscBook(from);
                  onBook?.(addr);
                  setLive(true);
                  return addr;
                })
              }
            >
              {c.bscDeploy}
            </button>
          </div>
        ) : null}
        {!live && chain !== "bsc" ? <p className="mt-2 text-sm leading-relaxed">{c.rebateBsc}</p> : null}
        {live ? (
          <>
            <p className="mt-2 text-sm leading-relaxed">{c.rebateShared}</p>
            <p className="mt-2 break-all font-mono text-xs">{perp}</p>
            <p className="mt-2 text-sm">
              {c.rebateAccrued} <span className="font-mono">{pretty(accrued, dec, 2)} USDT</span>
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {steps.map((step) => (
                <button
                  key={step}
                  type="button"
                  className="min-h-11 border border-gold font-mono text-xs"
                  disabled={busy || accrued < BigInt(step) * 10n ** BigInt(dec)}
                  onClick={() => run((from) => claimRebate(from, chain, step))}
                >
                  {c.rebateClaim} {step}
                </button>
              ))}
            </div>
            {tier < 2 ? <p className="mt-2 text-sm leading-relaxed">{c.rebateOld}</p> : null}
            <label className="mt-3 block text-sm">
              {c.rebateCode}
              <span className="mt-1 flex gap-2">
                <input value={mine || code} onChange={(event) => setCode(event.target.value.slice(0, 16))} disabled={Boolean(mine)} className="min-h-11 min-w-0 flex-1 border border-gold bg-transparent px-2 font-mono outline-none" />
                <button type="button" className="min-h-11 bg-ink px-3 text-paper" disabled={busy || Boolean(mine) || !code.trim()} onClick={() => run((from) => registerCode(from, chain, code))}>
                  {c.rebateRegister}
                </button>
              </span>
            </label>
            {mine ? (
              <div className="mt-3">
                <p className="text-xs tracking-widest text-gold">{c.inviteLink}</p>
                <input
                  readOnly
                  value={`${typeof window === "undefined" ? "" : window.location.origin + window.location.pathname}#ref=${encodeURIComponent(mine)}`}
                  className="mt-1 w-full border border-gold bg-transparent px-2 py-2 font-mono text-xs outline-none"
                />
                <button
                  type="button"
                  className="mt-2 min-h-11 border border-gold px-3"
                  onClick={() => {
                    const link = `${window.location.origin}${window.location.pathname}#ref=${encodeURIComponent(mine)}`;
                    navigator.clipboard.writeText(link).then(() => setBindNote(c.inviteCopied)).catch(() => setBindNote(link));
                  }}
                >
                  {c.inviteCopy}
                </button>
              </div>
            ) : null}
            <label className="mt-3 block text-sm">
              {c.rebateBind}
              {locked ? (
                <span className="mt-1 block">
                  <span className="block break-all font-mono text-xs">{referrer}</span>
                  <span className="mt-1 block text-ink/70">{c.rebateLocked}</span>
                </span>
              ) : who ? (
                <span className="mt-1 block">
                  <span className="block">{c.rebateReview}</span>
                  <span className="mt-1 block break-all font-mono text-xs">{who}</span>
                  <span className="mt-1 block font-mono text-xs">{ask}</span>
                  <span className="mt-1 flex gap-2">
                    <button type="button" className="min-h-11 bg-ink px-3 text-paper" disabled={busy} onClick={() => run((from) => bindCode(from, chain, ask))}>
                      {c.rebateGo}
                    </button>
                    <button type="button" className="min-h-11 border border-gold px-3" disabled={busy} onClick={() => { setWho(""); setAsk(""); }}>
                      {c.rebateBack}
                    </button>
                  </span>
                </span>
              ) : (
                <span className="mt-1 block">
                  <span className="flex gap-2">
                    <input value={bind} onChange={(event) => { setBind(event.target.value.slice(0, 16)); setBindNote(""); }} className="min-h-11 min-w-0 flex-1 border border-gold bg-transparent px-2 font-mono outline-none" />
                    <button type="button" className="min-h-11 border border-gold px-3" disabled={busy || !bind.trim()} onClick={() => void review()}>
                      {c.rebateCheck}
                    </button>
                  </span>
                  {bindNote ? <span className="mt-1 block text-ink/70">{bindNote}</span> : null}
                </span>
              )}
            </label>
            <div className="mt-3 border-t border-gold/40 pt-3">
              <p className="text-xs tracking-widest text-gold">{c.inviteTitle}</p>
              {!book || !book.caughtUp ? (
                <p className="mt-2 text-sm leading-relaxed">{book && !book.live ? c.inviteGap : c.inviteChecking}</p>
              ) : book.invitees.length === 0 ? (
                <p className="mt-2 text-sm">{c.inviteEmpty}</p>
              ) : (
                <>
                  <p className="mt-2 text-sm">
                    {book.invitees.length}
                    <span className="ml-3 font-mono">{c.inviteCounted} {pretty(BigInt(book.counted), dec, 4)} USDT</span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-ink/60">{c.inviteExact}</p>
                  {book.invitees.map((row) => (
                    <p key={row.user} className="mt-2 break-all font-mono text-xs leading-relaxed">
                      {row.user}
                      <span className="mt-1 block">
                        {c.inviteMargin} {pretty(BigInt(row.margin), dec, 2)} · {c.inviteNotional} {pretty(BigInt(row.notional), dec, 2)} · {c.inviteReward} {pretty(BigInt(row.reward), dec, 4)}
                      </span>
                    </p>
                  ))}
                </>
              )}
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
