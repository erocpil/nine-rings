import { useEffect, useState } from "react";
import { BROWSER_HISTORY_PREFIX, clearBrowserQueueHistory, readBrowserQueueHistory } from "../lib/local-files/browser-queue-history";
import { copyToClipboard } from "../lib/clipboard";

export function FileBrowserQueueHistory({ current, onError }: { current?: string; onError: (message: string) => void }) {
  const [records, setRecords] = useState(() => readBrowserQueueHistory(current));
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === null || event.key.startsWith(BROWSER_HISTORY_PREFIX)) setRecords(readBrowserQueueHistory(current)); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [current]);
  return <details className="file-browser-queue-history"><summary>其它会话的操作记录（{records.length}）</summary>
    <p>仅供核对，不会自动执行或提供直接重试。执行中、排队中或预检中的记录不代表磁盘未写入；请核对来源和目标。其它窗口可能仍在执行。最多保留最近 5 个会话，明细有上限，不作为完整审计日志。</p>
    {records.map(record => <details key={record.session}><summary>{new Date(record.updatedAt).toLocaleString()}</summary><pre>{record.report}</pre></details>)}
    {!records.length && <p>没有其它会话记录。</p>}
    <button type="button" disabled={!records.length} onClick={() => { void copyToClipboard(records.map(record => record.report).join("\n\n"), { reportFailure: true }).catch(error => onError(String(error))); }}>复制历史记录</button>
    <button type="button" onClick={() => { try { clearBrowserQueueHistory(current); setRecords([]); } catch (error) { onError(String(error)); } }}>清除历史记录</button>
  </details>;
}
