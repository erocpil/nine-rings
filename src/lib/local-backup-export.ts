import { api } from "./api";
import { localDateKey } from "./local-date";
import { exportWithDialog, isTauri } from "./tauri-desktop";

export interface LocalBackupExportResult {
  destination: string;
  desktop: boolean;
}

/** 导出与 GitHub 全量快照同格式的本地 JSON；取消桌面保存对话框时返回 null。 */
export async function exportLocalJsonBackup(): Promise<LocalBackupExportResult | null> {
  const data = await api.export.data();
  return saveJsonBackup(data, `nine-rings-${localDateKey()}.json`);
}

/** Shared delivery for normal backups and recovery snapshots with pending edits. */
export async function saveJsonBackup(data: string, filename: string): Promise<LocalBackupExportResult | null> {
  if (isTauri()) {
    const path = await exportWithDialog(data, filename);
    return path ? { destination: path, desktop: true } : null;
  }

  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return { destination: filename, desktop: false };
}
