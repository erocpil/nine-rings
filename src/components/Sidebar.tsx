import React from "react";
import type { Note } from "../types/models";

interface SidebarProps {
  notes: Note[];
  selectedId: string | null;
  onSelect: (note: Note) => void;
  onCreate: () => void;
}

export function Sidebar({ notes, selectedId, onSelect, onCreate }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>随笔</h2>
        <button className="btn-new" onClick={onCreate} title="新建随笔">
          +
        </button>
      </div>
      <div className="sidebar-list">
        {notes.map((note) => (
          <div
            key={note.id}
            className={`sidebar-item ${note.id === selectedId ? "active" : ""}`}
            onClick={() => onSelect(note)}
          >
            <div className="sidebar-item-title">
              {note.title || "无标题"}
            </div>
            <div className="sidebar-item-time">
              {new Date(note.created_at).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ))}
        {notes.length === 0 && (
          <div className="sidebar-empty">今天还没有笔记</div>
        )}
      </div>
    </div>
  );
}
