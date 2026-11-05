import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const selected: string[] | undefined = process.env.NR_E2E_TEST_FILES
  ? JSON.parse(process.env.NR_E2E_TEST_FILES)
  : undefined;
if (selected && selected.length === 0)
  throw new Error("E2E selection must not be empty");
export default defineConfig({
  ...base,
  // GitHub's hosted Linux runner provides four cores. The complete suite is
  // dominated by independent 3–10 second browser cases, so use those cores
  // here without changing local, reading, platform or WebKit gate settings.
  workers: 4,
  testMatch: selected?.map((file) => `**/${file}`),
  use: {
    ...base.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: { ...base.webServer!, reuseExistingServer: !process.env.CI },
});
