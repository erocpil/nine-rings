import { announceLocalFileSessions } from "./session";
const DB = "nine-rings-local-file-recovery";
const STORE = "drafts";
const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECOVERY_DRAFTS = 5;
const pending = new Map<string, Promise<void>>();
/** Autosave, explicit close and successful-save cleanup share one ordered lane. */
function enqueue(identity: string, operation: () => Promise<void>): Promise<void> {
  const next = (pending.get(identity) ?? Promise.resolve()).catch(() => {}).then(operation);
  pending.set(identity, next);
  const finished = () => { if (pending.get(identity) === next) pending.delete(identity); };
  void next.then(finished, finished);
  return next;
}
export interface LocalFileDraft {
  identity: string;
  source: string;
  baseSource: string;
  baseRevision: string;
  bom: boolean;
  lineEnding: "lf" | "crlf" | "cr" | "mixed";
  savedAt: number;
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "identity" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readLocalDraft(identity: string): Promise<LocalFileDraft | null> {
  await pending.get(identity)?.catch(() => {});
  const db = await openDb();
  try {
    const draft = await new Promise<LocalFileDraft | null>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(identity); request.onsuccess = () => resolve((request.result as LocalFileDraft | undefined) ?? null); request.onerror = () => reject(request.error); });
    if (draft && Date.now() - draft.savedAt > DRAFT_RETENTION_MS) { await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(identity); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); return null; }
    return draft;
  }
  finally { db.close(); }
}
export async function listLocalDrafts(): Promise<LocalFileDraft[]> {
  await Promise.allSettled([...pending.values()]);
  const db = await openDb();
  try {
    const drafts = await new Promise<LocalFileDraft[]>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as LocalFileDraft[]);
      request.onerror = () => reject(request.error);
    });
    return drafts.filter(draft => Date.now() - draft.savedAt <= DRAFT_RETENTION_MS).sort((a, b) => b.savedAt - a.savedAt);
  } finally { db.close(); }
}
export function writeLocalDraft(value: LocalFileDraft): Promise<void> {
  return enqueue(value.identity, async () => { await writeDraft(value); announceLocalFileSessions(); });
}
async function writeDraft(value: LocalFileDraft): Promise<void> {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite"); const store = transaction.objectStore(STORE);
    store.put(value);
    const all = store.getAll();
    all.onsuccess = () => {
      const drafts = (all.result as LocalFileDraft[]).sort((left, right) => right.savedAt - left.savedAt);
      for (const draft of drafts.slice(MAX_RECOVERY_DRAFTS)) store.delete(draft.identity);
    };
    all.onerror = () => reject(all.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("恢复草稿保存已取消"));
  }); }
  finally { db.close(); }
}
export function removeLocalDraft(identity: string): Promise<void> {
  return enqueue(identity, async () => { await removeDraft(identity); announceLocalFileSessions(); });
}
async function removeDraft(identity: string): Promise<void> {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(identity); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
