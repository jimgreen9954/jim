const SRC: Record<string, string> = {
  tape: "/mark.jpg",
  btc: "/coins/btc.png",
  eth: "/coins/eth.png",
  zec: "/coins/zec.png",
  usdt: "/coins/usdt.png",
  bnb: "/coins/bnb.png",
  okb: "/coins/okb.svg",
  bem: "/coins/bem.webp",
  nand: "/coins/nand.svg",
  latch: "/coins/latch.svg",
};

export function CoinMark({ id, className = "size-6" }: { id: string; className?: string }) {
  const key = id.toLowerCase();
  const src = SRC[key];
  if (!src) {
    return (
      <span
        className={`${className} grid shrink-0 place-items-center rounded-full bg-ink text-[9px] font-medium text-paper`}
      >
        {key.slice(0, 3).toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt="" className={`${className} shrink-0 rounded-full object-cover`} />;
}
