import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PathNode } from "../types/models";
import { api } from "../lib/api";
import { documentPreview, type SyncRemoteDocumentPreview } from "../lib/sync/backup-merge";
import { DocumentComparison } from "./DocumentComparison";

export default function DocumentCompareDialog({ initialIds, documents, beforeRead, onClose }: {
  initialIds: string[]; documents: PathNode[]; beforeRead?: () => Promise<void>; onClose: () => void;
}) {
  const [leftId, setLeftId] = useState(initialIds[0] ?? "");
  const [rightId, setRightId] = useState(initialIds[1] ?? "");
  const [pair, setPair] = useState<SyncRemoteDocumentPreview[] | null>(null);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    setPair(null);
    setError("");
    if (!leftId || !rightId) return;
    void (async () => {
      await beforeRead?.();
      const notes = await Promise.all([api.notes.get(leftId), api.notes.get(rightId)]);
      if (notes.some(note => !note)) throw new Error("文档已不存在，请重新选择。");
      if (!cancelled) setPair(notes.map(note => documentPreview({ ...note! })));
    })().catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [leftId, rightId, beforeRead]);
  return createPortal(<dialog ref={ref} className="document-compare-dialog" role="dialog" aria-label="文档对比" aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <header><h3>文档对比</h3><button type="button" className="settings-btn" onClick={onClose}>关闭</button></header>
    <p>只读比较，不修改文档。也可用于同步完成后的冲突副本。</p>
    <div className="document-compare-selectors">
      {[{ label: "左侧文档", value: leftId, set: setLeftId }, { label: "右侧文档", value: rightId, set: setRightId }].map(side => <label key={side.label}>{side.label}
        <select value={side.value} onChange={event => side.set(event.target.value)}>
          <option value="">请选择文档</option>
          {documents.filter(node => node.type === "document" && node.noteId).map(node => <option key={node.noteId} value={node.noteId}>{node.name} — {node.path}</option>)}
        </select>
      </label>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {!pair && !error && leftId && rightId && <p role="status">正在读取文档…</p>}
    {pair && <DocumentComparison key={`${leftId}:${rightId}`} left={pair[0]} right={pair[1]} />}
  </dialog>, document.body);
}
