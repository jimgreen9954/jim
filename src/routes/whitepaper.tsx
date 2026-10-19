import { createFileRoute } from "@tanstack/react-router";
import { Whitepaper } from "@/components/exchange/whitepaper";

export const Route = createFileRoute("/whitepaper")({
  component: PaperPage,
});

function PaperPage() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-8">
        <a href="/" className="text-sm font-semibold text-[#2081e2]">
          TAPELIQUID
        </a>
        <Whitepaper />
      </div>
    </main>
  );
}
