import type { BrowserSettingsStore } from "./browser-workspace-contract";

export const BROWSER_SHORTCUTS_KEY = "nr:fileBrowserShortcuts:v1";
export const BROWSER_SHORTCUTS_EVENT = "nr:file-browser-shortcuts-change";
export const browserShortcutCommands = [
  { id: "address", label: "编辑当前路径", group: "浏览与定位", defaults: ["Mod+L"], scope: "当前目录栏" },
  { id: "filter", label: "过滤文件名称", group: "浏览与定位", defaults: ["Mod+F"], scope: "当前目录栏" },
  { id: "home", label: "返回固定目录", group: "浏览与定位", defaults: ["Alt+Home"], scope: "文件列表" },
  { id: "refresh", label: "刷新目录", group: "浏览与定位", defaults: [], scope: "文件列表" },
  { id: "exchange", label: "交换两栏", group: "浏览与定位", defaults: [], scope: "文件列表" },
  { id: "mirror", label: "两栏同路径", group: "浏览与定位", defaults: [], scope: "文件列表" },
  { id: "preview", label: "快速预览", group: "预览与查找", defaults: ["Space", "F3"], scope: "文件列表" },
  { id: "search", label: "搜索正文", group: "预览与查找", defaults: [], scope: "文件列表" },
  { id: "compare", label: "比较目录", group: "预览与查找", defaults: [], scope: "文件列表" },
  { id: "copy", label: "复制到另一栏", group: "文件操作", defaults: ["F5"], scope: "文件列表" },
  { id: "move", label: "移动到另一栏", group: "文件操作", defaults: ["F6"], scope: "文件列表" },
  { id: "rename", label: "重命名", group: "文件操作", defaults: ["F2"], scope: "文件列表" },
  { id: "batch-rename", label: "批量重命名", group: "文件操作", defaults: [], scope: "文件列表" },
  { id: "file", label: "新建文件", group: "文件操作", defaults: [], scope: "文件列表" },
  { id: "directory", label: "新建文件夹", group: "文件操作", defaults: ["F7"], scope: "文件列表" },
  { id: "trash", label: "移入系统回收站", group: "文件操作", defaults: ["F8"], scope: "文件列表" },
  { id: "queue", label: "操作队列", group: "任务", defaults: [], scope: "文件列表" },
] as const;
export type BrowserShortcutId = typeof browserShortcutCommands[number]["id"];
export type BrowserShortcuts = Record<BrowserShortcutId, string[]>;
export interface ShortcutReservation { shortcut: string; label: string }
export const defaultBrowserShortcuts = (): BrowserShortcuts => Object.fromEntries(browserShortcutCommands.map(command => [command.id, [...command.defaults]])) as BrowserShortcuts;
const modifierNames: Record<string, string> = { mod: "Mod", commandorcontrol: "Mod", ctrl: "Ctrl", control: "Ctrl", meta: "Meta", cmd: "Meta", command: "Meta", super: "Meta", alt: "Alt", option: "Alt", shift: "Shift" };
const order = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];
export function normalizeBrowserShortcut(value: string): string | null {
  if (value.length > 60) return null;
  const parts = value.trim().split("+").map(part => part.trim());
  const key = parts.pop() ?? "";
  const normalizedKey = /^f(?:[1-9]|1\d|2[0-4])$/i.test(key) || /^[a-z0-9]$/i.test(key) ? key.toUpperCase() : ({ space: "Space", home: "Home", end: "End", arrowleft: "ArrowLeft", arrowright: "ArrowRight", arrowup: "ArrowUp", arrowdown: "ArrowDown", ',': ',', '.': '.' } as Record<string, string>)[key.toLowerCase()];
  const modifiers = parts.map(part => modifierNames[part.toLowerCase()]);
  if (!normalizedKey || modifiers.some(part => !part) || new Set(modifiers).size !== modifiers.length) return null;
  return [...order.filter(part => modifiers.includes(part)), normalizedKey].join("+");
}
function effective(shortcut: string, mac: boolean) {
  return [...new Set(shortcut.split("+").map(part => part === "Mod" ? mac ? "Meta" : "Ctrl" : part))].sort().join("+");
}
export function browserShortcutFromEvent(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, mac: boolean): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
  const key = event.key === " " ? "Space" : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key;
  const modifiers = [event.ctrlKey ? mac ? "Ctrl" : "Mod" : "", event.metaKey ? mac ? "Mod" : "Meta" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
  return normalizeBrowserShortcut([...modifiers, key].join("+"));
}
export function browserShortcutAction(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "defaultPrevented" | "repeat"> & { isComposing?: boolean }, config: BrowserShortcuts, mac: boolean, reservations: readonly ShortcutReservation[] = []): BrowserShortcutId | null {
  const key = browserShortcutFromEvent(event, mac);
  if (!key || event.defaultPrevented || event.repeat || ("isComposing" in event && event.isComposing)) return null;
  if (reservations.some(item => { const binding = normalizeBrowserShortcut(item.shortcut); return binding && effective(binding, mac) === effective(key, mac); })) return null;
  return browserShortcutCommands.find(command => config[command.id].some(binding => effective(binding, mac) === effective(key, mac)))?.id ?? null;
}
export function validateBrowserShortcuts(config: BrowserShortcuts, mac: boolean, reservations: readonly ShortcutReservation[] = []): string | null {
  const used = new Map<string, string>();
  const reserved = ["Mod+A", "Mod+C", "Mod+V", "Mod+X", "Mod+Z", "Mod+Shift+Z", "Mod+Q", "Mod+W", "Mod+R", "Mod+T", "Alt+F4", "Alt+Y", "Meta+Ctrl+F", "Mod+Space", "Ctrl+Space", "Shift+F10", "Mod+H", "Mod+M"];
  for (const command of browserShortcutCommands) {
    const bindings = config[command.id];
    if (!Array.isArray(bindings) || bindings.length > 2) return `${command.label}的快捷键无效。`;
    for (const value of bindings) {
      if (typeof value !== "string") return `${command.label}的快捷键无效。`;
      const normalized = normalizeBrowserShortcut(value);
      if (!normalized || normalized !== value || (!normalized.includes("+") && !/^F\d+$/.test(normalized) && !(command.id === "preview" && normalized === "Space"))) return "请使用带修饰键的组合或功能键；普通输入和导航按键需保留。";
      const signature = effective(normalized, mac);
      if (reserved.some(binding => effective(binding, mac) === signature) || (!mac && normalized.split("+").includes("Meta"))) return `${displayBrowserShortcut(normalized, mac)} 是系统或通用编辑保留按键。`;
      const hostConflict = reservations.find(item => { const binding = normalizeBrowserShortcut(item.shortcut); return binding && effective(binding, mac) === signature; });
      if (hostConflict) return `${displayBrowserShortcut(normalized, mac)} 已用于“${hostConflict.label}”。`;
      const existing = used.get(signature);
      if (existing) return `“${command.label}”与“${existing}”重复使用 ${displayBrowserShortcut(normalized, mac)}，请先解除该绑定。`;
      used.set(signature, command.label);
    }
  }
  return null;
}
export function readBrowserShortcuts(store: BrowserSettingsStore, mac = false): BrowserShortcuts {
  const defaults = defaultBrowserShortcuts();
  try {
    const value: unknown = JSON.parse(store.getItem(BROWSER_SHORTCUTS_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
    const record = value as Record<string, unknown>;
    for (const command of browserShortcutCommands) {
      if (!(command.id in record)) continue;
      const bindings = record[command.id];
      if (!Array.isArray(bindings) || bindings.length > 2 || bindings.some(item => typeof item !== "string")) return defaults;
      const normalized = bindings.map(item => normalizeBrowserShortcut(item as string));
      if (normalized.some(item => item === null)) return defaults;
      defaults[command.id] = normalized as string[];
    }
    return validateBrowserShortcuts(defaults, mac) ? defaultBrowserShortcuts() : defaults;
  } catch { return defaults; }
}
export function saveBrowserShortcuts(store: BrowserSettingsStore, config: BrowserShortcuts, mac: boolean, reservations: readonly ShortcutReservation[] = []) {
  const error = validateBrowserShortcuts(config, mac, reservations);
  if (error) throw new Error(error);
  store.setItem(BROWSER_SHORTCUTS_KEY, JSON.stringify(config));
  window.dispatchEvent(new Event(BROWSER_SHORTCUTS_EVENT));
}
export function displayBrowserShortcut(value: string, mac: boolean) {
  return value.split("+").map(part => part === "Mod" ? mac ? "⌘" : "Ctrl" : part === "Meta" && mac ? "⌘" : part === "Alt" && mac ? "⌥" : part === "Space" ? "空格" : part).join(" + ");
}
