import {
  checkStatus,
  githubApiFetch,
  githubContentsUrl,
  loadSyncConfig,
  saveSyncConfig,
  type SyncConfig,
} from "../src/lib/sync/github";

let passed = 0;
function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
  passed++;
}

const config: SyncConfig = {
  token: "test-token",
  owner: "octo-org",
  repo: "notes",
  path: "backups/中文 notes.json",
  lastSyncAt: null,
  remoteSha: null,
  lastPushVersion: null,
  lastPullVersion: null,
  rememberToken: false,
};

assert(
  githubContentsUrl(config.owner, config.repo, config.path) ===
    "https://api.github.com/repos/octo-org/notes/contents/backups/%E4%B8%AD%E6%96%87%20notes.json",
  "Contents API URL encodes each path segment while preserving directories",
);

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const local = memoryStorage();
const session = memoryStorage();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: local, sessionStorage: session },
});
try {
  saveSyncConfig(config);
  assert(!local.getItem("nr:github-sync")?.includes("test-token"),
    "session-only token is removed from persistent config");
  assert(local.getItem("nr:github-sync-token") === null,
    "session-only token is not persisted in localStorage");
  assert(session.getItem("nr:github-sync-token") === "test-token",
    "session-only token is stored in sessionStorage");
  assert(loadSyncConfig().token === "test-token", "session token can be loaded in the same session");

  saveSyncConfig({ ...config, rememberToken: true });
  assert(local.getItem("nr:github-sync-token") === "test-token",
    "remembered token is stored in localStorage after explicit opt-in");
  assert(session.getItem("nr:github-sync-token") === null,
    "remembered token is removed from sessionStorage");
} finally {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
}

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  })) as typeof fetch;
  let timedOut = false;
  try { await githubApiFetch("https://api.github.com", {}, 10); }
  catch (error) { timedOut = (error as Error).message.includes("GitHub 请求超时"); }
  assert(timedOut, "a pending WebView request is aborted and reported as a timeout");

  globalThis.fetch = (async () => new Response(JSON.stringify({
    permissions: { pull: true, push: false, maintain: false, admin: false },
  }), { status: 200 })) as typeof fetch;
  const readOnly = await checkStatus(config);
  assert(!readOnly.ok && readOnly.message.includes("Contents: Read and write"),
    "read-only token is not reported as sync-ready");

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input));
    if (requestedUrls.length === 1) {
      return new Response(JSON.stringify({ permissions: { pull: true, push: true } }), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  const writable = await checkStatus(config);
  assert(writable.ok, "writable token passes the connection check");
  assert(requestedUrls[1]?.endsWith("/contents/backups/%E4%B8%AD%E6%96%87%20notes-latest"),
    "connection check uses the nested backup path");
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`${passed} passed, 0 failed`);
