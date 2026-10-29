import { isTauriRuntime } from "./runtime";

/** 编辑器在窗口开始变形前立即捕获阅读锚点。 */
export const FULLSCREEN_CHANGED_EVENT = "nine-rings:fullscreen-changed";
export const FULLSCREEN_WILL_CHANGE_EVENT = "nine-rings:fullscreen-will-change";

/** Cancel the WebView's Escape default, after application menus handle the key.
 * Register the final bubble listener during capture so even menus opened later
 * see an unmodified event. Never stop propagation or consume IME cancellation.
 * A browser may reserve its own fullscreen Escape outside DOM cancellation.
 */
export function guardFullscreenEscape(): () => void {
  const pending = new Set<(event: KeyboardEvent) => void>();
  const capture = (event: KeyboardEvent) => {
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      (!isTauriRuntime() && !document.fullscreenElement)
    )
      return;
    const finish = (current: KeyboardEvent) => {
      if (current === event) event.preventDefault();
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("keydown", finish);
      pending.delete(finish);
    };
    pending.add(finish);
    window.addEventListener("keydown", finish);
    // A foreground dialog may stop propagation before the final bubble phase.
    // A microtask can run between native event listeners in WebKit, before
    // bubbling reaches window. Clean stopped events after the dispatch task.
    window.setTimeout(cleanup, 0);
  };
  window.addEventListener("keydown", capture, true);
  return () => {
    window.removeEventListener("keydown", capture, true);
    for (const listener of pending)
      window.removeEventListener("keydown", listener);
    pending.clear();
  };
}

export async function toggleTauriFullscreen(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const appWindow = getCurrentWindow();
  const fullscreen = await appWindow.isFullscreen();

  window.dispatchEvent(
    new CustomEvent(FULLSCREEN_WILL_CHANGE_EVENT, {
      detail: { fullscreen: !fullscreen },
    }),
  );
  await invoke("set_window_fullscreen", { fullscreen: !fullscreen });
  window.dispatchEvent(new Event(FULLSCREEN_CHANGED_EVENT));
  return !fullscreen;
}

/**
 * Hiding a native macOS fullscreen window immediately leaves its Space alive
 * with no visible content. Finish the native fullscreen transition first, then
 * hide the ordinary window. Windows and Linux use the same ordering so the
 * titlebar action has one deterministic contract on every desktop platform.
 */
export async function hideTauriWindowToTray(): Promise<void> {
  if (!isTauriRuntime()) return;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { invoke } = await import("@tauri-apps/api/core");
  const appWindow = getCurrentWindow();
  if (await appWindow.isFullscreen()) {
    window.dispatchEvent(
      new CustomEvent(FULLSCREEN_WILL_CHANGE_EVENT, {
        detail: { fullscreen: false },
      }),
    );
    await invoke("set_window_fullscreen", { fullscreen: false });

    // setFullscreen returns when Cocoa accepted the request, before the Space
    // animation necessarily completed. Wait for the native state to settle so
    // macOS can tear down the fullscreen Space before the window is hidden.
    const deadline = performance.now() + 5000;
    let settled = false;
    while (performance.now() < deadline) {
      if (!(await appWindow.isFullscreen())) {
        settled = true;
        break;
      }
      await new Promise(resolve => window.setTimeout(resolve, 50));
    }
    if (!settled)
      console.warn("[Window] 全屏状态查询超时；仍继续隐藏窗口，避免关闭按钮只退出全屏");
    window.dispatchEvent(new Event(FULLSCREEN_CHANGED_EVENT));
  }

  window.dispatchEvent(new Event("nine-rings:main-window-hide"));
  await appWindow.hide();
}
