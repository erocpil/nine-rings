import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "**/file-workbench.spec.ts", timeout: 30000, retries: 0, workers: 1,
  use: { baseURL: "http://127.0.0.1:1421", headless: true, trace: "retain-on-failure", viewport: { width: 1280, height: 800 } },
  webServer: { command: process.env.NR_WORKBENCH_PREVIEW === "true" ? "npm run preview:workbench" : "npx vite --config vite.workbench.config.ts", url: "http://127.0.0.1:1421/file-workbench.html", reuseExistingServer: false, stdout: "pipe" },
});
