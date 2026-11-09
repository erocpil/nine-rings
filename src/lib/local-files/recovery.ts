import { announceLocalFileSessions } from "./session";
const STORE = "drafts";
const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECOVERY_DRAFTS = 5;
const lanes = new Map<string, Map<string, Promise<void>>>();
export interface LocalFileDraft {
  identity: string;
  source: string;
  baseSource: string;
  baseRevision: string;
  bom: boolean;
  lineEnding: "lf" | "crlf" | "cr" | "mixed";
  savedAt: number;
}
/** Same transactional draft protocol, separate databases per application. */
export function createLocalDraftStore(databaseName: string, notify: () => void, options: { retainUntilResolved?: boolean } = {}): {
  read(identity: string): Promise<LocalFileDraft | null>;
  list(): Promise<LocalFileDraft[]>;
  write(value: LocalFileDraft): Promise<void>;
  remove(identity: string): Promise<void>;
} {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(databaseName)) throw new Error("无效的恢复草稿库名称");
  const pending = lanes.get(databaseName) ?? new Map<string, Promise<void>>();
  lanes.set(databaseName, pending);
  /** Autosave, explicit close and successful-save cleanup share one ordered lane. */
  function enqueue(identity: string, operation: () => Promise<void>): Promise<void> {
    const next = (pending.get(identity) ?? Promise.resolve()).catch(() => {}).then(operation);
    pending.set(identity, next);
    const finished = () => { if (pending.get(identity) === next) pending.delete(identity); };
    void next.then(finished, finished);
    return next;
  }
  function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "identity" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("恢复草稿请求失败"));
    });
  }
  async function readLocalDraft(identity: string): Promise<LocalFileDraft | null> {
    await pending.get(identity)?.catch(() => {});
    const db = await openDb();
    try {
      const draft = await new Promise<LocalFileDraft | null>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(identity); request.onsuccess = () => resolve((request.result as LocalFileDraft | undefined) ?? null); request.onerror = () => reject(request.error ?? new Error("恢复草稿请求失败")); });
      if (!options.retainUntilResolved && draft && Date.now() - draft.savedAt > DRAFT_RETENTION_MS) { await enqueue(identity, () => removeDraft(identity, draft)); return null; }
      return draft;
    }
    finally { db.close(); }
  }
  async function listLocalDrafts(): Promise<LocalFileDraft[]> {
    await Promise.allSettled([...pending.values()]);
    const db = await openDb();
    try {
      const drafts = await new Promise<LocalFileDraft[]>((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result as LocalFileDraft[]);
        request.onerror = () => reject(request.error ?? new Error("恢复草稿请求失败"));
      });
      return drafts.filter(draft => options.retainUntilResolved || Date.now() - draft.savedAt <= DRAFT_RETENTION_MS).sort((a, b) => b.savedAt - a.savedAt);
    } finally { db.close(); }
  }
  function writeLocalDraft(value: LocalFileDraft): Promise<void> {
    return enqueue(value.identity, async () => { await writeDraft(value); notify(); });
  }
  async function writeDraft(value: LocalFileDraft): Promise<void> {
    const db = await openDb();
    try { await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite"); const store = transaction.objectStore(STORE);
      let capacityError: Error | null = null;
      store.put(value);
      const all = store.getAll();
      all.onsuccess = () => {
        const drafts = (all.result as LocalFileDraft[]).sort((left, right) => right.savedAt - left.savedAt);
        if (options.retainUntilResolved && drafts.length > MAX_RECOVERY_DRAFTS) {
          capacityError = new Error("恢复草稿最多保留 5 份；请先下载并确认删除旧草稿，或保存当前文件。当前编辑仍保留在编辑器中。");
          transaction.abort();
        } else for (const draft of drafts.slice(MAX_RECOVERY_DRAFTS)) store.delete(draft.identity);
      };
      all.onerror = () => reject(all.error ?? new Error("无法读取恢复草稿"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("恢复草稿事务失败"));
      transaction.onabort = () => reject(capacityError ?? transaction.error ?? new Error("恢复草稿保存已取消"));
    }); }
    finally { db.close(); }
  }
  function removeLocalDraft(identity: string): Promise<void> {
    return enqueue(identity, async () => { await removeDraft(identity); notify(); });
  }
  async function removeDraft(identity: string, expected?: LocalFileDraft): Promise<void> {
    const db = await openDb();
    try { await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      if (expected) {
        const request = store.get(identity);
        request.onsuccess = () => {
          const value = request.result as LocalFileDraft | undefined;
          if (value?.savedAt === expected.savedAt && value.source === expected.source && value.baseRevision === expected.baseRevision) store.delete(identity);
        };
      } else store.delete(identity);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("恢复草稿事务失败"));
      transaction.onabort = () => reject(transaction.error ?? new Error("恢复草稿删除已取消"));
    }); }
    finally { db.close(); }
  }

  return { read: readLocalDraft, list: listLocalDrafts, write: writeLocalDraft, remove: removeLocalDraft };
}
export type LocalDraftStore = ReturnType<typeof createLocalDraftStore>;
const defaults = createLocalDraftStore("nine-rings-local-file-recovery", announceLocalFileSessions);
export const readLocalDraft = defaults.read;
export const listLocalDrafts = defaults.list;
export const writeLocalDraft = defaults.write;
export const removeLocalDraft = defaults.remove;
