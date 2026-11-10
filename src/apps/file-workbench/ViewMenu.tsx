import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { createBrowserViewMenu } from "../../lib/local-files/browser-view-menu";

/** Web equivalent of the native View menu; uses the exact same command port. */
export function WorkbenchViewMenu({ menu }: { menu: ReturnType<typeof createBrowserViewMenu> }) {
  const state = useSyncExternalStore(menu.subscribe, menu.getSnapshot);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !button.current || !popup.current) return;
    const anchor = button.current.getBoundingClientRect(), rect = popup.current.getBoundingClientRect();
    popup.current.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - rect.width - 8))}px`;
    popup.current.style.top = `${Math.min(anchor.bottom + 3, innerHeight - rect.height - 8)}px`;
    popup.current.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!button.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close, true); document.addEventListener("scroll", close, true);
    // Safari may leave focus outside the menu when its only item is disabled.
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus({ preventScroll: true }); } };
    document.addEventListener("keydown", escape, true);
    const resize = () => setOpen(false); window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("scroll", close, true); document.removeEventListener("keydown", escape, true); window.removeEventListener("resize", resize); };
  }, [open]);
  return <><button ref={button} type="button" className="workbench-view-menu-trigger" aria-label="View" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } if (event.key === "Tab" && open) setOpen(false); }}>View</button>
    {open && createPortal(<div ref={popup} role="menu" aria-label="View" className="doc-context-menu workbench-view-menu" onKeyDown={event => { if (["Escape", "ArrowLeft", "Tab"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus({ preventScroll: true }); } }}>
      <button type="button" role="menuitemcheckbox" aria-checked={state.showHidden} disabled={!state.enabled} onClick={() => { menu.toggleHidden(); setOpen(false); button.current?.focus({ preventScroll: true }); }}><span aria-hidden="true">{state.showHidden ? "✓" : ""}</span>显示隐藏项（当前栏）</button>
    </div>, document.body)}
  </>;
}
