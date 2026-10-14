import { expect, it } from "vitest";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import {
  inspectRemoteProtocol,
  bytesDigest,
} from "../../src/lib/sync/remote-protocol";
import {
  observeRemoteProtocol,
  assertLegacyConnectionAllowed,
} from "../../src/lib/sync/protocol-connection";
const config = { owner: "example", repo: "backup", path: "backup.json" };
const legacy = { version: 1, notes: [] };
async function enabledFixture() {
  const root = structuredClone(gates[1].bundle);
  const id = root.header!.id;
  const source = JSON.stringify(root);
  const control = {
    kind: "nine-rings.sync-space",
    version: 1,
    format: 1,
    codec: 1,
    firstSnapshot: { id, sha256: await bytesDigest(source) },
  };
  return gitReadFixture({
    "backup-latest": id,
    [`backup-${id}.json`]: source,
    "backup-protocol.json": JSON.stringify(control),
  });
}
it("uses one fixed Git tree even when a default branch can move, proving absence without treating HTTP404 as absence", async () => {
  const f = await gitReadFixture({
    "backup-latest": "old",
    "backup-old.json": JSON.stringify(legacy),
  });
  const report = await inspectRemoteProtocol(f.request, config);
  expect(report).toMatchObject({
    support: "legacy",
    history: "complete",
    evidence: { head: f.head, legacyHistory: "verified-never-enabled" },
  });
  expect(f.calls.filter((r) => r.startsWith("/git/ref/"))).toHaveLength(1);
  expect(f.calls.every((r) => !r.includes("/contents/"))).toBe(true);
});
it("does not infer never-enabled history when not all reachable parents fit the budget", async () => {
  const f = await gitReadFixture({}, ["c".repeat(40)]);
  expect(
    (await inspectRemoteProtocol(f.request, config, { historyLimit: 1 }))
      .evidence.legacyHistory,
  ).toBe("unknown");
});
it.each([
  "truncated",
  "symlink",
  "blob-mismatch",
  "missing-snapshot",
  "permission",
])("fails closed for %s without writing anything", async (kind) => {
  const f = await gitReadFixture({
    "backup-latest": "old",
    "backup-old.json": JSON.stringify(legacy),
  });
  const tree = f.objects.get(`/git/trees/${f.tree}`) as {
    truncated: boolean;
    tree: { sha: string; mode: string }[];
  };
  if (kind === "truncated") tree.truncated = true;
  if (kind === "symlink") tree.tree[0].mode = "120000";
  if (kind === "blob-mismatch")
    (
      f.objects.get(`/git/blobs/${tree.tree[0].sha}`) as { content: string }
    ).content = btoa("bad");
  if (kind === "missing-snapshot") tree.tree.pop();
  if (kind === "permission") f.objects.delete(`/git/trees/${f.tree}`);
  await expect(inspectRemoteProtocol(f.request, config)).rejects.toThrow();
});
it("verifies enabled control and raw snapshot digest, persists monotonic facts and blocks legacy sync", async () => {
  const f = await enabledFixture(),
    report = await inspectRemoteProtocol(f.request, config);
  expect(report).toMatchObject({
    support: "unsupported",
    evidence: { snapshot: { parentChain: "verified", header: "present" } },
  });
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  await observeRemoteProtocol(report, storage);
  await expect(assertLegacyConnectionAllowed(config, storage)).rejects.toThrow(
    "停止旧格式",
  );
  const old = await gitReadFixture({});
  await expect(
    observeRemoteProtocol(
      await inspectRemoteProtocol(old.request, config),
      storage,
    ),
  ).rejects.toThrow("不能降级");
  await expect(
    assertLegacyConnectionAllowed({ ...config, path: "other.json" }, storage),
  ).resolves.toBeUndefined();
});
it("does not accept an envelope without its control or a mismatched anchored root", async () => {
  const f = await enabledFixture();
  const tree = f.objects.get(`/git/trees/${f.tree}`) as {
    tree: { path: string }[];
  };
  tree.tree = tree.tree.filter((e) => e.path !== "backup-protocol.json");
  await expect(inspectRemoteProtocol(f.request, config)).rejects.toThrow(
    "invalid-control",
  );
  const root = structuredClone(gates[1].bundle);
  const id = root.header!.id;
  const corrupt = await gitReadFixture({
    "backup-latest": id,
    [`backup-${id}.json`]: JSON.stringify(root),
    "backup-protocol.json": JSON.stringify({
      kind: "nine-rings.sync-space",
      version: 1,
      format: 1,
      codec: 1,
      firstSnapshot: { id, sha256: "0".repeat(64) },
    }),
  });
  await expect(inspectRemoteProtocol(corrupt.request, config)).rejects.toThrow(
    "integrity",
  );
});

it("keeps shipped publication capabilities disabled even after a successful empty-space preflight", async () => {
  const { preparePublication } =
    await import("../../src/lib/sync/publication-recovery");
  const f = await gitReadFixture({});
  const remote = await inspectRemoteProtocol(f.request, config);
  await expect(
    preparePublication({
      remote,
      source: JSON.stringify(gates[1].bundle),
      runtime: "web",
      observation: { state: "none" },
      prerequisites: {
        localRevision: "not-certified",
        backup: null,
        participants: null,
        payload: {
          eligible: true,
          issues: {},
          requiredFeatures: [],
          counts: {
            documents: 0,
            templates: 0,
            protectedPaths: 0,
            protectedVersions: 0,
          },
        },
        publicationRecoveryReady: true,
      },
    }),
  ).rejects.toThrow("尚不支持");
});

it("never copies credentials or accepted baselines into remote space metadata", async () => {
  const f = await gitReadFixture({});
  const connection = {
    ...config,
    token: "PRIVATE_CREDENTIAL",
    remoteSha: "PRIVATE_BASELINE",
  };
  const report = await inspectRemoteProtocol(f.request, connection);
  expect(JSON.stringify(report)).not.toContain("PRIVATE");
  expect(Object.keys(report.space).sort()).toEqual([
    "branch",
    "owner",
    "path",
    "repo",
  ]);
});
it("persists a conservative guard before a detected control's later snapshot read can fail", async () => {
  const f = await enabledFixture();
  const tree = f.objects.get(`/git/trees/${f.tree}`) as {
    tree: { path: string; sha: string }[];
  };
  const pointer = tree.tree.find((e) => e.path === "backup-latest")!;
  f.objects.delete(`/git/blobs/${pointer.sha}`);
  const detected: string[] = [];
  await expect(
    inspectRemoteProtocol(f.request, config, {
      onControlDetected: async (spaceId) => {
        detected.push(spaceId);
      },
    }),
  ).rejects.toThrow();
  expect(detected).toHaveLength(1);
});
