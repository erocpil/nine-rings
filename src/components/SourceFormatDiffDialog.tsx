import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SourceFormatRecord } from "../lib/source-format-history";
import { TextDiffView } from "./TextDiffView";
import { ToolbarIcon } from "./ToolbarIcon";

export default function SourceFormatDiffDialog({ record, currentMatches, onClose }: {
  record: SourceFormatRecord; currentMatches: boolean; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="document-compare-dialog source-format-diff-dialog" aria-label="格式化差异" aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <header><h3>格式化差异</h3><button type="button" className="btn-icon" aria-label="关闭格式化差异" title="关闭" onClick={onClose}><ToolbarIcon name="close" /></button></header>
    <p className="source-format-diff-summary">{record.scope === "document" ? "全文" : "选区"} · {record.style} · {new Date(record.createdAt).toLocaleString()}</p>
    <p className="source-format-diff-notice">{currentMatches ? "当前正文与格式化后快照一致。" : "当前正文已变化，下方仍显示上次格式化快照。"}后续编辑或撤销不会改变此对比。</p>
    <div className="document-comparison">
      <div className="document-compare-controls"><label><input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} />显示相同行</label></div>
      <TextDiffView left={record.before} right={record.after} leftLabel="格式化前" rightLabel="格式化后" showUnchanged={showUnchanged} onShowUnchanged={() => setShowUnchanged(true)} />
    </div>
  </dialog>, document.body);
}
