import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { api } from "../../src/lib/api";
import { pushToGitHub, type SyncConfig } from "../../src/lib/sync/github";
import { GitHubWriteHttpError } from "../../src/lib/sync/errors";
vi.mock("../../src/lib/runtime", () => ({ isTauriRuntime: () => true }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("../../src/lib/api", () => ({ api: { export: { data: vi.fn() } } }));
const config: SyncConfig = {
  owner: "test",
  repo: "notes",
  token: "test-secret",
  path: "nested/backup.json",
  lastSyncAt: null,
  remoteSha: null,
  lastPushVersion: null,
  lastPullVersion: null,
  rememberToken: false,
};
const head = "a".repeat(40),
  tree = "b".repeat(40),
  nextTree = "d".repeat(40),
  next = "e".repeat(40);
let source: string;
const currentBlob = () =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(source)}\0`)
    .update(source)
    .digest("hex");
let requests: {
  route: string;
  method: string;
  body: Record<string, unknown>;
}[];
let fail: string | undefined;
let empty: boolean;
let initialized: boolean;
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.clearAllMocks();
  source = JSON.stringify({
    version: "2",
    notes: [],
    text: '中文 `引号"`\n' + "x".repeat(8 * 1024 * 1024),
  });
  vi.mocked(api.export.data).mockResolvedValue(source);
  requests = [];
  fail = undefined;
  empty = false;
  initialized = false;
  vi.mocked(nativeFetch).mockImplementation(async (input, init) => {
    const route = String(input).replace(
      "https://api.github.com/repos/test/notes",
      "",
    );
    const method = init?.method ?? "GET";
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {};
    requests.push({ route, method, body });
    if (route === fail)
      return response(
        { message: "rejected" },
        route.includes("refs/") || route.endsWith("-latest") ? 422 : 400,
      );
    if (route.startsWith("/contents/") && method === "GET")
      return response({}, 404);
    if (route.startsWith("/contents/") && method === "PUT") {
      if (!route.endsWith("-latest")) initialized = true;
      return response({ content: { sha: currentBlob() } }, 201);
    }
    if (route === "")
      return response({ default_branch: "backup/main", size: empty ? 0 : 200 });
    if (route === "/git/ref/heads/backup/main")
      return empty && !initialized
        ? response({}, 409)
        : response({ object: { sha: head } });
    if (route === `/git/commits/${head}`)
      return response({ tree: { sha: tree } });
    if (route === "/git/blobs") return response({ sha: currentBlob() }, 201);
    if (route === "/git/trees") return response({ sha: nextTree }, 201);
    if (route === "/git/commits") return response({ sha: next }, 201);
    if (route === "/git/refs/heads/backup/main")
      return response({ object: { sha: next } });
    throw Error(`Unexpected ${method} ${route}`);
  });
});
afterEach(() => vi.unstubAllGlobals());
it("uploads a 34 MB UTF-8 snapshot unchanged, retains other files and publishes latest only after a non-forced branch update", async () => {
  source = JSON.stringify({
    version: "2",
    notes: [],
    text: "中文\n" + "x".repeat(34_162_110),
  });
  vi.mocked(api.export.data).mockResolvedValue(source);
  const result = await pushToGitHub(config);
  expect(requests.find((r) => r.route === "/git/blobs")?.body).toEqual({
    content: source,
    encoding: "utf-8",
  });
  const treeRequest = requests.find((r) => r.route === "/git/trees")!.body;
  expect(treeRequest.base_tree).toBe(tree);
  expect(treeRequest.tree).toEqual([
    {
      path: expect.stringMatching(/^nested\/backup-\d{8}T\d{9}\.json$/),
      mode: "100644",
      type: "blob",
      sha: currentBlob(),
    },
  ]);
  expect(
    requests.find((r) => r.route === "/git/commits")!.body.parents,
  ).toEqual([head]);
  const advance = requests.findIndex((r) => r.method === "PATCH");
  expect(requests[advance].body).toEqual({ sha: next, force: false });
  const writes = requests.filter((r) => r.method === "PUT");
  expect(writes).toHaveLength(1);
  expect(requests.indexOf(writes[0])).toBeGreaterThan(advance);
  expect(atob(String(writes[0].body.content))).toBe(result.lastPushVersion);
  expect(result.lastSyncAt).not.toBeNull();
});
it.each([
  "/git/blobs",
  "/git/trees",
  "/git/commits",
  "/git/refs/heads/backup/main",
])("never publishes or replays rejected Git writes: %s", async (route) => {
  fail = route;
  await expect(pushToGitHub(config)).rejects.toBeInstanceOf(
    GitHubWriteHttpError,
  );
  expect(requests.filter((r) => r.route === route)).toHaveLength(1);
  expect(requests.some((r) => r.method === "PUT")).toBe(false);
});
it("initializes an empty repository using only an unpublished placeholder; latest follows the complete snapshot", async () => {
  empty = true;
  await pushToGitHub(config);
  const writes = requests.filter((r) => r.method === "PUT");
  expect(writes).toHaveLength(2);
  expect(writes[0].route).toMatch(/\/backup-\d/);
  expect(atob(String(writes[0].body.content))).toBe("{}");
  expect(writes[1].route).toBe("/contents/nested/backup-latest");
  expect(requests.findIndex((r) => r.method === "PATCH")).toBeLessThan(
    requests.indexOf(writes[1]),
  );
});
it("does not publish after cancellation during blob upload", async () => {
  const controller = new AbortController();
  const original = vi.mocked(nativeFetch).getMockImplementation()!;
  vi.mocked(nativeFetch).mockImplementation(async (input, init) => {
    const res = await original(input, init);
    if (String(input).endsWith("/git/blobs")) controller.abort();
    return res;
  });
  await expect(
    pushToGitHub(config, undefined, { signal: controller.signal }),
  ).rejects.toThrow(/取消/);
  expect(
    requests.some((r) => r.route === "/git/trees" || r.method === "PUT"),
  ).toBe(false);
});
it("does not link or publish a snapshot whose remote blob hash differs", async () => {
  const original = vi.mocked(nativeFetch).getMockImplementation()!;
  vi.mocked(nativeFetch).mockImplementation((input, init) =>
    String(input).endsWith("/git/blobs")
      ? Promise.resolve(response({ sha: "f".repeat(40) }, 201))
      : original(input, init),
  );
  await expect(pushToGitHub(config)).rejects.toThrow(/SHA.*不一致/);
  expect(
    requests.some((r) => r.route === "/git/trees" || r.method === "PUT"),
  ).toBe(false);
});
it("retains the existing Contents protocol for small snapshots", async () => {
  vi.mocked(api.export.data).mockResolvedValue('{"notes":[]}');
  await pushToGitHub(config);
  expect(requests.filter((r) => r.method === "PUT")).toHaveLength(2);
  expect(requests.some((r) => r.route.startsWith("/git/"))).toBe(false);
});

it("refuses to overwrite an existing immutable version path", async () => {
  const original = vi.mocked(nativeFetch).getMockImplementation()!;
  vi.mocked(nativeFetch).mockImplementation((input, init) =>
    String(input).includes("/contents/nested/backup-") &&
    !String(input).endsWith("-latest") &&
    !init?.method?.match(/PUT/)
      ? Promise.resolve(response({ sha: "f".repeat(40) }))
      : original(input, init),
  );
  await expect(pushToGitHub(config)).rejects.toThrow(/路径已存在/);
  expect(requests.some((r) => r.method !== "GET")).toBe(false);
});
it("refuses a missing base tree rather than creating a commit that deletes unrelated files", async () => {
  const original = vi.mocked(nativeFetch).getMockImplementation()!;
  vi.mocked(nativeFetch).mockImplementation((input, init) =>
    String(input).endsWith(`/git/commits/${head}`)
      ? Promise.resolve(response({ tree: {} }))
      : original(input, init),
  );
  await expect(pushToGitHub(config)).rejects.toThrow(/无效 SHA/);
  expect(requests.some((r) => r.method !== "GET")).toBe(false);
});
