import { ToolbarIcon } from "./ToolbarIcon";

export interface PreviewFindInput {
  query: string;
  onQuery: (query: string) => void;
  matchCase: boolean;
  onCase: (value: boolean) => void;
  onCloseFind: () => void;
}

export function FileBrowserPreviewFind({ query, onQuery, matchCase, onCase, onCloseFind, current, count, limited, step }: PreviewFindInput & {
  current: number; count: number; limited: boolean; step: (direction: -1 | 1) => void;
}) {
  return <div className="file-browser-preview-find" role="search" aria-label="预览内查找" onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCloseFind(); }
    else if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); event.stopPropagation(); step(event.shiftKey ? -1 : 1); }
  }}>
    <input type="search" aria-label="查找预览文本" placeholder="仅查找已预览内容" maxLength={256} value={query} onChange={event => onQuery(event.target.value)} />
    <button type="button" aria-label="预览查找区分大小写" aria-pressed={matchCase} title="区分大小写" onClick={() => onCase(!matchCase)}>Aa</button>
    <span role="status">{count ? `${current + 1}/${count}${limited ? "+" : ""}` : "0/0"}</span>
    <button type="button" className="btn-icon" aria-label="上一个预览匹配" disabled={!count} onClick={() => step(-1)}><ToolbarIcon name="chevronLeft" /></button>
    <button type="button" className="btn-icon" aria-label="下一个预览匹配" disabled={!count} onClick={() => step(1)}><ToolbarIcon name="chevronRight" /></button>
    <button type="button" className="btn-icon" aria-label="关闭预览查找" onClick={onCloseFind}><ToolbarIcon name="close" /></button>
  </div>;
}
