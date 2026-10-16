/** Review-only workflow: saving a choice never confirms acceptance or applies data. */
import { syncSpaceId } from "./protocol-switch";
import { canonicalDigest } from "./canonical-codec";
import { candidateEntities } from "./entity-projection";
import { previewRemoteEntityPlan, type EntityChoice } from "./entity-plan";
import { assembleEntityCandidate } from "./entity-assembly";
import {
  bytesDigest,
  type GitRead,
  type RemoteProtocolReport,
} from "./remote-protocol";
import type { CandidateRuntime } from "./candidate-write-policy";
import {
  readAcceptedBaselines,
  readEntityReviewDraft,
  saveEntityReviewDraft,
} from "./entity-review-store";
import {
  readDocumentStorageGeneration,
  assertDocumentStorageGeneration,
} from "../document-storage-generation";

interface ReviewBinding {
  spaceId: string;
  expectedHead: string;
  snapshotSha256: string;
  localRevision: string;
  baselineSha256: string;
  storageGeneration: string;
  runtime: CandidateRuntime;
}
async function reviewBinding(review: ReviewBinding): Promise<string> {
  return canonicalDigest({
    spaceId: review.spaceId,
    head: review.expectedHead,
    remote: review.snapshotSha256,
    local: review.localRevision,
    baseline: review.baselineSha256,
    storageGeneration: review.storageGeneration,
    runtime: review.runtime,
  });
}
export async function prepareEntityReview(input: {
  report: RemoteProtocolReport;
  request: GitRead;
  localSource: string;
  runtime: CandidateRuntime;
}) {
  const frozen = { ...input, report: structuredClone(input.report) };
  const storageGeneration = readDocumentStorageGeneration();
  const baselines = await readAcceptedBaselines(frozen.report.spaceId);
  const preview = await previewRemoteEntityPlan({ ...frozen, baselines });
  const baselineSha256 = await canonicalDigest(baselines);
  const binding = await reviewBinding({
    ...preview,
    baselineSha256,
    storageGeneration,
    runtime: frozen.runtime,
  });
  const draft = await readEntityReviewDraft(preview.spaceId);
  const choices = draft && draft.binding === binding ? draft.choices : [];
  // Also validate restored choices rather than trusting the draft database.
  const candidate = await assembleEntityCandidate({
    ...preview,
    baselines,
    runtime: frozen.runtime,
    choices,
  });
  assertDocumentStorageGeneration(storageGeneration);
  return {
    ...preview,
    space: frozen.report.space,
    baselines,
    baselineSha256,
    binding,
    storageGeneration,
    runtime: frozen.runtime,
    choices,
    draftRevision: draft?.revision ?? null,
    expiredDraft: !!draft && draft.binding !== binding,
    rows: candidate.rows,
  };
}
export type EntityReview = Awaited<ReturnType<typeof prepareEntityReview>>;
export async function assembleFrozenEntityReview(
  review: EntityReview,
  choices: EntityChoice[],
) {
  // Snapshot before the first await: UI edits cannot change an in-flight review.
  review = structuredClone(review);
  choices = structuredClone(choices);
  assertDocumentStorageGeneration(review.storageGeneration);
  if ((await syncSpaceId(review.space)) !== review.spaceId)
    throw Error("候选审查空间已变化");
  if ((await reviewBinding(review)) !== review.binding)
    throw Error("候选审查绑定已损坏");
  const frozenEntities = await candidateEntities(
    review.localSource,
    review.runtime,
  );
  if (
    (await canonicalDigest(
      [...frozenEntities].sort((a, b) =>
        JSON.stringify([a.kind, a.id]) < JSON.stringify([b.kind, b.id])
          ? -1
          : 1,
      ),
    )) !== review.localRevision
  )
    throw Error("本机快照绑定已损坏");
  if ((await bytesDigest(review.remoteSource)) !== review.snapshotSha256)
    throw Error("远端快照绑定已损坏");
  if ((await canonicalDigest(review.baselines)) !== review.baselineSha256)
    throw Error("冻结接受基线已损坏");
  const candidate = await assembleEntityCandidate({
    ...review,
    baselines: review.baselines,
    choices,
  });
  return candidate;
}
export async function validateEntityReview(
  review: EntityReview,
  choices: EntityChoice[],
  currentLocalSource: string,
) {
  review = structuredClone(review);
  choices = structuredClone(choices);
  const current = await candidateEntities(currentLocalSource, review.runtime);
  const sorted = [...current].sort((a, b) =>
    JSON.stringify([a.kind, a.id]) < JSON.stringify([b.kind, b.id]) ? -1 : 1,
  );
  if ((await canonicalDigest(sorted)) !== review.localRevision)
    throw Error("本机内容已变化，请重新预检和选择");
  if ((await bytesDigest(review.remoteSource)) !== review.snapshotSha256)
    throw Error("远端快照绑定已损坏");
  const baselines = await readAcceptedBaselines(review.spaceId);
  if ((await canonicalDigest(baselines)) !== review.baselineSha256)
    throw Error("已接受基线已变化，请重新预检");
  const candidate = await assembleFrozenEntityReview(review, choices);
  assertDocumentStorageGeneration(review.storageGeneration);
  return candidate;
}
export async function persistEntityReviewChoices(
  review: EntityReview,
  choices: EntityChoice[],
  currentLocalSource: string,
  assertActive: () => void = () => {},
) {
  const frozen = structuredClone({ review, choices });
  const candidate = await validateEntityReview(
    frozen.review,
    frozen.choices,
    currentLocalSource,
  );
  assertActive();
  const draft = await saveEntityReviewDraft(
    {
      spaceId: frozen.review.spaceId,
      binding: frozen.review.binding,
      choices: frozen.choices,
    },
    frozen.review.draftRevision,
    assertActive,
  );
  return { candidate, draft };
}
