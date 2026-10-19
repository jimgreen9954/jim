import { createServerFn } from "@tanstack/react-start";

export type Bias = { side: "long" | "short" | "flat"; price: number; why: string };

type Tick = { o: number; h: number; l: number; c: number };

function project(bars: Tick[]): number {
  const last = bars[bars.length - 1]?.c ?? 0;
  if (!(last > 0)) return 0;
  const sample = bars.slice(-8).map((bar) => bar.c);
  const first = sample[0] ?? last;
  const slope = (last - first) / Math.max(1, sample.length - 1);
  const raw = last + slope * 3;
  return Math.min(last * 1.04, Math.max(last * 0.96, raw));
}

function read(text: string): Bias {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return { side: "flat", price: 0, why: "" };
  const raw = JSON.parse(text.slice(start, end + 1)) as { side?: string; price?: number; why?: string };
  const side = raw.side === "long" || raw.side === "short" ? raw.side : "flat";
  const price = Number(raw.price);
  return {
    side,
    price: Number.isFinite(price) && price > 0 ? price : 0,
    why: String(raw.why ?? "").slice(0, 420),
  };
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function windowKey(lang: string, bars: Tick[]): string {
  let hash = 2166136261;
  const text = `${lang}|${bars.map((bar) => [bar.o, bar.h, bar.l, bar.c].map((n) => n.toFixed(6)).join(",")).join(";")}`;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

const calls: number[] = [];
let inflight = 0;
let cached: { key: string; at: number; row: Bias } | null = null;
const pending = new Map<string, Promise<Bias>>();

export const readBias = createServerFn({ method: "POST" })
  .validator((input: { lang: "zh" | "en"; bars: Tick[] }) => {
    const bars = Array.isArray(input?.bars) ? input.bars.slice(-36) : [];
    return {
      lang: input?.lang === "en" ? "en" : "zh",
      bars: bars.filter((bar) => bar && finite(bar.o) && finite(bar.h) && finite(bar.l) && finite(bar.c)),
    };
  })
  .handler(async ({ data }): Promise<Bias> => {
    const key = process.env.XAI_API_KEY;
    if (!key || data.bars.length < 8) return { side: "flat", price: 0, why: "" };
    const last = data.bars[data.bars.length - 1]?.c ?? 0;
    const cacheKey = windowKey(data.lang, data.bars);
    if (cached && cached.key === cacheKey && Date.now() - cached.at < 120_000) return cached.row;
    const waiting = pending.get(cacheKey);
    if (waiting) return waiting;
    const now = Date.now();
    while (calls.length && now - calls[0] > 60_000) calls.shift();
    if (calls.length >= 20 || inflight >= 2) return { side: "flat", price: project(data.bars), why: "" };
    calls.push(now);
    inflight += 1;
    const window = data.bars.map((bar) => [
      Number(bar.o.toFixed(6)),
      Number(bar.h.toFixed(6)),
      Number(bar.l.toFixed(6)),
      Number(bar.c.toFixed(6)),
    ]);
    const job = (async (): Promise<Bias> => {
      try {
        const res = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          signal: AbortSignal.timeout(12_000),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "grok-4",
            temperature: 0,
            max_tokens: 360,
            messages: [
              {
                role: "system",
                content:
                  "You read one BEM/USDT candle window. Each row is open, high, low, close, oldest first. Reply JSON only: {\"side\":\"long\"|\"short\"|\"flat\",\"price\":number,\"why\":\"...\"}. price is a future BEM/USDT close within 4 percent of lastClose. If lastClose is 29.59, price is about 29, never 65 and never a 0-100 score. why is three sentences in the user's language: what the BEM price just did, why you lean that way, and what would cancel the lean. Mention the guessed price in the same units as lastClose. Not a promise.",
              },
              { role: "user", content: JSON.stringify({ lang: data.lang, lastClose: last, candles: window }) },
            ],
          }),
        });
        if (!res.ok) return { side: "flat", price: project(data.bars), why: "" };
        const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const parsed = read(body.choices?.[0]?.message?.content ?? "");
        const near = parsed.price > last * 0.96 && parsed.price < last * 1.04;
        const row = { ...parsed, price: near ? parsed.price : project(data.bars) };
        cached = { key: cacheKey, at: Date.now(), row };
        return row;
      } catch {
        return { side: "flat", price: project(data.bars), why: "" };
      } finally {
        inflight -= 1;
        pending.delete(cacheKey);
      }
    })();
    pending.set(cacheKey, job);
    return job;
  });
