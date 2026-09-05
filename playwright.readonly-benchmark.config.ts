import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "readonly-rendering-benchmark.spec.ts",
  timeout: 180000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:8011",
    viewport: { width: 390, height: 852 },
    serviceWorkers: "block",
  },
  webServer: {
    command: "npx vite preview --host 127.0.0.1 --port 8011",
    port: 8011,
    reuseExistingServer: false,
  },
});
