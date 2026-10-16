import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { preparePublicationObjects } from "../../src/lib/sync/publication-objects";
import {
  persistPreparedAttempt,
  readPublicationAttempt,
} from "../../src/lib/sync/publication-store";
import { syncSpaceId } from "../../src/lib/sync/protocol-switch";
import { bytesDigest } from "../../src/lib/sync/remote-protocol";
afterEach(() => vi.unstubAllGlobals());
it("shipped zero capabilities refuse object creation before any Git request", async () => {
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        run: () => Promise<unknown>,
      ) => run(),
    },
  });
  const source = JSON.stringify({ ...fixture, header: gates[1].bundle.header });
  const space = {
    owner: "example",
    repo: "disabled",
    branch: "main",
    path: "backup.json",
  };
  const spaceId = await syncSpaceId(space);
  await persistPreparedAttempt({
    version: 1,
    runtime: "web",
    id: "disabled-1",
    space,
    spaceId,
    expectedParent: "a".repeat(40),
    snapshotId: "example-001",
    snapshotSha256: await bytesDigest(source),
    source,
    control: "",
    localRevision: "b".repeat(64),
    storageGeneration: "headless",
    accepted: [],
    phase: "PREPARED",
    commitSha: null,
    updatedAt: new Date().toISOString(),
  });
  const request = vi.fn(),
    post = vi.fn();
  await expect(
    preparePublicationObjects({ spaceId, request, post }),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect((await readPublicationAttempt(spaceId))?.phase).toBe("PREPARED");
});
it("shipped capabilities also refuse nonempty reviewed publication intents", async () => {
  const { gitReadFixture } = await import("../helpers/git-read-fixture");
  const { backupPaths, inspectRemoteProtocol } =
    await import("../../src/lib/sync/remote-protocol");
  const { prepareEntityReview } =
    await import("../../src/lib/sync/entity-review");
  const { prepareReviewedPublication } =
    await import("../../src/lib/sync/reviewed-publication");
  const paths = backupPaths("backup.json"),
    source = JSON.stringify(fixture);
  const git = await gitReadFixture({
    [paths.latest]: "old-1",
    [paths.snapshot("old-1")]: source,
  });
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "disabled-review",
    path: "backup.json",
  });
  const local = structuredClone(fixture);
  local.notes[0].title = "local edit";
  const localSource = JSON.stringify(local);
  const review = await prepareEntityReview({
    report,
    request: git.request,
    localSource,
    runtime: "web",
  });
  const row = review.rows.find(
    (r) => r.kind === "note" && r.id === fixture.notes[0].id,
  )!;
  await expect(
    prepareReviewedPublication(
      {
        review,
        choices: [
          {
            key: row.key,
            action: "local",
            localHash: row.localHash,
            remoteHash: row.remoteHash,
          },
        ],
        identity: {
          id: "new-1",
          createdAt: "2026-10-16T00:00:00Z",
          writtenBy: { app: "test", platform: "web", deviceId: "test" },
        },
        observation: { state: "none" },
        prerequisites: {
          localRevision: review.localRevision,
          backup: {
            localRevision: review.localRevision,
            sha256: "b".repeat(64),
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
      },
      {
        flush: async () => {},
        readSource: async () => localSource,
        request: git.request,
      },
    ),
  ).rejects.toThrow("尚不支持");
  expect(await readPublicationAttempt(review.spaceId)).toBeNull();
});
it("shipped capabilities refuse selective Pull before importing data", async () => {
  const { gitReadFixture } = await import("../helpers/git-read-fixture");
  const { backupPaths, inspectRemoteProtocol } =
    await import("../../src/lib/sync/remote-protocol");
  const { prepareEntityReview } =
    await import("../../src/lib/sync/entity-review");
  const { applyReviewedPull } =
    await import("../../src/lib/sync/pull-application");
  const paths = backupPaths("pull.json"),
    header = gates[1].bundle.header!,
    source = JSON.stringify({ ...fixture, header });
  const git = await gitReadFixture({
    [paths.latest]: header.id,
    [paths.snapshot(header.id)]: source,
    [paths.control]: JSON.stringify({
      kind: "nine-rings.sync-space",
      version: 1,
      format: 1,
      codec: 1,
      firstSnapshot: { id: header.id, sha256: await bytesDigest(source) },
    }),
  });
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "disabled-pull",
    path: "pull.json",
  });
  const local = structuredClone(fixture);
  local.notes[0].title = "local edit";
  const localSource = JSON.stringify(local),
    review = await prepareEntityReview({
      report,
      request: git.request,
      localSource,
      runtime: "web",
    });
  const row = review.rows.find(
    (r) => r.kind === "note" && r.id === fixture.notes[0].id,
  )!;
  const apply = vi.fn();
  await expect(
    applyReviewedPull(
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
        readSource: async () => localSource,
        apply,
        request: git.request,
      },
    ),
  ).rejects.toThrow("尚不支持");
  expect(apply).not.toHaveBeenCalled();
  const { readPullAttempt } = await import("../../src/lib/sync/pull-store");
  expect(await readPullAttempt(review.spaceId)).toBeNull();
  const { planReviewedPull, recoverReviewedPull } =
    await import("../../src/lib/sync/pull-application");
  const { savePullAttempt } = await import("../../src/lib/sync/pull-store");
  const plan = await planReviewedPull(review, [
    {
      key: row.key,
      action: "remote",
      localHash: row.localHash,
      remoteHash: row.remoteHash,
    },
  ]);
  // Remove the unrelated fixture publication; this is an isolated journal test.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("nine-rings-sync-state-v1");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  await savePullAttempt(
    {
      version: 1,
      id: "older-enabled-client",
      spaceId: review.spaceId,
      review,
      choices: [
        {
          key: row.key,
          action: "remote",
          localHash: row.localHash,
          remoteHash: row.remoteHash,
        },
      ],
      ...plan,
      phase: "APPLYING",
      generationAfter: "headless",
      updatedAt: new Date().toISOString(),
    },
    null,
  );
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _opts: unknown,
        run: () => Promise<unknown>,
      ) => run(),
    },
  });
  await expect(
    recoverReviewedPull(review.spaceId, async () => plan.source),
  ).rejects.toThrow("尚不支持");
  const { confirmEqualReviewedEntities } =
    await import("../../src/lib/sync/pull-application");
  await expect(
    confirmEqualReviewedEntities(
      { review, choices: [] },
      {
        flush: async () => {},
        readSource: async () => localSource,
        request: git.request,
      },
    ),
  ).rejects.toThrow("尚不支持");
});
