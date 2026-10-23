import { useEffect, useRef, useState, type CSSProperties } from "react";
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
import { ToolbarIcon } from "./ToolbarIcon";
import "../styles/local-files.css";

const NAVIGATION_KEY = "nr:local-files-navigation";
interface LocalFilesNavigation {
  expanded: string[];
  file: { rootId: string; nodeId: string; name: string } | null;
}
function readNavigation(): LocalFilesNavigation {
  try {
    const value = JSON.parse(localStorage.getItem(NAVIGATION_KEY) ?? "null") as Partial<LocalFilesNavigation> | null;
    return {
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
    return { expanded: [], file: null };
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

export function LocalFilesPanel({
  active,
  onBack,
}: {
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
  const display = usePanelDisplay("local-files");
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const revision = useRef({ value: 0 });
  useEffect(() => {
    const lifetime = revision.current;
    mounted.current = true;
    void localFileService
      .roots()
      .then(async (value) => {
        if (!mounted.current) return;
        setRoots(value);
        const rootIds = new Set(value.map((root) => root.id));
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
        if (restored.file && !rootIds.has(restored.file.rootId)) {
          setSelectedFile(null);
          setSelected("");
        }
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
    try {
      localStorage.setItem(
        NAVIGATION_KEY,
        JSON.stringify({ expanded: [...expanded], file: selectedFile }),
      );
    } catch {
      /* Device-local navigation state is optional. */
    }
  }, [expanded, selectedFile]);
  useEffect(() => {
    if (!active || !rootsReady || !selectedFile) return;
    if (!roots.some((root) => root.id === selectedFile.rootId)) return;
    const view = mainViews.getSnapshot();
    if (
      sameLocalFile(view.current, selectedFile) ||
      sameLocalFile(view.pending, selectedFile)
    )
      return;
    try {
      mainViews
        .bind(workspacePanels.assert("files"))
        .open(LOCAL_FILE_VIEW_ID, selectedFile);
    } catch (reason) {
      setError(String(reason));
    }
  }, [active, roots, rootsReady, selectedFile]);
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
    toggle(root.id, "");
  };
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
                onClick={() => {
                  if (child.directory) toggle(rootId, child.id);
                  else
                    void run(childKey, async () => {
                      // File bytes are read by the host renderer only after its save/navigation gate.
                      mainViews
                        .bind(workspacePanels.assert("files"))
                        .open(LOCAL_FILE_VIEW_ID, {
                          rootId,
                          nodeId: child.id,
                          name: child.name,
                        });
                      setSelectedFile({
                        rootId,
                        nodeId: child.id,
                        name: child.name,
                      });
                      setSelected(childKey);
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
      hidden={!active}
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
          title="选择只读目录"
          aria-label="选择只读目录"
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
      {!roots.length && (
        <p className="local-files-message">
          选择本机目录后，展开文件夹查看 UTF-8 源码。此入口不提供写入。
        </p>
      )}
    </section>
  );
}
