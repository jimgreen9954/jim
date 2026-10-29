import { BSC, BSC_SAFE, XLAYER_SAFE } from "@/lib/bsc";
import { GATE } from "@/lib/gate-chain";
import { BSC_REBATE, KNOWN_XMARK, KNOWN_XPERP, X_USDT } from "@/lib/perp";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";

type Row = { name: string; chain: string; address: string; href: string };

function bsc(address: string): string {
  return `${BSC.explorer}/address/${address}`;
}

function xlayer(address: string): string {
  return `${XLAYER.explorer}/address/${address}`;
}

const rows: Row[] = [
  { name: "BSC 永续", chain: "BSC", address: BSC_REBATE, href: bsc(BSC_REBATE) },
  { name: "X Layer 永续", chain: "X Layer", address: KNOWN_XPERP, href: xlayer(KNOWN_XPERP) },
  { name: "标记价", chain: "X Layer", address: KNOWN_XMARK, href: xlayer(KNOWN_XMARK) },
  { name: "晶体管永续", chain: "BSC", address: GATE, href: bsc(GATE) },
  { name: "电路", chain: "X Layer", address: DEPLOYED.circuits, href: xlayer(DEPLOYED.circuits) },
  {
    name: "晶体管",
    chain: "X Layer",
    address: DEPLOYED.transistors,
    href: xlayer(DEPLOYED.transistors),
  },
  { name: "BEM", chain: "BSC", address: BSC.bem, href: bsc(BSC.bem) },
  { name: "USDT", chain: "BSC", address: BSC.usdt, href: bsc(BSC.usdt) },
  { name: "USDT0", chain: "X Layer", address: X_USDT, href: xlayer(X_USDT) },
  { name: "BSC 收费", chain: "BSC", address: BSC_SAFE, href: bsc(BSC_SAFE) },
  { name: "X Layer 收费", chain: "X Layer", address: XLAYER_SAFE, href: xlayer(XLAYER_SAFE) },
];

export function AddressBook({ lang }: { lang: "zh" | "en" }) {
  return (
    <section className="border border-gold/40">
      <p className="border-b border-gold/40 px-3 py-2 text-xs tracking-widest text-gold">
        {lang === "zh" ? "只认下面这些合约" : "Only these contracts"}
      </p>
      <ul className="divide-y divide-gold/30">
        {rows.map((row) => (
          <li
            key={row.name}
            className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_6rem_1fr] sm:items-baseline"
          >
            <span className="text-sm">{lang === "en" ? enName(row.name) : row.name}</span>
            <span className="font-mono text-xs text-gold">{row.chain}</span>
            <a
              className="break-all font-mono text-xs underline decoration-gold underline-offset-4"
              href={row.href}
              target="_blank"
              rel="noreferrer"
            >
              {row.address}
            </a>
          </li>
        ))}
      </ul>
      <p className="border-t border-gold/40 px-3 py-2 text-xs leading-6 text-ink/60">
        {lang === "zh"
          ? "BSC 的台费进 BSC 多签。X Layer 的台费进 X Layer 多签。两条不是同一个地址。"
          : "BSC fees go to the BSC multisig. X Layer fees go to the X Layer multisig. They are not the same address."}
      </p>
    </section>
  );
}

function enName(name: string): string {
  const map: Record<string, string> = {
    "BSC 永续": "BSC perpetual",
    "X Layer 永续": "X Layer perpetual",
    标记价: "Mark",
    晶体管永续: "Transistor perpetual",
    电路: "Circuits",
    晶体管: "Transistors",
    "BSC 收费": "BSC fee",
    "X Layer 收费": "X Layer fee",
  };
  return map[name] ?? name;
}
