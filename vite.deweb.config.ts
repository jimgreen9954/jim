import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
const asyncHooks = fileURLToPath(new URL("./src/shims/async-hooks.js", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./deweb-app", import.meta.url)),
  publicDir: fileURLToPath(new URL("./deweb-public", import.meta.url)),
  plugins: [
    {
      name: "browser-async-hooks",
      enforce: "pre",
      resolveId(id) {
        if (id === "node:async_hooks" || id === "async_hooks") return asyncHooks;
      },
    },
    react(),
    tailwindcss(),
    {
      name: "deweb-one-file",
      apply: "build",
      enforce: "post",
      generateBundle(_, bundle) {
        const cssName = Object.keys(bundle).find((name) => name.endsWith(".css"));
        const jsName = Object.keys(bundle).find((name) => name.endsWith(".js"));
        const htmlName = Object.keys(bundle).find((name) => name.endsWith(".html"));
        if (cssName && jsName) {
          const cssFile = bundle[cssName];
          const jsFile = bundle[jsName];
          if (cssFile.type === "asset" && jsFile.type === "chunk") {
            const css = typeof cssFile.source === "string" ? cssFile.source : new TextDecoder().decode(cssFile.source);
            jsFile.code = `document.head.appendChild(Object.assign(document.createElement("style"),{textContent:${JSON.stringify(css)}}));${jsFile.code}`;
            delete bundle[cssName];
          }
        }
        if (htmlName && bundle[htmlName].type === "asset") {
          const htmlFile = bundle[htmlName];
          const html = typeof htmlFile.source === "string" ? htmlFile.source : new TextDecoder().decode(htmlFile.source);
          htmlFile.source = html.replace(/<link rel="stylesheet"[^>]*>\s*/g, "");
        }
      },
      transformIndexHtml(html) {
        return html
          .replaceAll(" crossorigin", "")
          .replace(
            '<div id="root"></div>',
            '<div id="root"><p style="margin:0;padding:28px 20px;font:16px/1.5 sans-serif;color:#1a1a1a;background:#fff">TAPELIQUID 正在打开。</p></div>',
          );
      },
    },
  ],
  base: "./",
  resolve: {
    alias: [
      { find: "node:async_hooks", replacement: asyncHooks },
      { find: "async_hooks", replacement: asyncHooks },
      { find: "@/lib/candles", replacement: fileURLToPath(new URL("./src/lib/candles.browser.ts", import.meta.url)) },
      { find: "@/lib/bias", replacement: fileURLToPath(new URL("./src/lib/bias.browser.ts", import.meta.url)) },
      { find: "@/lib/tapeout-live", replacement: fileURLToPath(new URL("./src/lib/tapeout-live.browser.ts", import.meta.url)) },
      { find: "@/lib/transistor-market", replacement: fileURLToPath(new URL("./src/lib/transistor-market.browser.ts", import.meta.url)) },
      { find: "@/lib/gate-book", replacement: fileURLToPath(new URL("./src/lib/gate-book.browser.ts", import.meta.url)) },
      { find: "@/lib/rebate-index", replacement: fileURLToPath(new URL("./src/lib/rebate-index.browser.ts", import.meta.url)) },
      { find: "@/lib/holdings", replacement: fileURLToPath(new URL("./src/lib/holdings.browser.ts", import.meta.url)) },
      { find: "@/lib/official-books", replacement: fileURLToPath(new URL("./src/lib/official-books.browser.ts", import.meta.url)) },
      { find: "@/lib/pod", replacement: fileURLToPath(new URL("./src/lib/pod.browser.ts", import.meta.url)) },
      { find: "@/lib/tape-targets", replacement: fileURLToPath(new URL("./src/lib/tape-targets.browser.ts", import.meta.url)) },
      { find: "@", replacement: src },
    ],
  },
  server: { fs: { allow: [fileURLToPath(new URL(".", import.meta.url))] } },
  build: {
    outDir: fileURLToPath(new URL("./deweb-dist", import.meta.url)),
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
