import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 自定义标题栏（Frameless 模式）
 *
 * 提供拖拽手柄、窗口标题、最小化/关闭按钮。
 * 关闭按钮隐藏到托盘，与 CloseRequested 事件行为一致。
 */
export default function TitleBar() {
  const handleMinimize = async () => {
    // 最小化 → 隐藏到托盘，不在任务栏留图标
    await getCurrentWindow().hide();
  };

  const handleClose = async () => {
    await getCurrentWindow().hide();
  };

  return (
    <div className="titlebar">
      <span className="titlebar-title">
        <img src="/app-icon.png" width="16" height="16" alt="" className="titlebar-logo" />
        Nine Rings
      </span>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-minimize"
          onClick={handleMinimize}
          aria-label="最小化"
          title="最小化"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={handleClose}
          aria-label="关闭"
          title="关闭到托盘"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M1 1l10 10M11 1L1 11"
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
