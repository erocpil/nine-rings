import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { getLogs, subscribe, subscribeDebugOpen, clearLogs } from "../lib/debugLog";
import { copyToClipboard } from "../lib/clipboard";

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const logs = useSyncExternalStore(subscribe, getLogs);
  const [copyState, setCopyState] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 订阅面板开关
  useEffect(() => subscribeDebugOpen(setOpen), []);

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

  // Match the actual status-bar rule endpoints. Measuring the rendered rule
  // avoids assumptions about native overlay scrollbars and pinned dock width.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const host = panel?.closest<HTMLElement>(".app-main-editor");
    if (!panel || !host || !window.matchMedia("(min-width: 769px)").matches) return;
    const align = () => {
      const status = [...host.querySelectorAll<HTMLElement>(".editor-stats")]
        .find(element => element.getClientRects().length > 0 && getComputedStyle(element).display !== "none");
      if (!status || !status.closest(".app-desktop-workspace")) return;
      const rect = status.getBoundingClientRect();
      const parentRect = host.getBoundingClientRect();
      const rule = getComputedStyle(status, "::before");
      const left = Number.parseFloat(rule.left);
      const right = Number.parseFloat(rule.right);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return;
      const ruleLeft = rect.left + left;
      const ruleRight = rect.right - right;
      panel.style.marginLeft = `${Math.max(0, ruleLeft - parentRect.left)}px`;
      panel.style.marginRight = `${Math.max(0, parentRect.right - ruleRight)}px`;
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(host);
    for (const status of host.querySelectorAll<HTMLElement>(".editor-stats")) observer.observe(status);
    window.addEventListener("resize", align);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", align);
      panel.style.removeProperty("margin-left");
      panel.style.removeProperty("margin-right");
    };
  }, [open]);

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
    <div className="debug-panel" ref={panelRef}>
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
