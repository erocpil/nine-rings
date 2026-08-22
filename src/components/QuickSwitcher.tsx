import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  filterQuickSwitcherNotes,
  rankQuickSwitcherNotes,
  readRecentNoteIds,
} from "../lib/quick-switcher";
import type { Note } from "../types/models";

interface QuickSwitcherProps {
  open: boolean;
  activeNoteId: string | null;
  onClose: () => void;
  onSelect: (note: Note) => void | Promise<void>;
}

function noteKind(note: Note): string {
  return note.storagePath ? "文档" : "随笔";
}

export default function QuickSwitcher({ open, activeNoteId, onClose, onSelect }: QuickSwitcherProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { window.setTimeout(() => previousFocus?.focus(), 0); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setQuery("");
    setActiveIndex(0);
    setLoading(true);
    setFailed(false);
    Promise.all([api.notes.all(), api.docs.search({})])
      .then(([daily, docs]) => {
        if (cancelled) return;
        const unique = [...new Map([...daily, ...docs].map((note) => [note.id, note])).values()];
        setNotes(rankQuickSwitcherNotes(unique, readRecentNoteIds()));
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  const results = useMemo(
    () => filterQuickSwitcherNotes(notes, query).slice(0, query.trim() ? 50 : 12),
    [notes, query],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-switch-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!open) return null;

  const choose = (note: Note) => {
    onClose();
    void onSelect(note);
  };

  return (
    <div className="quick-switcher-overlay" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="quick-switcher"
        role="dialog"
        aria-modal="true"
        aria-label="快速切换笔记"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])");
          if (!focusable || focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="quick-switcher-search">
          <span aria-hidden="true">⌕</span>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index + 1) % results.length);
              } else if (event.key === "ArrowUp" && results.length > 0) {
                event.preventDefault();
                setActiveIndex((index) => (index - 1 + results.length) % results.length);
              } else if (event.key === "Enter" && results[activeIndex]) {
                event.preventDefault();
                choose(results[activeIndex]);
              }
            }}
            placeholder="按标题、路径、标签或概念查找…"
            aria-label="查找并切换笔记"
            aria-controls="quick-switcher-results"
            aria-activedescendant={results[activeIndex] ? `quick-switcher-${results[activeIndex].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="quick-switcher-caption">
          <span>{query.trim() ? `匹配结果 · ${results.length}` : "最近访问"}</span>
          <span>↑↓ 选择 · ↵ 打开</span>
        </div>
        <div id="quick-switcher-results" className="quick-switcher-results" ref={listRef} role="listbox">
          {loading && <div className="quick-switcher-empty">正在载入笔记…</div>}
          {!loading && failed && <div className="quick-switcher-empty">载入失败，请稍后重试</div>}
          {!loading && !failed && results.length === 0 && (
            <div className="quick-switcher-empty">没有找到匹配的笔记</div>
          )}
          {!loading && !failed && results.map((note, index) => (
            <button
              id={`quick-switcher-${note.id}`}
              key={note.id}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              data-switch-index={index}
              className={`quick-switcher-item${index === activeIndex ? " active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(note)}
            >
              <span className="quick-switcher-kind" aria-hidden="true">{note.storagePath ? "▤" : "✎"}</span>
              <span className="quick-switcher-item-main">
                <span className="quick-switcher-title">{note.title?.trim() || "无标题"}</span>
                <span className="quick-switcher-meta">
                  {noteKind(note)} · {note.storagePath || note.date}
                  {note.tags.length > 0 ? ` · #${note.tags.slice(0, 2).join(" #")}` : ""}
                </span>
              </span>
              {note.id === activeNoteId && <span className="quick-switcher-current">当前</span>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
