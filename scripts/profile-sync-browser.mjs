/** Offline production-bundled core + real IndexedDB; never opens the app database. */
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import { TextDecoder } from "node:util";
import console from "node:console";
import { spawnSync } from "node:child_process";
import { build } from "vite";
import { chromium, webkit } from "@playwright/test";

const input = process.env.NR_SYNC_DRY_RUN_INPUT;
const engine = process.env.NR_SYNC_PROFILE_BROWSER ?? "chromium";
const scope = process.env.NR_SYNC_PROFILE_SCOPE ?? "core";
const repetitions = Number(process.env.NR_SYNC_PROFILE_REPETITIONS ?? "1");
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
  throw Error("NR_SYNC_PROFILE_REPETITIONS must be an integer from 1 to 10");
if (repetitions > 1 && !["core", "planning"].includes(scope))
  throw Error("Repeated profiling is supported only for core/planning");
if (engine === "both") {
  for (const browser of ["chromium", "webkit"]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, NR_SYNC_PROFILE_BROWSER: browser },
        stdio: "inherit",
      },
    );
    if (result.error || result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}
if (
  !input ||
  !["chromium", "webkit"].includes(engine) ||
  !["core", "planning", "storage", "journal"].includes(scope)
)
  throw Error(
    "Set NR_SYNC_DRY_RUN_INPUT; browser must be chromium or webkit; scope must be core, planning, storage or journal",
  );
const info = await stat(input);
const inputLimit = (scope === "journal" ? 128 : 64) * 1024 * 1024;
if (!info.isFile() || info.size > inputLimit)
  throw Error("Input exceeds budget");
const bytes = await readFile(input);
if (bytes.length > inputLimit) throw Error("Input exceeds budget");
const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
const bundle = await build({
  configFile: false,
  logLevel: "error",
  // Match the app's worker-safe Markdown dependency resolution.
  resolve: {
    alias: {
      "decode-named-character-reference": fileURLToPath(
        new URL(
          "../node_modules/decode-named-character-reference/index.js",
          import.meta.url,
        ),
      ),
    },
  },
  worker: { format: "es" },
  build: {
    write: false,
    minify: true,
    lib: {
      entry: fileURLToPath(
        new URL(
          scope === "journal"
            ? "./sync-journal-probe.js"
            : scope === "storage"
              ? "./sync-storage-probe.js"
              : "./sync-browser-probe.js",
          import.meta.url,
        ),
      ),
      formats: ["iife"],
      name: "SyncProbe",
    },
  },
});
const output =
  Array.isArray(bundle) && bundle.length === 1 ? bundle[0] : bundle;
if (Array.isArray(output) || !output.output)
  throw Error("Unexpected probe build");
const chunks = output.output.filter((entry) => entry.type === "chunk");
if (chunks.length !== 1) throw Error("Probe must be self-contained");
const assets = new Map(
  output.output
    .filter((entry) => entry.type === "asset")
    .map((entry) => ["/" + entry.fileName, entry.source]),
);
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/probe.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(chunks[0].code);
  } else if (assets.has(request.url)) {
    response.setHeader(
      "Content-Type",
      request.url.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "application/octet-stream",
    );
    response.end(assets.get(request.url));
  } else if (request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><meta charset="utf-8"><script src="/probe.js"></script>',
    );
  } else {
    response.writeHead(404);
    response.end();
  }
});
let browser;
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await { chromium, webkit }[engine].launch();
  const context = await browser.newContext();
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  const session =
    engine === "chromium" ? await context.newCDPSession(page) : null;
  const memory = async () =>
    session
      ? {
          jsHeapUsedBytes: (await session.send("Runtime.getHeapUsage"))
            .usedSize,
        }
      : { jsHeapUsedBytes: null };
  await page.exposeFunction("sampleSyncMemory", memory);
  await page.goto(origin);
  await page.waitForFunction(
    () => typeof globalThis.syncBrowserProbe === "function",
  );
  const before = await memory();
  // Reuse this page/context deliberately: separate processes hide retained graphs.
  // Samples are natural-GC observations, never an assertion of total/peak memory.
  const runs = [];
  for (let index = 0; index < repetitions; index++) {
    const result = await page.evaluate(
      async ({ text, scope }) => {
        let last = globalThis.performance.now(),
          maxTimerDelayMs = 0,
          timerTicks = 0;
        const timer = globalThis.setInterval(() => {
          const now = globalThis.performance.now();
          maxTimerDelayMs = Math.max(maxTimerDelayMs, now - last - 16);
          last = now;
          timerTicks++;
        }, 16);
        try {
          const value = await globalThis.syncBrowserProbe(text, scope);
          // Include the final synchronous section even if no timer fired in it.
          maxTimerDelayMs = Math.max(
            maxTimerDelayMs,
            globalThis.performance.now() - last - 16,
          );
          return {
            ...value,
            responsiveness: {
              timerTicks,
              maxTimerDelayMs: Math.round(maxTimerDelayMs),
            },
          };
        } finally {
          globalThis.clearInterval(timer);
        }
      },
      { text: source, scope },
    );
    // Let pending task cleanup run; do not force GC or declare immediate release.
    await page.evaluate(
      () => new Promise((resolve) => globalThis.setTimeout(resolve, 0)),
    );
    runs.push({ ...result, afterOperation: await memory() });
    if (
      runs[0].projectedCount !== result.projectedCount ||
      runs[0].sourceBytes !== result.sourceBytes
    )
      throw Error("Repeated probe changed source/entity counts");
  }
  const result = runs[runs.length - 1];
  let afterReload = null;
  if (scope === "storage" || scope === "journal") {
    await page.reload();
    await page.waitForFunction(
      () => typeof globalThis.syncStorageReload === "function",
    );
    afterReload = await page.evaluate(
      (expected) => globalThis.syncStorageReload(expected),
      result.reloadDigest,
    );
    delete result.reloadDigest;
  }
  await page.goto("about:blank");
  const afterUnload = await memory();
  console.log(
    JSON.stringify(
      {
        browser: engine,
        scope: "bundled-core-and-real-indexeddb",
        scenario: scope,
        before,
        ...result,
        repetitions,
        ...(repetitions > 1 ? { runs } : {}),
        afterReload,
        afterUnload,
      },
      null,
      2,
    ),
  );
  if (scope === "storage" && !result.preserved) process.exitCode = 2;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
