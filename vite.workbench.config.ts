import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import pcre2Assets from "./build-plugins/vite-pcre2-assets";

// Separate origin, output, and optimizer cache. Never installs Nine Rings' SW.
export default defineConfig({
  plugins: [react(), pcre2Assets(), {
    name: "workbench-host-boundary",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of Object.keys(output.modules)) {
          const path = id.replaceAll("\\", "/");
          if (["/src/App.tsx", "/src/main.tsx", "/src/lib/storage/index.ts", "/src/lib/api.ts"].some(suffix => path.endsWith(suffix)))
            this.error(`独立工作台不能装配数据库应用入口：${path}`);
        }
      }
    },
  }],
  // The search worker loads PCRE2 lazily; prebundle before a user searches so
  // the development server cannot reload an authorized directory session.
  optimizeDeps: { include: ["pcre2-wasm"] },
  cacheDir: ".local-tools/vite-workbench-cache",
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  preview: { host: "127.0.0.1", port: 1421, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify("file-workbench-prototype") },
  resolve: { alias: { "decode-named-character-reference": fileURLToPath(new URL("./node_modules/decode-named-character-reference/index.js", import.meta.url)) } },
  worker: { format: "es", plugins: () => [pcre2Assets()] },
  build: { outDir: ".local-tools/file-workbench-dist", rollupOptions: { input: fileURLToPath(new URL("./file-workbench.html", import.meta.url)) } },
});
