import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { browserLocation, moveBrowserHistory, navigateBrowserPane, selectBrowserItems, updateBrowserLocation, type BrowserPaneState } from "../lib/local-files/browser-state";
import { fileSegments, type FileNode, type FileRoot, type LocalFileFingerprint } from "../lib/local-files/service";
import type { localDirectoryProvider } from "../lib/local-files/browser-provider";
import { ToolbarIcon } from "./ToolbarIcon";

const ROW = 32;
const sizeText = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
type Provider = ReturnType<typeof localDirectoryProvider>;
interface Props {
  side: 0 | 1;
  active: boolean;
  visible: boolean;
  pane: BrowserPaneState;
  roots: FileRoot[];
  provider: Provider;
  onChange: Dispatch<SetStateAction<BrowserPaneState>>;
  onActivate: () => void;
  onChoose: () => void;
  onRefreshRoots: () => void;
  onOpen: (rootId: string, rootName: string, node: FileNode) => void;
}
export function FileBrowserPane({ side, active, visible, pane, roots, provider, onChange, onActivate, onChoose, onRefreshRoots, onOpen }: Props) {
  const location = browserLocation(pane);
  const rootId = location?.rootId ?? "", node = location?.node ?? "";
  const root = roots.find(item => item.id === rootId);
  const [pathInput, setPathInput] = useState(node);
  const [query, setQuery] = useState("");
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [scroll, setScroll] = useState(location?.scrollTop ?? 0);
  const [height, setHeight] = useState(400);
  const [metadata, setMetadata] = useState<Record<string, LocalFileFingerprint>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const metadataCache = useRef(new Map<string, LocalFileFingerprint>());
  const loadedKey = useRef("");
  const pageBusy = useRef(false);
  const anchor = useRef<string | null>(null);
  const cursor = useRef<string | null>(null);
  const restoring = useRef(false);
  const key = JSON.stringify([rootId, node, pane.sort, pane.showHidden, query, refresh]);
  const selected = useMemo(() => location?.selected ?? [], [location?.selected]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const start = Math.max(0, Math.min(Math.max(0, nodes.length - 1), Math.floor(scroll / ROW) - 4));
  const end = Math.min(nodes.length, start + Math.ceil(height / ROW) + 10);
  const navigate = (path: string) => {
    try { fileSegments(path); onChange(current => navigateBrowserPane(current, rootId, path)); setQuery(""); }
    catch (reason) { setError(String(reason)); }
  };
  useEffect(() => { setPathInput(node); anchor.current = null; cursor.current = null; }, [rootId, node]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight || 400));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !rootId) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    if (loadedKey.current === key) return () => controller.abort();
    restoring.current = true;
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
  const more = async () => {
    if (pageBusy.current || next === null || !request.current || request.current.signal.aborted) return;
    pageBusy.current = true;
    const controller = request.current;
    try {
      const page = await provider.page(rootId, node, next, { sort: pane.sort, showHidden: pane.showHidden, query }, controller.signal);
      if (!controller.signal.aborted) { setNodes(current => [...current, ...page.nodes]); setNext(page.next); }
    } catch (reason) { if (!controller.signal.aborted) setError(String(reason)); }
    finally { pageBusy.current = false; }
  };
  const chooseItem = (item: FileNode, toggle = false, range = false) => {
    onChange(current => updateBrowserLocation(current, { selected: selectBrowserItems(browserLocation(current)?.selected ?? [], nodes.map(value => value.id), item.id, anchor.current, toggle, range).slice(0, 2000) }));
    if (!range || !anchor.current) anchor.current = item.id;
    cursor.current = item.id;
  };
  const openItem = (item: FileNode) => item.directory ? navigate(item.id) : onOpen(rootId, root?.name ?? rootId, item);
  const pieces = node ? node.split("/") : [];
  return <section className={`file-browser-pane${active ? " is-active" : ""}`} aria-label={side === 0 ? "左侧目录" : "右侧目录"} data-browser-side={side} onPointerDown={onActivate} onFocusCapture={onActivate}>
    <header className="file-browser-pane-tools">
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
    <form className="file-browser-path" onSubmit={event => { event.preventDefault(); const path = pathInput.trim().replace(/^\/+|\/+$/g, ""); try { navigateBrowserPane(pane, rootId, path); navigate(path); } catch (reason) { setError(String(reason)); } }}>
      <input aria-label="根内相对路径" value={pathInput} disabled={!rootId} onChange={event => setPathInput(event.target.value)} placeholder="输入授权根内相对目录，Enter 前往" />
    </form>
    <div className="file-browser-options">
      <input type="search" aria-label="过滤文件名称" placeholder="过滤名称" value={query} onChange={event => { setQuery(event.target.value); setScroll(0); onChange(current => updateBrowserLocation(current, { scrollTop: 0 })); }} />
      <select aria-label="文件排序" value={pane.sort} onChange={event => { const sort = event.target.value as BrowserPaneState["sort"]; onChange(current => ({ ...current, sort })); }}><option value="name">名称 ↑</option><option value="name-desc">名称 ↓</option><option value="type">类型</option></select>
      <label><input type="checkbox" checked={pane.showHidden} onChange={event => { const showHidden = event.target.checked; onChange(current => ({ ...current, showHidden })); }} />隐藏项</label>
    </div>
    <div className="file-browser-columns" aria-hidden="true"><span>名称</span><span>大小</span><span>修改时间</span></div>
    <div ref={scrollRef} className="file-browser-list" role="listbox" aria-label="文件列表" aria-multiselectable="true" tabIndex={0} onPointerDown={() => { restoring.current = false; }} onWheel={() => { restoring.current = false; }} onScroll={event => {
      const top = event.currentTarget.scrollTop; setScroll(top);
      // Do not persist the browser's temporary clamp while a previous position
      // is being restored against a newly fetched/virtualized list.
      if (!restoring.current && !loading && loadedKey.current === key) onChange(current => updateBrowserLocation(current, { scrollTop: top }));
    }} onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter") { const item = nodes.find(value => value.id === (cursor.current ?? selected[selected.length - 1])); if (item) { event.preventDefault(); openItem(item); } }
      else if (event.key === "Backspace" && node) { event.preventDefault(); navigate(pieces.slice(0, -1).join("/")); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); onChange(current => updateBrowserLocation(current, { selected: nodes.slice(0, 2000).map(item => item.id) })); }
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); const current = nodes.findIndex(item => item.id === (cursor.current ?? selected[selected.length - 1]));
        const index = Math.max(0, Math.min(nodes.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)));
        if (nodes[index]) { chooseItem(nodes[index], false, event.shiftKey); scrollRef.current?.scrollTo({ top: Math.max(0, index * ROW - height / 2) }); }
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " ") {
        const index = nodes.findIndex(item => item.name.toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));
        if (index >= 0) { event.preventDefault(); chooseItem(nodes[index]); scrollRef.current?.scrollTo({ top: index * ROW }); }
      }
    }}>
      <div style={{ height: start * ROW }} aria-hidden="true" />
      {nodes.slice(start, end).map(item => <div key={item.id} className="file-browser-row" role="option" aria-selected={selectedSet.has(item.id)} data-node-id={item.id} title={[root?.name, item.id].filter(Boolean).join("/")} onClick={event => { chooseItem(item, event.ctrlKey || event.metaKey, event.shiftKey); scrollRef.current?.focus({ preventScroll: true }); }} onDoubleClick={() => openItem(item)}>
        <span className="file-browser-name"><ToolbarIcon name={item.directory ? "folder" : "formatDocument"} /><span>{item.name}</span></span>
        <span>{item.directory ? "—" : metadata[item.id] ? sizeText(metadata[item.id].size) : item.size ? sizeText(item.size) : "…"}</span>
        <span>{metadata[item.id]?.modifiedMs ? new Date(metadata[item.id].modifiedMs).toLocaleString() : "—"}</span>
      </div>)}
      <div style={{ height: Math.max(0, nodes.length - end) * ROW }} aria-hidden="true" />
      {!nodes.length && <p className="file-browser-empty">{loading ? "正在读取目录…" : rootId ? error ? "目录暂不可用，可返回上级或重新授权" : "空目录" : "选择或添加一个本地目录"}</p>}
    </div>
    {error && <div className="file-browser-error" role="alert">{error}<button type="button" aria-label="关闭目录错误" onClick={() => setError("")}>×</button></div>}
    <footer className="file-browser-pane-status"><span>{selected.length ? `选中 ${selected.length} 项 · ` : ""}{nodes.length} 项{next !== null ? "（已加载）" : ""}</span>{next !== null && <button type="button" onClick={() => void more()}>加载更多</button>}</footer>
  </section>;
}
