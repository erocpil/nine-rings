import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from "react";
import { useFileBrowserHost } from "./FileBrowserHost";
import type { FileRoot } from "../lib/local-files/file-model";
import { BROWSER_FAVORITES_EVENT, BROWSER_FAVORITES_KEY, readBrowserFavorites, resolveBrowserDirectoryInput, saveBrowserFavorites } from "../lib/local-files/browser-preferences";
import { browserLocation, type BrowserPaneState } from "../lib/local-files/browser-state";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { ToolbarIcon } from "./ToolbarIcon";
import type { BrowserDirectoryProvider } from "../lib/local-files/browser-contract";

export function FileBrowserLocations({ pane, roots, visible, provider, onNavigate, onHistory, onError, breadcrumbs, filter }: {
  breadcrumbs?: ReactNode; filter?: { value: string; onChange(value: string): void };
  pane: BrowserPaneState; roots: FileRoot[]; visible: boolean; provider: BrowserDirectoryProvider;
  onNavigate: (rootId: string, node: string) => void; onHistory: (index: number) => void; onError: (message: string) => void;
}) {
  const workspace = useFileBrowserHost();
  const location = browserLocation(pane), rootId = location?.rootId ?? "", node = location?.node ?? "";
  const [value, setValue] = useState(node), [busy, setBusy] = useState(false), [favorites, setFavorites] = useState(() => readBrowserFavorites(workspace.settings));
  const [menu, setMenu] = useState<{ kind: "history" | "favorites"; target: NotesMenuTarget } | null>(null);
  const [editing, setEditing] = useState(false), [filterOpen, setFilterOpen] = useState(false);
  const pathInput = useRef<HTMLInputElement>(null), filterInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null), filterButton = useRef<HTMLButtonElement>(null), filterHost = useRef<HTMLDivElement>(null);
  const filterId = useId();
  useLayoutEffect(() => { if (editing) { pathInput.current?.focus(); pathInput.current?.select(); } }, [editing]);
  useLayoutEffect(() => {
    if (!filterOpen || !filterHost.current || !filterInput.current) return;
    const pane = filterHost.current.closest(".file-browser-pane");
    const measure = () => {
      if (!filterHost.current || !filterInput.current) return;
      const anchor = filterHost.current.getBoundingClientRect(), bounds = pane?.getBoundingClientRect();
      filterInput.current.style.width = `${Math.max(70, Math.min(230, anchor.left - (bounds?.left ?? 0) - 12))}px`;
    };
    measure(); filterInput.current.focus();
    const observer = new ResizeObserver(measure);
    if (pane) observer.observe(pane);
    return () => observer.disconnect();
  }, [filterOpen]);
  useEffect(() => {
    if (!filterOpen) return;
    const outside = (event: PointerEvent) => { if (!filterHost.current?.contains(event.target as Node)) setFilterOpen(false); };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [filterOpen]);
  const controller = useRef<AbortController | null>(null);
  useLayoutEffect(() => { setValue(node); setEditing(false); }, [rootId, node]);
  useEffect(() => { controller.current?.abort(); setBusy(false); setMenu(null); setFilterOpen(false); return () => controller.current?.abort(); }, [rootId, node, visible]);
  useEffect(() => {
    const changed = () => setFavorites(readBrowserFavorites(workspace.settings));
    const storage = (event: StorageEvent) => { if (event.key === null || event.key.endsWith(BROWSER_FAVORITES_KEY)) changed(); };
    window.addEventListener(BROWSER_FAVORITES_EVENT, changed); window.addEventListener("storage", storage);
    return () => { window.removeEventListener(BROWSER_FAVORITES_EVENT, changed); window.removeEventListener("storage", storage); };
  }, [workspace]);
  const starred = favorites.some(item => item.rootId === rootId && item.node === node);
  const pathName = (id: string, path: string) => `${roots.find(root => root.id === id)?.name ?? "需重新授权"}/${path}`;
  const openMenu = (kind: "history" | "favorites", trigger: HTMLButtonElement) => {
    if (menu?.kind === kind) { setMenu(null); return; }
    const rect = trigger.getBoundingClientRect(); setMenu({ kind, target: { id: kind, title: kind, x: rect.left, y: rect.bottom, trigger } });
  };
  const submit = async () => {
    controller.current?.abort(); const operation = new AbortController(); controller.current = operation; setBusy(true);
    try {
      const absolute = /^(?:\/|\\|[a-z]:[\\/])/i.test(value.trim());
      let paths: Array<{ id: string; path: string }> = [];
      if (absolute) {
        if (!workspace.absolutePaths) throw new Error("浏览器不能获取本机完整目录路径，请输入授权根内相对路径");
        const results = await Promise.allSettled(roots.map(async root => ({ id: root.id, path: await workspace.displayPath(root.id, "") })));
        paths = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      }
      operation.signal.throwIfAborted();
      const target = resolveBrowserDirectoryInput(value, rootId, paths);
      await provider.page(target.rootId, target.node, 0, { sort: "name", showHidden: true, query: "" }, operation.signal);
      operation.signal.throwIfAborted(); setEditing(false); onNavigate(target.rootId, target.node);
    } catch (error) { if (!operation.signal.aborted) onError(String(error)); }
    finally { if (!operation.signal.aborted) setBusy(false); }
  };
  const save = (next: typeof favorites) => { try { saveBrowserFavorites(next, workspace.settings); } catch (error) { onError(String(error)); } };
  const actions = menu?.kind === "history" ? pane.history.map((entry, index) => ({ label: `${index === pane.index ? "✓ " : ""}${pathName(entry.rootId, entry.node)} · ${index + 1}`, disabled: !roots.some(root => root.id === entry.rootId), run: () => onHistory(index) })).reverse() : [
    ...favorites.map(item => ({ label: pathName(item.rootId, item.node), disabled: !roots.some(root => root.id === item.rootId), run: () => onNavigate(item.rootId, item.node) })),
    { label: "清理已撤销授权的常用目录", disabled: !favorites.some(item => !roots.some(root => root.id === item.rootId)), run: () => save(favorites.filter(item => roots.some(root => root.id === item.rootId))) },
  ];
  const closeFilter = () => { setFilterOpen(false); if (filter?.value) filter.onChange(""); filterButton.current?.focus({ preventScroll: true }); };
  return <form className="file-browser-path" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <div className={breadcrumbs ? "file-browser-address" : "file-browser-path-input"} onDoubleClick={event => { if (breadcrumbs && !editing && !(event.target as Element).closest("button")) setEditing(true); }}>
      {breadcrumbs && !editing ? <div className="file-browser-address-breadcrumbs" onClick={event => { if (!(event.target as Element).closest("button")) setEditing(true); }}>{breadcrumbs}</div> : <input ref={pathInput} aria-label="根内相对路径" value={value} disabled={!rootId} aria-busy={busy} onKeyDown={event => { if (breadcrumbs && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); controller.current?.abort(); setBusy(false); setValue(node); setEditing(false); editButton.current?.focus({ preventScroll: true }); } }} onChange={event => { controller.current?.abort(); setBusy(false); setValue(event.target.value); }} placeholder="相对路径；桌面版也可粘贴已授权目录的完整路径" />}
    </div>
    <button ref={editButton} type={breadcrumbs && !editing ? "button" : "submit"} className="btn-icon" aria-label={breadcrumbs && !editing ? "编辑路径" : "前往路径"} title={breadcrumbs && !editing ? "编辑路径" : "验证并前往路径"} disabled={!rootId || busy} onClick={event => { if (breadcrumbs && !editing) { event.preventDefault(); setMenu(null); setEditing(true); } }}><ToolbarIcon name={breadcrumbs && !editing ? "edit" : "chevronRight"} /></button>
    {filter && <div ref={filterHost} className="file-browser-filter-tool">
      <button ref={filterButton} type="button" className="btn-icon" aria-label="过滤名称" title={filter.value ? `过滤名称：${filter.value}` : "过滤名称"} aria-expanded={filterOpen} aria-controls={filterId} aria-pressed={Boolean(filter.value)} disabled={!rootId} onClick={() => { setMenu(null); if (filterOpen) closeFilter(); else setFilterOpen(true); }}><ToolbarIcon name="filter" /></button>
      {filterOpen && <input ref={filterInput} id={filterId} className="file-browser-filter-input" type="search" aria-label="过滤文件名称" placeholder="过滤名称" value={filter.value} onChange={event => filter.onChange(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFilter(); } }} />}
    </div>}
    <button type="button" className="btn-icon" aria-label="路径历史" title="当前标签的路径历史" disabled={!pane.history.length} onClick={event => { setFilterOpen(false); openMenu("history", event.currentTarget); }}><ToolbarIcon name="history" /></button>
    <button type="button" className="btn-icon" aria-label="收藏当前目录" title={starred ? "移除当前常用目录" : "收藏当前目录"} aria-pressed={starred} disabled={!rootId} onClick={() => save(starred ? favorites.filter(item => item.rootId !== rootId || item.node !== node) : [...favorites, { rootId, node }])}><ToolbarIcon name="star" /></button>
    <button type="button" className="btn-icon" aria-label="常用目录" title="打开常用目录" disabled={!favorites.length} onClick={event => { setFilterOpen(false); openMenu("favorites", event.currentTarget); }}><ToolbarIcon name="chevronDown" /></button>
    {menu && visible && <NotesContextMenu ignoreTrigger label={menu.kind === "history" ? "路径历史" : "常用目录"} target={menu.target} close={() => setMenu(null)} actions={actions} />}
  </form>;
}
