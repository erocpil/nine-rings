import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { NotesMenuTarget } from "./NotesContextMenu";

export interface FileBrowserMenuAction {
  label: string;
  run?: () => void;
  disabled?: boolean;
  separator?: boolean;
  danger?: boolean;
  hint?: string;
  children?: FileBrowserMenuAction[];
}
/** Shared file menu for both hosts. Keep OS launch actions explicit and separate
 * from content editing/queue actions; no platform operation is inferred by CSS. */
export function FileBrowserContextMenu({ target, actions, close }: {
  target: NotesMenuTarget; actions: FileBrowserMenuAction[]; close: () => void;
}) {
  const layer = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null), child = useRef<HTMLDivElement>(null);
  const focusChild = useRef(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const buttons = (element: HTMLElement | null) => [...element?.querySelectorAll<HTMLButtonElement>(":scope > .file-browser-menu-entry > button:not(:disabled)") ?? []];
  const restore = () => { if (target.trigger.isConnected) target.trigger.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const menu = root.current; if (!menu) return;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
    buttons(menu)[0]?.focus({ preventScroll: true });
  }, [target]);
  useLayoutEffect(() => {
    const menu = child.current;
    const button = root.current?.querySelector<HTMLButtonElement>(`[data-action-index='${expanded}']`);
    if (!menu || !button) return;
    const anchor = button.getBoundingClientRect(), box = menu.getBoundingClientRect();
    const left = anchor.right + box.width + 6 <= innerWidth - 8 ? anchor.right + 3 : anchor.left - box.width - 3;
    menu.style.left = `${Math.max(8, Math.min(left, innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchor.top - 4, innerHeight - box.height - 8))}px`;
    if (focusChild.current) { focusChild.current = false; buttons(menu)[0]?.focus({ preventScroll: true }); }
  }, [expanded, actions]);
  useEffect(() => {
    const outside = (event: Event) => { if (!layer.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("scroll", outside, true); window.removeEventListener("resize", close); };
  }, [close]);
  const expand = (index: number, focus = false) => {
    if (focus) {
      if (expanded === index && child.current) buttons(child.current)[0]?.focus({ preventScroll: true });
      else focusChild.current = true;
    }
    setExpanded(index);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>, submenu: boolean) => {
    const entries = buttons(submenu ? child.current : root.current);
    const index = entries.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const next = event.key === "Home" ? 0 : event.key === "End" ? entries.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
      const button = entries[next]; button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "nearest" });
      if (!submenu) { const action = Number(button?.dataset.actionIndex); setExpanded(actions[action]?.children ? action : null); }
    } else if (event.key === "ArrowRight" && !submenu) {
      const action = Number(entries[index]?.dataset.actionIndex);
      if (actions[action]?.children) { event.preventDefault(); event.stopPropagation(); expand(action, true); }
    } else if ((event.key === "ArrowLeft" && submenu) || (event.key === "Escape" && submenu)) {
      event.preventDefault(); event.stopPropagation(); const index = expanded; setExpanded(null);
      root.current?.querySelector<HTMLButtonElement>(`[data-action-index='${index}']`)?.focus({ preventScroll: true });
    } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); restore(); }
    else if (event.key === "Tab") { event.preventDefault(); event.stopPropagation(); close(); restore(); }
  };
  const render = (entries: FileBrowserMenuAction[], submenu = false) => entries.map((action, index) => <span className="file-browser-menu-entry" key={action.label}>
    {action.separator && index > 0 && <span role="separator" className="file-browser-menu-separator" />}
    <button type="button" role="menuitem" data-action-index={index} className={`doc-context-item${action.danger ? " doc-context-danger" : ""}`} disabled={action.disabled}
      aria-haspopup={action.children ? "menu" : undefined} aria-expanded={action.children ? expanded === index : undefined}
      onPointerEnter={event => { if (action.disabled) return; event.currentTarget.focus({ preventScroll: true }); if (!submenu) setExpanded(action.children ? index : null); }}
      onClick={() => { if (action.children) { expand(index, true); return; } close(); action.run?.(); }}>
      <span>{action.label}</span>{action.children && <span className="file-browser-menu-arrow" aria-hidden="true">▸</span>}
      {action.hint && <span className="file-browser-menu-hint">{action.hint}</span>}
    </button>
  </span>);
  return createPortal(<div ref={layer} className="file-browser-menu-layer" data-sidebar-owned onContextMenu={event => event.preventDefault()}>
    <div ref={root} className="doc-context-menu file-browser-context-menu" role="menu" aria-label="文件菜单" style={{ left: target.x, top: target.y }} onKeyDown={event => key(event, false)}>{render(actions)}</div>
    {expanded !== null && actions[expanded]?.children && <div ref={child} className="doc-context-menu file-browser-context-menu" role="menu" aria-label={actions[expanded].label} onKeyDown={event => key(event, true)}>{render(actions[expanded].children!, true)}</div>}
  </div>, document.body);
}
