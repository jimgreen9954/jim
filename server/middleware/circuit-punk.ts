import { serveCircuitPunk } from "../../src/lib/circuit-punk-http.ts";

export default function circuitPunk(
  event: { url: URL },
  next: () => unknown,
): unknown {
  return serveCircuitPunk(event.url) ?? next();
}
