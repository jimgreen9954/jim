export type TradeStep = "fee" | "trade" | "both" | "fill";

export function sayTradeStep(step: TradeStep) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tl-trade-step", { detail: step }));
}

/** What the open desk should say while the wallet is up. "trade" is a fill that already paid. */
export function tradeStepText(step: string, zh: boolean): string {
  if (step === "both")
    return zh
      ? "这一笔同时扣 0.20% 手续费并成交。失败则都不发生。"
      : "This confirmation takes the 0.20% fee and the fill together. If it reverts, neither happens.";
  if (step === "fee")
    return zh
      ? "已经成交。这一笔扣 0.20% 手续费。"
      : "Filled. This confirmation is the 0.20% fee.";
  if (step === "trade")
    return zh ? "正在成交。" : "Filling now.";
  return zh
    ? "正在成交。成交后马上扣 0.20%。"
    : "Filling now. The 0.20% is taken right after it succeeds.";
}
