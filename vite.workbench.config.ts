import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import pdfjsCMapAssets from "./build-plugins/vite-pdfjs-cmaps-plugin";
import pcre2Assets from "./build-plugins/vite-pcre2-assets";

// Separate origin, output, and optimizer cache. Never installs Nine Rings' SW.
export default defineConfig({
  plugins: [react(), pcre2Assets(), pdfjsCMapAssets(), {
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
  optimizeDeps: { include: ["pcre2-wasm", "@wasm-fmt/clang-format/vite"] },
  cacheDir: ".local-tools/vite-workbench-cache",
  server: { host: "127.0.0.1", port: 1421, strictPort: true },
  preview: { host: "127.0.0.1", port: 1421, strictPort: true },
  define: { __APP_VERSION__: JSON.stringify("file-workbench-prototype") },
  resolve: { alias: { "decode-named-character-reference": fileURLToPath(new URL("./node_modules/decode-named-character-reference/index.js", import.meta.url)) } },
  worker: { format: "es", plugins: () => [pcre2Assets()] },
  build: { outDir: ".local-tools/file-workbench-dist", rollupOptions: { input: fileURLToPath(new URL("./file-workbench.html", import.meta.url)), output: {
    onlyExplicitManualChunks: true,
    manualChunks(id) {
      // The shared source editor must not pull CodeMirror's base runtime into a
      // single oversized UI chunk. Every host still consumes identical modules.
      const normalized = id.replaceAll("\\", "/");
      if (/\/node_modules\/(?:@codemirror\/(?:state|view|language|commands|autocomplete|search)|@lezer\/(?:common|highlight|lr))\//.test(normalized)) return "source-editor-runtime";
      if (/\/node_modules\/(?:mdast-|micromark|hast-|parse5\/|entities\/|decode-named-character-reference\/|character-|property-information\/|space-separated-tokens\/|comma-separated-tokens\/|ccount\/|longest-streak\/|devlop\/|unist-|trim-lines\/|vfile|zwitch\/|hastscript\/|web-namespaces\/|markdown-table\/|dequal\/|escape-string-regexp\/)/.test(normalized)) return "markdown-runtime";
      if (/\/node_modules\/(?:mermaid|@mermaid-js|d3-[^/]+|cytoscape|dagre-d3-es|@dagrejs|@iconify)\//.test(normalized)) return undefined;
      if (/\/node_modules\/(?:@tiptap|prosemirror-[^/]+)\//.test(normalized)) return "document-runtime";
      if (/\/node_modules\/(?:lodash-es|dayjs|dompurify|marked|roughjs|stylis|ts-dedent)\//.test(normalized)) return "diagram-utilities";
      if (normalized.includes("/node_modules/katex/")) return "math-runtime";
      return undefined;
    },
  } } },
});
