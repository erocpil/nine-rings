import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { imagePreview } from "../lib/image-library/preview-resource";
import {
  IMAGE_VIEW_EVENT,
  requestMainImageView,
  pendingImageView,
  clearImageView,
  IMAGE_INSERT_EVENT,
  type ViewedImage,
} from "../lib/image-library/viewer-request";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { ToolbarIcon } from "./ToolbarIcon";
export function ImageViewer({
  images,
  initial,
  onClose,
  presentation = "modal",
  active = true,
  canInsert,
  onInsert,
}: {
  images: readonly ViewedImage[];
  initial: ViewedImage;
  onClose: () => void;
  presentation?: "modal" | "main";
  active?: boolean;
  canInsert?: boolean;
  onInsert?: (image: ViewedImage) => void;
}) {
  const [index, setIndex] = useState(
    Math.max(
      0,
      images.findIndex(
        (image) =>
          image.src === initial.src &&
          image.nodeId === initial.nodeId &&
          image.rootId === initial.rootId,
      ),
    ),
  );
  const image = images[index] ?? initial;
  const [resource, setResource] = useState("");
  const [error, setError] = useState("");
  const [original, setOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const container = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  useLayoutEffect(() => {
    if (presentation !== "modal") return;
    const element = container.current as HTMLDialogElement;
    element.showModal();
    return () => element.close();
  }, [presentation]);
  useDialogFocus(container, presentation === "modal", close, undefined, true);
  useEffect(() => {
    if (presentation !== "main" || !active) return;
    const previous = document.activeElement;
    close.current?.focus({ preventScroll: true });
    return () => {
      requestAnimationFrame(() => {
        if (
          previous instanceof HTMLElement &&
          previous.isConnected &&
          (!document.activeElement || document.activeElement === document.body)
        )
          previous.focus({ preventScroll: true });
      });
    };
  }, [presentation, active]);

  useEffect(() => {
    const controller = new AbortController();
    let release = () => {};
    setResource("");
    setError("");
    reset();
    setRotation(0);
    void imagePreview(image, controller.signal, original ? 0 : 2048)
      .then((value) => {
        release = value.release;
        if (controller.signal.aborted) release();
        else setResource(value.url);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      controller.abort();
      release();
    };
  }, [image, original]);
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey)
        setZoom((value) =>
          Math.max(0.1, Math.min(12, value * Math.exp(-event.deltaY * 0.01))),
        );
      else
        setPan((value) => ({
          x: value.x - event.deltaX,
          y: value.y - event.deltaY,
        }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const change = (step: number) => {
    setOriginal(false);
    setIndex((value) => Math.max(0, Math.min(images.length - 1, value + step)));
  };
  const copy = () => {
    try {
      const promise = new Promise<Blob>((resolve, reject) => {
        const element = img.current;
        if (!element?.naturalWidth) {
          reject(new Error("图片尚未加载"));
          return;
        }
        try {
          const canvas = document.createElement("canvas");
          canvas.width = element.naturalWidth;
          canvas.height = element.naturalHeight;
          canvas.getContext("2d")!.drawImage(element, 0, 0);
          canvas.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(new Error("无法复制图片")),
            "image/png",
          );
        } catch (cause) {
          reject(cause);
        }
      });
      void navigator.clipboard
        .write([new ClipboardItem({ "image/png": promise })])
        .then(
          () => setError("已复制图片"),
          () => setError("无法复制图片；网络图片可能不允许跨域读取"),
        );
    } catch {
      setError("当前环境不支持复制图片");
    }
  };
  const points = (map: Map<number, { x: number; y: number }>) => {
    const values = [...map.values()];
    if (values.length < 2) return null;
    return {
      x: (values[0].x + values[1].x) / 2,
      y: (values[0].y + values[1].y) / 2,
      distance: Math.hypot(
        values[0].x - values[1].x,
        values[0].y - values[1].y,
      ),
    };
  };
  const Surface = presentation === "modal" ? "dialog" : "section";
  const content = (
    <Surface
      ref={(element) => {
        container.current = element;
      }}
      className={
        presentation === "modal" ? "image-viewer-dialog" : "image-viewer-main"
      }
      tabIndex={-1}
      aria-label="图片查看器"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (
          ["Escape", "ArrowLeft", "ArrowRight", "+", "=", "-", "0"].includes(
            event.key,
          )
        )
          event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          change(-1);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          change(1);
        }
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          setZoom((value) => Math.min(12, value * 1.25));
        }
        if (event.key === "-") {
          event.preventDefault();
          setZoom((value) => Math.max(0.1, value / 1.25));
        }
        if (event.key === "0") {
          event.preventDefault();
          reset();
        }
      }}
    >
      <header>
        <h2 title={image.name}>{image.name || "文档图片"}</h2>
        <button
          ref={close}
          className="btn-icon"
          aria-label={presentation === "main" ? "返回原视图" : "关闭图片查看器"}
          title={
            presentation === "main" ? "返回原视图（Esc）" : "关闭图片查看器"
          }
          onClick={onClose}
        >
          <ToolbarIcon
            name={presentation === "main" ? "chevronLeft" : "close"}
          />
        </button>
      </header>
      <div
        className="image-viewer-toolbar"
        role="toolbar"
        aria-label="图片查看工具"
      >
        <button
          className="btn-icon"
          aria-label="上一张图片"
          title="上一张图片（←）"
          disabled={index === 0}
          onClick={() => change(-1)}
        >
          <ToolbarIcon name="chevronLeft" />
        </button>
        <span>
          {index + 1}/{images.length}
        </span>
        <button
          className="btn-icon"
          aria-label="下一张图片"
          title="下一张图片（→）"
          disabled={index >= images.length - 1}
          onClick={() => change(1)}
        >
          <ToolbarIcon name="chevronRight" />
        </button>
        <button
          className="btn-icon"
          aria-label="缩小图片"
          title="缩小（−）"
          onClick={() => setZoom((value) => Math.max(0.1, value / 1.25))}
        >
          <ToolbarIcon name="minus" />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          className="btn-icon"
          aria-label="放大图片"
          title="放大（+）"
          onClick={() => setZoom((value) => Math.min(12, value * 1.25))}
        >
          <ToolbarIcon name="plus" />
        </button>
        <button className="btn" onClick={reset}>
          适窗
        </button>
        <button
          className="btn"
          title="当前预览的原始像素尺寸"
          onClick={() => {
            setOriginal(true);
            if (img.current?.naturalWidth && original)
              setZoom(
                img.current.naturalWidth / Math.max(1, img.current.clientWidth),
              );
            setPan({ x: 0, y: 0 });
          }}
        >
          原始尺寸
        </button>
        <button
          className="btn-icon"
          aria-label="旋转预览"
          title="旋转预览，不修改原图"
          onClick={() => {
            setRotation((value) => (value + 90) % 360);
            setPan({ x: 0, y: 0 });
          }}
        >
          <ToolbarIcon name="rotate" />
        </button>
        <button
          className="btn-icon"
          aria-label="复制图片"
          title="复制当前预览图片"
          disabled={
            !resource ||
            !navigator.clipboard?.write ||
            typeof ClipboardItem === "undefined"
          }
          onClick={copy}
        >
          <ToolbarIcon name="copy" />
        </button>
        <button
          className="btn"
          title="需有可编辑文档且启用插入图片插件"
          disabled={
            canInsert !== undefined
              ? !canInsert
              : !document.querySelector('[data-can-insert-image="true"]')
          }
          onClick={() => {
            if (onInsert) {
              onInsert(image);
              return;
            }
            if (presentation === "modal")
              (container.current as HTMLDialogElement)?.close();
            onClose();
            requestAnimationFrame(() =>
              window.dispatchEvent(
                new CustomEvent(IMAGE_INSERT_EVENT, { detail: image }),
              ),
            );
          }}
        >
          插入当前文档
        </button>
        {presentation === "modal" && (
          <button
            type="button"
            className="btn-icon"
            aria-label="在主区域打开"
            title="在主区域打开"
            onClick={() => {
              requestMainImageView(image, images);
              onClose();
            }}
          >
            <ToolbarIcon name="expand" />
          </button>
        )}
      </div>
      <div
        ref={viewport}
        className="image-viewer-viewport"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onPointerMove={(event) => {
          const before = pointers.current.get(event.pointerId);
          if (!before) return;
          const pair = points(pointers.current);
          pointers.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
          });
          const after = points(pointers.current);
          if (pair && after) {
            if (pair.distance > 1)
              setZoom((value) =>
                Math.max(
                  0.1,
                  Math.min(12, (value * after.distance) / pair.distance),
                ),
              );
            setPan((value) => ({
              x: value.x + after.x - pair.x,
              y: value.y + after.y - pair.y,
            }));
          } else
            setPan((value) => ({
              x: value.x + event.clientX - before.x,
              y: value.y + event.clientY - before.y,
            }));
        }}
        onPointerUp={(event) => pointers.current.delete(event.pointerId)}
        onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={(event) =>
          pointers.current.delete(event.pointerId)
        }
      >
        {resource ? (
          <img
            ref={img}
            src={resource}
            alt={image.name}
            draggable={false}
            onLoad={() => {
              if (original && img.current)
                setZoom(
                  img.current.naturalWidth /
                    Math.max(1, img.current.clientWidth),
                );
            }}
            onError={() => setError("图片无法解码或文件已不可访问")}
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`,
            }}
          />
        ) : (
          !error && <p>正在加载图片…</p>
        )}
      </div>
      <footer>
        <span role="status">
          {error || "双指平移 · 捏合缩放 · 旋转仅影响预览"}
        </span>
      </footer>
    </Surface>
  );
  return presentation === "modal"
    ? createPortal(content, document.body)
    : content;
}
export function ImageViewerHost() {
  const [request, setRequest] = useState<{
    image: ViewedImage;
    images: readonly ViewedImage[];
  } | null>(null);
  useEffect(() => {
    const listener = (event: Event) => {
      try {
        workspacePanels.assert("images");
        const detail = (event as CustomEvent).detail;
        if (
          !detail?.image ||
          typeof detail.image.src !== "string" ||
          typeof detail.image.name !== "string"
        )
          return;
        setRequest({
          image: detail.image,
          images: detail.images?.length ? detail.images : [detail.image],
        });
      } catch {
        /* disabled */
      }
    };
    window.addEventListener(IMAGE_VIEW_EVENT, listener);
    if (pendingImageView)
      listener(new CustomEvent(IMAGE_VIEW_EVENT, { detail: pendingImageView }));
    const revoke = workspacePanels.subscribe(() => {
      if (!workspacePanels.getSnapshot().length) {
        clearImageView();
        setRequest(null);
      }
    });
    return () => {
      window.removeEventListener(IMAGE_VIEW_EVENT, listener);
      revoke();
    };
  }, []);
  return request ? (
    <ImageViewer
      key={`${request.image.rootId}:${request.image.nodeId}:${request.image.src}`}
      images={request.images}
      initial={request.image}
      onClose={() => {
        clearImageView();
        setRequest(null);
      }}
    />
  ) : null;
}
