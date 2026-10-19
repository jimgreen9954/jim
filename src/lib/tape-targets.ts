import { createServerFn } from "@tanstack/react-start";
import { DEPLOYED } from "@/lib/xlayer";

export type TapeTarget = {
  chain: "bsc" | "xlayer";
  name: string;
  circuits: string;
  transistors: string;
  ours: boolean;
};

export const OURS: TapeTarget = {
  chain: "xlayer",
  name: "TAPELIQUID",
  circuits: DEPLOYED.circuits,
  transistors: DEPLOYED.transistors,
  ours: true,
};

export const getTapeTargets = createServerFn({ method: "GET" }).handler(async (): Promise<TapeTarget[]> => {
  const { loadTapeTargets } = await import("./tape-targets.server");
  return loadTapeTargets();
});
