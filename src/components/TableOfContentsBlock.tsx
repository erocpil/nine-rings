import { createContext, useContext, memo } from "react";
import type { DocumentOutlineItem } from "../lib/document-outline";
import { outlineLabel, tocLevels } from "../lib/heading-links";

export const DocumentOutlineContext = createContext<{ items: readonly DocumentOutlineItem[]; navigate?: (item: DocumentOutlineItem) => void }>({ items: [] });

export const TableOfContentsBlock = memo(function TableOfContentsBlock({ source, onLevelsChange }: { source: string; onLevelsChange?: (source: string) => void }) {
  const { items, navigate } = useContext(DocumentOutlineContext);
  const levels = tocLevels(source);
  const entries = items.filter(item => levels.includes(item.level));
  return <nav className="document-toc-block" aria-label="文档内目录" contentEditable={false}>
    <header><strong>目录</strong>{onLevelsChange && <fieldset aria-label="目录标题级别">
      {Array.from({ length: 6 }, (_, index) => index + 1).map(level => <label key={level}><input type="checkbox" aria-label={`目录展示 H${level}`} checked={levels.includes(level)} disabled={levels.length === 1 && levels[0] === level} onChange={event => {
        const next = event.target.checked ? [...levels, level].sort() : levels.filter(value => value !== level);
        onLevelsChange(`levels: ${next.join(",")}`);
      }} />H{level}</label>)}
    </fieldset>}</header>
    {entries.length ? <ol>{entries.map(item => <li key={item.pos} style={{ paddingInlineStart: `${(item.level - Math.min(...levels)) * 12}px` }}><a href={`#nr-heading-${item.pos}`} title={outlineLabel(item.text, 500)} onClick={event => {
      if (!navigate) return;
      event.preventDefault(); event.stopPropagation(); navigate(item);
    }}>{outlineLabel(item.text)}</a></li>)}</ol> : <p>尚无所选级别的标题</p>}
  </nav>;
});
