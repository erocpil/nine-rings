import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import type { DocumentBookmark } from "../types/models";

export function BookmarkRenameDialog({ bookmark, onSave, onClose }: {
  bookmark: Pick<DocumentBookmark, "label" | "preview">;
  onSave: (label: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState(bookmark.label ?? "");
  const dialogRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useDialogFocus(dialogRef, true, inputRef);
  return createPortal(
    <div className="image-dialog-overlay" onClick={onClose}>
      <form ref={dialogRef} className="image-dialog" role="dialog" aria-modal="true" aria-label="重命名书签"
        onClick={event => event.stopPropagation()}
        onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        }}
        onSubmit={event => { event.preventDefault(); onSave(label); }}>
        <div className="image-dialog-header">重命名书签
          <button type="button" className="image-dialog-close" aria-label="关闭重命名书签" onClick={onClose}>✕</button>
        </div>
        <input ref={inputRef} className="image-dialog-input" aria-label="书签名称" value={label}
          onChange={event => setLabel(event.target.value)} />
        <p className="image-dialog-hint">留空恢复正文摘要</p>
        <div className="image-dialog-actions">
          <button type="button" className="menu-btn" onClick={onClose}>取消</button>
          <button type="submit" className="menu-btn active">保存</button>
        </div>
      </form>
    </div>, document.body,
  );
}
