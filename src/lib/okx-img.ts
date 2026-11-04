const ALLOWED = new Set(["web3.okx.com", "static.okx.com", "static.coinall.ltd"]);

export async function serveOkxImage(url: URL): Promise<Response | null> {
  if (url.pathname !== "/api/okx-img") return null;
  let target: URL;
  try {
    target = new URL(url.searchParams.get("u") ?? "");
  } catch {
    return new Response("no", { status: 400 });
  }
  if (target.protocol !== "https:" || target.username || target.password || !ALLOWED.has(target.hostname)) {
    return new Response("no", { status: 400 });
  }
  try {
    const res = await fetch(target, {
      headers: {
        accept: "image/avif,image/webp,image/png,image/*,*/*",
        "user-agent": "Mozilla/5.0",
        referer: "https://web3.okx.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return new Response("no", { status: 502 });
    return new Response(await res.arrayBuffer(), {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("no", { status: 502 });
  }
}
