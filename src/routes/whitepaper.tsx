import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Whitepaper } from "@/components/exchange/whitepaper";
import { previewPathPrefix } from "@/lib/preview-path-prefix";

export const Route = createFileRoute("/whitepaper")({
  component: PaperPage,
});

function PaperPage() {
  const [href, setHref] = useState("/");
  const [exitLabel, setExitLabel] = useState("退出");
  useEffect(() => {
    const prefix = previewPathPrefix(window.location.hostname, window.location.pathname);
    if (prefix) setHref(`${prefix}/`);
    const sync = () => setExitLabel(window.localStorage.getItem("tape-lang") === "en" ? "Exit" : "退出");
    sync();
    window.addEventListener("tape-lang", sync);
    return () => window.removeEventListener("tape-lang", sync);
  }, []);
  return (
    <main className="min-h-screen bg-[#f4efe4] text-[#1a140c]">
      <div className="sticky top-0 z-30 border-b border-[#e0b15a]/50 bg-[#fffdf8]/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <a href={href} className="relative inline-flex" aria-label="TAPELIQUID">
            <img src="/tape-launch/logo.png" alt="" width={40} height={40} className="rounded-lg bg-white" />
          </a>
          <a
            href={href}
            className="inline-flex h-10 items-center rounded-full border border-[#e0b15a] bg-[#1a140c] px-4 text-sm font-semibold text-[#e0b15a]"
          >
            {exitLabel}
          </a>
        </div>
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-8">
        <Whitepaper />
      </div>
    </main>
  );
}