/**
 * Tauri 全局热键模块
 *
 * 仅在 Tauri 桌面环境下有效。Web 端使用浏览器 keydown 事件。
 * 全局热键在窗口失焦/隐藏时依然工作。
 */

import { isTauri } from "./tauri-desktop";

export interface ShortcutActions {
  createNote: () => void;
  focusSearch: () => void;
  openSettings: () => void;
}

/**
 * 注册全局热键。返回清理函数。
 * 非 Tauri 环境直接返回空函数。
 */
export async function registerShortcuts(actions: ShortcutActions): Promise<() => void> {
  if (!isTauri()) return () => {};

  try {
    const { register } = await import("@tauri-apps/plugin-global-shortcut");
    const { invoke } = await import("@tauri-apps/api/core");

    // Ctrl+N — 新建随笔
    await register("CommandOrControl+N", () => {
      actions.createNote();
    });

    // Ctrl+Alt+N — Quick Capture 迷你输入窗
    await register("CommandOrControl+Alt+N", () => {
      invoke("toggle_quick_capture").catch((e) =>
        console.warn("[GlobalShortcut] toggle_quick_capture:", e),
      );
    });

    // Ctrl+E — 聚焦搜索
    await register("CommandOrControl+E", () => {
      actions.focusSearch();
    });

    // Ctrl+, — 打开设置
    await register("CommandOrControl+,", () => {
      actions.openSettings();
    });

    return () => {
      import("@tauri-apps/plugin-global-shortcut").then(({ unregister }) => {
        unregister("CommandOrControl+N").catch(() => {});
        unregister("CommandOrControl+Alt+N").catch(() => {});
        unregister("CommandOrControl+E").catch(() => {});
        unregister("CommandOrControl+,").catch(() => {});
      }).catch(() => {});
    };
  } catch (e) {
    console.warn("[GlobalShortcut] 注册失败:", e);
    return () => {};
  }
}
