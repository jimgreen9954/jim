let tail: Promise<void> = Promise.resolve();
const saved = new Map<string, { at: number; body: string }>();

function json(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

/** One Gecko call at a time. A 429 used to come back empty, so the chart had no price. */
export function geckoFetch(url: string): Promise<Response> {
  const run = tail.then(async () => {
    const hit = saved.get(url);
    if (hit && Date.now() - hit.at < 90_000) return json(hit.body);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const pull = () => fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    let res = await pull();
    for (let i = 0; i < 4 && res.status === 429; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1600 * (i + 1)));
      res = await pull();
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
