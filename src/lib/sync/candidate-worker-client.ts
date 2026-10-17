import type {
  CandidateReview,
  CandidateRuntime,
} from "./candidate-write-policy";

/** A host-owned, action-local worker. No network, storage or write capabilities. */
export class CandidateWorkerClient {
  private readonly worker: Worker;
  private nextId = 0;
  private closed = false;
  private pending = new Map<
    number,
    {
      resolve: (review: CandidateReview) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(maxBytes: number, maxEntries: number) {
    this.worker = new Worker(
      new URL("../../workers/sync-candidate.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (
      event: MessageEvent<{
        id: number;
        review?: CandidateReview;
        error?: boolean;
      }>,
    ) => {
      const entry = this.pending.get(event.data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(event.data.id);
      if (event.data.error || !event.data.review)
        entry.reject(Error("后台同步认证失败，请重新预检"));
      else entry.resolve(event.data.review);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.close("后台同步认证不可用，请重新预检");
    };
    this.worker.onmessageerror = () =>
      this.close("后台同步认证消息损坏，请重新预检");
    this.worker.postMessage({ kind: "init", maxBytes, maxEntries });
  }
  review(source: string, runtime: CandidateRuntime): Promise<CandidateReview> {
    if (this.closed) return Promise.reject(Error("认证上下文已失效"));
    // Only one source is queued at a time by callers; bound concurrent accidental requests too.
    if (this.pending.size >= 2)
      return Promise.reject(Error("后台同步认证繁忙，请稍后重试"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.close("后台同步认证超时，请重新预检"),
        120_000,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker.postMessage({ kind: "review", id, source, runtime });
      } catch {
        this.close("无法发送后台同步认证请求");
      }
    });
  }
  close(message = "认证上下文已失效") {
    if (this.closed) return;
    this.closed = true;
    this.worker.terminate();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(Error(message));
    }
    this.pending.clear();
  }
}
