import { createFileRoute } from "@tanstack/react-router";
import { census, CPUNK_SUPPLY, punkMeta, punkPng, sampleIds } from "@/lib/circuit-punk";

const HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
};

export const Route = createFileRoute("/api/circuit-punk/$")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: HEADERS }),
      GET: ({ request, params }) => {
        const raw = decodeURIComponent(params._splat ?? "").replace(/\/$/, "");
        const origin = new URL(request.url).origin;
        if (raw === "sample") {
          const ids = sampleIds();
          return Response.json(
            { supply: CPUNK_SUPPLY, census: census(), ids, items: ids.map((id) => punkMeta(id, origin)) },
            { headers: { ...HEADERS, "cache-control": "public, max-age=300" } },
          );
        }
        const png = raw.endsWith(".png");
        const id = Number(png ? raw.slice(0, -4) : raw);
        if (!Number.isInteger(id) || id < 1 || id > CPUNK_SUPPLY) {
          return new Response("no", { status: 404, headers: HEADERS });
        }
        if (png) {
          return new Response(new Uint8Array(punkPng(id)), {
            headers: { ...HEADERS, "content-type": "image/png", "cache-control": "public, max-age=86400" },
          });
        }
        return Response.json(punkMeta(id, origin), {
          headers: { ...HEADERS, "cache-control": "public, max-age=86400" },
        });
      },
    },
  },
});
