/**
 * Tauri 桌面端专用功能模块
 *
 * 仅在 Tauri 环境下可用（通过 window.__TAURI__ 检测）。
 * Web 端不引入此模块，避免 `@tauri-apps/*` 打包报错。
 */

import { localDateKey } from "./local-date";
import { isTauriRuntime } from "./runtime";

/** 检测是否运行在 Tauri 桌面环境中（兼容 v1 __TAURI__ 和 v2 isTauri） */
export function isTauri(): boolean {
  return isTauriRuntime();
}

/**
 * 原生保存对话框 — 导出数据到用户选择的文件路径
 * 返回选中的路径（用户取消则返回 null）
 */
export async function exportWithDialog(data: string, defaultName?: string): Promise<string | null> {
  if (!isTauri()) return null;

  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const path = await save({
    defaultPath: defaultName ?? `nine-rings-${localDateKey()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!path) return null; // 用户取消

  await invoke("export_to_file", { path, content: data });
  return path;
}

/** 原生保存对话框 — 导出单篇 Markdown。 */
export async function exportMarkdownWithDialog(data: string, defaultName: string): Promise<string | null> {
  if (!isTauri()) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return null;
  await invoke("export_to_file", { path, content: data });
  return path;
}

/**
 * 原生打开对话框 — 从用户选择的文件导入数据
 * 返回用户选择的备份文本（用户取消则返回 null）。实际导入仍走统一的
 * api.export.import，这样桌面端也会恢复前端 localStorage 用户设置。
 */
export async function importWithDialog(): Promise<string | null> {
  if (!isTauri()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const path = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });

  if (!path) return null; // 用户取消

  return invoke<string>("read_import_file", { path });
}
