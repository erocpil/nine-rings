import "fake-indexeddb/auto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import {
  inspectRemoteProtocol,
  backupPaths,
} from "../../src/lib/sync/remote-protocol";
import { canonicalDigest } from "../../src/lib/sync/canonical-codec";
import { candidateEntities } from "../../src/lib/sync/entity-projection";
import {
  preparePublication,
  recordPublicationObjects,
  publishRecordedCommit,
  recoverPublication,
} from "../../src/lib/sync/publication-recovery";
import {
  readPublicationAttempt,
  readAcceptedEntities,
} from "../../src/lib/sync/publication-store";
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
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("nine-rings-sync-state-v1");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        fn: () => Promise<unknown>,
      ) => fn(),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
async function prepared() {
  const remote = await gitReadFixture({});
  const report = await inspectRemoteProtocol(remote.request, {
    owner: "example",
    repo: "backup",
    path: "backup.json",
  });
  const header = structuredClone(gates[1].bundle.header)!;
  header.requires.readFeatures = header.requires.writeFeatures = [
    "text-document-v1",
    "inline-appearance-v1",
    "template-metadata-v1",
    "encrypted-document-v1",
    "protected-path-v1",
    "protected-history-v1",
  ];
  const source = JSON.stringify({ ...fixture, header });
  const localRevision = await canonicalDigest(
    await candidateEntities(source, "web"),
  );
  const attempt = await preparePublication({
    remote: report,
    source,
    runtime: "web",
    observation: { state: "none" },
    prerequisites: {
      localRevision,
      backup: {
        localRevision,
        sha256: "a".repeat(64),
        method: "desktop-verified",
      },
      participants: { confirmed: true, minimumVersion: "1.0.0" },
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
  });
  const paths = backupPaths(attempt.space.path);
  const objects = await gitReadFixture({
    [paths.latest]: attempt.snapshotId,
    [paths.snapshot(attempt.snapshotId)]: attempt.source,
    [paths.control]: attempt.control,
  });
  const commit = "c".repeat(40),
    tree = "d".repeat(40);
  for (const [route, value] of objects.objects)
    if (route.startsWith("/git/blobs/")) remote.objects.set(route, value);
  remote.objects.set(`/git/trees/${tree}`, {
    ...(objects.objects.get(`/git/trees/${objects.tree}`) as object),
    sha: tree,
  });
  remote.objects.set(`/git/commits/${commit}`, {
    sha: commit,
    tree: { sha: tree },
    parents: [{ sha: remote.head }],
  });
  return { remote, attempt, commit };
}
it("persists PREPARED before any write and refuses a second unresolved plan in the same space", async () => {
  const { remote, attempt } = await prepared();
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "PREPARED",
  );
  expect(await recoverPublication(attempt.spaceId, remote.request)).toBe(
    "not-published",
  );
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
  await expect(prepared()).rejects.toThrow("未提交");
});
it("persists PUBLISHING before PATCH; a lost response is recovered by GET only, keeping frozen receipts", async () => {
  const { remote, attempt, commit } = await prepared();
  await recordPublicationObjects(attempt.spaceId, commit, remote.request);
  let calls = 0;
  await expect(
    publishRecordedCommit(
      attempt.spaceId,
      remote.request,
      async (_route, body) => {
        calls++;
        expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
          "PUBLISHING",
        );
        expect(body).toEqual({ sha: commit, force: false });
        remote.objects.set("/git/ref/heads/backup/main", {
          object: { type: "commit", sha: commit },
        });
        throw Error("response lost");
      },
    ),
  ).rejects.toThrow("结果不明");
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "UNKNOWN",
  );
  await expect(
    publishRecordedCommit(attempt.spaceId, remote.request, async () => {
      calls++;
    }),
  ).rejects.toThrow("阶段");
  expect(calls).toBe(1);
  expect(await recoverPublication(attempt.spaceId, remote.request)).toBe(
    "complete",
  );
  const receipts = (await readAcceptedEntities(attempt.spaceId)) as {
    entity: unknown;
    commitSha: string;
  }[];
  expect(receipts.map((r) => r.entity)).toEqual(attempt.accepted);
  expect(receipts.every((r) => r.commitSha === commit)).toBe(true);
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "COMPLETE",
  );
});
it.each(["denied", "diverged", "behind", "wrong-merge-base"])(
  "keeps unknown publication unresolved after %s evidence",
  async (kind) => {
    const { remote, attempt, commit } = await prepared();
    await recordPublicationObjects(attempt.spaceId, commit, remote.request);
    await expect(
      publishRecordedCommit(attempt.spaceId, remote.request, async () => {
        throw Error("lost");
      }),
    ).rejects.toThrow();
    const head = "e".repeat(40);
    remote.objects.set("/git/ref/heads/backup/main", { object: { sha: head } });
    if (kind !== "denied")
      remote.objects.set(`/compare/${commit}...${head}`, {
        status: kind === "wrong-merge-base" ? "ahead" : kind,
        merge_base_commit: { sha: "f".repeat(40) },
      });
    expect(await recoverPublication(attempt.spaceId, remote.request)).toBe(
      "unknown",
    );
    expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
  },
);
it("accepts an ancestor publication without accepting later remote edits", async () => {
  const { remote, attempt, commit } = await prepared();
  await recordPublicationObjects(attempt.spaceId, commit, remote.request);
  await expect(
    publishRecordedCommit(attempt.spaceId, remote.request, async () => {
      throw Error("lost");
    }),
  ).rejects.toThrow();
  const head = "e".repeat(40);
  remote.objects.set("/git/ref/heads/backup/main", { object: { sha: head } });
  remote.objects.set(`/compare/${commit}...${head}`, {
    status: "ahead",
    merge_base_commit: { sha: commit },
  });
  expect(await recoverPublication(attempt.spaceId, remote.request)).toBe(
    "complete",
  );
  expect(
    (
      (await readAcceptedEntities(attempt.spaceId)) as { commitSha: string }[]
    ).every((row) => row.commitSha === commit),
  ).toBe(true);
});
it("rejects unplanned tree changes before any branch update", async () => {
  const { remote, attempt, commit } = await prepared();
  const extra = await gitReadFixture({ unrelated: "do not change" });
  const planned = remote.objects.get(`/git/trees/${"d".repeat(40)}`) as {
    tree: unknown[];
  };
  planned.tree.push(
    ...(extra.objects.get(`/git/trees/${extra.tree}`) as { tree: unknown[] })
      .tree,
  );
  await expect(
    recordPublicationObjects(attempt.spaceId, commit, remote.request),
  ).rejects.toThrow("计划外");
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "PREPARED",
  );
});
it("allows only one concurrent publisher and records a definite rejection without accepting data", async () => {
  const { remote, attempt, commit } = await prepared();
  await recordPublicationObjects(attempt.spaceId, commit, remote.request);
  let calls = 0;
  const patch = async () => {
    calls++;
    throw Object.assign(Error("rejected"), { status: 409 });
  };
  const results = await Promise.allSettled([
    publishRecordedCommit(attempt.spaceId, remote.request, patch),
    publishRecordedCommit(attempt.spaceId, remote.request, patch),
  ]);
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  expect(calls).toBe(1);
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "REJECTED",
  );
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
});

it("does not send PATCH when the durable PUBLISHING transition aborts", async () => {
  const { remote, attempt, commit } = await prepared();
  await recordPublicationObjects(attempt.spaceId, commit, remote.request);
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const req = original.call(this, value, key);
      if ((value as { phase?: string })?.phase === "PUBLISHING")
        req.addEventListener("success", () => this.transaction.abort());
      return req;
    });
  const patch = vi.fn();
  try {
    await expect(
      publishRecordedCommit(attempt.spaceId, remote.request, patch),
    ).rejects.toThrow("未提交");
  } finally {
    spy.mockRestore();
  }
  expect(patch).not.toHaveBeenCalled();
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "OBJECTS_READY",
  );
});
it("rolls back acceptance and COMPLETE together after a local confirmation failure, then recovers without a second PATCH", async () => {
  const { remote, attempt, commit } = await prepared();
  await recordPublicationObjects(attempt.spaceId, commit, remote.request);
  const original = IDBObjectStore.prototype.put;
  const spy = vi
    .spyOn(IDBObjectStore.prototype, "put")
    .mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const req = original.call(this, value, key);
      if ((value as { phase?: string })?.phase === "COMPLETE")
        req.addEventListener("success", () => this.transaction.abort());
      return req;
    });
  const patch = vi.fn(async () => {
    remote.objects.set("/git/ref/heads/backup/main", {
      object: { sha: commit },
    });
    return { object: { sha: commit } };
  });
  try {
    await expect(
      publishRecordedCommit(attempt.spaceId, remote.request, patch),
    ).rejects.toThrow("未提交");
  } finally {
    spy.mockRestore();
  }
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "CONFIRMING",
  );
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
  expect(await recoverPublication(attempt.spaceId, remote.request)).toBe(
    "complete",
  );
  expect(patch).toHaveBeenCalledTimes(1);
});
it("does not accept old frozen baselines after a workspace restore", async () => {
  const data = new Map<string, string>();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
  });
  const { remote, attempt, commit } = await prepared();
  await recordPublicationObjects(attempt.spaceId, commit, remote.request);
  await expect(
    publishRecordedCommit(attempt.spaceId, remote.request, async () => {
      remote.objects.set("/git/ref/heads/backup/main", {
        object: { sha: commit },
      });
      data.set("nr:document-storage-generation:v1", "restored");
      return { object: { sha: commit } };
    }),
  ).rejects.toThrow("文档库已被恢复");
  expect((await readPublicationAttempt(attempt.spaceId))?.phase).toBe(
    "CONFIRMING",
  );
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
  await expect(
    recoverPublication(attempt.spaceId, remote.request),
  ).rejects.toThrow("文档库已被恢复");
});
