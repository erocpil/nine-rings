import { useRef, useState } from "react";
import { api } from "../lib/api";
import { isTauri, importWithDialog } from "../lib/tauri-desktop";
import { exportLocalJsonBackup } from "../lib/local-backup-export";
import { useSettingsTextImport } from "./useSettingsTextImport";
export function useSettingsData(
  open: boolean,
  showMessage: (message: string) => void,
  onImport?: () => void,
  onMarkdownImport?: () => void,
) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const textImport = useSettingsTextImport(open, showMessage, onMarkdownImport);
  const handleExport = async () => {
    try {
      const result = await exportLocalJsonBackup();
      if (!result) return;
      showMessage(
        result.desktop
          ? `备份文件已保存到 ${result.destination}`
          : "已发起备份下载，请确认文件已保存到下载目录",
      );
    } catch (e) {
      showMessage(`导出失败: ${e}`);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      if (isTauri()) {
        const text = await importWithDialog();
        if (text) {
          const result = await api.export.import(text);
          const configTip = result.configs_imported ? "，配置已恢复" : "";
          showMessage(
            `导入完成：${result.notes_imported} 篇笔记, ${result.pages_imported} 个页面${configTip}`,
          );
          onImport?.();
        }
      } else {
        // Web 模式：触发隐藏的 file input
        fileInputRef.current?.click();
        return; // 后续由 handleImportFile 处理
      }
    } catch (e) {
      showMessage(`导入失败: ${e}`);
    } finally {
      setImporting(false);
    }
  };

  /// Web 模式的 file input 回调（Tauri 模式不走这里）
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const result = await api.export.import(text);
      const configTip = result.configs_imported ? "，配置已恢复" : "";
      showMessage(
        `导入完成：${result.notes_imported} 篇笔记, ${result.pages_imported} 个页面${configTip}`,
      );
      onImport?.();
    } catch (e) {
      showMessage(`导入失败: ${e}`);
    } finally {
      // Match native dialogs: a failed import can be retried with the same file.
      e.target.value = "";
      setImporting(false);
    }
  };

  return {
    ...textImport,
    fileInputRef,
    importing,
    handleExport,
    handleImport,
    handleImportFile,
  };
}
