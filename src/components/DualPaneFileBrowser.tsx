import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { MainViewRequest } from "../lib/plugin-system/main-view-registry";
import { pluginRuntime } from "../lib/plugin-system/runtime";
import { localFileService, type FileNode, type FileRoot } from "../lib/local-files/service";
import { FILE_BROWSER_STATE_KEY, browserLocation, navigateBrowserPane, type BrowserPaneState } from "../lib/local-files/browser-state";
import { activeBrowserPanes, addBrowserTab, MAX_BROWSER_TABS, parseBrowserWorkspace, reconcileBrowserTabs, selectBrowserTab, updateBrowserTab } from "../lib/local-files/browser-tabs";
import { FILE_BROWSER_MUTATION_EVENT, type BrowserMutation, type BrowserOperation } from "../lib/local-files/browser-operations";
import { FileBrowserOperationDialog } from "./FileBrowserOperationDialog";
import { localDirectoryProvider } from "../lib/local-files/browser-provider";
import { FileBrowserPane } from "./FileBrowserPane";
import { ToolbarIcon } from "./ToolbarIcon";
import { FileBrowserQuickPreview } from "./FileBrowserQuickPreview";
import { FileBrowserToolDialog } from "./FileBrowserToolDialog";
import { FileBrowserComparison } from "./FileBrowserComparison";
import { LocalFileSearch } from "./LocalFileSearch";
import type { BrowserDirectory } from "../lib/local-files/browser-tools";
import type { LocalFileViewData } from "../lib/plugin-system/main-view-registry";
import "../styles/file-browser.css";

export function DualPaneFileBrowser({ request, active, onClose }: {
  request: Extract<MainViewRequest, { renderer: "file-browser" }>;
  active: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState(() => {
    try { return parseBrowserWorkspace(localStorage.getItem(FILE_BROWSER_STATE_KEY)); }
    catch { return parseBrowserWorkspace(null); }
  });
  const panes = activeBrowserPanes(state);
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [error, setError] = useState("");
  const [rootsRevision, setRootsRevision] = useState(0);
  const [opening, setOpening] = useState(false);
  const [operation, setOperation] = useState<BrowserOperation | null>(null);
  const [listingRevision, setListingRevision] = useState(0);
  const [quickPreview, setQuickPreview] = useState(false);
  const [tool, setTool] = useState<{ kind: "search"; scope: BrowserDirectory } | { kind: "compare"; directories: [BrowserDirectory, BrowserDirectory]; names: [string, string] } | null>(null);
  const host = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const pickSide = useRef<0 | 1>(0);
  const latestState = useRef(state); latestState.current = state;
  const activity = useRef<AbortController | null>(null);
  const provider = useMemo(() => localDirectoryProvider(request.owner), [request.owner]);
  useEffect(() => { if (!active) { setOperation(null); setTool(null); } }, [active]);
  useEffect(() => {
    const changed = (event: Event) => {
      setState(current => reconcileBrowserTabs(current, (event as CustomEvent<BrowserMutation>).detail));
      setListingRevision(value => value + 1);
    };
    window.addEventListener(FILE_BROWSER_MUTATION_EVENT, changed);
    return () => window.removeEventListener(FILE_BROWSER_MUTATION_EVENT, changed);
  }, []);
  const startOperation = (kind: BrowserOperation["kind"]) => {
    const source = browserLocation(panes[state.active]);
    const target = browserLocation(panes[state.active === 0 ? 1 : 0]);
    if (!source || !target) return;
    setOperation({ kind, rootId: source.rootId, rootName: roots.find(root => root.id === source.rootId)?.name ?? source.rootId,
      parent: source.node, nodes: kind === "file" || kind === "directory" ? [] : [...source.selected],
      targetRootId: target.rootId, targetRootName: roots.find(root => root.id === target.rootId)?.name ?? target.rootId, targetParent: target.node });
  };
  const currentLocation = browserLocation(panes[state.active]);
  const previewNode = currentLocation?.selected[currentLocation.selected.length - 1];
  const selectionCount = currentLocation?.selected.length ?? 0;
  const writable = Boolean(currentLocation && localFileService.supportsDirectoryChanges(currentLocation.rootId));
  const openComparison = () => {
    const locations = panes.map(browserLocation);
    if (!locations[0] || !locations[1]) return;
    const directories = locations.map(location => ({ rootId: location!.rootId, node: location!.node })) as [BrowserDirectory, BrowserDirectory];
    setTool({ kind: "compare", directories, names: directories.map(directory => `${roots.find(root => root.id === directory.rootId)?.name ?? directory.rootId}/${directory.node}`) as [string, string] });
  };
  const changePane = useCallback((side: 0 | 1, next: SetStateAction<BrowserPaneState>) => setState(current => {
    return updateBrowserTab(current, side, pane => typeof next === "function" ? next(pane) : next);
  }), []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); activity.current = controller;
    setOpening(false);
    return () => controller.abort();
  }, [active, request.owner]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void localFileService.roots().then(value => {
      if (!alive) return;
      pluginRuntime.assert(request.owner, "filesystem.files.read");
      setRoots(value);
      const first = value.find(root => root.id === request.data.rootId) ?? value[0];
      if (first) setState(current => ({ ...current, groups: current.groups.map(group => ({ ...group, tabs: group.tabs.map(tab => browserLocation(tab) ? tab : { ...navigateBrowserPane(tab, first.id, ""), tabId: tab.tabId }) })) as typeof current.groups }));
    }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [active, request.owner, request.data.rootId, rootsRevision]);
  useEffect(() => {
    const save = () => {
      try {
        const raw = JSON.stringify(latestState.current);
        if (raw.length > 512 * 1024) throw new Error("浏览状态过大");
        localStorage.setItem(FILE_BROWSER_STATE_KEY, raw);
      } catch { setError("无法记住浏览位置，本次仍可继续使用。请检查本地存储空间。"); }
    };
    const timer = window.setTimeout(save, 200);
    window.addEventListener("pagehide", save);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", save); };
  }, [state]);
  useEffect(() => () => {
    try { const raw = JSON.stringify(latestState.current); if (raw.length <= 512 * 1024) localStorage.setItem(FILE_BROWSER_STATE_KEY, raw); } catch { /* Last successful UI snapshot remains available. */ }
  }, []);
  const addRoot = (root: FileRoot | null, side: 0 | 1) => {
    if (!root) return;
    pluginRuntime.assert(request.owner, "filesystem.files.read");
    setRoots(current => [...current.filter(item => item.id !== root.id), root]);
    changePane(side, current => navigateBrowserPane(current, root.id, ""));
  };
  const choose = async (side: 0 | 1) => {
    if (!localFileService.supportsDirectoryPicker()) { pickSide.current = side; input.current?.click(); return; }
    const controller = activity.current;
    try {
      const root = await localFileService.choose();
      if (!controller?.signal.aborted) addRoot(root, side);
    } catch (reason) { if (!controller?.signal.aborted) setError(String(reason)); }
  };
  const open = async (rootId: string, rootName: string, node: FileNode, location?: LocalFileViewData["location"]) => {
    if (opening || !activity.current) return;
    const controller = activity.current;
    setOpening(true); setError("");
    try { await provider.open(rootId, rootName, node, controller.signal, location); }
    catch (reason) { if (!controller.signal.aborted) setError(String(reason)); }
    finally { if (!controller.signal.aborted) setOpening(false); }
  };
  return <section ref={host} className="dual-file-browser" aria-label="双栏文件浏览" data-active-pane={state.active} hidden={!active} {...(!active ? { inert: "", "aria-hidden": true } : {})} onKeyDown={event => {
    if (quickPreview || event.defaultPrevented || event.key !== "Tab" || !(event.target instanceof HTMLElement) || !event.target.matches(".file-browser-list")) return;
    event.preventDefault(); const side = state.active === 0 ? 1 : 0;
    setState(current => ({ ...current, active: side }));
    requestAnimationFrame(() => host.current?.querySelector<HTMLElement>(`[data-browser-side="${side}"] .file-browser-list`)?.focus({ preventScroll: true }));
  }}>
    <header className="file-browser-heading"><ToolbarIcon name="compare" /><strong>文件浏览</strong><span>活动栏为来源 · 另一栏为目标</span><button type="button" className="btn-icon" title="返回原视图" aria-label="返回原视图" onClick={onClose}><ToolbarIcon name="chevronLeft" /></button></header>
    <div className="file-browser-mobile-tabs" role="group" aria-label="切换目录栏">{([0, 1] as const).map(side => <button key={side} type="button" aria-pressed={state.active === side} onClick={() => { setQuickPreview(false); setState(current => ({ ...current, active: side })); }}>{side === 0 ? "左栏" : "右栏"}</button>)}</div>
    <div className="file-browser-actions" role="group" aria-label="双栏文件操作">
      <span>{state.active === 0 ? "左栏" : "右栏"} → {state.active === 0 ? "右栏" : "左栏"}</span>
      {(["copy", "move", "rename", "batch-rename", "file", "directory", "trash"] as const).map(kind => {
        const label = { copy: "复制到另一栏", move: "移动到另一栏", rename: "重命名", "batch-rename": "批量重命名", file: "新建文件", directory: "新建文件夹", trash: "移入系统回收站" }[kind];
        const disabled = opening || !writable || ((kind === "copy" || kind === "move") && !localFileService.canTransfer()) || (kind === "trash" && !localFileService.canTrash()) || (["copy", "move", "trash", "batch-rename"].includes(kind) && !selectionCount) || (kind === "rename" && selectionCount !== 1);
        return <button key={kind} type="button" disabled={disabled} title={(kind === "copy" || kind === "move") && !localFileService.canTransfer() ? "双栏传输需要桌面版" : label} onClick={() => startOperation(kind)}>{label}</button>;
      })}
      <button type="button" aria-pressed={quickPreview} onClick={() => setQuickPreview(value => !value)}>快速预览</button>
      <button type="button" disabled={!currentLocation} onClick={openComparison}>比较目录</button>
      <button type="button" disabled={!currentLocation} onClick={() => currentLocation && setTool({ kind: "search", scope: { rootId: currentLocation.rootId, node: currentLocation.node } })}>搜索正文</button>
    </div>
    {error && <div className="file-browser-error" role="alert">{error}<button type="button" aria-label="关闭浏览错误" onClick={() => setError("")}>×</button></div>}
    {opening && <p role="status" className="file-browser-opening">正在打开文件…</p>}
    <div className="file-browser-panes" style={{ gridTemplateColumns: `minmax(0, ${state.ratio}fr) 5px minmax(0, ${1 - state.ratio}fr)` }}>
      {([0, 1] as const).map(side => <div key={side} className="file-browser-pane-slot" data-mobile-active={quickPreview ? state.active !== side : state.active === side} style={{ gridColumn: side === 0 ? 1 : 3 }}><div className="file-browser-directory-host" hidden={quickPreview && state.active !== side}><FileBrowserPane key={state.groups[side].tabs[state.groups[side].active].tabId} side={side} active={state.active === side} visible={active && (!quickPreview || state.active === side)} revision={listingRevision} pane={panes[side]} roots={roots} provider={provider} onChange={next => changePane(side, next)} onActivate={() => setState(current => current.active === side ? current : { ...current, active: side })} onChoose={() => void choose(side)} onRefreshRoots={() => setRootsRevision(value => value + 1)} onOpen={(rootId, rootName, node) => void open(rootId, rootName, node)} tabBar={<div className="file-browser-tabs" role="tablist" aria-label={side === 0 ? "左栏目录标签" : "右栏目录标签"}>{state.groups[side].tabs.map((tab, index) => {
        const location = browserLocation(tab), label = location?.node.split("/").pop() || roots.find(root => root.id === location?.rootId)?.name || "目录";
        return <div key={tab.tabId} className="file-browser-tab"><button role="tab" type="button" aria-selected={index === state.groups[side].active} title={location ? `${roots.find(root => root.id === location.rootId)?.name ?? location.rootId}/${location.node}` : label} onClick={() => setState(current => selectBrowserTab(current, side, index))}>{label}</button><button type="button" aria-label={`关闭目录标签 ${index + 1}`} disabled={state.groups[side].tabs.length === 1} onClick={() => setState(current => selectBrowserTab(current, side, index, true))}>×</button></div>;
      })}<button type="button" aria-label="新建目录标签" title="新建目录标签" disabled={state.groups[side].tabs.length >= MAX_BROWSER_TABS} onClick={() => setState(current => addBrowserTab(current, side))}>＋</button></div>} /></div>{quickPreview && state.active !== side && <FileBrowserQuickPreview rootId={currentLocation?.rootId ?? ""} node={previewNode} provider={provider} active={active} revision={listingRevision} onClose={() => setQuickPreview(false)} />}</div>)}
      <div className="file-browser-splitter" role="separator" aria-label="双栏宽度" aria-orientation="vertical" tabIndex={0} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(state.ratio * 100)} onKeyDown={event => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const delta = event.key === "ArrowRight" ? .05 : -.05; setState(current => ({ ...current, ratio: Math.max(.25, Math.min(.75, current.ratio + delta)) })); }
      }} onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
        setState(current => ({ ...current, ratio: Math.max(.25, Math.min(.75, (event.clientX - bounds.left) / bounds.width)) }));
      }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
    </div>
    <input ref={element => { input.current = element; element?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden aria-label="选择目录快照" onChange={event => {
      try { addRoot(localFileService.addFiles(Array.from(event.target.files ?? [])), pickSide.current); }
      catch (reason) { setError(String(reason)); }
      event.currentTarget.value = "";
    }} />
    {operation && active && <FileBrowserOperationDialog operation={operation} owner={request.owner} onClose={() => { setOperation(null); setListingRevision(value => value + 1); }} />}
    {tool && active && <FileBrowserToolDialog title={tool.kind === "search" ? "目录搜索" : "目录比较"} onClose={() => setTool(null)}>{tool.kind === "search" ? <LocalFileSearch embedded roots={roots} showHidden={panes[state.active].showHidden} active={active} initialScope={tool.scope} onClose={() => setTool(null)} onOpen={hit => { setTool(null); void open(hit.rootId, roots.find(root => root.id === hit.rootId)?.name ?? hit.rootId, { id: hit.node, name: hit.node.split("/").pop()!, directory: false, size: 0 }, { from: hit.from, to: hit.to, revision: hit.revision }); }} /> : <FileBrowserComparison directories={tool.directories} names={tool.names} provider={provider} onOpen={(side, node) => { const directory = tool.directories[side]; setTool(null); setQuickPreview(false); setState(current => ({ ...current, active: side })); if (node.directory) changePane(side, current => navigateBrowserPane(current, directory.rootId, node.id)); else void open(directory.rootId, roots.find(root => root.id === directory.rootId)?.name ?? directory.rootId, node); }} />}</FileBrowserToolDialog>}
  </section>;
}
