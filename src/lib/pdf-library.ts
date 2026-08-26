const PDF_DB_NAME = "nine_rings_pdf_library";
const PDF_DB_VERSION = 2;
const PDF_STORE = "documents";
const PDF_HIGHLIGHT_STORE = "highlights";
const PDF_BOOKMARK_STORE = "bookmarks";
const PDF_ID_INDEX = "pdfId";
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
  fitHeight?: boolean;
  viewMode?: "horizontal" | "vertical";
  pageCount?: number;
}

export interface LocalPdfHighlight {
  id: string;
  pdfId: string;
  page: number;
  start: number;
  end: number;
  text: string;
  kind?: "highlight" | "underline" | "strikeout" | "freeText" | "square" | "circle" | "line" | "arrow";
  color: string;
  note?: string;
  rect?: { x: number; y: number; width: number; height: number };
  points?: { x1: number; y1: number; x2: number; y2: number };
  fontSize?: number;
  createdAt: string;
  updatedAt?: string;
}

export interface LocalPdfBookmark {
  id: string;
  pdfId: string;
  page: number;
  label: string;
  createdAt: string;
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
      if (!database.objectStoreNames.contains(PDF_HIGHLIGHT_STORE)) {
        const highlights = database.createObjectStore(PDF_HIGHLIGHT_STORE, { keyPath: "id" });
        highlights.createIndex(PDF_ID_INDEX, PDF_ID_INDEX, { unique: false });
      }
      if (!database.objectStoreNames.contains(PDF_BOOKMARK_STORE)) {
        const bookmarks = database.createObjectStore(PDF_BOOKMARK_STORE, { keyPath: "id" });
        bookmarks.createIndex(PDF_ID_INDEX, PDF_ID_INDEX, { unique: false });
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
    fitHeight: record.fitHeight,
    viewMode: record.viewMode,
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
    fitHeight: false,
    viewMode: "horizontal",
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
  progress: Pick<LocalPdfEntry, "page" | "zoom"> & {
    fitWidth?: boolean;
    fitHeight?: boolean;
    viewMode?: "horizontal" | "vertical";
    pageCount?: number;
  },
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
    fitHeight: progress.fitHeight ?? record.fitHeight,
    viewMode: progress.viewMode ?? record.viewMode,
    pageCount: progress.pageCount ?? record.pageCount,
    lastOpenedAt: new Date().toISOString(),
  });
  await done;
}

export async function listLocalPdfHighlights(pdfId: string): Promise<LocalPdfHighlight[]> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_HIGHLIGHT_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult<LocalPdfHighlight[]>(
    transaction.objectStore(PDF_HIGHLIGHT_STORE).index(PDF_ID_INDEX).getAll(pdfId),
  );
  await done;
  return records
    .map((record) => ({ ...record, kind: record.kind ?? "highlight", color: record.color || "#ffd600" }))
    .sort((left, right) => left.page - right.page || left.start - right.start);
}

export async function addLocalPdfHighlight(
  input: Pick<LocalPdfHighlight, "pdfId" | "page" | "start" | "end" | "text"> & Partial<Pick<LocalPdfHighlight, "kind" | "color" | "note">>,
): Promise<LocalPdfHighlight> {
  if (input.start < 0 || input.end <= input.start || !input.text.trim()) throw new Error("PDF 高亮范围无效");
  const highlight: LocalPdfHighlight = {
    ...input,
    id: createId(),
    page: Math.max(1, Math.round(input.page)),
    text: input.text.trim().slice(0, 20_000),
    kind: input.kind ?? "highlight",
    color: input.color ?? "#ffd600",
    createdAt: new Date().toISOString(),
  };
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_HIGHLIGHT_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_HIGHLIGHT_STORE).put(highlight);
  await done;
  return highlight;
}

export async function addLocalPdfAnnotation(
  input: Omit<LocalPdfHighlight, "id" | "createdAt" | "updatedAt">,
): Promise<LocalPdfHighlight> {
  if (input.page < 1) throw new Error("PDF 批注页码无效");
  if (input.kind === "freeText" && (!input.rect || !input.text.trim())) throw new Error("PDF 文本批注无效");
  if ((input.kind === "square" || input.kind === "circle") && !input.rect) throw new Error("PDF 图形批注无效");
  if ((input.kind === "line" || input.kind === "arrow") && !input.points) throw new Error("PDF 线条批注无效");
  const timestamp = new Date().toISOString();
  const annotation: LocalPdfHighlight = {
    ...input,
    id: createId(),
    page: Math.max(1, Math.round(input.page)),
    text: input.text.slice(0, 20_000),
    note: input.note?.slice(0, 20_000),
    color: input.color || "#ffd600",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_HIGHLIGHT_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_HIGHLIGHT_STORE).put(annotation);
  await done;
  return annotation;
}

export async function updateLocalPdfHighlight(
  id: string,
  changes: Partial<Pick<LocalPdfHighlight, "color" | "note" | "text" | "rect" | "points" | "fontSize">>,
): Promise<LocalPdfHighlight> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_HIGHLIGHT_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(PDF_HIGHLIGHT_STORE);
  const current = await requestResult<LocalPdfHighlight | undefined>(store.get(id));
  if (!current) throw new Error("PDF 批注不存在");
  const updated = { ...current, ...changes, id: current.id, updatedAt: new Date().toISOString() };
  store.put(updated);
  await done;
  return updated;
}

export async function deleteLocalPdfHighlight(id: string): Promise<void> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_HIGHLIGHT_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_HIGHLIGHT_STORE).delete(id);
  await done;
}

export async function listLocalPdfBookmarks(pdfId: string): Promise<LocalPdfBookmark[]> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_BOOKMARK_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult<LocalPdfBookmark[]>(
    transaction.objectStore(PDF_BOOKMARK_STORE).index(PDF_ID_INDEX).getAll(pdfId),
  );
  await done;
  return records.sort((left, right) => left.page - right.page || left.createdAt.localeCompare(right.createdAt));
}

export async function addLocalPdfBookmark(
  pdfId: string,
  page: number,
  label: string,
): Promise<LocalPdfBookmark> {
  const bookmark: LocalPdfBookmark = {
    id: createId(),
    pdfId,
    page: Math.max(1, Math.round(page)),
    label: label.trim().slice(0, 160) || `第 ${Math.max(1, Math.round(page))} 页`,
    createdAt: new Date().toISOString(),
  };
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_BOOKMARK_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_BOOKMARK_STORE).put(bookmark);
  await done;
  return bookmark;
}

export async function deleteLocalPdfBookmark(id: string): Promise<void> {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_BOOKMARK_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_BOOKMARK_STORE).delete(id);
  await done;
}

export async function deleteLocalPdf(id: string): Promise<void> {
  const database = await openPdfDatabase();
  const transaction = database.transaction([PDF_STORE, PDF_HIGHLIGHT_STORE, PDF_BOOKMARK_STORE], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_STORE).delete(id);
  for (const storeName of [PDF_HIGHLIGHT_STORE, PDF_BOOKMARK_STORE]) {
    const store = transaction.objectStore(storeName);
    const keys = await requestResult<IDBValidKey[]>(store.index(PDF_ID_INDEX).getAllKeys(id));
    keys.forEach((key) => store.delete(key));
  }
  await done;
}

/** 仅供测试关闭连接并允许重新初始化 fake-indexeddb。 */
export async function resetPdfLibraryConnectionForTests(): Promise<void> {
  const database = await openPromise?.catch(() => null);
  database?.close();
  openPromise = null;
}
