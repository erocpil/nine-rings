import type { LocalPdfEntry, LocalPdfHighlight, LocalPdfBookmark } from "./pdf-library";
import type { LocalEpubEntry, LocalEpubHighlight, LocalEpubBookmark, LocalEpubLineMerge } from "./epub-library";

export const MAX_READING_BACKUP_BYTES = 20 * 1024 * 1024;
export type PdfReadingProgress = Pick<LocalPdfEntry, "page" | "zoom" | "fitWidth" | "fitHeight" | "viewMode" | "pageCount" | "lockedWidthRatio" | "position">;
export type EpubReadingProgress = Pick<LocalEpubEntry, "chapter" | "chapterCount" | "location" | "scrollProgress" | "chapterProgress" | "fontSize" | "theme" | "themeBackgrounds" | "smartLineMerge" | "contentWidth">;
interface BaseBackup {
  kind: "nine-rings-reading-data";
  version: 1;
  exportedAt: string;
  file: { name: string; size: number; fingerprint: string; algorithm: "sha256-chunks-v1" };
}
export interface PdfReadingBackup extends BaseBackup {
  format: "pdf";
  progress: PdfReadingProgress;
  highlights: LocalPdfHighlight[];
  bookmarks: LocalPdfBookmark[];
}
export interface EpubReadingBackup extends BaseBackup {
  format: "epub";
  progress: EpubReadingProgress;
  highlights: LocalEpubHighlight[];
  bookmarks: LocalEpubBookmark[];
  manualLineMerges: LocalEpubLineMerge[];
}
export type ReadingBackup = PdfReadingBackup | EpubReadingBackup;

function invalid(): never { throw new Error("阅读备份格式或字段无效，未修改本地数据"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, limit = 20_000): asserts value is string {
  if (typeof value !== "string" || value.length > limit) invalid();
}
function id(value: unknown) { text(value, 512); if (!value.trim()) invalid(); }
function number(value: unknown, min: number, max: number, integer = false): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) invalid();
}
function date(value: unknown) { text(value, 64); if (!Number.isFinite(Date.parse(value))) invalid(); }
function color(value: unknown) {
  text(value, 32);
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) && !/^(yellow|red|green|blue|black|white|orange|transparent)$/i.test(value)) invalid();
}
function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 10_000) return invalid();
  const ids = new Set<string>();
  return value.map((item) => {
    const record = object(item);
    id(record.id);
    const key = record.id as string;
    if (ids.has(key)) invalid();
    ids.add(key);
    date(record.createdAt);
    return record;
  });
}
function optional(record: Record<string, unknown>, key: string, check: (value: unknown) => void) {
  if (record[key] !== undefined) check(record[key]);
}
const boolean = (value: unknown) => { if (typeof value !== "boolean") invalid(); };
const fraction = (value: unknown) => number(value, 0, 1);
const offset = (value: unknown) => number(value, 0, 1_000_000_000, true);

export function validateReadingBackup(value: unknown): asserts value is ReadingBackup {
  function safe(value: unknown, depth = 0) {
    if (depth > 20) invalid();
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) invalid();
      safe(child, depth + 1);
    }
  }
  safe(value);
  const root = object(value);
  if (root.kind !== "nine-rings-reading-data" || root.version !== 1 || !["pdf", "epub"].includes(String(root.format))) invalid();
  date(root.exportedAt);
  const file = object(root.file);
  id(file.name); number(file.size, 1, 250 * 1024 * 1024, true);
  if (file.algorithm !== "sha256-chunks-v1" || typeof file.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(file.fingerprint)) invalid();
  const progress = object(root.progress);
  const highlights = list(root.highlights);
  const bookmarks = list(root.bookmarks);
  for (const item of highlights) { color(item.color); optional(item, "note", text); optional(item, "updatedAt", date); }
  if (root.format === "pdf") {
    number(progress.page, 1, 1_000_000, true); number(progress.zoom, .25, 4);
    optional(progress, "pageCount", (v) => number(v, 1, 1_000_000, true));
    if (typeof progress.pageCount === "number" && (progress.page as number) > progress.pageCount) invalid();
    optional(progress, "fitWidth", boolean); optional(progress, "fitHeight", boolean);
    optional(progress, "lockedWidthRatio", (v) => { if (v !== null) number(v, 0.1, 10); });
    optional(progress, "position", (v) => {
      if (v === null) return;
      const position = object(v);
      number(position.x, -100, 100);
      number(position.y, -100, 100);
    });
    optional(progress, "viewMode", (v) => { if (v !== "horizontal" && v !== "vertical") invalid(); });
    for (const item of [...highlights, ...bookmarks]) {
      id(item.pdfId); number(item.page, 1, Number(progress.pageCount) || 1_000_000, true);
    }
    for (const item of highlights) {
      offset(item.start); offset(item.end); text(item.text);
      const kind = item.kind ?? "highlight";
      if (!["highlight", "underline", "strikeout", "freeText", "square", "circle", "line", "arrow"].includes(String(kind))) invalid();
      if (["highlight", "underline", "strikeout"].includes(String(kind)) && ((item.end as number) <= (item.start as number) || !item.text.trim())) invalid();
      if (["freeText", "square", "circle"].includes(String(kind)) && !item.rect) invalid();
      if (["line", "arrow"].includes(String(kind)) && !item.points) invalid();
      if (item.rect) {
        const rect = object(item.rect);
        for (const key of ["x", "y", "width", "height"]) fraction(rect[key]);
        if ((rect.width as number) <= 0 || (rect.height as number) <= 0 || (rect.x as number) + (rect.width as number) > 1.000001 || (rect.y as number) + (rect.height as number) > 1.000001) invalid();
      }
      if (item.points) for (const key of ["x1", "y1", "x2", "y2"]) fraction(object(item.points)[key]);
      optional(item, "fontSize", (v) => number(v, 8, 72));
    }
    for (const item of bookmarks) text(item.label, 160);
  } else {
    number(progress.chapterCount, 1, 10_000, true);
    number(progress.chapter, 0, (progress.chapterCount as number) - 1, true);
    number(progress.fontSize, 70, 180);
    optional(progress, "contentWidth", (v) => number(v, 60, 100));
    if (!["light", "sepia", "dark"].includes(String(progress.theme))) invalid();
    optional(progress, "location", (v) => text(v, 4096));
    optional(progress, "scrollProgress", fraction);
    optional(progress, "smartLineMerge", boolean);
    if (progress.chapterProgress !== undefined) {
      const entries = Object.entries(object(progress.chapterProgress));
      if (entries.length > 10_000) invalid();
      for (const [path, position] of entries) { id(path); fraction(position); }
    }
    if (progress.themeBackgrounds !== undefined) {
      for (const [theme, background] of Object.entries(object(progress.themeBackgrounds))) {
        if (!["light", "sepia", "dark"].includes(theme)) invalid();
        color(background);
      }
    }
    for (const item of highlights) {
      id(item.epubId);
      const anchor = object(item.anchor);
      id(anchor.chapterPath); offset(anchor.start); offset(anchor.end);
      if ((anchor.end as number) <= (anchor.start as number)) invalid();
      for (const key of ["exact", "prefix", "suffix"]) text(anchor[key]);
      if (!(anchor.exact as string).trim()) invalid();
    }
    for (const item of bookmarks) {
      id(item.epubId); id(item.chapterPath); text(item.label, 2000);
      number(item.chapter, 0, (progress.chapterCount as number) - 1, true); fraction(item.scrollProgress);
    }
    for (const item of list(root.manualLineMerges)) {
      id(item.chapterPath); text(item.left); text(item.right);
      if (!(item.left as string).trim() || !(item.right as string).trim()) invalid();
    }
  }
}

export function parseReadingBackup(json: string): ReadingBackup {
  if (json.length > MAX_READING_BACKUP_BYTES || new TextEncoder().encode(json).byteLength > MAX_READING_BACKUP_BYTES) throw new Error("阅读备份不能超过 20 MiB");
  const backup: unknown = JSON.parse(json);
  validateReadingBackup(backup);
  return backup;
}

/** Full-content fingerprint with bounded (4 MiB) reads, not a filename/size match. */
export async function fingerprintReadingFile(blob: Blob): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("阅读备份需要 HTTPS 或本地安装版的安全环境");
  const hashes: Uint8Array[] = [new TextEncoder().encode(`nine-rings:sha256-chunks-v1:${blob.size}:`)];
  for (let start = 0; start < blob.size; start += 4 * 1024 * 1024) {
    hashes.push(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.slice(start, start + 4 * 1024 * 1024).arrayBuffer())));
  }
  const combined = new Uint8Array(hashes.reduce((sum, hash) => sum + hash.length, 0));
  let offset = 0;
  for (const hash of hashes) { combined.set(hash, offset); offset += hash.length; }
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", combined))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
