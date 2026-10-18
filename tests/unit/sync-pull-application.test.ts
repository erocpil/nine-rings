import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import { mergeBackupPayload } from "../helpers/merge-backup-payload";
import { prepareEntityReview } from "../../src/lib/sync/entity-review";
import {
  planReviewedPull,
  applyReviewedPull,
  recoverReviewedPull,
} from "../../src/lib/sync/pull-application";
import { readPullAttempt } from "../../src/lib/sync/pull-store";
import {
  readAcceptedEntities,
  persistPreparedAttempt,
  type PublicationAttempt,
} from "../../src/lib/sync/publication-store";
import {
  backupPaths,
  bytesDigest,
  inspectRemoteProtocol,
} from "../../src/lib/sync/remote-protocol";
import { DOCUMENT_STORAGE_GENERATION_KEY } from "../../src/lib/document-storage-generation";
import type { EntityChoice } from "../../src/lib/sync/entity-plan";
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
    "app-config-v1",
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
let values: Map<string, string>;
beforeEach(async () => {
  for (const name of ["nine-rings-sync-state-v1", "nine-rings-sync-reviews-v1"])
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  values = new Map();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        run: (lock: object) => Promise<unknown>,
      ) => run({}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const header = structuredClone(gates[1].bundle.header)!;
  header.requires.readFeatures = header.requires.writeFeatures = [
    "text-document-v1",
    "inline-appearance-v1",
    "template-metadata-v1",
    "encrypted-document-v1",
    "protected-path-v1",
    "protected-history-v1",
  ];
  const remoteSource = JSON.stringify({ ...fixture, header }),
    paths = backupPaths("backup.json");
  const git = await gitReadFixture({
    [paths.control]: JSON.stringify({
      kind: "nine-rings.sync-space",
      version: 1,
      format: 1,
      codec: 1,
      firstSnapshot: { id: header.id, sha256: await bytesDigest(remoteSource) },
    }),
    [paths.latest]: header.id,
    [paths.snapshot(header.id)]: remoteSource,
  });
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "pull",
    path: "backup.json",
  });
  const local = structuredClone(fixture);
  local.notes[0].title = "local conflict";
  local.notes[1].title = "keep unselected";
  local.notes.push({
    ...structuredClone(local.notes[0]),
    id: "local-only",
    title: "keep local-only",
  });
  let source = JSON.stringify(local);
  const review = await prepareEntityReview({
    report,
    request: git.request,
    localSource: source,
    runtime: "web",
  });
  const row = review.rows.find(
    (r) => r.kind === "note" && r.id === local.notes[0].id,
  )!;
  const choices: EntityChoice[] = [
    {
      key: row.key,
      localHash: row.localHash,
      remoteHash: row.remoteHash,
      action: "remote",
    },
  ];
  const apply = vi.fn(async (next: string) => {
    source = mergeBackupPayload(source, next);
  });
  const host = {
    flush: vi.fn(async () => {}),
    readSource: vi.fn(async () => source),
    apply,
    request: git.request,
  };
  return {
    review,
    choices,
    host,
    git,
    setSource: (next: string) => {
      source = next;
    },
  };
}
it("preserves unselected/local-only entities and confirms only actually applied remote selections", async () => {
  const s = await setup();
  const plan = await planReviewedPull(s.review, s.choices);
  const payload = JSON.parse(plan.source);
  const writePayload = JSON.parse(plan.writeSource);
  expect(typeof writePayload.exported_at).toBe("string");
  expect(payload.notes).toHaveLength(3);
  expect(
    payload.notes.find((n: { id: string }) => n.id === fixture.notes[1].id)
      .title,
  ).toBe("keep unselected");
  expect(
    payload.notes.find((n: { id: string }) => n.id === "local-only").title,
  ).toBe("keep local-only");
  expect(writePayload.notes).toHaveLength(1);
  expect(writePayload.notes[0].id).toBe(fixture.notes[0].id);
  expect(await applyReviewedPull(s, s.host)).toEqual({ applied: 1 });
  expect(s.host.apply).toHaveBeenCalledTimes(1);
  expect((await readPullAttempt(s.review.spaceId))?.phase).toBe("COMPLETE");
  const receipts = (await readAcceptedEntities(s.review.spaceId)) as {
    entity: { id: string; value: { title: string } };
  }[];
  expect(receipts).toHaveLength(1);
  expect(receipts[0].entity.value.title).toBe(fixture.notes[0].title);
});
it("response loss after actual application recovers by inspection without replay", async () => {
  const s = await setup(),
    plan = await planReviewedPull(s.review, s.choices);
  s.host.apply.mockImplementation(async (next) => {
    s.setSource(mergeBackupPayload(await s.host.readSource(), next));
    throw Error("lost after commit");
  });
  await expect(applyReviewedPull(s, s.host)).rejects.toThrow(
    "lost after commit",
  );
  expect((await readPullAttempt(s.review.spaceId))?.phase).toBe("APPLYING");
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  expect(await recoverReviewedPull(s.review.spaceId, s.host.readSource)).toBe(
    "complete",
  );
  expect(s.host.apply).toHaveBeenCalledTimes(1);
  const actual = JSON.parse(await s.host.readSource());
  expect(actual.notes).toHaveLength(JSON.parse(plan.source).notes.length);
  expect(
    actual.notes.find((note: { id: string }) => note.id === fixture.notes[0].id)
      .title,
  ).toBe(fixture.notes[0].title);
});
it("partial data or later edits are not accepted or rolled back", async () => {
  const s = await setup();
  s.host.apply.mockImplementation(async () => {
    throw Error("failed before mutation");
  });
  await expect(applyReviewedPull(s, s.host)).rejects.toThrow();
  await expect(
    recoverReviewedPull(s.review.spaceId, s.host.readSource),
  ).rejects.toThrow("目标不一致");
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  expect((await readPullAttempt(s.review.spaceId))?.phase).toBe("APPLYING");
  expect(s.host.apply).toHaveBeenCalledTimes(1);
});
it.each(["save", "local", "head", "cancel"])(
  "%s failure does not apply or accept content",
  async (failure) => {
    const s = await setup();
    if (failure === "save")
      s.host.flush.mockRejectedValue(Error("save failed"));
    if (failure === "local")
      s.setSource(s.review.localSource.replace("local conflict", "new edit"));
    if (failure === "head")
      s.git.objects.set("/git/ref/heads/backup/main", {
        object: { sha: "f".repeat(40) },
      });
    await expect(
      applyReviewedPull(s, {
        ...s.host,
        assertActive: () => {
          if (failure === "cancel") throw Error("cancelled");
        },
      }),
    ).rejects.toThrow();
    expect(s.host.apply).not.toHaveBeenCalled();
    expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  },
);
it("workspace replacement after application prevents old acceptance", async () => {
  const s = await setup();
  s.host.apply.mockImplementation(async (next) => {
    s.setSource(mergeBackupPayload(await s.host.readSource(), next));
    values.set(DOCUMENT_STORAGE_GENERATION_KEY, "another-restore");
  });
  await expect(applyReviewedPull(s, s.host)).rejects.toThrow();
  await expect(
    recoverReviewedPull(s.review.spaceId, s.host.readSource),
  ).rejects.toThrow("再次恢复");
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
});
it("an interrupted Pull blocks publication intent creation", async () => {
  const s = await setup();
  s.host.apply.mockRejectedValue(Error("interrupted"));
  await expect(applyReviewedPull(s, s.host)).rejects.toThrow();
  const attempt: PublicationAttempt = {
    version: 1,
    id: "blocked-publication",
    runtime: "web",
    spaceId: s.review.spaceId,
    space: s.review.space,
    expectedParent: s.review.expectedHead,
    snapshotId: "next",
    source: s.review.remoteSource,
    snapshotSha256: s.review.snapshotSha256,
    control: "",
    localRevision: s.review.localRevision,
    storageGeneration: values.get(DOCUMENT_STORAGE_GENERATION_KEY)!,
    accepted: [],
    phase: "PREPARED",
    commitSha: null,
    updatedAt: new Date().toISOString(),
  };
  await expect(persistPreparedAttempt(attempt)).rejects.toThrow("未提交");
});
it("real IndexedDB merge import preserves other documents and verifies applied entities before acceptance", async () => {
  const { importData, exportData } =
    await import("../../src/lib/storage/db-export-import");
  await importData(JSON.stringify(fixture), "replace");
  const remote = JSON.parse(await exportData());
  const header = structuredClone(gates[1].bundle.header)!;
  header.requires.readFeatures = header.requires.writeFeatures = [
    "text-document-v1",
    "inline-appearance-v1",
    "template-metadata-v1",
    "encrypted-document-v1",
    "protected-path-v1",
    "protected-history-v1",
    "app-config-v1",
  ];
  const remoteSource = JSON.stringify({ ...remote, header }),
    paths = backupPaths("real.json");
  const git = await gitReadFixture({
    [paths.latest]: header.id,
    [paths.snapshot(header.id)]: remoteSource,
    [paths.control]: JSON.stringify({
      kind: "nine-rings.sync-space",
      version: 1,
      format: 1,
      codec: 1,
      firstSnapshot: { id: header.id, sha256: await bytesDigest(remoteSource) },
    }),
  });
  const local = structuredClone(remote);
  local.notes.find((n: { id: string }) => n.id === fixture.notes[0].id).title =
    "local edit";
  local.notes.find((n: { id: string }) => n.id === fixture.notes[1].id).title =
    "preserve other edit";
  await importData(JSON.stringify(local), "replace");
  const localSource = await exportData();
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "real-pull",
    path: "real.json",
  });
  const review = await prepareEntityReview({
    report,
    request: git.request,
    localSource,
    runtime: "web",
  });
  const row = review.rows.find(
    (r) => r.kind === "note" && r.id === fixture.notes[0].id,
  )!;
  await applyReviewedPull(
    {
      review,
      choices: [
        {
          key: row.key,
          action: "remote",
          localHash: row.localHash,
          remoteHash: row.remoteHash,
        },
      ],
    },
    {
      flush: async () => {},
      readSource: exportData,
      apply: (source) => importData(source, "merge"),
      request: git.request,
    },
  );
  const restored = JSON.parse(await exportData());
  expect(
    restored.notes.find((n: { id: string }) => n.id === fixture.notes[0].id)
      .title,
  ).toBe(fixture.notes[0].title);
  expect(
    restored.notes.find((n: { id: string }) => n.id === fixture.notes[1].id)
      .title,
  ).toBe("preserve other edit");
  expect((await readPullAttempt(review.spaceId))?.phase).toBe("COMPLETE");
  expect(await readAcceptedEntities(review.spaceId)).toHaveLength(1);
});
it("an unresolved publication blocks Pull before actual mutation", async () => {
  const s = await setup();
  const a: PublicationAttempt = {
    version: 1,
    id: "pending",
    runtime: "web",
    spaceId: s.review.spaceId,
    space: s.review.space,
    expectedParent: s.review.expectedHead,
    snapshotId: "next",
    source: s.review.remoteSource,
    snapshotSha256: s.review.snapshotSha256,
    control: "",
    localRevision: s.review.localRevision,
    storageGeneration: "initial",
    accepted: [],
    phase: "UNKNOWN",
    commitSha: "f".repeat(40),
    updatedAt: new Date().toISOString(),
  };
  await persistPreparedAttempt(a);
  await expect(applyReviewedPull(s, s.host)).rejects.toThrow("记录未提交");
  expect(s.host.apply).not.toHaveBeenCalled();
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
});
it("journal upgrade from version 1 preserves existing publication and acceptance records", async () => {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("nine-rings-sync-state-v1", 1);
    req.onupgradeneeded = () => {
      for (const [name, keyPath] of [
        ["attempts", "spaceId"],
        ["summaries", "spaceId"],
        ["baselines", "key"],
      ])
        req.result.createObjectStore(name, { keyPath });
    };
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction(["summaries", "baselines"], "readwrite");
      tx.objectStore("summaries").put({ spaceId: "old", phase: "COMPLETE" });
      tx.objectStore("baselines").put({
        key: "old:note:one",
        value: "retained",
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    };
    req.onerror = () => reject(req.error);
  });
  const { openSyncJournal } =
    await import("../../src/lib/sync/publication-store");
  const db = await openSyncJournal();
  expect(db.version).toBe(2);
  expect(db.objectStoreNames.contains("pulls")).toBe(true);
  db.close();
  expect(await readAcceptedEntities("old")).toEqual([
    { key: "old:note:one", value: "retained" },
  ]);
});
it("failed acceptance transaction leaves applied data and a recoverable confirming record", async () => {
  const s = await setup();
  const original = s.host.apply;
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  s.host.apply = vi.fn(async (next) => {
    await original(next);
    const transaction = IDBDatabase.prototype.transaction;
    let writes = 0;
    spy = vi
      .spyOn(IDBDatabase.prototype, "transaction")
      .mockImplementation(function (
        this: IDBDatabase,
        ...args: Parameters<typeof transaction>
      ) {
        const tx = transaction.apply(this, args);
        const names =
          typeof args[0] === "string" ? [args[0]] : Array.from(args[0]);
        if (
          args[1] === "readwrite" &&
          names.includes("pulls") &&
          ++writes === 2
        )
          queueMicrotask(() => tx.abort());
        return tx;
      });
  });
  try {
    await expect(applyReviewedPull(s, s.host)).rejects.toThrow("记录未提交");
  } finally {
    spy?.mockRestore();
  }
  expect((await readPullAttempt(s.review.spaceId))?.phase).toBe("CONFIRMING");
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  expect(await recoverReviewedPull(s.review.spaceId, s.host.readSource)).toBe(
    "complete",
  );
  expect(s.host.apply).toHaveBeenCalledTimes(1);
});
it("equal acceptance confirms only identical entities, without applying or publishing", async () => {
  const s = await setup();
  const { confirmEqualReviewedEntities } =
    await import("../../src/lib/sync/pull-application");
  const before = await s.host.readSource();
  const result = await confirmEqualReviewedEntities(s, s.host);
  expect(result.accepted).toBeGreaterThan(0);
  expect(await s.host.readSource()).toBe(before);
  expect(s.host.apply).not.toHaveBeenCalled();
  const receipts = (await readAcceptedEntities(s.review.spaceId)) as {
    entity: { kind: string; id: string };
  }[];
  expect(receipts.every((r) => r.entity.kind !== "note")).toBe(true);
  expect((await readPullAttempt(s.review.spaceId))?.mode).toBe("equal");
  expect((await readPullAttempt(s.review.spaceId))?.phase).toBe("COMPLETE");
  expect(values.get(DOCUMENT_STORAGE_GENERATION_KEY)).toBeUndefined();
});
it("equal evidence expires on another local edit before confirmation", async () => {
  const s = await setup();
  const { confirmEqualReviewedEntities } =
    await import("../../src/lib/sync/pull-application");
  s.host.readSource
    .mockResolvedValueOnce(s.review.localSource)
    .mockResolvedValue(
      s.review.localSource.replace("local conflict", "new change"),
    );
  await expect(confirmEqualReviewedEntities(s, s.host)).rejects.toThrow(
    "本机内容已变化",
  );
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  expect(s.host.apply).not.toHaveBeenCalled();
});
it("interrupted equal confirmation resumes without importing or changing generation", async () => {
  const s = await setup();
  const { confirmEqualReviewedEntities } =
    await import("../../src/lib/sync/pull-application");
  let reads = 0,
    spy: ReturnType<typeof vi.spyOn> | undefined;
  s.host.readSource.mockImplementation(async () => {
    if (++reads === 3) {
      const transaction = IDBDatabase.prototype.transaction;
      let writes = 0;
      spy = vi
        .spyOn(IDBDatabase.prototype, "transaction")
        .mockImplementation(function (
          this: IDBDatabase,
          ...args: Parameters<typeof transaction>
        ) {
          const tx = transaction.apply(this, args),
            names =
              typeof args[0] === "string" ? [args[0]] : Array.from(args[0]);
          if (
            args[1] === "readwrite" &&
            names.includes("pulls") &&
            ++writes === 2
          )
            queueMicrotask(() => tx.abort());
          return tx;
        });
    }
    return s.review.localSource;
  });
  try {
    await expect(confirmEqualReviewedEntities(s, s.host)).rejects.toThrow(
      "记录未提交",
    );
  } finally {
    spy?.mockRestore();
  }
  expect((await readPullAttempt(s.review.spaceId))?.phase).toBe("CONFIRMING");
  expect(await readAcceptedEntities(s.review.spaceId)).toEqual([]);
  expect(await recoverReviewedPull(s.review.spaceId, s.host.readSource)).toBe(
    "complete",
  );
  expect(s.host.apply).not.toHaveBeenCalled();
  expect(values.get(DOCUMENT_STORAGE_GENERATION_KEY)).toBeUndefined();
});
