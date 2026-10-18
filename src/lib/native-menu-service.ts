import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { nativeMenuSnapshot, runNativeMenuAction, subscribeNativeMenu } from "./native-menu-registry";

export async function startNativeMenuService(onError: (error: unknown) => void = error => console.warn("[Menu] 操作失败", error)) {
  let stopped = false, running = false, dirty = false;
  let previous = "";
  let focused = true;
  const update = async () => {
    dirty = true;
    if (running || stopped) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const states = nativeMenuSnapshot().map(state => ({ ...state, enabled: state.enabled && focused }));
        const signature = JSON.stringify(states);
        if (signature !== previous) {
          await invoke("update_native_menu", { states });
          previous = signature;
        }
      }
    } catch (error) { console.warn("[Menu] 更新菜单状态失败", error); }
    finally { running = false; }
  };
  const unsubscribe = subscribeNativeMenu(() => { void update(); });
  let unlisten: (() => void) | undefined;
  let unfocus: (() => void) | undefined;
  try {
    const window = getCurrentWindow();
    focused = await window.isFocused();
    unfocus = await window.onFocusChanged(event => { focused = event.payload; void update(); });
    unlisten = await listen<string>("nine-rings:native-menu", event => {
      if (!focused || stopped) return;
      void Promise.resolve().then(() => runNativeMenuAction(event.payload)).catch(onError);
    });
    await update();
  } catch (error) { unsubscribe(); unlisten?.(); unfocus?.(); throw error; }
  return () => { if (stopped) return; stopped = true; unsubscribe(); unlisten?.(); unfocus?.(); };
}
