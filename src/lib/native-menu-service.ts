import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { nativeMenuSnapshot, runNativeMenuAction, subscribeNativeMenu } from "./native-menu-registry";

export async function startNativeMenuService(onError: (error: unknown) => void = error => console.warn("[Menu] 操作失败", error)) {
  let stopped = false, running = false, dirty = false;
  let previous = "";
  let focused = true;
  const contextualStates = () => {
    const active = typeof document === "undefined" ? null : document.activeElement;
    const otherInput = active && active.matches("input,textarea,[contenteditable=true]") && !active.closest(".ProseMirror,.cm-editor");
    const modal = typeof document !== "undefined" && [...document.querySelectorAll<HTMLElement>('dialog[open],[role="dialog"][aria-modal="true"]')].some(element => element.getClientRects().length > 0);
    return nativeMenuSnapshot().map(state => ({ ...state, enabled: state.enabled && focused && !modal && !(otherInput && /^(format|edit)\./.test(state.id)) }));
  };
  const update = async () => {
    dirty = true;
    if (running || stopped) return;
    running = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const states = contextualStates();
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
  const refreshFocus = () => { void update(); };
  if (typeof document !== "undefined") document.addEventListener("focusin", refreshFocus);
  let unlisten: (() => void) | undefined;
  let unfocus: (() => void) | undefined;
  try {
    const window = getCurrentWindow();
    focused = await window.isFocused();
    unfocus = await window.onFocusChanged(event => { focused = event.payload; void update(); });
    unlisten = await listen<string>("nine-rings:native-menu", event => {
      if (stopped) return;
      // Cocoa check items toggle before emitting; even a no-op or rejected
      // action must restore the host's authoritative checked state.
      previous = "";
      if (!focused || !contextualStates().find(state => state.id === event.payload)?.enabled) { void update(); return; }
      void Promise.resolve().then(() => runNativeMenuAction(event.payload)).catch(onError).finally(() => update());
    });
    await update();
  } catch (error) { unsubscribe(); unlisten?.(); unfocus?.(); if (typeof document !== "undefined") document.removeEventListener("focusin", refreshFocus); throw error; }
  return () => { if (stopped) return; stopped = true; unsubscribe(); unlisten?.(); unfocus?.(); if (typeof document !== "undefined") document.removeEventListener("focusin", refreshFocus); };
}
