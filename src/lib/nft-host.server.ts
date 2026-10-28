import { getRequest } from "@tanstack/react-start/server";
import { hostIsNft } from "./nft-host";

export function requestIsNft(): boolean {
  try {
    const request = getRequest();
    const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    return hostIsNft(raw);
  } catch {
    return false;
  }
}
