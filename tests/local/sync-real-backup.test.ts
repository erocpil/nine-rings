import "fake-indexeddb/auto";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  readFileSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseSyncJson } from "../../src/lib/sync/strict-json";
type BackupFixture =
  typeof import("../../schema/sync/fixtures/candidate-entities-v1.json");
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import {
  planReviewedPull,
  applyReviewedPull,
  recoverReviewedPull,
} from "../../src/lib/sync/pull-application";
import { readPullAttempt } from "../../src/lib/sync/pull-store";
const inputPath = process.env.NR_SYNC_DRY_RUN_INPUT;
const selectedRuntime = process.env.NR_SYNC_DRY_RUN_RUNTIME;
const captureJournals = process.env.NR_SYNC_DRY_RUN_CAPTURE_JOURNALS;
if (captureJournals !== undefined && captureJournals !== "1")
  throw Error("NR_SYNC_DRY_RUN_CAPTURE_JOURNALS must be 1 or omitted");
function captureJournal(
  runtime: string,
  kind: "publication" | "pull",
  record: unknown,
) {
  if (!captureJournals) return;
  const root = join(process.cwd(), ".local-tools");
  mkdirSync(root, { recursive: true });
  const directory = mkdtempSync(join(root, "sync-journal-"));
  const path = join(directory, `${runtime}-${kind}.json`);
  writeFileSync(path, JSON.stringify({ kind, record }), {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({ runtime, stage: "captured-private-journal", kind, path }),
  );
}
const remoteMode = process.env.NR_SYNC_DRY_RUN_REMOTE ?? "enabled";
if (!["enabled", "legacy", "checkpoint", "empty"].includes(remoteMode))
  throw Error(
    "NR_SYNC_DRY_RUN_REMOTE must be enabled, legacy, checkpoint or empty",
  );
if (
  remoteMode === "checkpoint" &&
  process.env.NR_SYNC_DRY_RUN_SCENARIO !== undefined
)
  throw Error(
    "Checkpoint rehearsal cannot be combined with changed-document scenarios",
  );
const scenario = process.env.NR_SYNC_DRY_RUN_SCENARIO ?? "mixed";
if (scenario !== "mixed" && scenario !== "all-documents")
  throw Error("NR_SYNC_DRY_RUN_SCENARIO must be mixed or all-documents");
if (
  selectedRuntime !== undefined &&
  selectedRuntime !== "web" &&
  selectedRuntime !== "tauri"
)
  throw Error("NR_SYNC_DRY_RUN_RUNTIME must be web or tauri");
const runtimes: ("web" | "tauri")[] = selectedRuntime
  ? [selectedRuntime]
  : ["web", "tauri"];
const fixture = inputPath
  ? (() => {
      const stat = statSync(inputPath);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
        throw Error("Input exceeds budget or is not a file");
      const bytes = readFileSync(inputPath);
      if (bytes.length > 64 * 1024 * 1024) throw Error("Input exceeds budget");
      const value = parseSyncJson(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as BackupFixture;
      if (
        !Array.isArray(value.notes) ||
        value.notes.length < 2 ||
        !Array.isArray(value.templates) ||
        !value.templates.length
      )
        throw Error("Rehearsal requires two notes and a template");
      return value;
    })()
  : null;
import gates from "../../schema/sync/fixtures/legacy-gates.json";
import { gitReadFixture } from "../helpers/git-read-fixture";
import { prepareEntityReview } from "../../src/lib/sync/entity-review";
import { prepareReviewedPublication } from "../../src/lib/sync/reviewed-publication";
import { preparePublicationObjects } from "../../src/lib/sync/publication-objects";
import {
  publishRecordedCommit,
  recoverPublication,
  readValidatedPublication,
  preparePublicationFromSavedState,
} from "../../src/lib/sync/publication-recovery";
import { canonicalDigest } from "../../src/lib/sync/canonical-codec";
import { candidateEntities } from "../../src/lib/sync/entity-projection";
import {
  readAcceptedEntities,
  readPublicationAttempt,
} from "../../src/lib/sync/publication-store";
import {
  backupPaths,
  bytesDigest,
  gitBlobSha,
  inspectRemoteProtocol,
} from "../../src/lib/sync/remote-protocol";
import { type EntityChoice } from "../../src/lib/sync/entity-plan";
// Only this test module supplies hypothetical certified capabilities. Shipped code stays zero.
vi.mock("../../src/lib/sync/protocol-capabilities", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/lib/sync/protocol-capabilities")
    >();
  const features = [
    "app-config-v1",
    "automatic-toc-v1",
    "block-image-v1",
    "bundled-image-v1",
    "composed-inline-v1",
    "document-bookmarks-v1",
    "document-links-v1",
    "document-metadata-v1",
    "encrypted-document-v1",
    "flow-block-v1",
    "footnotes-v1",
    "frontend-settings-v1",
    "github-alert-v1",
    "hard-break-v1",
    "horizontal-rule-v1",
    "inert-html-v1",
    "inline-appearance-v1",
    "inline-image-v1",
    "math-v1",
    "mermaid-block-v1",
    "protected-history-v1",
    "protected-path-v1",
    "reference-anchors-v1",
    "restricted-html-v1",
    "structured-block-v1",
    "structured-text-v1",
    "table-block-v1",
    "template-metadata-v1",
    "text-document-v1",
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
  vi.stubGlobal("fetch", () => {
    throw Error("Network forbidden in local rehearsal");
  });
  const values = new Map<string, string>();
  vi.stubGlobal("window", { dispatchEvent: () => {} });
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
        _opts: unknown,
        fn: (lock: object) => Promise<unknown>,
      ) => fn({}),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());
async function setup(runtime: "web" | "tauri") {
  if (!fixture) throw Error("Set NR_SYNC_DRY_RUN_INPUT to a local backup file");
  const root = structuredClone(
    gates[1].bundle.header,
  ) as import("../../src/lib/sync/protocol-capabilities").SyncHeader;
  root.id = "previous-1";
  console.log(JSON.stringify({ runtime, stage: "candidate-start" }));
  root.requires.readFeatures = root.requires.writeFeatures =
    reviewCandidatePayload(JSON.stringify(fixture), runtime).requiredFeatures;
  console.log(JSON.stringify({ runtime, stage: "candidate-certified" }));
  const remoteSource = JSON.stringify({
    ...fixture,
    ...(remoteMode === "enabled" ? { header: root } : {}),
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
    ...(remoteMode === "empty"
      ? {}
      : {
          [paths.latest]: root.id,
          [paths.snapshot(root.id)]: remoteSource,
        }),
    "README.md": "keep me",
    ...(remoteMode === "enabled" ? { [paths.control]: oldControl } : {}),
  };
  const git = await gitReadFixture(files);
  console.log(JSON.stringify({ runtime, stage: "git-fixture-ready" }));
  const report = await inspectRemoteProtocol(git.request, {
    owner: "example",
    repo: "backup",
    path: "backup.json",
  });
  console.log(JSON.stringify({ runtime, stage: "remote-inspected" }));
  const local = structuredClone(fixture);
  if (remoteMode !== "checkpoint") {
    local.notes[0].title = "本机新标题";
    local.notes[1].title = "尚未接受的远端选择";
    local.templates[0].name = "应当被忽略";
    if (scenario === "all-documents") {
      for (const note of local.notes) note.title += " [rehearsal]";
      for (const template of local.templates) template.name += " [rehearsal]";
    }
  }
  const localSource = JSON.stringify(local);
  const review =
    remoteMode === "empty"
      ? null
      : await prepareEntityReview({
          report,
          request: git.request,
          localSource,
          runtime,
        });
  const choose = (
    kind: string,
    id: string,
    action: EntityChoice["action"],
  ): EntityChoice => {
    if (!review) throw Error("Empty namespace has no remote choices");
    const row = review.rows.find((r) => r.kind === kind && r.id === id)!;
    return {
      key: row.key,
      localHash: row.localHash,
      remoteHash: row.remoteHash,
      action,
    };
  };
  const choices: EntityChoice[] =
    !review || remoteMode === "checkpoint"
      ? []
      : scenario === "all-documents"
        ? review.rows
            .filter(
              (row) =>
                row.localHash !== null && row.localHash !== row.remoteHash,
            )
            .map((row) => ({
              key: row.key,
              localHash: row.localHash,
              remoteHash: row.remoteHash,
              action: "local",
            }))
        : [
            choose("note", local.notes[0].id, "local"),
            choose("note", local.notes[1].id, "remote"),
            choose("template", local.templates[0].id, "ignore"),
          ];
  const emptyEntities = review
    ? null
    : await candidateEntities(localSource, runtime);
  const localRevision =
    review?.localRevision ?? (await canonicalDigest(emptyEntities));
  const input = {
    review,
    choices,
    allowMigrationCheckpoint: remoteMode === "checkpoint",
    identity: {
      id: "next-1",
      createdAt: "2026-10-16T00:00:00Z",
      writtenBy: { app: "test", platform: "web", deviceId: "test-device" },
    },
    observation: { state: "none" as const },
    prerequisites: {
      localRevision,
      backup: {
        localRevision,
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
    flush: async () => {},
    readSource: async () => localSource,
    request: git.request,
  };
  const prepare = async () => {
    if (review)
      return prepareReviewedPublication({ ...input, review }, boundary);
    const source = JSON.stringify({
      ...local,
      header: { ...root, ...input.identity, parent: null },
    });
    return preparePublicationFromSavedState(
      {
        remote: report,
        runtime,
        observation: input.observation,
        prerequisites: input.prerequisites,
      },
      { ...boundary, readSource: async () => source },
    );
  };
  const blobs = new Map<string, string>();
  const commit = "c".repeat(40),
    tree = "d".repeat(40);
  const post = async (
    route: string,
    body: Record<string, unknown>,
  ): Promise<unknown> => {
    expect((await readPublicationAttempt(report.spaceId))?.phase).toBe(
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
      for (const [path, original] of Object.entries(files))
        if (path !== paths.latest && path !== paths.control)
          expect(next[path] === original).toBe(true);
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
  };
  return {
    input,
    prepare,
    expectedPublicationAccepted:
      emptyEntities?.length ??
      choices.filter((choice) => choice.action === "local").length,
    git,
    post,
    commit,
    oldControl,
    paths,
    files,
    localSource,
  };
}

// Opt-in only: this file is outside the default unit include. Git and host storage
// are memory simulations. It never imports application adapters or network transport.
it.each(runtimes)(
  "full backup isolated rehearsal: %s",
  async (runtime) => {
    if (!inputPath)
      throw Error("Set NR_SYNC_DRY_RUN_INPUT to a local backup file");
    const started = performance.now();
    const s = await setup(runtime);
    console.log(
      JSON.stringify({
        runtime,
        stage: "review",
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    const attempt = await s.prepare();
    expect(JSON.parse(attempt.source).header.parent).toEqual(
      remoteMode === "enabled"
        ? {
            id: s.input.review!.snapshotId,
            sha256: s.input.review!.snapshotSha256,
          }
        : null,
    );
    expect(attempt.reviewed?.mode).toBe(
      remoteMode === "empty"
        ? undefined
        : remoteMode === "enabled"
          ? "append"
          : "legacy-switch",
    );
    if (remoteMode === "checkpoint")
      expect(attempt.reviewed?.checkpoint).toBe(true);
    const publicationBytes = new TextEncoder().encode(
      JSON.stringify(attempt),
    ).length;
    captureJournal(runtime, "publication", attempt);
    console.log(
      JSON.stringify({
        runtime,
        stage: "prepared",
        publicationBytes,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    expect(publicationBytes < 128 * 1024 * 1024).toBe(true);
    expect((await readValidatedPublication(attempt.spaceId))?.phase).toBe(
      "PREPARED",
    );
    await preparePublicationObjects({
      spaceId: attempt.spaceId,
      request: s.git.request,
      post: s.post,
    });
    expect((await readAcceptedEntities(attempt.spaceId)).length).toBe(0);
    let patchCalls = 0;
    const patch = async () => {
      patchCalls++;
      s.git.objects.set("/git/ref/heads/backup/main", {
        object: { type: "commit", sha: s.commit },
      });
      throw Error("response lost");
    };
    await expect(
      publishRecordedCommit(attempt.spaceId, s.git.request, patch),
    ).rejects.toThrow("结果不明");
    expect(await recoverPublication(attempt.spaceId, s.git.request)).toBe(
      "complete",
    );
    console.log(
      JSON.stringify({
        runtime,
        stage: "publication-recovered",
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    expect(patchCalls).toBe(1);
    expect((await readAcceptedEntities(attempt.spaceId)).length).toBe(
      s.expectedPublicationAccepted,
    );
    const publicationMs = performance.now() - started;
    if (remoteMode === "checkpoint") {
      console.log(
        JSON.stringify({
          runtime,
          remoteMode,
          publicationBytes,
          accepted: 0,
          patchCalls,
          totalMs: Math.round(publicationMs),
          peakRssKiB: process.resourceUsage().maxRSS,
        }),
      );
      return;
    }

    // A fresh local namespace simulates the receiving client; no application DB.
    for (const name of [
      "nine-rings-sync-state-v1",
      "nine-rings-sync-reviews-v1",
    ])
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    let source =
      remoteMode === "empty" || scenario === "all-documents"
        ? JSON.stringify(fixture)
        : s.localSource;
    const report = await inspectRemoteProtocol(s.git.request, {
      owner: "example",
      repo: "backup",
      path: "backup.json",
    });
    const review = await prepareEntityReview({
      report,
      request: s.git.request,
      localSource: source,
      runtime,
    });
    const choices: EntityChoice[] = review.rows
      .filter((row) => row.remoteHash !== null)
      .map((row) => ({
        key: row.key,
        localHash: row.localHash,
        remoteHash: row.remoteHash,
        action: "remote",
      }));
    const plan = await planReviewedPull(review, choices);
    const targetBytes = new TextEncoder().encode(plan.source).length;
    console.log(
      JSON.stringify({
        runtime,
        stage: "pull-planned",
        targetBytes,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    expect(targetBytes < 64 * 1024 * 1024).toBe(true);
    let applyCalls = 0;
    const apply = async (next: string) => {
      applyCalls++;
      source = next;
      throw Error("lost after commit");
    };
    const host = {
      flush: async () => {},
      readSource: async () => source,
      apply,
      request: s.git.request,
    };
    await expect(applyReviewedPull({ review, choices }, host)).rejects.toThrow(
      "lost after commit",
    );
    const pending = await readPullAttempt(review.spaceId);
    expect(pending?.phase).toBe("APPLYING");
    captureJournal(runtime, "pull", pending);
    const pullBytes = new TextEncoder().encode(JSON.stringify(pending)).length;
    console.log(
      JSON.stringify({
        runtime,
        stage: "pull-applied-unconfirmed",
        pullBytes,
        elapsedMs: Math.round(performance.now() - started),
      }),
    );
    expect(pullBytes < 128 * 1024 * 1024).toBe(true);
    expect((await readAcceptedEntities(review.spaceId)).length).toBe(0);
    expect(await recoverReviewedPull(review.spaceId, host.readSource)).toBe(
      "complete",
    );
    expect(applyCalls).toBe(1);
    expect(source === plan.source).toBe(true);
    expect((await readAcceptedEntities(review.spaceId)).length).toBe(
      plan.accepted.length,
    );
    console.log(
      JSON.stringify({
        runtime,
        remoteMode,
        scenario,
        publicationBytes,
        peakRssKiB: process.resourceUsage().maxRSS,
        targetBytes,
        pullBytes,
        accepted: plan.accepted.length,
        publicationMs: Math.round(publicationMs),
        totalMs: Math.round(performance.now() - started),
      }),
    );
  },
  900_000,
);
