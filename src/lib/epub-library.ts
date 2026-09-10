import { normalizeEpubWidth } from "./reader-width";
import { EpubBookCache } from "./epub-book-cache";
import { unzip, unzipSync, type Unzipped } from "fflate";
import { canonicalReadingItem, readReadingSnapshot, restoreReadingSnapshot } from "./reading-backup-store";
import { fingerprintReadingFile, validateReadingBackup, type EpubReadingBackup } from "./reading-backup-format";

const EPUB_DB_NAME = "nine_rings_epub_library";
const EPUB_DB_VERSION = 3;
const EPUB_STORE = "books";
const EPUB_FILE_STORE = "files";
const EPUB_HIGHLIGHT_STORE = "highlights";
const EPUB_BOOKMARK_STORE = "bookmarks";
const EPUB_ID_INDEX = "epubId";
export const MAX_LOCAL_EPUB_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_EPUB_BYTES = 300 * 1024 * 1024;
const MAX_EPUB_FILE_COUNT = 10_000;

export interface LocalEpubEntry {
  id: string;
  name: string;
  title: string;
  author?: string;
  language?: string;
  size: number;
  mimeType: string;
  importedAt: string;
  lastOpenedAt: string;
  chapter: number;
  chapterCount: number;
  location?: string;
  scrollProgress?: number;
  chapterProgress?: Record<string, number>;
  contentWidth?: number;
  fontSize: number;
  theme: "light" | "sepia" | "dark";
  themeBackgrounds?: Partial<Record<"light" | "sepia" | "dark", string>>;
  smartLineMerge?: boolean;
  manualLineMerges?: LocalEpubLineMerge[];
  hasCover?: boolean;
}

export interface LocalEpubLineMerge {
  id: string;
  chapterPath: string;
  left: string;
  right: string;
  createdAt: string;
}

interface StoredEpubRecord extends LocalEpubEntry {
  // Legacy v1/v2 data. Converted on first successful read, never discarded on failure.
  blob?: Blob;
  coverBlob?: Blob;
}

interface StoredEpubFile {
  id: string;
  bytes: ArrayBuffer;
  coverBytes?: Uint8Array;
  coverType?: string;
}

const parsedBooks = new EpubBookCache();
const bookOperations = new Map<string, Promise<unknown>>();

function withBookOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = bookOperations.get(id) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(operation);
  bookOperations.set(id, task);
  void task.finally(() => {
    if (bookOperations.get(id) === task) bookOperations.delete(id);
  }).catch(() => {});
  return task;
}

export interface EpubTextAnchor {
  chapterPath: string;
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
}

export interface LocalEpubHighlight {
  id: string;
  epubId: string;
  anchor: EpubTextAnchor;
  color: string;
  note?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface LocalEpubBookmark {
  id: string;
  epubId: string;
  chapter: number;
  chapterPath: string;
  scrollProgress: number;
  label: string;
  createdAt: string;
}

export interface EpubChapter {
  id: string;
  path: string;
  mediaType: string;
  title: string;
}

export interface EpubTocItem {
  label: string;
  href: string;
  path: string;
  fragment?: string;
  children: EpubTocItem[];
}

export interface ParsedEpub {
  title: string;
  author?: string;
  language?: string;
  chapters: EpubChapter[];
  toc: EpubTocItem[];
  files: Unzipped;
  cover?: { path: string; mediaType: string };
}

let openPromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("EPUB 资料库操作失败"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("EPUB 资料库事务失败"));
    transaction.onabort = () => reject(transaction.error ?? new Error("EPUB 资料库事务已取消"));
  });
}

function openEpubDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  const attempt = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(EPUB_DB_NAME, EPUB_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EPUB_STORE)) {
        request.result.createObjectStore(EPUB_STORE, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(EPUB_FILE_STORE)) {
        request.result.createObjectStore(EPUB_FILE_STORE, { keyPath: "id" });
      }
      for (const storeName of [EPUB_HIGHLIGHT_STORE, EPUB_BOOKMARK_STORE]) {
        if (!request.result.objectStoreNames.contains(storeName)) {
          const store = request.result.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex(EPUB_ID_INDEX, EPUB_ID_INDEX, { unique: false });
        }
      }
    };
    request.onsuccess = () => {
      if (openPromise !== attempt) {
        request.result.close();
        return;
      }
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        if (openPromise === attempt) openPromise = null;
      };
      database.onclose = () => {
        if (openPromise === attempt) openPromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      if (openPromise === attempt) openPromise = null;
      reject(request.error ?? new Error("EPUB 资料库打开失败"));
    };
    request.onblocked = () => {
      if (openPromise === attempt) openPromise = null;
      reject(new Error("EPUB 资料库正在被另一个窗口占用"));
    };
  });
  openPromise = attempt;
  return attempt;
}

function publicEntry(record: StoredEpubRecord): LocalEpubEntry {
  const { blob: _blob, coverBlob: _coverBlob, ...entry } = record;
  return entry;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `epub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeArchivePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function directoryOf(path: string): string {
  const normalized = normalizeArchivePath(path);
  const slash = normalized.lastIndexOf("/");
  return slash < 0 ? "" : normalized.slice(0, slash + 1);
}

export function resolveEpubPath(baseFile: string, href: string): { path: string; fragment?: string } {
  const [rawPath, fragment] = href.split("#", 2);
  let decoded = rawPath;
  try { decoded = decodeURIComponent(rawPath); } catch { /* Keep malformed paths readable. */ }
  return {
    path: !decoded
      ? normalizeArchivePath(baseFile)
      : normalizeArchivePath(decoded.startsWith("/") ? decoded : `${directoryOf(baseFile)}${decoded}`),
    fragment: fragment || undefined,
  };
}

function xmlDocument(bytes: Uint8Array, label: string): XMLDocument {
  const text = new TextDecoder().decode(bytes);
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) throw new Error(`${label} XML 无法解析`);
  return document;
}

function localNameElements(root: ParentNode, name: string): Element[] {
  return [...root.querySelectorAll("*")].filter((element) => element.localName === name);
}

function firstLocalText(root: ParentNode, name: string): string | undefined {
  return localNameElements(root, name)[0]?.textContent?.trim() || undefined;
}

function parseNavItems(list: Element, navPath: string): EpubTocItem[] {
  return [...list.children].filter((child) => child.localName === "li").flatMap((item) => {
    const anchor = [...item.children].find((child) => child.localName === "a");
    const nested = [...item.children].find((child) => child.localName === "ol");
    if (!anchor?.getAttribute("href")) return nested ? parseNavItems(nested, navPath) : [];
    const href = anchor.getAttribute("href")!;
    const target = resolveEpubPath(navPath, href);
    return [{
      label: anchor.textContent?.trim() || href,
      href,
      path: target.path,
      fragment: target.fragment,
      children: nested ? parseNavItems(nested, navPath) : [],
    }];
  });
}

function parseNavigation(files: Unzipped, navPath?: string, ncxPath?: string): EpubTocItem[] {
  if (navPath && files[navPath]) {
    const document = xmlDocument(files[navPath], "EPUB 目录");
    const nav = localNameElements(document, "nav").find((element) => {
      const type = element.getAttribute("epub:type") ?? element.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? "";
      return type.split(/\s+/).includes("toc") || element.getAttribute("role") === "doc-toc";
    }) ?? localNameElements(document, "nav")[0];
    const list = nav && localNameElements(nav, "ol")[0];
    if (list) return parseNavItems(list, navPath);
  }
  if (ncxPath && files[ncxPath]) {
    const document = xmlDocument(files[ncxPath], "EPUB NCX 目录");
    const parsePoints = (root: Element): EpubTocItem[] => [...root.children]
      .filter((child) => child.localName === "navPoint")
      .flatMap((point) => {
        const source = localNameElements(point, "content")[0]?.getAttribute("src");
        if (!source) return [];
        const target = resolveEpubPath(ncxPath, source);
        return [{
          label: firstLocalText(localNameElements(point, "navLabel")[0] ?? point, "text") ?? source,
          href: source,
          path: target.path,
          fragment: target.fragment,
          children: parsePoints(point),
        }];
      });
    const navMap = localNameElements(document, "navMap")[0];
    if (navMap) return parsePoints(navMap);
  }
  return [];
}

function parseEpubFiles(files: Unzipped): ParsedEpub {
  const containerPath = "META-INF/container.xml";
  if (!files[containerPath]) throw new Error("EPUB 缺少 META-INF/container.xml");
  const container = xmlDocument(files[containerPath], "EPUB container");
  const packagePath = localNameElements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!packagePath) throw new Error("EPUB 未声明内容包");
  const opfPath = normalizeArchivePath(packagePath);
  if (!files[opfPath]) throw new Error("EPUB 内容包不存在");
  const packageDocument = xmlDocument(files[opfPath], "EPUB OPF");

  const manifest = new Map<string, { id: string; path: string; mediaType: string; properties: string }>();
  for (const item of localNameElements(packageDocument, "item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      path: resolveEpubPath(opfPath, href).path,
      mediaType: item.getAttribute("media-type") || "application/octet-stream",
      properties: item.getAttribute("properties") || "",
    });
  }

  const spine = localNameElements(packageDocument, "spine")[0];
  const chapters = (spine ? localNameElements(spine, "itemref") : []).flatMap((itemref, index) => {
    const item = manifest.get(itemref.getAttribute("idref") ?? "");
    if (!item || !files[item.path]) return [];
    return [{ id: item.id, path: item.path, mediaType: item.mediaType, title: `第 ${index + 1} 章` }];
  });
  if (chapters.length === 0) throw new Error("EPUB 没有可阅读的章节");

  const navPath = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("nav"))?.path;
  const ncxId = spine?.getAttribute("toc") ?? undefined;
  const ncxPath = (ncxId ? manifest.get(ncxId)?.path : undefined)
    ?? [...manifest.values()].find((item) => item.mediaType === "application/x-dtbncx+xml")?.path;
  const toc = parseNavigation(files, navPath, ncxPath);
  const coverItem = [...manifest.values()].find((item) => item.properties.split(/\s+/).includes("cover-image"))
    ?? (() => {
      const coverId = localNameElements(packageDocument, "meta").find((item) => item.getAttribute("name") === "cover")?.getAttribute("content");
      return coverId ? manifest.get(coverId) : undefined;
    })();
  const titleByPath = new Map<string, string>();
  const indexToc = (items: EpubTocItem[]) => items.forEach((item) => {
    if (!titleByPath.has(item.path)) titleByPath.set(item.path, item.label);
    indexToc(item.children);
  });
  indexToc(toc);
  chapters.forEach((chapter) => { chapter.title = titleByPath.get(chapter.path) ?? chapter.title; });

  return {
    title: firstLocalText(packageDocument, "title") ?? "未命名 EPUB",
    author: firstLocalText(packageDocument, "creator"),
    language: firstLocalText(packageDocument, "language"),
    chapters,
    toc,
    files,
    cover: coverItem && files[coverItem.path] ? { path: coverItem.path, mediaType: coverItem.mediaType } : undefined,
  };
}

export function parseEpubArchive(buffer: ArrayBuffer): ParsedEpub {
  let expandedBytes = 0;
  let fileCount = 0;
  try {
    const files = unzipSync(new Uint8Array(buffer), { filter: (file) => {
      expandedBytes += file.originalSize;
      fileCount += 1;
      if (expandedBytes > MAX_EXPANDED_EPUB_BYTES || fileCount > MAX_EPUB_FILE_COUNT) {
        throw new Error("EPUB 解压后体积或文件数量超过安全限制");
      }
      return true;
    } });
    return parseEpubFiles(files);
  } catch (reason) {
    if (reason instanceof Error && reason.message.startsWith("EPUB ")) throw reason;
    throw new Error("EPUB 压缩包已损坏或格式不受支持");
  }
}

export function parseEpubArchiveAsync(buffer: ArrayBuffer): Promise<ParsedEpub> {
  return new Promise((resolve, reject) => {
    let expandedBytes = 0;
    let fileCount = 0;
    let limitExceeded = false;
    let terminate: (() => void) | undefined;
    const timer = setTimeout(() => {
      terminate?.();
      reject(new Error("EPUB 解析超时，请重试打开"));
    }, 30_000);
    try { terminate = unzip(new Uint8Array(buffer), { filter: (file) => {
      expandedBytes += file.originalSize;
      fileCount += 1;
      limitExceeded ||= expandedBytes > MAX_EXPANDED_EPUB_BYTES || fileCount > MAX_EPUB_FILE_COUNT;
      return !limitExceeded;
    } }, (error, files) => {
      clearTimeout(timer);
      if (limitExceeded) {
        reject(new Error("EPUB 解压后体积或文件数量超过安全限制"));
        return;
      }
      if (error) {
        reject(new Error("EPUB 压缩包已损坏或格式不受支持"));
        return;
      }
      try { resolve(parseEpubFiles(files)); }
      catch (reason) { reject(reason); }
    }); } catch (reason) { clearTimeout(timer); reject(reason); }
  });
}

async function assertEpubFile(file: File): Promise<{ parsed: ParsedEpub; bytes: ArrayBuffer }> {
  if (file.size <= 0) throw new Error("EPUB 文件为空");
  if (file.size > MAX_LOCAL_EPUB_BYTES) throw new Error("第一版仅支持 100 MiB 以内的 EPUB");
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error("所选文件不是有效的 EPUB");
  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < file.size * 1.3) {
    throw new Error("浏览器本地存储空间不足，无法保存此 EPUB");
  }
  const bytes = await file.arrayBuffer();
  return { parsed: await parseEpubArchiveAsync(bytes.slice(0)), bytes };
}

export async function importLocalEpub(file: File): Promise<LocalEpubEntry> {
  const { parsed, bytes } = await assertEpubFile(file);
  const timestamp = new Date().toISOString();
  const record: StoredEpubRecord = {
    id: createId(),
    name: file.name || "未命名.epub",
    title: parsed.title,
    author: parsed.author,
    language: parsed.language,
    size: file.size,
    mimeType: file.type || "application/epub+zip",
    importedAt: timestamp,
    lastOpenedAt: timestamp,
    chapter: 0,
    chapterCount: parsed.chapters.length,
    chapterProgress: { [parsed.chapters[0].path]: 0 },
    fontSize: 100,
    theme: "light",
    smartLineMerge: false,
    hasCover: Boolean(parsed.cover),
  };
  const database = await openEpubDatabase();
  const transaction = database.transaction([EPUB_STORE, EPUB_FILE_STORE], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(EPUB_STORE).put(record);
  transaction.objectStore(EPUB_FILE_STORE).put({
    id: record.id, bytes,
    coverBytes: parsed.cover ? parsed.files[parsed.cover.path] : undefined,
    coverType: parsed.cover?.mediaType,
  } satisfies StoredEpubFile);
  await done;
  void globalThis.navigator?.storage?.persist?.().catch(() => false);
  return publicEntry(record);
}

export async function listLocalEpubs(): Promise<LocalEpubEntry[]> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult<StoredEpubRecord[]>(transaction.objectStore(EPUB_STORE).getAll());
  await done;
  return records.map(publicEntry).sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

async function readStoredEpub(id: string): Promise<{ entry: LocalEpubEntry; file: StoredEpubFile } | null> {
  const database = await openEpubDatabase();
  const transaction = database.transaction([EPUB_STORE, EPUB_FILE_STORE], "readonly");
  const done = transactionDone(transaction);
  const [record, file] = await Promise.all([
    requestResult<StoredEpubRecord | undefined>(transaction.objectStore(EPUB_STORE).get(id)),
    requestResult<StoredEpubFile | undefined>(transaction.objectStore(EPUB_FILE_STORE).get(id)),
  ]);
  await done;
  if (!record) return null;
  if (file) return { entry: publicEntry(record), file };
  if (!record.blob) throw new Error("读取 EPUB 原文件失败：本地原文件不存在，请从原文件重新导入；阅读记录仍保留。");

  // Read the complete bytes before opening a write transaction. Reusing an
  // IDB-backed Blob in every progress write can retain an invalid file handle.
  let bytes: ArrayBuffer;
  try { bytes = await record.blob.arrayBuffer(); }
  catch (reason) {
    const detail = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    throw new Error(`读取 EPUB 原文件失败：${detail}。请重试；若仍失败，请从原文件重新导入，现有阅读记录不会被删除。`);
  }
  if (bytes.byteLength !== record.size) throw new Error("读取 EPUB 原文件失败：文件长度与记录不一致，原记录已保留，请从原文件重新导入。");
  // Recover the cover from the readable archive if its legacy Blob is broken.
  let coverBytes: Uint8Array | undefined;
  let coverType = record.coverBlob?.type;
  try { if (record.coverBlob) coverBytes = new Uint8Array(await record.coverBlob.arrayBuffer()); }
  catch { /* The archive below is authoritative. */ }
  if (record.hasCover && !coverBytes) {
    const parsed = await parseEpubArchiveAsync(bytes.slice(0));
    if (parsed.cover) {
      coverBytes = parsed.files[parsed.cover.path];
      coverType = parsed.cover.mediaType;
    }
  }
  const converted: StoredEpubFile = { id, bytes, coverBytes, coverType };
  const migration = database.transaction([EPUB_STORE, EPUB_FILE_STORE], "readwrite");
  const migrated = transactionDone(migration);
  const store = migration.objectStore(EPUB_STORE);
  // Another tab may have updated progress or deleted the book while reading bytes.
  const latest = await requestResult<StoredEpubRecord | undefined>(store.get(id));
  if (!latest) { await migrated; return null; }
  migration.objectStore(EPUB_FILE_STORE).put(converted);
  store.put(publicEntry(latest));
  await migrated;
  return { entry: publicEntry(latest), file: converted };
}

export function getLocalEpub(id: string): Promise<{ entry: LocalEpubEntry; blob: Blob } | null> {
  return withBookOperation(id, async () => {
    const stored = await readStoredEpub(id);
    return stored ? { entry: stored.entry, blob: new Blob([stored.file.bytes], { type: stored.entry.mimeType }) } : null;
  });
}

/** Each open reads fresh progress, but shares immutable parsed archive data. */
export function loadLocalEpub(id: string) {
  return withBookOperation(id, async () => {
    const stored = await readStoredEpub(id);
    if (!stored) throw new Error("EPUB 不存在或已经被删除");
    const book = await parsedBooks.load(id, async () => {
      try { return await parseEpubArchiveAsync(stored.file.bytes.slice(0)); }
      catch (reason) {
        throw new Error(`解析 EPUB 内容失败：${reason instanceof Error ? reason.message : String(reason)}`);
      }
    });
    const release = () => withBookOperation(id, async () => {
      const database = await openEpubDatabase();
      const tx = database.transaction(EPUB_STORE, "readonly");
      const done = transactionDone(tx);
      const current = await requestResult<StoredEpubRecord | undefined>(tx.objectStore(EPUB_STORE).get(id));
      await done;
      if (current?.importedAt === stored.entry.importedAt && current.size === stored.entry.size) {
        parsedBooks.remember(id, book);
      }
    });
    return { entry: stored.entry, book, release };
  });
}

export async function getLocalEpubCover(id: string): Promise<Blob | null> {
  return withBookOperation(id, async () => {
    const stored = await readStoredEpub(id);
    return stored?.file.coverBytes ? new Blob([new Uint8Array(stored.file.coverBytes)], { type: stored.file.coverType }) : null;
  });
}

export async function listLocalEpubHighlights(epubId: string): Promise<LocalEpubHighlight[]> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_HIGHLIGHT_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult<LocalEpubHighlight[]>(transaction.objectStore(EPUB_HIGHLIGHT_STORE).index(EPUB_ID_INDEX).getAll(epubId));
  await done;
  return records.sort((left, right) => left.anchor.chapterPath.localeCompare(right.anchor.chapterPath) || left.anchor.start - right.anchor.start);
}

export async function addLocalEpubHighlight(epubId: string, anchor: EpubTextAnchor): Promise<LocalEpubHighlight> {
  if (!anchor.exact.trim() || anchor.end <= anchor.start) throw new Error("EPUB 高亮范围无效");
  const highlight: LocalEpubHighlight = {
    id: createId(), epubId, anchor, color: "#ffd54f", createdAt: new Date().toISOString(),
  };
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_HIGHLIGHT_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(EPUB_HIGHLIGHT_STORE).put(highlight);
  await done;
  return highlight;
}

export async function updateLocalEpubHighlight(id: string, changes: Partial<Pick<LocalEpubHighlight, "color" | "note">>): Promise<LocalEpubHighlight> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_HIGHLIGHT_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(EPUB_HIGHLIGHT_STORE);
  const current = await requestResult<LocalEpubHighlight | undefined>(store.get(id));
  if (!current) throw new Error("EPUB 高亮不存在");
  const updated = { ...current, ...changes, id: current.id, updatedAt: new Date().toISOString() };
  store.put(updated);
  await done;
  return updated;
}

export async function deleteLocalEpubHighlight(id: string): Promise<void> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_HIGHLIGHT_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(EPUB_HIGHLIGHT_STORE).delete(id);
  await done;
}

export async function listLocalEpubBookmarks(epubId: string): Promise<LocalEpubBookmark[]> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_BOOKMARK_STORE, "readonly");
  const done = transactionDone(transaction);
  const records = await requestResult<LocalEpubBookmark[]>(transaction.objectStore(EPUB_BOOKMARK_STORE).index(EPUB_ID_INDEX).getAll(epubId));
  await done;
  return records.sort((left, right) => left.chapter - right.chapter || left.scrollProgress - right.scrollProgress);
}

export async function addLocalEpubBookmark(input: Omit<LocalEpubBookmark, "id" | "createdAt">): Promise<LocalEpubBookmark> {
  const bookmark = { ...input, id: createId(), createdAt: new Date().toISOString() };
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_BOOKMARK_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(EPUB_BOOKMARK_STORE).put(bookmark);
  await done;
  return bookmark;
}

export async function deleteLocalEpubBookmark(id: string): Promise<void> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_BOOKMARK_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(EPUB_BOOKMARK_STORE).delete(id);
  await done;
}

export async function updateLocalEpubProgress(
  id: string,
  progress: Pick<LocalEpubEntry, "chapter" | "fontSize" | "theme" | "themeBackgrounds" | "smartLineMerge" | "manualLineMerges"> & { contentWidth?: number; location?: string; scrollProgress?: number; chapterProgress?: Record<string, number> },
): Promise<void> {
  return withBookOperation(id, async () => {
    const database = await openEpubDatabase();
    const transaction = database.transaction(EPUB_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(EPUB_STORE);
    const record = await requestResult<StoredEpubRecord | undefined>(store.get(id));
    if (!record) { await done; throw new Error("EPUB 已被删除"); }
    store.put({
      ...record,
      chapter: Math.max(0, Math.min(record.chapterCount - 1, Math.round(progress.chapter))),
      location: progress.location,
      scrollProgress: Math.max(0, Math.min(1, progress.scrollProgress ?? 0)),
      chapterProgress: Object.fromEntries(Object.entries(progress.chapterProgress ?? {})
        .filter(([path, value]) => Boolean(path) && Number.isFinite(value))
        .map(([path, value]) => [path, Math.max(0, Math.min(1, value))])),
      contentWidth: normalizeEpubWidth(progress.contentWidth ?? record.contentWidth),
      fontSize: Math.max(70, Math.min(180, Math.round(progress.fontSize))),
      theme: progress.theme,
      themeBackgrounds: progress.themeBackgrounds,
      smartLineMerge: Boolean(progress.smartLineMerge),
      manualLineMerges: progress.manualLineMerges ?? [],
      lastOpenedAt: new Date().toISOString(),
    });
    await done;
  });
}

export async function deleteLocalEpub(id: string): Promise<void> {
  return withBookOperation(id, async () => {
    const database = await openEpubDatabase();
    const transaction = database.transaction([EPUB_STORE, EPUB_FILE_STORE, EPUB_HIGHLIGHT_STORE, EPUB_BOOKMARK_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(EPUB_STORE).delete(id);
    transaction.objectStore(EPUB_FILE_STORE).delete(id);
    for (const storeName of [EPUB_HIGHLIGHT_STORE, EPUB_BOOKMARK_STORE]) {
      const index = transaction.objectStore(storeName).index(EPUB_ID_INDEX);
      const keys = await requestResult<IDBValidKey[]>(index.getAllKeys(id));
      keys.forEach((key) => transaction.objectStore(storeName).delete(key));
    }
    await done;
    parsedBooks.invalidate(id);
  });
}

export async function resetEpubLibraryConnectionForTests(): Promise<void> {
  await Promise.allSettled(bookOperations.values());
  parsedBooks.clear();
  const database = await openPromise?.catch(() => null);
  database?.close();
  openPromise = null;
}

const EPUB_READING_STORES = { entry: EPUB_STORE, highlights: EPUB_HIGHLIGHT_STORE, bookmarks: EPUB_BOOKMARK_STORE, owner: "epubId" as const };

export async function readLocalEpubReadingSnapshot(id: string) {
  return withBookOperation(id, async () => {
    const stored = await readStoredEpub(id);
    if (!stored) throw new Error("EPUB 已被删除");
    const snapshot = await readReadingSnapshot<StoredEpubRecord, LocalEpubHighlight, LocalEpubBookmark>(await openEpubDatabase(), EPUB_READING_STORES, id);
    return { ...snapshot, entry: { ...snapshot.entry, blob: new Blob([stored.file.bytes], { type: stored.entry.mimeType }) } };
  });
}

export async function restoreLocalEpubReadingBackup(id: string, backup: EpubReadingBackup, restoreProgress: boolean) {
  validateReadingBackup(backup);
  if (backup.format !== "epub") throw new Error("备份不是 EPUB 阅读数据");
  const snapshot = await readLocalEpubReadingSnapshot(id);
  if (snapshot.entry.size !== backup.file.size || await fingerprintReadingFile(snapshot.entry.blob) !== backup.file.fingerprint) throw new Error("原文件内容不一致，不能恢复这份阅读备份");
  if (snapshot.entry.chapterCount !== backup.progress.chapterCount) throw new Error("章节结构不一致，不能恢复");
  let lineMergesAdded = 0;
  const result = await restoreReadingSnapshot<StoredEpubRecord, LocalEpubHighlight, LocalEpubBookmark>(
    await openEpubDatabase(), EPUB_READING_STORES, snapshot.entry, backup.highlights, backup.bookmarks,
    (current) => {
      const merges = [...(current.manualLineMerges ?? [])];
      const signature = ({ id: _id, ...item }: LocalEpubLineMerge) => canonicalReadingItem(item);
      const signatures = new Set(merges.map(signature));
      const ids = new Set(merges.map((merge) => merge.id));
      for (const item of backup.manualLineMerges) {
        if (signatures.has(signature(item))) continue;
        let id = item.id;
        let suffix = 0;
        while (ids.has(id)) id = `${item.id}-restored-${++suffix}`;
        merges.push({ ...item, id }); ids.add(id); signatures.add(signature(item)); lineMergesAdded++;
      }
      const updated = lineMergesAdded ? { ...current, manualLineMerges: merges } : current;
      if (!restoreProgress) return updated;
      const progress = backup.progress;
      return {
        ...updated, chapter: progress.chapter, location: progress.location,
        scrollProgress: progress.scrollProgress, chapterProgress: progress.chapterProgress,
        contentWidth: normalizeEpubWidth(progress.contentWidth),
        fontSize: progress.fontSize, theme: progress.theme, themeBackgrounds: progress.themeBackgrounds,
        smartLineMerge: progress.smartLineMerge, lastOpenedAt: new Date().toISOString(),
      };
    },
  );
  return { ...result, lineMergesAdded };
}
