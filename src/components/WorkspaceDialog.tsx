import { useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ToolbarIcon } from "./ToolbarIcon";

/** Shared, opaque workspace overlay; it does not replace the mounted editor. */
export function WorkspaceDialog({ title, onClose, children, initialFocusRef, restoreFocusRef }: {
  title: string; onClose: () => void; children: ReactNode; initialFocusRef?: RefObject<HTMLInputElement>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useDialogFocus(panel, true, initialFocusRef ?? close, restoreFocusRef);
  return createPortal(<div className="workspace-dialog-backdrop" onPointerDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div ref={panel} className="workspace-dialog" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      onClick={() => {
        // Clicking non-focusable space can leave keyboard focus on body,
        // outside the dialog's Escape handler (notably after a file picker).
        if (panel.current && !panel.current.contains(document.activeElement))
          panel.current.focus({ preventScroll: true });
      }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        event.stopPropagation();
      }}>
      <div className="workspace-dialog-heading"><h2>{title}</h2>
        <button ref={close} type="button" className="btn-icon" aria-label={`关闭${title}`} onClick={onClose}><ToolbarIcon name="close" /></button>
      </div>
      {children}
    </div>
  </div>, document.body);
}
