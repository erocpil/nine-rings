import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState, useEffect } from "react";

/**
 * 自定义标题栏（Frameless 模式）
 *
 * 提供拖拽手柄、窗口标题、最小化/最大化/关闭按钮。
 * 关闭按钮隐藏到托盘，与 CloseRequested 事件行为一致。
 */
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const w = getCurrentWindow();
    w.isMaximized().then(setIsMaximized).catch(() => {});
    const unlisten = w.onResized(() => {
      w.isMaximized().then(setIsMaximized).catch(() => {});
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const w = getCurrentWindow();
    await w.toggleMaximize();
  };

  const handleClose = async () => {
    await getCurrentWindow().hide();
  };

  return (
    <div className="titlebar" data-tauri-drag-region>
      <span className="titlebar-title">
        <img src="/app-icon.png" width="16" height="16" alt="" className="titlebar-logo" />
        Nine Rings
      </span>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-min"
          onClick={handleMinimize}
          aria-label="最小化"
          title="最小化"
        >
          <svg width="13" height="13" viewBox="0 0 13 13">
            <path
              d="M3 6.5h7"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-max"
          onClick={handleMaximize}
          aria-label={isMaximized ? "还原" : "最大化"}
          title={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? (
            <svg width="13" height="13" viewBox="0 0 13 13">
              <rect x="2" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5 3.5V2.5C5 1.95 5.45 1.5 6 1.5H10.5C11.05 1.5 11.5 1.95 11.5 2.5V7C11.5 7.55 11.05 8 10.5 8H9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13">
              <rect x="1.5" y="1.5" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          )}
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={handleClose}
          aria-label="关闭"
          title="关闭到托盘"
        >
          <svg width="13" height="13" viewBox="0 0 13 13">
            <path
              d="M3 3l7 7M10 3l-7 7"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
