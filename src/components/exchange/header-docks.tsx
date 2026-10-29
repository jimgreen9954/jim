import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatUnits } from "viem";
import { useExchange } from "@/lib/exchange-store";
import { BSC, BSC_SAFE, XLAYER_SAFE, readBalances } from "@/lib/bsc";
import { readOkb, XLAYER } from "@/lib/xlayer";
import {
  CLAIM_STEPS,
  bindCode,
  claimRebate,
  codeText,
  readRebate,
  registerCode,
  X_USDT,
  type Desk,
} from "@/lib/perp";
import { currentAccount, onAccount } from "@/lib/wallet";
import { OfficialBridge } from "@/components/exchange/tape-desk";

function inviteHref(code: string): string {
  if (typeof window === "undefined") return `#ref=${encodeURIComponent(code)}`;
  return `${window.location.origin}${window.location.pathname}#ref=${encodeURIComponent(code)}`;
}

const TAPE = "0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3";
const BEM_X = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952";

function trimAmount(raw: string): string {
  const [whole, frac = ""] = raw.split(".");
  const cut = frac.slice(0, 4).replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

async function tokenBalance(rpc: string, token: string, holder: string): Promise<bigint> {
  const data = `0x70a08231${holder.slice(2).toLowerCase().padStart(64, "0")}`;
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: token, data }, "latest"],
    }),
  });
  const json = (await res.json()) as { result?: string };
  if (!json.result || json.result === "0x") return 0n;
  return BigInt(json.result);
}

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

async function recentFees(): Promise<{ side: "in" | "out"; k: string; v: string; href: string }[]> {
  const books = [
    { rpc: BSC.rpc, token: BSC.usdt, dec: 18, k: "USDT", scan: BSC.explorer, who: BSC_SAFE },
    { rpc: BSC.rpc, token: BSC.bem, dec: 8, k: "BEM", scan: BSC.explorer, who: BSC_SAFE },
    { rpc: XLAYER.rpc, token: X_USDT, dec: 6, k: "USDT0", scan: XLAYER.explorer, who: XLAYER_SAFE },
    { rpc: XLAYER.rpc, token: TAPE, dec: 8, k: "TAPE", scan: XLAYER.explorer, who: XLAYER_SAFE },
    { rpc: XLAYER.rpc, token: BEM_X, dec: 8, k: "BEM", scan: XLAYER.explorer, who: XLAYER_SAFE },
  ];
  const rows: { side: "in" | "out"; k: string; v: string; href: string; block: number }[] = [];
  for (const book of books) {
    const fee = book.who.slice(2).toLowerCase().padStart(64, "0");
    try {
      const head = await fetch(book.rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      }).then((res) => res.json() as Promise<{ result?: string }>);
      const latest = head.result ? Number(BigInt(head.result)) : 0;
      if (!latest) continue;
      const fromBlock = `0x${Math.max(0, latest - 3000).toString(16)}`;
      for (const side of ["in", "out"] as const) {
        const topics = side === "in" ? [TRANSFER, null, `0x${fee}`] : [TRANSFER, `0x${fee}`];
        const json = await fetch(book.rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getLogs",
            params: [{ address: book.token, fromBlock, toBlock: "latest", topics }],
          }),
        }).then(
          (res) =>
            res.json() as Promise<{
              result?: { transactionHash: string; data: string; blockNumber: string }[];
            }>,
        );
        for (const log of json.result ?? []) {
          let amount = 0n;
          try {
            amount = BigInt(log.data);
          } catch {
            amount = 0n;
          }
          if (amount <= 0n) continue;
          rows.push({
            side,
            k: book.k,
            v: trimAmount(formatUnits(amount, book.dec)),
            href: `${book.scan}/tx/${log.transactionHash}`,
            block: Number(BigInt(log.blockNumber)),
          });
        }
      }
    } catch {
      continue;
    }
  }
  return rows
    .sort((a, b) => b.block - a.block)
    .slice(0, 8)
    .map(({ side, k, v, href }) => ({ side, k, v, href }));
}

function GoldMark() {
  return (
    <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
      <rect width="32" height="32" rx="6" fill="#1c1408" />
      <path
        fill="#e6c27a"
        d="M6 20c1.2-6 4.2-8.2 10-8.2s8.8 2.2 10 8.2c-2.2 3-6 4.2-10 4.2S8.2 23 6 20Z"
      />
      <path fill="#f6e3b0" d="M11 15.5h10c.8 1.6.8 3.2 0 4.8H11c-.8-1.6-.8-3.2 0-4.8Z" />
      <ellipse cx="8.2" cy="18.5" rx="2" ry="2.6" fill="#c4963c" />
      <ellipse cx="23.8" cy="18.5" rx="2" ry="2.6" fill="#c4963c" />
    </svg>
  );
}

export function FeeBook() {
  const zh = useExchange((s) => s.lang) === "zh";
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ k: string; v: string }[]>([]);
  const [flows, setFlows] = useState<{ side: "in" | "out"; k: string; v: string; href: string }[]>(
    [],
  );
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && (box.current?.contains(node) || panel.current?.contains(node)))
        return;
      setOpen(false);
    };
    const id = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let dead = false;
    const load = async () => {
      const [bsc, okb, usdt0, tape, bem] = await Promise.all([
        readBalances(BSC_SAFE).catch(() => null),
        readOkb(XLAYER_SAFE).catch(() => null),
        tokenBalance(XLAYER.rpc, X_USDT, XLAYER_SAFE).catch(() => null),
        tokenBalance(XLAYER.rpc, TAPE, XLAYER_SAFE).catch(() => null),
        tokenBalance(XLAYER.rpc, BEM_X, XLAYER_SAFE).catch(() => null),
      ]);
      if (dead) return;
      const show = (amount: bigint | null, decimals: number) =>
        amount == null ? "—" : trimAmount(formatUnits(amount, decimals));
      setRows([
        { k: "BNB", v: show(bsc?.bnb ?? null, 18) },
        { k: "USDT", v: show(bsc?.usdt ?? null, 18) },
        { k: "BEM · BSC", v: show(bsc?.bem ?? null, 8) },
        { k: "OKB", v: show(okb, 18) },
        { k: "USDT0", v: show(usdt0, 6) },
        { k: "TAPE", v: show(tape, 8) },
        { k: "BEM · X Layer", v: show(bem, 8) },
      ]);
      const moved = await recentFees().catch(() => []);
      if (!dead) setFlows(moved);
    };
    void load();
    return () => {
      dead = true;
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-label={zh ? "手续费" : "Fees"}
        title={zh ? "台费 0.20%" : "Desk fee 0.20%"}
        className={`grid size-9 place-items-center rounded-md ${open ? "bg-foil" : ""}`}
        onClick={() => setOpen((on) => !on)}
      >
        <GoldMark />
        <span className="menu-word">{zh ? "手续费" : "Fees"}</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[80] max-h-[min(28rem,calc(100dvh-5rem))] overflow-y-auto border border-gold bg-paper p-3 text-sm shadow-plate sm:inset-x-auto sm:right-3 sm:w-[22rem]"
            >
              <p className="text-sm">{zh ? "手续费" : "Fees"}</p>
              <p className="mt-1 font-mono text-xs">0.20%</p>
              <a
                className="mt-2 block break-all font-mono text-[11px] text-gold underline"
                href={`${BSC.explorer}/address/${BSC_SAFE}`}
                target="_blank"
                rel="noreferrer"
              >
                {zh ? "BSC" : "BSC"} {BSC_SAFE}
              </a>
              <a
                className="mt-1 block break-all font-mono text-[11px] text-gold underline"
                href={`${XLAYER.explorer}/address/${XLAYER_SAFE}`}
                target="_blank"
                rel="noreferrer"
              >
                {zh ? "X Layer" : "X Layer"} {XLAYER_SAFE}
              </a>
              <ul className="mt-3 divide-y divide-gold/30 border-y border-gold/30">
                {(rows.length
                  ? rows
                  : [
                      { k: "BNB", v: "…" },
                      { k: "USDT", v: "…" },
                      { k: "BEM · BSC", v: "…" },
                      { k: "OKB", v: "…" },
                      { k: "USDT0", v: "…" },
                      { k: "TAPE", v: "…" },
                      { k: "BEM · X Layer", v: "…" },
                    ]
                ).map((row) => (
                  <li key={row.k} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="text-ink/60">
                      {zh ? "结余" : "Held"} · {row.k}
                    </span>
                    <span className="font-mono">{row.v}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink/55">{zh ? "最近" : "Recent"}</p>
              <ul className="mt-1 divide-y divide-gold/30 border-y border-gold/30">
                {flows.length === 0 ? (
                  <li className="py-2 text-xs text-ink/50">
                    {zh ? "这段没有读到转账。" : "No transfer in this window."}
                  </li>
                ) : (
                  flows.map((row) => (
                    <li
                      key={`${row.href}-${row.k}-${row.v}`}
                      className="flex items-baseline justify-between gap-3 py-1.5"
                    >
                      <a
                        className="text-ink/70 underline"
                        href={row.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.side === "in" ? (zh ? "收入" : "In") : zh ? "支出" : "Out"} · {row.k}
                      </a>
                      <span className="font-mono">{row.v}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function BridgeDock() {
  const zh = useExchange((s) => s.lang) === "zh";
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [xBem, setXBem] = useState<bigint | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    if (!open || !account) return;
    let dead = false;
    tokenBalance(XLAYER.rpc, BEM_X, account)
      .then((value) => {
        if (!dead) setXBem(value);
      })
      .catch(() => {
        if (!dead) setXBem(null);
      });
    return () => {
      dead = true;
    };
  }, [open, account]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && (box.current?.contains(node) || panel.current?.contains(node)))
        return;
      setOpen(false);
    };
    const id = window.setTimeout(() => document.addEventListener("pointerdown", close), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        className={`shrink-0 rounded-md px-2.5 py-1.5 text-sm ${open ? "bg-foil text-ink" : "text-ink/65 hover:text-ink"}`}
        onClick={() => setOpen((on) => !on)}
      >
        {zh ? "跨链" : "Bridge"}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[80] max-h-[min(32rem,calc(100dvh-5rem))] overflow-y-auto border border-gold bg-paper p-3 text-sm shadow-plate sm:inset-x-auto sm:left-3 sm:w-[24rem]"
            >
              <OfficialBridge account={account} zh={zh} xBem={xBem} startOpen />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function InviteDock() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const [open, setOpen] = useState(false);
  const [chain, setChain] = useState<Desk>("xlayer");
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [code, setCode] = useState("");
  const [mine, setMine] = useState("");
  const [friend, setFriend] = useState("");
  const [referrer, setReferrer] = useState("");
  const [accrued, setAccrued] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => onAccount(setAccount), []);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const node = event.target;
      if (node instanceof Node && (dock.current?.contains(node) || panel.current?.contains(node)))
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const fromHash = hash.startsWith("ref=") ? decodeURIComponent(hash.slice(4)) : "";
    const fromQuery = new URLSearchParams(window.location.search).get("ref") ?? "";
    const ref = (fromHash || fromQuery).trim().slice(0, 16);
    if (ref) {
      setFriend(ref);
      setOpen(true);
    }
  }, []);
  useEffect(() => {
    if (!account) return;
    let dead = false;
    const dec = chain === "xlayer" ? 6 : 18;
    readRebate(chain, account)
      .then((row) => {
        if (dead) return;
        setCode(codeText(row.code));
        setReferrer(row.referrer);
        setAccrued(Number(formatUnits(row.accrued, dec)));
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [account, chain, open, note]);
  const run = (job: (from: string) => Promise<unknown>, ok: string) => {
    const from = account ?? currentAccount();
    if (!from) {
      setNote(zh ? "先连接钱包。" : "Connect a wallet first.");
      return;
    }
    setBusy(true);
    job(from)
      .then(() => setNote(ok))
      .catch((err: unknown) => {
        const text = err instanceof Error ? err.message : "";
        setNote(
          /taken/i.test(text)
            ? zh
              ? "这个码已经有人用了。"
              : "That code is taken."
            : /have/i.test(text)
              ? zh
                ? "这个地址已经有码，不能改。"
                : "This address already has a code."
              : zh
                ? "没有写上。"
                : "It was not written.",
        );
      })
      .finally(() => setBusy(false));
  };
  const unit = chain === "xlayer" ? "USDT0" : "USDT";
  return (
    <div className="relative" ref={dock}>
      <button
        type="button"
        className={`min-h-9 px-2.5 text-sm ${open ? "text-ink" : "text-ink/70"}`}
        onClick={() => setOpen((on) => !on)}
      >
        {zh ? "邀请" : "Invite"}
      </button>
      {open
        ? createPortal(
            <div
              ref={panel}
              className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-[80] max-h-[min(32rem,calc(100dvh-5rem))] overflow-y-auto border border-gold bg-paper p-3 text-sm shadow-plate sm:inset-x-auto sm:right-3 sm:w-[22rem]"
            >
              <div className="grid grid-cols-2 border border-gold">
                <button
                  type="button"
                  className={`min-h-9 ${chain === "xlayer" ? "bg-ink text-paper" : ""}`}
                  onClick={() => setChain("xlayer")}
                >
                  X Layer
                </button>
                <button
                  type="button"
                  className={`min-h-9 ${chain === "bsc" ? "bg-ink text-paper" : ""}`}
                  onClick={() => setChain("bsc")}
                >
                  BSC
                </button>
              </div>
              {code ? (
                <div className="mt-2">
                  <p className="font-mono">{code}</p>
                  <input
                    readOnly
                    value={inviteHref(code)}
                    className="mt-2 w-full border border-gold bg-transparent px-2 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    className="mt-2 min-h-9 border border-gold px-3 text-xs"
                    onClick={() => {
                      const link = inviteHref(code);
                      navigator.clipboard
                        .writeText(link)
                        .then(() => setNote(zh ? "链接已复制。" : "Link copied."))
                        .catch(() => setNote(link));
                    }}
                  >
                    {zh ? "复制邀请链接" : "Copy invite link"}
                  </button>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input
                    value={mine}
                    onChange={(event) => setMine(event.target.value)}
                    placeholder={zh ? "我的邀请码" : "My code"}
                    className="min-h-10 min-w-0 flex-1 border border-gold bg-transparent px-2"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-10 border border-gold px-3 text-xs disabled:opacity-40"
                    onClick={() =>
                      run(
                        (from) => registerCode(from, chain, mine),
                        zh ? "码已写上。链接在上面。" : "Code written. The link is above.",
                      )
                    }
                  >
                    {zh ? "确认" : "Confirm"}
                  </button>
                </div>
              )}
              {referrer && referrer !== "0x0000000000000000000000000000000000000000" ? (
                <p className="mt-2 font-mono text-xs">
                  {referrer.slice(0, 6)}…{referrer.slice(-4)}
                </p>
              ) : (
                <div className="mt-2 flex gap-2">
                  <input
                    value={friend}
                    onChange={(event) => setFriend(event.target.value)}
                    placeholder={zh ? "朋友的码" : "Their code"}
                    className="min-h-10 min-w-0 flex-1 border border-gold bg-transparent px-2"
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="min-h-10 border border-gold px-3 text-xs disabled:opacity-40"
                    onClick={() =>
                      run((from) => bindCode(from, chain, friend), zh ? "已绑定。" : "Bound.")
                    }
                  >
                    {zh ? "绑定" : "Bind"}
                  </button>
                </div>
              )}
              <p className="mt-2 font-mono text-xs">
                {zh ? "可提" : "Claimable"} {accrued.toFixed(2)} {unit}
              </p>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {CLAIM_STEPS.map((step) => (
                  <button
                    key={step}
                    type="button"
                    disabled={busy || accrued + 1e-9 < step}
                    className="min-h-8 border border-gold font-mono text-xs disabled:opacity-40"
                    onClick={() =>
                      run(
                        (from) => claimRebate(from, chain, step),
                        zh ? `已提 ${step}。` : `Claimed ${step}.`,
                      )
                    }
                  >
                    {step}
                  </button>
                ))}
              </div>
              {note ? <p className="mt-2 text-xs leading-5">{note}</p> : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
