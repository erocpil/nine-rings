import { useState, useEffect, useCallback } from "react";
import type { Note, DocType } from "../types/models";
import { api } from "../lib/api";

interface PropertiesPanelProps {
  note: Note;
  onNoteUpdate: (note: Note) => void;
  onClose: () => void;
  readonly?: boolean;
}

const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: "explanation", label: "📖 解释" },
  { value: "how-to", label: "🔧 指南" },
  { value: "reference", label: "📋 参考" },
  { value: "tutorial", label: "🎓 教程" },
];

const PATH_ROOT_OPTIONS = [
  { value: "projects", label: "📁 Projects" },
  { value: "areas", label: "🧩 Areas" },
  { value: "references", label: "📚 References" },
  { value: "ideas", label: "💡 Ideas" },
  { value: "archives", label: "📦 Archives" },
];

function PropertiesPanel({ note, onNoteUpdate, onClose, readonly }: PropertiesPanelProps) {
  const [conceptInput, setConceptInput] = useState("");
  const [existingConcepts, setExistingConcepts] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<Note[]>([]);
  const [backlinks, setBacklinks] = useState<Note[]>([]);
  const [editingPath, setEditingPath] = useState(false);
  const [editRoot, setEditRoot] = useState("");
  const [editSub, setEditSub] = useState("");

  const concepts = note.concepts ?? [];
  const linkedIds = note.linkedDocIds ?? [];
  const pathRoot = note.storagePath?.split("/")[0] ?? "";
  const pathRest = note.storagePath?.split("/").slice(1).join("/") ?? "";

  useEffect(() => {
    api.docs.allConcepts().then(setExistingConcepts);
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

  // ── 路径变更 ──

  const handlePathChange = useCallback(async () => {
    if (readonly) return;
    const parts = [editRoot];
    if (editSub.trim()) {
      parts.push(editSub.trim().replace(/[^a-z0-9-\u4e00-\u9fff]/g, "-").replace(/-+/g, "-"));
    }
    const newPath = parts.join("/");
    if (newPath === note.storagePath) {
      setEditingPath(false);
      return;
    }
    await api.notes.update(note.id, { storagePath: newPath } as any);
    onNoteUpdate({ ...note, storagePath: newPath });
    setEditingPath(false);
  }, [note, editRoot, editSub, onNoteUpdate, readonly]);

  const startEditPath = () => {
    setEditRoot(pathRoot || "projects");
    setEditSub(pathRest);
    setEditingPath(true);
  };

  // ── 类型变更（toggle：点击已选中 → 取消）──

  const handleTypeChange = useCallback(async (docType: DocType) => {
    if (readonly) return;
    const newType = note.docType === docType ? undefined : docType;
    await api.notes.update(note.id, { docType: newType } as any);
    onNoteUpdate({ ...note, docType: newType });
  }, [note, onNoteUpdate, readonly]);

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
    if (readonly) return;
    const t = tag.trim();
    if (!t || concepts.includes(t)) return;
    const updated = [...concepts, t];
    await api.notes.update(note.id, { concepts: updated } as any);
    onNoteUpdate({ ...note, concepts: updated });
    setConceptInput("");
    setSuggestions([]);
  };

  const removeConcept = async (tag: string) => {
    if (readonly) return;
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
    if (readonly) return;
    const updated = [...linkedIds, linkedNote.id];
    await api.notes.update(note.id, { linkedDocIds: updated } as any);
    onNoteUpdate({ ...note, linkedDocIds: updated });
    setLinkSearch("");
    setLinkResults([]);
  };

  const removeLink = async (id: string) => {
    if (readonly) return;
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
        {/* 位置 */}
        <div className="prop-section">
          <div className="prop-label">位置</div>
          {editingPath ? (
            <div className="prop-path-edit">
              <select
                className="prop-path-select"
                value={editRoot}
                onChange={(e) => setEditRoot(e.target.value)}
              >
                {PATH_ROOT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span className="prop-path-sep">/</span>
              <input
                className="prop-path-input"
                placeholder="子路径..."
                value={editSub}
                onChange={(e) => setEditSub(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handlePathChange();
                  if (e.key === "Escape") setEditingPath(false);
                }}
                autoFocus
              />
              <button className="prop-path-save" onClick={handlePathChange} title="确认">✓</button>
              <button className="prop-path-cancel" onClick={() => setEditingPath(false)} title="取消">✕</button>
            </div>
          ) : (
            <div className="prop-path" onClick={readonly ? undefined : startEditPath} title={readonly ? undefined : "点击修改路径"}>
              <span className="prop-path-icon">{PATH_ROOT_OPTIONS.find(o => o.value === pathRoot)?.label ?? "📂"}</span>
              {pathRest && <span className="prop-path-text">/ {pathRest}</span>}
              {!readonly && <span className="prop-path-edit-icon">✎</span>}
            </div>
          )}
        </div>

        {/* 类型 */}
        <div className="prop-section">
          <div className="prop-label">类型</div>
          <div className="prop-type-options" role="radiogroup" aria-label="文档类型">
            {DOC_TYPE_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`prop-type-btn ${note.docType === o.value ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name={`prop-type-${note.id}`}
                  className="prop-type-radio"
                  value={o.value}
                  checked={note.docType === o.value}
                  onChange={() => handleTypeChange(o.value)}
                />
                {o.label}
              </label>
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
