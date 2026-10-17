import { reviewCandidatePayloadAsync } from "./candidate-async-policy";
/** Read-only, fixed-HEAD review for an empty backup namespace. */
import { canonicalDigest } from "./canonical-codec";
import { candidateEntities } from "./entity-projection";
import { entityKey } from "./entity-plan";
import {
  withCandidateEvaluation,
  type CandidateRuntime,
} from "./candidate-write-policy";
import { syncSpaceId } from "./protocol-switch";
import type { RemoteProtocolReport } from "./remote-protocol";
import { gitSha } from "./remote-protocol";
import {
  assertDocumentStorageGeneration,
  readDocumentStorageGeneration,
} from "../document-storage-generation";

export async function prepareBootstrapReview(input: {
  report: RemoteProtocolReport;
  localSource: string;
  runtime: CandidateRuntime;
}) {
  const { localSource, runtime } = input;
  const report = structuredClone(input.report);
  const { evidence } = report;
  if (
    report.spaceId !== (await syncSpaceId(report.space)) ||
    report.history !== "complete" ||
    !gitSha(evidence.head) ||
    evidence.control.commit !== evidence.head ||
    evidence.snapshot.commit !== evidence.head ||
    evidence.control.state !== "absent" ||
    evidence.snapshot.latestId ||
    evidence.snapshot.header !== "absent" ||
    evidence.legacyHistory !== "verified-never-enabled"
  )
    throw Error("需要历史完整且未启用协议的空备份空间预检");
  if (new TextEncoder().encode(localSource).length > 64 * 1024 * 1024)
    throw Error("首次发布候选超过 64 MiB 预算");
  const storageGeneration = readDocumentStorageGeneration();
  return withCandidateEvaluation(undefined, async (evaluation) => {
    const payload = await reviewCandidatePayloadAsync(
      localSource,
      runtime,
      evaluation,
    );
    if (!payload.eligible)
      throw Error("本机数据包含尚未认证的内容，不能首次发布");
    const entities = await candidateEntities(localSource, runtime, evaluation);
    const localRevision = await canonicalDigest(
      entities.sort((a, b) => (entityKey(a) < entityKey(b) ? -1 : 1)),
    );
    const binding = await canonicalDigest({
      spaceId: report.spaceId,
      head: evidence.head,
      localRevision,
      storageGeneration,
      runtime,
    });
    assertDocumentStorageGeneration(storageGeneration);
    return {
      kind: "bootstrap" as const,
      report,
      space: report.space,
      runtime,
      localSource,
      localRevision,
      storageGeneration,
      binding,
      payload,
      entityCount: entities.length,
    };
  });
}
export type BootstrapReview = Awaited<
  ReturnType<typeof prepareBootstrapReview>
>;
export async function validateBootstrapReview(
  review: BootstrapReview,
  source: string,
) {
  assertDocumentStorageGeneration(review.storageGeneration);
  const fresh = await prepareBootstrapReview({
    report: review.report,
    localSource: source,
    runtime: review.runtime,
  });
  if (fresh.binding !== review.binding)
    throw Error("本机内容或首次发布预检已变化，请重新预检并核验备份");
  return fresh;
}
