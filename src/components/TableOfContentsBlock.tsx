import { EditorFoldIcon } from "./EditorFoldIcon";
import { createContext, useContext, memo } from "react";
import type { DocumentOutlineItem } from "../lib/document-outline";
import { outlineLabel, tocLevels } from "../lib/heading-links";

export const DocumentOutlineContext = createContext<{ items: readonly DocumentOutlineItem[]; navigate?: (item: DocumentOutlineItem) => void }>({ items: [] });

export const TableOfContentsBlock = memo(function TableOfContentsBlock({ source, onLevelsChange, collapsed = false, onToggleCollapse }: { source: string; onLevelsChange?: (source: string) => void; collapsed?: boolean; onToggleCollapse?: () => void }) {
  const { items, navigate } = useContext(DocumentOutlineContext);
  const levels = tocLevels(source);
  const entries = items.filter(item => levels.includes(item.level));
  return <nav className="document-toc-block" aria-label="文档内目录" contentEditable={false}>
    <header><strong>目录</strong>{onLevelsChange && !collapsed && <fieldset aria-label="目录标题级别">
      {Array.from({ length: 6 }, (_, index) => index + 1).map(level => <label key={level}><input type="checkbox" aria-label={`目录展示 H${level}`} checked={levels.includes(level)} disabled={levels.length === 1 && levels[0] === level} onChange={event => {
        const next = event.target.checked ? [...levels, level].sort() : levels.filter(value => value !== level);
        onLevelsChange(`levels: ${next.join(",")}`);
      }} />H{level}</label>)}
    </fieldset>}{onToggleCollapse && <button type="button" className="document-toc-collapse-toggle" aria-label={collapsed ? "展开目录块" : "折叠目录块"} title={collapsed ? "展开目录块" : "折叠目录块"} aria-expanded={!collapsed} data-pdf-exclude onMouseDown={event => event.preventDefault()} onClick={onToggleCollapse}><EditorFoldIcon expanded={!collapsed} /></button>}</header>
    {!collapsed && (entries.length ? <ol>{entries.map(item => <li key={item.pos} style={{ paddingInlineStart: `${(item.level - Math.min(...levels)) * 12}px` }}><a href={`#nr-heading-${item.pos}`} title={outlineLabel(item.text, 500)} onClick={event => {
      if (!navigate) return;
      event.preventDefault(); event.stopPropagation(); navigate(item);
    }}>{outlineLabel(item.text)}</a></li>)}</ol> : <p>尚无所选级别的标题</p>)}
  </nav>;
});
