import type { BrowserJob } from "./browser-queue-core";

export const BROWSER_HISTORY_PREFIX = "nr:file-browser-results:";
const MAX_CHARS = 256 * 1024;
export interface BrowserQueueRecord { session: string; updatedAt: number; report: string }
/** Deliberately not a BrowserOperation/BrowserJob decoder. Persisted text has no
 * route back to enqueue, retry or disk writes, even if storage is tampered with. */
export function browserHistoryReport(jobs: readonly BrowserJob[]) {
  return jobs.slice(-20).map(job => {
    const count = (status: string) => job.items.filter(item => item.status === status).length;
    const lines = [
      `#${job.id} ${job.operation.kind} · ${job.status} · ${new Date(job.queuedAt).toISOString()}`,
      `来源：${job.operation.rootName.slice(0, 512)}/${job.operation.parent.slice(0, 1024)}`,
      `目标：${job.operation.targetRootName.slice(0, 512)}/${job.operation.targetParent.slice(0, 1024)}`,
      `共 ${job.items.length} 项；成功 ${count("completed")}，跳过 ${count("skipped")}，需核对 ${count("uncertain")}，未确认 ${job.items.filter(item => ["pending", "running", "checking"].includes(item.status)).length}`,
      ...job.items.slice(0, 100).map(item => `${item.status}\t${item.node.slice(0, 512)} → ${item.targetName.slice(0, 255)}${item.error ? ` · ${item.error.slice(0, 512)}` : ""}`),
      ...(job.items.length > 100 ? ["仅保存前 100 项明细，其余见上方汇总。"] : []),
      ...(job.error ? [job.error.slice(0, 2048)] : []),
    ];
    const report = lines.join("\n");
    return report.length > 10000 ? `${report.slice(0, 10000)}\n[明细已截断]` : report;
  }).join("\n\n");
}
export function readBrowserQueueHistory(exclude?: string, limit = 5): BrowserQueueRecord[] {
  const records: BrowserQueueRecord[] = [];
  try {
    for (let at = 0; at < localStorage.length; at++) {
      const key = localStorage.key(at);
      if (!key?.startsWith(BROWSER_HISTORY_PREFIX) || key === exclude) continue;
      const raw = localStorage.getItem(key);
      if (!raw || raw.length > MAX_CHARS) continue;
      try {
        const value = JSON.parse(raw);
        if (value.version !== 1 || typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || Math.abs(value.updatedAt) > 8.64e15 || typeof value.report !== "string" || !value.report || value.report.length > MAX_CHARS - 256) continue;
        records.push({ session: key, updatedAt: value.updatedAt, report: value.report });
      } catch { /* A corrupt optional record cannot affect live operations. */ }
    }
  } catch { /* Local storage may be unavailable. */ }
  return records.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
export function clearBrowserQueueHistory(exclude?: string) {
  const keys: string[] = [];
  for (let at = 0; at < localStorage.length; at++) {
    const key = localStorage.key(at);
    if (key?.startsWith(BROWSER_HISTORY_PREFIX) && key !== exclude) keys.push(key);
  }
  for (const key of keys) localStorage.removeItem(key);
}
/** Per-activation keys avoid one window overwriting another window's report.
 * This is a bounded convenience log, not a transactional recovery journal. */
export class BrowserQueueHistory {
  readonly key = BROWSER_HISTORY_PREFIX + crypto.randomUUID();
  issue = "";
  private jobs: readonly BrowserJob[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  constructor() { if (typeof window !== "undefined") window.addEventListener?.("pagehide", this.flush); }
  capture(jobs: readonly BrowserJob[]) {
    const transition = jobs.length !== this.jobs.length || jobs.some((job, index) => job.id !== this.jobs[index]?.id || job.status !== this.jobs[index]?.status);
    this.jobs = jobs;
    // Terminal states and pre-write running state are saved immediately. Other
    // per-item updates are coalesced, avoiding serialization on every progress event.
    const terminal = jobs.every(job => ["completed", "failed", "stopped"].includes(job.status));
    if (this.closed || terminal || transition) this.flush();
    else if (!this.timer) this.timer = setTimeout(this.flush, 250);
  }
  flush = () => {
    clearTimeout(this.timer); this.timer = undefined;
    try {
      if (!this.jobs.length) localStorage.removeItem(this.key);
      else {
        let report = browserHistoryReport(this.jobs);
        const encode = () => JSON.stringify({ version: 1, updatedAt: Date.now(), report });
        let raw = encode();
        while (raw.length > MAX_CHARS) { report = "[更早内容已截断]\n" + report.slice(-Math.floor(report.length * .7)); raw = encode(); }
        localStorage.setItem(this.key, raw);
        for (const record of readBrowserQueueHistory(this.key, Number.MAX_SAFE_INTEGER).slice(4)) localStorage.removeItem(record.session);
      }
      this.issue = "";
    } catch { this.issue = "无法保存本机操作历史；磁盘任务仍按当前队列执行。可复制结果另存。"; }
  };
  dispose() { this.closed = true; if (typeof window !== "undefined") window.removeEventListener?.("pagehide", this.flush); this.flush(); }
}
