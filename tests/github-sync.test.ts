import { checkStatus, githubContentsUrl, type SyncConfig } from "../src/lib/sync/github";

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

const originalFetch = globalThis.fetch;
try {
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
