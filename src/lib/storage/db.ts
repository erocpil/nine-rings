/**
 * db.ts — IndexedDB 底层基础设施：连接管理 + Promise 化原语。
 *
 * 被 idb.ts / db-versions.ts / db-images.ts 共享，独立成模块以避免
 * 版本历史等子模块与 idb.ts 之间形成循环依赖。
 */

import { IDB_DATABASE_VERSION, IDB_STORES } from "../../types/schema_gen";

const DB_NAME = "nine_rings";

// ── 数据库初始化 ──

let _dbOpenPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbOpenPromise) return _dbOpenPromise;

  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let expired = false;
    // 5 秒超时保护：Chrome 移动端 IndexedDB 偶发 hang
    const timeout = setTimeout(() => {
      expired = true;
      _dbOpenPromise = null;
      reject(new Error("IndexedDB open timeout"));
    }, 5000);

    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, IDB_DATABASE_VERSION);
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction!;
      for (const [storeName, definition] of Object.entries(IDB_STORES)) {
        const store = db.objectStoreNames.contains(storeName)
          ? tx.objectStore(storeName)
          : db.createObjectStore(storeName, { keyPath: definition.keyPath });
        for (const index of definition.indexes) {
          if (!store.indexNames.contains(index.name)) {
            store.createIndex(index.name, index.keyPath, { unique: false });
          }
        }
      }
    };
    req.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) {
        req.result.close();
        return;
      }
      const invalidate = () => {
        req.result.close();
        if (_dbOpenPromise === attempt) _dbOpenPromise = null;
      };
      req.result.onversionchange = invalidate;
      req.result.onclose = invalidate;
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timeout);
      if (_dbOpenPromise === attempt) _dbOpenPromise = null;
      reject(req.error || new Error("IndexedDB open failed"));
    };
    req.onblocked = () => {
      console.warn("[IDB] blocked — another connection is open");
    };
  });

  _dbOpenPromise = attempt;
  void attempt.catch(() => {
    if (_dbOpenPromise === attempt) _dbOpenPromise = null;
  });
  return attempt;
}

export function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.addEventListener("complete", () => resolve(), { once: true });
    tx.addEventListener(
      "abort",
      () => reject(tx.error ?? new Error("数据库事务已取消")),
      { once: true },
    );
  });
}

export async function withDB<T>(
  fn: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  const db = await openDB();
  // Track transactions per operation, never mutate the shared connection. Request
  // success is not commit success. Keep request helpers usable inside transactions.
  const writes: { tx: IDBTransaction; done: Promise<void> }[] = [];
  const scoped = new Proxy(db, {
    get(target, key) {
      if (key === "transaction")
        return (...args: Parameters<IDBDatabase["transaction"]>) => {
          const tx = target.transaction(...args);
          if (tx.mode === "readwrite") {
            const done = transactionDone(tx);
            void done.catch(() => {});
            writes.push({ tx, done });
          }
          return tx;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    const result = await fn(scoped);
    await Promise.all(writes.map(({ done }) => done));
    return result;
  } catch (error) {
    for (const { tx } of writes) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
    }
    await Promise.allSettled(writes.map(({ done }) => done));
    throw error;
  }
}

export function getOne<T>(
  store: IDBObjectStore,
  key: IDBValidKey,
): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export function getAll<T>(
  store: IDBObjectStore,
  query?: IDBValidKey | IDBKeyRange,
  count?: number,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll(query, count);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getAllFromIndex<T>(
  index: IDBIndex,
  range?: IDBValidKey | IDBKeyRange,
  count?: number,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = index.getAll(range, count);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function putRecord(store: IDBObjectStore, value: any): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function abortTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.onabort = () => resolve();
    tx.oncomplete = () => resolve();
    try {
      tx.abort();
    } catch {
      resolve();
    }
  });
}

export function delRecord(
  store: IDBObjectStore,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
