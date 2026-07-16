import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 自定义标题栏（Frameless 模式）
 *
 * 提供拖拽手柄、窗口标题、最小化/最大化/关闭按钮。
 * 关闭按钮隐藏到托盘，与 CloseRequested 事件行为一致。
 */
export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setIsMaximized);
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };

  const handleMaximize = async () => {
    const win = getCurrentWindow();
    if (await win.isMaximized()) {
      await win.unmaximize();
    } else {
      await win.maximize();
    }
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
          className="titlebar-btn"
          onClick={handleMinimize}
          aria-label="最小化"
          title="最小化"
        >
          <svg width="13" height="13" viewBox="0 0 13 13">
            <rect x="2" y="6" width="9" height="1.2" rx="0.6" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          onClick={handleMaximize}
          aria-label={isMaximized ? "还原" : "最大化"}
          title={isMaximized ? "还原" : "最大化"}
        >
          {isMaximized ? (
            <svg width="13" height="13" viewBox="0 0 13 13">
              <rect x="2" y="4" width="7.5" height="7.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <rect x="4.5" y="1.5" width="7.5" height="7.5" rx="1" fill="var(--bg-secondary)" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 13 13">
              <rect x="1.5" y="1.5" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
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
