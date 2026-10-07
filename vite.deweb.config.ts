import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./deweb-app", import.meta.url)),
  publicDir: fileURLToPath(new URL("./deweb-public", import.meta.url)),
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: [
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
      },
    },
  },
});
