import { serveOkxImage } from "../../src/lib/okx-img.ts";

export default function okxImage(event: { url: URL }, next: () => unknown): unknown {
  if (event.url.pathname !== "/api/okx-img") return next();
  return serveOkxImage(event.url);
}
