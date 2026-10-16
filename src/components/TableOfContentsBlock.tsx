import { EditorFoldIcon } from "./EditorFoldIcon";
import { createContext, useContext, memo } from "react";
import { selectDocumentToc, type DocumentOutlineItem } from "../lib/document-outline";
import { outlineLabel, tocLevels } from "../lib/heading-links";

export const DocumentOutlineContext = createContext<{ items: readonly DocumentOutlineItem[]; navigate?: (item: DocumentOutlineItem) => void }>({ items: [] });

export const TableOfContentsBlock = memo(function TableOfContentsBlock({ source, collapsed = false, onToggleCollapse }: { source: string; collapsed?: boolean; onToggleCollapse?: () => void }) {
  const { items, navigate } = useContext(DocumentOutlineContext);
  const levels = tocLevels(source);
  const entries = selectDocumentToc(items, levels);
  return <nav className="document-toc-block" aria-label="文档内目录" contentEditable={false}>
    <header><strong>目录</strong><span className="document-toc-levels" aria-label="目录标题级别">{levels.map(level => `H${level}`).join(" · ")}</span>{onToggleCollapse && <button type="button" className="document-toc-collapse-toggle" aria-label={collapsed ? "展开目录块" : "折叠目录块"} title={collapsed ? "展开目录块" : "折叠目录块"} aria-expanded={!collapsed} data-pdf-exclude onMouseDown={event => event.preventDefault()} onClick={onToggleCollapse}><EditorFoldIcon expanded={!collapsed} /></button>}</header>
    {!collapsed && (entries.length ? <ol>{entries.map(item => <li key={item.pos} data-heading-level={item.level} style={{ paddingInlineStart: `${item.depth * 14}px` }}><a href={`#nr-heading-${item.pos}`} title={outlineLabel(item.text, 500)} onClick={event => {
      if (!navigate) return;
      event.preventDefault(); event.stopPropagation(); navigate(item);
    }}><span className="document-toc-heading-level" aria-hidden="true">H{item.level}</span><span className="document-toc-heading-text">{outlineLabel(item.text)}</span></a></li>)}</ol> : <p>尚无所选级别的标题</p>)}
  </nav>;
});
