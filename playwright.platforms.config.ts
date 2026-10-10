import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// A bounded native-host gate; the default config remains the full suite.
export default defineConfig({
  ...base,
  testMatch: [
    "**/platform-editing.spec.ts",
    "**/document-memory.spec.ts",
    "**/document-open-source.spec.ts",
    "**/document-history.spec.ts",
    "**/create-edit-save.spec.ts",
    "**/exhibition-workspace.spec.ts",
    "**/reader-sidebar-resize.spec.ts",
    "**/encrypted-header.spec.ts",
  ],
  workers: 1,
  use: {
    ...base.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: { ...base.webServer!, reuseExistingServer: !process.env.CI },
});
