/**
 * Tauri 桌面端专用功能模块
 *
 * 仅在 Tauri 环境下可用（通过 window.__TAURI__ 检测）。
 * Web 端不引入此模块，避免 `@tauri-apps/*` 打包报错。
 */

/** 检测是否运行在 Tauri 桌面环境中 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && (window as any).__TAURI__ !== undefined;
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
    defaultPath: defaultName ?? `nine-rings-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });

  if (!path) return null; // 用户取消

  await invoke("export_to_file", { path, content: data });
  return path;
}

/**
 * 原生打开对话框 — 从用户选择的文件导入数据
 * 返回导入结果（用户取消则返回 null）
 */
export async function importWithDialog(): Promise<{
  notes_imported: number;
  pages_imported: number;
} | null> {
  if (!isTauri()) return null;

  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const path = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });

  if (!path) return null; // 用户取消

  const result = await invoke<{ notes_imported: number; pages_imported: number }>(
    "import_from_file",
    { path },
  );
  return result;
}
