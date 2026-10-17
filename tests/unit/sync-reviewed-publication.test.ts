import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import { prepareEntityReview } from "../../src/lib/sync/entity-review";
import { prepareReviewedPublication } from "../../src/lib/sync/reviewed-publication";
import { preparePublicationObjects } from "../../src/lib/sync/publication-objects";
import {
  publishRecordedCommit,
  recoverPublication,
  readValidatedPublication,
} from "../../src/lib/sync/publication-recovery";
import {
  readAcceptedEntities,
  readPublicationAttempt,
  type PublicationAttempt,
} from "../../src/lib/sync/publication-store";
import {
  backupPaths,
  bytesDigest,
  gitBlobSha,
  inspectRemoteProtocol,
} from "../../src/lib/sync/remote-protocol";
import { canonicalJson } from "../../src/lib/sync/canonical-codec";
import { entityKey, type EntityChoice } from "../../src/lib/sync/entity-plan";
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
  for (const name of ["nine-rings-sync-state-v1", "nine-rings-sync-reviews-v1"])
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _opts: unknown,
        fn: () => Promise<unknown>,
      ) => fn(),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
async function setup(enabled = false, future = false) {
  const root = structuredClone(gates[1].bundle.header)!;
  root.id = "previous-1";
  root.requires.readFeatures = root.requires.writeFeatures = [
    "text-document-v1",
    "inline-appearance-v1",
    "template-metadata-v1",
    "encrypted-document-v1",
    "protected-path-v1",
    "protected-history-v1",
  ];
  if (future)
    root.requires.writeFeatures = [
      ...root.requires.writeFeatures,
      "future-feature-v99",
    ];
  const remoteSource = JSON.stringify({
    ...fixture,
    ...(enabled ? { header: root } : {}),
  });
  const paths = backupPaths("backup.json");
  const oldControl = JSON.stringify(
    {
      kind: "nine-rings.sync-space",
      version: 1,
      format: 1,
      codec: 1,
      firstSnapshot: { id: root.id, sha256: await bytesDigest(remoteSource) },
    },
    null,
    2,
  );
  const files: Record<string, string> = {
    [paths.latest]: root.id,
    [paths.snapshot(root.id)]: remoteSource,
    "README.md": "keep me",
    ...(enabled ? { [paths.control]: oldControl } : {}),
  };
  const git = await gitReadFixture(files);
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "backup",
    path: "backup.json",
  });
  const local = structuredClone(fixture);
  local.notes[0].title = "本机新标题";
  local.notes[1].title = "尚未接受的远端选择";
  local.templates[0].name = "应当被忽略";
  const localSource = JSON.stringify(local);
  const review = await prepareEntityReview({
    report,
    request: git.request,
    localSource,
    runtime: "web",
  });
  const choose = (
    kind: string,
    id: string,
    action: EntityChoice["action"],
  ): EntityChoice => {
    const row = review.rows.find((r) => r.kind === kind && r.id === id)!;
    return {
      key: row.key,
      localHash: row.localHash,
      remoteHash: row.remoteHash,
      action,
    };
  };
  const choices = [
    choose("note", local.notes[0].id, "local"),
    choose("note", local.notes[1].id, "remote"),
    choose("template", local.templates[0].id, "ignore"),
  ];
  const input = {
    review,
    choices,
    identity: {
      id: "next-1",
      createdAt: "2026-10-16T00:00:00Z",
      writtenBy: { app: "test", platform: "web", deviceId: "test-device" },
    },
    observation: { state: "none" as const },
    prerequisites: {
      localRevision: review.localRevision,
      backup: {
        localRevision: review.localRevision,
        sha256: "b".repeat(64),
        method: "desktop-verified" as const,
      },
      participants: { confirmed: true, minimumVersion: "1.0.0" },
      payload: {
        eligible: false,
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
  };
  const boundary = {
    flush: vi.fn(async () => {}),
    readSource: vi.fn(async () => localSource),
    request: git.request,
  };
  const blobs = new Map<string, string>();
  const commit = "c".repeat(40),
    tree = "d".repeat(40);
  const post = vi.fn(
    async (route: string, body: Record<string, unknown>): Promise<unknown> => {
      expect((await readPublicationAttempt(review.spaceId))?.phase).toBe(
        "PREPARED",
      );
      if (route === "/git/blobs") {
        const sha = await gitBlobSha(body.content as string);
        blobs.set(sha, body.content as string);
        return { sha };
      }
      if (route === "/git/trees") {
        expect(body.base_tree).toBe(git.tree);
        const next = { ...files };
        for (const e of body.tree as { path: string; sha: string }[])
          next[e.path] = blobs.get(e.sha)!;
        const built = await gitReadFixture(next);
        for (const [route, value] of built.objects)
          if (route.startsWith("/git/blobs/")) git.objects.set(route, value);
        git.objects.set(`/git/trees/${tree}`, {
          ...(built.objects.get(`/git/trees/${built.tree}`) as object),
          sha: tree,
        });
        return { sha: tree };
      }
      expect(route).toBe("/git/commits");
      expect(body.parents).toEqual([git.head]);
      git.objects.set(`/git/commits/${commit}`, {
        sha: commit,
        tree: { sha: tree },
        parents: [{ sha: git.head }],
      });
      return { sha: commit };
    },
  );
  return { input, boundary, git, post, commit, oldControl, paths, files };
}
it.each([false, true])(
  "nonempty publication with enabled=%s confirms only explicitly published local entities",
  async (enabled) => {
    const s = await setup(enabled);
    const attempt = await prepareReviewedPublication(s.input, s.boundary);
    expect(s.boundary.flush).toHaveBeenCalledTimes(1);
    expect(attempt.accepted.map(entityKey)).toEqual([
      JSON.stringify(["note", fixture.notes[0].id]),
    ]);
    expect(attempt.localRevision).toBe(s.input.review.localRevision);
    expect(attempt.reviewed!.candidateRevision).not.toBe(attempt.localRevision);
    const payload = JSON.parse(attempt.source);
    expect(
      payload.notes.find((n: { id: string }) => n.id === fixture.notes[1].id)
        .title,
    ).toBe(fixture.notes[1].title);
    expect(payload.templates[0].name).toBe(fixture.templates[0].name);
    expect(payload.header.parent).toEqual(
      enabled
        ? { id: "previous-1", sha256: s.input.review.snapshotSha256 }
        : null,
    );
    if (enabled) expect(attempt.control).toBe(s.oldControl);
    expect(
      await preparePublicationObjects({
        spaceId: attempt.spaceId,
        request: s.git.request,
        post: s.post,
      }),
    ).toBe(s.commit);
    expect(s.post).toHaveBeenCalledTimes(enabled ? 4 : 5);
    expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
    const patch = vi.fn(async () => {
      s.git.objects.set("/git/ref/heads/backup/main", {
        object: { type: "commit", sha: s.commit },
      });
      throw Error("response lost");
    });
    await expect(
      publishRecordedCommit(attempt.spaceId, s.git.request, patch),
    ).rejects.toThrow("结果不明");
    expect(await recoverPublication(attempt.spaceId, s.git.request)).toBe(
      "complete",
    );
    const accepted = (await readAcceptedEntities(attempt.spaceId)) as {
      entity: { id: string };
    }[];
    expect(accepted.map((r) => r.entity.id)).toEqual([fixture.notes[0].id]);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(await readValidatedPublication(attempt.spaceId)).toMatchObject({
      phase: "COMPLETE",
    });
  },
);
it("a remote-only choice cannot create a needless publication or acceptance receipt", async () => {
  const s = await setup();
  s.input.choices[0].action = "remote";
  await expect(prepareReviewedPublication(s.input, s.boundary)).rejects.toThrow(
    "无需发布",
  );
  expect(await readPublicationAttempt(s.input.review.spaceId)).toBeNull();
  expect(await readAcceptedEntities(s.input.review.spaceId)).toEqual([]);
});
it("an explicit legacy checkpoint preserves remote content without accepting unpublished local changes", async () => {
  const s = await setup();
  s.input.choices[0].action = "remote";
  const attempt = await prepareReviewedPublication(
    { ...s.input, allowMigrationCheckpoint: true },
    s.boundary,
  );
  expect(attempt.reviewed).toMatchObject({
    mode: "legacy-switch",
    checkpoint: true,
  });
  expect(attempt.accepted).toEqual([]);
  const payload = JSON.parse(attempt.source);
  expect(payload.header.parent).toBeNull();
  expect(
    new Map(payload.notes.map((note: { id: string }) => [note.id, note])),
  ).toEqual(new Map(fixture.notes.map((note) => [note.id, note])));
  expect(payload.templates).toEqual(fixture.templates);
  expect(await readValidatedPublication(attempt.spaceId)).toMatchObject({
    phase: "PREPARED",
  });
  expect(s.post).not.toHaveBeenCalled();
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
});
it.each(["opt-in", "backup", "participants", "head", "already-enabled"])(
  "checkpoint cannot bypass %s prerequisites",
  async (failure) => {
    const s = await setup(failure === "already-enabled");
    s.input.choices[0].action = "remote";
    if (failure === "backup")
      s.input.prerequisites.backup.localRevision = "f".repeat(64);
    if (failure === "participants")
      s.input.prerequisites.participants.confirmed = false;
    if (failure === "head")
      s.git.objects.set("/git/ref/heads/backup/main", {
        object: { type: "commit", sha: "e".repeat(40) },
      });
    await expect(
      prepareReviewedPublication(
        { ...s.input, allowMigrationCheckpoint: failure !== "opt-in" },
        s.boundary,
      ),
    ).rejects.toThrow();
    expect(await readPublicationAttempt(s.input.review.spaceId)).toBeNull();
    expect(await readAcceptedEntities(s.input.review.spaceId)).toEqual([]);
    expect(s.post).not.toHaveBeenCalled();
  },
);
it.each(["save", "local", "backup", "head", "identity"])(
  "%s mismatch leaves no durable publication intent",
  async (failure) => {
    const s = await setup();
    if (failure === "save")
      s.boundary.flush.mockRejectedValue(Error("save failed"));
    if (failure === "local")
      s.boundary.readSource.mockResolvedValue(
        s.input.review.localSource.replace("本机新标题", "changed"),
      );
    if (failure === "backup")
      s.input.prerequisites.backup.localRevision = "f".repeat(64);
    if (failure === "head")
      s.git.objects.set("/git/ref/heads/backup/main", {
        object: { type: "commit", sha: "e".repeat(40) },
      });
    if (failure === "identity") s.input.identity.id = "previous-1";
    await expect(
      prepareReviewedPublication(s.input, s.boundary),
    ).rejects.toThrow();
    expect(await readPublicationAttempt(s.input.review.spaceId)).toBeNull();
  },
);
async function overwrite(attempt: PublicationAttempt) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("nine-rings-sync-state-v1");
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction("attempts", "readwrite");
      tx.objectStore("attempts").put(attempt);
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
}
it.each(["accepted", "localRevision", "candidateRevision", "choice", "parent"])(
  "restart rejects altered %s evidence",
  async (field) => {
    const s = await setup();
    const attempt = await prepareReviewedPublication(s.input, s.boundary);
    if (field === "accepted") attempt.accepted = [];
    if (field === "localRevision") attempt.localRevision = "f".repeat(64);
    if (field === "candidateRevision")
      attempt.reviewed!.candidateRevision = "f".repeat(64);
    if (field === "choice") attempt.reviewed!.choices[0].action = "remote";
    if (field === "parent") {
      const source = JSON.parse(attempt.source);
      source.header.parent = { id: "wrong", sha256: "f".repeat(64) };
      attempt.source = canonicalJson(source);
      attempt.snapshotSha256 = await bytesDigest(attempt.source);
    }
    await overwrite(attempt);
    await expect(readValidatedPublication(attempt.spaceId)).rejects.toThrow();
    expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
  },
);
it("append cannot rewrite the existing control file", async () => {
  const s = await setup(true);
  const attempt = await prepareReviewedPublication(s.input, s.boundary);
  attempt.control = attempt.control + "\n";
  await overwrite(attempt);
  await expect(
    preparePublicationObjects({
      spaceId: attempt.spaceId,
      request: s.git.request,
      post: s.post,
    }),
  ).rejects.toThrow("控制文件证据");
  expect(s.post).not.toHaveBeenCalled();
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
});
it("a second local edit during remote inspection invalidates the intent", async () => {
  const s = await setup();
  s.boundary.readSource
    .mockResolvedValueOnce(s.input.review.localSource)
    .mockResolvedValue(
      s.input.review.localSource.replace("本机新标题", "new edit"),
    );
  await expect(prepareReviewedPublication(s.input, s.boundary)).rejects.toThrow(
    "本机内容已变化",
  );
  expect(await readPublicationAttempt(s.input.review.spaceId)).toBeNull();
});
it("ignore preserves an existing receipt while only published entities advance", async () => {
  const s = await setup();
  const { candidateEntities } =
    await import("../../src/lib/sync/entity-projection");
  const { readAcceptedBaselines } =
    await import("../../src/lib/sync/entity-review-store");
  const prior = (
    await candidateEntities(s.input.review.remoteSource, "web")
  ).find((e) => e.kind === "template")!;
  const receipt = {
    key: `${s.input.review.spaceId}:${prior.kind}:${prior.id}`,
    state: "present",
    attemptId: "old-receipt",
    commitSha: "e".repeat(40),
    entity: prior,
  };
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("nine-rings-sync-state-v1");
    req.onsuccess = () => {
      const db = req.result,
        tx = db.transaction("baselines", "readwrite");
      tx.objectStore("baselines").put(receipt);
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
  const report = await inspectRemoteProtocol(
    s.git.request,
    s.input.review.space,
  );
  s.input.review = await prepareEntityReview({
    report,
    request: s.git.request,
    localSource: s.input.review.localSource,
    runtime: "web",
  });
  expect(await readAcceptedBaselines(s.input.review.spaceId)).toHaveLength(1);
  const attempt = await prepareReviewedPublication(s.input, s.boundary);
  await preparePublicationObjects({
    spaceId: attempt.spaceId,
    request: s.git.request,
    post: s.post,
  });
  await publishRecordedCommit(attempt.spaceId, s.git.request, async () => ({
    object: { sha: s.commit },
  }));
  const receipts = (await readAcceptedEntities(attempt.spaceId)) as {
    entity: { id: string };
  }[];
  expect(receipts).toContainEqual(receipt);
  expect(receipts.map((r) => r.entity.id).sort()).toEqual(
    [fixture.notes[0].id, prior.id].sort(),
  );
});

it("unknown remote write requirements cannot be bypassed by re-enveloping plain content", async () => {
  const s = await setup(true, true);
  await expect(prepareReviewedPublication(s.input, s.boundary)).rejects.toThrow(
    "尚不支持",
  );
  expect(await readPublicationAttempt(s.input.review.spaceId)).toBeNull();
});

it("legacy journal projections remain readable but never replace raw bound evidence", async () => {
  const s = await setup(true);
  const attempt = await prepareReviewedPublication(s.input, s.boundary);
  const originalSource = attempt.source;
  Object.assign(attempt.reviewed!.review, {
    outgoing: [{ untrusted: "old derived cache" }],
    equal: [{ untrusted: "old derived cache" }],
    afterPublication: [],
    afterLocalApply: [],
  });
  await overwrite(attempt);
  expect((await readValidatedPublication(attempt.spaceId)).source).toBe(
    originalSource,
  );
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
  const changed = JSON.parse(attempt.reviewed!.review.localSource);
  changed.notes[0].title += " tampered";
  attempt.reviewed!.review.localSource = JSON.stringify(changed);
  await overwrite(attempt);
  await expect(readValidatedPublication(attempt.spaceId)).rejects.toThrow(
    "绑定",
  );
  expect(await readAcceptedEntities(attempt.spaceId)).toEqual([]);
});
