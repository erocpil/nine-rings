import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { api } from "../lib/api";
import { filterQuickSwitcherNotes, readRecentNoteIds } from "../lib/quick-switcher";
import { readDocumentFavorites, toggleDocumentFavorite } from "../lib/document-favorites";
import type { DocType, Note } from "../types/models";
import { ToolbarIcon } from "./ToolbarIcon";
import { DocumentPathPicker } from "./DocumentPathPicker";
import { documentModifiedTime } from "../lib/document-modified-time";
import { readDocumentBrowserPreferences, saveDocumentBrowserPreferences } from "../lib/document-browser-preferences";
import "./DocumentBrowser.css";

const DOCUMENT_TYPES: Record<DocType, string> = { explanation: "解释", "how-to": "指南", reference: "参考", tutorial: "教程" };
const DISPLAY_FIELDS = { path: "路径", tags: "标签", type: "类型", modified: "修改时间" };
type DisplayFields = Record<keyof typeof DISPLAY_FIELDS, boolean>;

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
  protectedPaths?: string[];
  path?: string;
  query?: string;
  sort?: string;
  view?: string;
  searchOpen?: boolean;
  filtersOpen?: boolean;
  showDetails?: boolean;
  fields?: DisplayFields;
  sortDirection?: "asc" | "desc";
  scrollTop?: number;
  scrollPositions?: Record<string, number>;
  docType?: DocType | "";
  tag?: string;
}

/** Metadata-only browsing: never index or preview document bodies, including unlocked ones. */
export function DocumentBrowser({ session, toolbarHost, selectedId, initialPath, refreshKey, disabled, onSelect, onCreate }: Props) {
  const [preferences] = useState(readDocumentBrowserPreferences);
  const [notes, setNotes] = useState<Note[]>(session.notes ?? []);
  const [paths, setPaths] = useState<string[]>(session.paths ?? []);
  const [protectedPaths, setProtectedPaths] = useState<string[]>(session.protectedPaths ?? []);
  const [pathPickerOpen, setPathPickerOpen] = useState(false);
  const [favorites, setFavorites] = useState(readDocumentFavorites);
  const [path, setPath] = useState(session.path ?? initialPath);
  const [query, setQuery] = useState(session.query ?? "");
  const [sort, setSort] = useState(session.sort ?? preferences.sort);
  const [sortDirection, setSortDirection] = useState(session.sortDirection ?? (session.sort ? (session.sort === "title" ? "asc" : "desc") : preferences.sortDirection));
  const [docType, setDocType] = useState<DocType | "">(session.docType ?? "");
  const [tag, setTag] = useState(session.tag ?? "");
  const [view, setView] = useState(session.view ?? preferences.view);
  const [searchOpen, setSearchOpen] = useState(session.searchOpen ?? false);
  const [filtersOpen, setFiltersOpen] = useState(session.filtersOpen ?? false);
  const [fields, setFields] = useState<DisplayFields>(session.fields ?? (session.showDetails === undefined ? preferences.fields : { path: true, tags: session.showDetails, type: session.showDetails, modified: session.showDetails }));
  const [preferencesFailed, setPreferencesFailed] = useState(false);
  useEffect(() => {
    setPreferencesFailed(!saveDocumentBrowserPreferences({ sort, sortDirection, view, fields }));
  }, [sort, sortDirection, view, fields]);
  const [recentIds] = useState(readRecentNoteIds);
  const scrollRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pathTriggerRef = useRef<HTMLButtonElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(!session.notes);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Object.assign(session, { notes, paths, protectedPaths, path, query, sort, sortDirection, view, docType, tag, searchOpen, filtersOpen, fields });
  }, [session, notes, paths, protectedPaths, path, query, sort, sortDirection, view, docType, tag, searchOpen, filtersOpen, fields]);
  useEffect(() => {
    const refreshFavorites = () => setFavorites(readDocumentFavorites());
    window.addEventListener("storage", refreshFavorites);
    return () => window.removeEventListener("storage", refreshFavorites);
  }, []);
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = session.scrollPositions?.[view]
      ?? (session.view === view ? session.scrollTop ?? 0 : 0);
  }, [session, view]);
  const switchView = (next: string) => {
    if (next === view) return;
    session.scrollPositions ??= {};
    session.scrollPositions[view] = scrollRef.current?.scrollTop ?? 0;
    setView(next);
  };
  const resetScroll = () => {
    // Filters apply to all three views, so old offsets no longer describe the
    // same result sets after changing a filter or sort order.
    session.scrollPositions = {};
    session.scrollTop = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  useEffect(() => {
    let active = true;
    setLoadError("");
    Promise.all([api.docs.search({}), api.docs.tree(false)])
      .then(([documents, tree]) => {
        if (!active) return;
        // Cache metadata only; opening always fetches the current document.
        setNotes(documents.map(note => ({ ...note, content: { ops: [], encrypted: note.content.encrypted } })));
        setPaths([...new Set(tree.filter(node => node.type === "folder").map(node => node.path))].sort());
        setProtectedPaths(tree.filter(node => node.type === "folder" && node.protected).map(node => node.path));
      })
      .catch((reason: unknown) => { if (active) setLoadError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey, reloadKey]);
  const visible = useMemo(() => {
    return filterQuickSwitcherNotes(notes, query).filter(note => (view !== "recent" || recentIds.includes(note.id))
      && (view !== "favorites" || favorites.includes(note.id))
      && (!docType || note.docType === docType)
      && (!tag || note.tags.includes(tag))
      && (!path || note.storagePath === path || note.storagePath?.startsWith(`${path}/`))
      )
      .sort((a, b) => {
        if (view === "recent") return recentIds.indexOf(a.id) - recentIds.indexOf(b.id);
        const comparison = sort === "title"
          ? (a.title ?? "").localeCompare(b.title ?? "", "zh-CN")
          : (Date.parse(a.updated_at) || 0) - (Date.parse(b.updated_at) || 0);
        return comparison * (sortDirection === "asc" ? 1 : -1) || a.id.localeCompare(b.id);
      });
  }, [notes, path, query, sort, sortDirection, view, recentIds, favorites, docType, tag]);
  const tags = useMemo(() => [...new Set(notes.flatMap(note => note.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")), [notes]);
  const hasFilters = Boolean(path || query.trim() || docType || tag);
  const clearFilters = () => { setPath(""); setQuery(""); setDocType(""); setTag(""); resetScroll(); };
  const actions = <>
    <button className="btn-icon" aria-label="搜索文档" title="筛选当前列表（标题、路径、标签或概念）" aria-expanded={searchOpen} onClick={() => {
      flushSync(() => setSearchOpen(!searchOpen));
      if (searchOpen) { setQuery(""); resetScroll(); }
      else searchRef.current?.focus({ preventScroll: true });
    }}><ToolbarIcon name="filter" /></button>
    <button className="btn-icon" aria-label="新建文档" title="在当前路径新建文档" disabled={disabled || opening} onClick={() => onCreate(path)}><ToolbarIcon name="plus" /></button>
  </>;
  return <section className="document-browser" aria-label="文档列表">
    {toolbarHost && createPortal(actions, toolbarHost)}
    <div className="document-browser-controls">
      {preferencesFailed && <p role="status" className="document-browser-empty">列表偏好未能保存到本机，当前会话仍可使用。</p>}
      <div className="document-browser-tabs" aria-label="文档浏览方式">
        <button aria-pressed={view === "recent"} onClick={() => switchView("recent")}>最近打开</button>
        <button aria-pressed={view === "all"} onClick={() => switchView("all")}>全部文档</button>
        <button aria-pressed={view === "favorites"} onClick={() => switchView("favorites")}>收藏</button>
        <span className="document-browser-count" aria-live="polite">{loading ? "…" : visible.length}</span>
        <button className={`document-browser-filter-toggle${hasFilters ? " is-filtered" : ""}`} aria-label="筛选" title={hasFilters ? "已应用筛选" : "筛选文档"} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><ToolbarIcon name="sliders" />筛选</button>
      </div>
      {searchOpen && <label className="document-browser-search"><span className="search-scope-label">当前列表</span><input ref={searchRef} aria-label="查找文档" placeholder="标题、路径、标签或概念" title="仅筛选当前列表，不搜索正文" value={query} onChange={event => { setQuery(event.target.value); resetScroll(); }} /></label>}
      {filtersOpen && <div className="document-browser-filters">
        <button ref={pathTriggerRef} className="document-browser-filter-control document-browser-path-trigger" aria-label="筛选路径" title={path || "全部路径"} onClick={() => setPathPickerOpen(true)}><ToolbarIcon name="folder" /><span>{path || "全部路径"}</span><ToolbarIcon name="chevronRight" /></button>
        <div className="document-browser-filter-control document-browser-type-trigger">
          <ToolbarIcon name="document" /><span aria-hidden="true">{docType ? DOCUMENT_TYPES[docType] : "全部类型"}</span><ToolbarIcon name="chevronRight" />
          <select className="document-browser-native-select" aria-label="文档类型筛选" value={docType} onChange={event => { setDocType(event.target.value as DocType | ""); resetScroll(); }}>
          <option value="">全部类型</option>
          {Object.entries(DOCUMENT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="document-browser-filter-control document-browser-tag-trigger">
          <ToolbarIcon name="tag" /><span aria-hidden="true">{tag || "全部标签"}</span><ToolbarIcon name="chevronRight" />
          <select className="document-browser-native-select" aria-label="文档标签筛选" value={tag} onChange={event => { setTag(event.target.value); resetScroll(); }}>
            <option value="">全部标签</option>
            {tag && !tags.includes(tag) && <option value={tag}>{tag}</option>}
            {tags.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        {view !== "recent" && <div className="document-browser-sort-controls">
          <div className="document-browser-filter-control">
          <ToolbarIcon name="ordered" /><span aria-hidden="true">{sort === "title" ? "按标题排序" : "按修改时间排序"}</span><ToolbarIcon name="chevronRight" />
          <select className="document-browser-native-select" aria-label="文档排序" value={sort} onChange={event => { setSort(event.target.value); setSortDirection(event.target.value === "title" ? "asc" : "desc"); resetScroll(); }}>
            <option value="updated">修改时间</option><option value="title">标题</option>
          </select></div>
          <div className="document-browser-filter-control">
          <ToolbarIcon name={sortDirection === "asc" ? "pageTop" : "pageBottom"} /><span aria-hidden="true">{sort === "title" ? (sortDirection === "asc" ? "标题升序" : "标题降序") : (sortDirection === "asc" ? "最早修改在前" : "最新修改在前")}</span><ToolbarIcon name="chevronRight" />
          <select className="document-browser-native-select" aria-label="文档排序方向" value={sortDirection} onChange={event => { setSortDirection(event.target.value as "asc" | "desc"); resetScroll(); }}>
            <option value="asc">{sort === "title" ? "标题升序" : "最早修改在前"}</option>
            <option value="desc">{sort === "title" ? "标题降序" : "最新修改在前"}</option>
          </select></div>
        </div>}
        <details className="document-browser-display-options"><summary>显示字段</summary>
        <fieldset className="document-browser-display-fields" aria-label="显示字段">
          {(Object.keys(DISPLAY_FIELDS) as (keyof DisplayFields)[]).map(key => <label key={key}>
            <input type="checkbox" aria-label={`显示${DISPLAY_FIELDS[key]}`} checked={fields[key]} onChange={event => { setFields(current => ({ ...current, [key]: event.target.checked })); resetScroll(); }} />{DISPLAY_FIELDS[key]}
          </label>)}
        </fieldset>
        </details>
      </div>}
      {hasFilters && <div className="document-browser-active-filters" aria-label="已应用筛选">
      {query.trim() && <button className="document-browser-type-filter" aria-label="清除关键词筛选" onClick={() => { setQuery(""); resetScroll(); }}><ToolbarIcon name="search" />{query.trim()}<ToolbarIcon name="close" /></button>}
      {path && <button className="document-browser-path-filter" title={path} aria-label={`清除路径筛选 ${path}`} onClick={() => { setPath(""); resetScroll(); }}>{path}<ToolbarIcon name="close" /></button>}
      {docType && <button className="document-browser-type-filter" aria-label="清除类型筛选" onClick={() => { setDocType(""); resetScroll(); }}>{DOCUMENT_TYPES[docType]}<ToolbarIcon name="close" /></button>}
      {tag && <button className="document-browser-type-filter" aria-label="清除标签筛选" onClick={() => { setTag(""); resetScroll(); }}><ToolbarIcon name="tag" />{tag}<ToolbarIcon name="close" /></button>}
      <button className="document-browser-clear-filters" onClick={clearFilters}>清除全部条件</button>
      </div>}
    </div>
    {pathPickerOpen && <DocumentPathPicker anchor={pathTriggerRef.current} paths={paths} protectedPaths={protectedPaths} initialPath={path}
      onClose={() => setPathPickerOpen(false)} onSelect={value => { setPath(value); resetScroll(); setPathPickerOpen(false); }} />}
    <div className="document-browser-list" ref={scrollRef} onScroll={event => {
      session.scrollTop = event.currentTarget.scrollTop;
      session.scrollPositions ??= {};
      session.scrollPositions[view] = event.currentTarget.scrollTop;
    }}>
      {loadError && <div className="document-browser-empty"><p role="alert">列表加载失败：{loadError}</p><button className="settings-btn" onClick={() => { setLoading(true); setReloadKey(key => key + 1); }}>重试加载</button></div>}
      {error && <p role="alert">操作失败：{error}</p>}
      {view === "favorites" && <p className="document-browser-favorites-hint">文档收藏，与正文书签独立；保存在本机，可随全量备份恢复。</p>}
      {!loading && !loadError && visible.length === 0 ? <div className="document-browser-empty">
        <p>{view === "recent" ? "暂无匹配的最近文档" : view === "favorites" ? "暂无匹配的收藏，点击文档右侧星标即可收藏" : "没有符合条件的文档"}</p>
        {hasFilters && <button className="settings-btn" onClick={clearFilters}>清除筛选</button>}
        {view !== "all" && <button className="settings-btn" onClick={() => switchView("all")}>浏览全部文档</button>}
        <button className="settings-btn" disabled={disabled || opening} onClick={() => onCreate(path)}>在此路径新建文档</button>
      </div> : visible.map(note => <div
        key={note.id} className={`document-browser-row${note.id === selectedId ? " selected" : ""}`}>
        <button data-drawer-swipe-item className="document-browser-open"
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
          {fields.path && note.storagePath !== path && <span className="document-browser-path" title={note.storagePath}>{(path ? note.storagePath?.slice(path.length + 1) : note.storagePath?.split("/").slice(-2).join(" / ")) || "未分类"}</span>}
          {fields.tags && note.tags.length > 0 && <span className="document-browser-tags">{note.tags.map(tag => <span key={tag}>{tag}</span>)}</span>}
          {((fields.type && note.docType) || fields.modified) && <span className="document-browser-meta-row">
            {fields.type && note.docType && <span className="document-browser-path document-browser-doc-type">{DOCUMENT_TYPES[note.docType]}</span>}
            {fields.modified && <ModifiedTime value={note.updated_at} />}
          </span>}
        </span>
        </button>
        <button className="document-browser-favorite" aria-label={`${favorites.includes(note.id) ? "取消收藏" : "收藏文档"} ${note.title || "未命名文档"}`}
          aria-pressed={favorites.includes(note.id)} disabled={disabled || opening} onClick={() => {
            try { setFavorites(toggleDocumentFavorite(note.id)); setError(""); }
            catch { setError("收藏保存失败，请检查本机存储空间或浏览器权限后重试"); }
          }}><ToolbarIcon name="star" /></button>
      </div>)}
    </div>
  </section>;
}

function ModifiedTime({ value }: { value: string }) {
  const { label, dateTime } = documentModifiedTime(value);
  return <time className="document-browser-modified" dateTime={dateTime}>{label}</time>;
}
