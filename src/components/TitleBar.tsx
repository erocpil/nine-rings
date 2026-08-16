import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * 自定义标题栏（Frameless 模式）
 *
 * 提供拖拽手柄、窗口标题、关闭按钮。
 * 关闭按钮隐藏到托盘，与 CloseRequested 事件行为一致。
 */
export default function TitleBar() {
  const handleClose = async () => {
    try {
      await getCurrentWindow().hide();
    } catch (error) {
      // WebView2 恢复/切换桌面后偶发 hide IPC 失败，避免未处理 rejection 让按钮看起来失效。
      console.error("[TitleBar] 关闭窗口失败:", error);
    }
  };

  return (
    <div className="titlebar" data-tauri-drag-region="deep">
      <span className="titlebar-title">
        <img src="/app-icon.png" width="16" height="16" alt="" className="titlebar-logo" />
        Nine Rings
      </span>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-close"
          type="button"
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
