import { useEffect, useState } from "react";
import { BSC_SAFE, XLAYER_SAFE } from "@/lib/chain-marks";
import { coinBook, deployCoin, deployCoinBook, shipXBook, type CoinBook } from "@/lib/perp";
import { connectBsc } from "@/lib/bsc";
import { connectXLayer } from "@/lib/xlayer";

const ROWS: { coin: CoinBook; zh: string; en: string; chain: "bsc" | "xlayer"; where: string }[] = [
  { coin: "btc", zh: "BTC 永续", en: "BTC perp", chain: "bsc", where: "BSC" },
  { coin: "eth", zh: "ETH 永续", en: "ETH perp", chain: "bsc", where: "BSC" },
  { coin: "zec", zh: "ZEC 永续", en: "ZEC perp", chain: "bsc", where: "BSC" },
  { coin: "up", zh: "UP 永续", en: "UP perp", chain: "bsc", where: "BSC" },
  { coin: "tape", zh: "TAPE 永续", en: "TAPE perp", chain: "xlayer", where: "X Layer" },
];

function saved(): Record<string, string> {
  const next: Record<string, string> = {};
  for (const row of ROWS) next[row.coin] = coinBook(row.chain, row.coin);
  return next;
}

export function HomeBooks({ zh }: { zh: boolean }) {
  const [books, setBooks] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [note, setNote] = useState("");

  useEffect(() => {
    setBooks(saved());
  }, []);

  if (!books) return null;

  const sign = (row: (typeof ROWS)[number]) => {
    setBusy(row.coin);
    setNote("");
    setStep(1);
    void (async () => {
      try {
        const from = row.chain === "xlayer" ? await connectXLayer() : await connectBsc();
        const allow = [row.chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE];
        if (!allow.some((who) => who.toLowerCase() === from.toLowerCase())) {
          setNote(zh ? "只有多签钱包能部署。" : "Only the multisig can deploy.");
          return;
        }
        const { book } = await deployCoin(from, row.coin, setStep);
        setBooks((prev) => ({ ...(prev ?? {}), [row.coin]: book }));
        window.dispatchEvent(new CustomEvent("tape-coin-book", { detail: { coin: row.coin, book } }));
        setNote(
          zh
            ? `已部署 ${book}。把这行地址发我，我写进页面，再把这个按钮撤掉。`
            : `Deployed ${book}. Send this address. I will pin it and remove this button.`,
        );
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "fee"
            ? zh
              ? "只有多签钱包能部署。"
              : "Only the multisig can deploy."
            : code === "price"
              ? zh
                ? "标记价对不上，这一本没部署。"
                : "The mark did not match. This book was not deployed."
              : zh
                ? "没部署成。"
                : "It did not deploy.",
        );
      } finally {
        setBusy(null);
        setStep(0);
      }
    })();
  };

  const open = ROWS.filter((row) => !books[row.coin]);
  if (open.length === 0 && !note) return null;

  return (
    <section className="border border-gold bg-card">
      {open.map((row) => {
        return (
          <div
            key={row.coin}
            className="flex min-h-12 items-center gap-2 border-t border-gold/30 px-3 first:border-t-0"
          >
            <span className="w-24 shrink-0 text-sm">{zh ? row.zh : row.en}</span>
            <span className="text-xs text-ink/50">{row.where}</span>
            <span className="font-mono text-xs">0.20%</span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => sign(row)}
              className="ml-auto min-h-11 shrink-0 border border-gold bg-ink px-3 text-sm text-paper disabled:opacity-40"
            >
              {busy === row.coin ? (zh ? (step <= 1 ? "标记" : "永续") : "Sign") : zh ? "部署" : "Deploy"}
            </button>
          </div>
        );
      })}
      {note ? <p className="break-all border-t border-gold/30 px-3 py-2 font-mono text-[11px]">{note}</p> : null}
    </section>
  );
}

type Patch =
  | { id: string; zh: string; en: string; where: string; chain: "bsc" | "xlayer"; kind: "coin"; coin: CoinBook }
  | { id: string; zh: string; en: string; where: string; chain: "xlayer"; kind: "xbem" };

const PATCHES: Patch[] = [
  { id: "btc", zh: "BTC 永续", en: "BTC perp", where: "BSC", chain: "bsc", kind: "coin", coin: "btc" },
  { id: "eth", zh: "ETH 永续", en: "ETH perp", where: "BSC", chain: "bsc", kind: "coin", coin: "eth" },
  { id: "zec", zh: "ZEC 永续", en: "ZEC perp", where: "BSC", chain: "bsc", kind: "coin", coin: "zec" },
  { id: "up", zh: "UP 永续", en: "UP perp", where: "BSC", chain: "bsc", kind: "coin", coin: "up" },
  { id: "tape", zh: "TAPE 永续", en: "TAPE perp", where: "X Layer", chain: "xlayer", kind: "coin", coin: "tape" },
  { id: "xbem", zh: "BEM 永续", en: "BEM perp", where: "X Layer", chain: "xlayer", kind: "xbem" },
];

function patchKey(row: Patch) {
  return `tl-home-patch:${row.id}`;
}

const LANDED: Record<string, string> = {
  spot: "0xd398691dff583788e6e2d02dd33b1ffd9fa6b8bd",
  "lend-tape": "0x51a1f26d6e8142513ab6c5d1f8fa993683dd1212",
  "lend-bem": "0x58d980f548c150be59819cdbfe46b8a14ef4fe56",
};

function patchSaved(): Record<string, string> {
  const next: Record<string, string> = { ...LANDED };
  for (const row of PATCHES) {
    const coin = row.kind === "coin" ? window.localStorage.getItem(`tl-coin-v2:${row.chain}:${row.coin}`) ?? "" : "";
    const own = window.localStorage.getItem(patchKey(row)) ?? "";
    const addr = /^0x[a-fA-F0-9]{40}$/.test(coin) ? coin : own;
    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) next[row.id] = addr;
  }
  return next;
}

export function HomePatch({ zh }: { zh: boolean }) {
  const [done, setDone] = useState<Record<string, string>>(LANDED);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    setDone(patchSaved());
  }, []);

  const sign = (row: Patch) => {
    setBusy(row.id);
    setNote("");
    void (async () => {
      try {
        const from = row.chain === "xlayer" ? await connectXLayer() : await connectBsc();
        const safe = row.chain === "xlayer" ? XLAYER_SAFE : BSC_SAFE;
        if (from.toLowerCase() !== safe.toLowerCase()) {
          setNote(zh ? "只有多签钱包能部署。" : "Only the multisig can deploy.");
          return;
        }
        let book = "";
        if (row.kind === "coin") {
          if (row.coin === "fab") throw new Error("coin");
          book = (await deployCoinBook(from, row.coin)).book;
        } else {
          book = (await shipXBook(from)).book;
        }
        window.localStorage.setItem(patchKey(row), book);
        setDone((prev) => ({ ...prev, [row.id]: book }));
        setNote(
          zh
            ? `已部署 ${book}。不能撤回。把这行地址发我，写进页面之后别人用的才是这一份。永续新地址只在这个浏览器里生效。`
            : `Deployed ${book}. It cannot be revoked. Send this address. Others keep the old contract until it is pinned. A new perp is used only in this browser.`,
        );
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "fee" || code === "oracle" || code === "onlyfee" || code === "leader"
            ? zh
              ? "只有多签钱包能部署。"
              : "Only the multisig can deploy."
            : code === "live"
              ? zh
                ? "这个浏览器已经部署过这一本。"
                : "This browser already deployed this book."
              : code === "second"
                ? zh
                  ? "还要第二位多签签名。"
                  : "A second multisig signature is still required."
                : code === "price"
                  ? zh
                    ? "标记价对不上，这一本没部署。"
                    : "The mark did not match. This book was not deployed."
                  : zh
                    ? "没部署成。"
                    : "It did not deploy.",
        );
      } finally {
        setBusy(null);
      }
    })();
  };

  return (
    <section className="border border-gold bg-card">
      <p className="border-b border-gold/30 px-3 py-2 text-xs text-ink/70">
        {zh
          ? "刚才那一轮只更新了标记价，订单簿没有上链。现在每个按钮只签一次，签的就是订单簿。X Layer 的标记合约已经在，这一次也只签订单簿。"
          : "The last round only updated marks. The books were not created. Each button now signs once, and that signature is the book. The X Layer mark is already deployed."}
      </p>
      {PATCHES.map((row) => (
        <div key={row.id} className="flex min-h-12 items-center gap-2 border-t border-gold/30 px-3">
          <span className="w-28 shrink-0 text-sm">{zh ? row.zh : row.en}</span>
          <span className="text-xs text-ink/50">{row.where}</span>
          <span className="truncate font-mono text-[11px] text-ink/70">{done[row.id] ?? ""}</span>
          <button
            type="button"
            disabled={busy !== null || Boolean(done[row.id])}
            onClick={() => sign(row)}
            className="ml-auto min-h-11 shrink-0 border border-gold bg-ink px-3 text-sm text-paper disabled:opacity-40"
          >
            {busy === row.id ? (zh ? "签名" : "Sign") : done[row.id] ? (zh ? "已部署" : "Deployed") : row.kind === "coin" ? (zh ? "部署订单簿" : "Deploy book") : zh ? "部署" : "Deploy"}
          </button>
        </div>
      ))}
      {note ? <p className="break-all border-t border-gold/30 px-3 py-2 font-mono text-[11px]">{note}</p> : null}
    </section>
  );
}
