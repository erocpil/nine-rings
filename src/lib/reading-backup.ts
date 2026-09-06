import { readLocalPdfReadingSnapshot, restoreLocalPdfReadingBackup } from "./pdf-library";
import { readLocalEpubReadingSnapshot, restoreLocalEpubReadingBackup } from "./epub-library";
import { fingerprintReadingFile, parseReadingBackup, type ReadingBackup } from "./reading-backup-format";
export { parseReadingBackup, MAX_READING_BACKUP_BYTES } from "./reading-backup-format";
export type { ReadingBackup } from "./reading-backup-format";

export async function exportReadingBackup(format: "pdf" | "epub", id: string): Promise<string> {
  let backup: ReadingBackup;
  const base = { kind: "nine-rings-reading-data" as const, version: 1 as const, exportedAt: new Date().toISOString() };
  if (format === "pdf") {
    const { entry, highlights, bookmarks } = await readLocalPdfReadingSnapshot(id);
    const { page, zoom, fitWidth, fitHeight, viewMode, pageCount } = entry;
    backup = {
      ...base, format,
      file: { name: entry.name, size: entry.size, algorithm: "sha256-chunks-v1", fingerprint: await fingerprintReadingFile(entry.blob) },
      progress: { page, zoom, fitWidth, fitHeight, viewMode, pageCount }, highlights, bookmarks,
    };
  } else {
    const { entry, highlights, bookmarks } = await readLocalEpubReadingSnapshot(id);
    const { chapter, chapterCount, location, scrollProgress, chapterProgress, fontSize, theme, themeBackgrounds, smartLineMerge } = entry;
    backup = {
      ...base, format,
      file: { name: entry.name, size: entry.size, algorithm: "sha256-chunks-v1", fingerprint: await fingerprintReadingFile(entry.blob) },
      progress: { chapter, chapterCount, location, scrollProgress, chapterProgress, fontSize, theme, themeBackgrounds, smartLineMerge },
      highlights, bookmarks, manualLineMerges: entry.manualLineMerges ?? [],
    };
  }
  const json = JSON.stringify(backup, null, 2);
  // Never produce a backup that the importer cannot safely restore.
  parseReadingBackup(json);
  return json;
}

export async function previewReadingBackup(format: "pdf" | "epub", id: string, json: string): Promise<ReadingBackup> {
  const backup = parseReadingBackup(json);
  if (backup.format !== format) throw new Error("所选备份与目标图书格式不同");
  const snapshot = format === "pdf" ? await readLocalPdfReadingSnapshot(id) : await readLocalEpubReadingSnapshot(id);
  if (snapshot.entry.size !== backup.file.size || await fingerprintReadingFile(snapshot.entry.blob) !== backup.file.fingerprint) throw new Error("原文件内容不一致；请先导入制作备份时使用的同一份原文件");
  return backup;
}

export async function restoreReadingBackup(id: string, backup: ReadingBackup, restoreProgress = false) {
  return backup.format === "pdf"
    ? { ...await restoreLocalPdfReadingBackup(id, backup, restoreProgress), lineMergesAdded: 0 }
    : restoreLocalEpubReadingBackup(id, backup, restoreProgress);
}
