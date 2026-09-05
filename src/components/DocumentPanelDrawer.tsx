import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useEdgeDrawer } from "../hooks/useEdgeDrawer";

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
  const lastContent = useRef<ReactNode>(null);
  const [exiting, setExiting] = useState(false);
  useEdgeDrawer(open, "right", drawerRef, backdropRef, onClose);
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
          <button data-drawer-close type="button" className="mobile-document-drawer-close" aria-label="关闭阅读侧栏" onClick={onClose}>×</button>
        </div>
        {open ? children : exiting && presentation === "drawer" ? lastContent.current : null}
      </div>
    </div>, document.body,
  )}</>;
}
