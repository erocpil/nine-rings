import { useEffect, useRef } from "react";
import { DEFAULT_HOTKEYS } from "../types/models";
import { isTauriRuntime } from "../lib/runtime";
import { toggleTauriFullscreen } from "../lib/fullscreen";
import { registerShortcuts } from "../lib/global-shortcuts";
import {
  resolveShortcut,
  shouldIgnoreShortcut,
} from "../lib/shortcuts";

export interface AppShortcutActions {
  workspaceActive?: boolean;
  setSettingsOpen: (open: boolean) => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  openSearch: () => void;
  hotkeys?: Record<string, string>;
}

function showWindow(): void {
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      getCurrentWindow().show().then(() => {
        getCurrentWindow().unminimize().then(() => {
          getCurrentWindow().setFocus();
        });
      });
    })
    .catch(() => {});
}

/**
 * 注册 App 级键盘快捷键（Web 浏览器 keydown）与 Tauri 系统级全局热键。
 * 通过 actionsRef 读取最新回调，避免 effect 因闭包读取旧状态。
 */
export function useAppKeyboardShortcuts(actions: AppShortcutActions): void {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // ── 浏览器 keydown（Web 端快捷键）──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 编辑器扩展（尤其 Vim Normal/Visual）已经认领的组合键不能再次
      // 触发 App 级动作，例如 Ctrl+P 不应同时打开快速切换器。
      if (e.defaultPrevented) return;
      if (shouldIgnoreShortcut(e, e.target)) return;
      const action = resolveShortcut(e);
      if (!action) return;
      const a = actionsRef.current;
      if (a.workspaceActive === false && action !== "fullscreen") return;
      switch (action) {
        case "fullscreen":
          // Web 版交还给浏览器处理 F11 / macOS 原生全屏快捷键。
          if (!isTauriRuntime()) break;
          e.preventDefault();
          void toggleTauriFullscreen().catch((error) => {
            console.warn("[Fullscreen] 切换失败:", error);
          });
          break;
        case "openSettings":
          e.preventDefault();
          a.setSettingsOpen(true);
          break;
        case "openQuickSwitcher":
          e.preventDefault();
          a.setQuickSwitcherOpen(true);
          break;
        case "focusSearch":
          e.preventDefault();
          a.openSearch();
          break;

      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // ── Tauri 全局热键（系统级，窗口失焦/隐藏时仍生效）──
  const hotkeysKey = actions.hotkeys ? JSON.stringify(actions.hotkeys) : "";
  useEffect(() => {
    const a = actionsRef.current;
    void registerShortcuts(
      {
        focusSearch: () => { if (actionsRef.current.workspaceActive !== false) actionsRef.current.openSearch(); },
        openSettings: () => { if (actionsRef.current.workspaceActive !== false) actionsRef.current.setSettingsOpen(true); },
        showWindow,
      },
      { ...DEFAULT_HOTKEYS, ...(a.hotkeys ?? {}) },
    );
  }, [hotkeysKey]);
}
