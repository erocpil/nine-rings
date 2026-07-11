/**
 * Tauri 全局热键模块
 *
 * 仅在 Tauri 桌面环境下有效。Web 端使用浏览器 keydown 事件。
 * 全局热键在窗口失焦/隐藏时依然工作。
 *
 * 热键可配置：调用 registerShortcuts(actions, bindings)，
 * bindings 为 { action_id: shortcut_string } 映射表。
 * 重复调用会自动注销旧绑定、注册新绑定。
 */

import { isTauri } from "./tauri-desktop";

export interface ShortcutActions {
  createNote: () => void;
  focusSearch: () => void;
  openSettings: () => void;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let gUnregisterAll: (() => void) | null = null;

/// 根据 action_id 构造处理函数
function makeHandler(
  id: string,
  actions: ShortcutActions,
  invoke: InvokeFn,
): (() => void) | null {
  switch (id) {
    case "new_note":
      return () => actions.createNote();
    case "quick_capture":
      return () => {
        invoke("toggle_quick_capture").catch((e) =>
          console.warn("[GlobalShortcut] toggle_quick_capture:", e),
        );
      };
    case "focus_search":
      return () => actions.focusSearch();
    case "open_settings":
      return () => actions.openSettings();
    default:
      return null;
  }
}

/**
 * 注册全局热键。重复调用自动注销旧绑定。
 *
 * @param actions  操作回调（new_note/quick_capture 需要 invoke）
 * @param bindings { action_id: "CommandOrControl+N" }
 */
export async function registerShortcuts(
  actions: ShortcutActions,
  bindings: Record<string, string>,
): Promise<void> {
  // 先注销旧的
  if (gUnregisterAll) {
    gUnregisterAll();
    gUnregisterAll = null;
  }

  if (!isTauri()) return;

  try {
    const { register } = await import("@tauri-apps/plugin-global-shortcut");
    const { invoke } = await import("@tauri-apps/api/core");

    const unregFns: (() => void)[] = [];

    for (const [id, shortcut] of Object.entries(bindings)) {
      const handler = makeHandler(id, actions, invoke);
      if (!handler) continue;
      if (!shortcut || shortcut.trim() === "") continue;

      try {
        await register(shortcut, handler);
        unregFns.push(() => {
          import("@tauri-apps/plugin-global-shortcut")
            .then(({ unregister }) => {
              unregister(shortcut).catch(() => {});
            })
            .catch(() => {});
        });
      } catch (e) {
        console.warn(`[GlobalShortcut] ${shortcut}:`, e);
      }
    }

    gUnregisterAll = () => unregFns.forEach((fn) => fn());
  } catch (e) {
    console.warn("[GlobalShortcut] 初始化失败:", e);
  }
}
