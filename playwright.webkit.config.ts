import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { webkitGates } from "./scripts/e2e-suites.mjs";
export default defineConfig({
  ...base,
  workers: 1,
  projects: webkitGates.map((group) => ({
    name: group.name,
    testMatch: group.files.map((file) => `**/${file}.spec.ts`),
    grep: group.grep ? new RegExp(group.grep) : undefined,
    use: { browserName: "webkit" as const },
  })),
  use: {
    ...base.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: { ...base.webServer!, reuseExistingServer: !process.env.CI },
});
