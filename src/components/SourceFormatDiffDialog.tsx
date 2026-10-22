import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { SourceFormatRecord } from "../lib/source-format-history";
import { TextDiffView } from "./TextDiffView";
import { ToolbarIcon } from "./ToolbarIcon";
import { SourceWhitespaceToggle } from "./SourceWhitespaceToggle";
import {
  BLOCK_WORKSPACE_DISPLAY_EVENT,
  blockWorkspacePreferences,
} from "../lib/block-display-settings";

export default function SourceFormatDiffDialog({ record, currentMatches, onClose }: {
  record: SourceFormatRecord; currentMatches: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(
    () => blockWorkspacePreferences().sourceWhitespace === true,
  );
  const [tabSize, setTabSize] = useState(
    () => blockWorkspacePreferences().tabSize ?? 4,
  );
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    // Keep the close button from being highlighted just because it is the
    // first focusable child. The dialog itself remains keyboard reachable.
    node?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !node?.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      node?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const sync = () => {
      setShowWhitespace(blockWorkspacePreferences().sourceWhitespace === true);
      setTabSize(blockWorkspacePreferences().tabSize ?? 4);
    };
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return createPortal(<dialog ref={dialog} tabIndex={-1} className="document-compare-dialog source-format-diff-dialog" aria-label="格式化差异" aria-modal="true"
    style={{ "--code-tab-size": tabSize } as CSSProperties}
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <header><h3>格式化差异</h3><button type="button" className="btn-icon" aria-label="关闭格式化差异" title="关闭" onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <p className="source-format-diff-summary">{record.scope === "document" ? "全文" : "选区"} · {record.style} · {new Date(record.createdAt).toLocaleString()}</p>
    <p className="source-format-diff-notice">{currentMatches ? "当前正文与格式化后快照一致。" : "当前正文已变化，下方仍显示上次格式化快照。"}后续编辑或撤销不会改变此对比。</p>
    <div className="document-comparison">
      <div className="document-compare-controls"><label><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} />显示相同行</label><SourceWhitespaceToggle className="document-diff-whitespace-toggle" /></div>
      <TextDiffView left={record.before} right={record.after} leftLabel="格式化前" rightLabel="格式化后" showUnchanged={showUnchanged} showWhitespace={showWhitespace} onShowUnchanged={() => setShowUnchanged(true)} />
    </div>
  </dialog>, document.body);
}
