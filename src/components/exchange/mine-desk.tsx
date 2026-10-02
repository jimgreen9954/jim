import { useEffect, useState } from "react";
import { copy } from "@/lib/copy";
import { useExchange } from "@/lib/exchange-store";
import { nickOf, readNicks, writeNick } from "@/lib/nicks";
import { bindCode, claimRebate, claimTier, CLAIM_STEPS, deployPerp, hasRebates, lookupCode, OLD_CLAIM_STEPS, readRebate, registerCode, savedRebate, usdtText, usdtUnits } from "@/lib/perp";

const zero = "0x0000000000000000000000000000000000000000";

function codeText(code: string): string {
  if (!code || /^0x0{64}$/.test(code)) return "";
  const raw = code.slice(2).replace(/(00)+$/, "");
  if (!raw) return "";
  const bytes = raw.match(/.{2}/g)?.map((h) => Number.parseInt(h, 16)) ?? [];
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return "";
  }
}

export function MineDesk({
  account,
  busy,
  addresses,
  run,
}: {
  account: string | null;
  busy: boolean;
  addresses: string[];
  run: (task: (from: string) => Promise<unknown>) => Promise<void>;
}) {
  const lang = useExchange((s) => s.lang);
  const c = copy[lang];
  const [nicks, setNicks] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [code, setCode] = useState("");
  const [bind, setBind] = useState("");
  const [perp, setPerp] = useState("");
  const [live, setLive] = useState(false);
  const [accrued, setAccrued] = useState(0n);
  const [referrer, setReferrer] = useState("");
  const [mine, setMine] = useState("");
  const [tier, setTier] = useState(1);
  const [who, setWho] = useState("");
  const [ask, setAsk] = useState("");
  const [bindNote, setBindNote] = useState("");

  useEffect(() => {
    const saved = readNicks();
    setNicks(saved);
    const next: Record<string, string> = {};
    for (const addr of addresses) next[addr.toLowerCase()] = nickOf(addr, saved);
    setDraft(next);
  }, [addresses]);

  useEffect(() => {
    const addr = savedRebate();
    setPerp(addr);
    if (!addr) return;
    let dead = false;
    hasRebates(addr).then((ok) => {
      if (!dead) setLive(ok);
    });
    claimTier(addr).then((next) => {
      if (!dead) setTier(next);
    });
    if (account) {
      readRebate(addr, account)
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
  }, [account, busy]);

  const locked = Boolean(referrer && referrer !== zero);
  const steps = tier >= 2 ? CLAIM_STEPS : OLD_CLAIM_STEPS;

  async function review() {
    setBindNote("");
    setWho("");
    setAsk("");
    try {
      const owner = await lookupCode(perp, bind);
      if (!owner || owner.toLowerCase() === zero) {
        setBindNote(c.rebateMissing);
        return;
      }
      if (account && owner.toLowerCase() === account.toLowerCase()) {
        setBindNote(lang === "zh" ? "不能绑定自己的推荐码" : "You cannot bind your own code");
        return;
      }
      setAsk(bind.trim());
      setWho(owner);
    } catch {
      setBindNote(c.rebateMissing);
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
        {!live ? (
          <>
            <p className="mt-2 text-sm leading-relaxed">{c.rebateNeed}</p>
            <button type="button" className="mt-2 min-h-12 bg-ink px-3 text-paper" disabled={busy} onClick={() => run((from) => deployPerp(from))}>
              {c.rebateUpgrade}
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 break-all font-mono text-xs">{perp}</p>
            <p className="mt-2 text-sm">
              {c.rebateAccrued} <span className="font-mono">{usdtText(accrued)} USDT</span>
            </p>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {steps.map((step) => (
                <button
                  key={step}
                  type="button"
                  className="min-h-11 border border-gold font-mono text-xs"
                  disabled={busy || accrued < usdtUnits(step)}
                  onClick={() => run((from) => claimRebate(from, perp, step))}
                >
                  {step}
                </button>
              ))}
            </div>
            {tier < 2 ? (
              <>
                <p className="mt-2 text-sm leading-relaxed">{c.rebateOld}</p>
                <button type="button" className="mt-2 min-h-12 bg-ink px-3 text-paper" disabled={busy} onClick={() => run((from) => deployPerp(from))}>
                  {c.rebateUpgrade}
                </button>
              </>
            ) : null}
            <label className="mt-3 block text-sm">
              {c.rebateCode}
              <span className="mt-1 flex gap-2">
                <input value={mine || code} onChange={(event) => setCode(event.target.value.slice(0, 16))} disabled={Boolean(mine)} className="min-h-11 min-w-0 flex-1 border border-gold bg-transparent px-2 font-mono outline-none" />
                <button type="button" className="min-h-11 bg-ink px-3 text-paper" disabled={busy || Boolean(mine)} onClick={() => run((from) => registerCode(from, perp, code))}>
                  {c.nickSave}
                </button>
              </span>
            </label>
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
                    <button type="button" className="min-h-11 bg-ink px-3 text-paper" disabled={busy} onClick={() => run((from) => bindCode(from, perp, ask))}>
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
          </>
        )}
      </section>
    </div>
  );
}
