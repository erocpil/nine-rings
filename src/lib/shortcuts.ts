// ── App 级快捷键：纯函数（无副作用，可独立单测）──

/** 最小键盘事件接口，供纯函数与测试复用（不依赖 DOM） */
export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type ShortcutAction =
  | "fullscreen"
  | "openSettings"
  | "focusSearch"
  | "goToDaily";

/** F 搜索/翻页组合固定留给编辑器，不能注册成系统级全局热键。 */
export function isDocumentFindShortcut(shortcut: string): boolean {
  const normalized = shortcut.replace(/\s+/g, "").toLowerCase();
  return [
    "commandorcontrol+f",
    "control+f",
    "ctrl+f",
    "command+f",
    "cmd+f",
    "meta+f",
    "alt+f",
  ].includes(normalized);
}

/** 识别编辑器内查找按键；Ctrl+F 专用于 Vim，搜索使用 Cmd+F 或 Alt+F。 */
export function isDocumentFindKeyEvent(e: ShortcutKeyEvent): boolean {
  const isF = e.code === "KeyF" || e.key.toLocaleLowerCase() === "f";
  if (!isF || e.shiftKey) return false;
  return (e.metaKey && !e.ctrlKey && !e.altKey) || (e.altKey && !e.ctrlKey && !e.metaKey);
}

/** Alt+G 固定留给当前编辑器的块行号跳转。 */
export function isEditorLineJumpShortcut(shortcut: string): boolean {
  return shortcut.replace(/\s+/g, "").toLowerCase() === "alt+g";
}

/** 识别编辑器内跳转行号按键；code 可规避 Windows 键盘布局差异。 */
export function isEditorLineJumpKeyEvent(e: ShortcutKeyEvent): boolean {
  const isG = e.code === "KeyG" || e.key.toLocaleLowerCase() === "g";
  return isG && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

/**
 * 将一次按键解析为 App 级快捷键动作。
 * 返回 null 表示该按键不属于 App 级快捷键（应放行给编辑器/浏览器）。
 */
export function resolveShortcut(e: ShortcutKeyEvent): ShortcutAction | null {
  // F11：全屏切换（Tauri 桌面端；Web 由浏览器原生处理）
  if (e.key === "F11" && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
    return "fullscreen";
  }
  // Alt+, ：设置（在 Ctrl 守卫之前，不依赖 ctrlKey）
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key === ",") {
    return "openSettings";
  }
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "e") {
    return "focusSearch"; // Alt+E 搜索
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return null;
  if (e.shiftKey) {
    const k = e.key.toLowerCase();
    if (k === "f") return "focusSearch"; // Ctrl+Shift+F 全局搜索
    if (k === "d") return "goToDaily"; // Ctrl+Shift+D 每日列表
    return null; // 其余 Ctrl+Shift 组合留给编辑器内置快捷键
  }
  return null;
}

/** 判断事件目标是否位于可编辑元素（input / textarea / contenteditable）内 */
export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const t = target as { isContentEditable?: boolean; tagName?: string };
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/**
 * 判断一次按键是否应因焦点落在可编辑元素内而被忽略。
 *
 * 语义：带 Ctrl/Meta/Alt 修饰的组合键为全局快捷键，始终生效；
 * 功能键（F1–F12）不属于输入字符，也不受影响；
 * 仅无修饰键的单字符键在输入框 / 编辑器聚焦时被忽略，避免与输入冲突。
 * 当前 App 级快捷键均带修饰键或为 F11，故该守卫不改变现有行为，为将来预留。
 */
export function shouldIgnoreShortcut(e: ShortcutKeyEvent, target: unknown): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (/^F\d+$/.test(e.key)) return false;
  return isEditableTarget(target);
}
