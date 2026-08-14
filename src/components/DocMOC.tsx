import { useEffect, useState } from "react";
import type { Note } from "../types/models";
import { api } from "../lib/api";

const DOC_TYPE_LABELS: Record<string, string> = {
  explanation: "解释",
  "how-to": "指南",
  reference: "参考",
  tutorial: "教程",
};

const DOC_TYPE_COLORS: Record<string, string> = {
  explanation: "#7c3aed",
  "how-to": "#059669",
  reference: "#2563eb",
  tutorial: "#d97706",
};

interface DocMOCProps {
  /** 目录模式：列出某目录下的所有文档 */
  storagePath?: string;
  /** 概念模式：列出关联某概念的所有文档（与 storagePath 互斥） */
  concept?: string;
  onSelect: (note: Note) => void;
  /** 点击某个概念 chip 时跳转到该概念的聚合页 */
  onOpenConcept?: (concept: string) => void;
  selectedId: string | null;
  refreshKey?: number;
}

export function DocMOC({ storagePath, concept, onSelect, onOpenConcept, selectedId, refreshKey }: DocMOCProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isConcept = concept != null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    const req = concept != null
      ? api.docs.search({ concept })
      : api.docs.listByPath(storagePath ?? "");
    req
      .then((docs) => {
        if (!active) return;
        // 按 updated_at 倒序；复制数组，避免修改适配器返回的共享数据。
        setNotes([...docs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      })
      .catch((error) => {
        if (!active) return;
        setNotes([]);
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [storagePath, concept, refreshKey]);

  if (loading) {
    return <div className="moc-loading">加载中...</div>;
  }

  if (loadError) {
    return <div className="moc-empty">加载失败：{loadError}</div>;
  }

  if (notes.length === 0) {
    return <div className="moc-empty">{isConcept ? `没有文档关联概念 #${concept}` : "此目录下暂无文档"}</div>;
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const w = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return `周${w} ${d.getMonth() + 1}/${d.getDate()}`;
  };

  const renderConceptChip = (c: string) => (
    <span
      key={c}
      className={`moc-concept-chip ${c === concept ? "moc-concept-chip-active" : ""}`}
      onClick={onOpenConcept ? (e) => { e.stopPropagation(); onOpenConcept(c); } : undefined}
      title={onOpenConcept ? `查看 #${c} 的所有文档` : undefined}
    >
      {c}
    </span>
  );

  return (
    <div className="moc">
      <div className="moc-header">
        <span className="moc-breadcrumb">{isConcept ? `#${concept}` : storagePath}</span>
        <span className="moc-count">{notes.length} 篇文档</span>
      </div>
      <div className="moc-table-wrap">
        <table className="moc-table">
          <thead>
            <tr>
              <th className="moc-col-title">标题</th>
              <th className="moc-col-type">类型</th>
              <th className="moc-col-concepts">概念</th>
              <th className="moc-col-links">关联</th>
              <th className="moc-col-date">更新</th>
            </tr>
          </thead>
          <tbody>
            {notes.map((note) => (
              <tr
                key={note.id}
                className={`moc-row ${note.id === selectedId ? "moc-row-selected" : ""}`}
                onClick={() => onSelect(note)}
              >
                <td className="moc-col-title">
                  <span className="moc-title-text">{note.title || "无标题"}</span>
                </td>
                <td className="moc-col-type">
                  {note.docType ? (
                    <span
                      className="moc-type-badge"
                      style={{ background: DOC_TYPE_COLORS[note.docType] ?? "#6b7280" }}
                    >
                      {DOC_TYPE_LABELS[note.docType] ?? note.docType}
                    </span>
                  ) : (
                    <span className="moc-type-none">—</span>
                  )}
                </td>
                <td className="moc-col-concepts">
                  {note.concepts && note.concepts.length > 0 ? (
                    <div className="moc-concepts">
                      {note.concepts.slice(0, 3).map(renderConceptChip)}
                      {note.concepts.length > 3 && (
                        <span className="moc-concept-more">+{note.concepts.length - 3}</span>
                      )}
                    </div>
                  ) : (
                    <span className="moc-type-none">—</span>
                  )}
                </td>
                <td className="moc-col-links">
                  {note.linkedDocIds && note.linkedDocIds.length > 0 ? (
                    <span className="moc-link-count">{note.linkedDocIds.length}</span>
                  ) : (
                    <span className="moc-type-none">—</span>
                  )}
                </td>
                <td className="moc-col-date">
                  <span className="moc-date">{formatDate(note.updated_at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
