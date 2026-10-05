import { createServerFn } from "@tanstack/react-start";

export type Bias = { side: "long" | "short" | "flat"; price: number; why: string };

type Tick = { o: number; h: number; l: number; c: number };

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

export const readBias = createServerFn({ method: "POST" })
  .validator((input: { lang: "zh" | "en"; bars: Tick[] }) => {
    const bars = Array.isArray(input?.bars) ? input.bars.slice(-36) : [];
    return {
      lang: input?.lang === "en" ? "en" : "zh",
      bars: bars.filter((bar) => bar && bar.o > 0 && bar.h > 0 && bar.l > 0 && bar.c > 0),
    };
  })
  .handler(async ({ data }): Promise<Bias> => {
    const key = process.env.XAI_API_KEY;
    if (!key || data.bars.length < 8) return { side: "flat", price: 0, why: "" };
    const last = data.bars[data.bars.length - 1]?.c ?? 0;
    const window = data.bars.map((bar) => [
      Number(bar.o.toFixed(6)),
      Number(bar.h.toFixed(6)),
      Number(bar.l.toFixed(6)),
      Number(bar.c.toFixed(6)),
    ]);
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "grok-4",
        temperature: 0,
        max_tokens: 360,
        messages: [
          {
            role: "system",
            content:
              "You read one BEM/USDT candle window. Each row is open, high, low, close, oldest first. Reply JSON only: {\"side\":\"long\"|\"short\"|\"flat\",\"price\":number,\"why\":\"...\"}. side is your lean for the next few candles. price is your guessed BEM/USDT close, on the same scale as the last close, never a 0-100 score. why is three sentences in the user's language: what price just did, why you lean that way, and what would cancel the lean. Not a promise.",
          },
          { role: "user", content: JSON.stringify({ lang: data.lang, lastClose: last, candles: window }) },
        ],
      }),
    });
    if (!res.ok) return { side: "flat", price: 0, why: "" };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return read(body.choices?.[0]?.message?.content ?? "");
  });
