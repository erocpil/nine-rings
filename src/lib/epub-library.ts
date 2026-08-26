import { unzip, unzipSync, type Unzipped } from "fflate";

const EPUB_DB_NAME = "nine_rings_epub_library";
const EPUB_DB_VERSION = 2;
const EPUB_STORE = "books";
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
  blob: Blob;
  coverBlob?: Blob;
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
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(EPUB_DB_NAME, EPUB_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(EPUB_STORE)) {
        request.result.createObjectStore(EPUB_STORE, { keyPath: "id" });
      }
      for (const storeName of [EPUB_HIGHLIGHT_STORE, EPUB_BOOKMARK_STORE]) {
        if (!request.result.objectStoreNames.contains(storeName)) {
          const store = request.result.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex(EPUB_ID_INDEX, EPUB_ID_INDEX, { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("EPUB 资料库打开失败"));
    request.onblocked = () => reject(new Error("EPUB 资料库正在被另一个窗口占用"));
  });
  return openPromise;
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
    unzip(new Uint8Array(buffer), { filter: (file) => {
      expandedBytes += file.originalSize;
      fileCount += 1;
      limitExceeded ||= expandedBytes > MAX_EXPANDED_EPUB_BYTES || fileCount > MAX_EPUB_FILE_COUNT;
      return !limitExceeded;
    } }, (error, files) => {
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
    });
  });
}

async function assertEpubFile(file: File): Promise<ParsedEpub> {
  if (file.size <= 0) throw new Error("EPUB 文件为空");
  if (file.size > MAX_LOCAL_EPUB_BYTES) throw new Error("第一版仅支持 100 MiB 以内的 EPUB");
  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (signature[0] !== 0x50 || signature[1] !== 0x4b) throw new Error("所选文件不是有效的 EPUB");
  const estimate = await globalThis.navigator?.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < file.size * 1.3) {
    throw new Error("浏览器本地存储空间不足，无法保存此 EPUB");
  }
  return parseEpubArchiveAsync(await file.arrayBuffer());
}

export async function importLocalEpub(file: File): Promise<LocalEpubEntry> {
  const parsed = await assertEpubFile(file);
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
    fontSize: 100,
    theme: "light",
    smartLineMerge: false,
    hasCover: Boolean(parsed.cover),
    blob: file,
    coverBlob: parsed.cover ? new Blob([parsed.files[parsed.cover.path]], { type: parsed.cover.mediaType }) : undefined,
  };
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_STORE, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(EPUB_STORE).put(record);
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

export async function getLocalEpub(id: string): Promise<{ entry: LocalEpubEntry; blob: Blob } | null> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_STORE, "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult<StoredEpubRecord | undefined>(transaction.objectStore(EPUB_STORE).get(id));
  await done;
  return record ? { entry: publicEntry(record), blob: record.blob } : null;
}

export async function getLocalEpubCover(id: string): Promise<Blob | null> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_STORE, "readonly");
  const done = transactionDone(transaction);
  const record = await requestResult<StoredEpubRecord | undefined>(transaction.objectStore(EPUB_STORE).get(id));
  await done;
  return record?.coverBlob ?? null;
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
  progress: Pick<LocalEpubEntry, "chapter" | "fontSize" | "theme" | "themeBackgrounds" | "smartLineMerge" | "manualLineMerges"> & { location?: string; scrollProgress?: number },
): Promise<void> {
  const database = await openEpubDatabase();
  const transaction = database.transaction(EPUB_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(EPUB_STORE);
  const record = await requestResult<StoredEpubRecord | undefined>(store.get(id));
  if (!record) throw new Error("EPUB 已被删除");
  store.put({
    ...record,
    chapter: Math.max(0, Math.min(record.chapterCount - 1, Math.round(progress.chapter))),
    location: progress.location,
    scrollProgress: Math.max(0, Math.min(1, progress.scrollProgress ?? 0)),
    fontSize: Math.max(70, Math.min(180, Math.round(progress.fontSize))),
    theme: progress.theme,
    themeBackgrounds: progress.themeBackgrounds,
    smartLineMerge: Boolean(progress.smartLineMerge),
    manualLineMerges: progress.manualLineMerges ?? [],
    lastOpenedAt: new Date().toISOString(),
  });
  await done;
}

export async function deleteLocalEpub(id: string): Promise<void> {
  const database = await openEpubDatabase();
  const transaction = database.transaction([EPUB_STORE, EPUB_HIGHLIGHT_STORE, EPUB_BOOKMARK_STORE], "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(EPUB_STORE).delete(id);
  for (const storeName of [EPUB_HIGHLIGHT_STORE, EPUB_BOOKMARK_STORE]) {
    const index = transaction.objectStore(storeName).index(EPUB_ID_INDEX);
    const keys = await requestResult<IDBValidKey[]>(index.getAllKeys(id));
    keys.forEach((key) => transaction.objectStore(storeName).delete(key));
  }
  await done;
}

export async function resetEpubLibraryConnectionForTests(): Promise<void> {
  const database = await openPromise?.catch(() => null);
  database?.close();
  openPromise = null;
}
