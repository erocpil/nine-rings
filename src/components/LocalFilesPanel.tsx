import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type SetStateAction } from "react";
import {
  localFileService,
  type FileRoot,
} from "../lib/local-files/service";
import { LOCAL_FILE_VIEW_ID } from "../lib/plugin-system/builtin-local-files";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import { panelDisplays } from "../lib/plugin-system/panel-display";
import { usePanelDisplay } from "../hooks/usePanelDisplay";
import { useTransientMessage } from "../hooks/useTransientMessage";
import { LOCAL_FILE_OPENED_EVENT, LOCAL_FILE_REVEAL_EVENT, rememberRecentLocalFile, renameRecentLocalPath, removeRecentLocalPath } from "../lib/local-files/recent";
import { isLocalFileReadOnly, setLocalFileReadOnly } from "../lib/local-files/access";
import { localFileSessions, invalidateLocalFileSessionMounts } from "../lib/local-files/session";
import { assertLocalPathClean, localPathContains, migrateLocalFileSessions } from "../lib/local-files/operations";
import { migrateLocalFilePathState } from "../lib/local-files/path-state";
import { renameLocalFocusTabPaths, removeLocalFocusTabPaths } from "../lib/focus-tabs";
import { LocalFileOperationDialog, type LocalFileOperation } from "./LocalFileOperationDialog";
import { LocalFileDrafts } from "./LocalFileDrafts";
import { LocalFileSearch } from "./LocalFileSearch";
import type { LocalFileSearchHit } from "../lib/local-files/search";
import { ToolbarIcon } from "./ToolbarIcon";
import { copyToClipboard } from "../lib/clipboard";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
import { BlockActionMenu } from "./BlockActionMenu";
import { createPortal } from "react-dom";
import { useLocalFileTree } from "../hooks/useLocalFileTree";
import { appendLocalFileNodes, localFileListKey, localFileTreeNodes, readLocalFileTreePreferences, saveLocalFileTreePreferences, type ListedFilePage } from "../lib/local-files/tree";
import "../styles/local-files.css";

const NAVIGATION_KEY = "nr:local-files-navigation";
interface LocalFilesNavigation {
  expanded: string[];
  open: boolean;
  file: { rootId: string; rootName?: string; nodeId: string; name: string } | null;
}
function readNavigation(): LocalFilesNavigation {
  try {
    const value = JSON.parse(localStorage.getItem(NAVIGATION_KEY) ?? "null") as Partial<LocalFilesNavigation> | null;
    return {
      open: value?.open === true,
      expanded: Array.isArray(value?.expanded)
        ? value.expanded.filter((item): item is string => typeof item === "string" && item.includes(":"))
        : [],
      file:
        value?.file &&
        [value.file.rootId, value.file.nodeId, value.file.name].every(
          (item) => typeof item === "string" && item.length > 0,
        )
          ? value.file
          : null,
    };
  } catch {
    return { expanded: [], open: false, file: null };
  }
}
function sameLocalFile(
  view: ReturnType<typeof mainViews.getSnapshot>["current"],
  file: NonNullable<LocalFilesNavigation["file"]>,
) {
  return (
    view?.renderer === "local-file" &&
    view.data.rootId === file.rootId &&
    view.data.nodeId === file.nodeId
  );
}
function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

interface LocalPathTooltip {
  target: string;
  path: string;
  left: number;
  top: number;
}

export function LocalFilesPanel({ active, onBack }: {
  active: boolean;
  onBack?: () => void;
}) {
  const [restored] = useState(readNavigation);
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [pages, setPageState] = useState<Record<string, ListedFilePage>>({});
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(restored.expanded),
  );
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState(readLocalFileTreePreferences);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMenu, setViewMenu] = useState<HTMLElement | null>(null);
  const [operation, setOperation] = useState<LocalFileOperation | null>(null);
  const [task, setTask] = useState<"drafts" | "search" | null>(null);
  const [searchScope, setSearchScope] = useState<{ rootId: string; node: string } | undefined>();
  const [revealRequest, setRevealRequest] = useState<{ rootId: string; nodeId: string; name: string; sequence: number } | null>(null);
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState(restored.file);
  const [selected, setSelected] = useState(
    restored.file ? `${restored.file.rootId}:${restored.file.nodeId}` : "",
  );
  const [rootsReady, setRootsReady] = useState(false);
  const mainViewState = useSyncExternalStore(mainViews.subscribe, mainViews.getSnapshot, mainViews.getSnapshot);
  const [contextMenu, setContextMenu] = useState<(NotesMenuTarget & { rootId: string; nodeId: string; directory: boolean; name: string; fullPath: string | null; pathLoading: boolean }) | null>(null);
  const { message: pathNotice, showMessage: showPathNotice, clearMessage: clearPathNotice } = useTransientMessage();
  const [pathTooltip, setPathTooltip] = useState<LocalPathTooltip | null>(null);
  const pathHoverTargetRef = useRef<string | null>(null);
  const pathTooltipTimerRef = useRef<number | null>(null);
  const pathTooltipCloseTimerRef = useRef<number | null>(null);
  const display = usePanelDisplay("local-files");
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const revision = useRef({ value: 0 });
  const startupRestored = useRef(false);
  const restoredTreeActivation = useRef(false);
  const tree = useRef<HTMLDivElement>(null);
  const treeScrollVersion = useRef(0);
  const treeAnchor = useRef<{ rows: Array<{ id: string; offset: number }>; scrollTop: number; version: number } | null>(null);
  const clearPathTooltipTimer = () => {
    if (pathTooltipTimerRef.current !== null) window.clearTimeout(pathTooltipTimerRef.current);
    pathTooltipTimerRef.current = null;
  };
  const cancelPathTooltipClose = () => {
    if (pathTooltipCloseTimerRef.current !== null) window.clearTimeout(pathTooltipCloseTimerRef.current);
    pathTooltipCloseTimerRef.current = null;
  };
  const showLocalPathTooltip = (rootId: string, nodeId: string, row: HTMLElement, pointerType: string) => {
    if (pointerType === "touch") return;
    const target = `${rootId}:${nodeId}`;
    clearPathTooltipTimer();
    cancelPathTooltipClose();
    pathHoverTargetRef.current = target;
    setPathTooltip(null);
    pathTooltipTimerRef.current = window.setTimeout(() => {
      void localFileService.displayPath(rootId, nodeId).then(path => {
        if (pathHoverTargetRef.current !== target || !row.isConnected) return;
        const rect = row.getBoundingClientRect();
        const width = Math.min(560, Math.max(220, window.innerWidth - 16));
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        const estimatedHeight = 72;
        const top = rect.bottom + estimatedHeight + 8 < window.innerHeight
          ? rect.bottom + 8
          : Math.max(8, rect.top - estimatedHeight - 8);
        setPathTooltip({ target, path, left, top });
        pathTooltipTimerRef.current = null;
      }).catch(() => {
        if (pathHoverTargetRef.current === target) pathTooltipTimerRef.current = null;
      });
    }, 300);
  };
  const schedulePathTooltipClose = () => {
    clearPathTooltipTimer();
    cancelPathTooltipClose();
    pathTooltipCloseTimerRef.current = window.setTimeout(() => {
      pathHoverTargetRef.current = null;
      setPathTooltip(null);
      pathTooltipCloseTimerRef.current = null;
    }, 120);
  };
  useEffect(() => () => {
    clearPathTooltipTimer();
    cancelPathTooltipClose();
  }, []);
  const setPages = useCallback((next: SetStateAction<Record<string, ListedFilePage>>) => {
    const host = tree.current;
    if (host && host.clientHeight > 0) {
      const bounds = host.getBoundingClientRect();
      const rows: Array<{ id: string; offset: number }> = [];
      for (const row of host.querySelectorAll<HTMLElement>("[data-local-file-id]")) {
        const rect = row.getBoundingClientRect();
        if (rect.top >= bounds.bottom) break;
        if (rect.bottom <= bounds.top) continue;
        rows.push({ id: row.dataset.localFileId!, offset: rect.top - bounds.top });
        if (rows.length === 3) break;
      }
      treeAnchor.current = { rows, scrollTop: host.scrollTop, version: treeScrollVersion.current };
    } else treeAnchor.current = null;
    setPageState(next);
  }, []);
  useLayoutEffect(() => {
    const saved = treeAnchor.current, host = tree.current;
    treeAnchor.current = null;
    if (!saved || !host || saved.version !== treeScrollVersion.current) return;
    const rows = [...host.querySelectorAll<HTMLElement>("[data-local-file-id]")];
    for (const anchor of saved.rows) {
      const row = rows.find(item => item.dataset.localFileId === anchor.id);
      if (row) { host.scrollTop += row.getBoundingClientRect().top - host.getBoundingClientRect().top - anchor.offset; return; }
    }
    host.scrollTop = saved.scrollTop;
  }, [pages]);
  const filterInput = useRef<HTMLInputElement>(null);
  const listOptions = useMemo(() => ({ ...preferences, query: appliedQuery }), [preferences, appliedQuery]);
  const listingKey = localFileListKey(listOptions);
  const { readPage, reload: reloadTree } = useLocalFileTree({ active, ready: rootsReady, roots, expanded, pages, options: listOptions, busy: busy.size > 0, setPages, onError: setError });
  useEffect(() => { saveLocalFileTreePreferences(preferences); }, [preferences]);
  useEffect(() => { const timer = window.setTimeout(() => setAppliedQuery(query), 180); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { if (searchOpen) filterInput.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!active) {
      setViewMenu(null);
      setContextMenu(null);
      pathHoverTargetRef.current = null;
      setPathTooltip(null);
      if (pathTooltipTimerRef.current !== null) window.clearTimeout(pathTooltipTimerRef.current);
      if (pathTooltipCloseTimerRef.current !== null) window.clearTimeout(pathTooltipCloseTimerRef.current);
      pathTooltipTimerRef.current = null;
      pathTooltipCloseTimerRef.current = null;
    }
  }, [active]);
  useEffect(() => {
    const opened = (event: Event) => {
      const file = (event as CustomEvent<{ rootId?: unknown; rootName?: unknown; nodeId?: unknown; name?: unknown }>).detail;
      if (!file || typeof file.rootId !== "string" || !file.rootId || typeof file.nodeId !== "string" || !file.nodeId || typeof file.name !== "string" || !file.name) return;
      setSelectedFile(previous => ({ rootId: file.rootId as string, rootName: typeof file.rootName === "string" ? file.rootName : previous && previous.rootId === file.rootId ? previous.rootName : undefined, nodeId: file.nodeId as string, name: file.name as string }));
      setSelected(`${file.rootId}:${file.nodeId}`);
    };
    window.addEventListener(LOCAL_FILE_OPENED_EVENT, opened);
    return () => window.removeEventListener(LOCAL_FILE_OPENED_EVENT, opened);
  }, []);
  useEffect(() => {
    const reveal = (event: Event) => {
      const file = (event as CustomEvent<{ rootId?: string; nodeId?: string; name?: string }>).detail;
      if (!file?.rootId || !file.nodeId || !file.name) return;
      if (!roots.some(root => root.id === file.rootId)) { setError("此文件对应的目录授权已失效，请重新选择目录。"); return; }
      setQuery(""); setAppliedQuery("");
      if (file.nodeId.split("/").some(part => part.startsWith("."))) setPreferences(current => current.showHidden ? current : { ...current, showHidden: true });
      setRevealRequest({ rootId: file.rootId, nodeId: file.nodeId, name: file.name, sequence: Date.now() });
    };
    window.addEventListener(LOCAL_FILE_REVEAL_EVENT, reveal);
    return () => window.removeEventListener(LOCAL_FILE_REVEAL_EVENT, reveal);
  }, [roots]);
  useEffect(() => {
    if (!revealRequest || appliedQuery) return;
    let cancelled = false;
    const { rootId, nodeId } = revealRequest;
    const parts = nodeId.split("/");
    const directories = ["", ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))];
    void (async () => {
      try {
        for (let index = 0; index < directories.length; index++) {
          const node = directories[index]!, target = parts.slice(0, index + 1).join("/");
          let page = await readPage(rootId, node);
          while (!page.nodes.some(child => child.id === target) && page.next !== null) {
            const next = await readPage(rootId, node, page.next);
            page = { ...next, nodes: appendLocalFileNodes(page.nodes, next.nodes) };
          }
          if (cancelled) return;
          if (!page.nodes.some(child => child.id === target)) {
            // Windows hidden attributes cannot be inferred from the path name.
            if (!listOptions.showHidden) { setPreferences(current => ({ ...current, showHidden: true })); return; }
            throw new Error("目标文件或目录已移动，无法在树中定位");
          }
          setPages(current => ({ ...current, [`${rootId}:${node}`]: page }));
        }
        if (cancelled) return;
        setExpanded(current => new Set([...current, ...directories.map(node => `${rootId}:${node}`)]));
        setSelected(`${rootId}:${nodeId}`);
        setPendingReveal(`${rootId}:${nodeId}`);
        setRevealRequest(null);
      } catch (reason) {
        if (!cancelled && !(reason instanceof DOMException && reason.name === "AbortError")) { setError(String(reason)); setRevealRequest(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [appliedQuery, listOptions, readPage, revealRequest, setPages]);
  useEffect(() => {
    if (!pendingReveal || !active) return;
    const frame = requestAnimationFrame(() => {
      const host = tree.current;
      const row = [...(host?.querySelectorAll<HTMLElement>("[data-local-file-id]") ?? [])].find(item => item.dataset.localFileId === pendingReveal);
      if (!host || !row) return;
      const bounds = host.getBoundingClientRect(), rect = row.getBoundingClientRect();
      if (rect.top < bounds.top) host.scrollTop += rect.top - bounds.top - 4;
      else if (rect.bottom > bounds.bottom) host.scrollTop += rect.bottom - bounds.bottom + 4;
      setPendingReveal(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, expanded, pages, pendingReveal]);
  useEffect(() => {
    const lifetime = revision.current;
    const initialRevision = lifetime.value;
    let cancelled = false;
    mounted.current = true;
    void localFileService
      .roots()
      .then(async (value) => {
        if (cancelled || !mounted.current || lifetime.value !== initialRevision) return;
        setRoots(value);
        const rootIds = new Set(value.map((root) => root.id));
        if (restored.file && rootIds.has(restored.file.rootId)) {
          const savedRoot = value.find(root => root.id === restored.file?.rootId);
          if (savedRoot && restored.file.rootName !== savedRoot.name)
            setSelectedFile(current => current?.rootId === savedRoot.id ? { ...current, rootName: savedRoot.name } : current);
        }
        const restorable = restored.expanded
          .filter((key) => rootIds.has(key.slice(0, key.indexOf(":"))))
          .sort((a, b) => a.split("/").length - b.split("/").length);
        const available = new Set<string>();
        for (const key of restorable) {
          const at = key.indexOf(":"),
            rootId = key.slice(0, at),
            node = key.slice(at + 1);
          try {
            const page = await readPage(rootId, node, 0);
            if (cancelled || !mounted.current || lifetime.value !== initialRevision) return;
            available.add(key);
            setPages((current) => ({ ...current, [key]: page }));
          } catch {
            // A directory may have moved since the last session; retain the
            // remaining valid expansion state instead of blocking restoration.
          }
          if (cancelled || !mounted.current || lifetime.value !== initialRevision) return;
        }
        setExpanded(available);
        if (cancelled || !mounted.current) return;
        if (restored.file && !rootIds.has(restored.file.rootId))
          setError("上次打开的本地文件目录尚未授权。重新选择同一目录后会尝试恢复文件。");
        setRootsReady(true);
      })
      .catch((reason) => {
        if (!cancelled && mounted.current) {
          setError(String(reason));
          setRootsReady(true);
        }
      });
    return () => {
      cancelled = true;
      mounted.current = false;
      lifetime.value++;
    };
  }, [readPage, restored, setPages]);
  useEffect(() => {
    if (!rootsReady) return;
    try {
      localStorage.setItem(
        NAVIGATION_KEY,
        JSON.stringify({ expanded: [...expanded], file: selectedFile, open: Boolean(selectedFile && !mainViewState.suspended && (sameLocalFile(mainViewState.current, selectedFile) || sameLocalFile(mainViewState.pending, selectedFile))) }),
      );
    } catch {
      /* Device-local navigation state is optional. */
    }
  }, [expanded, selectedFile, rootsReady, mainViewState]);
  useEffect(() => {
    if (startupRestored.current || !restored.open || !rootsReady || !selectedFile) return;
    if (!roots.some((root) => root.id === selectedFile.rootId)) return;
    const view = mainViews.getSnapshot();
    if (
      sameLocalFile(view.current, selectedFile) ||
      sameLocalFile(view.pending, selectedFile)
    ) {
      startupRestored.current = true;
      return;
    }
    try {
      startupRestored.current = true;
      const rootName = roots.find(root => root.id === selectedFile.rootId)?.name ?? selectedFile.rootName ?? "本地文件";
      rememberRecentLocalFile({ rootId: selectedFile.rootId, rootName, nodeId: selectedFile.nodeId, name: selectedFile.name });
      mainViews
        .bind(workspacePanels.assert("files"))
        .open(LOCAL_FILE_VIEW_ID, { rootId: selectedFile.rootId, nodeId: selectedFile.nodeId, name: selectedFile.name });
    } catch (reason) {
      setError(String(reason));
    }
  }, [restored.open, roots, rootsReady, selectedFile]);
  useEffect(() => {
    if (!active) {
      restoredTreeActivation.current = false;
      return;
    }
    if (!rootsReady || restoredTreeActivation.current) return;
    restoredTreeActivation.current = true;
    if (!selectedFile || !roots.some(root => root.id === selectedFile.rootId)) return;
    // Resolve the persisted file through the same path/pagination flow as
    // “show in tree”; this also reveals files beyond the first directory page.
    setRevealRequest({
      rootId: selectedFile.rootId,
      nodeId: selectedFile.nodeId,
      name: selectedFile.name,
      sequence: Date.now(),
    });
  }, [active, roots, rootsReady, selectedFile]);
  const run = async (key: string, action: () => Promise<void>) => {
    const version = revision.current.value;
    setError("");
    setBusy((value) => new Set(value).add(key));
    try {
      await action();
    } catch (reason) {
      if (mounted.current && version === revision.current.value && !(reason instanceof DOMException && reason.name === "AbortError"))
        setError(String(reason));
    } finally {
      if (mounted.current && version === revision.current.value)
        setBusy((value) => {
          const next = new Set(value);
          next.delete(key);
          return next;
        });
    }
  };
  const load = async (rootId: string, node: string, offset = 0) => {
    const key = rootId + ":" + node,
      version = revision.current.value;
    const effectiveOffset = offset && pages[key]?.listingKey === listingKey ? offset : 0;
    const page = await readPage(rootId, node, effectiveOffset);
    if (!mounted.current || version !== revision.current.value) return;
    setPages((value) => ({
      ...value,
      [key]: {
        ...page,
        nodes: effectiveOffset
          ? appendLocalFileNodes(value[key]?.nodes ?? [], page.nodes)
          : page.nodes,
      },
    }));
  };
  const toggle = (rootId: string, node: string) => {
    const key = rootId + ":" + node;
    if (busy.has(key)) return;
    setExpanded((value) => {
      const next = new Set(value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!pages[key]) void run(key, () => load(rootId, node));
  };
  const addRoot = (root: FileRoot | null) => {
    if (!root || !mounted.current) return;
    setRoots((value) => [...value, root]);
    const restorePrevious = !!restored.file && restored.file.rootId !== root.id && restored.file.rootName === root.name && !roots.some(item => item.id === restored.file?.rootId);
    if (restorePrevious && restored.file) {
      setSelectedFile({ ...restored.file, rootId: root.id, rootName: root.name });
      setSelected(`${root.id}:${restored.file.nodeId}`);
      setError("");
      const oldRootId = restored.file.rootId;
      const restoreKeys = restored.expanded.filter(key => key.startsWith(`${oldRootId}:`)).map(key => `${root.id}:${key.slice(oldRootId.length + 1)}`);
      setExpanded(new Set([...restoreKeys, `${root.id}:`]));
      void (async () => {
        for (const key of restoreKeys.sort((a, b) => a.split("/").length - b.split("/").length)) {
          const at = key.indexOf(":");
          try { const page = await readPage(root.id, key.slice(at + 1)); setPages(current => ({ ...current, [key]: page })); }
          catch { /* The saved folder may have moved since last use. */ }
        }
      })();
    }
    if (!restorePrevious) toggle(root.id, "");
  };
  const openFile = (rootId: string, nodeId: string, name: string, hit?: LocalFileSearchHit) => {
    const rootName = roots.find(root => root.id === rootId)?.name ?? "本地文件";
    mainViews.bind(workspacePanels.assert("files")).open(LOCAL_FILE_VIEW_ID, { rootId, nodeId, name, ...(hit ? { location: { from: hit.from, to: hit.to, revision: hit.revision } } : {}) });
    rememberRecentLocalFile({ rootId, rootName, nodeId, name });
    setSelectedFile({ rootId, rootName, nodeId, name });
    setSelected(`${rootId}:${nodeId}`);
  };
  const showLocalContextMenu = (event: React.MouseEvent<HTMLElement>, target: { id: string; title: string; rootId: string; nodeId: string; directory: boolean; name: string }) => {
    event.preventDefault(); event.stopPropagation();
    const menu = { ...target, x: event.clientX, y: event.clientY, trigger: event.currentTarget, fullPath: null, pathLoading: true };
    setContextMenu(menu);
    // Resolve the native path while the menu is being opened. The later menu
    // click can then start the clipboard write directly inside its own gesture,
    // instead of losing WebKit's transient activation across an async invoke.
    void localFileService.displayPath(target.rootId, target.nodeId).then(fullPath => {
      setContextMenu(current => current?.id === target.id ? { ...current, fullPath, pathLoading: false } : current);
    }).catch(() => {
      setContextMenu(current => current?.id === target.id ? { ...current, pathLoading: false } : current);
    });
  };
  const copyLocalPath = async (path: string) => {
    clearPathNotice();
    setError("");
    await copyToClipboard(path, { reportFailure: true });
    showPathNotice(`已复制路径：${path}`);
  };
  const renameLocalPath = async (rootId: string, nodeId: string, oldName: string, directory: boolean, destination?: { parent: string; name: string }) => {
    if (!localFileService.canRename(rootId)) throw new Error("目录快照无法重命名，请重新授权原目录");
    const view = mainViews.getSnapshot();
    const activeView = [view.current, view.pending].find(item => item?.renderer === "local-file" && item.data.rootId === rootId && (item.data.nodeId === nodeId || (directory && (!nodeId || item.data.nodeId.startsWith(`${nodeId}/`)))));
    await assertLocalPathClean(rootId, nodeId);
    const name = destination?.name ?? window.prompt("重命名", oldName);
    if (name === null || (!destination && name.trim() === oldName)) return;
    const oldRootName = roots.find(item => item.id === rootId)?.name ?? "本地文件";
    const result = destination
      ? { root: roots.find(item => item.id === rootId)!, nodeId: await localFileService.move(rootId, nodeId, destination.parent, name) }
      : await localFileService.rename(rootId, nodeId, name);
    const { root, nodeId: nextNodeId } = result;
    migrateLocalFilePathState(rootId, nodeId, nextNodeId);
    if (nodeId && activeView?.id === view.current?.id) invalidateLocalFileSessionMounts();
    migrateLocalFileSessions(rootId, nodeId, nextNodeId);
    renameLocalFocusTabPaths(rootId, nodeId, nextNodeId);
    setRoots(current => current.map(item => item.id === rootId ? root : item));
    const oldPrefix = `${rootId}:${nodeId}`;
    const nextPrefix = `${rootId}:${nextNodeId}`;
    const nextExpanded = [...expanded].map(key => key === oldPrefix || key.startsWith(`${oldPrefix}/`) ? nextPrefix + key.slice(oldPrefix.length) : key);
    setExpanded(new Set(nextExpanded));
    setPages(current => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${rootId}:`))));
    if (selectedFile?.rootId === rootId && (selectedFile.nodeId === nodeId || (directory && (!nodeId || selectedFile.nodeId.startsWith(`${nodeId}/`))))) {
      const suffix = nodeId ? selectedFile.nodeId.slice(nodeId.length) : `/${selectedFile.nodeId}`;
      const updatedNode = nodeId ? `${nextNodeId}${suffix}` : selectedFile.nodeId;
      const updatedParts = updatedNode.split("/");
      const updatedName = updatedParts[updatedParts.length - 1] || root.name;
      const updated = { rootId, rootName: root.name, nodeId: updatedNode, name: updatedName };
      setSelectedFile(updated);
      setSelected(`${rootId}:${updatedNode}`);
      if (activeView?.renderer === "local-file") openFile(rootId, updatedNode, updatedName);
    }
    renameRecentLocalPath(rootId, nodeId, nextNodeId, root.name !== oldRootName ? root.name : undefined);
    setError("");
    const reloadNodes = [...new Set(["", ...nextExpanded.filter(key => key.startsWith(`${rootId}:`)).map(key => key.slice(rootId.length + 1))])]
      .sort((left, right) => left.split("/").length - right.split("/").length);
    for (const node of reloadNodes) await load(rootId, node);
  };
  const applyOperation = async (parent: string, name: string) => {
    if (!operation) return;
    const { rootId, nodeId, kind } = operation;
    if (kind === "move") {
      await renameLocalPath(rootId, nodeId, operation.name, operation.directory, { parent, name });
      setQuery(""); setAppliedQuery("");
      setRevealRequest({ rootId, nodeId: parent ? `${parent}/${name}` : name, name, sequence: Date.now() });
      return;
    }
    if (kind === "trash") {
      await assertLocalPathClean(rootId, nodeId);
      await localFileService.trash(rootId, nodeId);
      const current = mainViews.getSnapshot().current;
      if (current?.renderer === "local-file" && localPathContains(rootId, nodeId, `${current.data.rootId}:${current.data.nodeId}`)) invalidateLocalFileSessionMounts();
      for (const item of [mainViews.getSnapshot().current, mainViews.getSnapshot().pending])
        if (item?.renderer === "local-file" && localPathContains(rootId, nodeId, `${item.data.rootId}:${item.data.nodeId}`)) {
          if (item.id === mainViews.getSnapshot().current?.id) mainViews.close(item.id);
          else mainViews.reject(item.id);
        }
      for (const id of localFileSessions.keys()) if (localPathContains(rootId, nodeId, id)) localFileSessions.delete(id);
      removeRecentLocalPath(rootId, nodeId);
      removeLocalFocusTabPaths(rootId, nodeId);
      setExpanded(current => new Set([...current].filter(id => !localPathContains(rootId, nodeId, id))));
      if (selectedFile && localPathContains(rootId, nodeId, `${selectedFile.rootId}:${selectedFile.nodeId}`)) { setSelectedFile(null); setSelected(""); }
      setPages(current => Object.fromEntries(Object.entries(current).filter(([id]) => !localPathContains(rootId, nodeId, id))));
      await load(rootId, nodeId.split("/").slice(0, -1).join("/"));
      return;
    }
    const created = await localFileService.create(rootId, parent, name, kind === "directory");
    setExpanded(current => new Set([...current, `${rootId}:${parent}`]));
    setQuery(""); setAppliedQuery("");
    await load(rootId, parent);
    if (kind === "file") openFile(rootId, created, name);
    setRevealRequest({ rootId, nodeId: created, name, sequence: Date.now() });
  };
  const menuActions = contextMenu ? [
    { label: "复制路径", disabled: contextMenu.pathLoading || !contextMenu.fullPath, run: () => contextMenu.fullPath && void copyLocalPath(contextMenu.fullPath).catch(reason => setError(String(reason))) },
    ...(contextMenu.directory ? [{ label: "在此目录搜索正文…", run: () => { setSearchScope({ rootId: contextMenu.rootId, node: contextMenu.nodeId }); setTask("search"); } }] : []),
    { label: "重命名", disabled: !localFileService.canRename(contextMenu.rootId) || isLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId), run: () => void run(`rename:${contextMenu.rootId}:${contextMenu.nodeId}`, () => renameLocalPath(contextMenu.rootId, contextMenu.nodeId, contextMenu.name, contextMenu.directory)) },
    ...(["file", "directory"] as const).map(kind => ({ label: kind === "file" ? "新建文件…" : "新建文件夹…", disabled: !localFileService.canSaveOriginal(contextMenu.rootId), run: () => setOperation({ ...contextMenu, kind }) })),
    ...(contextMenu.nodeId ? [{ label: "移动到…", disabled: !localFileService.canRename(contextMenu.rootId) || isLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId), run: () => setOperation({ ...contextMenu, kind: "move" }) }, ...(localFileService.canTrash() ? [{ label: "移入系统回收站…", disabled: isLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId), run: () => setOperation({ ...contextMenu, kind: "trash" }) }] : [])] : []),
    { label: isLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId) ? "允许编辑" : "设为只读", run: () => setLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId, !isLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId)) },
  ] : [];
  const refreshExpanded = () =>
    void run("refresh", () => reloadTree());
  const children = (
    rootId: string,
    node: string,
    depth: number,
  ): React.ReactNode => {
    const key = rootId + ":" + node,
      page = pages[key];
    const visibleNodes = page ? localFileTreeNodes(page.nodes, { ...preferences, query }) : [];
    if (!expanded.has(key)) return null;
    return (
      <div role="group">
        {visibleNodes.map((child) => {
          const childKey = rootId + ":" + child.id;
          return (
            <div key={child.id}>
              <button
                type="button"
                className="local-file-row"
                data-local-file-id={childKey}
                style={{ paddingInlineStart: 12 + depth * 14 }}
                onPointerEnter={event => showLocalPathTooltip(rootId, child.id, event.currentTarget, event.pointerType)}
                onPointerLeave={schedulePathTooltipClose}
                aria-expanded={
                  child.directory ? expanded.has(childKey) : undefined
                }
                aria-pressed={
                  !child.directory ? selected === childKey : undefined
                }
                onContextMenu={event => {
                  showLocalContextMenu(event, { id: childKey, title: child.name, rootId, nodeId: child.id, directory: child.directory, name: child.name });
                }}
                onClick={() => {
                  if (child.directory) toggle(rootId, child.id);
                  else
                    void run(childKey, async () => {
                      // File bytes are read by the host renderer only after its save/navigation gate.
                      openFile(rootId, child.id, child.name);
                    });
                }}
              >
                <span className="local-file-disclosure" aria-hidden="true">
                  {child.directory ? (expanded.has(childKey) ? "▾" : "▸") : ""}
                </span>
                <span className={`local-file-kind-icon ${child.directory ? "is-directory" : "is-file"}`} aria-hidden="true">
                  <ToolbarIcon name={child.directory ? "folder" : "document"} />
                </span>
                <span className={`local-file-name ${child.directory ? "is-directory" : "is-file"}`}>{child.name}</span>
                {display?.showCounts && child.directory && pages[childKey] && (
                  <span className="local-file-row-meta">
                    {pages[childKey].nodes.length}{pages[childKey].next != null ? "+" : ""}
                  </span>
                )}
                {display?.showMetadata && !child.directory && (
                  <span className="local-file-row-meta">{fileSize(child.size)}</span>
                )}
                {isLocalFileReadOnly(rootId, child.id) && <span className="local-file-row-meta local-file-readonly-indicator" aria-label="只读"><ToolbarIcon name="lock" /></span>}
              </button>
              {child.directory && children(rootId, child.id, depth + 1)}
            </div>
          );
        })}
        {busy.has(key) && <p className="local-files-message">正在读取目录…</p>}
        {page?.next != null && (
          <button
            type="button"
            disabled={busy.has(key) || page.listingKey !== listingKey || query !== appliedQuery}
            onClick={() => void run(key, () => load(rootId, node, page.next!))}
          >
            加载更多
          </button>
        )}
        {page && !visibleNodes.length && (
          <p className="local-files-message">{query.trim() ? "没有匹配的文件" : "空目录"}</p>
        )}
      </div>
    );
  };
  return (
    <section
      className="local-files-panel"
      aria-label="本地文件树"
    >
      <header className="local-files-toolbar">
        {onBack && (
          <button
            type="button"
            className="btn-icon"
            title="返回文档树"
            onClick={onBack}
          >
            <ToolbarIcon name="chevronLeft" />
          </button>
        )}
        <strong>本地文件</strong>
        <button type="button" className="btn-icon" title="按文件名筛选" aria-label="按文件名筛选" aria-expanded={searchOpen} aria-pressed={searchOpen} onClick={() => { setSearchOpen(value => !value); if (searchOpen) { setQuery(""); setAppliedQuery(""); } }}><ToolbarIcon name="filter" /></button>
        <button type="button" className="btn-icon" title="目录全文搜索" aria-label="目录全文搜索" aria-expanded={task === "search"} aria-pressed={task === "search"} onClick={() => { setSearchScope(undefined); setTask(current => current === "search" ? null : "search"); }}><ToolbarIcon name="search" /></button>
        <button type="button" className="btn-icon" title="未保存文件与恢复草稿" aria-label="未保存文件与恢复草稿" aria-expanded={task === "drafts"} aria-pressed={task === "drafts"} onClick={() => setTask(current => current === "drafts" ? null : "drafts")}><ToolbarIcon name="save" /></button>
        <button type="button" className="btn-icon" title="文件树显示与排序" aria-label="文件树显示与排序" aria-haspopup="menu" aria-expanded={Boolean(viewMenu)} onClick={event => {
          const trigger = event.currentTarget;
          setViewMenu(current => current ? null : trigger);
        }}><ToolbarIcon name="sliders" /></button>
        {viewMenu && <BlockActionMenu trigger={viewMenu} placement="below" title="文件树显示" onClose={() => setViewMenu(null)} actions={[
          ...([['name', '名称升序'], ['name-desc', '名称降序'], ['type', '文件类型']] as const).map(([sort, label], index) => ({ label, group: index === 0 ? "排序（目录优先）" : undefined, checked: preferences.sort === sort, keepOpen: true, run: () => setPreferences(current => ({ ...current, sort })) })),
          { label: "显示隐藏文件与目录", group: "显示", checked: preferences.showHidden, keepOpen: true, run: () => setPreferences(current => ({ ...current, showHidden: !current.showHidden })) },
        ]} />}
        <button
          type="button"
          className="btn-icon"
          title="选择本地目录"
          aria-label="选择本地目录"
          disabled={busy.has("choose")}
          onClick={() => {
            if (!localFileService.supportsDirectoryPicker())
              input.current?.click();
            else
              void run("choose", async () =>
                addRoot(await localFileService.choose()),
              );
          }}
        >
          <ToolbarIcon name="folder" />
        </button>
        {display?.toolbar.includes("local-files.collapse-all") && <button
          type="button"
          className="btn-icon"
          title="折叠所有目录"
          aria-label="折叠所有目录"
          disabled={!expanded.size}
          onClick={() =>
            panelDisplays.run(
              "local-files",
              display,
              "local-files.collapse-all",
              { "local-files.collapse-all": () => setExpanded(new Set()) },
            )
          }
        >
          <ToolbarIcon name="folderCollapse" />
        </button>}
        {(!display || display.toolbar.includes("local-files.refresh")) && <button
          type="button"
          className="btn-icon"
          title="刷新已展开目录"
          aria-label="刷新已展开目录"
          disabled={busy.size > 0}
          onClick={() => {
            if (!display) refreshExpanded();
            else panelDisplays.run("local-files", display, "local-files.refresh", {
              "local-files.refresh": refreshExpanded,
            });
          }}
        >
          <ToolbarIcon name="refresh" />
        </button>}
      </header>
      {searchOpen && <div className="local-files-filter" role="search" aria-label="本地文件名过滤">
        <ToolbarIcon name="filter" />
        <input ref={filterInput} value={query} maxLength={256} aria-label="筛选已展开目录中的文件名" placeholder="筛选已展开目录中的文件名" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(""); setAppliedQuery(""); setSearchOpen(false); } }} />
        <button type="button" className="btn-icon" aria-label="关闭文件名过滤" title="关闭文件名过滤" onClick={() => { setQuery(""); setAppliedQuery(""); setSearchOpen(false); }}><ToolbarIcon name="close" /></button>
      </div>}
      <input
        ref={input}
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        hidden
        onChange={(event) => {
          try {
            addRoot(
              localFileService.addFiles(Array.from(event.target.files ?? [])),
            );
          } catch (reason) {
            setError(String(reason));
          }
          event.target.value = "";
        }}
      />
      <p className="local-files-message">本地文件不会导入或同步{searchOpen ? " · 过滤时保留目录" : ""}</p>
      {task === "drafts" && <LocalFileDrafts roots={roots} onOpen={openFile} onClose={() => setTask(null)} />}
      {task === "search" && <LocalFileSearch key={searchScope ? `${searchScope.rootId}:${searchScope.node}` : "all"} roots={roots} showHidden={preferences.showHidden} active={active} initialScope={searchScope} onOpen={hit => { try { openFile(hit.rootId, hit.node, hit.node.split("/").slice(-1)[0]!, hit); } catch (cause) { setError(String(cause)); } }} onClose={() => setTask(null)} />}
      {error && (
        <p role="alert" className="local-files-message">
          {error}
        </p>
      )}
      {pathNotice && createPortal(
        <div role="status" className="doc-tree-path-toast">{pathNotice}</div>,
        document.body,
      )}
      {pathTooltip && createPortal(
        <div
          role="tooltip"
          className="local-file-path-tooltip"
          style={{ left: pathTooltip.left, top: pathTooltip.top }}
        >
          {pathTooltip.path}
        </div>,
        document.body,
      )}
      <div
        ref={tree}
        className="local-files-tree"
        onScroll={() => { treeScrollVersion.current++; }}
        role="tree"
        data-panel-display={display ? "plugin" : undefined}
        style={display ? {
          "--panel-display-font": display.font === "mono" ? "var(--font-mono)" : display.font === "sans" ? "var(--font)" : "inherit",
          "--panel-display-font-size": `${display.fontSize}px`,
          "--panel-display-row-height": `${display.rowHeight}px`,
          "--panel-display-document-color": display.labelColor === "accent" ? "var(--accent)" : display.labelColor === "secondary" ? "var(--text-secondary)" : "var(--text)",
        } as CSSProperties : undefined}
      >
        <div className="local-files-tree-content">
        {roots.map((root) => (
          <div key={root.id}>
            <div className="local-file-root">
              <button
                type="button"
                className="local-file-row"
                data-local-file-id={`${root.id}:`}
                onPointerEnter={event => showLocalPathTooltip(root.id, "", event.currentTarget, event.pointerType)}
                onPointerLeave={schedulePathTooltipClose}
                onContextMenu={event => {
                  showLocalContextMenu(event, { id: root.id, title: root.name, rootId: root.id, nodeId: "", directory: true, name: root.name });
                }}
                aria-expanded={expanded.has(root.id + ":")}
                onClick={() => toggle(root.id, "")}
              >
                <span className="local-file-disclosure" aria-hidden="true">{expanded.has(root.id + ":") ? "▾" : "▸"}</span>
                <span className="local-file-kind-icon is-directory" aria-hidden="true"><ToolbarIcon name="folder" /></span>
                <span className="local-file-name is-directory">
                  {root.name}
                  {root.transient ? "（会话）" : ""}
                </span>
                {display?.showCounts && pages[root.id + ":"] && (
                  <span className="local-file-row-meta">
                    {pages[root.id + ":"].nodes.length}{pages[root.id + ":"].next != null ? "+" : ""}
                  </span>
                )}
                {isLocalFileReadOnly(root.id, "") && <span className="local-file-row-meta local-file-readonly-indicator" aria-label="只读"><ToolbarIcon name="lock" /></span>}
              </button>
              <button
                type="button"
                className="btn-icon"
                aria-label={`移除目录 ${root.name}`}
                title="撤销目录授权，不删除文件"
                onClick={() =>
                  void run(root.id, async () => {
                    await localFileService.remove(root.id);
                    if (!mounted.current) return;
                    revision.current.value++;
                    setBusy(new Set());
                    setRoots((value) =>
                      value.filter((item) => item.id !== root.id),
                    );
                    setPages((value) =>
                      Object.fromEntries(
                        Object.entries(value).filter(
                          ([key]) => !key.startsWith(root.id + ":"),
                        ),
                      ),
                    );
                    setExpanded(
                      (value) =>
                        new Set(
                          [...value].filter(
                            (key) => !key.startsWith(root.id + ":"),
                          ),
                        ),
                    );
                    if (selectedFile?.rootId === root.id) {
                      setSelectedFile(null);
                      setSelected("");
                    }
                    const view = mainViews.getSnapshot();
                    if (
                      [view.current, view.pending].some(
                        (item) =>
                          item?.renderer === "local-file" &&
                          item.data.rootId === root.id,
                      )
                    )
                      mainViews.close();
                  })
                }
              >
                <ToolbarIcon name="close" />
              </button>
            </div>
            {children(root.id, "", 1)}
          </div>
        ))}
        </div>
      </div>
      {contextMenu && <NotesContextMenu target={contextMenu} close={() => setContextMenu(null)} actions={menuActions} />}
      {operation && <LocalFileOperationDialog operation={operation} directories={["", ...Object.keys(pages).filter(key => key.startsWith(`${operation.rootId}:`)).map(key => key.slice(operation.rootId.length + 1))]} onApply={async (parent, name) => {
        setBusy(current => new Set(current).add("mutation"));
        try { await applyOperation(parent, name); }
        finally { if (mounted.current) setBusy(current => { const next = new Set(current); next.delete("mutation"); return next; }); }
      }} onClose={() => setOperation(null)} />}
      {!roots.length && (
        <p className="local-files-message">
          选择本机目录后，展开文件夹查看、编辑和保存 UTF-8 文件。
        </p>
      )}
    </section>
  );
}
