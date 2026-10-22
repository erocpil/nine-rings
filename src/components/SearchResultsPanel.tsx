import { documentOpenOptions, type DocumentOpenOptions } from "../lib/document-open";
import { useEffect, useState } from "react";
import { snippetParts } from "../lib/storage/idb-snippet";
import type { SearchNote } from "../lib/search-index-core";
import type { Note } from "../types/models";
import { extractPlainText } from "../lib/storage/core";
import { documentSourceLanguage, DOCUMENT_LANGUAGE_OPTIONS } from "../lib/document-language";
import { ListState } from "./ListPresentation";
import type { SearchOptions } from "../lib/search-matching";

const PAGE_SIZE = 80;

interface Props {
  notes: (SearchNote | Note)[];
  searchTerm: string;
  searching: boolean;
  options?: SearchOptions;
  onClose: () => void;
  onSelectNote: (note: SearchNote | Note, keepSearch: boolean, searchTerm: string, options?: DocumentOpenOptions) => void;
}

export function SearchResultsPanel({
  notes,
  searchTerm,
  searching,
  options,
  onClose,
  onSelectNote,
}: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const total = notes.length;
  const visibleNotes = notes.slice(0, visibleCount);

  const formatLabel = (note: SearchNote | Note) => {
    const metadata = "content" in note ? note.content.metadata : note;
    const language = documentSourceLanguage(metadata);
    return DOCUMENT_LANGUAGE_OPTIONS.find(option => option.value === language)?.label ?? "Text";
  };

  useEffect(() => setVisibleCount(PAGE_SIZE), [notes, searchTerm]);

  return (
    <div className="search-results" aria-label="搜索结果">
      <h3 className="search-results-header">
        <span>{searching ? "搜索中…" : `搜索结果（${total}）`}</span>
        <button type="button" onClick={onClose} aria-label="关闭搜索结果" title="关闭搜索结果">×</button>
      </h3>
      {total === 0 && <ListState kind={searching ? "loading" : "empty"} title={searching ? "正在搜索…" : "没有匹配的结果"} detail={searching ? "正在查找文档" : "试试更短的关键词，或调整筛选条件"} />}
      {visibleNotes.map((note) => {
        const snippet = (note as SearchNote).search_parts ?? snippetParts((note as SearchNote).search_text ?? ("content" in note ? extractPlainText(note.content) : ""), searchTerm, options);
        return (
          <button
            type="button"
            key={note.id}
            className="search-hit"
            onClick={(event) => { const openOptions = documentOpenOptions(event); onSelectNote(note, !openOptions && (event.ctrlKey || event.metaKey), searchTerm, openOptions); }}
          >
            <span className="ui-list-content search-hit-content">
              <span className="search-hit-heading">
                <span className="ui-list-title search-hit-title" title={note.title || "无标题"}>{note.title || "无标题"}</span>
                <span className="search-hit-meta" aria-label={`路径 ${note.storagePath || "未分类"}；类型 ${formatLabel(note)}；日期 ${note.date}`}>
                  {note.storagePath && <span className="search-hit-path" title={note.storagePath}>{note.storagePath}</span>}
                  <span className="search-hit-format">{formatLabel(note)}</span>
                  <time className="search-hit-date" dateTime={note.date}>{note.date}</time>
                </span>
              </span>
              {snippet.length > 0 && <span className="ui-list-preview search-hit-snippet">{snippet.map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : part.text)}</span>}
            </span>
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
