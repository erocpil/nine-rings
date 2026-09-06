import { useEffect, useRef, useState } from "react";
import { exportReadingBackup, previewReadingBackup, restoreReadingBackup, MAX_READING_BACKUP_BYTES, type ReadingBackup } from "../lib/reading-backup";
import { exportWithDialog, isTauri } from "../lib/tauri-desktop";

interface Props {
  format: "pdf" | "epub";
  documentId: string;
  title: string;
  onClose: () => void;
  onRestored: () => void;
  onBusyChange: (busy: boolean) => void;
}

export function ReaderDataBackupPanel({ format, documentId, title, onClose, onRestored, onBusyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [backup, setBackup] = useState<ReadingBackup | null>(null);
  const [restoreProgress, setRestoreProgress] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.scrollIntoView({ block: "nearest" }); }, []);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); onBusyChange(true); setError(null); setMessage(null);
    try { await action(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; setBusy(false); onBusyChange(false); }
  };
  const exportBackup = () => run(async () => {
    const data = await exportReadingBackup(format, documentId);
    const filename = `${title.replace(/[<>:"/\\|?*]/g, "_").replace(/\p{Cc}/gu, "_").slice(0, 100) || format}.reading.json`;
    if (isTauri()) {
      if (!await exportWithDialog(data, filename)) { setMessage("已取消导出"); return; }
    } else {
      const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    setMessage("阅读数据备份已导出。请另行保留原 PDF/EPUB 文件。");
  });
  const selectBackup = (file?: File) => {
    if (!file) return;
    void run(async () => {
      setBackup(null); setRestoreProgress(false);
      if (file.size > MAX_READING_BACKUP_BYTES) throw new Error("阅读备份不能超过 20 MiB");
      const parsed = await previewReadingBackup(format, documentId, await file.text());
      setBackup(parsed);
    });
  };
  const restore = () => run(async () => {
    if (!backup) return;
    const result = await restoreReadingBackup(documentId, backup, restoreProgress);
    setBackup(null);
    setMessage(`恢复完成：新增 ${result.added} 条批注/书签，跳过重复 ${result.skipped} 条，保留冲突副本 ${result.conflicts} 条，新增断行合并 ${result.lineMergesAdded} 条。${restoreProgress ? "已恢复阅读位置与排版设置。" : "保留了当前阅读位置与排版设置。"}`);
    onRestored();
  });

  return <section ref={panelRef} className="reader-backup-panel" aria-label={`阅读数据备份：${title}`} aria-busy={busy}>
    <div className="reader-backup-heading"><strong>阅读数据备份：{title}</strong><button type="button" disabled={busy} onClick={onClose} aria-label="关闭阅读数据备份">×</button></div>
    <p className="settings-hint">仅备份这本书的高亮、备注、书签、阅读位置与排版设置（EPUB 包括人工断行合并）。不包含原文件，也不修改原文件。换设备时先导入同一份原文件，再恢复阅读数据。</p>
    <div className="settings-button-row">
      <button type="button" className="settings-btn-secondary" disabled={busy} onClick={() => void exportBackup()}>导出阅读数据</button>
      <button type="button" className="settings-btn-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>选择阅读备份</button>
      <input type="file" ref={inputRef} aria-label="阅读备份文件" accept=".json,application/json" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; selectBackup(file); }} />
    </div>
    {busy && <p role="status">正在核对文件或处理阅读数据，请稍候…</p>}
    {error && <p className="dialog-action-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {backup && <div className="reader-backup-preview">
      <p>原文件内容匹配：{backup.file.name}</p>
      <p>备份时间：{new Date(backup.exportedAt).toLocaleString()} · {backup.highlights.length} 条批注 · {backup.bookmarks.length} 个书签{backup.format === "epub" ? ` · ${backup.manualLineMerges.length} 处断行合并` : ""}</p>
      <p className="settings-hint">不会删除本地批注或书签；相同记录跳过，冲突记录另存副本。备份中的旧记录可能重新加入本地已删除的项目。恢复前请关闭其他窗口中打开的这本书，以免旧阅读位置再次保存。</p>
      <label className="reader-backup-progress"><input type="checkbox" checked={restoreProgress} disabled={busy} onChange={(event) => setRestoreProgress(event.target.checked)} />同时恢复阅读位置与排版设置（覆盖当前位置与设置）</label>
      <div className="settings-button-row">
        <button type="button" className="settings-btn-primary" disabled={busy} onClick={() => void restore()}>确认合并阅读数据</button>
        <button type="button" className="settings-btn-secondary" disabled={busy} onClick={() => setBackup(null)}>取消恢复</button>
      </div>
    </div>}
  </section>;
}
