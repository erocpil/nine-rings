/** Selective Pull: preserve local entities unless explicitly accepting remote. */
import { canonicalDigest, canonicalJson } from "./canonical-codec";
import { candidateEntities, frontendEntitySettings } from "./entity-projection";
import { entityKey, type EntityChoice } from "./entity-plan";
import {
  assembleFrozenEntityReview,
  validateEntityReview,
  type EntityReview,
} from "./entity-review";
import {
  reviewCandidatePayload,
  assertCandidateWrite,
} from "./candidate-write-policy";
import { assertSyncCapabilities } from "./protocol-capabilities";
import { parseSyncJson } from "./strict-json";
import {
  backupPaths,
  bytesDigest,
  createPinnedReader,
  record,
  type GitRead,
} from "./remote-protocol";
import {
  withBackupRestore,
  RESTORE_LOCK_NAME,
  type RestoreContext,
} from "../backup-restore-coordination";
import {
  assertDocumentStorageGeneration,
  readDocumentStorageGeneration,
} from "../document-storage-generation";
import {
  readPullAttempt,
  savePullAttempt,
  type PullAttempt,
} from "./pull-store";

const revision = async (source: string, runtime: EntityReview["runtime"]) =>
  canonicalDigest(
    (await candidateEntities(source, runtime)).sort((a, b) =>
      entityKey(a) < entityKey(b) ? -1 : 1,
    ),
  );
export async function planReviewedPull(
  review: EntityReview,
  choices: EntityChoice[],
  expectedGeneration = review.storageGeneration,
  mode: "apply" | "equal" = "apply",
) {
  review = structuredClone(review);
  choices = structuredClone(choices);
  const candidate = await assembleFrozenEntityReview(
    review,
    choices,
    expectedGeneration,
  );
  const local = parseSyncJson(review.localSource) as Record<string, unknown>,
    remote = parseSyncJson(review.remoteSource) as Record<string, unknown>;
  local.version = Math.max(Number(local.version), Number(remote.version));
  delete local.header;
  delete local.backup_metadata;
  delete local.exported_at;
  if (local.user_settings)
    local.user_settings = frontendEntitySettings(local.user_settings);
  const fields = {
    note: "notes",
    template: "templates",
    "protected-path": "protected_paths",
    "protected-version": "protected_versions",
  } as const;
  for (const entity of mode === "equal" ? [] : candidate.afterLocalApply) {
    if (entity.kind === "settings") {
      const key = entity.id === "app-config" ? "config" : "user_settings";
      local[key] =
        key === "user_settings"
          ? frontendEntitySettings(remote[key])
          : remote[key];
    } else {
      const key = fields[entity.kind];
      const source = (remote[key] as { id: string }[]).find(
        (v) => v.id === entity.id,
      );
      if (!source) throw Error("远端应用实体缺失");
      const values = (local[key] ?? []) as { id: string }[];
      local[key] = [...values.filter((v) => v.id !== entity.id), source];
    }
  }
  const source = canonicalJson(local);
  if (new TextEncoder().encode(source).length > 64 * 1024 * 1024)
    throw Error("Pull 目标超过预算");
  // Certify the complete resulting protection graph, preserving all unselected local state.
  const entities = await candidateEntities(source, review.runtime);
  const targetRevision = await revision(source, review.runtime);
  const accepted =
    mode === "equal" ? candidate.equal : candidate.afterLocalApply;
  for (const entity of accepted)
    if (
      !entities.some(
        (v) => entityKey(v) === entityKey(entity) && v.sha256 === entity.sha256,
      )
    )
      throw Error("应用计划改变了远端选择");
  return { source, targetRevision, accepted };
}
async function validate(attempt: PullAttempt) {
  if (
    attempt.version !== 1 ||
    (attempt.mode !== undefined &&
      !["apply", "equal"].includes(attempt.mode)) ||
    attempt.spaceId !== attempt.review.spaceId ||
    ![
      "PREPARED",
      "APPLYING",
      "CONFIRMING",
      "COMPLETE",
      "ABORTED",
      "NEEDS_REVIEW",
    ].includes(attempt.phase)
  )
    throw Error("Pull 记录损坏");
  assertSyncCapabilities(parseSyncJson(attempt.review.remoteSource), {
    operation: "read",
    expectedId: attempt.review.snapshotId,
    requireHeader: true,
  });
  // Recovery may run after the coordinated restore advanced the generation.
  const current = readDocumentStorageGeneration();
  if (
    current !== attempt.review.storageGeneration &&
    current !== attempt.generationAfter
  )
    throw Error("文档库已再次恢复，不能确认旧 Pull");
  const plan = await planReviewedPull(
    attempt.review,
    attempt.choices,
    current,
    attempt.mode ?? "apply",
  );
  if (
    plan.source !== attempt.source ||
    plan.targetRevision !== attempt.targetRevision ||
    canonicalJson(plan.accepted) !== canonicalJson(attempt.accepted)
  )
    throw Error("Pull 冻结证据不匹配");
  return plan;
}
async function verifyRemote(review: EntityReview, request: GitRead) {
  const ref = await request(
    `/git/ref/heads/${review.space.branch.split("/").map(encodeURIComponent).join("/")}`,
  );
  if (
    !record(ref) ||
    !record(ref.object) ||
    ref.object.sha !== review.expectedHead
  )
    throw Error("远端已变化，请重新预检");
  const file = await createPinnedReader(request).file(
    review.expectedHead,
    backupPaths(review.space.path).snapshot(review.snapshotId),
  );
  if (!file || (await bytesDigest(file.content)) !== review.snapshotSha256)
    throw Error("远端应用快照不匹配");
}
export async function applyReviewedPull(
  input: { review: EntityReview; choices: EntityChoice[] },
  host: {
    flush: () => Promise<void>;
    readSource: () => Promise<string>;
    apply: (source: string, context: RestoreContext) => Promise<unknown>;
    request: GitRead;
    assertActive?: () => void;
  },
) {
  input = structuredClone({ review: input.review, choices: input.choices });
  const { review, choices } = input,
    { assertActive = () => {} } = host;
  return withBackupRestore("github", "merge", async (context) => {
    const guard = () => {
      assertActive();
      assertDocumentStorageGeneration(review.storageGeneration);
    };
    guard();
    await host.flush();
    guard();
    await validateEntityReview(review, choices, await host.readSource());
    assertSyncCapabilities(parseSyncJson(review.remoteSource), {
      operation: "read",
      expectedId: review.snapshotId,
      requireHeader: true,
    });
    // Gate target content using the original remote protocol declaration too.
    const plan = await planReviewedPull(review, choices);
    if (!plan.accepted.length) throw Error("没有待应用的远端选择");
    const remote = parseSyncJson(review.remoteSource) as Record<
      string,
      unknown
    >;
    const targetFeatures = reviewCandidatePayload(
      plan.source,
      review.runtime,
    ).requiredFeatures;
    assertCandidateWrite(
      canonicalJson({
        ...(parseSyncJson(plan.source) as object),
        header: {
          ...(remote.header as object),
          requires: {
            read: 1,
            write: 1,
            readFeatures: targetFeatures,
            writeFeatures: targetFeatures,
          },
        },
      }),
      { runtime: review.runtime, expectedId: review.snapshotId },
    );
    await verifyRemote(review, host.request);
    await validateEntityReview(review, choices, await host.readSource());
    guard();
    let attempt: PullAttempt = {
      version: 1,
      id: crypto.randomUUID(),
      spaceId: review.spaceId,
      review,
      choices,
      ...plan,
      phase: "PREPARED",
      generationAfter: null,
      updatedAt: new Date().toISOString(),
    };
    if (
      new TextEncoder().encode(JSON.stringify(attempt)).length >
      128 * 1024 * 1024
    )
      throw Error("Pull 记录超过预算");
    await savePullAttempt(attempt, null, guard);
    try {
      context.setPhase("applying");
      const next = {
        ...attempt,
        phase: "APPLYING" as const,
        generationAfter: readDocumentStorageGeneration(),
      };
      await savePullAttempt(next, attempt, assertActive);
      attempt = next;
      await host.apply(attempt.source, context);
      context.markDataCommitted();
      assertActive();
      await finish(attempt, host.readSource, assertActive);
      return { applied: attempt.accepted.length };
    } catch (error) {
      // Never blindly roll back or replay: actual storage may already contain the target.
      if (attempt.phase === "PREPARED")
        await savePullAttempt({ ...attempt, phase: "ABORTED" }, attempt).catch(
          () => {},
        );
      throw error;
    }
  });
}
async function finish(
  attempt: PullAttempt,
  readSource: () => Promise<string>,
  assertActive: () => void,
) {
  await validate(attempt);
  if (!attempt.generationAfter) throw Error("Pull 缺少应用代次");
  const guard = () => {
    assertActive();
    assertDocumentStorageGeneration(attempt.generationAfter!);
  };
  guard();
  if (
    (await revision(await readSource(), attempt.review.runtime)) !==
    attempt.targetRevision
  )
    throw Error("实际内容与 Pull 目标不一致，请检查，未确认接受");
  guard();
  if (attempt.phase !== "CONFIRMING") {
    const next = { ...attempt, phase: "CONFIRMING" as const };
    await savePullAttempt(next, attempt, guard);
    attempt = next;
  }
  await savePullAttempt({ ...attempt, phase: "COMPLETE" }, attempt, guard);
}
/** Inspect actual local storage only. Never reapplies data or rolls back after restart. */
export async function recoverReviewedPull(
  spaceId: string,
  readSource: () => Promise<string>,
) {
  if (!globalThis.navigator?.locks) throw Error("当前环境不支持恢复锁");
  return navigator.locks.request(
    RESTORE_LOCK_NAME,
    { mode: "exclusive" },
    async () => {
      const attempt = await readPullAttempt(spaceId);
      if (!attempt) throw Error("没有 Pull 记录");
      if (attempt.phase === "COMPLETE") return "complete";
      if (
        !["APPLYING", "CONFIRMING"].includes(attempt.phase) &&
        !(attempt.mode === "equal" && attempt.phase === "PREPARED")
      )
        throw Error("Pull 需要重新检查，未自动应用");
      await finish(attempt, readSource, () => {});
      return "complete";
    },
  );
}

/** Confirm equal, present entities without importing data or publishing a commit. */
export async function confirmEqualReviewedEntities(
  input: { review: EntityReview; choices: EntityChoice[] },
  host: {
    flush: () => Promise<void>;
    readSource: () => Promise<string>;
    request: GitRead;
    assertActive?: () => void;
  },
) {
  input = structuredClone({ review: input.review, choices: input.choices });
  const { review, choices } = input,
    { assertActive = () => {} } = host;
  if (!globalThis.navigator?.locks) throw Error("当前环境不支持接受确认锁");
  return navigator.locks.request(
    RESTORE_LOCK_NAME,
    { mode: "exclusive" },
    async () => {
      const guard = () => {
        assertActive();
        assertDocumentStorageGeneration(review.storageGeneration);
      };
      guard();
      await host.flush();
      guard();
      await validateEntityReview(review, choices, await host.readSource());
      assertSyncCapabilities(parseSyncJson(review.remoteSource), {
        operation: "read",
        expectedId: review.snapshotId,
        requireHeader: true,
      });
      await verifyRemote(review, host.request);
      const plan = await planReviewedPull(
        review,
        choices,
        review.storageGeneration,
        "equal",
      );
      if (!plan.accepted.length) throw Error("没有可确认的相同实体");
      await validateEntityReview(review, choices, await host.readSource());
      guard();
      const attempt: PullAttempt = {
        version: 1,
        mode: "equal",
        id: crypto.randomUUID(),
        spaceId: review.spaceId,
        review,
        choices,
        ...plan,
        phase: "PREPARED",
        generationAfter: review.storageGeneration,
        updatedAt: new Date().toISOString(),
      };
      if (
        new TextEncoder().encode(JSON.stringify(attempt)).length >
        128 * 1024 * 1024
      )
        throw Error("接受记录超过预算");
      await savePullAttempt(attempt, null, guard);
      await finish(attempt, host.readSource, assertActive);
      return { accepted: attempt.accepted.length };
    },
  );
}
