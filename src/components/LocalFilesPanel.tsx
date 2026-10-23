import { useEffect, useRef, useState } from "react";
import {
  localFileService,
  type FileRoot,
  type FilePage,
} from "../lib/local-files/service";
import { LOCAL_FILE_VIEW_ID } from "../lib/plugin-system/builtin-local-files";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { mainViews } from "../lib/plugin-system/main-view-registry";
import { ToolbarIcon } from "./ToolbarIcon";
import "../styles/local-files.css";

export function LocalFilesPanel({
  active,
  onBack,
}: {
  active: boolean;
  onBack?: () => void;
}) {
  const [roots, setRoots] = useState<FileRoot[]>([]);
  const [pages, setPages] = useState<Record<string, FilePage>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const revision = useRef({ value: 0 });
  useEffect(() => {
    const lifetime = revision.current;
    mounted.current = true;
    void localFileService
      .roots()
      .then((value) => {
        if (mounted.current) setRoots(value);
      })
      .catch((reason) => {
        if (mounted.current) setError(String(reason));
      });
    return () => {
      mounted.current = false;
      lifetime.value++;
    };
  }, []);
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
                title={child.id}
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
                      setSelected(childKey);
                    });
                }}
              >
                <span aria-hidden="true">
                  {child.directory ? (expanded.has(childKey) ? "▾" : "▸") : "·"}
                </span>
                <span>{child.name}</span>
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
        <button
          type="button"
          className="btn-icon"
          title="刷新已展开目录"
          aria-label="刷新已展开目录"
          disabled={busy.size > 0}
          onClick={() =>
            void run("refresh", async () => {
              for (const key of expanded) {
                const at = key.indexOf(":");
                await load(key.slice(0, at), key.slice(at + 1));
              }
            })
          }
        >
          <ToolbarIcon name="refresh" />
        </button>
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
      <div className="local-files-tree" role="tree">
        {roots.map((root) => (
          <div key={root.id}>
            <div className="local-file-root">
              <button
                type="button"
                className="local-file-row"
                aria-expanded={expanded.has(root.id + ":")}
                onClick={() => toggle(root.id, "")}
              >
                <span>{expanded.has(root.id + ":") ? "▾" : "▸"}</span>
                <span>
                  {root.name}
                  {root.transient ? "（会话）" : ""}
                </span>
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
