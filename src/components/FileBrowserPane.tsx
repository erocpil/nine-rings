import { useCallback, useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction, type ReactNode, type CSSProperties } from "react";
import { browserLocation, moveBrowserHistory, navigateBrowserPane, selectBrowserItems, updateBrowserLocation, type BrowserPaneState } from "../lib/local-files/browser-state";
import { fileSegments, type FileNode, type FileRoot, type LocalFileFingerprint } from "../lib/local-files/service";
import type { localDirectoryProvider } from "../lib/local-files/browser-provider";
import { ToolbarIcon } from "./ToolbarIcon";
import { browserNavigationIndex, browserRowScroll, browserTypeahead, type BrowserTypeahead } from "../lib/local-files/browser-keyboard";
import { FileBrowserLocations } from "./FileBrowserLocations";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { browserFullPath, clampBrowserColumn, DEFAULT_BROWSER_COLUMNS, parseBrowserColumns, type BrowserColumn } from "../lib/local-files/browser-preferences";
import { copyToClipboard } from "../lib/clipboard";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { appendLocalFileNodes, type LocalFileSort } from "../lib/local-files/tree";
import { localFileService } from "../lib/local-files/service";
import type { BrowserOperation } from "../lib/local-files/browser-operations";
import { FileBrowserColumnHeaders } from "./FileBrowserColumnHeaders";

const ROW = 32;
const sizeText = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
type Provider = ReturnType<typeof localDirectoryProvider>;
interface Props {
  tabBar?: ReactNode;
  side: 0 | 1;
  tabId: string;
  onCurrentChange: (side: 0 | 1, tabId: string, rootId: string, node: string | null) => void;
  active: boolean;
  visible: boolean;
  revision: number;
  pane: BrowserPaneState;
  roots: FileRoot[];
  provider: Provider;
  onChange: Dispatch<SetStateAction<BrowserPaneState>>;
  onActivate: () => void;
  onChoose: () => void;
  onRefreshRoots: () => void;
  onOpen: (rootId: string, rootName: string, node: FileNode) => void;
  onOperation: (kind: BrowserOperation["kind"], selection?: readonly string[]) => void;
  operationDisabled: (kind: BrowserOperation["kind"], count: number) => boolean;
  onPreview: () => void;
}
export function FileBrowserPane({ side, tabId, onCurrentChange, active, visible, revision, pane, roots, provider, onChange, onActivate, onChoose, onRefreshRoots, onOpen, onOperation, operationDisabled, onPreview, tabBar }: Props) {
  const location = browserLocation(pane);
  const rootId = location?.rootId ?? "", node = location?.node ?? "";
  const root = roots.find(item => item.id === rootId);
  const [query, setQuery] = useState("");
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [scroll, setScroll] = useState(location?.scrollTop ?? 0);
  const [height, setHeight] = useState(400);
  const [width, setWidth] = useState(363), [scrollLeft, setScrollLeft] = useState(0);
  const [metadata, setMetadata] = useState<Record<string, LocalFileFingerprint>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [typeahead, setTypeahead] = useState<BrowserTypeahead>({ query: "", at: 0 });
  const [columns, setColumns] = useState(() => { try { return parseBrowserColumns(localStorage.getItem(`nr:file-browser-columns:${side}`)); } catch { return { ...DEFAULT_BROWSER_COLUMNS }; } });
  const [paging, setPaging] = useState(false), [autoFailed, setAutoFailed] = useState(false);
  const [menu, setMenu] = useState<{ target: NotesMenuTarget; item: FileNode; selection: string[]; path: string | null } | null>(null);
  const { message, showMessage } = useTransientMessage();
  const columnsMinWidth = columns.name + columns.size + columns.modified + 36;
  const columnStyle = { "--browser-columns": `${columns.autoName ? `minmax(${columns.name}px, 1fr)` : `${columns.name}px`} ${columns.size}px ${columns.modified}px`, "--browser-columns-min": `${columnsMinWidth}px` } as CSSProperties;
  const listId = useId();
  const rowId = (id: string) => `${listId}-${encodeURIComponent(id)}`;
  const scrollRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const metadataCache = useRef(new Map<string, LocalFileFingerprint>());
  const loadedKey = useRef("");
  const pageBusy = useRef<AbortController | null>(null);
  const anchor = useRef<string | null>(null);
  const cursor = useRef<string | null>(null);
  const restoring = useRef(false);
  const key = JSON.stringify([rootId, node, pane.sort, pane.showHidden, query, refresh, revision]);
  const selected = useMemo(() => location?.selected ?? [], [location?.selected]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const start = Math.max(0, Math.min(Math.max(0, nodes.length - 1), Math.floor(scroll / ROW) - 4));
  const end = Math.min(nodes.length, start + Math.ceil(height / ROW) + 10);
  useEffect(() => {
    if (!typeahead.query) return;
    const timer = window.setTimeout(() => setTypeahead({ query: "", at: 0 }), 950);
    return () => clearTimeout(timer);
  }, [typeahead]);
  const navigate = (path: string) => {
    try { fileSegments(path); onChange(current => navigateBrowserPane(current, rootId, path)); setQuery(""); }
    catch (reason) { setError(String(reason)); }
  };
  useEffect(() => { try { localStorage.setItem(`nr:file-browser-columns:${side}`, JSON.stringify(columns)); } catch { showMessage("无法保存列宽，本次仍可调整", "error"); } }, [columns, side, showMessage]);
  useEffect(() => { setMenu(null); }, [key, visible]);
  const menuTarget = menu?.target;
  useEffect(() => {
    if (!menuTarget) return;
    let live = true;
    void localFileService.displayPath(rootId, node).then(path => { if (live) setMenu(current => current?.target === menuTarget ? { ...current, path } : current); }).catch(() => {});
    return () => { live = false; };
  }, [menuTarget, rootId, node]);
  useEffect(() => { anchor.current = null; cursor.current = null; setFocused(null); setTypeahead({ query: "", at: 0 }); onCurrentChange(side, tabId, rootId, null); }, [rootId, node, side, tabId, onCurrentChange]);
  useEffect(() => { setTypeahead({ query: "", at: 0 }); }, [query, pane.sort, pane.showHidden]);
  useEffect(() => {
    if (!loading && loadedKey.current === key && focused && !nodes.some(item => item.id === focused)) { cursor.current = null; setFocused(null); onCurrentChange(side, tabId, rootId, null); }
  }, [loading, key, focused, nodes, onCurrentChange, side, tabId, rootId]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { setHeight(element.clientHeight || 400); if (element.clientWidth) setWidth(element.clientWidth); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !rootId) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    if (loadedKey.current === key) return () => controller.abort();
    restoring.current = true;
    setAutoFailed(false); setPaging(false);
    metadataCache.current.clear(); setMetadata({});
    setLoading(true); setError(""); setNodes([]); setNext(null);
    void provider.page(rootId, node, 0, { sort: pane.sort, showHidden: pane.showHidden, query }, controller.signal)
      .then(async page => {
        const top = location?.scrollTop ?? 0;
        const entries = [...page.nodes];
        let nextPage = page.next;
        while (nextPage !== null && entries.length * ROW < top + height && entries.length < 10000) {
          const more = await provider.page(rootId, node, nextPage, { sort: pane.sort, showHidden: pane.showHidden, query }, controller.signal);
          entries.push(...more.nodes); nextPage = more.next;
        }
        if (controller.signal.aborted) return;
        for (const item of entries) if (!item.directory && item.modifiedMs !== undefined) metadataCache.current.set(item.id, { size: item.size, modifiedMs: item.modifiedMs });
        setMetadata(Object.fromEntries(metadataCache.current));
        loadedKey.current = key; setNodes(entries); setNext(nextPage);
        setScroll(top);
        requestAnimationFrame(() => {
          if (!controller.signal.aborted && scrollRef.current) scrollRef.current.scrollTop = top;
          requestAnimationFrame(() => { if (!controller.signal.aborted) restoring.current = false; });
        });
      }).catch(reason => { if (!controller.signal.aborted) setError(String(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Selection and scroll updates do not enumerate the directory again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible, provider]);
  useEffect(() => {
    if (!visible || loadedKey.current !== key) return;
    const controller = new AbortController();
    const items = nodes.slice(start, end).filter(item => !item.directory && !metadataCache.current.has(item.id));
    let index = 0;
    void Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
      while (!controller.signal.aborted && index < items.length) {
        const item = items[index++];
        try {
          const value = await provider.properties(rootId, item.id, controller.signal);
          if (!controller.signal.aborted) metadataCache.current.set(item.id, value);
        } catch { /* A deleted/unreadable item remains listed until refresh. */ }
      }
    })).then(() => { if (!controller.signal.aborted) setMetadata(Object.fromEntries(metadataCache.current)); });
    return () => controller.abort();
  }, [key, visible, nodes, start, end, provider, rootId]);
  const more = useCallback(async (manual = false) => {
    if (next === null || !request.current || pageBusy.current === request.current || request.current.signal.aborted || (!manual && autoFailed)) return;
    const controller = request.current;
    pageBusy.current = controller; setPaging(true); if (manual) { setAutoFailed(false); setError(""); }
    try {
      const page = await provider.page(rootId, node, next, { sort: pane.sort, showHidden: pane.showHidden, query }, controller.signal);
      if (page.next !== null && (!Number.isSafeInteger(page.next) || page.next <= next)) throw new Error("目录分页游标未前进，请刷新后重试");
      if (!controller.signal.aborted) {
        for (const item of page.nodes) if (!item.directory && item.modifiedMs !== undefined) metadataCache.current.set(item.id, { size: item.size, modifiedMs: item.modifiedMs });
        setNodes(current => appendLocalFileNodes(current, page.nodes)); setNext(page.next);
      }
    } catch (reason) { if (!controller.signal.aborted) { setAutoFailed(true); setError(String(reason)); } }
    finally { if (pageBusy.current === controller) pageBusy.current = null; if (request.current === controller && !controller.signal.aborted) setPaging(false); }
  }, [next, autoFailed, rootId, node, pane.sort, pane.showHidden, query, provider]);
  useEffect(() => { if (visible && !loading && !paging && nodes.length && scroll + height >= nodes.length * ROW - ROW * 3) void more(); }, [visible, loading, paging, nodes.length, scroll, height, more]);
  const chooseItem = (item: FileNode, toggle = false, range = false) => {
    const rangeAnchor = anchor.current ?? cursor.current ?? selected[selected.length - 1] ?? item.id;
    onChange(current => updateBrowserLocation(current, { selected: selectBrowserItems(browserLocation(current)?.selected ?? [], nodes.map(value => value.id), item.id, rangeAnchor, toggle, range).slice(0, 2000) }));
    if (!range) anchor.current = item.id;
    else if (!anchor.current) anchor.current = rangeAnchor;
    cursor.current = item.id; setFocused(item.id); onCurrentChange(side, tabId, rootId, item.id);
  };
  const revealIndex = (index: number) => {
    const list = scrollRef.current;
    if (list) list.scrollTop = browserRowScroll(list.scrollTop, list.clientHeight, index, ROW);
  };
  const openItem = (item: FileNode) => item.directory ? navigate(item.id) : onOpen(rootId, root?.name ?? rootId, item);
  const openMenu = (item: FileNode, x: number, y: number) => {
    if (loading || loadedKey.current !== key || !scrollRef.current) return;
    const selection = selectedSet.has(item.id) ? [...selected] : [item.id];
    if (!selectedSet.has(item.id)) chooseItem(item);
    else { cursor.current = item.id; setFocused(item.id); onCurrentChange(side, tabId, rootId, item.id); }
    setMenu({ target: { id: `${rootId}:${item.id}`, title: item.name, x, y, trigger: scrollRef.current }, item, selection, path: null });
  };
  const copy = (value: string, label: string) => { void copyToClipboard(value, { reportFailure: true }).then(() => showMessage(`已复制${label}`)).catch(error => showMessage(`复制失败：${String(error)}`, "error")); };
  const menuActions = menu ? [
    { label: "打开", disabled: menu.selection.length !== 1, run: () => openItem(menu.item) },
    { label: "快速预览", disabled: menu.selection.length !== 1 || menu.item.directory, run: onPreview },
    { label: "复制名称", run: () => copy(menu.selection.map(id => id.split("/").pop()).join("\n"), "名称") },
    { label: "复制路径", disabled: menu.path === null, run: () => menu.path !== null && copy(menu.path, "路径") },
    { label: "复制完整路径", disabled: menu.path === null, run: () => menu.path !== null && copy(menu.selection.map(id => browserFullPath(menu.path!, id.split("/").pop()!)).join("\n"), "完整路径") },
    ...(["copy", "move", "rename", "batch-rename", "trash"] as const).map(kind => ({ label: { copy: "复制到另一栏", move: "移动到另一栏", rename: "重命名", "batch-rename": "批量重命名", trash: "移入系统回收站" }[kind], disabled: operationDisabled(kind, menu.selection.length), run: () => onOperation(kind, menu.selection) })),
  ] : [];
  const changeColumn = (column: BrowserColumn, value: number) => setColumns(current => ({ ...current, [column]: clampBrowserColumn(column, value), autoName: column === "name" ? false : current.autoName }));
  const sortColumn = (column: BrowserColumn) => { const sort: LocalFileSort = pane.sort === column ? `${column}-desc` : column; onChange(current => ({ ...updateBrowserLocation(current, { scrollTop: 0 }), sort })); };
  const pieces = node ? node.split("/") : [];
  return <section style={columnStyle} className={`file-browser-pane${active ? " is-active" : ""}`} aria-label={side === 0 ? "左侧目录" : "右侧目录"} data-browser-side={side} onPointerDown={onActivate} onFocusCapture={onActivate}>
    {tabBar}
    <header className="file-browser-pane-tools">
      <span className="file-browser-pane-badge">{side === 0 ? "左栏" : "右栏"} · {active ? "来源" : "目标"}</span>
      <button type="button" className="btn-icon" aria-label="后退目录" disabled={pane.index <= 0} onClick={() => { setQuery(""); onChange(current => moveBrowserHistory(current, -1)); }}><ToolbarIcon name="chevronLeft" /></button>
      <button type="button" className="btn-icon" aria-label="前进目录" disabled={pane.index >= pane.history.length - 1} onClick={() => { setQuery(""); onChange(current => moveBrowserHistory(current, 1)); }}><ToolbarIcon name="chevronRight" /></button>
      <button type="button" className="btn-icon" aria-label="上级目录" disabled={!node} onClick={() => navigate(pieces.slice(0, -1).join("/"))}><span aria-hidden="true">↑</span></button>
      <select aria-label="选择授权目录" value={rootId} onChange={event => { setQuery(""); onChange(current => navigateBrowserPane(current, event.target.value, "")); }}>
        {!rootId && <option value="">选择目录</option>}
        {rootId && !root && <option value={rootId}>目录授权待恢复</option>}
        {roots.map(item => <option key={item.id} value={item.id}>{item.name}{item.transient ? "（本次授权）" : ""}</option>)}
      </select>
      <button type="button" className="btn-icon" aria-label="添加授权目录" title="添加授权目录" onClick={onChoose}><ToolbarIcon name="folder" /></button>
      <button type="button" className="btn-icon" aria-label="刷新目录" title="刷新目录" onClick={() => { onRefreshRoots(); setRefresh(value => value + 1); }}><ToolbarIcon name="refresh" /></button>
    </header>
    <nav className="file-browser-breadcrumb" aria-label="目录路径">
      <button type="button" disabled={!rootId} onClick={() => navigate("")}>{root?.name ?? "未选择目录"}</button>
      {pieces.map((part, index) => <button key={index} type="button" onClick={() => navigate(pieces.slice(0, index + 1).join("/"))}>{part}</button>)}
    </nav>
    <FileBrowserLocations pane={pane} roots={roots} visible={visible} provider={provider} onError={setError} onNavigate={(id, path) => { setQuery(""); onChange(current => navigateBrowserPane(current, id, path)); }} onHistory={index => { setQuery(""); onChange(current => ({ ...current, index })); }} />
    <div className="file-browser-options">
      <input type="search" aria-label="过滤文件名称" placeholder="过滤名称" value={query} onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); setQuery(""); } }} onChange={event => { setQuery(event.target.value); setScroll(0); onChange(current => updateBrowserLocation(current, { scrollTop: 0, selected: [] })); }} />
      <select aria-label="文件排序" title="大小/时间在完整目录中排序，会读取文件属性" value={pane.sort} onChange={event => { const sort = event.target.value as BrowserPaneState["sort"]; onChange(current => ({ ...updateBrowserLocation(current, { scrollTop: 0 }), sort })); }}><option value="name">名称 ↑</option><option value="name-desc">名称 ↓</option><option value="type">类型</option><option value="size">大小 ↑</option><option value="size-desc">大小 ↓</option><option value="modified">修改时间 ↑</option><option value="modified-desc">修改时间 ↓</option></select>
      <label><input type="checkbox" checked={pane.showHidden} onChange={event => { const showHidden = event.target.checked; onChange(current => ({ ...updateBrowserLocation(current, { selected: [], scrollTop: 0 }), showHidden })); }} />隐藏项</label>
    </div>
    <FileBrowserColumnHeaders columns={columns} sort={pane.sort} width={width} scrollLeft={scrollLeft} onSort={sortColumn} onResize={changeColumn} onReset={column => setColumns(current => ({ ...current, [column]: DEFAULT_BROWSER_COLUMNS[column], autoName: column === "name" ? true : current.autoName }))} />
    <div ref={scrollRef} className="file-browser-list" role="listbox" aria-label="文件列表" aria-busy={loading} aria-multiselectable="true" aria-activedescendant={focused && nodes.slice(start, end).some(item => item.id === focused) ? rowId(focused) : undefined} tabIndex={0} onFocus={() => {
      if (loading || loadedKey.current !== key) return;
      const item = nodes.find(item => item.id === cursor.current) ?? nodes.find(item => item.id === selected[selected.length - 1]) ?? nodes[0];
      if (item) { cursor.current = item.id; setFocused(item.id); onCurrentChange(side, tabId, rootId, item.id); if (!selected.length) chooseItem(item); }
    }} onPointerDown={() => { restoring.current = false; }} onWheel={() => { restoring.current = false; }} onScroll={event => {
      const top = event.currentTarget.scrollTop; setScroll(top); setScrollLeft(event.currentTarget.scrollLeft);
      // Do not persist the browser's temporary clamp while a previous position
      // is being restored against a newly fetched/virtualized list.
      if (!restoring.current && !loading && loadedKey.current === key) onChange(current => updateBrowserLocation(current, { scrollTop: top }));
    }} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (loading || loadedKey.current !== key) return;
      if (event.nativeEvent.isComposing || event.altKey) return;
      if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) { event.preventDefault(); event.stopPropagation(); const item = nodes.find(item => item.id === cursor.current); if (item) { const rect = document.getElementById(rowId(item.id))?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect(); openMenu(item, rect.left + 20, rect.top + 20); } return; }
      if (event.key === "Enter") { const item = nodes.find(value => value.id === (cursor.current ?? selected[selected.length - 1])); if (item) { event.preventDefault(); openItem(item); } }
      else if (event.key === "Backspace" && node) { event.preventDefault(); navigate(pieces.slice(0, -1).join("/")); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); onChange(current => updateBrowserLocation(current, { selected: nodes.slice(0, 2000).map(item => item.id) })); }
      else if (["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const current = nodes.findIndex(item => item.id === (cursor.current ?? selected[selected.length - 1]));
        const index = browserNavigationIndex(event.key, current, nodes.length, height / ROW);
        if (index !== null) { chooseItem(nodes[index], false, event.shiftKey); revealIndex(index); }
      } else if (event.key === "Insert" || (event.key === " " && (event.ctrlKey || event.metaKey))) {
        event.preventDefault(); event.stopPropagation(); const item = nodes.find(item => item.id === cursor.current); if (item) chooseItem(item, true);
      } else if (event.key === "Escape" && typeahead.query) {
        event.preventDefault(); event.stopPropagation(); setTypeahead({ query: "", at: 0 });
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && event.key !== " ") {
        event.preventDefault(); event.stopPropagation();
        const result = browserTypeahead(nodes.map(item => item.name), nodes.findIndex(item => item.id === cursor.current), typeahead, event.key, performance.now());
        setTypeahead({ query: result.query, at: result.at });
        if (result.index >= 0) { chooseItem(nodes[result.index]); revealIndex(result.index); }
      }
    }}>
      <div style={{ height: start * ROW }} aria-hidden="true" />
      {nodes.slice(start, end).map(item => <div key={item.id} id={rowId(item.id)} className="file-browser-row" role="option" aria-selected={selectedSet.has(item.id)} data-current={focused === item.id} data-node-id={item.id} title={[root?.name, item.id].filter(Boolean).join("/")} onMouseDown={event => { if (event.button === 2) event.preventDefault(); }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); openMenu(item, event.clientX, event.clientY); }} onClick={event => { if (loading || loadedKey.current !== key) return; chooseItem(item, event.ctrlKey || event.metaKey, event.shiftKey); scrollRef.current?.focus({ preventScroll: true }); }} onDoubleClick={() => { if (!loading && loadedKey.current === key) openItem(item); }}>
        <span className={`file-browser-name${item.directory ? " is-directory" : ""}`}><ToolbarIcon name={item.directory ? "folder" : "document"} /><span>{item.name}</span></span>
        <span>{item.directory ? "—" : metadata[item.id] ? sizeText(metadata[item.id].size) : item.size ? sizeText(item.size) : "…"}</span>
        <span>{(metadata[item.id]?.modifiedMs ?? item.modifiedMs) ? new Date(metadata[item.id]?.modifiedMs ?? item.modifiedMs!).toLocaleString() : "—"}</span>
      </div>)}
      <div style={{ height: Math.max(0, nodes.length - end) * ROW }} aria-hidden="true" />
      {!nodes.length && <p className="file-browser-empty">{loading ? "正在读取目录…" : rootId ? error ? "目录暂不可用，可返回上级或重新授权" : "空目录" : "选择或添加一个本地目录"}</p>}
    </div>
    {error && <div className="file-browser-error" role="alert">{error}<button type="button" aria-label="关闭目录错误" onClick={() => setError("")}>×</button></div>}
    <footer className="file-browser-pane-status"><span title="选择操作最多 2000 项；目录数量不包含其内部文件">{selected.length ? `选中 ${selected.length} 项 · ` : ""}{nodes.length} 项{next !== null ? "（已加载）" : ""} · {nodes.filter(item => item.directory).length} 目录 / {nodes.filter(item => !item.directory).length} 文件</span>{typeahead.query && <span className="file-browser-typeahead" role="status">定位：{typeahead.query}（已加载）</span>}{next !== null && <button type="button" disabled={paging} onClick={() => void more(true)}>{paging ? "加载中…" : "加载更多"}</button>}</footer>
    {menu && visible && <NotesContextMenu label="文件菜单" target={menu.target} close={() => setMenu(null)} actions={menuActions} />}
    {message && <div className="file-browser-notice" role="status">{message}</div>}
  </section>;
}
