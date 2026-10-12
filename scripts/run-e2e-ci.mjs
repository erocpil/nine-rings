import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { productionOnlyFiles, selectE2E } from "./e2e-suites.mjs";

const files = readdirSync("e2e").filter((file) => file.endsWith(".spec.ts"));
// Match the default config's production-only exclusions when planning.
const productionOnly = new Set(productionOnlyFiles);
let changed;
try {
  const base = process.env.NR_E2E_CHANGED_BASE;
  if (!base || !/^[a-f\d]{40}$/i.test(base) || /^0+$/.test(base))
    throw Error("Missing base SHA");
  const ancestor = execFileSync("git", ["merge-base", base, "HEAD"], {
    encoding: "utf8",
  }).trim();
  changed = execFileSync(
    "git",
    ["diff", "--name-only", "-z", ancestor, "HEAD"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
} catch {
  // A shallow checkout, initial push or unavailable base must never omit tests.
}
const plan = selectE2E(
  files.filter((file) => !productionOnly.has(file)),
  changed,
  {
    full: process.env.NR_E2E_FULL === "true",
    // The Test workflow runs reading in its own two-browser job. Local/manual
    // invocations include it unless that ownership is explicitly declared.
    excludeReading: process.env.NR_E2E_READING_SEPARATE === "true",
  },
);
console.log(JSON.stringify(plan, null, 2));
if (!process.argv.includes("--plan")) {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/e2e-plan.json",
    JSON.stringify(plan, null, 2) + "\n",
  );
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/@playwright/test/cli.js",
      "test",
      "--config=playwright.ci.config.ts",
      ...args,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, NR_E2E_TEST_FILES: JSON.stringify(plan.files) },
    },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
