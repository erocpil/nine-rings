import { recordBrowserTabEvent, repairLegacyRevealDuplicate } from "../lib/local-files/browser-tab-diagnostics";
import { FileBrowserDirectorySize } from "./FileBrowserDirectorySize";
import { BrowserDirectorySizeCache } from "../lib/local-files/browser-directory-size";
import { FileBrowserShortcuts } from "./FileBrowserShortcuts";
import { useBrowserShortcuts } from "../hooks/useBrowserShortcuts";
import { browserShortcutAction, browserShortcutCommands, displayBrowserShortcut, saveBrowserShortcuts } from "../lib/local-files/browser-shortcuts";
import { FileBrowserNamedWorkspaces } from "./FileBrowserNamedWorkspaces";
import { restoreNamedBrowserWorkspace } from "../lib/local-files/browser-named-workspaces";
import { FileBrowserShelf } from "./FileBrowserShelf";
import { browserShelfId, type BrowserShelfEntry, type BrowserShelfTarget } from "../lib/local-files/browser-shelf";
import { FileBrowserCommandPalette, type FileBrowserCommand } from "./FileBrowserCommandPalette";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { FileBrowserRootManager } from "./FileBrowserRootManager";
import type { BrowserToolContext } from "../lib/local-files/browser-tool-context";
import { FileBrowserRowCount } from "./FileBrowserRowCount";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SetStateAction, type ReactNode } from "react";
import type { FileNode, FileRoot } from "../lib/local-files/file-model";
import { FILE_BROWSER_STATE_KEY, browserLocation, navigateBrowserPane, updateBrowserLocation, type BrowserPaneState } from "../lib/local-files/browser-state";
import { MAX_BROWSER_TABS, browserTabAllows, browserTabAnchor, transferBrowserTab, revokeBrowserRoot, activeBrowserPanes, activateBrowserRow, browserSideRows, setBrowserRowCount, updateBrowserRow, addBrowserTab, revealBrowserFile, exchangeBrowserPanes, mirrorBrowserPath, modifyBrowserTabs, reorderBrowserTab, parseBrowserWorkspace, reconcileBrowserTabs, selectBrowserTab, updateBrowserTab } from "../lib/local-files/browser-tabs";
import type { BrowserOperation } from "../lib/local-files/browser-operation-contract";
import { browserJobSettled } from "../lib/local-files/browser-queue-core";
import { FileBrowserQueueDialog } from "./FileBrowserQueueDialog";
import { FileBrowserOperationDialog } from "./FileBrowserOperationDialog";
import { FileBrowserTabs } from "./FileBrowserTabs";
import { FileBrowserPane } from "./FileBrowserPane";
import { ToolbarIcon } from "./ToolbarIcon";
import { FileBrowserQuickPreview } from "./FileBrowserQuickPreview";
import { FileBrowserToolDialog } from "./FileBrowserToolDialog";
import { FileBrowserComparison } from "./FileBrowserComparison";
import { LocalFileSearch } from "./LocalFileSearch";
import type { BrowserDirectory } from "../lib/local-files/browser-tools";
import type { BrowserTextLocation } from "../lib/local-files/browser-contract";
import type { BrowserWorkspaceHost } from "../lib/local-files/browser-workspace-contract";
import { FileBrowserDragContext, FileBrowserHostContext } from "./FileBrowserHost";
import "../styles/file-browser.css";
import type { BrowserPreviewNavigation } from "../lib/local-files/browser-preview";
import { BROWSER_DRAG_TYPE, planBrowserDrop, type BrowserDragSource } from "../lib/local-files/browser-drag";

interface Props { workspace: BrowserWorkspaceHost; active: boolean; initialRootId?: string; revealFile?: { rootId: string; node: string }; onClose?: () => void; toolbarExtras?: ReactNode; commands?: FileBrowserCommand[]; onToolContext?: (context: BrowserToolContext | null) => void }
export function FileBrowserWorkspace(props: Props) {
  return <FileBrowserHostContext.Provider value={props.workspace}><FileBrowserWorkspaceBody {...props} /></FileBrowserHostContext.Provider>;
}
function FileBrowserWorkspaceBody({ workspace, active, initialRootId, revealFile, onClose, toolbarExtras, commands = [], onToolContext }: Props) {
  const compact = workspace.presentation === "compact";
  const { shortcuts, mac } = useBrowserShortcuts(workspace.settings);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [shelf, setShelf] = useState<BrowserShelfEntry[]>([]);
  const [shelfOpen, setShelfOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsButton = useRef<HTMLButtonElement>(null);
  const reservations = workspace.shortcutReservations?.() ?? [];
  const [state, setState] = useState(() => {
    try {
      const restored = parseBrowserWorkspace(workspace.settings.getItem(FILE_BROWSER_STATE_KEY));
      return compact ? repairLegacyRevealDuplicate(workspace.settings, restored) : restored;
    }
    catch { return parseBrowserWorkspace(null); }
  });
  const tabCause = useRef("restore");
  const tabSignature = useRef("");
  useEffect(() => {
    const signature = state.groups.map(group => group.tabs.map(tab => tab.tabId).join(",")).join("|");
    if (signature !== tabSignature.current) {
      tabSignature.current = signature;
      recordBrowserTabEvent(workspace.settings, tabCause.current, state);
    }
    tabCause.current = "other-tab-action";
  }, [state, workspace]);
  const handledReveal = useRef<typeof revealFile>();
  useEffect(() => {
    if (!revealFile || !active || handledReveal.current === revealFile) return;
    handledReveal.current = revealFile;
    tabCause.current = "reveal-file";
    setState(current => revealBrowserFile(current, revealFile.rootId, revealFile.node));
  }, [revealFile, active]);
  const panes = activeBrowserPanes(state);
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [error, setError] = useState("");
  const [sizeScope, setSizeScope] = useState<{ rootId: string; node: string; name: string } | null>(null);
  const sizeCache = useRef(new BrowserDirectorySizeCache());
  const [rootsOpen, setRootsOpen] = useState(false);
  const rootRevoking = useRef(false);
  const [rootsRevision, setRootsRevision] = useState(0);
  const [opening, setOpening] = useState(false);
  const queue = workspace.queue;
  const jobs = useSyncExternalStore(queue.subscribe, queue.getSnapshot);
  const queueBusy = jobs.some(job => !browserJobSettled(job));
  const [queueOpen, setQueueOpen] = useState(false);
  const [operation, setOperation] = useState<BrowserOperation | null>(null);
  const [listingRevision, setListingRevision] = useState(0);
  const [quickPreview, setQuickPreview] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [currentRows, setCurrentRows] = useState<[ { tabId: string; rootId: string; node: string | null } | null, { tabId: string; rootId: string; node: string | null } | null ]>([null, null]);
  const onCurrentChange = useCallback((side: 0 | 1, tabId: string, rootId: string, node: string | null) => setCurrentRows(current => {
    const group = latestState.current.groups[side];
    if (group.tabs[group.active].tabId !== tabId) return current;
    const previous = current[side];
    if (previous?.tabId === tabId && previous.rootId === rootId && previous.node === node) return current;
    const next = [...current] as typeof current; next[side] = { tabId, rootId, node }; return next;
  }), []);
  const [tool, setTool] = useState<{ kind: "search"; scope: BrowserDirectory } | { kind: "compare"; directories: [BrowserDirectory, BrowserDirectory]; names: [string, string] } | null>(null);
  const host = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const pickSide = useRef<0 | 1>(0), pickRow = useRef(0);
  const latestState = useRef(state); latestState.current = state;
  const activity = useRef<AbortController | null>(null);
  const previewNavigation = useRef<[BrowserPreviewNavigation | null, BrowserPreviewNavigation | null]>([null, null]);
  const drag = useRef<{ token: string; source: BrowserDragSource } | null>(null);
  const provider = workspace.provider;
  useEffect(() => { if (!active) { setOperation(null); setTool(null); setQueueOpen(false); setShortcutsOpen(false); setPaletteOpen(false); setShelfOpen(false); setLayoutsOpen(false); setSizeScope(null); drag.current = null; } }, [active]);
  useEffect(() => workspace.subscribeMutations(change => {
    sizeCache.current.invalidate(change.rootId);
    if (change.targetRootId) sizeCache.current.invalidate(change.targetRootId);
    setSizeScope(null);
    setState(current => reconcileBrowserTabs(current, change));
    setListingRevision(value => value + 1);
  }), [workspace]);
  const startOperation = (kind: BrowserOperation["kind"], side: 0 | 1 = state.active, selection?: readonly string[]) => {
    if (operationDisabled(kind, side, selection?.length, selection)) return;
    const source = browserLocation(panes[side]);
    const target = browserLocation(panes[side === 0 ? 1 : 0]);
    if (!source || ((!target || !workspace.canWrite(target.rootId)) && (kind === "copy" || kind === "move"))) return;
    const destination = target ?? source;
    setOperation({ kind, rootId: source.rootId, rootName: roots.find(root => root.id === source.rootId)?.name ?? source.rootId,
      parent: source.node, nodes: kind === "file" || kind === "directory" ? [] : [...(selection ?? source.selected)],
      targetRootId: destination.rootId, targetRootName: roots.find(root => root.id === destination.rootId)?.name ?? destination.rootId, targetParent: destination.node });
  };
  const currentLocation = browserLocation(panes[state.active]);
  const targetLocation = browserLocation(panes[state.active === 0 ? 1 : 0]);
  const contextKey = onToolContext ? JSON.stringify([currentLocation?.rootId, currentLocation?.node, currentLocation?.selected, targetLocation?.rootId, targetLocation?.node]) : "";
  useEffect(() => { onToolContext?.(currentLocation ? { rootId: currentLocation.rootId, node: currentLocation.node, selected: currentLocation.selected, targetRootId: targetLocation?.rootId, targetNode: targetLocation?.node } : null); }, [contextKey, onToolContext]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { workspace.viewMenu?.update({ enabled: active && roots.some(root => root.id === currentLocation?.rootId), showHidden: panes[state.active].showHidden }); }, [workspace, active, currentLocation, panes, state.active, roots]);

  useEffect(() => () => workspace.viewMenu?.update({ enabled: false, showHidden: false }), [workspace]);
  const currentRow = currentRows[state.active];
  const previewNode = currentRow?.tabId === state.groups[state.active].tabs[state.groups[state.active].active].tabId && currentRow.rootId === currentLocation?.rootId && currentRow.node !== null ? currentRow.node : currentLocation?.selected[currentLocation.selected.length - 1];
  const operationUnavailable = (kind: BrowserOperation["kind"], side: 0 | 1 = state.active, count = browserLocation(panes[side])?.selected.length ?? 0, selection?: readonly string[]) => {
    const source = browserLocation(panes[side]);
    const target = browserLocation(panes[side === 0 ? 1 : 0]);
    if (opening) return "正在打开文件";
    if (!source) return "请先选择目录";
    if (!workspace.canWrite(source.rootId)) return "来源目录只读";
    if ((kind === "copy" || kind === "move") && (!workspace.canTransfer() || !target || !workspace.canWrite(target.rootId))) return "对侧需要可写目录和传输权限";
    if (kind === "trash" && !workspace.canTrash()) return "系统回收站不可用";
    if (kind === "rename" && count !== 1) return "请选择一个文件或目录";
    if (["copy", "move", "trash", "batch-rename"].includes(kind) && !count) return "请先选择文件或目录";
    if (kind !== "file" && kind !== "directory" && previewNavigation.current[side]?.hasLink(selection ?? source.selected)) return "选中项含特殊链接";
  };
  const operationDisabled = (kind: BrowserOperation["kind"], side?: 0 | 1, count?: number, selection?: readonly string[]) => Boolean(operationUnavailable(kind, side, count, selection));
  const restoreBrowserFocus = (selector: string) => {
    const previous = document.activeElement;
    requestAnimationFrame(() => {
      if (!active || (document.activeElement !== previous && document.activeElement !== document.body)) return;
      host.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
  };
  const focusList = (side: 0 | 1) => restoreBrowserFocus(`[data-browser-side="${side}"][data-browser-row="${latestState.current.activeRows?.[side] ?? 0}"] .file-browser-list`);
  const focusTab = (side: 0 | 1) => restoreBrowserFocus(`[data-browser-side="${side}"][data-browser-row="${latestState.current.activeRows?.[side] ?? 0}"] [role="tab"][aria-selected="true"]`);
  const closePreview = () => { setQuickPreview(false); focusList(state.active); };
  const addToShelf = (rootId: string, rootName: string, parent: string, nodes: readonly string[]) => {
    const entries = new Map(shelf.map(entry => [browserShelfId(entry), entry]));
    for (const node of nodes) {
      const entry = { rootId, rootName, parent, node }; entries.set(browserShelfId(entry), entry);
    }
    if (entries.size > 500) throw new Error("文件暂存架最多保留 500 项，请先移除部分条目");
    setShelf([...entries.values()]);
  };
  const submitTransferPlan = (operations: readonly BrowserOperation[]) => {
    if (!workspace.canTransfer() || operations.some(operation => !workspace.canWrite(operation.rootId) || !workspace.canWrite(operation.targetRootId))) throw new Error("目录权限已变化或传输不可用");
    queue.enqueueBatch(operations.map(operation => ({ operation, name: "" })));
    setTool(null); setShelfOpen(false); setQueueOpen(true);
  };
  const shelfTarget = (side: 0 | 1): BrowserShelfTarget | null => {
    const location = browserLocation(panes[side]);
    const root = roots.find(root => root.id === location?.rootId);
    return root && location ? { rootId: root.id, rootName: root.name, parent: location.node } : null;
  };
  const openComparison = () => {
    const locations = panes.map(browserLocation);
    if (!locations[0] || !locations[1]) return;
    const directories = locations.map(location => ({ rootId: location!.rootId, node: location!.node })) as [BrowserDirectory, BrowserDirectory];
    setTool({ kind: "compare", directories, names: directories.map(directory => `${roots.find(root => root.id === directory.rootId)?.name ?? directory.rootId}/${directory.node}`) as [string, string] });
  };
  const changePane = useCallback((side: 0 | 1, next: SetStateAction<BrowserPaneState>) => setState(current => {
    return updateBrowserTab(current, side, pane => typeof next === "function" ? next(pane) : next);
  }), []);
  useEffect(() => workspace.viewMenu?.onToggleHidden(() => {
    const current = latestState.current, side = current.active;
    if (!active || !browserLocation(activeBrowserPanes(current)[side])) return;
    changePane(side, pane => ({ ...updateBrowserLocation(pane, { selected: [], scrollTop: 0 }), showHidden: !pane.showHidden }));
  }), [workspace, active, changePane]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); activity.current = controller;
    setOpening(false);
    return () => controller.abort();
  }, [active, workspace]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void workspace.roots().then(value => {
      if (!alive) return;
      workspace.assertActive();
      setRoots(value);
      const first = value.find(root => root.id === initialRootId) ?? value[0];
      if (first) setState(current => ({ ...current, groups: current.groups.map(group => ({ ...group, tabs: group.tabs.map(tab => browserLocation(tab) ? tab : { ...navigateBrowserPane(tab, first.id, ""), tabId: tab.tabId }) })) as typeof current.groups }));
    }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [active, workspace, initialRootId, rootsRevision]);
  useEffect(() => {
    const save = () => {
      try {
        const raw = JSON.stringify(latestState.current);
        if (raw.length > 512 * 1024) throw new Error("浏览状态过大");
        workspace.settings.setItem(FILE_BROWSER_STATE_KEY, raw);
      } catch { setError("无法记住浏览位置，本次仍可继续使用。请检查本地存储空间。"); }
    };
    const timer = window.setTimeout(save, 200);
    window.addEventListener("pagehide", save);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", save); };
  }, [state, workspace]);
  useEffect(() => () => {
    try { const raw = JSON.stringify(latestState.current); if (raw.length <= 512 * 1024) workspace.settings.setItem(FILE_BROWSER_STATE_KEY, raw); } catch { /* Last successful UI snapshot remains available. */ }
  }, [workspace]);
  const addRoot = (root: FileRoot | null, side: 0 | 1, row = state.activeRows?.[side] ?? 0) => {
    if (!root) return;
    workspace.assertActive();
    setRoots(current => [...current.filter(item => item.id !== root.id), root]);
    setState(current => updateBrowserRow(current, side, row, pane => navigateBrowserPane(pane, root.id, "")));
  };
  const choose = async (side: 0 | 1, row = state.activeRows?.[side] ?? 0) => {
    if (!workspace.supportsDirectoryPicker()) { pickSide.current = side; pickRow.current = row; input.current?.click(); return; }
    const controller = activity.current;
    try {
      const root = await workspace.choose();
      if (!controller?.signal.aborted) addRoot(root, side, row);
    } catch (reason) { if (!controller?.signal.aborted) setError(String(reason)); }
  };
  const open = async (rootId: string, rootName: string, node: FileNode, location?: BrowserTextLocation, siblings?: readonly FileNode[]) => {
    if (opening || !activity.current) return;
    const controller = activity.current;
    setOpening(true); setError("");
    try { await provider.open(rootId, rootName, node, controller.signal, location, siblings); }
    catch (reason) { if (!controller.signal.aborted) setError(String(reason)); }
    finally { if (!controller.signal.aborted) setOpening(false); }
  };
  const runListCommand = (action: Exclude<(typeof browserShortcutCommands)[number]["id"], "address" | "filter">) => {
    switch (action) {
      case "home": setState(current => modifyBrowserTabs(current, current.active, current.groups[current.active].tabs[current.groups[current.active].active].tabId, "home")); break;
      case "preview": setQuickPreview(value => !value); break;
      case "refresh": sizeCache.current.invalidate(); setSizeScope(null); setListingRevision(value => value + 1); break;
      case "queue": setQueueOpen(true); break;
      case "compare": openComparison(); break;
      case "search": if (currentLocation) setTool({ kind: "search", scope: { rootId: currentLocation.rootId, node: currentLocation.node } }); break;
      case "exchange": setQuickPreview(false); setState(exchangeBrowserPanes); focusList(state.active === 0 ? 1 : 0); break;
      case "mirror": if (currentLocation) { setQuickPreview(false); setState(mirrorBrowserPath); focusList(state.active); } break;
      default: startOperation(action);
    }
  };
  const paletteCommands = (): FileBrowserCommand[] => {
    const side = state.active;
    const activeTab = state.groups[side].tabs[state.groups[side].active];
    const rootNames = new Map(roots.map(root => [root.id, root.name]));
    const locationLabel = (rootId: string, node: string) => [rootNames.get(rootId) ?? rootId, node].filter(Boolean).join("/");
    const paneName = (side: 0 | 1) => side === 0 ? "左栏" : "右栏";
    const unavailable = (id: string) => {
      switch (id) {
        case "home": { const anchor = browserTabAnchor(activeTab); return !anchor || anchor.missing ? "当前标签没有可用的固定目录" : undefined; }
        case "mirror": case "search": return !currentLocation ? "请先选择目录" : undefined;
        case "compare": return !currentLocation || !targetLocation ? "两栏都需要一个目录" : undefined;
        case "refresh": case "preview": case "queue": case "exchange": return undefined;
        default: return operationUnavailable(id as BrowserOperation["kind"]);
      }
    };
    const list = browserShortcutCommands.flatMap(({ id, label }) => id === "address" || id === "filter" ? [] : [{
      id, label, detail: paneName(side), shortcut: shortcuts[id].map(key => displayBrowserShortcut(key, mac)).join(" / "),
      unavailable: unavailable(id), run: () => runListCommand(id),
    }]);
    const fixed: FileBrowserCommand[] = [], recent: FileBrowserCommand[] = [];
    const seen = new Set<string>();
    for (const tabSide of [side, side === 0 ? 1 : 0] as const) {
      browserSideRows(state, tabSide).slice(0, state.visibleRows?.[tabSide] ?? 1).forEach((group, row) => {
        for (const tab of group.tabs) {
          const anchor = browserTabAnchor(tab);
          if (anchor && rootNames.has(anchor.rootId)) fixed.push({
            id: `fixed-${tabSide}-${tab.tabId}`, label: `固定目录 · ${anchor.label || locationLabel(anchor.rootId, anchor.node)}`,
            detail: `${paneName(tabSide)} · ${locationLabel(anchor.rootId, anchor.node)}`, unavailable: anchor.missing ? "固定位置已失效" : undefined,
            run: () => { setQuickPreview(false); setState(current => modifyBrowserTabs(activateBrowserRow(current, tabSide, row), tabSide, tab.tabId, "home")); },
          });
          for (const entry of [...tab.history.slice(0, tab.index + 1)].reverse()) {
            const id = JSON.stringify([entry.rootId, entry.node]);
            if (seen.has(id) || !rootNames.has(entry.rootId) || recent.length >= 100) continue;
            seen.add(id);
            recent.push({
              id: `recent-${id}`, label: `最近目录 · ${locationLabel(entry.rootId, entry.node)}`,
              detail: `在${paneName(side)}打开`, unavailable: browserTabAllows(activeTab, entry) ? undefined : "当前固定标签限制了可访问的子目录",
              run: () => { setQuickPreview(false); changePane(side, pane => navigateBrowserPane(pane, entry.rootId, entry.node)); },
            });
          }
        }
      });
    }
    return [...list, { id: "layouts", label: "命名工作区", detail: "浏览窗口", run: () => setLayoutsOpen(true) }, ...commands, ...fixed, ...recent];
  };
  return <FileBrowserDragContext.Provider value={{
    current: () => active ? drag.current?.source ?? null : null,
    take: token => { const value = drag.current; if (!active || !value || token !== value.token) return null; drag.current = null; return value.source; },
  }}><section ref={host} className={`dual-file-browser${compact ? " file-browser-compact" : ""}`} aria-label="双栏文件浏览" data-active-pane={state.active} hidden={!active} {...(!active ? { inert: "", "aria-hidden": true } : {})} onKeyDownCapture={event => {
    if (!active || event.nativeEvent.isComposing || event.defaultPrevented || !(event.target instanceof HTMLElement) || !host.current?.contains(event.target)) return;
    if (compact && !event.repeat && event.code === "KeyP" && event.shiftKey && !event.altKey
      && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
      && !browserShortcutAction(event, shortcuts, mac, reservations)) {
      event.preventDefault(); event.stopPropagation(); setPaletteOpen(true); return;
    }
    if (!event.target.matches(".file-browser-list")) return;
    if (quickPreview && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); closePreview(); return;
    }
    const action = browserShortcutAction(event, shortcuts, mac, workspace.shortcutReservations?.());
    if (!action || action === "address" || action === "filter") return;
    event.preventDefault(); event.stopPropagation();
    runListCommand(action);
  }} onKeyDown={event => {
    if (quickPreview && !event.defaultPrevented && event.key === "Escape" && event.target instanceof HTMLElement && event.target.closest(".file-browser-quick-preview")) { event.preventDefault(); event.stopPropagation(); closePreview(); return; }
    if (quickPreview || event.defaultPrevented || event.key !== "Tab" || !(event.target instanceof HTMLElement) || !event.target.matches(".file-browser-list")) return;
    event.preventDefault(); event.stopPropagation(); const side = state.active === 0 ? 1 : 0;
    setState(current => ({ ...current, active: side }));
    requestAnimationFrame(() => host.current?.querySelector<HTMLElement>(`[data-browser-side="${side}"][data-browser-row="${latestState.current.activeRows?.[side] ?? 0}"] .file-browser-list`)?.focus({ preventScroll: true }));
  }}>
    {!compact && <header className="file-browser-heading"><ToolbarIcon name="compare" /><strong>文件浏览</strong><span>活动栏为来源 · 另一栏为目标</span>{onClose && <button type="button" className="btn-icon" title="返回原视图" aria-label="返回原视图" onClick={onClose}><ToolbarIcon name="chevronLeft" /></button>}</header>}
    {active && rootsOpen && workspace.revokeRoot && <WorkspaceDialog title="管理授权目录" onClose={() => { if (!rootRevoking.current) setRootsOpen(false); }}><FileBrowserRootManager roots={roots} displayPath={workspace.displayPath} revoke={async id => {
      if (rootRevoking.current) return;
      rootRevoking.current = true;
      try {
        await workspace.revokeRoot!(id);
        const remaining = roots.filter(root => root.id !== id);
        setRoots(remaining); setState(current => revokeBrowserRoot(current, id, remaining[0]?.id));
        setRootsRevision(value => value + 1); setQuickPreview(false); sizeCache.current.invalidate(id); setSizeScope(null);
      } finally { rootRevoking.current = false; }
    }} /></WorkspaceDialog>}
    <div className="file-browser-mobile-tabs" role="group" aria-label="切换目录栏">{([0, 1] as const).map(side => <button key={side} type="button" aria-pressed={state.active === side} onClick={() => { setQuickPreview(false); setState(current => ({ ...current, active: side })); }}>{side === 0 ? "左栏" : "右栏"}</button>)}</div>
    <div className="file-browser-actions" role={compact ? "toolbar" : "group"} aria-label="双栏文件操作">
      <span className="file-browser-direction" aria-label="操作方向">{state.active === 0 ? "左" : "右"} → {state.active === 0 ? "右" : "左"}</span>
      {workspace.revokeRoot && <button type="button" className="btn-icon" aria-label="管理授权目录" title="管理授权目录" disabled={queueBusy || opening || Boolean(operation)} onClick={() => setRootsOpen(true)}><ToolbarIcon name="shield" /></button>}
      <div className="file-browser-action-group" role="group" aria-label="文件操作">
      {(["copy", "move", "rename", "batch-rename", "file", "directory", "trash"] as const).map(kind => {
        const label = { copy: "复制到另一栏", move: "移动到另一栏", rename: "重命名", "batch-rename": "批量重命名", file: "新建文件", directory: "新建文件夹", trash: "移入系统回收站" }[kind];
        const icons = { copy: "copy", move: "move", rename: "rename", "batch-rename": "ordered", file: "document", directory: "folder", trash: "trash" } as const;
        const shortcut = shortcuts[kind].map(key => displayBrowserShortcut(key, mac)).join(" / ");
        const short = { copy: "复制", move: "移动", rename: "改名", "batch-rename": "批量", file: "新建", directory: "目录", trash: "回收站" }[kind];
        return <button key={kind} type="button" aria-label={label} disabled={operationDisabled(kind)} title={compact && operationDisabled(kind) ? `${label}（当前工作台尚未开放此操作）` : (kind === "copy" || kind === "move") && !workspace.canTransfer() ? "双栏传输需要桌面版" : `${label}${shortcut ? `（${shortcut}，列表焦点内）` : ""}`} onClick={() => startOperation(kind)}><ToolbarIcon name={icons[kind]} />{!compact && <><span>{short}</span>{shortcut && <kbd>{shortcut}</kbd>}</>}</button>;
      })}
      </div><div className="file-browser-action-group" role="group" aria-label="浏览工具">
      <button type="button" aria-label="操作队列" title="查看操作队列与逐项结果" onClick={() => setQueueOpen(true)}><ToolbarIcon name="ordered" />{!compact && <span>队列{jobs.length ? ` ${jobs.filter(job => !browserJobSettled(job)).length}/${jobs.length}` : ""}{jobs.some(job => job.status === "waiting") ? " · 等待决定" : ""}</span>}</button>
      <button type="button" aria-label="快速预览" title={`快速预览${shortcuts.preview.length ? `（${shortcuts.preview.map(key => displayBrowserShortcut(key, mac)).join(" / ")}，列表焦点内）` : ""}`} aria-pressed={quickPreview} onClick={() => setQuickPreview(value => !value)}><ToolbarIcon name="eye" />{!compact && <span>预览</span>}</button>
      <button type="button" aria-label="比较目录" title="比较两栏当前目录" disabled={!currentLocation} onClick={openComparison}><ToolbarIcon name="compare" />{!compact && <span>比较</span>}</button>
      <button type="button" aria-label="搜索正文" title="搜索活动目录的正文" disabled={!currentLocation} onClick={() => currentLocation && setTool({ kind: "search", scope: { rootId: currentLocation.rootId, node: currentLocation.node } })}><ToolbarIcon name="search" />{!compact && <span>搜索</span>}</button>
      <button type="button" aria-label="交换两栏" title="交换两栏及其目录标签" onClick={() => { setQuickPreview(false); setState(exchangeBrowserPanes); focusList(state.active === 0 ? 1 : 0); }}><ToolbarIcon name="switchViews" /></button>
      <button type="button" aria-label="两栏同路径" title="将另一栏切换到活动栏的目录" disabled={!currentLocation} onClick={() => { setQuickPreview(false); setState(mirrorBrowserPath); focusList(state.active); }}><ToolbarIcon name="link" /></button>
      </div>
      <button type="button" aria-label="统计当前目录大小" title="统计当前目录大小（手动递归，包含隐藏项）" disabled={!currentLocation || queueBusy} onClick={() => currentLocation && setSizeScope({ rootId: currentLocation.rootId, node: currentLocation.node, name: roots.find(root => root.id === currentLocation.rootId)?.name ?? currentLocation.rootId })}><ToolbarIcon name="info" /></button>
      <button ref={shortcutsButton} type="button" aria-label="文件浏览快捷键" title="文件浏览快捷键" onClick={() => setShortcutsOpen(true)}><ToolbarIcon name="sliders" /></button>
      {compact && <button type="button" aria-label="命名工作区" title="命名工作区" onClick={() => setLayoutsOpen(true)}><ToolbarIcon name="compare" /></button>}
      {compact && <button type="button" aria-label="文件暂存架" title={`文件暂存架（${shelf.length} 项）`} onClick={() => setShelfOpen(true)}><ToolbarIcon name="bookmark" /></button>}
      {compact && <button type="button" aria-label="命令面板" title={`命令面板（${displayBrowserShortcut("Mod+Shift+P", mac)}）`} onClick={() => setPaletteOpen(true)}><ToolbarIcon name="search" /></button>}
      {toolbarExtras && <div className="file-browser-action-group file-browser-host-tools" role="group" aria-label="工作台工具">{toolbarExtras}</div>}
    </div>
    {error && <div className="file-browser-error" role="alert">{error}<button type="button" aria-label="关闭浏览错误" onClick={() => setError("")}>×</button></div>}
    {opening && <p role="status" className="file-browser-opening">正在打开文件…</p>}
    <div className="file-browser-panes" style={{ gridTemplateColumns: `minmax(0, ${state.ratio}fr) 5px minmax(0, ${1 - state.ratio}fr)` }}>
      {([0, 1] as const).map(side => <div key={side} className="file-browser-pane-slot" data-mobile-active={quickPreview ? state.active !== side : state.active === side} style={{ gridColumn: side === 0 ? 1 : 3 }}><div className="file-browser-directory-host file-browser-stack" hidden={quickPreview && state.active !== side}>{browserSideRows(state, side).slice(0, compact ? state.visibleRows?.[side] ?? 1 : 1).map((group, row) => { const rowPane = group.tabs[group.active], location = browserLocation(rowPane), rowActive = row === (state.activeRows?.[side] ?? 0); const activate = (current: typeof state) => activateBrowserRow(current, side, row); return <FileBrowserPane revealNode={revealFile && state.active === side && rowActive && location?.selected.includes(revealFile.node) && revealFile.rootId === location.rootId && revealFile.node.split("/").slice(0, -1).join("/") === location.node ? revealFile.node : undefined} target={rowActive && state.active !== side} row={row} rowControl={compact ? <FileBrowserRowCount count={state.visibleRows?.[side] ?? 1} onChange={count => setState(current => setBrowserRowCount(current, side, count))} /> : undefined} previewRef={value => { if (rowActive) previewNavigation.current[side] = value; }} key={group.tabs[group.active].tabId} tabId={group.tabs[group.active].tabId} onCurrentChange={onCurrentChange} side={side} active={state.active === side && rowActive} visible={active && (!quickPreview || state.active === side)} refreshPaused={Boolean(operation || tool || opening || queueOpen || queueBusy)} onExternalChange={() => { sizeCache.current.invalidate(); setSizeScope(null); if (side === state.active) setPreviewRevision(value => value + 1); }} revision={listingRevision} pane={rowPane} roots={roots} provider={provider} onChange={next => setState(current => { const currentGroup = browserSideRows(current, side)[row]; return currentGroup?.tabs[currentGroup.active]?.tabId === group.tabs[group.active].tabId ? updateBrowserRow(current, side, row, pane => typeof next === "function" ? next(pane) : next) : current; })} onActivate={() => setState(current => current.active === side && (current.activeRows?.[side] ?? 0) === row ? current : activate(current))} onChoose={() => void choose(side, row)} onRefreshRoots={() => { sizeCache.current.invalidate(); setSizeScope(null); setRootsRevision(value => value + 1); }} onOpen={(rootId, rootName, node, siblings) => void open(rootId, rootName, node, undefined, siblings)} onShelf={compact ? addToShelf : undefined} onOperation={(kind, selection) => startOperation(kind, side, selection)} operationDisabled={(kind, count) => operationDisabled(kind, side, count)} onPreview={() => { setState(current => ({ ...current, active: side })); setQuickPreview(true); }}
      onDragStart={(event, nodes) => {
        if (!location || operation || tool || !workspace.canTransfer()) { event.preventDefault(); return; }
        const token = crypto.randomUUID();
        drag.current = { token, source: { rootId: location.rootId, rootName: roots.find(root => root.id === location.rootId)?.name ?? location.rootId, parent: location.node, nodes: [...nodes] } };
        event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData(BROWSER_DRAG_TYPE, token);
      }} onDragEnd={() => { drag.current = null; }} canDrop={(parent, moving) => {
        const target = location;
        if (!drag.current || !target || operation || tool || opening || !workspace.canTransfer() || !workspace.supportsDirectoryChanges(target.rootId)) return false;
        try { planBrowserDrop(drag.current.source, { rootId: target.rootId, rootName: "", parent }, moving); return true; } catch { return false; }
      }} onDrop={(event, parent) => {
        const snapshot = drag.current, target = location; drag.current = null;
        if (!snapshot || !target || event.dataTransfer.getData(BROWSER_DRAG_TYPE) !== snapshot.token || operation || tool || opening || !workspace.canTransfer()) return;
        try { setOperation(planBrowserDrop(snapshot.source, { rootId: target.rootId, rootName: roots.find(root => root.id === target.rootId)?.name ?? target.rootId, parent }, event.shiftKey)); } catch (reason) { setError(String(reason)); }
      }} tabBar={<FileBrowserTabs group={group} roots={roots} side={side} targetFull={state.groups[side === 0 ? 1 : 0].tabs.length >= MAX_BROWSER_TABS}
        onTransfer={(id, copy) => {
          const targetSide = side === 0 ? 1 : 0;
          setState(current => transferBrowserTab(current, side, row, id, copy));
          setQuickPreview(false);
          focusTab(targetSide);
        }} onSelect={(index, close, confirmed) => { setState(current => selectBrowserTab(activate(current), side, index, close, confirmed)); focusTab(side); }} onAdd={() => { tabCause.current = "new-tab-button"; setState(current => addBrowserTab(activate(current), side)); focusTab(side); }} onAction={(id, action, confirmed) => { setState(current => modifyBrowserTabs(activate(current), side, id, action, confirmed)); focusTab(side); }} onReorder={(id, target) => setState(current => reorderBrowserTab(activate(current), side, id, target))} />} />; })}</div>{quickPreview && state.active !== side && <FileBrowserQuickPreview settings={workspace.settings} rootId={currentLocation?.rootId ?? ""} node={previewNode} provider={provider} active={active} revision={listingRevision + previewRevision} onNavigate={direction => previewNavigation.current[state.active]?.step(direction) ?? false} onClose={closePreview} />}</div>)}
      <div className="file-browser-splitter" role="separator" data-file-browser-splitter="true" onMouseDown={event => event.preventDefault()} aria-label="双栏宽度" title="拖动调整双栏宽度；接近中间自动等宽，双击恢复等宽" onDoubleClick={() => setState(current => ({ ...current, ratio: .5 }))} aria-orientation="vertical" tabIndex={0} aria-valuemin={25} aria-valuemax={75} aria-valuenow={Math.round(state.ratio * 100)} onKeyDown={event => {
        if (["Home", "Enter"].includes(event.key)) { event.preventDefault(); setState(current => ({ ...current, ratio: .5 })); }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const delta = event.key === "ArrowRight" ? .05 : -.05; setState(current => ({ ...current, ratio: Math.max(.25, Math.min(.75, current.ratio + delta)) })); }
      }} onPointerDown={event => { event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const bounds = event.currentTarget.parentElement!.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const ratio = Math.abs(x - bounds.width / 2) <= 12 ? .5 : Math.max(.25, Math.min(.75, (x - 2.5) / (bounds.width - 5)));
        setState(current => ({ ...current, ratio }));
      }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} />
    </div>
    <input ref={element => { input.current = element; element?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden aria-label="选择目录快照" onChange={event => {
      try { addRoot(workspace.addFiles(Array.from(event.target.files ?? [])), pickSide.current, pickRow.current); }
      catch (reason) { setError(String(reason)); }
      event.currentTarget.value = "";
    }} />
    {layoutsOpen && active && <FileBrowserNamedWorkspaces current={state} store={workspace.settings}
      onLoad={async (layout, signal) => {
        const allowed = await workspace.roots();
        signal.throwIfAborted();
        workspace.assertActive();
        setRoots(allowed);
        setQuickPreview(false); setSizeScope(null); setLayoutsOpen(false);
        setState(restoreNamedBrowserWorkspace(layout, allowed.map(root => root.id)));
      }} onClose={() => setLayoutsOpen(false)} />}
    {shelfOpen && active && <FileBrowserShelf entries={shelf} targets={[shelfTarget(0), shelfTarget(1)]} workspace={workspace}
      onRemove={id => setShelf(previous => previous.filter(entry => browserShelfId(entry) !== id))}
      onSubmit={submitTransferPlan} onClose={() => setShelfOpen(false)} />}
    {paletteOpen && active && <FileBrowserCommandPalette commands={paletteCommands()} onClose={() => setPaletteOpen(false)} />}
    {sizeScope && active && <FileBrowserToolDialog title="目录大小" onClose={() => setSizeScope(null)}><FileBrowserDirectorySize {...sizeScope} provider={provider} cache={sizeCache.current} /></FileBrowserToolDialog>}
    {shortcutsOpen && active && <FileBrowserShortcuts value={shortcuts} mac={mac} reservations={reservations} restoreFocusRef={shortcutsButton} onClose={() => setShortcutsOpen(false)} onSave={next => saveBrowserShortcuts(workspace.settings, next, mac, workspace.shortcutReservations?.())} />}
    {operation && active && <FileBrowserOperationDialog operation={operation} workspace={workspace} onConfirm={(snapshot, name) => { queue.enqueue(snapshot, name); setOperation(null); setQueueOpen(true); }} onClose={() => setOperation(null)} />}
    {queueOpen && active && <FileBrowserQueueDialog queue={queue} showHistory={workspace.showQueueHistory} onClose={() => { setQueueOpen(false); setListingRevision(value => value + 1); }} />}
    {tool && active && <FileBrowserToolDialog title={tool.kind === "search" ? "目录搜索" : "目录比较"} onClose={() => setTool(null)}>{tool.kind === "search" ? <LocalFileSearch search={workspace.search} embedded roots={roots} showHidden={panes[state.active].showHidden} active={active} initialScope={tool.scope} onClose={() => setTool(null)} onOpen={hit => { setTool(null); void open(hit.rootId, roots.find(root => root.id === hit.rootId)?.name ?? hit.rootId, { id: hit.node, name: hit.node.split("/").pop()!, directory: false, size: 0 }, { from: hit.from, to: hit.to, revision: hit.revision }); }} /> : <FileBrowserComparison directories={tool.directories} names={tool.names} provider={provider}
      copyPlan={workspace.canTransfer() && tool.directories.every(directory => workspace.canWrite(directory.rootId)) ? {
        roots: tool.directories.map(directory => roots.find(root => root.id === directory.rootId)?.name ?? directory.rootId) as [string, string],
        submit: submitTransferPlan,
      } : undefined} onOpen={(side, node, location) => { const directory = tool.directories[side]; setTool(null); setQuickPreview(false); setState(current => ({ ...current, active: side })); if (node.directory) changePane(side, current => navigateBrowserPane(current, directory.rootId, node.id)); else void open(directory.rootId, roots.find(root => root.id === directory.rootId)?.name ?? directory.rootId, node, location); }} />}</FileBrowserToolDialog>}
  </section></FileBrowserDragContext.Provider>;
}
