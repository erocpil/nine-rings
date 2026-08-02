import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/lib/runtime.ts", "src/lib/local-date.ts"],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 },
    },
  },
});
