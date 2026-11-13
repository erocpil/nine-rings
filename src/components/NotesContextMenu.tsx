import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface NotesMenuTarget { id: string; title: string; x: number; y: number; trigger: HTMLElement }
export function NotesContextMenu({ target, close, actions, label = "随记菜单", ignoreTrigger = false }: {
  target: NotesMenuTarget;
  close: () => void;
  actions: { label: string; run: () => void; disabled?: boolean; checked?: boolean }[];
  label?: string;
  ignoreTrigger?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [target]);
  useEffect(() => {
    const outside = (event: Event) => {
      // A retained editor may restore its own scroll after this menu opens.
      // Only scrolling an ancestor of the trigger invalidates this anchor.
      if (event.type === "scroll" && event.target instanceof Element && !event.target.contains(target.trigger)) return; if (ignoreTrigger && event.type === "pointerdown" && target.trigger.contains(event.target as Node)) return; if (!ref.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
    };
  }, [close, ignoreTrigger, target.trigger]);
  return createPortal(<div ref={ref} className="doc-context-menu notes-context-menu" role="menu" aria-label={label} data-sidebar-owned
    style={{ left: target.x, top: target.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close();
        if (target.trigger.isConnected) target.trigger.focus({ preventScroll: true });
      }
      if (event.key === "Tab") close();
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    {actions.map(action => <button key={action.label} type="button" role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={action.checked} className="doc-context-item" disabled={action.disabled} onClick={() => { close(); action.run(); }}>{action.checked !== undefined && <span aria-hidden="true">{action.checked ? "✓ " : "　"}</span>}{action.label}</button>)}
  </div>, document.body);
}
