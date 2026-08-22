import { useEffect, useRef } from "react";
import type { Note } from "../types/models";
import { DEFAULT_HOTKEYS } from "../types/models";
import { isTauriRuntime } from "../lib/runtime";
import { localDateKey } from "../lib/local-date";
import { useNotesStore } from "../stores/useNotesStore";
import { registerShortcuts } from "../lib/global-shortcuts";
import {
  resolveShortcut,
  shouldIgnoreShortcut,
} from "../lib/shortcuts";

export interface AppShortcutActions {
  setSettingsOpen: (open: boolean) => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  setDate: (date: string) => Promise<void>;
  setSidebarHidden: (hidden: boolean) => void;
  setSidebarTab: (tab: "daily" | "tree") => void;
  selectNote: (note: Note | null) => void;
  createNote: () => void;
  hotkeys?: Record<string, string>;
}

function focusSearchInput(): void {
  document.querySelector<HTMLInputElement>(".search-input")?.focus();
}

function toggleFullscreen(): void {
  if (!isTauriRuntime()) return;
  import("@tauri-apps/api/window")
    .then(({ getCurrentWindow }) => {
      getCurrentWindow().isFullscreen().then((fs) => {
        getCurrentWindow().setFullscreen(!fs);
      });
    })
    .catch(() => {});
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

function goToToday(a: AppShortcutActions): void {
  const today = localDateKey();
  a.setDate(today).then(() => {
    const sel = useNotesStore.getState().selectedNote;
    if (sel?.storagePath) {
      // 若 setDate 守卫保留了文档选中，显式切到当日第一篇随笔
      const daily = useNotesStore.getState().notes.find((n) => !n.storagePath);
      a.selectNote(daily ?? null);
    }
  });
  a.setSidebarHidden(false);
  a.setSidebarTab("daily");
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
      if (shouldIgnoreShortcut(e, e.target)) return;
      const action = resolveShortcut(e);
      if (!action) return;
      const a = actionsRef.current;
      switch (action) {
        case "fullscreen":
          e.preventDefault();
          toggleFullscreen();
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
          focusSearchInput();
          break;
        case "goToDaily":
          e.preventDefault();
          goToToday(a);
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
        createNote: a.createNote,
        focusSearch: focusSearchInput,
        openSettings: () => a.setSettingsOpen(true),
        toggleDaily: () => goToToday(a),
        showWindow,
      },
      { ...DEFAULT_HOTKEYS, ...(a.hotkeys ?? {}) },
    );
  }, [hotkeysKey]);
}
