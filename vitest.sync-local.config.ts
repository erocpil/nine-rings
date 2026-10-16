import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/local/sync-real-backup.test.ts"],
    disableConsoleIntercept: true,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
