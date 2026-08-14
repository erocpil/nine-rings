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
let _dbOpenError: Error | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbOpenError) return Promise.reject(_dbOpenError);
  if (_dbOpenPromise) return _dbOpenPromise;

  _dbOpenPromise = new Promise((resolve, reject) => {
    // 5 秒超时保护：Chrome 移动端 IndexedDB 偶发 hang
    const timeout = setTimeout(() => {
      _dbOpenError = new Error("IndexedDB open timeout");
      reject(_dbOpenError);
    }, 5000);

    const req = indexedDB.open(DB_NAME, IDB_DATABASE_VERSION);
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
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timeout);
      _dbOpenError = req.error || new Error("IndexedDB open failed");
      reject(_dbOpenError);
    };
    req.onblocked = () => {
      console.warn("[IDB] blocked — another connection is open");
    };
  });

  return _dbOpenPromise;
}

export async function withDB<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  const db = await openDB();
  // SPA: 保持连接打开，不 close()，避免 Safari 报 "connection is closing"
  return fn(db);
}

export function getOne<T>(store: IDBObjectStore, key: IDBValidKey): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export function getAll<T>(store: IDBObjectStore, query?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = store.getAll(query, count);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getAllFromIndex<T>(index: IDBIndex, range?: IDBValidKey | IDBKeyRange, count?: number): Promise<T[]> {
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

export function delRecord(store: IDBObjectStore, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
