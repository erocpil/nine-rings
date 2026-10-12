import {
  imageLibrarySession,
  selectedImageSnapshot,
  subscribeSelectedImage,
  imageKey,
} from "../lib/image-library/session";
import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useSyncExternalStore,
  useLayoutEffect,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { copyToClipboard } from "../lib/clipboard";
import {
  imageDirectoryService,
  type ImageRoot,
  type ImageNode,
  type ImagePage,
} from "../lib/image-library/directory-service";
import {
  requestMainImageView,
  type ViewedImage,
} from "../lib/image-library/viewer-request";
import { WorkspacePanelHeading } from "./WorkspacePanelHeading";
import { ToolbarIcon } from "./ToolbarIcon";
import { useNearViewport } from "../hooks/useNearViewport";
import { imagePreview } from "../lib/image-library/preview-resource";
interface TreeMenu {
  name: string;
  path: string;
  actionLabel: string;
  action: () => void;
  trigger: HTMLElement;
  x: number;
  y: number;
}
type OpenTreeMenu = (
  event: MouseEvent<HTMLButtonElement>,
  target: Omit<TreeMenu, "trigger" | "x" | "y">,
) => void;

function ImageTreeMenu({
  menu,
  close,
  onError,
}: {
  menu: TreeMenu;
  close: () => void;
  onError: (error: unknown) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(menu.x, innerWidth - box.width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(menu.y, innerHeight - box.height - 8))}px`;
    el.querySelector<HTMLButtonElement>("button")?.focus({
      preventScroll: true,
    });
  }, [menu]);
  useEffect(() => {
    const outside = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", close);
    };
  }, [close]);
  const dismiss = () => {
    close();
    if (menu.trigger.isConnected) menu.trigger.focus({ preventScroll: true });
  };
  const copy = (value: string) => {
    void copyToClipboard(value, { reportFailure: true })
      .then(dismiss)
      .catch((error) => {
        onError(error);
        dismiss();
      });
  };
  return createPortal(
    <div
      ref={ref}
      className="doc-context-menu image-tree-context-menu"
      role="menu"
      aria-label="图片树菜单"
      data-sidebar-owned
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (event.key === "Tab") close();
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          dismiss();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          const buttons = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
          );
          const index = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }
      }}
    >
      <button
        className="doc-context-item"
        role="menuitem"
        onClick={() => {
          dismiss();
          menu.action();
        }}
      >
        {menu.actionLabel}
      </button>
      <button
        className="doc-context-item"
        role="menuitem"
        onClick={() => copy(menu.name)}
      >
        复制名称
      </button>
      <button
        className="doc-context-item"
        role="menuitem"
        onClick={() => copy(menu.path)}
      >
        复制相对路径
      </button>
    </div>,
    document.body,
  );
}
function Thumbnail({ image }: { image: ViewedImage }) {
  const { src, name, rootId, nodeId } = image;
  const target = useMemo(
    () => ({ src, name, rootId, nodeId }),
    [src, name, rootId, nodeId],
  );
  const host = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(host);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!near) return;
    const controller = new AbortController();
    let release = () => {};
    void imagePreview(target, controller.signal, 128)
      .then((resource) => {
        release = resource.release;
        if (!controller.signal.aborted) setUrl(resource.url);
        else release();
      })
      .catch(() => {});
    return () => {
      controller.abort();
      release();
    };
  }, [near, target]);
  return (
    <span ref={host} className="image-tree-thumbnail">
      {url ? <img src={url} alt="" /> : <ToolbarIcon name="image" />}
    </span>
  );
}
function Directory({
  root,
  path,
  name,
  onError,
  onMenu,
}: {
  root: ImageRoot;
  path: string;
  name: string;
  onError: (error: unknown) => void;
  onMenu: OpenTreeMenu;
}) {
  const key = `${root.id}:${path}`;
  const selected = useSyncExternalStore(
    subscribeSelectedImage,
    selectedImageSnapshot,
  );
  const [open, setOpen] = useState(
    () => imageLibrarySession.directories.get(key)?.open ?? false,
  );
  const [page, setPage] = useState<ImagePage | null>(
    () => imageLibrarySession.directories.get(key)?.page ?? null,
  );
  useEffect(() => {
    imageLibrarySession.directories.set(key, { open, page });
  }, [key, open, page]);
  useEffect(() => {
    if (
      selected?.rootId === root.id &&
      selected.nodeId &&
      (!path || selected.nodeId.startsWith(path + "/"))
    ) {
      setOpen(true);
    }
    // A deliberate user collapse remains until the selected image changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.rootId, selected?.nodeId, key]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = async (offset = 0) => {
    setBusy(true);
    try {
      const next = await imageDirectoryService.list(root.id, path, offset);
      if (alive.current)
        setPage((current) => ({
          nodes: offset
            ? [...(current?.nodes ?? []), ...next.nodes]
            : next.nodes,
          next: next.next,
        }));
    } catch (error) {
      if (alive.current) onError(error);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    if (open && !page) void load();
    // Loading is driven by opening a directory, not by its error/busy state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);
  const images =
    page?.nodes
      .filter((node) => !node.directory)
      .map((node) => ({
        src: "",
        name: node.name,
        rootId: root.id,
        nodeId: node.id,
      })) ?? [];
  const view = (node: ImageNode) => {
    try {
      requestMainImageView(
        { src: "", name: node.name, rootId: root.id, nodeId: node.id },
        images,
      );
    } catch (error) {
      onError(error);
    }
  };
  return (
    <li role="treeitem" aria-expanded={open}>
      <button
        className="image-tree-folder"
        disabled={busy}
        onClick={() => {
          setOpen(!open);
        }}
        title={name}
        onContextMenu={(event) =>
          onMenu(event, {
            name,
            path: path || ".",
            actionLabel: open ? "收起目录" : "展开目录",
            action: () => setOpen(!open),
          })
        }
      >
        <ToolbarIcon name={open ? "chevronDown" : "chevronRight"} />
        <ToolbarIcon name="folder" />
        <span>{name}</span>
        {busy && <small>加载中</small>}
      </button>
      {open && (
        <ul role="group">
          {page?.nodes.map((node) =>
            node.directory ? (
              <Directory
                key={node.id}
                root={root}
                path={node.id}
                name={node.name}
                onError={onError}
                onMenu={onMenu}
              />
            ) : (
              <li
                role="treeitem"
                key={node.id}
                aria-selected={
                  imageKey(selected) ===
                  imageKey({
                    src: "",
                    name: node.name,
                    rootId: root.id,
                    nodeId: node.id,
                  })
                }
              >
                <button
                  className={`image-tree-file${selected?.rootId === root.id && selected.nodeId === node.id ? " is-selected" : ""}`}
                  aria-current={
                    selected?.rootId === root.id && selected.nodeId === node.id
                      ? "true"
                      : undefined
                  }
                  title={`${node.name}${node.size ? ` · ${Math.ceil(node.size / 1024)} KB` : ""}`}
                  onClick={() => view(node)}
                  onContextMenu={(event) =>
                    onMenu(event, {
                      name: node.name,
                      path: node.id,
                      actionLabel: "查看图片",
                      action: () => view(node),
                    })
                  }
                >
                  <Thumbnail
                    image={{
                      src: "",
                      name: node.name,
                      rootId: root.id,
                      nodeId: node.id,
                    }}
                  />
                  <span>{node.name}</span>
                </button>
              </li>
            ),
          )}
          {page?.next !== null && page && (
            <li>
              <button
                className="btn"
                disabled={busy}
                onClick={() => void load(page.next!)}
              >
                加载更多
              </button>
            </li>
          )}
          {page && !page.nodes.length && (
            <li className="settings-desc">没有支持的图片或子目录</li>
          )}
        </ul>
      )}
    </li>
  );
}
export function ImageLibraryPanel({
  onClose,
  onBack,
}: {
  onClose: () => void;
  onBack?: () => void;
}) {
  const [roots, setRoots] = useState<ImageRoot[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<TreeMenu | null>(null);
  const openMenu: OpenTreeMenu = (event, target) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      ...target,
      trigger: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
    });
  };
  const scroll = useRef<HTMLDivElement>(null);
  const restoreScroll = useRef(imageLibrarySession.scrollTop);
  useLayoutEffect(() => {
    if (roots.length && scroll.current)
      scroll.current.scrollTop = restoreScroll.current;
  }, [roots]);
  const files = useRef<HTMLInputElement>(null);
  const folders = useRef<HTMLInputElement>(null);
  const fail = (cause: unknown) =>
    setError(cause instanceof Error ? cause.message : String(cause));
  useEffect(() => {
    let cancelled = false;
    void imageDirectoryService
      .roots()
      .then((value) => {
        if (!cancelled) setRoots(value);
      })
      .catch((cause) => {
        if (!cancelled) fail(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  const choose = async () => {
    setBusy(true);
    setError("");
    try {
      await imageDirectoryService.choose();
      setRevision((value) => value + 1);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };
  const add = (selected: FileList | null) => {
    try {
      imageDirectoryService.addFiles(Array.from(selected ?? []));
      setRevision((value) => value + 1);
      setError("");
    } catch (cause) {
      fail(cause);
    }
  };
  return (
    <section className="image-library-panel" aria-label="图片目录分栏">
      <WorkspacePanelHeading title="图片">
        {onBack && (
          <button
            type="button"
            className="btn-icon"
            aria-label="返回文档树"
            title="返回文档树"
            onClick={onBack}
          >
            <ToolbarIcon name="folder" />
          </button>
        )}
        <button
          className="btn-icon"
          aria-label="选择图片目录"
          title="选择图片目录"
          disabled={busy}
          onClick={() => {
            if (imageDirectoryService.supportsDirectoryPicker()) void choose();
            else folders.current?.click();
          }}
        >
          <ToolbarIcon name="folder" />
        </button>
        <button
          className="btn-icon"
          aria-label="选择图片文件"
          title="选择图片文件（会话内）"
          onClick={() => files.current?.click()}
        >
          <ToolbarIcon name="image" />
        </button>
        <button
          className="btn-icon"
          aria-label="刷新图片目录"
          title="刷新图片目录"
          onClick={() => {
            for (const entry of imageLibrarySession.directories.values())
              entry.page = null;
            setRevision((value) => value + 1);
          }}
        >
          <ToolbarIcon name="refresh" />
        </button>
        <button
          className="btn-icon"
          aria-label="收起图片分栏"
          title="收起图片分栏"
          onClick={onClose}
        >
          <ToolbarIcon name="chevronLeft" />
        </button>
      </WorkspacePanelHeading>
      <input
        ref={files}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp"
        multiple
        hidden
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folders}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="image-library-error">
          {error}
        </p>
      )}
      <div
        ref={scroll}
        className="image-library-scroll"
        onScroll={(event) => {
          imageLibrarySession.scrollTop = event.currentTarget.scrollTop;
          restoreScroll.current = event.currentTarget.scrollTop;
        }}
      >
        <p className="settings-desc">
          选择目录浏览本机图片；原文件保持不变。临时选择的图片在关闭插件或重启后需重新选择。
        </p>
        {!roots.length && <p className="settings-desc">还没有图片目录</p>}
        {roots.map((root) => (
          <div key={root.id} className="image-library-root">
            <button
              className="btn-icon"
              aria-label={`移除图片目录 ${root.name}`}
              title="撤销目录授权，不删除文件"
              onClick={() => {
                void imageDirectoryService
                  .remove(root.id)
                  .then(() => setRevision((value) => value + 1))
                  .catch(fail);
              }}
            >
              <ToolbarIcon name="close" />
            </button>
            <ul role="tree" aria-label={root.name}>
              <Directory
                key={`${root.id}:${revision}`}
                root={root}
                path=""
                name={`${root.name}${root.transient ? "（临时）" : ""}`}
                onError={fail}
                onMenu={openMenu}
              />
            </ul>
          </div>
        ))}
      </div>
      {menu && (
        <ImageTreeMenu menu={menu} close={() => setMenu(null)} onError={fail} />
      )}
    </section>
  );
}
