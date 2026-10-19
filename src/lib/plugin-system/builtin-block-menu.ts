/** Host-owned block operations with a bounded, declarative presentation layer. */
export const BLOCK_MENU_PLUGIN_ID = "nine-rings.builtin-block-menu";
export const BLOCK_MENU_SETTINGS_KEY = "nr:pluginBlockMenu";
export const BLOCK_MENU_CHANGE = "nr:plugin-block-menu-change";

export const BLOCK_MENU_GROUPS = [
  { id: "copy", label: "复制与引用" },
  { id: "reading", label: "阅读与导航" },
  { id: "block", label: "块设置" },
  { id: "style", label: "文字样式" },
  { id: "structure", label: "编辑与结构" },
  { id: "selection", label: "选择" },
  { id: "remove", label: "剪切与删除" },
] as const;
export type BlockMenuGroupId = (typeof BLOCK_MENU_GROUPS)[number]["id"];
export type BlockMenuFont = "inherit" | "system" | "monospace";
export type BlockMenuColor = "theme" | "accent" | "secondary";

export interface BlockMenuPresentation {
  enabled: boolean;
  title: "number-type" | "type";
  font: BlockMenuFont;
  fontSize: number;
  boldTitle: boolean;
  showHints: boolean;
  color: BlockMenuColor;
  visibleGroups: BlockMenuGroupId[];
  groupOrder: BlockMenuGroupId[];
}

export const DEFAULT_BLOCK_MENU_PRESENTATION: BlockMenuPresentation = Object.freeze({
  enabled: true,
  title: "number-type",
  font: "inherit",
  fontSize: 12,
  boldTitle: false,
  showHints: false,
  color: "secondary",
  visibleGroups: BLOCK_MENU_GROUPS.map(group => group.id),
  groupOrder: BLOCK_MENU_GROUPS.map(group => group.id),
});

function validPreference(value: unknown): value is BlockMenuPresentation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BlockMenuPresentation>;
  const validGroups = (groups: unknown): groups is BlockMenuGroupId[] =>
    Array.isArray(groups) && groups.length <= BLOCK_MENU_GROUPS.length &&
    groups.every(group => BLOCK_MENU_GROUPS.some(candidate => candidate.id === group)) &&
    new Set(groups).size === groups.length;
  return typeof item.enabled === "boolean" &&
    (item.title === "number-type" || item.title === "type") &&
    (item.font === "inherit" || item.font === "system" || item.font === "monospace") &&
    Number.isInteger(item.fontSize) && item.fontSize! >= 11 && item.fontSize! <= 18 &&
    typeof item.boldTitle === "boolean" &&
    typeof item.showHints === "boolean" &&
    (item.color === "theme" || item.color === "accent" || item.color === "secondary") &&
    validGroups(item.visibleGroups) && validGroups(item.groupOrder);
}

export function readBlockMenuPresentation(): BlockMenuPresentation {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BLOCK_MENU_SETTINGS_KEY) || "null");
    if (!validPreference(value)) return DEFAULT_BLOCK_MENU_PRESENTATION;
    return { ...DEFAULT_BLOCK_MENU_PRESENTATION, ...value };
  } catch {
    return DEFAULT_BLOCK_MENU_PRESENTATION;
  }
}

export function saveBlockMenuPresentation(value: BlockMenuPresentation) {
  if (!validPreference(value)) throw new Error("块菜单配置无效");
  localStorage.setItem(BLOCK_MENU_SETTINGS_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(BLOCK_MENU_CHANGE));
}

export function blockMenuPresentationSnapshot() {
  try { return localStorage.getItem(BLOCK_MENU_SETTINGS_KEY); } catch { return null; }
}

export function subscribeBlockMenuPresentation(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === BLOCK_MENU_SETTINGS_KEY || event.key === null) listener();
  };
  window.addEventListener(BLOCK_MENU_CHANGE, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(BLOCK_MENU_CHANGE, listener);
    window.removeEventListener("storage", storage);
  };
}

export function blockTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    paragraph: "段落", heading: "标题", bulletList: "无序列表", orderedList: "有序列表",
    listItem: "列表项", blockquote: "引用", codeBlock: "代码", mermaid: "Mermaid",
    flow: "Flow", documentToc: "目录", mathBlock: "公式", image: "图片", table: "表格",
    htmlDetails: "折叠区块", horizontalRule: "分隔线",
  };
  return labels[type] ?? type;
}

export function blockMenuTitle(presentation: BlockMenuPresentation, number: number, type: string) {
  const label = blockTypeLabel(type);
  return presentation.title === "number-type" ? `第 ${number} 块 · ${label}` : `块操作 · ${label}`;
}
