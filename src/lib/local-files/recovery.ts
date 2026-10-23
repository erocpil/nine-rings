const DB = "nine-rings-local-file-recovery";
const STORE = "drafts";
const DRAFT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECOVERY_DRAFTS = 5;
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
  const db = await openDb();
  try {
    const draft = await new Promise<LocalFileDraft | null>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(identity); request.onsuccess = () => resolve((request.result as LocalFileDraft | undefined) ?? null); request.onerror = () => reject(request.error); });
    if (draft && Date.now() - draft.savedAt > DRAFT_RETENTION_MS) { await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(identity); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); return null; }
    return draft;
  }
  finally { db.close(); }
}
export async function writeLocalDraft(value: LocalFileDraft): Promise<void> {
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
export async function removeLocalDraft(identity: string): Promise<void> {
  const db = await openDb();
  try { await new Promise<void>((resolve, reject) => { const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(identity); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); }
  finally { db.close(); }
}
