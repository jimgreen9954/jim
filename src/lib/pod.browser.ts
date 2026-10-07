import { loadPodMiners } from "./pod.server";

export { bemText, claimPod, POD, readPodPending, readPodStats, type PodStats } from "./pod";

export function getPodMiners(input: { data: { account?: string } }) {
  return loadPodMiners(input.data?.account ?? "");
}
