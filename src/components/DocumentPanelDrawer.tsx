import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { bindEdgeSwipe } from "../lib/edge-swipe";

type Panel = "outline" | "bookmark";
export type DocumentPanelPresentation = "popover" | "drawer";

/** 点击入口使用浮层，手机专注模式的边缘手势使用阅读侧栏。 */
export function DocumentPanelDrawer({ enabled, presentation, panel, hasOutline, onSelect, onClose, children }: {
  enabled: boolean;
  presentation: DocumentPanelPresentation;
  panel: Panel | null;
  hasOutline: boolean;
  onSelect: (panel: Panel) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const open = enabled && presentation === "drawer" && panel !== null;
  const drawerRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastContent = useRef<ReactNode>(null);
  const onCloseRef = useRef(onClose);
  const [exiting, setExiting] = useState(false);
  useLayoutEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    if (open) lastContent.current = children;
  }, [children, open]);
  useEffect(() => {
    if (!open) return;
    setExiting(true);
  }, [open]);
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => { setExiting(false); lastContent.current = null; }, 250);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!open || !drawer) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    const unbind = bindEdgeSwipe(drawer, () => ({ direction: "right", run: () => onCloseRef.current() }), {
      withinPanel: true,
      // 已展开操作区的书签行仍由行内手势收起，不能顺便关掉整个侧栏。
      swipeButtonSelector: ".document-outline-link, .document-bookmark-item:not(.swipe-open) .document-bookmark-jump",
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const buttons = [...drawer.querySelectorAll<HTMLElement>("button:not(:disabled), [tabindex='0']")]
          .filter((element) => element.getClientRects().length > 0);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const backdrop = backdropRef.current;
    const preventScroll = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
    backdrop?.addEventListener("touchmove", preventScroll, { passive: false });
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      unbind();
      backdrop?.removeEventListener("touchmove", preventScroll);
      document.removeEventListener("keydown", onKeyDown, true);
      if (drawer.contains(document.activeElement) || document.activeElement === document.body) {
        previousFocus?.focus({ preventScroll: true });
      }
    };
  }, [open]);

  if (!enabled) return <>{children}</>;
  // 浮层打开时也保留收起的侧栏外壳，确保首次边缘滑动有完整入场动画。
  return <>{presentation === "popover" && children}{createPortal(
    <div className={`mobile-document-drawer${open ? " is-open" : ""}`} onClick={(event) => event.stopPropagation()}>
      <div ref={backdropRef} className="mobile-document-drawer-backdrop" aria-hidden="true" onClick={onClose} />
      <div ref={drawerRef} className="mobile-document-drawer-panel" role="dialog" aria-modal={open || undefined}
        aria-label="阅读侧栏" aria-hidden={!open} {...(!open ? { inert: "" } : {})}>
        <div className="mobile-document-drawer-header">
          <button type="button" aria-label="切换到目录" aria-pressed={panel === "outline"} disabled={!hasOutline} onClick={() => onSelect("outline")}>目录</button>
          <button type="button" aria-label="切换到书签" aria-pressed={panel === "bookmark"} onClick={() => onSelect("bookmark")}>书签</button>
          <button ref={closeRef} type="button" className="mobile-document-drawer-close" aria-label="关闭阅读侧栏" onClick={onClose}>×</button>
        </div>
        {open ? children : exiting && presentation === "drawer" ? lastContent.current : null}
      </div>
    </div>, document.body,
  )}</>;
}
