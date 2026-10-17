/** Batch only the private records explicitly listed by a rehearsal capture log. */
import { readFileSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { relative, isAbsolute, sep } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import console from "node:console";

const log = process.env.NR_SYNC_JOURNAL_CAPTURE_LOG;
if (!log || statSync(log).size > 1024 * 1024)
  throw Error("Set a capture log no larger than 1 MiB");
const root = fileURLToPath(new URL("../", import.meta.url));
const privateRoot = realpathSync(
  fileURLToPath(new URL("../.local-tools", import.meta.url)),
);
const records = readFileSync(log, "utf8")
  .split("\n")
  .flatMap((line) => {
    try {
      const entry = JSON.parse(line);
      return entry?.stage === "captured-private-journal" ? [entry] : [];
    } catch {
      return [];
    }
  });
if (!records.length || records.length > 4)
  throw Error("Capture log must contain 1 to 4 records");
for (const entry of records) {
  if (
    !["web", "tauri"].includes(entry.runtime) ||
    !["publication", "pull"].includes(entry.kind) ||
    typeof entry.path !== "string"
  )
    throw Error("Invalid capture metadata");
  const path = realpathSync(entry.path);
  const child = relative(privateRoot, path);
  if (
    !child ||
    child === ".." ||
    child.startsWith(".." + sep) ||
    isAbsolute(child)
  )
    throw Error(
      "Captured record must be inside the repository's private .local-tools directory",
    );
  console.log(
    JSON.stringify({
      runtime: entry.runtime,
      kind: entry.kind,
      browsers: "both",
    }),
  );
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./profile-sync-browser.mjs", import.meta.url))],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        NR_SYNC_DRY_RUN_INPUT: path,
        NR_SYNC_PROFILE_SCOPE: "journal",
        NR_SYNC_PROFILE_BROWSER: "both",
      },
    },
  );
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
