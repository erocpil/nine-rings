const PDF_DB_NAME = "nine_rings_pdf_library";
const PDF_DB_VERSION = 1;
const PDF_STORE = "documents";
export const MAX_LOCAL_PDF_BYTES = 250 * 1024 * 1024;

export interface LocalPdfEntry {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  importedAt: string;
  lastOpenedAt: string;
  page: number;
  zoom: number;
  fitWidth?: boolean;
  pageCount?: number;
}

interface StoredPdfRecord extends LocalPdfEntry {
  blob: Blob;
}

let openPromise: Promise<IDBDatabase> | null = null;

function openPdfDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PDF_STORE)) {
        database.createObjectStore(PDF_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("PDF 资料库打开失败"));
    request.onblocked = () => reject(new Error("PDF 资料库正在被另一个窗口占用"));
  });
  return openPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("PDF 资料库操作失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("PDF 资料库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("PDF 资料库事务已取消"));
  });
}

function publicEntry(record: StoredPdfRecord): LocalPdfEntry {
  return {
    id: record.id,
    name: record.name,
    size: record.size,
    mimeType: record.mimeType,
    importedAt: record.importedAt,
    lastOpenedAt: record.lastOpenedAt,
    page: record.page,
    zoom: record.zoom,
    fitWidth: record.fitWidth,
    pageCount: record.pageCount,
  };
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function assertPdfFile(file: File): Promise<void> {
  if (file.size <= 0) throw new Error("PDF 文件为空");
  if (file.size > MAX_LOCAL_PDF_BYTES) throw new Error("第一版仅支持 250 MiB 以内的 PDF");
  const header = new TextDecoder("latin1").decode(await file.slice(0, 1024).arrayBuffer());
  if (!header.includes("%PDF-")) throw new Error("所选文件不是有效的 PDF");

  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota !== undefined && estimate.usage !== undefined) {
    const available = estimate.quota - estimate.usage;
    if (available < file.size * 1.15) throw new Error("浏览器本地存储空间不足，无法保存此 PDF");
  }
}

export async function importLocalPdf(file: File): Promise<LocalPdfEntry> {
  await assertPdfFile(file);
  const timestamp = new Date().toISOString();
  const record: StoredPdfRecord = {
    id: createId(),
    name: file.name || "未命名.pdf",
    size: file.size,
    mimeType: file.type || "application/pdf",
    importedAt: timestamp,
    lastOpenedAt: timestamp,
    page: 1,
    zoom: 1,
    fitWidth: true,
    blob: file,
  };
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_STORE).put(record);
  await done;
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
  return publicEntry(record);
}

export async function listLocalPdfs(): Promise<LocalPdfEntry[]> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult<StoredPdfRecord[]>(transaction.objectStore(PDF_STORE).getAll());
  await done;
  return records
    .map(publicEntry)
    .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

export async function getLocalPdf(id: string): Promise<{ entry: LocalPdfEntry; blob: Blob } | null> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_STORE, "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult<StoredPdfRecord | undefined>(transaction.objectStore(PDF_STORE).get(id));
  await done;
  return record ? { entry: publicEntry(record), blob: record.blob } : null;
}

export async function updateLocalPdfProgress(
  id: string,
  progress: Pick<LocalPdfEntry, "page" | "zoom"> & { fitWidth?: boolean; pageCount?: number },
): Promise<void> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(PDF_STORE);
  const record = await requestResult<StoredPdfRecord | undefined>(store.get(id));
  if (!record) {
    await done;
    throw new Error("PDF 已被删除");
  }
  store.put({
    ...record,
    page: Math.max(1, Math.round(progress.page)),
    zoom: Math.max(0.25, Math.min(4, progress.zoom)),
    fitWidth: progress.fitWidth ?? record.fitWidth,
    pageCount: progress.pageCount ?? record.pageCount,
    lastOpenedAt: new Date().toISOString(),
  });
  await done;
}

export async function deleteLocalPdf(id: string): Promise<void> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_STORE).delete(id);
  await done;
}

/** 仅供测试关闭连接并允许重新初始化 fake-indexeddb。 */
export async function resetPdfLibraryConnectionForTests(): Promise<void> {
  const database = await openPromise?.catch(() => null);
  database?.close();
  openPromise = null;
}
