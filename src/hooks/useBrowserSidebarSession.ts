import { useCallback, useLayoutEffect, useRef } from "react";
import type { DesktopSidebarState } from "../lib/desktop-sidebar-state";

interface Options {
  active: boolean;
  mode: string;
  layout: DesktopSidebarState;
  width?: number;
  restore(layout: DesktopSidebarState, width?: number, options?: { persist?: boolean }): void;
}
/** A browser visit owns one temporary layout, not the document's persistent
 * outline/bookmark settings. User choices supersede the initial snapshot. */
export function useBrowserSidebarSession(options: Options) {
  const latest = useRef(options); latest.current = options;
  const visit = useRef<{ layout: DesktopSidebarState; width?: number; changed: boolean; mode: string } | null>(null);
  const userChanged = useCallback(() => { if (visit.current) visit.current.changed = true; }, []);
  useLayoutEffect(() => {
    const current = latest.current;
    if (current.active) {
      if (!visit.current) {
        visit.current = { layout: { ...current.layout }, width: current.width, mode: current.mode, changed: false };
        current.restore({ ...current.layout, hidden: true, pinned: false }, current.width, { persist: false });
      } else if (visit.current.mode !== current.mode) visit.current.changed = true;
    } else if (visit.current) {
      const saved = visit.current; visit.current = null;
      if (!saved.changed) current.restore(saved.layout, saved.width);
    }
  }, [options.active, options.mode]);
  useLayoutEffect(() => {
    if (!options.active) return;
    const deliberate = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest(".sidebar-divider, [data-sidebar-panel]")) return;
      if (event instanceof PointerEvent && event.button !== 0) return;
      if (event instanceof KeyboardEvent && !["Enter", " ", "ArrowRight", "ArrowDown"].includes(event.key)) return;
      userChanged();
    };
    document.addEventListener("pointerdown", deliberate, true);
    document.addEventListener("keydown", deliberate, true);
    return () => { document.removeEventListener("pointerdown", deliberate, true); document.removeEventListener("keydown", deliberate, true); };
  }, [options.active, userChanged]);
  return userChanged;
}
