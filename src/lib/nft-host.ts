import { createServerFn } from "@tanstack/react-start";

export function hostIsNft(host: string): boolean {
  const name = host.split(",")[0]?.trim().split(":")[0]?.toLowerCase() ?? "";
  return name === "nft.tapeliquid.net";
}

export const readNftHost = createServerFn({ method: "GET" }).handler(async () => {
  const { requestIsNft } = await import("./nft-host.server");
  return requestIsNft();
});
