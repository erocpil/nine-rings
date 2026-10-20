import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getLogs, subscribe, clearLogs } from "../lib/debugLog";
import { copyToClipboard } from "../lib/clipboard";
import { ToolbarIcon } from "./ToolbarIcon";

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const logs = useSyncExternalStore(subscribe, getLogs);
  const [copyState, setCopyState] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  // 自动滚到底部
  useEffect(() => {
    if (!open) return;
    const body = bodyRef.current;
    if (body) body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
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

  return (
    <section className="settings-debug-log">
      <button className="settings-debug-log-toggle" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <ToolbarIcon name="bug" />
        <span>调试日志</span>
        <ToolbarIcon name={open ? "chevronDown" : "chevronRight"} />
      </button>
      {open && <div className="debug-panel debug-panel-inline">
        <div className="debug-panel-header">
          <span className="debug-panel-title">{logs.length} 条记录</span>
          <div className="debug-panel-actions">
            {copyState && <span className="debug-copy-state" role="status">{copyState}</span>}
            <button className="debug-panel-action" onClick={() => void copyLogs()} type="button" disabled={logs.length === 0}>复制</button>
            <button className="debug-panel-action" onClick={clearLogs} type="button" disabled={logs.length === 0}>清空</button>
          </div>
        </div>
        <div className="debug-panel-body" ref={bodyRef}>
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
        </div>
      </div>
      }
    </section>
  );
}
