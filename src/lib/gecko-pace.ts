let tail: Promise<void> = Promise.resolve();
const saved = new Map<string, { at: number; body: string }>();
let blockedUntil = 0;

function json(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

/** One Gecko call at a time. A hard 429 used to stall every chart, so that case fails fast. */
export function geckoFetch(url: string): Promise<Response> {
  const run = tail.then(async () => {
    const hit = saved.get(url);
    if (hit && Date.now() - hit.at < 90_000) return json(hit.body);
    if (Date.now() < blockedUntil) return new Response("", { status: 429 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (res.status === 429) {
      blockedUntil = Date.now() + 60_000;
      if (hit) return json(hit.body);
      return res;
    }
    if (res.ok) {
      const body = await res.text();
      saved.set(url, { at: Date.now(), body });
      return json(body);
    }
    if (hit) return json(hit.body);
    return res;
  });
  tail = run.then(() => undefined, () => undefined);
  return run;
}