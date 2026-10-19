import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BLOCK_MENU_GROUPS, blockMenuTitle, readBlockMenuPresentation, subscribeBlockMenuPresentation, blockMenuPresentationSnapshot, type BlockMenuGroupId, type BlockMenuPresentation } from "../lib/plugin-system/builtin-block-menu";

export interface BlockMenuAction {
  label: string; run: () => void; disabled?: boolean; danger?: boolean; children?: BlockMenuAction[];
  group?: string;
  checked?: boolean;
  keepOpen?: boolean;
  inputControl?: { value: string; multiline?: boolean; normalize?: (value: string) => string; valid?: (value: string) => boolean; apply: (value: string) => void };
  colorControl?: { value: string; apply: (value: string) => void };
}

const ACTION_HINTS: Record<string, string> = {
  "复制内容": "复制当前块的渲染内容。", "复制 Markdown": "复制为可编辑的 Markdown 源码。", "复制纯文本": "只复制文本，不包含块格式。",
  "复制块引用": "复制可跳转回此处的引用。", "添加块书签": "在当前块设置一个书签。", "打开块模式": "在专注工作区单独查看此块。",
  "剪切此块": "写入剪贴板成功后再从文档删除。", "删除此块": "删除当前块，可通过撤销恢复。", "增加缩进": "只调整当前块的缩进。",
  "减少缩进": "只调整当前块的缩进。", "清除文字样式": "清除块内显式文字样式，保留语义结构。", "块级功能": "打开当前块类型专属的配置。",
};

/** Shared presentation grouping for gutter and title-bar menus, including readonly. */
export function groupBlockMenuActions(actions: BlockMenuAction[], presentation?: BlockMenuPresentation): BlockMenuAction[] {
  const labelsByGroup: Record<BlockMenuGroupId, string[]> = {
    copy: ["复制内容", "复制 Markdown", "复制纯文本", "复制块引用"],
    reading: ["添加块书签", "取消块书签", "打开块模式", "折叠 / 展开本节", "折叠 / 展开此块"],
    block: ["块级功能"],
    style: ["粗体", "斜体", "文字字号", "文字颜色", "清除文字样式"],
    structure: ["在上方插入段落", "在下方插入段落", "在本块前粘贴块", "在本块后粘贴块", "复制副本", "增加缩进", "减少缩进", "转换类型"],
    selection: ["选择多个块"],
    remove: ["剪切此块", "删除此块"],
  };
  const configured = Boolean(presentation?.enabled);
  const order = configured ? presentation!.groupOrder : BLOCK_MENU_GROUPS.map(group => group.id);
  const requested = configured ? new Set(presentation!.visibleGroups) : new Set(BLOCK_MENU_GROUPS.map(group => group.id));
  // An empty configuration must not strand the user with a blank menu.
  const visible = requested.size ? requested : new Set(BLOCK_MENU_GROUPS.map(group => group.id));
  return order.flatMap<BlockMenuAction>(id => {
    if (!visible.has(id)) return [];
    const group = BLOCK_MENU_GROUPS.find(item => item.id === id)!;
    return actions.filter(action => labelsByGroup[id].includes(action.label)).map(action => ({ ...action, group: group.label }));
  }).concat(actions.filter(action => !BLOCK_MENU_GROUPS.some(group => labelsByGroup[group.id].includes(action.label))));
}

function ColorControl({ action, onClose }: { action: BlockMenuAction; onClose: () => void }) {
  const [value, setValue] = useState(action.colorControl!.value);
  const changed = value.toLowerCase() !== action.colorControl!.value.toLowerCase();
  return <div className="block-menu-color-control">
    <label>{action.label}<input type="color" aria-label={action.label} value={value} disabled={action.disabled} onChange={event => setValue(event.target.value)} /></label>
    <button type="button" role="menuitem" className="editor-context-item block-menu-confirm" disabled={action.disabled || !changed} onClick={() => { if (action.disabled || !changed) return; action.colorControl!.apply(value); onClose(); }}>应用颜色</button>
  </div>;
}
function InputControl({ action, onClose }: { action: BlockMenuAction; onClose: () => void }) {
  const control = action.inputControl!;
  const [value, setValue] = useState(control.value);
  const valid = !control.valid || control.valid(value);
  const normalize = control.normalize ?? ((text: string) => text);
  const canApply = !action.disabled && valid && normalize(value) !== normalize(control.value);
  const props = { "aria-label": action.label, disabled: action.disabled, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value) };
  return <form className="block-menu-input-control" onSubmit={event => { event.preventDefault(); if (!canApply) return; control.apply(value); onClose(); }}>
    <label>{action.label}{control.multiline ? <textarea {...props} rows={5} /> : <input {...props} />}</label>
    <button type="submit" className="editor-context-item block-menu-confirm" disabled={!canApply}>应用</button>
    {!valid && <small role="alert">请输入有效值</small>}
  </form>;
}
function menuPosition(rect: DOMRect, menu: DOMRect, placement: "side" | "below") {
  const below = rect.bottom + 6;
  const above = rect.top - menu.height - 6;
  const y = placement === "below"
    ? below + menu.height <= window.innerHeight - 8 ? below : above >= 8 ? above : below
    : rect.top;
  return {
    x: Math.max(8, Math.min(placement === "below" ? rect.left : rect.right + 6, window.innerWidth - menu.width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menu.height - 8)),
  };
}
export function BlockActionMenu({ trigger, title, actions, onClose, placement = "side", blockNumber, blockType }: {
  trigger: HTMLElement; title: string; actions: BlockMenuAction[]; onClose: () => void; placement?: "side" | "below"; blockNumber?: number; blockType?: string;
}) {
  useSyncExternalStore(subscribeBlockMenuPresentation, blockMenuPresentationSnapshot);
  const presentation = readBlockMenuPresentation();
  const displayedTitle = presentation.enabled && blockNumber !== undefined && blockType
    ? blockMenuTitle(presentation, blockNumber, blockType)
    : title;
  const presentedActions = groupBlockMenuActions(actions, presentation);
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const [submenuPath, setSubmenuPath] = useState<string[]>([]);
  const [flyouts, setFlyouts] = useState<{ path: string[]; x: number; y: number }[]>([]);
  let visibleActions = presentedActions;
  for (const label of submenuPath) {
    visibleActions = visibleActions.find(action => action.label === label)?.children ?? [];
  }
  useLayoutEffect(() => {
    const rect = trigger.getBoundingClientRect();
    const menu = root.current!.getBoundingClientRect();
    setPosition(menuPosition(rect, menu, placement));
    root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [trigger, submenuPath, placement]);
  useEffect(() => {
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node) && !trigger.contains(event.target as Node)) onClose(); };
    const scroll = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return;
      if (placement !== "below" || !root.current || !trigger.isConnected) { onClose(); return; }
      const rect = trigger.getBoundingClientRect(), menu = root.current.getBoundingClientRect();
      const next = menuPosition(rect, menu, placement);
      setPosition(previous => previous.x === next.x && previous.y === next.y ? previous : next);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose, trigger, placement]);
  const actionsAt = (path: string[]) => path.reduce<BlockMenuAction[]>((items, label) => items.find(action => action.label === label)?.children ?? [], presentedActions);
  const showSubmenu = (button: HTMLElement, action: BlockMenuAction, path: string[]) => {
    const parent = button.closest(".block-action-menu-specific") ?? root.current!;
    const menu = parent.getBoundingClientRect(), item = button.getBoundingClientRect();
    const width = 188;
    const x = menu.right + width <= window.innerWidth - 8 ? menu.right
      : menu.left - width >= 8 ? menu.left - width : null;
    const depth = path.length - submenuPath.length;
    if (x === null) { setFlyouts(current => current.slice(0, depth)); return; }
    const height = Math.min(440, window.innerHeight - 16, 40 + (action.children?.length ?? 0) * 34);
    setFlyouts(current => [...current.slice(0, depth), { path: [...path, action.label], x, y: Math.max(8, Math.min(item.top, window.innerHeight - height - 8)) }]);
  };
  const renderActions = (items: BlockMenuAction[], path: string[]) => <>{items.map((action, index) => <div key={action.label}>
      {!path.length && action.group && action.group !== items[index - 1]?.group && <div className={`block-action-menu-group${index === 0 ? " first-group" : ""}`} role="presentation">{action.group}</div>}
      {action.inputControl ? <InputControl action={action} onClose={onClose} /> : action.colorControl ? <ColorControl action={action} onClose={onClose} /> : <button type="button" role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={action.checked} className={`editor-context-item${action.danger ? " block-action-danger" : ""}`} disabled={action.disabled} aria-haspopup={action.children ? "menu" : undefined}
        aria-expanded={action.children ? flyouts.some(menu => menu.path.join("/") === [...path, action.label].join("/")) : undefined}
        title={presentation?.enabled && presentation.showHints ? ACTION_HINTS[action.label] : undefined}
        onPointerEnter={event => {
          if (event.pointerType !== "mouse") return;
          if (action.children && !action.disabled) showSubmenu(event.currentTarget, action, path);
          else setFlyouts(current => current.slice(0, path.length - submenuPath.length));
        }}
        onKeyDown={event => {
          if (action.children && event.key === "ArrowRight") {
            event.preventDefault(); event.stopPropagation(); setFlyouts([]); setSubmenuPath([...path, action.label]);
          }
        }}
        onClick={event => { if (action.children) { setFlyouts([]); setSubmenuPath([...path, action.label]); return; } action.run(); if (action.keepOpen) event.currentTarget.focus({ preventScroll: true }); else onClose(); }}>{action.checked !== undefined && <span aria-hidden="true" className="block-menu-check">{action.checked ? "✓" : ""}</span>}{action.label}{action.children ? " ›" : ""}</button>}
    </div>)}</>;
  const font = presentation.enabled ? presentation.font : "inherit";
  const color = presentation.enabled ? presentation.color : "secondary";
  const menuStyle = {
    left: position.x,
    top: position.y,
    ...(presentation.enabled ? {
      "--block-menu-font": font === "system" ? "system-ui, sans-serif" : font === "monospace" ? "ui-monospace, monospace" : "inherit",
      "--block-menu-font-size": `${presentation.fontSize}px`,
      "--block-menu-title-font-size": `${Math.max(10, presentation.fontSize - 1)}px`,
      "--block-menu-title-color": color === "accent" ? "var(--accent)" : color === "theme" ? "var(--text)" : "var(--text-secondary)",
      "--block-menu-title-weight": presentation.boldTitle ? "700" : "500",
    } as React.CSSProperties : {}),
  };
  return createPortal(<div ref={root} role="menu" aria-label={title} className={`editor-context-menu block-action-menu${presentation.enabled ? " block-menu-plugin-active" : ""}`} onPointerLeave={() => setFlyouts([])}
    style={menuStyle} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === "Tab" && root.current?.querySelector("input, textarea")) {
        event.preventDefault(); event.stopPropagation();
        const controls = Array.from(root.current!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)"));
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Escape" || event.key === "Tab") { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); trigger.focus({ preventScroll: true }); } onClose(); return; }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(root.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    <div className="block-action-menu-title">{displayedTitle}{submenuPath.length ? ` · ${submenuPath.join(" · ")}` : ""}</div>
    {submenuPath.length > 0 && <button type="button" role="menuitem" className="editor-context-item" onClick={() => { setFlyouts([]); setSubmenuPath(path => path.slice(0, -1)); }}>← 返回</button>}
    <div>
      <div className="block-action-menu-panel">{renderActions(visibleActions, submenuPath)}</div>
      {flyouts.map(menu => <section key={menu.path.join("/")} className="editor-context-menu block-action-menu-specific" aria-label={menu.path[menu.path.length - 1]} style={{ left: menu.x, top: menu.y }}>
        <div className="block-action-menu-title">{menu.path[menu.path.length - 1]}</div>
        {renderActions(actionsAt(menu.path), menu.path)}
      </section>)}
    </div>
  </div>, document.body);
}
