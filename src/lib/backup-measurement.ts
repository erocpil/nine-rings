/** Aggregate-only accounting of the actual JSON text; never return payloads or keys. */
export const BACKUP_BYTE_KINDS = [
  "body",
  "images",
  "metadata",
  "search",
  "templates",
  "protectedHistory",
  "settings",
  "other",
] as const;
export type BackupByteKind = (typeof BACKUP_BYTE_KINDS)[number];
export interface BackupMeasurement {
  version: 1;
  totalBytes: number;
  bytes: Record<BackupByteKind, number>;
  counts: {
    documents: number;
    templates: number;
    protectedVersions: number;
    inlineImages: number;
    opaqueContentStrings: number;
  };
  analysisMs: number;
  timings?: {
    saveMs: number;
    exportMs: number;
    analysisWallMs: number;
    totalMs: number;
  };
  memory: { peakBytes: null; method: "not-measured" };
}
/** UTF-8 size without allocating another full byte buffer. Matches TextEncoder. */
export function utf8Size(text: string, start = 0, end = text.length): number {
  let bytes = 0;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < end &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function measureBackupJson(source: string): BackupMeasurement {
  const started = performance.now();
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    throw new Error("备份不是有效的 JSON，无法测量");
  }
  if (!object(root) || !Array.isArray(root.notes))
    throw new Error("备份缺少文档数组，无法测量");
  const settingsTemplates =
    object(root.user_settings) && object(root.user_settings.values)
      ? root.user_settings.values["nine-rings:templates"]
      : null;
  const counts = {
    documents: root.notes.length,
    templates:
      (Array.isArray(root.templates) ? root.templates.length : 0) +
      (Array.isArray(settingsTemplates) ? settingsTemplates.length : 0),
    protectedVersions: Array.isArray(root.protected_versions)
      ? root.protected_versions.length
      : 0,
    inlineImages: 0,
    opaqueContentStrings: 0,
  };
  const bytes = Object.fromEntries(
    BACKUP_BYTE_KINDS.map((key) => [key, 0]),
  ) as Record<BackupByteKind, number>;
  let i = 0;
  const consume = (end: number, kind: BackupByteKind) => {
    bytes[kind] += utf8Size(source, i, end);
    i = end;
  };
  const whitespace = (kind: BackupByteKind) => {
    let end = i;
    while (end < source.length && /\s/.test(source[end])) end++;
    consume(end, kind);
  };
  const stringEnd = () => {
    let end = i + 1;
    while (end < source.length) {
      if (source[end] === "\\") end += 2;
      else if (source[end++] === '"') return end;
    }
    throw new Error("备份字符串不完整，无法测量");
  };
  const category = (
    path: (string | number)[],
    inherited: BackupByteKind,
  ): BackupByteKind => {
    if (path.length === 1) {
      if (path[0] === "notes" || path[0] === "protected_paths")
        return "metadata";
      if (path[0] === "templates") return "templates";
      if (path[0] === "protected_versions") return "protectedHistory";
      if (path[0] === "config" || path[0] === "user_settings")
        return "settings";
    }
    if (path.length === 3 && path[0] === "notes") {
      if (path[2] === "content") return "body";
      if (path[2] === "search_text" || path[2] === "searchText")
        return "search";
    }
    if (
      path.length === 3 &&
      path[0] === "user_settings" &&
      path[1] === "values" &&
      path[2] === "nine-rings:templates"
    )
      return "templates";
    return inherited;
  };
  const value = (
    path: (string | number)[],
    inherited: BackupByteKind,
    depth: number,
  ): void => {
    if (depth > 100) throw new Error("备份嵌套过深，无法测量");
    const kind = category(path, inherited);
    whitespace(inherited);
    const token = source[i];
    if (token === '"') {
      const end = stringEnd();
      const inContent = kind === "body" || kind === "templates";
      const key = path[path.length - 1],
        parent = path[path.length - 2];
      const imageSlot =
        (key === "image" && parent === "insert") ||
        (key === "src" && parent === "attrs");
      const decoded: unknown =
        inContent && (imageSlot || (key === "content" && path.length === 3))
          ? JSON.parse(source.slice(i, end))
          : null;
      if (
        imageSlot &&
        typeof decoded === "string" &&
        /^data:image\/[^,]+,/i.test(decoded)
      ) {
        counts.inlineImages++;
        consume(end, "images");
      } else {
        if (key === "content" && path.length === 3 && path[0] === "notes")
          counts.opaqueContentStrings++;
        consume(end, kind);
      }
    } else if (token === "{" || token === "[") {
      const isObject = token === "{";
      consume(i + 1, kind);
      whitespace(kind);
      let index = 0;
      while (source[i] !== (isObject ? "}" : "]")) {
        let key: string | number = index++;
        if (isObject) {
          const end = stringEnd();
          key = JSON.parse(source.slice(i, end)) as string;
          consume(end, kind);
          whitespace(kind);
          consume(i + 1, kind); // colon; JSON.parse above has validated syntax.
        }
        value([...path, key], kind, depth + 1);
        whitespace(kind);
        if (source[i] !== ",") break;
        consume(i + 1, kind);
        whitespace(kind);
      }
      consume(i + 1, kind);
    } else {
      let end = i;
      while (end < source.length && !/[\s,}\]]/.test(source[end])) end++;
      consume(end, kind);
    }
  };
  value([], "other", 0);
  whitespace("other");
  const totalBytes = utf8Size(source);
  if (
    i !== source.length ||
    Object.values(bytes).reduce((a, b) => a + b, 0) !== totalBytes
  )
    throw new Error("备份字节未能完整对账");
  return {
    version: 1,
    totalBytes,
    bytes,
    counts,
    analysisMs: performance.now() - started,
    memory: { peakBytes: null, method: "not-measured" },
  };
}
