import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface BlockMenuAction {
  label: string; run: () => void; disabled?: boolean; danger?: boolean; children?: BlockMenuAction[];
  group?: string;
  checked?: boolean;
  keepOpen?: boolean;
  inputControl?: { value: string; multiline?: boolean; valid?: (value: string) => boolean; apply: (value: string) => void };
  colorControl?: { value: string; apply: (value: string) => void };
}

/** Shared presentation grouping for gutter and title-bar menus, including readonly. */
export function groupBlockMenuActions(actions: BlockMenuAction[]): BlockMenuAction[] {
  const groups: [string, string[]][] = [
    ["复制与引用", ["复制内容", "复制 Markdown", "复制纯文本", "复制块引用"]],
    ["阅读与导航", ["添加块书签", "取消块书签", "打开块模式", "折叠 / 展开本节", "折叠 / 展开此块"]],
    ["块设置", ["块级功能"]],
    ["文字样式", ["粗体", "斜体", "文字字号", "文字颜色", "清除文字样式"]],
    ["编辑与结构", ["在上方插入段落", "在下方插入段落", "在本块前粘贴块", "在本块后粘贴块", "复制副本", "增加缩进", "减少缩进", "转换类型"]],
    ["选择", ["选择多个块"]],
    ["剪切与删除", ["剪切此块", "删除此块"]],
  ];
  return groups.flatMap<BlockMenuAction>(([group, labels]) => actions.filter(action => labels.includes(action.label)).map(action => ({ ...action, group })))
    .concat(actions.filter(action => !groups.some(([, labels]) => labels.includes(action.label))));
}

function ColorControl({ action, onClose }: { action: BlockMenuAction; onClose: () => void }) {
  const [value, setValue] = useState(action.colorControl!.value);
  return <div className="block-menu-color-control">
    <label>{action.label}<input type="color" aria-label={action.label} value={value} disabled={action.disabled} onChange={event => setValue(event.target.value)} /></label>
    <button type="button" role="menuitem" className="editor-context-item" disabled={action.disabled} onClick={() => { action.colorControl!.apply(value); onClose(); }}>应用颜色</button>
  </div>;
}
function InputControl({ action, onClose }: { action: BlockMenuAction; onClose: () => void }) {
  const control = action.inputControl!;
  const [value, setValue] = useState(control.value);
  const valid = !control.valid || control.valid(value);
  const props = { "aria-label": action.label, value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value) };
  return <form className="block-menu-input-control" onSubmit={event => { event.preventDefault(); if (!valid) return; control.apply(value); onClose(); }}>
    <label>{action.label}{control.multiline ? <textarea {...props} rows={5} /> : <input {...props} />}</label>
    <button type="submit" className="editor-context-item" disabled={!valid}>应用</button>
    {!valid && <small role="alert">请输入有效值</small>}
  </form>;
}
export function BlockActionMenu({ trigger, title, actions, onClose, placement = "side" }: {
  trigger: HTMLElement; title: string; actions: BlockMenuAction[]; onClose: () => void; placement?: "side" | "below";
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const [submenuPath, setSubmenuPath] = useState<string[]>([]);
  const [flyout, setFlyout] = useState<{ x: number; y: number } | null>(null);
  const specific = actions.find(action => action.label === "块级功能" && !action.disabled);
  const expanded = submenuPath.length === 0 && !!specific?.children?.length && flyout !== null;
  let visibleActions = actions;
  for (const label of submenuPath) {
    visibleActions = visibleActions.find(action => action.label === label)?.children ?? [];
  }
  useLayoutEffect(() => {
    const rect = trigger.getBoundingClientRect();
    const menu = root.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(placement === "below" ? rect.left : rect.right + 6, window.innerWidth - menu.width - 8)), y: Math.max(8, Math.min(placement === "below" ? rect.bottom + 6 : rect.top, window.innerHeight - menu.height - 8)) });
    root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [trigger, submenuPath, placement]);
  useEffect(() => {
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node) && !trigger.contains(event.target as Node)) onClose(); };
    const scroll = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return;
      if (placement !== "below" || !root.current || !trigger.isConnected) { onClose(); return; }
      const rect = trigger.getBoundingClientRect(), menu = root.current.getBoundingClientRect();
      const next = { x: Math.max(8, Math.min(rect.left, window.innerWidth - menu.width - 8)), y: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - menu.height - 8)) };
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
  const showSpecific = (button: HTMLElement) => {
    const menu = root.current!.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    const width = 240;
    const x = menu.right + width <= window.innerWidth - 8 ? menu.right
      : menu.left - width >= 8 ? menu.left - width : null;
    if (x === null) return;
    setFlyout({ x, y: Math.max(8, Math.min(item.top, window.innerHeight - Math.min(440, window.innerHeight - 16) - 8)) });
  };
  const renderActions = (items: BlockMenuAction[], path: string[]) => <>{items.map((action, index) => <div key={action.label}>
      {!path.length && action.group && action.group !== items[index - 1]?.group && <div className={`block-action-menu-group${index === 0 ? " first-group" : ""}`} role="presentation">{action.group}</div>}
      {action.inputControl ? <InputControl action={action} onClose={onClose} /> : action.colorControl ? <ColorControl action={action} onClose={onClose} /> : <button type="button" role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={action.checked} className={`editor-context-item${action.danger ? " block-action-danger" : ""}`} disabled={action.disabled} aria-haspopup={action.children ? "menu" : undefined}
        aria-expanded={!path.length && action.label === "块级功能" ? expanded : undefined}
        onPointerEnter={event => {
          if (path.length || event.pointerType !== "mouse") return;
          if (action.label === "块级功能" && !action.disabled) showSpecific(event.currentTarget);
          else setFlyout(null);
        }}
        onKeyDown={event => {
          if (!path.length && action.label === "块级功能" && event.key === "ArrowRight") {
            event.preventDefault(); event.stopPropagation(); setFlyout(null); setSubmenuPath([action.label]);
          }
        }}
        onClick={event => { if (action.children) { setFlyout(null); setSubmenuPath([...path, action.label]); return; } action.run(); if (action.keepOpen) event.currentTarget.focus({ preventScroll: true }); else onClose(); }}>{action.checked !== undefined && <span aria-hidden="true" className="block-menu-check">{action.checked ? "✓" : ""}</span>}{action.label}{action.children ? " ›" : ""}</button>}
    </div>)}</>;
  return createPortal(<div ref={root} role="menu" aria-label={title} className="editor-context-menu block-action-menu" onPointerLeave={() => setFlyout(null)}
    style={{ left: position.x, top: position.y }} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === "Tab" && visibleActions.some(action => action.colorControl || action.inputControl)) {
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
    <div className="block-action-menu-title">{title}{submenuPath.length ? ` · ${submenuPath.join(" · ")}` : ""}</div>
    {submenuPath.length > 0 && <button type="button" role="menuitem" className="editor-context-item" onClick={() => setSubmenuPath(path => path.slice(0, -1))}>← 返回</button>}
    <div>
      <div className="block-action-menu-panel">{renderActions(visibleActions, submenuPath)}</div>
      {expanded && <section className="editor-context-menu block-action-menu-specific" aria-label="块级功能" style={{ left: flyout!.x, top: flyout!.y }}>
        <div className="block-action-menu-title">块级功能</div>
        {renderActions(specific!.children!, ["块级功能"])}
      </section>}
    </div>
  </div>, document.body);
}
