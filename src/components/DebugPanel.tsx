import { useEffect, useRef, useState } from "react";
import { getLogs, subscribe, subscribeDebugOpen, clearLogs, LogEntry } from "../lib/debugLog";

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
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

  if (!open) return null;

  return (
    <div className="debug-panel">
      <div className="debug-panel-header">
        <span className="debug-panel-title">调试日志</span>
        <button className="debug-panel-clear" onClick={clearLogs} type="button">清空</button>
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
