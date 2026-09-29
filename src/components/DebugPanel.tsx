import { useEffect, useRef, useState } from "react";
import { getLogs, subscribe, subscribeDebugOpen, clearLogs, LogEntry } from "../lib/debugLog";
import { copyToClipboard } from "../lib/clipboard";

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copyState, setCopyState] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 订阅面板开关
  useEffect(() => subscribeDebugOpen(setOpen), []);

  // 订阅日志更新
  useEffect(() => subscribe(() => setLogs(getLogs())), []);

  // 自动滚到底部
  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, open]);

  useEffect(() => {
    if (!copyState) return;
    const timer = window.setTimeout(() => setCopyState(""), 1800);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const copyLogs = async () => {
    try {
      await copyToClipboard(logs.map((entry) => `[${entry.time}] ${entry.msg}`).join("\n"), { reportFailure: true });
      setCopyState("已复制");
    } catch {
      setCopyState("复制失败");
    }
  };

  if (!open) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-header">
        <span className="debug-panel-title">调试日志</span>
        <div className="debug-panel-actions">
          {copyState && <span className="debug-copy-state" role="status">{copyState}</span>}
          <button className="debug-panel-action" onClick={() => void copyLogs()} type="button" disabled={logs.length === 0}>复制</button>
          <button className="debug-panel-action" onClick={clearLogs} type="button" disabled={logs.length === 0}>清空</button>
        </div>
      </div>
      <div className="debug-panel-body">
        {logs.length === 0 ? (
          <span className="debug-empty">暂无日志</span>
        ) : (
          logs.map((entry, i) => (
            <div key={i} className="debug-line">
              <span className="debug-time">{entry.time}</span>
              <span className="debug-msg">{entry.msg}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
