import { createFileRoute } from "@tanstack/react-router";
import { Exchange } from "@/components/exchange/exchange";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Exchange />;
}
