import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import importPlugin from "./plugins/vite-import-plugin";
import pwaPlugin from "./plugins/vite-pwa-plugin";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const host = process.env.TAURI_DEV_HOST;
const port = parseInt(process.env.VITE_DEV_PORT || "1420", 10);

function buildVersion(): string {
  try {
    const hash = execSync("git rev-parse --short=7 HEAD", { encoding: "utf-8" }).trim();
    const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15); // 20260711T1530
    return `${hash}.${ts}`;
  } catch {
    // 非 git 环境回退到 package.json version
    const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
    return `v${pkg.version}`;
  }
}

export default defineConfig(async () => {
  const version = buildVersion();
  const normalizePath = (id: string): string => id.split("\\").join("/");
  const isLazyModule = (id: string, suffix: string): boolean =>
    normalizePath(id).endsWith(`/src/${suffix}`);

  return ({
  plugins: [react(), importPlugin(), pwaPlugin(version)],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        // 懒加载组件只把组件自身放入命名 chunk。Rollup 的旧默认行为会把其
        // 依赖一并吸入手动 chunk；主应用复用这些依赖时，浏览器反而必须在
        // 首屏预加载设置、回收站、编辑器等所有延迟功能。
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (!id) return undefined;
          const normalized = normalizePath(id);

          if (normalized.includes("/node_modules/")) {
            // PDF 阅读器是独立的按需界面；PDF.js 体积较大，不能并入普通
            // 文档首屏共用的 vendor chunk。
            if (normalized.includes("/node_modules/pdfjs-dist/")) return "pdfjs";
            if (normalized.includes("/node_modules/@tiptap/") || normalized.includes("/node_modules/prosemirror-")) {
              return "editor";
            }
            if (normalized.includes("/node_modules/@dnd-kit/")) {
              return "dnd";
            }
            if (normalized.includes("/node_modules/@tauri-apps")) {
              return "tauri-shim";
            }
            return "vendor";
          }

          if (isLazyModule(normalized, "components/SettingsPanel.tsx")) return "settings";
          if (isLazyModule(normalized, "components/VersionHistory.tsx")) return "note-history";
          if (isLazyModule(normalized, "components/DebugPanel.tsx")) return "debug";
          if (isLazyModule(normalized, "components/RecycleBin.tsx")) return "recycle";
          if (isLazyModule(normalized, "components/DocCreateDialog.tsx")) return "doc-create";
          if (isLazyModule(normalized, "components/PropertiesPanel.tsx")) return "properties";
          if (normalized.includes("/lib/sync/github.ts")) return "github-sync";

          return undefined;
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: port + 1 }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  });
});
