import { CandidateWorkerClient } from "./candidate-worker-client";
import {
  reviewCandidatePayload,
  assertCandidateWrite,
  assertReviewedCandidate,
  withCandidateEvaluation,
  ownCandidateComputation,
  assertCandidateEvaluationActive,
  type CandidateEvaluationScope,
  type CandidateReview,
  type CandidateRuntime,
} from "./candidate-write-policy";
import { parseSyncJson } from "./strict-json";
import { assertSyncCapabilities } from "./protocol-capabilities";
const workers = new WeakMap<CandidateEvaluationScope, CandidateWorkerClient>();

/** Large browser payloads use exactly the same pure certification code off the UI thread.
 * Scope ownership still bounds cache lifetime. Worker failure never grants write eligibility. */
export async function reviewCandidatePayloadAsync(
  source: string,
  runtime: CandidateRuntime,
  evaluation?: CandidateEvaluationScope,
): Promise<CandidateReview> {
  if (
    typeof window === "undefined" ||
    typeof Worker === "undefined" ||
    (source.length < 256 * 1024 && (!evaluation || !workers.has(evaluation)))
  )
    return reviewCandidatePayload(source, runtime, evaluation);
  return withCandidateEvaluation(evaluation, async (scope) => {
    let worker = workers.get(scope);
    if (!worker) {
      const budget = ownCandidateComputation(scope, () => {
        workers.get(scope)?.close();
        workers.delete(scope);
      });
      worker = new CandidateWorkerClient(budget.maxBytes, budget.maxEntries);
      workers.set(scope, worker);
    }
    const review = await worker.review(source, runtime);
    assertCandidateEvaluationActive(scope); // Disposal during work invalidates even a late success.
    return review;
  });
}

export async function assertCandidateWriteAsync(
  source: string,
  options: Parameters<typeof assertCandidateWrite>[1],
  evaluation?: CandidateEvaluationScope,
): Promise<CandidateReview> {
  const bundle = parseSyncJson(source);
  assertSyncCapabilities(bundle, {
    operation: "write",
    requireHeader: true,
    expectedId: options.expectedId,
    capabilities: options.capabilities,
  });
  const review = await reviewCandidatePayloadAsync(
    source,
    options.runtime,
    evaluation,
  );
  return assertReviewedCandidate(bundle, review);
}
