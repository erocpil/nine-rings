import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { coreFiles } from "./scripts/e2e-suites.mjs";
export default defineConfig({
  ...base,
  testMatch: coreFiles.map((file) => `**/${file}`),
  use: {
    ...base.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: { ...base.webServer!, reuseExistingServer: !process.env.CI },
});
