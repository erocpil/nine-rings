import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import importPlugin from "./plugins/vite-import-plugin";
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

export default defineConfig(async () => ({
  plugins: [react(), importPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
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
}));
