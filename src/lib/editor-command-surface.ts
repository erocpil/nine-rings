/** Internal UI adapter: the live host toolbar owns commands, enabled state and selection guards. */
export type EditorCommandGroup = "编辑" | "文字格式" | "段落" | "插入" | "表格" | "文档";
export interface EditorSurfaceCommand {
  id: string;
  label: string;
  group: EditorCommandGroup;
  disabled: boolean;
  active: boolean;
  submenu: boolean;
  source: HTMLButtonElement;
}
export const editorCommandGroups: EditorCommandGroup[] = ["编辑", "文字格式", "段落", "插入", "表格", "文档"];
const anchors = new WeakMap<HTMLElement, DOMRect>();
export function commandMenuAnchor(menu: HTMLElement): DOMRect | undefined {
  const owner = menu.closest<HTMLElement>(".menu-dropdown");
  return owner ? anchors.get(owner) : undefined;
}
export function clearCommandAnchors(toolbar: HTMLElement) {
  toolbar.querySelectorAll<HTMLElement>(".menu-dropdown").forEach(owner => anchors.delete(owner));
}
function group(label: string): EditorCommandGroup {
  if (/表格|单元格|当前行|当前列/.test(label)) return "表格";
  if (/复制|剪切|粘贴|撤销|重做|全选|查找/.test(label)) return "编辑";
  if (/字号|颜色|背景色|加粗|斜体|删除线|行内代码|清除格式|清除文本/.test(label)) return "文字格式";
  if (/标题|^正文|引用 \(|列表|缩进|代码块|块内换行|退出当前块/.test(label)) return "段落";
  if (/导出|书签|代码行号/.test(label)) return "文档";
  return "插入";
}
export function readEditorCommands(toolbar: HTMLElement): EditorSurfaceCommand[] {
  return [...toolbar.querySelectorAll<HTMLButtonElement>("button")]
    .filter(button => !button.closest(".menu-dropdown-list") && (!button.closest("[hidden]") || button.dataset.contextVisible === "true") && !button.hasAttribute("data-command-presentation-only"))
    .map((button, index) => {
      const label = button.title || button.getAttribute("aria-label") || button.textContent?.trim() || "操作";
      return { id: `${index}:${label}`, label, group: group(label), disabled: button.disabled,
        active: button.classList.contains("active") || button.getAttribute("aria-pressed") === "true",
        submenu: button.hasAttribute("aria-expanded"), source: button };
    });
}
export function invokeEditorCommand(command: EditorSurfaceCommand, anchor: HTMLElement) {
  const original = command.source;
  if (!original.isConnected || original.disabled || original.closest("[inert]")) return;
  const owner = original.closest<HTMLElement>(".menu-dropdown");
  if (owner) anchors.set(owner, anchor.getBoundingClientRect());
  original.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse", button: 0 }));
  original.click();
  // Existing open popovers also need to follow a newly selected invocation surface.
  window.dispatchEvent(new Event("nr:editor-command-anchor"));
}
