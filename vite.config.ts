import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import importPlugin from "./plugins/vite-import-plugin";

const host = process.env.TAURI_DEV_HOST;
const port = parseInt(process.env.VITE_DEV_PORT || "1420", 10);

export default defineConfig(async () => ({
  plugins: [react(), importPlugin()],
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
