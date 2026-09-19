import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api } from "../lib/api";
import { localDateKey } from "../lib/local-date";
import type { DocType } from "../types/models";
import {
  decodeTextImport,
  isTextImportFile,
  parseMetadataList,
  type TextImportSource,
} from "../lib/markdown-import";
import { transformMarkdownBatch } from "../lib/data-transform-client";
const MD_IMPORT_CHUNK_SIZE = 4;
interface TextImportResult {
  count: number;
  failed: number;
  skipped: number;
  mode: "document" | "note";
  interrupted: boolean;
  error?: string;
}
function yieldToNextFrame(): Promise<void> {
  if (typeof window === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) =>
    window.requestAnimationFrame(() => resolve()),
  );
}

/** Settings-owned import lifetime; closing the panel does not discard an in-flight batch. */
export function useSettingsTextImport(
  open: boolean,
  showMessage: (message: string) => void,
  onMarkdownImport?: () => void,
) {
  // ── Markdown 导入状态 ──
  const mdInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const [directoryImportSupported] = useState(
    () => "webkitdirectory" in document.createElement("input"),
  );
  const [mdImporting, setMdImporting] = useState(false);
  const [mdImportResult, setMdImportResult] = useState<TextImportResult | null>(
    null,
  );
  const [mdImportTotal, setMdImportTotal] = useState(0);
  const [mdImportProgress, setMdImportProgress] = useState(0);
  const [mdImportCurrentFile, setMdImportCurrentFile] = useState("");
  const [mdImportMode, setMdImportMode] = useState<"document" | "note">(
    "document",
  );
  const [mdImportPath, setMdImportPath] = useState("references/imported");
  const importPathTriggerRef = useRef<HTMLButtonElement>(null);
  const [importPathPickerOpen, setImportPathPickerOpen] = useState(false);
  useEffect(() => {
    if (!open) setImportPathPickerOpen(false);
  }, [open]);
  const [mdImportDocType, setMdImportDocType] = useState<DocType>("reference");
  const [mdImportTags, setMdImportTags] = useState("");
  const [mdImportConcepts, setMdImportConcepts] = useState("");
  // ── Markdown 导入 ──
  const handleMdImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (!files.length || mdImporting) return;
    const directoryImport = input === directoryInputRef.current;
    const mode = directoryImport ? "document" : mdImportMode;
    if (mode === "document" && !mdImportPath.trim()) {
      showMessage("请先填写目标路径，再选择文件或目录");
      return;
    }
    setMdImportResult(null);
    const fileList = files
      .filter((file) => isTextImportFile(file.name))
      .sort((left, right) =>
        (left.webkitRelativePath || left.name).localeCompare(
          right.webkitRelativePath || right.name,
        ),
      );
    const skipped = files.length - fileList.length;
    if (!fileList.length) {
      setMdImportResult({
        count: 0,
        failed: 0,
        skipped,
        mode,
        interrupted: false,
      });
      showMessage(`未发现支持的文本文件，已跳过 ${skipped} 个非支持类型的文件`);
      return;
    }
    setMdImporting(true);
    setImportPathPickerOpen(false);
    setMdImportTotal(fileList.length);
    setMdImportProgress(0);
    setMdImportCurrentFile("");
    const today = localDateKey();
    let count = 0;
    const failures: string[] = [];
    try {
      const options = {
        date: today,
        mode,
        storagePath: mdImportPath.trim(),
        docType: mdImportDocType,
        tags: parseMetadataList(mdImportTags),
        concepts: parseMetadataList(mdImportConcepts),
      };
      // Bound both file reads and Worker conversion; don't hold the entire directory in RAM.
      for (
        let offset = 0;
        offset < fileList.length;
        offset += MD_IMPORT_CHUNK_SIZE
      ) {
        const batch = fileList.slice(offset, offset + MD_IMPORT_CHUNK_SIZE);
        const sources: TextImportSource[] = [];
        for (const file of batch) {
          const label = file.webkitRelativePath || file.name;
          setMdImportCurrentFile(label);
          try {
            if (directoryImport && !file.webkitRelativePath)
              throw new Error("系统未提供目录结构，请改用文件选择导入");
            sources.push({
              fileName: file.name,
              source: decodeTextImport(
                new Uint8Array(await file.arrayBuffer()),
              ),
              relativePath: directoryImport
                ? file.webkitRelativePath
                : undefined,
            });
          } catch (error) {
            failures.push(
              `${label}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        const transformed = await transformMarkdownBatch(sources, options);
        for (let index = 0; index < transformed.length; index++) {
          const result = transformed[index];
          const label = sources[index].relativePath || result.fileName;
          setMdImportCurrentFile(label);
          try {
            if (!result.input) throw new Error(result.error ?? "文本转换失败");
            await api.notes.create(result.input);
            count++;
          } catch (error) {
            failures.push(
              `${label}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        setMdImportProgress(offset + batch.length);
        await yieldToNextFrame();
      }
      setMdImportResult({
        count,
        failed: failures.length,
        skipped,
        mode,
        interrupted: false,
        error: failures[0],
      });
      if (count > 0) onMarkdownImport?.();
      showMessage(
        failures.length > 0
          ? `已导入 ${count} 篇，跳过 ${skipped} 个非支持类型文件，失败 ${failures.length} 篇：${failures[0]}`
          : `文本导入完成：${count} 篇${options.mode === "document" ? `，路径 ${options.storagePath}` : ""}${skipped ? `，跳过 ${skipped} 个非支持类型文件` : ""}`,
      );
    } catch (err) {
      setMdImportResult({
        count,
        failed: failures.length,
        skipped,
        mode,
        interrupted: true,
        error: err instanceof Error ? err.message : String(err),
      });
      if (count > 0) onMarkdownImport?.();
      showMessage(`导入中断，已导入 ${count} 篇（已导入的文档会保留）: ${err}`);
    } finally {
      setMdImporting(false);
      setMdImportCurrentFile("");
      setMdImportTotal(0);
      setMdImportProgress(0);
      // 无论成功失败都允许再次选择同一批文件。
      input.value = "";
    }
  };

  return {
    mdInputRef,
    directoryInputRef,
    directoryImportSupported,
    mdImporting,
    mdImportResult,
    mdImportTotal,
    mdImportProgress,
    mdImportCurrentFile,
    mdImportMode,
    setMdImportMode,
    mdImportPath,
    setMdImportPath,
    importPathTriggerRef,
    importPathPickerOpen,
    setImportPathPickerOpen,
    mdImportDocType,
    setMdImportDocType,
    mdImportTags,
    setMdImportTags,
    mdImportConcepts,
    setMdImportConcepts,
    handleMdImport,
  };
}
