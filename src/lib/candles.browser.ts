export type { Ohlc, PaperFrame } from "@/lib/candle-book";
export { PAPER_FRAMES, paperLabel } from "@/lib/candle-book";
export type { Candle, CandleFrame } from "@/lib/bem-ohlcv";
import { pullPaper, type PaperFrame } from "@/lib/candle-book";
import { pullBem, type CandleFrame } from "@/lib/bem-ohlcv";
import { pullSpot, type SpotFrame, type SpotPair } from "@/lib/spot-ohlcv";

export async function getPaperCandles(input: { data: PaperFrame } | PaperFrame) {
  const frame = typeof input === "string" ? input : input.data;
  return pullPaper(frame);
}

export async function getCandles(input: { data: CandleFrame } | CandleFrame) {
  const frame = typeof input === "string" ? input : input.data;
  return pullBem(frame);
}

export async function getSpotCandles(input: { data: { pair?: SpotPair; frame?: SpotFrame } } | { pair?: SpotPair; frame?: SpotFrame }) {
  const body = "data" in input ? input.data : input;
  return pullSpot(body.pair ?? "bem", body.frame ?? "1m");
}
