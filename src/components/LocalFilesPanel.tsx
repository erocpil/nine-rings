import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import {
  localFileService,
  type FileRoot,
  type FilePage,
} from "../lib/local-files/service";
import { LOCAL_FILE_VIEW_ID } from "../lib/plugin-system/builtin-local-files";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import { panelDisplays } from "../lib/plugin-system/panel-display";
import { usePanelDisplay } from "../hooks/usePanelDisplay";
import { LOCAL_FILE_OPENED_EVENT, LOCAL_FILE_REVEAL_EVENT, rememberRecentLocalFile, renameRecentLocalPath } from "../lib/local-files/recent";
import { isLocalFileReadOnly, setLocalFileReadOnly } from "../lib/local-files/access";
import { isLocalFileDirty } from "../lib/local-files/session";
import { migrateLocalFilePathState } from "../lib/local-files/path-state";
import { renameLocalFocusTabPaths } from "../lib/focus-tabs";
import { ToolbarIcon } from "./ToolbarIcon";
import { NotesContextMenu, type NotesMenuTarget } from "./NotesContextMenu";
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

export function LocalFilesPanel({ onBack }: {
  active: boolean;
  onBack?: () => void;
}) {
  const [restored] = useState(readNavigation);
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [pages, setPages] = useState<Record<string, FilePage>>({});
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(restored.expanded),
  );
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [selectedFile, setSelectedFile] = useState(restored.file);
  const [selected, setSelected] = useState(
    restored.file ? `${restored.file.rootId}:${restored.file.nodeId}` : "",
  );
  const [rootsReady, setRootsReady] = useState(false);
  const mainViewState = useSyncExternalStore(mainViews.subscribe, mainViews.getSnapshot, mainViews.getSnapshot);
  const [contextMenu, setContextMenu] = useState<(NotesMenuTarget & { rootId: string; nodeId: string; directory: boolean; name: string }) | null>(null);
  const display = usePanelDisplay("local-files");
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const revision = useRef({ value: 0 });
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
      const parts = file.nodeId.split("/");
      const directories = ["", ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"))];
      setSelectedFile({ rootId: file.rootId, rootName: roots.find(root => root.id === file.rootId)?.name, nodeId: file.nodeId, name: file.name });
      setSelected(`${file.rootId}:${file.nodeId}`);
      setExpanded(current => new Set([...current, ...directories.map(node => `${file.rootId}:${node}`)]));
      void (async () => {
        for (const node of directories) {
          const key = `${file.rootId}:${node}`;
          if (pages[key]) continue;
          try { const page = await localFileService.list(file.rootId!, node); setPages(current => ({ ...current, [key]: page })); }
          catch (reason) { setError(String(reason)); break; }
        }
      })();
    };
    window.addEventListener(LOCAL_FILE_REVEAL_EVENT, reveal);
    return () => window.removeEventListener(LOCAL_FILE_REVEAL_EVENT, reveal);
  }, [pages, roots]);
  useEffect(() => {
    const lifetime = revision.current;
    mounted.current = true;
    void localFileService
      .roots()
      .then(async (value) => {
        if (!mounted.current) return;
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
            const page = await localFileService.list(rootId, node, 0);
            if (!mounted.current || lifetime.value !== 0) return;
            available.add(key);
            setPages((current) => ({ ...current, [key]: page }));
          } catch {
            // A directory may have moved since the last session; retain the
            // remaining valid expansion state instead of blocking restoration.
          }
          if (!mounted.current || lifetime.value !== 0) return;
        }
        setExpanded(available);
        if (!mounted.current) return;
        if (restored.file && !rootIds.has(restored.file.rootId))
          setError("上次打开的本地文件目录尚未授权。重新选择同一目录后会尝试恢复文件。");
        setRootsReady(true);
      })
      .catch((reason) => {
        if (mounted.current) {
          setError(String(reason));
          setRootsReady(true);
        }
      });
    return () => {
      mounted.current = false;
      lifetime.value++;
    };
  }, [restored]);
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
    if (!restored.open || !rootsReady || !selectedFile) return;
    if (!roots.some((root) => root.id === selectedFile.rootId)) return;
    const view = mainViews.getSnapshot();
    if (
      sameLocalFile(view.current, selectedFile) ||
      sameLocalFile(view.pending, selectedFile)
    )
      return;
    try {
      const rootName = roots.find(root => root.id === selectedFile.rootId)?.name ?? selectedFile.rootName ?? "本地文件";
      rememberRecentLocalFile({ rootId: selectedFile.rootId, rootName, nodeId: selectedFile.nodeId, name: selectedFile.name });
      mainViews
        .bind(workspacePanels.assert("files"))
        .open(LOCAL_FILE_VIEW_ID, selectedFile);
    } catch (reason) {
      setError(String(reason));
    }
  }, [restored.open, roots, rootsReady, selectedFile]);
  const run = async (key: string, action: () => Promise<void>) => {
    const version = revision.current.value;
    setError("");
    setBusy((value) => new Set(value).add(key));
    try {
      await action();
    } catch (reason) {
      if (mounted.current && version === revision.current.value)
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
    const page = await localFileService.list(rootId, node, offset);
    if (!mounted.current || version !== revision.current.value) return;
    setPages((value) => ({
      ...value,
      [key]: {
        ...page,
        nodes: offset
          ? [...(value[key]?.nodes ?? []), ...page.nodes]
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
          try { const page = await localFileService.list(root.id, key.slice(at + 1)); setPages(current => ({ ...current, [key]: page })); }
          catch { /* The saved folder may have moved since last use. */ }
        }
      })();
    }
    if (!restorePrevious) toggle(root.id, "");
  };
  const openFile = (rootId: string, nodeId: string, name: string) => {
    const rootName = roots.find(root => root.id === rootId)?.name ?? "本地文件";
    mainViews.bind(workspacePanels.assert("files")).open(LOCAL_FILE_VIEW_ID, { rootId, nodeId, name });
    rememberRecentLocalFile({ rootId, rootName, nodeId, name });
    setSelectedFile({ rootId, rootName, nodeId, name });
    setSelected(`${rootId}:${nodeId}`);
  };
  const copyLocalPath = async (rootId: string, nodeId: string) => {
    const path = await localFileService.displayPath(rootId, nodeId);
    await navigator.clipboard.writeText(path);
    setError(`已复制路径：${path}`);
  };
  const renameLocalPath = async (rootId: string, nodeId: string, oldName: string, directory: boolean) => {
    if (!localFileService.canRename(rootId)) throw new Error("目录快照无法重命名，请重新授权原目录");
    const view = mainViews.getSnapshot();
    const activeView = [view.current, view.pending].find(item => item?.renderer === "local-file" && item.data.rootId === rootId && (item.data.nodeId === nodeId || (directory && (!nodeId || item.data.nodeId.startsWith(`${nodeId}/`)))));
    if (activeView?.renderer === "local-file" && isLocalFileDirty(`${rootId}:${activeView.data.nodeId}`))
      throw new Error("此路径中有未保存编辑，请保存或关闭文件后再重命名");
    const name = window.prompt("重命名", oldName);
    if (name === null || name.trim() === oldName) return;
    const oldRootName = roots.find(item => item.id === rootId)?.name ?? "本地文件";
    const { root, nodeId: nextNodeId } = await localFileService.rename(rootId, nodeId, name);
    migrateLocalFilePathState(rootId, nodeId, nextNodeId);
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
  const menuActions = contextMenu ? [
    { label: "复制路径", run: () => void copyLocalPath(contextMenu.rootId, contextMenu.nodeId).catch(reason => setError(String(reason))) },
    { label: "重命名", run: () => void run(`rename:${contextMenu.rootId}:${contextMenu.nodeId}`, () => renameLocalPath(contextMenu.rootId, contextMenu.nodeId, contextMenu.name, contextMenu.directory)) },
    { label: isLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId) ? "允许编辑" : "设为只读", run: () => setLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId, !isLocalFileReadOnly(contextMenu.rootId, contextMenu.nodeId)) },
  ] : [];
  const refreshExpanded = () =>
    void run("refresh", async () => {
      for (const key of expanded) {
        const at = key.indexOf(":");
        await load(key.slice(0, at), key.slice(at + 1));
      }
    });
  const children = (
    rootId: string,
    node: string,
    depth: number,
  ): React.ReactNode => {
    const key = rootId + ":" + node,
      page = pages[key];
    if (!expanded.has(key)) return null;
    return (
      <div role="group">
        {page?.nodes.map((child) => {
          const childKey = rootId + ":" + child.id;
          return (
            <div key={child.id}>
              <button
                type="button"
                className="local-file-row"
                style={{ paddingInlineStart: 12 + depth * 14 }}
                aria-expanded={
                  child.directory ? expanded.has(childKey) : undefined
                }
                aria-pressed={
                  !child.directory ? selected === childKey : undefined
                }
                title={display?.tooltip === "name" ? child.name : child.id}
                onContextMenu={event => {
                  event.preventDefault(); event.stopPropagation();
                  setContextMenu({ id: childKey, title: child.name, x: event.clientX, y: event.clientY, trigger: event.currentTarget, rootId, nodeId: child.id, directory: child.directory, name: child.name });
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
            disabled={busy.has(key)}
            onClick={() => void run(key, () => load(rootId, node, page.next!))}
          >
            加载更多
          </button>
        )}
        {page && !page.nodes.length && (
          <p className="local-files-message">空目录</p>
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
      <p className="local-files-message">只读 · 原文件不会导入或同步</p>
      {error && (
        <p role="alert" className="local-files-message">
          {error}
        </p>
      )}
      <div
        className="local-files-tree"
        role="tree"
        data-panel-display={display ? "plugin" : undefined}
        style={display ? {
          "--panel-display-font": display.font === "mono" ? "var(--font-mono)" : display.font === "sans" ? "var(--font)" : "inherit",
          "--panel-display-font-size": `${display.fontSize}px`,
          "--panel-display-row-height": `${display.rowHeight}px`,
          "--panel-display-document-color": display.labelColor === "accent" ? "var(--accent)" : display.labelColor === "secondary" ? "var(--text-secondary)" : "var(--text)",
        } as CSSProperties : undefined}
      >
        {roots.map((root) => (
          <div key={root.id}>
            <div className="local-file-root">
              <button
                type="button"
                className="local-file-row"
                title={root.name}
                onContextMenu={event => {
                  event.preventDefault(); event.stopPropagation();
                  setContextMenu({ id: root.id, title: root.name, x: event.clientX, y: event.clientY, trigger: event.currentTarget, rootId: root.id, nodeId: "", directory: true, name: root.name });
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
      {contextMenu && <NotesContextMenu target={contextMenu} close={() => setContextMenu(null)} actions={menuActions} />}
      {!roots.length && (
        <p className="local-files-message">
          选择本机目录后，展开文件夹查看、编辑和保存 UTF-8 文件。
        </p>
      )}
    </section>
  );
}
