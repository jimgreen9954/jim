import { createFileRoute } from "@tanstack/react-router";

const HOSTS = new Set(["web3.okx.com", "static.okx.com", "static.coinall.ltd"]);

export const Route = createFileRoute("/api/okx-img")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = new URL(request.url).searchParams.get("u") || "";
        let target: URL;
        try {
          target = new URL(raw);
        } catch {
          return new Response("no", { status: 400 });
        }
        if (target.protocol !== "https:" || !HOSTS.has(target.hostname)) {
          return new Response("no", { status: 400 });
        }
        const res = await fetch(target, {
          headers: { "user-agent": "Mozilla/5.0", accept: "image/*", referer: "https://web3.okx.com/" },
          signal: AbortSignal.timeout(12_000),
        });
        const type = res.headers.get("content-type") || "";
        if (!res.ok || !type.startsWith("image/")) return new Response("no", { status: 502 });
        return new Response(res.body, {
          headers: { "content-type": type, "cache-control": "public, max-age=86400" },
        });
      },
    },
  },
});
