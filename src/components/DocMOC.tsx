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
  storagePath: string;
  onSelect: (note: Note) => void;
  selectedId: string | null;
}

export function DocMOC({ storagePath, onSelect, selectedId }: DocMOCProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.docs.listByPath(storagePath).then((docs) => {
      // 按 updated_at 倒序
      docs.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      setNotes(docs);
      setLoading(false);
    });
  }, [storagePath]);

  if (loading) {
    return <div className="moc-loading">加载中...</div>;
  }

  if (notes.length === 0) {
    return <div className="moc-empty">此目录下暂无文档</div>;
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const w = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return `周${w} ${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="moc">
      <div className="moc-header">
        <span className="moc-breadcrumb">{storagePath}</span>
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
                      {note.concepts.slice(0, 3).map((c) => (
                        <span key={c} className="moc-concept-chip">{c}</span>
                      ))}
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
