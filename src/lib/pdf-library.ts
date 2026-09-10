import { normalizePdfWidth } from "./reader-width";
import { PdfFileCache } from "./pdf-file-cache";
import { readReadingSnapshot, restoreReadingSnapshot } from "./reading-backup-store";
import { fingerprintReadingFile, validateReadingBackup, type PdfReadingBackup } from "./reading-backup-format";

const PDF_DB_NAME = "nine_rings_pdf_library";
const PDF_DB_VERSION = 3;
const PDF_STORE = "documents";
const PDF_FILE_STORE = "files";
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
  lockedWidthRatio?: number | null;
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
  blob?: Blob; // Legacy files are migrated only after their bytes are readable.
}

const fileCache = new PdfFileCache();
const operations = new Map<string, Promise<unknown>>();
function withPdfOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const task = (operations.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
  operations.set(id, task);
  void task.finally(() => {
    if (operations.get(id) === task) operations.delete(id);
  }).catch(() => {});
  return task;
}
const fileKey = (entry: LocalPdfEntry) => `${entry.id}:${entry.importedAt}:${entry.size}`;

let openPromise: Promise<IDBDatabase> | null = null;

function openPdfDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    let expired = false;
    const fail = (error: unknown) => {
      expired = true;
      clearTimeout(timeout);
      if (openPromise === attempt) openPromise = null;
      reject(error);
    };
    const timeout = setTimeout(() => fail(new Error("PDF 资料库打开超时，请重试")), 5000);
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION); }
    catch (error) { clearTimeout(timeout); reject(error); return; }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PDF_STORE)) {
        database.createObjectStore(PDF_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(PDF_FILE_STORE)) {
        database.createObjectStore(PDF_FILE_STORE, { keyPath: "id" });
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
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (expired) { request.result.close(); return; }
      const invalidate = () => {
        request.result.close();
        if (openPromise === attempt) openPromise = null;
      };
      request.result.onversionchange = invalidate;
      request.result.onclose = invalidate;
      resolve(request.result);
    };
    request.onerror = () => fail(request.error ?? new Error("PDF 资料库打开失败"));
    request.onblocked = () => fail(new Error("PDF 资料库正在被另一个窗口占用"));
  });
  openPromise = attempt;
  void attempt.catch(() => { if (openPromise === attempt) openPromise = null; });
  return attempt;
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
    lockedWidthRatio: record.lockedWidthRatio,
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
  const bytes = await file.arrayBuffer();
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
  };
  const database = await openPdfDatabase();
  const transaction = database.transaction([PDF_STORE, PDF_FILE_STORE], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(PDF_STORE).put(record);
  transaction.objectStore(PDF_FILE_STORE).put({ id: record.id, bytes });
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

async function readPdfMetadata(id: string) {
  const database = await openPdfDatabase();
  const transaction = database.transaction(PDF_STORE, "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult<StoredPdfRecord | undefined>(transaction.objectStore(PDF_STORE).get(id));
  await done;
  return record;
}

async function readPdfSource(id: string): Promise<{ entry: LocalPdfEntry; bytes: ArrayBuffer } | null> {
  const record = await readPdfMetadata(id);
  if (!record) return null;
  const cached = fileCache.get(fileKey(record));
  if (cached) return { entry: publicEntry(record), bytes: cached };
  const database = await openPdfDatabase();
  const tx = database.transaction(PDF_FILE_STORE, "readonly");
  const done = transactionDone(tx);
  const file = await requestResult<{ bytes: ArrayBuffer } | undefined>(tx.objectStore(PDF_FILE_STORE).get(id));
  await done;
  let bytes = file?.bytes;
  if (!bytes) {
    if (!record.blob) throw new Error("读取 PDF 原文件失败：本地原文件不存在，阅读记录已保留。");
    try { bytes = await record.blob.arrayBuffer(); }
    catch (reason) {
      const detail = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
      throw new Error(`读取 PDF 原文件失败：${detail}。请重试；若仍失败，请从原文件重新导入，原阅读记录已保留。`);
    }
    if (bytes.byteLength !== record.size) throw new Error("读取 PDF 原文件失败：文件长度不一致，原记录已保留。");
    // Binary reads must finish before starting this atomic migration. Fetch
    // current metadata again to preserve another window's progress updates.
    const migration = database.transaction([PDF_STORE, PDF_FILE_STORE], "readwrite");
    const migrated = transactionDone(migration);
    const store = migration.objectStore(PDF_STORE);
    const latest = await requestResult<StoredPdfRecord | undefined>(store.get(id));
    if (!latest) { await migrated; return null; }
    migration.objectStore(PDF_FILE_STORE).put({ id, bytes });
    store.put(publicEntry(latest));
    await migrated;
    fileCache.remember(fileKey(latest), bytes);
    return { entry: publicEntry(latest), bytes };
  }
  fileCache.remember(fileKey(record), bytes);
  return { entry: publicEntry(record), bytes };
}

export function getLocalPdf(id: string): Promise<{ entry: LocalPdfEntry; blob: Blob } | null> {
  return withPdfOperation(id, async () => {
    const stored = await readPdfSource(id);
    return stored ? { entry: stored.entry, blob: new Blob([stored.bytes], { type: stored.entry.mimeType }) } : null;
  });
}

export function loadLocalPdf(id: string) {
  return withPdfOperation(id, async () => {
    const stored = await readPdfSource(id);
    if (!stored) throw new Error("PDF 不存在或已经被删除");
    const cacheable = stored.bytes.byteLength <= fileCache.budget;
    // PDF.js transfers ownership to its worker. A retained buffer must never
    // be handed over directly; oversized, uncached files need no extra copy.
    const data = cacheable ? stored.bytes.slice(0) : stored.bytes;
    const release = cacheable ? () => withPdfOperation(id, async () => {
      const current = await readPdfMetadata(id);
      if (current && fileKey(current) === fileKey(stored.entry)) fileCache.remember(fileKey(current), stored.bytes);
    }) : async () => {};
    return { entry: stored.entry, data, release };
  });
}

export async function updateLocalPdfProgress(
  id: string,
  progress: Pick<LocalPdfEntry, "page" | "zoom"> & {
    lockedWidthRatio?: number | null;
    fitWidth?: boolean;
    fitHeight?: boolean;
    viewMode?: "horizontal" | "vertical";
    pageCount?: number;
  },
): Promise<void> {
  return withPdfOperation(id, async () => {
    const database = await openPdfDatabase();
    const transaction = database.transaction(PDF_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(PDF_STORE);
    const record = await requestResult<StoredPdfRecord | undefined>(
      store.get(id),
    );
    if (!record) {
      await done;
      throw new Error("PDF 已被删除");
    }
    store.put({
      ...record,
      page: Math.max(1, Math.round(progress.page)),
      zoom: Math.max(0.25, Math.min(4, progress.zoom)),
      lockedWidthRatio:
        progress.lockedWidthRatio === undefined
          ? record.lockedWidthRatio
          : normalizePdfWidth(progress.lockedWidthRatio),
      fitWidth: progress.fitWidth ?? record.fitWidth,
      fitHeight: progress.fitHeight ?? record.fitHeight,
      viewMode: progress.viewMode ?? record.viewMode,
      pageCount: progress.pageCount ?? record.pageCount,
      lastOpenedAt: new Date().toISOString(),
    });
    await done;
  });
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
  return withPdfOperation(id, async () => {
    const record = await readPdfMetadata(id);
    const database = await openPdfDatabase();
    const transaction = database.transaction(
      [PDF_STORE, PDF_FILE_STORE, PDF_HIGHLIGHT_STORE, PDF_BOOKMARK_STORE],
      "readwrite",
    );
    const done = transactionDone(transaction);
    transaction.objectStore(PDF_STORE).delete(id);
    transaction.objectStore(PDF_FILE_STORE).delete(id);
    for (const storeName of [PDF_HIGHLIGHT_STORE, PDF_BOOKMARK_STORE]) {
      const store = transaction.objectStore(storeName);
      const keys = await requestResult<IDBValidKey[]>(
        store.index(PDF_ID_INDEX).getAllKeys(id),
      );
      keys.forEach((key) => store.delete(key));
    }
    await done;
    if (record) fileCache.delete(fileKey(record));
  });
}

const PDF_READING_STORES = { entry: PDF_STORE, highlights: PDF_HIGHLIGHT_STORE, bookmarks: PDF_BOOKMARK_STORE, owner: "pdfId" as const };

export async function readLocalPdfReadingSnapshot(id: string) {
  return withPdfOperation(id, async () => {
    const stored = await readPdfSource(id);
    if (!stored) throw new Error("PDF 已被删除");
    const snapshot = await readReadingSnapshot<StoredPdfRecord, LocalPdfHighlight, LocalPdfBookmark>(await openPdfDatabase(), PDF_READING_STORES, id);
    return { ...snapshot, entry: { ...snapshot.entry, blob: new Blob([stored.bytes], { type: stored.entry.mimeType }) } };
  });
}

export async function restoreLocalPdfReadingBackup(id: string, backup: PdfReadingBackup, restoreProgress: boolean) {
  validateReadingBackup(backup);
  if (backup.format !== "pdf") throw new Error("备份不是 PDF 阅读数据");
  const snapshot = await readLocalPdfReadingSnapshot(id);
  if (snapshot.entry.size !== backup.file.size || await fingerprintReadingFile(snapshot.entry.blob) !== backup.file.fingerprint) throw new Error("原文件内容不一致，不能恢复这份阅读备份");
  return restoreReadingSnapshot<StoredPdfRecord, LocalPdfHighlight, LocalPdfBookmark>(
    await openPdfDatabase(), PDF_READING_STORES, snapshot.entry, backup.highlights, backup.bookmarks,
    (current) => restoreProgress ? {
      ...current, page: backup.progress.page, zoom: backup.progress.zoom,
      lockedWidthRatio: normalizePdfWidth(backup.progress.lockedWidthRatio),
      fitWidth: backup.progress.fitWidth, fitHeight: backup.progress.fitHeight,
      viewMode: backup.progress.viewMode, pageCount: backup.progress.pageCount ?? current.pageCount,
      lastOpenedAt: new Date().toISOString(),
    } : current,
  );
}

/** 仅供测试关闭连接并允许重新初始化 fake-indexeddb。 */
export async function resetPdfLibraryConnectionForTests(): Promise<void> {
  await Promise.allSettled(operations.values());
  fileCache.clear();
  const database = await openPromise?.catch(() => null);
  database?.close();
  openPromise = null;
}
