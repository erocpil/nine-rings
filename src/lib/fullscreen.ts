import { isTauriRuntime } from "./runtime";

/** 编辑器在窗口开始变形前立即捕获阅读锚点。 */
export const FULLSCREEN_WILL_CHANGE_EVENT = "nine-rings:fullscreen-will-change";

export async function toggleTauriFullscreen(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  const fullscreen = await appWindow.isFullscreen();

  window.dispatchEvent(new CustomEvent(FULLSCREEN_WILL_CHANGE_EVENT, {
    detail: { fullscreen: !fullscreen },
  }));
  await appWindow.setFullscreen(!fullscreen);
  return !fullscreen;
}
