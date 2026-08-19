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
  const fallbackTitle = fileName.replace(/\.md$/i, "");
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
