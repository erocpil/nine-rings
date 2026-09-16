import type { CreateNoteInput, DocType } from "../types/models";
import { extractTitle, mdToDelta } from "./md-parser";

export interface MarkdownImportOptions {
  date: string;
  mode: "document" | "note";
  storagePath?: string;
  docType?: DocType;
  tags?: string[];
  concepts?: string[];
}

/** Explicit text formats only: directory import must never ingest arbitrary binaries. */
export const TEXT_IMPORT_EXTENSIONS = ["md", "markdown", "txt", "text", "log", "csv", "tsv", "rst", "adoc"];
export const TEXT_IMPORT_ACCEPT = TEXT_IMPORT_EXTENSIONS.map(extension => `.${extension}`).join(",");

export function isTextImportFile(fileName: string): boolean {
  return TEXT_IMPORT_EXTENSIONS.includes(fileName.split(".").pop()?.toLowerCase() ?? "");
}

/** UTF-8 and BOM-marked UTF-16; reject bad encoding instead of silently corrupting text. */
export function decodeTextImport(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
  let source: string;
  try { source = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error("无法解码文本，请将文件转换为 UTF-8 或带 BOM 的 UTF-16 后重试"); }
  // These controls have no place in a document and commonly indicate binary data.
  for (const character of source) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      throw new Error("文件包含二进制控制字符，已拒绝导入");
    }
  }
  return source;
}

export interface TextImportSource {
  fileName: string;
  source: string;
  /** Includes the selected root directory, as provided by webkitRelativePath. */
  relativePath?: string;
}

export function buildTextImportInput(file: TextImportSource, options: MarkdownImportOptions): CreateNoteInput {
  if (!isTextImportFile(file.fileName)) throw new Error("不支持的文本文件类型");
  let storagePath = options.storagePath;
  if (file.relativePath) {
    if (options.mode !== "document") throw new Error("目录导入仅支持文档模式");
    const relative = file.relativePath.replace(/\\/g, "/");
    if (relative.startsWith("/") || /^[a-z]:/i.test(relative)) throw new Error("导入目录必须是相对路径");
    const parts = relative.split("/");
    if (parts.pop() !== file.fileName || parts.length === 0 || parts.some(part => !part.trim())) {
      throw new Error("文件相对路径无效");
    }
    const base = normalizeMarkdownImportPath(storagePath ?? "");
    if (!base) throw new Error("请选择或输入文档路径");
    storagePath = `${base}/${normalizeMarkdownImportPath(parts.join("/"))}`;
  }
  if (/\.(md|markdown)$/i.test(file.fileName)) {
    return buildMarkdownImportInput(file.fileName, file.source, { ...options, storagePath });
  }
  const source = file.source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  // Build metadata through the same path but keep plain text out of the Markdown parser.
  const input = buildMarkdownImportInput(file.fileName, "", { ...options, storagePath });
  input.title = file.fileName.replace(/\.[^.]+$/, "");
  input.content = { ops: [{ insert: source.endsWith("\n") ? source : `${source}\n` }] };
  return input;
}

/** 规范化用户输入的文档目录，拒绝会产生含糊层级的 `.` / `..`。 */
export function normalizeMarkdownImportPath(path: string): string {
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) {
    throw new Error("导入路径不能包含 . 或 ..");
  }
  return parts.join("/");
}

export function parseMetadataList(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];
}

/** 把单个 Markdown 文件转换为所有存储后端通用的 CreateNoteInput。 */
export function buildMarkdownImportInput(
  fileName: string,
  source: string,
  options: MarkdownImportOptions,
): CreateNoteInput {
  const fallbackTitle = fileName.replace(/\.(md|markdown)$/i, "");
  const input: CreateNoteInput = {
    date: options.date,
    title: extractTitle(source, fallbackTitle),
    content: mdToDelta(source),
    tags: options.tags ?? [],
  };

  if (options.mode === "document") {
    const storagePath = normalizeMarkdownImportPath(options.storagePath ?? "");
    if (!storagePath) throw new Error("请选择或输入文档路径");
    input.storagePath = storagePath;
    input.docType = options.docType ?? "reference";
    if (options.concepts?.length) input.concepts = options.concepts;
  }
  return input;
}
