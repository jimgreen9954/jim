export type Bias = { side: "long" | "short" | "flat"; price: number; why: string };

type Tick = { o: number; h: number; l: number; c: number };

function project(bars: Tick[]): number {
  const last = bars[bars.length - 1]?.c ?? 0;
  if (!(last > 0)) return 0;
  const sample = bars.slice(-8).map((bar) => bar.c);
  const first = sample[0] ?? last;
  const slope = (last - first) / Math.max(1, sample.length - 1);
  return Math.min(last * 1.04, Math.max(last * 0.96, last + slope * 3));
}

export async function readBias(input: { data: { lang: "zh" | "en"; bars?: Tick[] } }): Promise<Bias> {
  const zh = input?.data?.lang !== "en";
  const bars = (input?.data?.bars ?? []).filter((bar) => bar && bar.c > 0);
  const last = bars[bars.length - 1]?.c ?? 0;
  if (bars.length < 8 || !(last > 0)) {
    return { side: "flat", price: 0, why: zh ? "K 线还不够，先不判断。" : "Not enough candles yet." };
  }
  const first = bars.slice(-8)[0]?.c ?? last;
  const slope = last - first;
  const side: Bias["side"] = slope < -last * 0.001 ? "short" : slope > last * 0.001 ? "long" : "flat";
  const price = project(bars);
  const why = zh
    ? `最近收盘从 ${first.toFixed(4)} 走到 ${last.toFixed(4)}。${side === "short" ? "收盘在往下，所以看空。" : side === "long" ? "收盘在往上，所以看多。" : "这段几乎走平，所以先观望。"} 预测价 ${price.toFixed(4)}，离现价不超过 4%。若收盘走到另一边，这个判断就不算了。`
    : `The close moved from ${first.toFixed(4)} to ${last.toFixed(4)}. ${side === "short" ? "Closes are falling, so the lean is short." : side === "long" ? "Closes are rising, so the lean is long." : "The stretch is flat, so there is no lean."} The guess is ${price.toFixed(4)}, within 4% of the live price. A close through the other side cancels it.`;
  return { side, price, why };
}
