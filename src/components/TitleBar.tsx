import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 自定义标题栏（Frameless 模式）
 *
 * 提供拖拽手柄、窗口标题、关闭按钮。
 * 关闭按钮隐藏到托盘，与 CloseRequested 事件行为一致。
 * 最大化/最小化按钮已移除（Windows 下功能不稳定）。
 */
export default function TitleBar() {
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
