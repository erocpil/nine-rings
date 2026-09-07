import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  filterQuickSwitcherNotes,
  rankQuickSwitcherNotes,
  readRecentNoteIds,
} from "../lib/quick-switcher";
import type { Note } from "../types/models";
import { DocumentListContent, ListState } from "./ListPresentation";
import { ToolbarIcon } from "./ToolbarIcon";
import { useDialogFocus } from "../hooks/useDialogFocus";

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
  const [reload, setReload] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useDialogFocus(dialogRef, open, inputRef);

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
  }, [open, reload]);

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
            event.stopPropagation();
            onClose();
            return;
          }
        }}
      >
        <div className="quick-switcher-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (loading || failed) return;
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
            aria-activedescendant={!loading && !failed && results[activeIndex] ? `quick-switcher-${results[activeIndex].id}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="quick-switcher-caption">
          <span>{query.trim() ? `匹配结果 · ${results.length}` : "最近访问"}</span>
          <span>↑↓ 选择 · ↵ 打开</span>
        </div>
        <div id="quick-switcher-results" className="quick-switcher-results" ref={listRef} role="listbox">
          {loading && <ListState kind="loading" title="正在载入笔记…" />}
          {!loading && failed && <ListState kind="error" title="载入失败" detail="请检查本地存储状态后重试" onRetry={() => { setReload((value) => value + 1); inputRef.current?.focus(); }} />}
          {!loading && !failed && results.length === 0 && (
            <ListState kind="empty" title="没有找到匹配的笔记" detail="试试标题、路径、标签或概念关键词" />
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
              <span className="quick-switcher-kind" aria-hidden="true"><ToolbarIcon name={note.storagePath ? "document" : "note"} /></span>
              <DocumentListContent variant="quick-switcher" title={note.title?.trim() || "无标题"} path={note.storagePath}
                metadata={`${noteKind(note)} · ${note.date}${note.tags.length > 0 ? ` · #${note.tags.slice(0, 2).join(" #")}` : ""}`} />
              {note.id === activeNoteId && <span className="quick-switcher-current">当前</span>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
