import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getLogs, subscribe } from "../lib/debugLog";
import { copyToClipboard } from "../lib/clipboard";
import { WorkspaceDialog } from "./WorkspaceDialog";

/** Available independently of the editor, focus mode and readonly renderer. */
export function SyncLogDialog({ onClose }: { onClose: () => void }) {
  const logs = useSyncExternalStore(subscribe, getLogs);
  const [message, setMessage] = useState("");
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Safari may move focus to the body after a mouse click on a button.
    // Escape must still close only this modal, leaving Settings underneath.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"][aria-modal="true"]',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (dialogs[dialogs.length - 1] !== content.current?.closest('[role="dialog"]'))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onClose]);
  const text = logs
    .filter((entry) => entry.msg.startsWith("[Sync]"))
    .map((entry) => `[${entry.time}] ${entry.msg}`)
    .join("\n");
  return (
    <WorkspaceDialog title="同步日志" onClose={onClose}>
      <div className="sync-log-tools" ref={content}>
        <p>当前会话的 GitHub 备份日志；关闭应用后不会保留。</p>
        <button
          type="button"
          className="settings-btn"
          disabled={!text}
          onClick={() => {
            void copyToClipboard(text, { reportFailure: true }).then(
              () => setMessage("已复制同步日志"),
              () => setMessage("复制失败，请选择日志文本后复制"),
            );
          }}
        >
          复制同步日志
        </button>
        <span role="status">{message}</span>
      </div>
      <pre className="sync-log-content" tabIndex={0} aria-label="同步日志内容">
        {text || "当前会话暂无同步日志。执行 Push / Pull 后可在这里查看。"}
      </pre>
    </WorkspaceDialog>
  );
}
