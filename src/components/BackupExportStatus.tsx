import { useEffect, useState } from "react";
import {
  BACKUP_EXPORT_RECEIPT_EVENT,
  readBackupExportReceipt,
} from "../lib/backup-export-receipt";

export function BackupExportStatus() {
  const [receipt, setReceipt] = useState(readBackupExportReceipt);
  useEffect(() => {
    const refresh = () => setReceipt(readBackupExportReceipt());
    window.addEventListener(BACKUP_EXPORT_RECEIPT_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(BACKUP_EXPORT_RECEIPT_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return (
    <div
      className="settings-hint backup-export-status"
      role="status"
      aria-label="本机备份导出记录"
    >
      <p>
        {receipt
          ? `最近导出：${new Date(receipt.at).toLocaleString()} · ${receipt.delivery === "file-saved" ? "桌面端已写入备份文件" : "浏览器已发起下载，请确认文件已保存"}`
          : "暂无可用的本机 JSON 导出记录。"}
      </p>
      <details>
        <summary>自动保存不等于已备份</summary>
        <p>
          此处只记录本机发起的 JSON 导出，不检查备份文件是否仍存在，也不代表
          GitHub 备份状态。没有记录不代表从未备份。
        </p>
      </details>
    </div>
  );
}
