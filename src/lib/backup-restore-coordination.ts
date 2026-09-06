/** Restore-to-restore exclusion and durable, content-free interruption records. */
export const RESTORE_LOCK_NAME = "nine-rings:backup-restore:v1";
export const RESTORE_JOURNAL_KEY = "nr:backup-restore-journal:v1";
export const RESTORE_CHANGED_EVENT = "nr:backup-restore-changed";

type Phase = "preparing" | "applying" | "rolling-back" | "finalizing" | "completed" | "failed" | "needs-review" | "acknowledged";
export interface RestoreRecord {
  version: 1;
  id: string;
  source: "file" | "github";
  mode: "merge" | "replace";
  phase: Phase;
  startedAt: string;
  updatedAt: string;
}
export interface RestoreStatus { record: RestoreRecord | null; active: boolean; interrupted: boolean; local: boolean }
export interface RestoreContext {
  readonly mutationStarted: boolean;
  readonly dataCommitted: boolean;
  setPhase: (phase: "applying" | "rolling-back") => void;
  markDataCommitted: () => void;
}
const activeContexts = new WeakSet<RestoreContext>();
let localRecordId: string | null = null;

export class CorruptRestoreRecordError extends Error {
  constructor() { super("恢复记录损坏，请先导出本地数据，再清理记录"); }
}

export function assertRestoreContext(context: RestoreContext): void {
  if (!activeContexts.has(context)) throw new Error("恢复操作已结束或上下文无效，请重新开始");
}

function locks(): LockManager {
  if (!globalThis.navigator?.locks) throw new Error("当前环境不支持跨窗口恢复锁，请使用支持 Web Locks 的 HTTPS 浏览器或新版安装版");
  return navigator.locks;
}

function readRecord(): RestoreRecord | null {
  const raw = localStorage.getItem(RESTORE_JOURNAL_KEY);
  if (raw === null) return null;
  let record: unknown;
  try { record = JSON.parse(raw); } catch { throw new CorruptRestoreRecordError(); }
  if (!record || typeof record !== "object") throw new CorruptRestoreRecordError();
  const r = record as Partial<RestoreRecord>;
  if (r.version !== 1 || typeof r.id !== "string" || r.id.length > 128 || !r.id ||
      !["file", "github"].includes(String(r.source)) || !["merge", "replace"].includes(String(r.mode)) ||
      !["preparing", "applying", "rolling-back", "finalizing", "completed", "failed", "needs-review", "acknowledged"].includes(String(r.phase)) ||
      typeof r.startedAt !== "string" || !Number.isFinite(Date.parse(r.startedAt)) ||
      typeof r.updatedAt !== "string" || !Number.isFinite(Date.parse(r.updatedAt))) {
    throw new CorruptRestoreRecordError();
  }
  return { version: 1, id: r.id, source: r.source!, mode: r.mode!, phase: r.phase!, startedAt: r.startedAt, updatedAt: r.updatedAt };
}
const pending = (record: RestoreRecord | null) => !!record && !["completed", "failed", "needs-review", "acknowledged"].includes(record.phase);

function createContext(persist: (phase: Phase) => void): RestoreContext {
  let mutationStarted = false;
  let dataCommitted = false;
  let rollingBack = false;
  const context: RestoreContext = {
    get mutationStarted() { return mutationStarted; },
    get dataCommitted() { return dataCommitted; },
    setPhase(phase) {
      assertRestoreContext(context);
      // A failed journal write must not be mistaken for the start of data writes.
      if (!rollingBack || phase !== "applying") persist(phase);
      if (phase === "applying") mutationStarted = true;
      if (phase === "rolling-back") rollingBack = true;
    },
    markDataCommitted() {
      assertRestoreContext(context);
      // Set before persisting: a journal/notification error after the database
      // commit must never cause GitHub to replay the pre-import snapshot.
      dataCommitted = true;
      if (!rollingBack) persist("finalizing");
    },
  };
  return context;
}

function writeRecord(record: RestoreRecord) {
  // Failure must surface before touching document/settings data.
  localStorage.setItem(RESTORE_JOURNAL_KEY, JSON.stringify(record));
  window.dispatchEvent(new Event(RESTORE_CHANGED_EVENT));
}

export async function inspectBackupRestore(): Promise<RestoreStatus> {
  const record = readRecord();
  if (!pending(record)) return { record, active: false, interrupted: false, local: false };
  return locks().request(RESTORE_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, (lock) => {
    const latest = readRecord();
    return { record: latest, active: !lock, interrupted: !!lock && pending(latest), local: latest?.id === localRecordId };
  });
}

export async function withBackupRestore<T>(
  source: RestoreRecord["source"], mode: RestoreRecord["mode"], task: (context: RestoreContext) => Promise<T>,
): Promise<T> {
  // Headless storage-contract runners have neither windows nor shared browser state.
  if (typeof window === "undefined") {
    const context = createContext(() => {});
    activeContexts.add(context);
    try { return await task(context); } finally { activeContexts.delete(context); }
  }
  return locks().request(RESTORE_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("另一个窗口正在恢复备份，请等待完成后重新预检；本次未修改数据");
    const previous = readRecord();
    if (pending(previous)) throw new Error("检测到上次恢复中断，请先在设置中检查并确认恢复记录；本次未修改数据");
    if (previous?.phase === "needs-review") throw new Error("上次恢复结果尚待检查，请先在设置中检查并确认恢复记录；本次未修改数据");
    const now = new Date().toISOString();
    let record: RestoreRecord = { version: 1, id: crypto.randomUUID(), source, mode, phase: "preparing", startedAt: now, updatedAt: now };
    const update = (phase: Phase) => {
      record = { ...record, phase, updatedAt: new Date().toISOString() };
      writeRecord(record);
    };
    update("preparing");
    const context = createContext(update);
    localRecordId = record.id;
    activeContexts.add(context);
    let taskFinished = false;
    try {
      const result = await task(context);
      taskFinished = true;
      update("completed");
      return result;
    } catch (error) {
      if (taskFinished) {
        // The data operation finished; never mistake a journal error for an import
        // error and blindly replay an old database snapshot over the new data.
        throw new Error("数据恢复已执行，但完成记录保存失败。请检查本地数据，勿直接重复恢复。");
      }
      try { update(context.mutationStarted || context.dataCommitted ? "needs-review" : "failed"); } catch { /* Preserve the pending record for inspection after restart. */ }
      throw error;
    } finally {
      activeContexts.delete(context);
      localRecordId = null;
      window.dispatchEvent(new Event(RESTORE_CHANGED_EVENT));
    }
  });
}

/** Acknowledge only; never retries, rolls back or changes document data. */
export async function acknowledgeBackupRestore(expectedId: string | null): Promise<void> {
  await locks().request(RESTORE_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("恢复仍在进行，不能清理记录");
    let record: RestoreRecord | null;
    try { record = readRecord(); }
    catch (error) {
      if (expectedId !== null || !(error instanceof CorruptRestoreRecordError)) throw error;
      localStorage.removeItem(RESTORE_JOURNAL_KEY);
      window.dispatchEvent(new Event(RESTORE_CHANGED_EVENT));
      return;
    }
    if (!record || record.id !== expectedId) throw new Error("恢复记录已变化，请重新检查后确认");
    writeRecord({ ...record, phase: "acknowledged", updatedAt: new Date().toISOString() });
  });
}

/** Export an inspection copy without racing another restore or changing its record. */
export async function withBackupRestoreReadLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined") return task();
  return locks().request(RESTORE_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) throw new Error("有窗口正在恢复备份，请等待完成后再导出检查副本");
    return task();
  });
}
