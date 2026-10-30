import { ChangeSet, type EditorState, type TransactionSpec } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { SourceFormatConfigurationError } from "./source-format-diagnostics";

export const SOURCE_FORMAT_STYLES = ["LLVM", "Google", "Chromium", "Mozilla", "WebKit", "Microsoft", "GNU"] as const;
export type SourceFormatStyle = typeof SOURCE_FORMAT_STYLES[number] | "custom";
export interface SourceFormatSettings { style: SourceFormatStyle; custom: string }
export interface SourceFormatRequest {
  source: string;
  language: string;
  style: string;
  /** Validate the user configuration before applying host display safeguards. */
  validationStyle?: string;
  /** UTF-16 editor offsets; the provider converts them to its own range units. */
  range?: { from: number; to: number };
}
const SETTINGS_KEY = "nr:source-formatting";
export function sourceFormatSettings(): SourceFormatSettings {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { style: [...SOURCE_FORMAT_STYLES, "custom"].includes(value?.style) ? value.style : "LLVM",
      custom: typeof value?.custom === "string" && value.custom.length <= 65536 ? value.custom : "" };
  } catch { return { style: "LLVM", custom: "" }; }
}
export function saveSourceFormatSettings(settings: SourceFormatSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Session controls remain available. */ }
}
export function sourceFormatStyle(settings: SourceFormatSettings, tabSize: number, tabs: boolean): string {
  if (settings.style === "custom") {
    if (!settings.custom.trim()) throw new SourceFormatConfigurationError("请先导入或填写 .clang-format 配置。");
    if (settings.custom.length > 65536) throw new SourceFormatConfigurationError("格式配置不能超过 64 KiB。");
    try {
      const parsed = JSON.parse(settings.custom);
      return JSON.stringify({ ...parsed, AlignEscapedNewlines: "DontAlign" });
    } catch {
      return /^AlignEscapedNewlines\s*:/m.test(settings.custom)
        ? settings.custom.replace(/^AlignEscapedNewlines\s*:.*$/m, "AlignEscapedNewlines: DontAlign")
        : `${settings.custom}\nAlignEscapedNewlines: DontAlign\n`;
    }
  }
  return JSON.stringify({ BasedOnStyle: settings.style, IndentWidth: tabSize, TabWidth: tabSize, UseTab: tabs ? "ForIndentation" : "Never", AlignEscapedNewlines: "DontAlign" });
}

/** Provider boundary: no editor or platform state is sent to the formatter. */
export function formatSource(request: SourceFormatRequest): Promise<string> {
  if (!["c", "cpp"].includes(request.language)) return Promise.reject(Error("当前文件类型尚未提供代码格式化器。"));
  if (request.source.length > 10 * 1024 * 1024 || new TextEncoder().encode(request.source).byteLength > 10 * 1024 * 1024) return Promise.reject(Error("代码超过 10 MiB，请先拆分文件再格式化。"));
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL("../workers/source-format.worker.ts", import.meta.url), { type: "module" }); }
    catch { reject(Error("无法启动本地格式化器，请检查应用资源后重试。")); return; }
    const finish = (error?: Error, result?: string) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(Error("代码格式化超时，原文未修改。")), 60000);
    worker.onmessage = (event: MessageEvent<{ result?: string; error?: string; configurationError?: boolean }>) => {
      if (event.data.error) finish(event.data.configurationError ? new SourceFormatConfigurationError(event.data.error) : Error(event.data.error));
      else if (typeof event.data.result !== "string") finish(Error("格式化器返回了无效结果。"));
      else finish(undefined, event.data.result);
    };
    worker.onerror = (event) => { event.preventDefault(); finish(Error("本地格式化器加载失败，原文未修改。")); };
    worker.onmessageerror = () => finish(Error("无法读取格式化结果，原文未修改。"));
    try { worker.postMessage(request); } catch (error) { finish(error instanceof Error ? error : Error(String(error))); }
  });
}

/** Small mapped edits preserve selections, folds, bookmarks and scroll anchors. */
export async function sourceFormatChange(state: EditorState, formatted: string): Promise<TransactionSpec | null> {
  const original = state.doc.toString();
  if (state.readOnly || original === formatted) return null;
  // Most formatting only changes whitespace. A linear scan keeps every token's
  // position mappable even when thousands of gaps change (a bounded generic
  // diff may otherwise collapse them into one replacement and lose selections).
  let edits = whitespaceEdits(original, formatted);
  if (!edits) {
    const { diff } = await import("@codemirror/merge");
    edits = diff(original, formatted, { scanLimit: 1000, timeout: 100 }).map(change => ({
      from: change.fromA, to: change.toA, insert: formatted.slice(change.fromB, change.toB),
    }));
  }
  const changes = ChangeSet.of(edits, state.doc.length);
  return { changes, selection: state.selection.map(changes), userEvent: "input.format", annotations: isolateHistory.of("full") };
}

function whitespaceEdits(before: string, after: string) {
  const edits: { from: number; to: number; insert: string }[] = [];
  let a = 0, b = 0;
  while (a < before.length || b < after.length) {
    const startA = a, startB = b;
    while (a < before.length && /\s/.test(before[a])) a++;
    while (b < after.length && /\s/.test(after[b])) b++;
    if (before.slice(startA, a) !== after.slice(startB, b)) edits.push({ from: startA, to: a, insert: after.slice(startB, b) });
    if (before[a] !== after[b]) return null;
    a++; b++;
  }
  return edits;
}
