import { census, CPUNK_SUPPLY, punkMeta, punkPng, sampleIds } from "./circuit-punk.ts";

export function serveCircuitPunk(url: URL): Response | null {
  if (url.pathname === "/api/circuit-punk/sample") {
    const items = sampleIds().map((id) => {
      const meta = punkMeta(id, url.origin);
      return { name: meta.name, attributes: meta.attributes };
    });
    return Response.json(
      { census: census(), items },
      { headers: { "cache-control": "public, max-age=3600" } },
    );
  }
  const match = url.pathname.match(/^\/api\/circuit-punk\/(\d+)\.png$/);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isInteger(id) || id < 1 || id > CPUNK_SUPPLY) return new Response("no", { status: 404 });
  const png = punkPng(id);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
