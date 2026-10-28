import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Exchange } from "@/components/exchange/exchange";
import { hostIsNft, readNftHost } from "@/lib/nft-host";
import { MarketPage } from "@/routes/circuit-punk";

export const Route = createFileRoute("/")({
  loader: () => readNftHost(),
  component: Home,
});

function Home() {
  const serverNft = Route.useLoaderData();
  const [nft, setNft] = useState(serverNft);
  useEffect(() => {
    if (hostIsNft(window.location.hostname)) setNft(true);
  }, []);
  return nft ? <MarketPage /> : <Exchange />;
}

