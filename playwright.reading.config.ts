import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { readingFiles } from "./scripts/e2e-suites.mjs";
export default defineConfig({
  ...base,
  testMatch: readingFiles.map((file) => `**/${file}`),
  workers: 1,
  use: {
    ...base.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: { ...base.webServer!, reuseExistingServer: !process.env.CI },
});
