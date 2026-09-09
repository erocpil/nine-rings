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
    <div className="settings-hint" role="status" aria-label="本机备份导出记录">
      <p>
        {receipt
          ? `最近一条 JSON 导出记录：${new Date(receipt.at).toLocaleString()} · ${receipt.delivery === "file-saved" ? "桌面端已写入备份文件" : "浏览器已发起下载，文件是否保存需自行确认"}`
          : "暂无可用的本机 JSON 导出记录，不代表从未备份。"}
      </p>
      <p>
        正文自动保存只写入本机，不等于已备份。此记录不验证文件当前是否存在，也不代表
        GitHub 备份状态。
      </p>
    </div>
  );
}
