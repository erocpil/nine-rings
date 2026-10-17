import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import { CandidateWorkerClient } from "../../src/lib/sync/candidate-worker-client";
import {
  reviewCandidatePayloadAsync,
  assertCandidateWriteAsync,
} from "../../src/lib/sync/candidate-async-policy";
import {
  createCandidateEvaluationScope,
  disposeCandidateEvaluationScope,
  reviewCandidatePayload,
} from "../../src/lib/sync/candidate-write-policy";

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault(): void }) => void;
  onmessageerror?: () => void;
  messages: Record<string, unknown>[] = [];
  terminated = false;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(value: Record<string, unknown>) {
    this.messages.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  reply(review = reviewCandidatePayload(JSON.stringify(fixture), "web")) {
    this.onmessage?.({ data: { id: this.messages.at(-1)!.id, review } });
  }
}
afterEach(() => {
  FakeWorker.all = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function host() {
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", FakeWorker);
}
const large = JSON.stringify({ ...fixture, exported_at: "x".repeat(300_000) });
it("reuses the operation worker, rejects disposal and does not replay work", async () => {
  host();
  const scope = createCandidateEvaluationScope({ maxBytes: 0, maxEntries: 0 });
  const first = reviewCandidatePayloadAsync(large, "web", scope);
  const worker = FakeWorker.all[0];
  expect(worker.messages[0]).toMatchObject({ maxBytes: 0, maxEntries: 0 });
  worker.reply();
  expect(await first).toEqual(
    reviewCandidatePayload(JSON.stringify(fixture), "web"),
  );
  const next = reviewCandidatePayloadAsync(large, "web", scope);
  const rejected = expect(next).rejects.toThrow("失效");
  disposeCandidateEvaluationScope(scope);
  worker.reply();
  await rejected;
  expect(worker.terminated).toBe(true);
  expect(FakeWorker.all).toHaveLength(1);
  await expect(
    reviewCandidatePayloadAsync(large, "web", scope),
  ).rejects.toThrow("失效");
});
it("worker errors, message corruption and timeouts fail closed and release pending requests", async () => {
  host();
  vi.useFakeTimers();
  for (const cause of ["error", "message", "timeout"] as const) {
    const client = new CandidateWorkerClient(0, 0);
    const worker = FakeWorker.all.at(-1)!;
    const request = client.review(large, "web");
    const rejected = expect(request).rejects.toThrow();
    if (cause === "error") worker.onerror?.({ preventDefault() {} });
    else if (cause === "message") worker.onmessageerror?.();
    else await vi.advanceTimersByTimeAsync(120_001);
    await rejected;
    expect(worker.terminated).toBe(true);
    await expect(client.review(large, "web")).rejects.toThrow("失效");
  }
});
it("small/non-browser sources preserve exact validation and capabilities cannot be bypassed", async () => {
  expect(
    await reviewCandidatePayloadAsync(JSON.stringify(fixture), "web"),
  ).toEqual(reviewCandidatePayload(JSON.stringify(fixture), "web"));
  host();
  await expect(
    assertCandidateWriteAsync(large, {
      runtime: "web",
      expectedId: "not-an-id",
    }),
  ).rejects.toThrow();
  expect(FakeWorker.all).toHaveLength(0);
});

it("keeps the main-thread memo empty after its budget transfers to a worker", async () => {
  const {
    ownCandidateComputation,
    createCandidateEvaluationScope,
    reviewCandidatePayload,
    inspectCandidateEvaluation,
    disposeCandidateEvaluationScope,
  } = await import("../../src/lib/sync/candidate-write-policy");
  const fixture = (
    await import("../../schema/sync/fixtures/candidate-entities-v1.json")
  ).default;
  const scope = createCandidateEvaluationScope();
  const source = JSON.stringify(fixture);
  reviewCandidatePayload(source, "web", scope);
  expect(inspectCandidateEvaluation(scope).bytes).toBeGreaterThan(0);
  let closed = false;
  ownCandidateComputation(scope, () => {
    closed = true;
  });
  reviewCandidatePayload(source, "web", scope);
  expect(inspectCandidateEvaluation(scope).bytes).toBe(0);
  disposeCandidateEvaluationScope(scope);
  expect(closed).toBe(true);
});
