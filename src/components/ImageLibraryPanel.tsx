import { useEffect, useRef, useState, useMemo } from "react";
import {
  imageDirectoryService,
  type ImageRoot,
  type ImageNode,
  type ImagePage,
} from "../lib/image-library/directory-service";
import {
  requestImageView,
  type ViewedImage,
} from "../lib/image-library/viewer-request";
import { WorkspacePanelHeading } from "./WorkspacePanelHeading";
import { ToolbarIcon } from "./ToolbarIcon";
import { useNearViewport } from "../hooks/useNearViewport";
import { imagePreview } from "../lib/image-library/preview-resource";
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
}: {
  root: ImageRoot;
  path: string;
  name: string;
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<ImagePage | null>(null);
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
  const images =
    page?.nodes
      .filter((node) => !node.directory)
      .map((node) => ({
        src: "",
        name: node.name,
        rootId: root.id,
        nodeId: node.id,
      })) ?? [];
  const view = (node: ImageNode) =>
    requestImageView(
      { src: "", name: node.name, rootId: root.id, nodeId: node.id },
      images,
    );
  return (
    <li role="treeitem" aria-expanded={open}>
      <button
        className="image-tree-folder"
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          if (!open && !page) void load();
        }}
        title={name}
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
              />
            ) : (
              <li role="treeitem" key={node.id}>
                <button
                  className="image-tree-file"
                  title={`${node.name}${node.size ? ` · ${Math.ceil(node.size / 1024)} KB` : ""}`}
                  onClick={() => view(node)}
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
          onClick={() => setRevision((value) => value + 1)}
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
      <div className="image-library-scroll">
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
              />
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
