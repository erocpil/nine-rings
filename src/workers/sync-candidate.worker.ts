/// <reference lib="webworker" />
import {
  createCandidateEvaluationScope,
  reviewCandidatePayload,
  type CandidateEvaluationScope,
  type CandidateRuntime,
} from "../lib/sync/candidate-write-policy";

let evaluation: CandidateEvaluationScope | undefined;
self.onmessage = (
  event: MessageEvent<{
    kind: "init" | "review";
    id: number;
    source: string;
    runtime: CandidateRuntime;
    maxBytes: number;
    maxEntries: number;
  }>,
) => {
  const request = event.data;
  try {
    if (request.kind === "init") {
      if (evaluation) throw Error();
      evaluation = createCandidateEvaluationScope({
        maxBytes: request.maxBytes,
        maxEntries: request.maxEntries,
      });
      return;
    }
    if (
      !evaluation ||
      request.kind !== "review" ||
      typeof request.source !== "string" ||
      request.source.length > 128 * 1024 * 1024
    )
      throw Error();
    self.postMessage({
      id: request.id,
      review: reviewCandidatePayload(
        request.source,
        request.runtime,
        evaluation,
      ),
    });
  } catch {
    // Never return source, document names, credentials or parser exceptions.
    self.postMessage({ id: request.id, error: true });
  }
};
