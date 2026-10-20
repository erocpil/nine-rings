import { documentSourceLanguage, documentLanguageExtension } from "./document-language";
import type { DeltaOps } from "../types/models";
import { noteToMarkdown } from "./markdown-serializer";
import { exportMarkdownWithDialog, isTauri } from "./tauri-desktop";

export async function exportDocumentMarkdown(title: string | null | undefined, content: unknown) {
  const markdown = noteToMarkdown(title, content);
  const extension = documentLanguageExtension(documentSourceLanguage((content as DeltaOps)?.metadata));
  const filename = `${(title?.trim() || "无标题").replace(/[\\/:*?"<>|]/g, "-").slice(0, 100)}.${extension}`;
  if (isTauri()) {
    await exportMarkdownWithDialog(markdown, filename);
    return;
  }
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally { URL.revokeObjectURL(url); }
}
