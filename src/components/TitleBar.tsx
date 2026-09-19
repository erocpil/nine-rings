import { useEffect, useRef, useState, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { toggleTauriFullscreen } from "../lib/fullscreen";

/**
 * 自定义标题栏（Frameless 模式）
 *
 * 提供拖拽手柄、窗口标题、全屏与关闭按钮。
 * 关闭按钮隐藏到托盘，与 CloseRequested 事件行为一致。
 */
export default function TitleBar() {
  const [fullscreen, setFullscreen] = useState(false);
  const macOS = /Mac/i.test(navigator.platform);
  const maximizePress = useRef<{ x: number; y: number } | null>(null);
  const maximizing = useRef(false);

  const isTitlebarBackground = (event: MouseEvent<HTMLDivElement>) =>
    event.target instanceof Element
    && !event.target.closest(".titlebar-controls, button, a, input, select, textarea, [contenteditable]");

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!macOS) return;
    maximizePress.current = null;
    if (event.button !== 0 || event.detail !== 2 || !isTitlebarBackground(event)) return;
    // macOS 的双击在第二次松开时处理。拦截默认 drag-region 处理，
    // 防止同一次手势既触发我们的最大化逻辑又触发 Tauri 的内部切换。
    event.preventDefault();
    event.stopPropagation();
    maximizePress.current = { x: event.clientX, y: event.clientY };
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (!macOS || event.button !== 0 || event.detail !== 2 || !isTitlebarBackground(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const press = maximizePress.current;
    maximizePress.current = null;
    // 容许轻微手抖，但双击后拖动仍取消最大化。
    if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4 || maximizing.current) return;
    maximizing.current = true;
    void (async () => {
      const appWindow = getCurrentWindow();
      // 已在原生全屏时不改变 Space，也不修改退出全屏后的窗口状态。
      if (!await appWindow.isFullscreen()) await invoke("toggle_window_maximize");
    })().catch(error => {
      console.error("[TitleBar] 最大化/还原窗口失败:", error);
    }).finally(() => { maximizing.current = false; });
  };

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;

    const syncFullscreen = async () => {
      const next = await appWindow.isFullscreen();
      if (!disposed) setFullscreen(next);
    };

    void syncFullscreen().catch(() => {});
    void appWindow.onResized(() => {
      // macOS 原生全屏会经过异步 Space 动画；读取真实状态，避免按钮
      // 依赖 setFullscreen 的瞬时返回值。
      void syncFullscreen().catch(() => {});
    }).then((unlisten) => {
      if (disposed) unlisten();
      else unlistenResize = unlisten;
    }).catch(() => {});

    return () => {
      disposed = true;
      unlistenResize?.();
    };
  }, []);

  const handleFullscreen = async () => {
    try {
      const next = await toggleTauriFullscreen();
      if (next !== null) setFullscreen(next);
    } catch (error) {
      console.error("[TitleBar] 切换全屏失败:", error);
    }
  };

  const handleClose = async () => {
    try {
      window.dispatchEvent(new Event("nine-rings:main-window-hide"));
      await getCurrentWindow().hide();
    } catch (error) {
      // WebView2 恢复/切换桌面后偶发 hide IPC 失败，避免未处理 rejection 让按钮看起来失效。
      console.error("[TitleBar] 关闭窗口失败:", error);
    }
  };

  return (
    <div className="titlebar" data-tauri-drag-region="deep"
      onMouseDownCapture={handleMouseDown} onMouseUpCapture={handleMouseUp}>
      <span className="titlebar-title">
        <img src="/app-icon.png" width="16" height="16" alt="" className="titlebar-logo" />
        Nine Rings
      </span>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn titlebar-btn-fullscreen"
          type="button"
          onClick={handleFullscreen}
          aria-label={fullscreen ? "退出全屏" : "进入全屏"}
          title={`${fullscreen ? "退出全屏" : "进入全屏"}（macOS: ⌃⌘F；Windows/Linux: F11）`}
        >
          {fullscreen ? (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M5.5 1v4.5H1M8.5 1v4.5H13M5.5 13V8.5H1M8.5 13V8.5H13" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M5.5 1H1v4.5M8.5 1H13v4.5M5.5 13H1V8.5M8.5 13H13V8.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          )}
        </button>
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
