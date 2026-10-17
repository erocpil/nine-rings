/** Opt-in real GitHub validation, confined to a new orphan branch and public fixture. */
import process from "node:process";
import console from "node:console";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, webkit } from "@playwright/test";
import { syncFlowServer } from "./sync-flow-build.mjs";

if (
  process.env.NR_SYNC_LIVE !== "1" &&
  !process.argv.includes("--check-bundle")
)
  throw Error(
    "Set NR_SYNC_LIVE=1 to authorize isolated writes in erocpil/nine-rings-backup",
  );
const engine = process.env.NR_SYNC_LIVE_BROWSER ?? "both";
if (engine === "both") {
  for (const browser of ["chromium", "webkit"]) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      {
        stdio: "inherit",
        env: { ...process.env, NR_SYNC_LIVE_BROWSER: browser },
      },
    );
    if (result.error || result.status !== 0) process.exit(result.status ?? 1);
  }
  process.exit(0);
}
if (!["chromium", "webkit"].includes(engine)) throw Error("Unknown browser");
async function ready(page, origin) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  try {
    await page.waitForFunction(() => Boolean(globalThis.syncFlow), undefined, {
      timeout: 15000,
    });
  } catch {
    throw Error(
      `Sync flow bundle initialization failed: ${errors.join("; ") || "script did not load"}`,
    );
  }
}
if (process.argv.includes("--check-bundle")) {
  const server = await syncFlowServer();
  let browser;
  try {
    browser = await { chromium, webkit }[engine].launch();
    const page = await browser.newPage();
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === server.origin
        ? route.continue()
        : route.abort(),
    );
    await ready(page, server.origin);
    console.log(JSON.stringify({ browser: engine, bundleReady: true }));
  } finally {
    await browser?.close();
    await server.close();
  }
  process.exit(0);
}
let token;
try {
  token = execFileSync("gh", ["auth", "token"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
} catch {
  throw Error("GitHub authentication unavailable");
}
if (!token) throw Error("GitHub authentication unavailable");
const root = fileURLToPath(new URL("../.local-tools/", import.meta.url));
await mkdir(root, { recursive: true });
const directory = await mkdtemp(join(root, "sync-live-"));
const branch = `codex/nr-sync-${engine}-${randomUUID()}`;
const repository = "erocpil/nine-rings-backup";
const apiRoot = `https://api.github.com/repos/${repository}`;
const counts = { GET: 0, POST: 0, PATCH: 0 };
async function send(route, method = "GET", body) {
  const response = await globalThis.fetch(apiRoot + route, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: globalThis.AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  return { status: response.status, ok: response.ok, text };
}
async function setupPost(route, body) {
  const result = await send(route, "POST", body);
  if (!result.ok) throw Error(`Isolated branch setup HTTP ${result.status}`);
  return JSON.parse(result.text);
}
const legacySource = await readFile(
  new URL(
    "../schema/sync/fixtures/candidate-entities-v1.json",
    import.meta.url,
  ),
  "utf8",
);
const tree = await setupPost("/git/trees", {
  tree: [
    {
      path: "README.md",
      mode: "100644",
      type: "blob",
      content:
        "Isolated Nine Rings synchronization validation using public test fixtures. Existing branches are unchanged.\n",
    },
    {
      path: "validation-legacy-latest",
      mode: "100644",
      type: "blob",
      content: "legacy-1",
    },
    {
      path: "validation-legacy-legacy-1.json",
      mode: "100644",
      type: "blob",
      content: legacySource,
    },
  ],
});
const commit = await setupPost("/git/commits", {
  tree: tree.sha,
  parents: [],
  message: "test: isolated Nine Rings sync validation root",
});
await setupPost("/git/refs", { ref: `refs/heads/${branch}`, sha: commit.sha });
const server = await syncFlowServer();
const contexts = new Map();
const fault = {
  lostPatch: null,
  offline: null,
  racing: false,
  queued: [],
  firstPublication: null,
  bootstrapSpaceId: null,
};
const config = {
  owner: "erocpil",
  repo: "nine-rings-backup",
  path: "validation-snapshot.json",
  token: "ISOLATED_PROXY_AUTH",
  lastSyncAt: null,
  remoteSha: null,
  lastPushVersion: null,
  lastPullVersion: null,
  rememberToken: false,
};
const id = server.fixture.notes.find((note) => !note.content?.encrypted).id;
const stages = [];
const assert = (condition) => {
  if (!condition) throw Error("Live sync validation invariant failed");
};
async function forward(route, name) {
  const request = route.request(),
    url = new URL(request.url());
  if (request.method() === "OPTIONS")
    return route.fulfill({
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "Authorization,Content-Type,Accept,X-GitHub-Api-Version",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
      },
    });
  assert(
    url.origin === "https://api.github.com" &&
      url.pathname.startsWith(`/repos/${repository}`) &&
      !url.search,
  );
  const path = url.pathname.slice(`/repos/${repository}`.length),
    method = request.method();
  const body = request.postData() ? JSON.parse(request.postData()) : undefined;
  assert(
    method === "GET" ||
      (method === "POST" &&
        ["/git/blobs", "/git/trees", "/git/commits"].includes(path)) ||
      (method === "PATCH" &&
        path === `/git/refs/heads/${branch}` &&
        body?.force === false),
  );
  if (fault.offline === name) return route.abort("internetdisconnected");
  if (
    fault.firstPublication === name &&
    method === "GET" &&
    path.startsWith("/git/ref/heads/") &&
    fault.bootstrapSpaceId
  ) {
    const state = await call(contexts.get(name).page, "inspect", {
      spaceId: fault.bootstrapSpaceId,
    });
    if (state.publication === "OBJECTS_READY") {
      return route.abort("internetdisconnected");
    }
  }
  if (fault.racing && method === "PATCH") {
    await new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(
        () => reject(Error("Concurrent publication barrier timed out")),
        90_000,
      );
      fault.queued.push(() => {
        globalThis.clearTimeout(timer);
        resolve();
      });
      if (fault.queued.length === 2) {
        const ready = fault.queued.splice(0);
        fault.racing = false;
        ready.forEach((release) => release());
      }
    });
  }
  counts[method]++;
  const result = await send(path, method, body);
  if (method === "PATCH" && result.ok && fault.lostPatch === name) {
    fault.lostPatch = null;
    return route.abort("failed");
  }
  let text = result.text;
  // Discovery points only this disposable test context at the new orphan branch.
  // Real default-branch metadata and existing references are never modified.
  if (path === "" && result.ok)
    text = JSON.stringify({ ...JSON.parse(text), default_branch: branch });
  return route.fulfill({
    status: result.status,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" },
    body: text,
  });
}
async function open(name) {
  const profile = join(directory, name);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const context = await { chromium, webkit }[engine].launchPersistentContext(
    profile,
    { headless: true },
  );
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === server.origin) return route.continue();
    if (url.origin === "https://api.github.com") return forward(route, name);
    return route.abort();
  });
  const page = context.pages()[0] ?? (await context.newPage());
  contexts.set(name, { context, page });
  await ready(page, server.origin);
  return page;
}
const call = (page, command, data = {}) =>
  page.evaluate(({ command, data }) => globalThis.syncFlow[command](data), {
    command,
    data,
  });
async function stage(name, action) {
  const start = Date.now();
  await action();
  stages.push({ name, ms: Date.now() - start });
  console.log(JSON.stringify({ browser: engine, stage: name, passed: true }));
}
try {
  let a = await open("a"),
    b = await open("b");
  await call(a, "init", { fixture: server.fixture });
  await call(b, "init", { fixture: server.fixture });
  let spaceId;
  if (!process.argv.includes("--legacy-only")) {
    await stage("bootstrap-real-git", async () => {
      const prepared = await call(a, "prepare", { config, id });
      assert(prepared.bootstrap);
      spaceId = prepared.spaceId;
      fault.bootstrapSpaceId = spaceId;
      fault.firstPublication = "a";
      const before = counts.PATCH;
      assert(
        !(await call(a, "publish").then(
          () => true,
          () => false,
        )),
      );
      assert(
        (await call(a, "inspect", { spaceId })).publication === "OBJECTS_READY",
      );
      assert(counts.PATCH === before);
      fault.firstPublication = null;
      await call(a, "cancel", { spaceId });
      await call(a, "legacyBlocked", { config });
      assert((await call(a, "prepare", { config, id })).bootstrap);
      await call(a, "publish");
      assert(
        (await call(a, "inspect", { spaceId })).publication === "COMPLETE",
      );
      await call(a, "legacyBlocked", { config });
    });
    await stage("real-api-pull-and-equal", async () => {
      await call(b, "edit", { id, title: "receiver draft" });
      await call(b, "pull", { config, id });
      await call(b, "equal", { config });
      assert((await call(b, "inspect", { spaceId })).accepted > 0);
    });
    await stage("conflict-preserves-unselected-settings", async () => {
      await call(a, "edit", { id, title: "publisher second" });
      await call(a, "prepare", { config, id });
      await call(a, "publish");
      await call(b, "edit", { id, title: "receiver conflict" });
      await b.evaluate(() =>
        globalThis.localStorage.setItem("nr:focusMode", "true"),
      );
      assert((await call(b, "pull", { config, id })).conflict);
      assert(
        (await b.evaluate(() =>
          globalThis.localStorage.getItem("nr:focusMode"),
        )) === "true",
      );
      await call(b, "checkDocument", { id, title: "publisher second" });
    });
    await stage("unknown-publication-survives-process-restart", async () => {
      await call(a, "edit", { id, title: "publisher third" });
      await call(a, "prepare", { config, id });
      fault.lostPatch = "a";
      const before = counts.PATCH;
      const outcome = await call(a, "publish").then(
        () => true,
        () => false,
      );
      assert(!outcome);
      assert((await call(a, "inspect", { spaceId })).publication === "UNKNOWN");
      await contexts.get("a").context.close();
      contexts.delete("a");
      a = await open("a");
      assert(
        (await call(a, "recoverPublication", { config, spaceId })) ===
          "complete",
      );
      assert(counts.PATCH === before + 1);
    });
    await stage("pull-confirmation-loss-survives-process-restart", async () => {
      const before = counts.PATCH;
      const result = await call(b, "pull", {
        config,
        id,
        loseConfirmation: true,
      });
      assert((await call(b, "inspect", { spaceId })).pull === "APPLYING");
      await contexts.get("b").context.close();
      contexts.delete("b");
      b = await open("b");
      const recovered = await call(b, "recoverPull", { config, spaceId });
      assert(recovered.result === "complete");
      await call(b, "checkDocument", {
        id,
        title: "publisher third",
        digest: result.documentDigest,
      });
      assert(counts.PATCH === before);
    });
    await stage("offline-does-not-publish", async () => {
      await call(a, "edit", { id, title: "offline draft" });
      await call(a, "prepare", { config, id });
      const before = counts.PATCH;
      fault.offline = "a";
      assert(
        !(await call(a, "publish").then(
          () => true,
          () => false,
        )),
      );
      fault.offline = null;
      assert(counts.PATCH === before);
    });
    await stage("concurrent-writers-never-force-update", async () => {
      await call(a, "edit", { id, title: "concurrent a" });
      await call(b, "edit", { id, title: "concurrent b" });
      await call(a, "prepare", { config, id });
      await call(b, "prepare", { config, id });
      const before = counts.PATCH;
      fault.racing = true;
      const results = await Promise.allSettled([
        call(a, "publish"),
        call(b, "publish"),
      ]);
      assert(
        results.filter((result) => result.status === "fulfilled").length === 1,
      );
      assert(counts.PATCH === before + 2);
      const rejected = results[0].status === "rejected" ? a : b;
      assert(
        (await call(rejected, "inspect", { spaceId })).publication ===
          "REJECTED",
      );
      await call(rejected, "cancel", { spaceId });
      assert(
        (await call(rejected, "inspect", { spaceId })).publication ===
          "ABORTED",
      );
    });
  }
  await stage("legacy-migration-and-second-client-pull", async () => {
    const legacyConfig = { ...config, path: "validation-legacy.json" };
    await call(a, "edit", { id, title: "legacy migration selected local" });
    const prepared = await call(a, "prepare", { config: legacyConfig, id });
    assert(!prepared.bootstrap);
    const before = counts.PATCH;
    await call(a, "publish");
    assert(counts.PATCH === before + 1);
    assert(
      (await call(a, "inspect", { spaceId: prepared.spaceId })).publication ===
        "COMPLETE",
    );
    await call(a, "legacyBlocked", { config: legacyConfig });
    await call(b, "pull", { config: legacyConfig, id });
    await call(b, "checkDocument", {
      id,
      title: "legacy migration selected local",
    });
    await call(b, "equal", { config: legacyConfig });
    assert(counts.PATCH === before + 1);
  });
  await writeFile(
    join(directory, "report.json"),
    JSON.stringify(
      {
        browser: engine,
        repository,
        branch,
        candidateProfile: server.candidateProfile,
        defaultBranchDiscoveryOverridden: true,
        stages,
        requests: counts,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      browser: engine,
      passed: true,
      stages: stages.length,
      requests: counts,
      branch,
    }),
  );
} finally {
  await Promise.all(
    [...contexts.values()].map((item) => item.context.close().catch(() => {})),
  );
  await server.close();
}
