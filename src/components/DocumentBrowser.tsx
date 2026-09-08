import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { readRecentNoteIds } from "../lib/quick-switcher";
import type { Note } from "../types/models";
import { ToolbarIcon } from "./ToolbarIcon";
import "./DocumentBrowser.css";

interface Props {
  session: DocumentBrowserSession;
  toolbarHost: HTMLElement | null;
  selectedId: string | null;
  initialPath: string;
  refreshKey: number;
  disabled: boolean;
  onSelect: (note: Note) => void;
  onCreate: (path: string) => void;
}

export interface DocumentBrowserSession {
  notes?: Note[];
  paths?: string[];
  path?: string;
  query?: string;
  sort?: string;
  view?: string;
  searchOpen?: boolean;
  filtersOpen?: boolean;
  showDetails?: boolean;
  scrollTop?: number;
}

/** Metadata-only browsing: never index or preview document bodies, including unlocked ones. */
export function DocumentBrowser({ session, toolbarHost, selectedId, initialPath, refreshKey, disabled, onSelect, onCreate }: Props) {
  const [notes, setNotes] = useState<Note[]>(session.notes ?? []);
  const [paths, setPaths] = useState<string[]>(session.paths ?? []);
  const [path, setPath] = useState(session.path ?? initialPath);
  const [query, setQuery] = useState(session.query ?? "");
  const [sort, setSort] = useState(session.sort ?? "updated");
  const [view, setView] = useState(session.view ?? "recent");
  const [searchOpen, setSearchOpen] = useState(session.searchOpen ?? false);
  const [filtersOpen, setFiltersOpen] = useState(session.filtersOpen ?? false);
  const [showDetails, setShowDetails] = useState(session.showDetails ?? false);
  const [recentIds] = useState(readRecentNoteIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(!session.notes);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Object.assign(session, { notes, paths, path, query, sort, view, searchOpen, filtersOpen, showDetails });
  }, [session, notes, paths, path, query, sort, view, searchOpen, filtersOpen, showDetails]);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = session.scrollTop ?? 0;
  }, [session]);
  const resetScroll = () => {
    session.scrollTop = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([api.docs.search({}), api.docs.tree(false)])
      .then(([documents, tree]) => {
        if (!active) return;
        // Cache metadata only; opening always fetches the current document.
        setNotes(documents.map(note => ({ ...note, content: { ops: [], encrypted: note.content.encrypted } })));
        setPaths([...new Set(tree.filter(node => node.type === "folder").map(node => node.path))].sort());
      })
      .catch((reason: unknown) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return notes.filter(note => (view !== "recent" || recentIds.includes(note.id))
      && (!path || note.storagePath === path || note.storagePath?.startsWith(`${path}/`))
      && (!term || [note.title, note.storagePath, ...note.tags, ...(note.concepts ?? [])].join(" ").toLocaleLowerCase().includes(term)))
      .sort((a, b) => view === "recent" ? recentIds.indexOf(a.id) - recentIds.indexOf(b.id) : sort === "title"
        ? (a.title ?? "").localeCompare(b.title ?? "", "zh-CN")
        : b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  }, [notes, path, query, sort, view, recentIds]);
  const actions = <>
    <button className="btn-icon" aria-label="搜索文档" aria-expanded={searchOpen} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) { setQuery(""); resetScroll(); } }}><ToolbarIcon name="search" /></button>
    <button className="btn-icon" aria-label="新建文档" title="在当前路径新建文档" disabled={disabled || opening} onClick={() => onCreate(path)}><ToolbarIcon name="plus" /></button>
  </>;
  return <section className="document-browser" aria-label="文档列表">
    {toolbarHost && createPortal(actions, toolbarHost)}
    <div className="document-browser-controls">
      <div className="document-browser-tabs" aria-label="文档浏览方式">
        <button aria-pressed={view === "recent"} onClick={() => { setView("recent"); resetScroll(); }}>最近打开</button>
        <button aria-pressed={view === "all"} onClick={() => { setView("all"); resetScroll(); }}>全部文档</button>
        <span className="document-browser-count" aria-live="polite">{loading ? "…" : visible.length}</span>
        <button className="document-browser-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><ToolbarIcon name="sliders" />筛选</button>
      </div>
      {searchOpen && <input aria-label="查找文档" placeholder="查找标题、路径、标签或概念" value={query} onChange={event => { setQuery(event.target.value); resetScroll(); }} />}
      {filtersOpen && <div className="document-browser-filters">
        <label>路径<select aria-label="筛选路径" value={path} onChange={event => { setPath(event.target.value); resetScroll(); }}>
          <option value="">全部路径</option>
          {path && !paths.includes(path) && <option value={path}>{path}</option>}
          {paths.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        {view === "all" && <label>排序<select aria-label="文档排序" value={sort} onChange={event => { setSort(event.target.value); resetScroll(); }}>
          <option value="updated">最近修改</option><option value="title">标题排序</option>
        </select></label>}
        <label><input type="checkbox" checked={showDetails} onChange={event => setShowDetails(event.target.checked)} />显示标签和修改日期</label>
      </div>}
      {path && <button className="document-browser-path-filter" title={path} aria-label={`清除路径筛选 ${path}`} onClick={() => { setPath(""); resetScroll(); }}>{path}<ToolbarIcon name="close" /></button>}
    </div>
    <div className="document-browser-list" ref={scrollRef} onScroll={event => { session.scrollTop = event.currentTarget.scrollTop; }}>
      {error && <p role="alert">操作失败：{error}</p>}
      {!loading && visible.length === 0 ? <p>{view === "recent" ? "暂无匹配的最近文档，可切换到全部文档" : "没有符合条件的文档"}</p> : visible.map(note => <button
        key={note.id} data-drawer-swipe-item className={`document-browser-row${note.id === selectedId ? " selected" : ""}`}
        disabled={disabled || opening} onClick={async () => {
          setOpening(true);
          try {
            const current = await api.notes.get(note.id);
            if (!current || current.deleted_at) throw new Error("文档已删除，请重新打开列表");
            onSelect(current);
          } catch (reason) { setError(String(reason)); }
          finally { setOpening(false); }
        }} aria-current={note.id === selectedId ? "page" : undefined}>
        <ToolbarIcon name={note.readonly || note.content.encrypted ? "lock" : "document"} />
        <span className="document-browser-details">
          <span className="document-browser-title" title={note.title || "未命名文档"}>{note.title || "未命名文档"}</span>
          {note.storagePath !== path && <span className="document-browser-path" title={note.storagePath}>{(path ? note.storagePath?.slice(path.length + 1) : note.storagePath?.split("/").slice(-2).join(" / ")) || "未分类"}</span>}
          {showDetails && note.tags.length > 0 && <span className="document-browser-tags">{note.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}
        </span>
        {showDetails && <time dateTime={note.updated_at} title={new Date(note.updated_at).toLocaleString()}>{new Date(note.updated_at).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</time>}
      </button>)}
    </div>
  </section>;
}
