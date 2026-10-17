import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import {
  backupPaths,
  inspectRemoteProtocol,
  gitBlobSha,
} from "../../src/lib/sync/remote-protocol";
import { prepareEntityReview } from "../../src/lib/sync/entity-review";
import {
  readPublicationAttempt,
  readAcceptedEntities,
} from "../../src/lib/sync/publication-store";
import {
  executeIncrementalAction,
  verifyMigrationBackup,
  incrementalTransport,
  resumeIncrementalPublication,
} from "../../src/lib/sync/incremental-actions";
import type { SyncConfig } from "../../src/lib/sync/github";
const host = vi.hoisted(() => ({
  fetch: vi.fn(),
  read: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("../../src/lib/sync/github", () => ({ githubApiFetch: host.fetch }));
vi.mock("../../src/lib/api", () => ({
  api: { export: { data: host.read, import: host.apply } },
}));
// Only this test module supplies hypothetical certified capabilities. Shipped code stays zero.
vi.mock("../../src/lib/sync/protocol-capabilities", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/lib/sync/protocol-capabilities")
    >();
  const features = [
    "text-document-v1",
    "inline-appearance-v1",
    "template-metadata-v1",
    "encrypted-document-v1",
    "protected-path-v1",
    "protected-history-v1",
  ];
  const capabilities = {
    formats: [1],
    codecs: [1],
    read: 1,
    write: 1,
    readFeatures: features,
    writeFeatures: features,
  };
  return {
    ...actual,
    CURRENT_SYNC_CAPABILITIES: capabilities,
    assertSyncCapabilities: (
      bundle: unknown,
      options: Parameters<typeof actual.assertSyncCapabilities>[1],
    ) =>
      actual.assertSyncCapabilities(bundle, {
        ...options,
        capabilities: options.capabilities ?? capabilities,
      }),
  };
});
beforeEach(async () => {
  vi.clearAllMocks();
  for (const name of ["nine-rings-sync-state-v1", "nine-rings-sync-reviews-v1"])
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  const memory = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
    removeItem: (key: string) => memory.delete(key),
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _opts: unknown,
        run: () => Promise<unknown>,
      ) => run(),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
it("a cancelled first publication can be explicitly retried without reopening legacy writes", async () => {
  const s = await setup();
  const original = host.fetch.getMockImplementation()!;
  let hasCommit = false,
    interrupted = false;
  host.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    if (
      init.method === "GET" &&
      url.includes("/git/ref/heads/") &&
      hasCommit &&
      !interrupted &&
      (await readPublicationAttempt(s.review.spaceId))?.phase ===
        "OBJECTS_READY"
    ) {
      interrupted = true;
      throw Error("offline before ref request");
    }
    const response = await original(url, init);
    if (init.method === "POST" && url.endsWith("/git/commits"))
      hasCommit = true;
    return response;
  });
  const backup = await verifyMigrationBackup(s.review, s.source);
  const input = {
    ...s,
    backup,
    action: "publish" as const,
    participants: { confirmed: true, minimumVersion: "1.0.0" },
    migrationConfirmed: true,
  };
  await expect(
    executeIncrementalAction(input, { flush: async () => {} }),
  ).rejects.toThrow();
  const pending = await readPublicationAttempt(s.review.spaceId);
  expect(pending?.phase).toBe("OBJECTS_READY");
  const { cancelUnpublishedPublication } =
    await import("../../src/lib/sync/publication-recovery");
  await cancelUnpublishedPublication(s.review.spaceId, pending!.id);
  await executeIncrementalAction(input, { flush: async () => {} });
  expect((await readPublicationAttempt(s.review.spaceId))?.phase).toBe(
    "COMPLETE",
  );
  expect(s.writes.filter((value) => value.startsWith("PATCH"))).toHaveLength(1);
  const { assertLegacyConnectionAllowed } =
    await import("../../src/lib/sync/protocol-connection");
  await expect(
    assertLegacyConnectionAllowed(s.config, localStorage),
  ).rejects.toThrow("停止旧格式");
});
it("an uncertain first publication cannot be treated as a cancelled migration", async () => {
  const s = await setup();
  const original = host.fetch.getMockImplementation()!;
  host.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const response = await original(url, init);
    if (init.method === "PATCH") throw Error("lost response");
    return response;
  });
  await expect(
    executeIncrementalAction(
      {
        ...s,
        action: "publish",
        backup: await verifyMigrationBackup(s.review, s.source),
        participants: { confirmed: true, minimumVersion: "1.0.0" },
        migrationConfirmed: true,
      },
      { flush: async () => {} },
    ),
  ).rejects.toThrow("结果不明");
  const pending = await readPublicationAttempt(s.review.spaceId);
  expect(pending?.phase).toBe("UNKNOWN");
  const { cancelUnpublishedPublication } =
    await import("../../src/lib/sync/publication-recovery");
  await expect(
    cancelUnpublishedPublication(s.review.spaceId, pending!.id),
  ).rejects.toThrow("只能取消");
});
async function setup(changed = true) {
  const paths = backupPaths("backup.json"),
    remote = JSON.stringify(fixture),
    files: Record<string, string> = {
      [paths.latest]: "previous-1",
      [paths.snapshot("previous-1")]: remote,
      "README.md": "untouched",
    };
  const git = await gitReadFixture(files);
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "backup",
    path: "backup.json",
  });
  const local = structuredClone(fixture);
  if (changed) local.notes[0].title = "local change";
  const source = JSON.stringify(local),
    review = await prepareEntityReview({
      report,
      request: git.request,
      localSource: source,
      runtime: "web",
    });
  host.read.mockResolvedValue(source);
  const row = review.rows.find(
    (r) => r.kind === "note" && r.id === fixture.notes[0].id,
  )!;
  const choices = changed
    ? [
        {
          key: row.key,
          action: "local" as const,
          localHash: row.localHash,
          remoteHash: row.remoteHash,
        },
      ]
    : [];
  const config = {
    owner: "example",
    repo: "backup",
    path: "backup.json",
    token: "TEST_TOKEN",
  } as SyncConfig;
  const blobs = new Map<string, string>(),
    tree = "d".repeat(40),
    commit = "c".repeat(40),
    writes: string[] = [];
  host.fetch.mockImplementation(async (url: string, init: RequestInit) => {
    const path = decodeURIComponent(new URL(url).pathname).replace(
      "/repos/example/backup",
      "",
    );
    if (init.method === "GET")
      return new Response(
        JSON.stringify(git.objects.get(path) ?? { message: "Not Found" }),
        { status: git.objects.has(path) ? 200 : 404 },
      );
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer TEST_TOKEN",
    );
    const body = JSON.parse(init.body as string);
    writes.push(`${init.method} ${path}`);
    if (path === "/git/blobs") {
      const sha = await gitBlobSha(body.content);
      blobs.set(sha, body.content);
      return Response.json({ sha });
    }
    if (path === "/git/trees") {
      const next = { ...files };
      for (const entry of body.tree) next[entry.path] = blobs.get(entry.sha)!;
      const built = await gitReadFixture(next);
      for (const [route, value] of built.objects)
        if (route.startsWith("/git/blobs/")) git.objects.set(route, value);
      git.objects.set(`/git/trees/${tree}`, {
        ...(built.objects.get(`/git/trees/${built.tree}`) as object),
        sha: tree,
      });
      return Response.json({ sha: tree });
    }
    if (path === "/git/commits") {
      git.objects.set(`/git/commits/${commit}`, {
        sha: commit,
        tree: { sha: tree },
        parents: [{ sha: git.head }],
      });
      return Response.json({ sha: commit });
    }
    expect(init.method).toBe("PATCH");
    expect(body).toEqual({ sha: commit, force: false });
    git.objects.set("/git/ref/heads/backup/main", {
      object: { type: "commit", sha: commit },
    });
    return Response.json({ object: { sha: commit } });
  });
  return { review, choices, source, config, git, writes };
}
it("selected file verification binds exact bytes and local entities to this review", async () => {
  const s = await setup(),
    proof = await verifyMigrationBackup(s.review, s.source);
  expect(Object.isFrozen(proof)).toBe(true);
  expect(proof.localRevision).toBe(s.review.localRevision);
  await expect(
    verifyMigrationBackup(s.review, s.source.replace("local change", "other")),
  ).rejects.toThrow("不一致");
  expect(host.fetch).not.toHaveBeenCalled();
});
it("explicit migration uses the host transport, publishes once and confirms only local choices", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source),
    flush = vi.fn(async () => {});
  const result = await executeIncrementalAction(
    {
      ...s,
      action: "publish",
      backup,
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      migrationConfirmed: true,
    },
    { flush },
  );
  expect(result.message).toContain("首次迁移已完成");
  expect(flush).toHaveBeenCalledTimes(1);
  expect(s.writes.filter((v) => v.startsWith("PATCH"))).toHaveLength(1);
  expect(host.apply).not.toHaveBeenCalled();
  expect((await readPublicationAttempt(s.review.spaceId))?.phase).toBe(
    "COMPLETE",
  );
  expect(await readAcceptedEntities(s.review.spaceId)).toHaveLength(1);
});
it("legacy migration without entity changes creates only the explicitly confirmed checkpoint", async () => {
  const s = await setup(false),
    backup = await verifyMigrationBackup(s.review, s.source);
  await executeIncrementalAction(
    {
      ...s,
      action: "publish",
      backup,
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      migrationConfirmed: true,
    },
    { flush: async () => {} },
  );
  const attempt = await readPublicationAttempt(s.review.spaceId);
  expect(attempt?.reviewed?.checkpoint).toBe(true);
  expect(attempt?.phase).toBe("COMPLETE");
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  expect(host.apply).not.toHaveBeenCalled();
});
it.each(["fake-backup", "participants", "confirmation", "connection", "save"])(
  "%s blocks migration before any remote mutation",
  async (reason) => {
    const s = await setup(),
      backup = await verifyMigrationBackup(s.review, s.source);
    const args = {
      ...s,
      action: "publish" as const,
      backup,
      participants: {
        confirmed: reason !== "participants",
        minimumVersion: "1.0.0",
      },
      migrationConfirmed: reason !== "confirmation",
    };
    if (reason === "fake-backup") args.backup = { ...backup };
    if (reason === "connection")
      args.config = { ...args.config, repo: "different" };
    await expect(
      executeIncrementalAction(args, {
        flush: async () => {
          if (reason === "save") throw Error("save failed");
        },
      }),
    ).rejects.toThrow();
    expect(s.writes).toEqual([]);
    expect(await readPublicationAttempt(s.review.spaceId)).toBeNull();
  },
);
it("transport refuses arbitrary mutations and forced updates", async () => {
  const s = await setup(),
    transport = incrementalTransport(s.config, s.review.space);
  expect(() => transport.post("/issues" as "/git/blobs", {})).toThrow(
    "只允许创建",
  );
  expect(() =>
    transport.patch("/git/refs/heads/other", {
      sha: "a".repeat(40),
      force: false,
    }),
  ).toThrow("只允许更新");
  expect(s.writes).toEqual([]);
});
it("UNKNOWN publication cannot be resumed as a new PATCH", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source),
    fetch = host.fetch.getMockImplementation()!;
  host.fetch.mockImplementation(async (...args: Parameters<typeof fetch>) => {
    const response = await fetch(...args);
    if ((args[1] as RequestInit).method === "PATCH")
      throw Error("lost response");
    return response;
  });
  await expect(
    executeIncrementalAction(
      {
        ...s,
        action: "publish",
        backup,
        participants: { confirmed: true, minimumVersion: "1.0.0" },
        migrationConfirmed: true,
      },
      { flush: async () => {} },
    ),
  ).rejects.toThrow("结果不明");
  expect((await readPublicationAttempt(s.review.spaceId))?.phase).toBe(
    "UNKNOWN",
  );
  await expect(
    resumeIncrementalPublication(s.config, s.review.spaceId, async () => {}),
  ).rejects.toThrow("禁止重发");
  expect(s.writes.filter((v) => v.startsWith("PATCH"))).toHaveLength(1);
});
it("host Pull applies through the existing merge API and requests a workspace reload", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source);
  await executeIncrementalAction(
    {
      ...s,
      action: "publish",
      backup,
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      migrationConfirmed: true,
    },
    { flush: async () => {} },
  );
  const local = JSON.parse(s.source);
  local.notes[0].title = "local conflict before Pull";
  local.notes[1].title = "keep another edit";
  let source = JSON.stringify(local);
  host.read.mockImplementation(async () => source);
  host.apply.mockImplementation(
    async (
      next: string,
      mode: string,
      context: { markDataCommitted: () => void },
    ) => {
      expect(mode).toBe("merge");
      expect(typeof context.markDataCommitted).toBe("function");
      source = next;
    },
  );
  const report = await inspectRemoteProtocol(s.git.request, {
    owner: "example",
    repo: "backup",
    path: "backup.json",
  });
  const review = await prepareEntityReview({
    report,
    request: s.git.request,
    localSource: source,
    runtime: "web",
  });
  const row = review.rows.find(
    (r) => r.kind === "note" && r.id === fixture.notes[0].id,
  )!;
  const result = await executeIncrementalAction(
    {
      config: s.config,
      review,
      choices: [
        {
          key: row.key,
          action: "remote",
          localHash: row.localHash,
          remoteHash: row.remoteHash,
        },
      ],
      action: "pull",
    },
    { flush: async () => {} },
  );
  expect(result.reload).toBe(true);
  expect(host.apply).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(source).notes.find(
      (n: { id: string }) => n.id === fixture.notes[1].id,
    ).title,
  ).toBe("keep another edit");
});
it("host equal acceptance does not invoke import or another ref update", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source);
  await executeIncrementalAction(
    {
      ...s,
      action: "publish",
      backup,
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      migrationConfirmed: true,
    },
    { flush: async () => {} },
  );
  const report = await inspectRemoteProtocol(s.git.request, {
    owner: "example",
    repo: "backup",
    path: "backup.json",
  });
  const review = await prepareEntityReview({
    report,
    request: s.git.request,
    localSource: s.source,
    runtime: "web",
  });
  const result = await executeIncrementalAction(
    { config: s.config, review, choices: [], action: "equal" },
    { flush: async () => {} },
  );
  expect(result.reload).toBe(false);
  expect(result.message).toContain("未导入或上传");
  expect(host.apply).not.toHaveBeenCalled();
  expect(s.writes.filter((v) => v.startsWith("PATCH"))).toHaveLength(1);
});
it("an interrupted object preparation can explicitly resume its frozen intent", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source),
    fetch = host.fetch.getMockImplementation()!;
  let interrupted = false;
  host.fetch.mockImplementation(async (...args: Parameters<typeof fetch>) => {
    if (!interrupted && (args[1] as RequestInit).method === "POST") {
      interrupted = true;
      throw Error("object response lost");
    }
    return fetch(...args);
  });
  await expect(
    executeIncrementalAction(
      {
        ...s,
        action: "publish",
        backup,
        participants: { confirmed: true, minimumVersion: "1.0.0" },
        migrationConfirmed: true,
      },
      { flush: async () => {} },
    ),
  ).rejects.toThrow("object response lost");
  expect((await readPublicationAttempt(s.review.spaceId))?.phase).toBe(
    "PREPARED",
  );
  await resumeIncrementalPublication(
    s.config,
    s.review.spaceId,
    async () => {},
  );
  expect((await readPublicationAttempt(s.review.spaceId))?.phase).toBe(
    "COMPLETE",
  );
  expect(s.writes.filter((v) => v.startsWith("PATCH"))).toHaveLength(1);
});
it("first migration with only remote choices creates a checkpoint without importing or accepting them", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source);
  const choices = s.choices.map((choice) => ({
    ...choice,
    action: "remote" as const,
  }));
  await executeIncrementalAction(
    {
      ...s,
      choices,
      action: "publish",
      backup,
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      migrationConfirmed: true,
    },
    { flush: async () => {} },
  );
  expect(
    (await readPublicationAttempt(s.review.spaceId))?.reviewed?.checkpoint,
  ).toBe(true);
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  expect(host.apply).not.toHaveBeenCalled();
  expect(await host.read()).toBe(s.source);
});
it("a follow-up inspection failure does not report an already confirmed publication as failed", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source),
    fetch = host.fetch.getMockImplementation()!;
  let published = false;
  host.fetch.mockImplementation(async (...args: Parameters<typeof fetch>) => {
    const method = (args[1] as RequestInit).method;
    if (published && method === "GET")
      throw Error("post-publication inspection failed");
    const result = await fetch(...args);
    if (method === "PATCH") published = true;
    return result;
  });
  const result = await executeIncrementalAction(
    {
      ...s,
      action: "publish",
      backup,
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      migrationConfirmed: true,
    },
    { flush: async () => {} },
  );
  expect(result.message).toContain("发布与接受已完成");
  expect((await readPublicationAttempt(s.review.spaceId))?.phase).toBe(
    "COMPLETE",
  );
  expect(s.writes.filter((v) => v.startsWith("PATCH"))).toHaveLength(1);
});
it("host recovery confirms actual Pull data without invoking import again", async () => {
  const s = await setup(),
    backup = await verifyMigrationBackup(s.review, s.source);
  await executeIncrementalAction(
    {
      ...s,
      action: "publish",
      backup,
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      migrationConfirmed: true,
    },
    { flush: async () => {} },
  );
  let source = s.source.replace("local change", "local conflict");
  host.read.mockImplementation(async () => source);
  host.apply.mockImplementation(async (next: string) => {
    source = next;
    throw Error("lost after import");
  });
  const report = await inspectRemoteProtocol(s.git.request, {
    owner: "example",
    repo: "backup",
    path: "backup.json",
  });
  const review = await prepareEntityReview({
    report,
    request: s.git.request,
    localSource: source,
    runtime: "web",
  });
  const row = review.rows.find(
    (r) => r.kind === "note" && r.id === fixture.notes[0].id,
  )!;
  await expect(
    executeIncrementalAction(
      {
        config: s.config,
        review,
        choices: [
          {
            key: row.key,
            action: "remote",
            localHash: row.localHash,
            remoteHash: row.remoteHash,
          },
        ],
        action: "pull",
      },
      { flush: async () => {} },
    ),
  ).rejects.toThrow("lost after import");
  const { recoverIncrementalPull } =
    await import("../../src/lib/sync/incremental-actions");
  expect(
    await recoverIncrementalPull(s.config, review.spaceId, async () => {}),
  ).toEqual({ result: "complete", restoreWarning: false });
  expect(host.apply).toHaveBeenCalledTimes(1);
});
