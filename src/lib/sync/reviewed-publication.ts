import { assertCandidateWriteAsync } from "./candidate-async-policy";
import { snapshotEntityReview } from "./review-snapshot";
import {
  withCandidateEvaluation,
  type CandidateEvaluationScope,
} from "./candidate-write-policy";
/** Frozen nonempty-remote publication intents. No remote writes or local application. */
import { canonicalDigest, canonicalJson } from "./canonical-codec";
import { candidateEntities } from "./entity-projection";
import type { EntityReview } from "./entity-review";
import type { EntityChoice } from "./entity-plan";
import {
  backupPaths,
  bytesDigest,
  createPinnedReader,
  inspectRemoteProtocol,
  type GitRead,
} from "./remote-protocol";
import {
  reviewProtocolSwitch,
  type ObservationStatus,
  type SwitchPrerequisites,
} from "./protocol-switch";
import {
  persistPreparedAttempt,
  type PublicationAttempt,
} from "./publication-store";
import { assertDocumentStorageGeneration } from "../document-storage-generation";
import { parseSyncJson } from "./strict-json";
import {
  assertSyncCapabilities,
  type SyncHeader,
} from "./protocol-capabilities";

export interface ReviewedPublicationEvidence {
  review: EntityReview;
  choices: EntityChoice[];
  mode: "legacy-switch" | "append";
  checkpoint?: true;
  candidateRevision: string;
  planSha256: string;
}
function control(id: string, sha256: string) {
  return canonicalJson({
    kind: "nine-rings.sync-space",
    version: 1,
    format: 1,
    codec: 1,
    firstSnapshot: { id, sha256 },
  });
}
/** Reassemble evidence after restart. Never treats remote/ignored/equal rows as published receipts. */
export async function validateReviewedPublicationRecord(
  attempt: PublicationAttempt,
  evaluation?: CandidateEvaluationScope,
) {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    const { assembleFrozenEntityReview } = await import("./entity-review");
    const proof = attempt.reviewed;
    if (!proof || !["legacy-switch", "append"].includes(proof.mode))
      throw Error("发布选择证据无效");
    const review = proof.review;
    const remoteFormat = assertSyncCapabilities(
      parseSyncJson(review.remoteSource),
      {
        operation: "write",
        expectedId: review.snapshotId,
        requireHeader: proof.mode === "append",
      },
    );
    if (proof.mode === "legacy-switch" && remoteFormat !== "legacy")
      throw Error("不能将已启用空间降级为首次切换");
    const candidate = await assembleFrozenEntityReview(
      review,
      proof.choices,
      undefined,
      evaluation,
    );
    const header = (parseSyncJson(attempt.source) as { header: SyncHeader })
      .header;
    const parent =
      proof.mode === "append"
        ? { id: review.snapshotId, sha256: review.snapshotSha256 }
        : null;
    const payload = parseSyncJson(attempt.source) as Record<string, unknown>;
    delete payload.header;
    if (
      (!candidate.publicationNeeded &&
        !(proof.checkpoint === true && proof.mode === "legacy-switch")) ||
      (proof.checkpoint !== undefined &&
        (proof.checkpoint !== true || proof.mode !== "legacy-switch")) ||
      attempt.spaceId !== review.spaceId ||
      canonicalJson(attempt.space) !== canonicalJson(review.space) ||
      attempt.runtime !== review.runtime ||
      attempt.expectedParent !== review.expectedHead ||
      attempt.storageGeneration !== review.storageGeneration ||
      attempt.localRevision !== review.localRevision ||
      proof.planSha256 !== candidate.planSha256 ||
      canonicalJson(header.parent) !== canonicalJson(parent) ||
      canonicalJson(payload) !== candidate.source ||
      canonicalJson(attempt.accepted) !==
        canonicalJson(candidate.afterPublication) ||
      proof.candidateRevision !==
        (await canonicalDigest(
          await candidateEntities(attempt.source, attempt.runtime, evaluation),
        ))
    )
      throw Error("发布选择证据与冻结候选不匹配");
    if (
      proof.mode === "legacy-switch" &&
      attempt.control !== control(attempt.snapshotId, attempt.snapshotSha256)
    )
      throw Error("首次切换控制文件不匹配");
  });
}
export async function prepareReviewedPublication(
  input: {
    review: EntityReview;
    choices: EntityChoice[];
    prerequisites: SwitchPrerequisites;
    observation: ObservationStatus;
    identity: Pick<SyncHeader, "id" | "createdAt" | "writtenBy">;
    allowMigrationCheckpoint?: boolean;
  },
  boundary: {
    flush: () => Promise<void>;
    readSource: () => Promise<string>;
    request: GitRead;
    assertActive?: () => void;
  },
  evaluation?: CandidateEvaluationScope,
): Promise<PublicationAttempt> {
  return withCandidateEvaluation(evaluation, async (evaluation) => {
    const { review: reviewed, ...metadata } = input;
    input = {
      ...structuredClone(metadata),
      review: snapshotEntityReview(reviewed),
    };
    const { validateEntityReview } = await import("./entity-review");
    const { flush, readSource, request, assertActive = () => {} } = boundary;
    const { review } = input;
    const guard = () => {
      assertActive();
      assertDocumentStorageGeneration(review.storageGeneration);
    };
    guard();
    await flush();
    guard();
    const source = await readSource();
    guard();
    const candidate = await validateEntityReview(
      review,
      input.choices,
      source,
      evaluation,
    );
    if (!candidate.publicationNeeded && !input.allowMigrationCheckpoint)
      throw Error("候选与远端相同，无需发布；接受确认需独立处理");
    if (review.runtime === "flutter") throw Error("Dart 运行认证尚未完成");
    const fresh = await inspectRemoteProtocol(request, review.space);
    if (
      fresh.history !== "complete" ||
      fresh.spaceId !== review.spaceId ||
      fresh.evidence.head !== review.expectedHead
    )
      throw Error("远端或协议历史已变化，请重新预检");
    const reader = createPinnedReader(request),
      paths = backupPaths(review.space.path);
    const old = await reader.file(
      review.expectedHead,
      paths.snapshot(review.snapshotId),
    );
    if (!old || (await bytesDigest(old.content)) !== review.snapshotSha256)
      throw Error("远端快照证据不匹配");
    const mode =
      fresh.evidence.control.state === "enabled" ? "append" : "legacy-switch";
    if (!candidate.publicationNeeded && mode === "append")
      throw Error("候选与远端相同，无需发布；接受确认需独立处理");
    const parent =
      mode === "append"
        ? { id: review.snapshotId, sha256: review.snapshotSha256 }
        : null;
    const header: SyncHeader = {
      kind: "nine-rings.sync-snapshot",
      format: 1,
      codec: 1,
      ...input.identity,
      parent,
      requires: {
        read: 1,
        write: 1,
        readFeatures: candidate.review.requiredFeatures,
        writeFeatures: candidate.review.requiredFeatures,
      },
    };
    const frozenSource = canonicalJson({
      ...(parseSyncJson(candidate.source) as Record<string, unknown>),
      header,
    });
    // Production capability gate is checked before intent persistence or object writes.
    const payload = await assertCandidateWriteAsync(
      frozenSource,
      {
        runtime: review.runtime,
        expectedId: header.id,
      },
      evaluation,
    );
    const decision = reviewProtocolSwitch(
      review.spaceId,
      fresh.evidence,
      input.observation,
      { ...input.prerequisites, payload },
    );
    const reasons = decision.reasons.filter(
      (reason) => !(mode === "append" && reason === "join-required"),
    );
    if (
      reasons.length ||
      input.prerequisites.localRevision !== review.localRevision
    )
      throw Error("发布确认或备份修订条件未满足");
    const snapshotSha256 = await bytesDigest(frozenSource);
    const priorControl = await reader.file(review.expectedHead, paths.control);
    if (mode === "append" && !priorControl) throw Error("远端控制文件缺失");
    if (await reader.file(review.expectedHead, paths.snapshot(header.id)))
      throw Error("快照身份已存在，不能覆盖");
    const attempt: PublicationAttempt = {
      version: 1,
      runtime: review.runtime,
      id: crypto.randomUUID(),
      spaceId: review.spaceId,
      space: review.space,
      expectedParent: review.expectedHead,
      snapshotId: header.id,
      snapshotSha256,
      source: frozenSource,
      control:
        mode === "append"
          ? priorControl!.content
          : control(header.id, snapshotSha256),
      localRevision: review.localRevision,
      storageGeneration: review.storageGeneration,
      accepted: candidate.afterPublication,
      phase: "PREPARED",
      commitSha: null,
      updatedAt: new Date().toISOString(),
      reviewed: {
        review,
        choices: input.choices,
        mode,
        ...(!candidate.publicationNeeded ? { checkpoint: true as const } : {}),
        candidateRevision: await canonicalDigest(
          await candidateEntities(frozenSource, review.runtime, evaluation),
        ),
        planSha256: candidate.planSha256,
      },
    };
    if (
      new TextEncoder().encode(JSON.stringify(attempt)).length >
      128 * 1024 * 1024
    )
      throw Error("发布计划超过本机预算");
    await validateReviewedPublicationRecord(attempt, evaluation);
    // Recheck mutable baseline/local evidence after remote reads, before freezing intent.
    await validateEntityReview(
      review,
      input.choices,
      await readSource(),
      evaluation,
    );
    guard();
    await persistPreparedAttempt(attempt, guard);
    return structuredClone(attempt);
  });
}
