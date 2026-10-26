let tail: Promise<void> = Promise.resolve();

/** One Gecko call at a time. A burst of charts otherwise comes back 429 and looks empty. */
export function geckoFetch(url: string): Promise<Response> {
  const run = tail.then(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const pull = () => fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    let res = await pull();
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1800));
      res = await pull();
    }
    return res;
  });
  tail = run.then(() => undefined, () => undefined);
  return run;
}
