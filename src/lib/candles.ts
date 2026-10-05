import { createServerFn } from "@tanstack/react-start";
import { pullPaper, type PaperFrame } from "@/lib/candle-book";
import { pullBem, type CandleFrame } from "@/lib/bem-ohlcv";

export type { Ohlc, PaperFrame } from "@/lib/candle-book";
export { PAPER_FRAMES, paperLabel } from "@/lib/candle-book";
export type { Candle, CandleFrame } from "@/lib/bem-ohlcv";

const frames: CandleFrame[] = ["15s", "1m", "5m", "15m", "1h", "4h", "1w", "1M", "3M", "1y"];

export const getCandles = createServerFn({ method: "GET" })
  .validator((frame: CandleFrame) => (frames.includes(frame) ? frame : "1m"))
  .handler(async ({ data }) => pullBem(data));

export const getPaperCandles = createServerFn({ method: "GET" })
  .validator((frame: PaperFrame) => (frame === "5m" || frame === "10m" || frame === "1h" || frame === "4h" || frame === "1d" || frame === "1w" ? frame : "1m"))
  .handler(async ({ data }) => pullPaper(data));
