import { loadTapeTargets } from "./tape-targets.server";

export { OURS, type TapeTarget } from "./tape-targets";

export function getTapeTargets() {
  return loadTapeTargets();
}
