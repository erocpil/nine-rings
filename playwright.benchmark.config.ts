import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Development instrumentation uses source imports. Production measurements
// retain their existing editor/readonly benchmark configurations.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ["editor-opening-benchmark", "editor-rendering-benchmark", "search-performance"].map(name => `**/${name}.spec.ts`),
  workers: 1,
});
