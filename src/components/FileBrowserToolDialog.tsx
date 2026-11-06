import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { ToolbarIcon } from "./ToolbarIcon";
export function FileBrowserToolDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close(); }, []);
  useDialogFocus(dialog, true, close, undefined, true);
  return createPortal(<dialog ref={dialog} className="plugin-parameter-dialog file-browser-tool-dialog" aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}><header><strong>{title}</strong><button ref={close} type="button" className="btn-icon" aria-label={`关闭${title}`} onClick={onClose}><ToolbarIcon name="close" /></button></header><div className="file-browser-tool-body">{children}</div></dialog>, document.body);
}
