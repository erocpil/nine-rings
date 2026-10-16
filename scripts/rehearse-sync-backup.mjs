/** Local private-data rehearsal. Each runtime gets its own worker and memory high-water mark. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (!process.env.NR_SYNC_DRY_RUN_INPUT) {
  console.error("Set NR_SYNC_DRY_RUN_INPUT to an absolute local backup path.");
  process.exit(1);
}
const selected = process.env.NR_SYNC_DRY_RUN_RUNTIME;
if (selected !== undefined && selected !== "web" && selected !== "tauri") {
  console.error("NR_SYNC_DRY_RUN_RUNTIME must be web or tauri.");
  process.exit(1);
}
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
for (const runtime of selected ? [selected] : ["web", "tauri"]) {
  console.log(`[sync-rehearsal] ${runtime}: separate process`);
  const result = spawnSync(
    process.execPath,
    [cli, "run", "--config", "vitest.sync-local.config.ts"],
    {
      cwd: root,
      env: { ...process.env, NR_SYNC_DRY_RUN_RUNTIME: runtime },
      stdio: "inherit",
    },
  );
  if (result.error || result.status !== 0) {
    console.error(
      `[sync-rehearsal] ${runtime}: failed; remaining runtimes were not run.`,
    );
    process.exit(result.status ?? 1);
  }
}
