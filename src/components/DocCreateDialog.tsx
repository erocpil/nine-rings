import { useState, useRef, useEffect } from "react";
import { api } from "../lib/api";
import type { DocType, Note } from "../types/models";

interface DocCreateDialogProps {
  onClose: () => void;
  onCreated: (note: Note) => void;
}

const PATH_OPTIONS = [
  { value: "projects", label: "📁 Projects", desc: "活跃项目" },
  { value: "areas", label: "🗂 Areas", desc: "持续领域" },
  { value: "references", label: "📚 References", desc: "参考资料" },
  { value: "ideas", label: "💡 Ideas", desc: "缓冲想法" },
  { value: "archives", label: "📦 Archives", desc: "归档" },
];

const DOC_TYPE_OPTIONS: { value: DocType; label: string; desc: string }[] = [
  { value: "explanation", label: "📖 解释", desc: "说明原理、设计思路、为什么" },
  { value: "how-to", label: "🔧 指南", desc: "具体操作的步骤说明" },
  { value: "reference", label: "📋 参考", desc: "API 参数、配置项、速查表" },
  { value: "tutorial", label: "🎓 教程", desc: "引导式从头到尾学完" },
];

function DocCreateDialog({ onClose, onCreated }: DocCreateDialogProps) {
  const [title, setTitle] = useState("");
  const [rootPath, setRootPath] = useState("projects");
  const [subPath, setSubPath] = useState("");
  const [docType, setDocType] = useState<DocType>("explanation");
  const [conceptInput, setConceptInput] = useState("");
  const [concepts, setConcepts] = useState<string[]>([]);
  const [existingConcepts, setExistingConcepts] = useState<string[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    api.docs.allConcepts().then(setExistingConcepts);
  }, []);

  const handleConceptChange = (value: string) => {
    setConceptInput(value);
    if (value.trim()) {
      setFilteredSuggestions(
        existingConcepts.filter(
          (c) => c.includes(value.trim()) && !concepts.includes(c)
        )
      );
    } else {
      setFilteredSuggestions([]);
    }
  };

  const addConcept = (tag: string) => {
    const t = tag.trim();
    if (t && !concepts.includes(t)) {
      setConcepts([...concepts, t]);
    }
    setConceptInput("");
    setFilteredSuggestions([]);
  };

  const removeConcept = (tag: string) => {
    setConcepts(concepts.filter((c) => c !== tag));
  };

  const buildStoragePath = (): string => {
    const parts = [rootPath];
    if (subPath.trim()) {
      parts.push(subPath.trim().replace(/[^a-z0-9-\u4e00-\u9fff]/g, "-").replace(/-+/g, "-"));
    }
    return parts.join("/");
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const storagePath = buildStoragePath();
      const today = new Date().toISOString().slice(0, 10);

      const note = await api.notes.create({
        date: today,
        title: title.trim(),
        content: { ops: [] },
        tags: [],
        storagePath,
        docType,
        concepts: concepts.length > 0 ? concepts : undefined,
      });

      onCreated(note);
    } catch (e) {
      console.error("Failed to create document:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog doc-create-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="dialog-header">
          <h3>新建文档</h3>
          <button className="btn-icon dialog-close" onClick={onClose}>✕</button>
        </div>

        <div className="dialog-body">
          {/* 标题 */}
          <label className="dialog-field">
            <span className="dialog-label">标题</span>
            <input
              ref={titleRef}
              type="text"
              className="dialog-input"
              placeholder="文档标题..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          {/* 目录（P.A.R.A. 生命周期） */}
          <label className="dialog-field">
            <span className="dialog-label">位置 <span className="dialog-hint">（仅决定存放，可更改）</span></span>
            <div className="dialog-path-row">
              <select
                className="dialog-select"
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
              >
                {PATH_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} — {o.desc}
                  </option>
                ))}
              </select>
              <span className="dialog-path-sep">/</span>
              <input
                type="text"
                className="dialog-input dialog-path-input"
                placeholder="子路径 (如 nine-rings)"
                value={subPath}
                onChange={(e) => setSubPath(e.target.value)}
              />
            </div>
            <div className="dialog-path-preview">
              预览: <code>{buildStoragePath()}</code>
            </div>
          </label>

          {/* 类型（Diátaxis） */}
          <label className="dialog-field">
            <span className="dialog-label">类型</span>
            <div className="dialog-type-grid">
              {DOC_TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`dialog-type-btn ${docType === o.value ? "active" : ""}`}
                  onClick={() => setDocType(o.value)}
                  type="button"
                >
                  <span className="dialog-type-label">{o.label}</span>
                  <span className="dialog-type-desc">{o.desc}</span>
                </button>
              ))}
            </div>
          </label>

          {/* 概念标签（Zettelkasten） */}
          <label className="dialog-field">
            <span className="dialog-label">概念标签 <span className="dialog-hint">（关联查找用）</span></span>
            <div className="dialog-tags-input-row">
              <input
                type="text"
                className="dialog-input"
                placeholder="输入概念名后按 Enter 添加..."
                value={conceptInput}
                onChange={(e) => handleConceptChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addConcept(conceptInput);
                  }
                }}
              />
              {filteredSuggestions.length > 0 && (
                <div className="dialog-suggestions">
                  {filteredSuggestions.map((s) => (
                    <div
                      key={s}
                      className="dialog-suggestion"
                      onClick={() => addConcept(s)}
                    >
                      {s}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {concepts.length > 0 && (
              <div className="dialog-tags">
                {concepts.map((c) => (
                  <span key={c} className="dialog-tag">
                    {c}
                    <button className="dialog-tag-remove" onClick={() => removeConcept(c)} type="button">✕</button>
                  </span>
                ))}
              </div>
            )}
          </label>
        </div>

        <div className="dialog-footer">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={!title.trim() || saving}
          >
            {saving ? "创建中..." : "创建文档"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DocCreateDialog;
