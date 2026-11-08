import { pluginRuntime, type PluginActivation } from "../plugin-system/runtime";
import { runBrowserOperation, operationTarget, type BrowserOperation, type BrowserProgress, type BrowserItemResult, type ConflictDecision } from "./browser-operations";
import { BrowserQueueHistory } from "./browser-queue-history";

export const browserOperationTitles = { copy: "复制到另一栏", move: "移动到另一栏", rename: "重命名", "batch-rename": "批量重命名", file: "新建文件", directory: "新建文件夹", trash: "移入系统回收站" } as const;
export interface BrowserJob {
  readonly id: number; readonly operation: BrowserOperation; readonly name: string;
  readonly status: "queued" | "running" | "waiting" | "completed" | "stopped" | "failed";
  readonly progress: BrowserProgress; readonly items: readonly BrowserItemResult[];
  readonly queuedAt: number; readonly startedAt?: number; readonly endedAt?: number;
  readonly error?: string; readonly conflict?: string;
  readonly retryId?: number;
}
export const browserJobSettled = (job: BrowserJob) => ["completed", "stopped", "failed"].includes(job.status);
export function retryBrowserItems(job: BrowserJob) {
  return job.items.filter(item => ["pending", "checking", "failed"].includes(item.status));
}
/** Session-only queue. Never replays disk writes on reload or plugin activation. */
export class BrowserOperationQueue {
  private jobs: readonly BrowserJob[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  private sequence = 0;
  private draining = false;
  private disposed = false;
  private paused = false;
  isPaused = () => this.paused;
  private current: { id: number; controller: AbortController; decide?: (value: ConflictDecision) => void } | null = null;
  private history?: BrowserQueueHistory;
  constructor(private owner: PluginActivation, persistResults = false) { if (persistResults) this.history = new BrowserQueueHistory(); }
  historyKey = () => this.history?.key;
  historyIssue = () => this.history?.issue ?? "";
  getSnapshot = () => this.jobs;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(jobs: readonly BrowserJob[]) {
    this.jobs = Object.freeze([...jobs]);
    this.history?.capture(this.jobs);
    for (const listener of this.listeners) { try { listener(); } catch { /* isolate UI observers */ } }
  }
  private update(id: number, patch: Partial<BrowserJob>) { this.publish(this.jobs.map(job => job.id === id ? Object.freeze({ ...job, ...patch }) : job)); }
  enqueue(operation: BrowserOperation, name: string) {
    if (this.disposed) throw new Error("操作队列已关闭");
    pluginRuntime.assert(this.owner, "filesystem.files.write");
    const count = operation.nodes.length || 1;
    if (count > 2000) throw new Error("单个任务最多 2000 项");
    const jobs = [...this.jobs];
    while (jobs.length >= 20 || jobs.reduce((sum, job) => sum + job.items.length, count) > 4000) {
      const at = jobs.findIndex(browserJobSettled);
      if (at < 0) throw new Error("操作队列已满，请等待或停止部分任务后重试");
      jobs.splice(at, 1);
    }
    const nodes = [...operation.nodes]; Object.freeze(nodes);
    const snapshot: BrowserOperation = Object.freeze({ ...operation, nodes, ...(operation.names ? { names: Object.freeze({ ...operation.names }) } : {}) });
    const items = (snapshot.nodes.length ? snapshot.nodes : [""]).map(node => Object.freeze({ node, targetName: snapshot.names?.[node] ?? (["file", "directory", "rename"].includes(snapshot.kind) ? name.trim() : node.split("/").pop()!), status: "pending" as const }));
    const job: BrowserJob = Object.freeze({ id: ++this.sequence, operation: snapshot, name, status: "queued", progress: { completed: 0, skipped: 0, total: count, current: "" }, items: Object.freeze(items), queuedAt: Date.now() });
    this.publish([...jobs, job]);
    void this.drain();
    return job.id;
  }
  retry(id: number) {
    const job = this.jobs.find(value => value.id === id);
    if (!job || !browserJobSettled(job)) throw new Error("任务尚未结束");
    if (job.retryId !== undefined) throw new Error("未完成项已加入重试任务，请查看对应任务结果");
    const items = retryBrowserItems(job);
    if (!items.length) throw new Error("没有可重试的未完成项；需核对项不能直接重试");
    const retryId = this.enqueue({ ...job.operation, nodes: job.operation.nodes.length ? items.map(item => item.node) : [], ...(job.operation.kind === "batch-rename" ? { names: Object.fromEntries(items.map(item => [item.node, item.targetName])) } : {}) }, job.name);
    this.update(id, { retryId }); return retryId;
  }
  stop(id: number) {
    const job = this.jobs.find(value => value.id === id);
    if (!job || browserJobSettled(job)) return;
    if (this.current?.id === id) {
      this.current.controller.abort(); this.current.decide?.({ action: "stop" }); this.current.decide = undefined;
      this.update(id, { conflict: undefined, status: "running" });
    } else this.update(id, { status: "stopped", endedAt: Date.now() });
  }
  stopAll() { for (const job of this.jobs) this.stop(job.id); }
  resume() { if (this.disposed) return; this.paused = false; this.publish(this.jobs); void this.drain(); }
  decide(id: number, value: ConflictDecision) {
    if (this.current?.id !== id || !this.current.decide) return;
    const resolve = this.current.decide; this.current.decide = undefined;
    this.update(id, { conflict: undefined, status: "running" }); resolve(value);
  }
  clearFinished() { this.publish(this.jobs.filter(job => !browserJobSettled(job))); }
  dispose() { if (this.disposed) return; this.disposed = true; this.stopAll(); this.history?.dispose(); this.listeners.clear(); }
  private async drain() {
    if (this.draining || this.disposed || this.paused) return;
    this.draining = true;
    try {
      for (;;) {
        const job = this.jobs.find(value => value.status === "queued");
        if (!job || this.disposed || this.paused) return;
        const controller = new AbortController();
        this.current = { id: job.id, controller };
        this.update(job.id, { status: "running", startedAt: Date.now() });
        try {
          const result = await runBrowserOperation(this.owner, job.operation, job.name, controller.signal,
            progress => this.update(job.id, { progress }),
            conflict => new Promise(resolve => {
              if (controller.signal.aborted || this.disposed) { resolve({ action: "stop" }); return; }
              this.current!.decide = resolve; this.update(job.id, { status: "waiting", conflict });
            }),
            item => {
              const current = this.jobs.find(value => value.id === job.id);
              if (current) this.update(job.id, { items: Object.freeze(current.items.map(value => value.node === item.node ? Object.freeze(item) : value)) });
            });
          this.update(job.id, { progress: result, status: result.cancelled ? "stopped" : "completed", endedAt: Date.now(), conflict: undefined });
        } catch (error) {
          if (!controller.signal.aborted || this.jobs.find(value => value.id === job.id)?.items.some(item => item.status === "uncertain")) this.paused = true;
          this.update(job.id, { status: controller.signal.aborted ? "stopped" : "failed", error: String(error), endedAt: Date.now(), conflict: undefined });
        } finally { this.current = null; }
      }
    } finally { this.draining = false; }
  }
}

export function browserQueueReport(jobs: readonly BrowserJob[]) {
  return jobs.map(job => [
    `#${job.id} ${browserOperationTitles[job.operation.kind]} · ${job.status}`,
    `来源：${[job.operation.rootName, job.operation.parent].filter(Boolean).join("/")}`,
    ...(["copy", "move"].includes(job.operation.kind) ? [`目标：${operationTarget(job.operation)}`] : []),
    ...job.items.map(item => `${item.status}\t${item.node || item.targetName} → ${item.targetName}${item.error ? `\t${item.error}` : ""}`),
    ...(job.error ? [job.error] : []),
  ].join("\n")).join("\n\n");
}

const queues = new WeakMap<PluginActivation, BrowserOperationQueue>();
/** Activation-owned, including when the browser is parked or StrictMode remounts. */
export function getBrowserOperationQueue(owner: PluginActivation) {
  let queue = queues.get(owner);
  if (!queue) {
    queue = new BrowserOperationQueue(owner, true);
    pluginRuntime.own(owner, () => queue!.dispose());
    queues.set(owner, queue);
  }
  return queue;
}
