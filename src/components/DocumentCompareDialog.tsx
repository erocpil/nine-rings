import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PathNode } from "../types/models";
import { api } from "../lib/api";
import { documentPreview, type SyncRemoteDocumentPreview } from "../lib/sync/backup-merge";
import { DocumentComparison } from "./DocumentComparison";

export default function DocumentCompareDialog({ initialIds, documents, beforeRead, onClose }: {
  initialIds: string[]; documents: PathNode[]; beforeRead?: () => Promise<void>; onClose: () => void;
}) {
  const [leftId] = useState(initialIds[0] ?? "");
  const [rightId] = useState(initialIds[1] ?? "");
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
  const labels = useMemo(() => [leftId, rightId].map((id) => {
    const node = documents.find((item) => item.noteId === id);
    if (!node) return { name: "未选择文档", path: "" };
    const suffix = `/${id}`;
    const path = node.path.endsWith(suffix) ? node.path.slice(0, -suffix.length) : node.path;
    return { name: node.name, path: path || "根目录" };
  }), [documents, leftId, rightId]);
  return createPortal(<dialog ref={ref} className="document-compare-dialog" role="dialog" aria-label="文档对比" aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
    <header><h3>文档对比</h3><button type="button" className="settings-btn" onClick={onClose}>关闭</button></header>
    <div className="document-compare-headings">
      {labels.map((label, index) => <div key={index} className="document-compare-heading" aria-label={`${index === 0 ? "左侧" : "右侧"}文档`}>
        <strong>{label.name}</strong><span>{label.path}</span>
      </div>)}
    </div>
    {error && <p role="alert">{error}</p>}
    {!pair && !error && leftId && rightId && <p role="status">正在读取文档…</p>}
    {pair && <DocumentComparison key={`${leftId}:${rightId}`} left={pair[0]} right={pair[1]} />}
  </dialog>, document.body);
}
