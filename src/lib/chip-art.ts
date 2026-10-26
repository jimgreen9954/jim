import { createServerFn } from "@tanstack/react-start";

type ArtIn = { style: "punk" | "real"; prompt: string; key: string };

export const mintChipArt = createServerFn({ method: "POST" })
  .validator((input: ArtIn) => {
    const style = input?.style === "real" ? "real" : "punk";
    const prompt = String(input?.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
    const key = String(input?.key ?? "").trim().slice(0, 300);
    if (!prompt) throw new Error("没有画面描述");
    return { style, prompt, key };
  })
  .handler(async ({ data }) => {
    const apiKey = data.key || process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "平台默认出图现在不可用。可以改用你自己的 Key，或先上传图片。" };
    const look =
      data.style === "punk"
        ? "crypto-punk pixel portrait, chunky pixels, flat limited colors, hard outline, unique face, square, no letters, no watermark"
        : "photoreal macro photograph of a real silicon chip, metal pads, studio light, sharp, square, no letters, no watermark";
    const res = await fetch("https://api.x.ai/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-imagine-image",
        prompt: `${look}. ${data.prompt}`,
        n: 1,
        resolution: "1k",
        response_format: "url",
      }),
      signal: AbortSignal.timeout(50000),
    });
    if (!res.ok) return { ok: false as const, error: `出图失败（${res.status}）。Key 或额度可能不对，没有换成假图。` };
    const body = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
    const row = body.data?.[0];
    if (row?.url) return { ok: true as const, image: row.url };
    if (row?.b64_json) return { ok: true as const, image: `data:image/png;base64,${row.b64_json}` };
    return { ok: false as const, error: "接口没有返回图片。" };
  });
