import { useEffect, useState } from "react";
import { snippetParts } from "../lib/storage/idb-snippet";
import type { SearchNote } from "../lib/search-index-core";
import type { Note } from "../types/models";
import { extractPlainText } from "../lib/storage/core";
import { DocumentListContent, ListState } from "./ListPresentation";

const PAGE_SIZE = 80;

interface Props {
  notes: (SearchNote | Note)[];
  searchTerm: string;
  searching: boolean;
  onClose: () => void;
  onSelectNote: (note: SearchNote | Note, keepSearch: boolean, searchTerm: string) => void;
}

export function SearchResultsPanel({
  notes,
  searchTerm,
  searching,
  onClose,
  onSelectNote,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const total = notes.length;
  const visibleNotes = notes.slice(0, visibleCount);

  useEffect(() => setVisibleCount(PAGE_SIZE), [notes, searchTerm]);

  return (
    <div className="search-results" aria-label="搜索结果">
      <h3 className="search-results-header">
        <span>{searching ? "搜索中…" : `搜索结果（${total}）`}</span>
        <button type="button" onClick={onClose} aria-label="关闭搜索结果" title="关闭搜索结果">×</button>
      </h3>
      {total === 0 && <ListState kind={searching ? "loading" : "empty"} title={searching ? "正在搜索…" : "没有匹配的结果"} detail={searching ? "正在查找文档" : "试试更短的关键词，或调整筛选条件"} />}
      {notes.length > 0 && <div className="search-section-label">笔记</div>}
      {visibleNotes.map((note) => {
        const snippet = snippetParts((note as SearchNote).search_text ?? ("content" in note ? extractPlainText(note.content) : ""), searchTerm);
        return (
          <button
            type="button"
            key={note.id}
            className="search-hit"
            onClick={(event) => onSelectNote(note, event.ctrlKey || event.metaKey, searchTerm)}
          >
            <DocumentListContent variant="search-hit" title={note.title || "无标题"}
              path={note.storagePath} metadata={`文档 · ${note.date}`}
              preview={snippet.length > 0 ? snippet.map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text) : undefined} />
          </button>
        );
      })}
      {visibleCount < total && (
        <button
          type="button"
          className="search-load-more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          显示更多（剩余 {total - visibleCount}）
        </button>
      )}
    </div>
  );
}
