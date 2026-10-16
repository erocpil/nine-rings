import { defineConfig } from "vitest/config";

const heapText = process.env.NR_SYNC_DRY_RUN_HEAP_MB;
const heapMb = heapText === undefined ? undefined : Number(heapText);
if (
  heapMb !== undefined &&
  (!Number.isSafeInteger(heapMb) || heapMb < 256 || heapMb > 4096)
)
  throw Error("NR_SYNC_DRY_RUN_HEAP_MB must be an integer from 256 to 4096");

export default defineConfig({
  test: {
    include: ["tests/local/sync-real-backup.test.ts"],
    disableConsoleIntercept: true,
    maxWorkers: 1,
    fileParallelism: false,
    execArgv: heapMb === undefined ? [] : [`--max-old-space-size=${heapMb}`],
  },
});
