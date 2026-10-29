import { createFileRoute } from "@tanstack/react-router";
import { Exchange } from "@/components/exchange/exchange";
import { hostIsNft, readNftHost } from "@/lib/nft-host";
import { MarketPage } from "@/routes/circuit-punk";

export const Route = createFileRoute("/")({
  loader: () => readNftHost(),
  staleTime: Number.POSITIVE_INFINITY,
  component: Home,
});

function Home() {
  const serverNft = Route.useLoaderData();
  const nft = typeof window === "undefined" ? serverNft : hostIsNft(window.location.hostname);
  return nft ? <MarketPage /> : <Exchange />;
}
