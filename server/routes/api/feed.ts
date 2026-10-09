import { defineHandler } from "nitro";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept, content-type",
};

const FILES = new Set([
  "/market.json",
  "/circuit-market.json",
  "/processors.json",
  "/pod/pod-miners.json",
]);

const cache = new Map<string, { at: number; status: number; type: string; body: ArrayBuffer }>();

function allowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.hostname === "tapeout.net") return FILES.has(url.pathname) && url.search === "";
  if (url.hostname !== "api-tapeout.firsto.ai") return false;
  if (url.pathname === "/v1/markets/rail") return true;
  return /^\/v1\/book\/0x[a-fA-F0-9]{40}\/[01]$/.test(url.pathname);
}

export default defineHandler(async (event) => {
  if (event.req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const target = event.url.searchParams.get("u") ?? "";
  if (!allowed(target)) return new Response("no", { status: 400, headers: CORS });
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < 12_000) {
    return new Response(hit.body, {
      status: hit.status,
      headers: { ...CORS, "content-type": hit.type, "cache-control": "public, max-age=10" },
    });
  }
  const res = await fetch(target, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  const body = await res.arrayBuffer();
  const type = res.headers.get("content-type") || "application/json; charset=utf-8";
  if (res.ok) cache.set(target, { at: Date.now(), status: res.status, type, body });
  return new Response(body, {
    status: res.status,
    headers: { ...CORS, "content-type": type, "cache-control": "public, max-age=10" },
  });
});
