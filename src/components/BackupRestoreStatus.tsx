import { useEffect, useState } from "react";
import { useBackupRestoreStatus } from "../hooks/useBackupRestoreStatus";
import { acknowledgeBackupRestore, withBackupRestoreReadLock } from "../lib/backup-restore-coordination";

export function BackupRestoreStatus({ compact = false, onOpenSettings }: { compact?: boolean; onOpenSettings?: () => void }) {
  const { status, error, canClearRecord, refresh } = useBackupRestoreStatus();
  const [busy, setBusy] = useState<"export" | "acknowledge" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const record = status?.record;
  useEffect(() => { setActionError(null); setExportMessage(null); }, [record?.id]);
  const needsReview = status?.interrupted || record?.phase === "needs-review" || record?.phase === "failed" || error;
  if (status?.active && status.local) return null;
  if (compact && !needsReview && !status?.active) return null;
  if (!compact && !record && !error) return null;
  const message = error ?? (status?.active ? "有窗口正在恢复备份，请暂停编辑并等待完成。"
    : status?.interrupted ? "检测到上次备份恢复中断。本地数据或设置可能已部分更新；请先导出本地备份并检查，系统不会自动重试或回滚。"
    : record?.phase === "needs-review" ? "上次恢复在开始写入后未正常完成，结果尚待检查。请先导出本地备份并检查，再确认恢复记录；确认前不能再次恢复。"
    : record?.phase === "failed" ? "上次恢复在写入前失败，未执行备份数据写入。请检查操作提示后重新预检。"
    : record?.phase === "acknowledged" ? "上次恢复记录已确认；确认操作没有修改、重试或回滚数据。"
    : "上次备份恢复已完成。");
  const acknowledge = async () => {
    if (busy || !window.confirm("请先导出当前本地数据并检查恢复结果。此操作只确认/清理恢复记录，不修复、不重试、不回滚任何数据。确认已检查并继续？")) return;
    setBusy("acknowledge"); setActionError(null);
    try { await acknowledgeBackupRestore(canClearRecord ? null : record?.id ?? null); await refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const exportLocal = async () => {
    if (busy) return;
    setBusy("export"); setActionError(null); setExportMessage(null);
    try {
      const { exportLocalJsonBackup } = await import("../lib/local-backup-export");
      const result = await withBackupRestoreReadLock(exportLocalJsonBackup);
      if (result) setExportMessage(result.desktop ? "本地备份已保存；恢复记录未改变。" : "已发起本地备份下载，请确认文件已保存；恢复记录未改变。");
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  if (!compact && !needsReview && !status?.active) return <details className="backup-restore-status"><summary>上次恢复记录</summary><p>{message}</p>{record && <small>{new Date(record.startedAt).toLocaleString()} · {record.source === "github" ? "GitHub Pull" : "JSON 导入"}</small>}</details>;
  return <div className={compact ? "web-status-banner warning" : "backup-restore-status"} role={needsReview ? "alert" : "status"}>
    <span>{message}</span>
    {compact ? <button type="button" onClick={onOpenSettings}>打开设置检查</button> : <>
      {record && <small>{record.source === "github" ? "GitHub Pull" : "JSON 导入"} · {record.mode === "replace" ? "全量覆盖" : "合并"} · 开始于 {new Date(record.startedAt).toLocaleString()}</small>}
      <p className="settings-hint">恢复锁只协调同源窗口的备份恢复，不替代普通编辑的跨窗口隔离。恢复前请关闭其他编辑窗口。记录不含正文、Token 或备份内容。</p>
      {!!needsReview && !status?.active && <div className="settings-button-row">
        <button type="button" className="settings-btn" disabled={!!busy} onClick={() => void exportLocal()}>{busy === "export" ? "正在导出…" : "导出当前本地备份"}</button>
        {(!error || canClearRecord) && <button type="button" className="settings-btn" disabled={!!busy} onClick={() => void acknowledge()}>{canClearRecord ? "清理损坏的恢复记录" : "确认已检查本地数据"}</button>}
        {error && !canClearRecord && <button type="button" className="settings-btn" disabled={!!busy} onClick={() => void refresh()}>重新检查</button>}
      </div>}
      {exportMessage && <p role="status" className="settings-hint">{exportMessage}</p>}
      {actionError && <p className="dialog-action-error">{actionError}</p>}
    </>}
  </div>;
}
