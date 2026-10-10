import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface BlockMenuAction { label: string; run: () => void; disabled?: boolean; danger?: boolean; children?: BlockMenuAction[]; }
export function BlockActionMenu({ trigger, title, actions, onClose }: {
  trigger: HTMLElement; title: string; actions: BlockMenuAction[]; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 8, y: 8 });
  const [submenu, setSubmenu] = useState<BlockMenuAction | null>(null);
  useLayoutEffect(() => {
    const rect = trigger.getBoundingClientRect();
    const menu = root.current!.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(rect.right + 6, window.innerWidth - menu.width - 8)), y: Math.max(8, Math.min(rect.top, window.innerHeight - menu.height - 8)) });
    root.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [trigger, submenu]);
  useEffect(() => {
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node) && !trigger.contains(event.target as Node)) onClose(); };
    const scroll = (event: Event) => { if (!root.current?.contains(event.target as Node)) onClose(); };
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
  }, [onClose, trigger]);
  return createPortal(<div ref={root} role="menu" aria-label={title} className="editor-context-menu block-action-menu"
    style={{ left: position.x, top: position.y }} onMouseDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === "Escape" || event.key === "Tab") { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); trigger.focus({ preventScroll: true }); } onClose(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = Array.from(root.current!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    <div className="block-action-menu-title">{title}{submenu ? ` · ${submenu.label}` : ""}</div>
    {submenu && <button type="button" role="menuitem" className="editor-context-item" onClick={() => setSubmenu(null)}>← 返回</button>}
    {(submenu?.children ?? actions).map(action => <button key={action.label} type="button" role="menuitem" className={`editor-context-item${action.danger ? " block-action-danger" : ""}`} disabled={action.disabled} aria-haspopup={action.children ? "menu" : undefined}
      onClick={() => { if (action.children) { setSubmenu(action); return; } action.run(); onClose(); }}>{action.label}{action.children ? " ›" : ""}</button>)}
  </div>, document.body);
}
