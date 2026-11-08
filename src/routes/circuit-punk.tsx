import { useLayoutEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { bootLaunch } from "@/lib/launch-desk";

export const Route = createFileRoute("/circuit-punk")({ component: MarketPage });

function pageHtml(launchHtml: string) {
  const style = launchHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const body = launchHtml.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "";
  const fixed = body.replace(/src="(?!\/|https?:)([^"]+)"/g, 'src="/tape-launch/$1"');
  return `<style>${style}</style>${fixed}`;
}

export function MarketPage() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    let dead = false;
    let cleanup: (() => void) | void;
    document.title = "TAPELIQUID NFT Market";
    const icon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (icon) {
      icon.type = "image/png";
      icon.href = "/tape-launch/mark-hammer.png";
    }
    fetch("/tape-launch/index.html")
      .then((res) => res.text())
      .then((raw) => {
        if (dead || !ref.current) return;
        ref.current.innerHTML = pageHtml(raw);
        try {
          cleanup = bootLaunch(ref.current);
        } catch (error) {
          const msg = ref.current.querySelector("#factory-msg");
          if (msg) msg.textContent = error instanceof Error ? error.message : "页面没有绑上。";
        }
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      if (typeof cleanup === "function") cleanup();
    };
  }, []);
  return <div ref={ref} className="tape-root" />;
}