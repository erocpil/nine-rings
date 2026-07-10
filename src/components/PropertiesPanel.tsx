import { useState, useEffect, useCallback } from "react";
import type { Note, DocType } from "../types/models";
import { api } from "../lib/api";

interface PropertiesPanelProps {
  note: Note;
  onNoteUpdate: (note: Note) => void;
  onClose: () => void;
}

const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: "explanation", label: "📖 解释" },
  { value: "how-to", label: "🔧 指南" },
  { value: "reference", label: "📋 参考" },
  { value: "tutorial", label: "🎓 教程" },
];

const PATH_ROOT_LABELS: Record<string, string> = {
  projects: "📁 Projects",
  areas: "🧩 Areas",
  references: "📚 References",
  ideas: "💡 Ideas",
  archives: "📦 Archives",
};

function PropertiesPanel({ note, onNoteUpdate, onClose }: PropertiesPanelProps) {
  const [conceptInput, setConceptInput] = useState("");
  const [existingConcepts, setExistingConcepts] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<Note[]>([]);
  const [backlinks, setBacklinks] = useState<Note[]>([]);

  const concepts = note.concepts ?? [];
  const linkedIds = note.linkedDocIds ?? [];
  const pathRoot = note.storagePath?.split("/")[0] ?? "";

  useEffect(() => {
    api.docs.allConcepts().then(setExistingConcepts);
    // 加载反向链接
    loadBacklinks();
  }, [note.id]);

  const loadBacklinks = async () => {
    try {
      const allPages = await api.daily.getAll();
      const results: Note[] = [];
      for (const page of allPages) {
        const notes = await api.notes.listByDate(page.date);
        for (const n of notes) {
          if ((n.linkedDocIds ?? []).includes(note.id)) {
            results.push(n);
          }
        }
      }
      // 也检查文档
      const docs = await api.docs.listByPath("");
      for (const n of docs) {
        if ((n.linkedDocIds ?? []).includes(note.id) && !results.find(r => r.id === n.id)) {
          results.push(n);
        }
      }
      setBacklinks(results);
    } catch {
      setBacklinks([]);
    }
  };

  // ── 类型变更 ──
  const handleTypeChange = useCallback(async (docType: DocType) => {
    await api.notes.update(note.id, { docType } as any);
    onNoteUpdate({ ...note, docType });
  }, [note, onNoteUpdate]);

  // ── 概念 ──
  const handleConceptInput = (value: string) => {
    setConceptInput(value);
    if (value.trim()) {
      setSuggestions(
        existingConcepts.filter(
          (c) => c.includes(value.trim()) && !concepts.includes(c)
        )
      );
    } else {
      setSuggestions([]);
    }
  };

  const addConcept = async (tag: string) => {
    const t = tag.trim();
    if (!t || concepts.includes(t)) return;
    const updated = [...concepts, t];
    await api.notes.update(note.id, { concepts: updated } as any);
    onNoteUpdate({ ...note, concepts: updated });
    setConceptInput("");
    setSuggestions([]);
  };

  const removeConcept = async (tag: string) => {
    const updated = concepts.filter((c) => c !== tag);
    await api.notes.update(note.id, { concepts: updated } as any);
    onNoteUpdate({ ...note, concepts: updated });
  };

  // ── 链接 ──
  const handleLinkSearch = async (value: string) => {
    setLinkSearch(value);
    if (value.trim().length >= 1) {
      const results = await api.notes.search(value);
      setLinkResults(
        results.filter((n) => n.id !== note.id && !linkedIds.includes(n.id))
      );
    } else {
      setLinkResults([]);
    }
  };

  const addLink = async (linkedNote: Note) => {
    const updated = [...linkedIds, linkedNote.id];
    await api.notes.update(note.id, { linkedDocIds: updated } as any);
    onNoteUpdate({ ...note, linkedDocIds: updated });
    setLinkSearch("");
    setLinkResults([]);
  };

  const removeLink = async (id: string) => {
    const updated = linkedIds.filter((lid) => lid !== id);
    await api.notes.update(note.id, { linkedDocIds: updated } as any);
    onNoteUpdate({ ...note, linkedDocIds: updated });
  };

  if (!note.storagePath) return null;

  return (
    <div className="properties-panel">
      <div className="properties-header">
        <span className="properties-title">属性</span>
        <button className="btn-icon properties-close" onClick={onClose} title="关闭属性面板">✕</button>
      </div>

      <div className="properties-body">
        {/* 生命周期位置 */}
        <div className="prop-section">
          <div className="prop-label">位置</div>
          <div className="prop-path">
            <span className="prop-path-icon">{PATH_ROOT_LABELS[pathRoot] ?? "📂"}</span>
            {note.storagePath !== pathRoot && (
              <span className="prop-path-text">/ {note.storagePath.slice(pathRoot.length + 1)}</span>
            )}
          </div>
        </div>

        {/* 类型 */}
        <div className="prop-section">
          <div className="prop-label">类型</div>
          <div className="prop-type-options">
            {DOC_TYPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`prop-type-btn ${note.docType === o.value ? "active" : ""}`}
                onClick={() => handleTypeChange(o.value)}
                title={o.label}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* 概念标签 */}
        <div className="prop-section">
          <div className="prop-label">概念</div>
          <div className="prop-tags-input-row">
            <input
              type="text"
              className="prop-input"
              placeholder="添加概念..."
              value={conceptInput}
              onChange={(e) => handleConceptInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addConcept(conceptInput);
                }
              }}
            />
            {suggestions.length > 0 && (
              <div className="prop-suggestions">
                {suggestions.map((s) => (
                  <div key={s} className="prop-suggestion" onClick={() => addConcept(s)}>
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>
          {concepts.length > 0 && (
            <div className="prop-tags">
              {concepts.map((c) => (
                <span key={c} className="prop-tag">
                  {c}
                  <button className="prop-tag-remove" onClick={() => removeConcept(c)}>✕</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 关联文档 */}
        <div className="prop-section">
          <div className="prop-label">
            关联文档
            <span className="prop-count">{linkedIds.length}</span>
          </div>
          {linkedIds.length > 0 && (
            <div className="prop-links">
              {linkedIds.map((lid) => (
                <LinkedNoteItem
                  key={lid}
                  noteId={lid}
                  onRemove={removeLink}
                />
              ))}
            </div>
          )}
          <div className="prop-tags-input-row">
            <input
              type="text"
              className="prop-input"
              placeholder="搜索并关联文档..."
              value={linkSearch}
              onChange={(e) => handleLinkSearch(e.target.value)}
            />
            {linkResults.length > 0 && (
              <div className="prop-suggestions">
                {linkResults.map((r) => (
                  <div key={r.id} className="prop-suggestion" onClick={() => addLink(r)}>
                    <span className="prop-link-title">{r.title || "无标题"}</span>
                    <span className="prop-link-date">{r.date}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 反向链接 */}
        <div className="prop-section">
          <div className="prop-label">
            反向链接
            <span className="prop-count">{backlinks.length}</span>
          </div>
          {backlinks.length === 0 ? (
            <div className="prop-empty">暂无其他笔记引用此文档</div>
          ) : (
            <div className="prop-links">
              {backlinks.map((n) => (
                <div key={n.id} className="prop-link-item">
                  <span className="prop-link-title" title={n.title ?? ""}>{n.title || "无标题"}</span>
                  <span className="prop-link-date">{n.date}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 关联文档项 ──

function LinkedNoteItem({ noteId, onRemove }: { noteId: string; onRemove: (id: string) => void }) {
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    api.notes.get(noteId).then(setNote);
  }, [noteId]);

  if (!note) return <div className="prop-link-item loading">...</div>;

  return (
    <div className="prop-link-item">
      <span className="prop-link-title" title={note.title ?? ""}>{note.title || "无标题"}</span>
      <button className="prop-tag-remove" onClick={() => onRemove(noteId)}>✕</button>
    </div>
  );
}

export default PropertiesPanel;
