import { useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import launchHtml from "../../public/tape-launch/index.html?raw";
import { bootLaunch } from "@/lib/launch-desk";

export const Route = createFileRoute("/")({ component: Home });

function pageHtml() {
  const style = launchHtml.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
  const body = launchHtml.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? "";
  const fixed = body.replace(/src="(?!\/|https?:)([^"]+)"/g, 'src="/tape-launch/$1"');
  return `<style>${style}</style>${fixed}`;
}

const html = pageHtml();

function Home() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    return bootLaunch(host);
  }, []);
  return <div ref={ref} className="tape-root" dangerouslySetInnerHTML={{ __html: html }} />;
}