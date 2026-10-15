import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface NotesMenuTarget { id: string; title: string; x: number; y: number; trigger: HTMLElement }
export function NotesContextMenu({ target, close, actions }: {
  target: NotesMenuTarget;
  close: () => void;
  actions: { label: string; run: () => void }[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(target.x, innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(target.y, innerHeight - rect.height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [target]);
  useEffect(() => {
    const outside = (event: Event) => { if (!ref.current?.contains(event.target as Node)) close(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("resize", close);
    };
  }, [close]);
  return createPortal(<div ref={ref} className="doc-context-menu notes-context-menu" role="menu" aria-label="随记菜单" data-sidebar-owned
    style={{ left: target.x, top: target.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close();
        if (target.trigger.isConnected) target.trigger.focus({ preventScroll: true });
      }
      if (event.key === "Tab") close();
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    }}>
    {actions.map(action => <button key={action.label} type="button" role="menuitem" className="doc-context-item" onClick={() => { close(); action.run(); }}>{action.label}</button>)}
  </div>, document.body);
}
