import { useEffect, useRef, useState } from "react";
import type { ReadingAnnotation } from "../lib/reading-annotations";

interface Props {
  annotation: ReadingAnnotation;
  left: number;
  top: number;
  onSave: (note: string) => void;
  onClear: () => void;
  onDelete: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export function ReadingAnnotationBubble({ annotation, left, top, onSave, onClear, onDelete, onPointerEnter, onPointerLeave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annotation.note);
  const textarea = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(annotation.note); setEditing(false); }, [annotation.id, annotation.note]);
  useEffect(() => { if (editing) textarea.current?.focus(); }, [editing]);
  return <div className="reading-annotation-bubble" role="dialog" aria-label="阅读标注" style={{ left, top }}
    onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    {editing ? <>
      <textarea ref={textarea} aria-label="标注内容" value={draft} maxLength={4000} placeholder="添加标注（可留空，仅保留高亮）" onChange={event => setDraft(event.target.value)} />
      <div className="reading-annotation-actions">
        <button type="button" onClick={() => { onSave(draft); setEditing(false); }}>保存</button>
        <button type="button" onClick={() => { setDraft(annotation.note); setEditing(false); }}>取消</button>
      </div>
    </> : <>
      {annotation.note && <div className="reading-annotation-note">{annotation.note}</div>}
      <div className="reading-annotation-actions">
        <button type="button" onClick={() => setEditing(true)}>修改</button>
        <button type="button" disabled={!annotation.note} onClick={onClear}>清空</button>
        <button type="button" className="danger" onClick={onDelete}>删除</button>
      </div>
    </>}
  </div>;
}
