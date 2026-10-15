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
