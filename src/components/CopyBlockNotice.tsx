import { createPortal } from "react-dom";
import "./copy-block-notice.css";

/** Clipboard feedback must never take space from the document layout. */
export function CopyBlockNotice({ message, onClose, withinDialog = false }: {
  message: string; onClose: () => void; withinDialog?: boolean;
}) {
  if (!message) return null;
  const failed = message.includes("失败");
  const notice = <div className="copy-block-feedback" data-dialog={withinDialog} data-error={failed} role="status" aria-atomic="true">
    <span>{message}</span>
    {failed && <button type="button" aria-label="关闭复制提示" onClick={onClose}>×</button>}
  </div>;
  // Keep modal feedback inside the native dialog's top layer.
  return withinDialog ? notice : createPortal(notice, document.body);
}
