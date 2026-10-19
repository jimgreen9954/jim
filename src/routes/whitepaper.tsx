import { createFileRoute } from "@tanstack/react-router";
import { Exchange } from "@/components/exchange/exchange";

export const Route = createFileRoute("/whitepaper")({
  component: PaperPage,
});

function PaperPage() {
  return <Exchange start="brief" />;
}
