/** Single-library transactions; no cross-database partial restore. */
export interface ReadingStores {
  entry: string;
  highlights: string;
  bookmarks: string;
  owner: "pdfId" | "epubId";
}

export interface ReadingEntryIdentity {
  id: string;
  size: number;
  importedAt: string;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("阅读资料库读取失败"));
  });
}

function completed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("阅读数据事务失败，未完成恢复"));
  });
}

export async function readReadingSnapshot<E extends ReadingEntryIdentity, H, B>(db: IDBDatabase, stores: ReadingStores, id: string) {
  const tx = db.transaction([stores.entry, stores.highlights, stores.bookmarks], "readonly");
  const done = completed(tx);
  try {
    const [entry, highlights, bookmarks] = await Promise.all([
      request<E | undefined>(tx.objectStore(stores.entry).get(id)),
      request<H[]>(tx.objectStore(stores.highlights).index(stores.owner).getAll(id)),
      request<B[]>(tx.objectStore(stores.bookmarks).index(stores.owner).getAll(id)),
    ]);
    await done;
    if (!entry) throw new Error("原文件已被删除，请重新导入后再操作");
    return { entry, highlights, bookmarks };
  } catch (error) { await done.catch(() => {}); throw error; }
}

export function canonicalReadingItem(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalReadingItem).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalReadingItem(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function itemContent(item: { id: string }): string {
  const { id: _id, pdfId: _pdfId, epubId: _epubId, ...content } = item as { id: string; pdfId?: string; epubId?: string };
  return canonicalReadingItem(content);
}

export interface ReadingRestoreResult { added: number; skipped: number; conflicts: number }

/** Content-addressed fallback IDs keep repeated imports idempotent, including conflicts. */
async function prepareItems<T extends { id: string }>(items: T[]) {
  if (!globalThis.crypto?.subtle) throw new Error("阅读备份需要 HTTPS 或本地安装版的安全环境");
  return Promise.all(items.map(async (item) => {
    const signature = itemContent(item);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
    const suffix = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return { item, signature, fallbackId: `reading-backup-${suffix}` };
  }));
}

export async function restoreReadingSnapshot<E extends ReadingEntryIdentity, H extends { id: string }, B extends { id: string }>(
  db: IDBDatabase, stores: ReadingStores, identity: ReadingEntryIdentity,
  highlights: H[], bookmarks: B[], updateEntry: (current: E) => E,
): Promise<ReadingRestoreResult> {
  // Hashing must finish before a readwrite transaction is opened.
  const [preparedHighlights, preparedBookmarks] = await Promise.all([prepareItems(highlights), prepareItems(bookmarks)]);
  const tx = db.transaction([stores.entry, stores.highlights, stores.bookmarks], "readwrite");
  const done = completed(tx);
  const result: ReadingRestoreResult = { added: 0, skipped: 0, conflicts: 0 };
  try {
    const entryStore = tx.objectStore(stores.entry);
    const current = await request<E | undefined>(entryStore.get(identity.id));
    if (!current || current.size !== identity.size || current.importedAt !== identity.importedAt) throw new Error("目标文件已变化，请重新预检");
    async function merge<T extends { id: string }>(name: string, items: Awaited<ReturnType<typeof prepareItems<T>>>) {
      const store = tx.objectStore(name);
      const local = await request<T[]>(store.index(stores.owner).getAll(identity.id));
      const signatures = new Set(local.map(itemContent));
      for (const { item, signature, fallbackId } of items) {
        if (signatures.has(signature)) { result.skipped++; continue; }
        let id = item.id;
        const existing = await request<T | undefined>(store.get(id));
        if (existing) {
          if ((existing as T & Record<string, unknown>)[stores.owner] === identity.id) result.conflicts++;
          id = fallbackId;
          let suffix = 0;
          while (await request(store.get(id))) id = `${fallbackId}-${++suffix}`;
        }
        store.add({ ...item, id, [stores.owner]: identity.id });
        signatures.add(signature);
        result.added++;
      }
    }
    await merge(stores.highlights, preparedHighlights);
    await merge(stores.bookmarks, preparedBookmarks);
    const updated = updateEntry(current);
    if (updated !== current) entryStore.put(updated);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already have aborted. */ }
    await done.catch(() => {});
    throw error;
  }
}
