import { selectImage, imageKey } from "../lib/image-library/session";
import { ImagePropertiesPanel } from "./ImagePropertiesPanel";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { imageResourceCache } from "../lib/image-library/resource-cache";
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
import { ImageFilmstrip } from "./ImageFilmstrip";
import { constrainPanAxis, visiblePanLimit } from "../lib/pan-boundary";
import {
  applyImageTransform,
  DEFAULT_IMAGE_RECIPE,
  imageFitScale,
  imageRecipeCss,
  type ImageTransformOperation,
} from "../lib/image-library/view-transform";
export function ImageViewer({
  images,
  initial,
  onClose,
  presentation = "modal",
  active = true,
  canInsert,
  onInsert,
  focusMode,
  onFocusChange,
}: {
  images: readonly ViewedImage[];
  initial: ViewedImage;
  onClose: () => void;
  presentation?: "modal" | "main";
  active?: boolean;
  canInsert?: boolean;
  onInsert?: (image: ViewedImage) => void;
  focusMode?: boolean;
  onFocusChange?: (focus: boolean) => void;
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
  const [request, setRequest] = useState({ images, initial });
  if (request.images !== images || request.initial !== initial) {
    setRequest({ images, initial });
    setIndex(
      Math.max(
        0,
        images.findIndex(
          (value) =>
            value.src === initial.src &&
            value.rootId === initial.rootId &&
            value.nodeId === initial.nodeId,
        ),
      ),
    );
  }
  const image = images[index] ?? initial;
  const [localFocus, setLocalFocus] = useState(false);
  const focused = focusMode ?? localFocus;
  const toggleFocus = () => {
    if (onFocusChange) onFocusChange(!focused);
    else setLocalFocus(!focused);
  };
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [propertiesPinned, setPropertiesPinned] = useState(false);
  const [decodedDimensions, setDecodedDimensions] = useState({
    width: 0,
    height: 0,
  });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (active) selectImage(image);
  }, [image, active]);
  const [resource, setResource] = useState("");
  const [resourceKey, setResourceKey] = useState("");
  const visibleResource = resourceKey === imageKey(image) ? resource : "";
  const [error, setError] = useState("");
  const [original, setOriginal] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [recipe, setRecipe] = useState({ ...DEFAULT_IMAGE_RECIPE });
  const rotation = recipe.quarterTurns * 90;
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const fitScale = imageFitScale(
    dimensions.width,
    dimensions.height,
    viewportSize.width,
    viewportSize.height,
    recipe.quarterTurns,
  );
  const [stripPinned, setStripPinned] = useState(() => localStorage.getItem("nr:imageFilmstripPinned") === "true");
  const [stripOpen, setStripOpen] = useState(
    () => localStorage.getItem("nr:imageFilmstrip") !== "false",
  );
  const [background, setBackground] = useState(() => {
    const saved = localStorage.getItem("nr:imageBackground");
    return saved === "checker" || saved === "dark" || saved === "light"
      ? saved
      : "theme";
  });
  const editPreview = (operation: ImageTransformOperation) => {
    setRecipe((value) => applyImageTransform(value, operation));
    setPan({ x: 0, y: 0 });
  };
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const container = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  const propertyTrigger = useRef<HTMLButtonElement>(null);
  const closeProperties = () => {
    setPropertiesOpen(false);
    requestAnimationFrame(() =>
      propertyTrigger.current?.focus({ preventScroll: true }),
    );
  };
  const dismiss = () => {
    if (propertiesOpen) closeProperties();
    else if (focused) toggleFocus();
    else onClose();
  };
  const viewport = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const transform = useRef({ zoom, pan });
  transform.current = { zoom, pan };
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;
  const movePan = useCallback(
    (
      next:
        | { x: number; y: number }
        | ((value: { x: number; y: number }) => { x: number; y: number }),
      nextZoom = transform.current.zoom,
    ) => {
      setPan((previous) => {
        const requested = typeof next === "function" ? next(previous) : next;
        const element = viewport.current;
        const picture = img.current;
        if (!element || !picture?.naturalWidth) return previous;
        const sideways = recipeRef.current.quarterTurns % 2 !== 0;
        return {
          x: constrainPanAxis(
            previous.x,
            requested.x,
            visiblePanLimit(
              (sideways ? picture.clientHeight : picture.clientWidth) *
                nextZoom,
              element.clientWidth,
            ),
          ),
          y: constrainPanAxis(
            previous.y,
            requested.y,
            visiblePanLimit(
              (sideways ? picture.clientWidth : picture.clientHeight) *
                nextZoom,
              element.clientHeight,
            ),
          ),
        };
      });
    },
    [],
  );
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const reset = () => {
    setOriginal(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    setRecipe({ ...DEFAULT_IMAGE_RECIPE });
  }, [image]);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !active) return;
    const measure = () =>
      setViewportSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    if (original && dimensions.width) setZoom(1 / fitScale);
  }, [original, fitScale, dimensions.width]);
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
    setDimensions({ width: 0, height: 0 });
    setDecodedDimensions({ width: 0, height: 0 });
    setError("");
    setZoom(1);
    setPan({ x: 0, y: 0 });
    void imageResourceCache
      .acquire(image, controller.signal, original ? 0 : 2048)
      .then((value) => {
        release = value.release;
        if (controller.signal.aborted) release();
        else {
          setResource(value.url);
          setResourceKey(imageKey(image));
          if (value.width && value.height)
            setDecodedDimensions({ width: value.width, height: value.height });
        }
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
    if (!active) return;
    let native: {
      zoom: number;
      pan: { x: number; y: number };
      x: number;
      y: number;
    } | null = null;
    let lastGesture = -Infinity;
    const zoomAt = (
      zoom: number,
      point: { x: number; y: number },
      before = transform.current,
    ) => {
      const next = Math.max(0.1, Math.min(12, zoom));
      setZoom(next);
      movePan(
        {
          x: point.x - ((point.x - before.pan.x) * next) / before.zoom,
          y: point.y - ((point.y - before.pan.y) * next) / before.zoom,
        },
        next,
      );
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const bounds = element.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        if (
          native ||
          performance.now() - lastGesture < 120 ||
          pointers.current.size >= 2
        )
          return;
        zoomAt(transform.current.zoom * Math.exp(-event.deltaY * 0.01), {
          x: event.clientX - bounds.left - bounds.width / 2,
          y: event.clientY - bounds.top - bounds.height / 2,
        });
      } else if (!native)
        movePan((value) => ({
          x: value.x - event.deltaX,
          y: value.y - event.deltaY,
        }));
    };
    const gesture = (event: Event) => {
      if (pointers.current.size >= 2 || !img.current?.naturalWidth) return;
      const value = event as Event & {
        scale?: number;
        clientX?: number;
        clientY?: number;
      };
      const bounds = element.getBoundingClientRect();
      if (event.type === "gesturestart")
        native = {
          ...transform.current,
          x:
            typeof value.clientX === "number" &&
            value.clientX >= bounds.left &&
            value.clientX <= bounds.right
              ? value.clientX - bounds.left - bounds.width / 2
              : 0,
          y:
            typeof value.clientY === "number" &&
            value.clientY >= bounds.top &&
            value.clientY <= bounds.bottom
              ? value.clientY - bounds.top - bounds.height / 2
              : 0,
        };
      if (!native) return;
      event.preventDefault();
      event.stopPropagation();
      lastGesture = performance.now();
      if (event.type === "gestureend") {
        native = null;
        return;
      }
      if (
        event.type === "gesturechange" &&
        Number.isFinite(value.scale) &&
        value.scale! > 0
      )
        zoomAt(native.zoom * value.scale!, native, native);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    for (const name of ["gesturestart", "gesturechange", "gestureend"])
      element.addEventListener(name, gesture, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
      for (const name of ["gesturestart", "gesturechange", "gestureend"])
        element.removeEventListener(name, gesture);
    };
  }, [active, movePan]);
  const change = useCallback(
    (step: number) => {
      setOriginal(false);
      setIndex((value) =>
        Math.max(0, Math.min(images.length - 1, value + step)),
      );
    },
    [images.length],
  );
  useEffect(() => {
    if (!active || presentation !== "main") return;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        !["ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(".image-viewer-main")) return;
      if (
        target?.closest(
          "input,textarea,select,[contenteditable=true],[role=dialog],[role=menu],[role=slider]",
        )
      )
        return;
      if (
        [
          ...document.querySelectorAll<HTMLElement>(
            'dialog[open], [aria-modal="true"], [role="menu"]',
          ),
        ].some(
          (node) => node.getClientRects().length && !node.closest("[inert]"),
        )
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      change(event.key === "ArrowRight" ? 1 : -1);
    };
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [active, presentation, change]);
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
          const sideways = recipe.quarterTurns % 2 !== 0;
          canvas.width = sideways
            ? element.naturalHeight
            : element.naturalWidth;
          canvas.height = sideways
            ? element.naturalWidth
            : element.naturalHeight;
          const context = canvas.getContext("2d")!;
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate((recipe.quarterTurns * Math.PI) / 2);
          context.scale(
            recipe.flipHorizontal ? -1 : 1,
            recipe.flipVertical ? -1 : 1,
          );
          context.drawImage(
            element,
            -element.naturalWidth / 2,
            -element.naturalHeight / 2,
          );
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
      className={`${presentation === "modal" ? "image-viewer-dialog" : "image-viewer-main"}${focused ? " image-viewer-focus" : ""}`}
      tabIndex={-1}
      aria-label="图片查看器"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={(event) => {
        if (
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          event.shiftKey ||
          (event.target as HTMLElement).closest(".image-properties-panel") ||
          (event.target as HTMLElement).closest("input,select,textarea")
        )
          return;
        if (
          ["Escape", "ArrowLeft", "ArrowRight", "+", "=", "-", "0"].includes(
            event.key,
          )
        )
          event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
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
        <div className="image-viewer-name"><h2 title={image.name}>{image.name || "文档图片"}</h2>{(decodedDimensions.width || dimensions.width) > 0 && <span className="image-viewer-dimensions">{decodedDimensions.width || dimensions.width} × {decodedDimensions.height || dimensions.height}</span>}</div>
        <div className="image-viewer-header-actions">
          <button
            type="button"
            className="btn-icon"
            aria-label="缩略图"
            aria-pressed={stripOpen}
            aria-expanded={stripOpen && images.length > 1}
            title={stripOpen ? "隐藏缩略图导航" : "显示缩略图导航"}
            onClick={() => {
              setStripOpen((value) => !value);
              localStorage.setItem("nr:imageFilmstrip", String(!stripOpen));
            }}
          >
            <ToolbarIcon name="image" />
          </button>
          <button
            type="button"
            className="btn-icon"
            ref={propertyTrigger}
            aria-label="图片属性"
            aria-expanded={propertiesOpen}
            title="图片属性"
            onClick={() => setPropertiesOpen((value) => !value)}
          >
            <ToolbarIcon name="info" />
          </button>
          <button
            ref={close}
            className="btn-icon"
            aria-label={
              presentation === "main" ? "返回原视图" : "关闭图片查看器"
            }
            title={
              presentation === "main" ? "返回原视图（Esc）" : "关闭图片查看器"
            }
            onClick={onClose}
          >
            <ToolbarIcon
              name={presentation === "main" ? "chevronLeft" : "close"}
            />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label={focused ? "退出图片专注模式" : "进入图片专注模式"}
            aria-pressed={focused}
            title={focused ? "退出专注模式" : "专注模式"}
            onClick={toggleFocus}
          >
            <ToolbarIcon name={focused ? "compress" : "expand"} />
          </button>
        </div>
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
        <span title="相对于原始像素的显示比例">
          {Math.round(zoom * fitScale * 100)}%
        </span>
        <button
          className="btn-icon"
          aria-label="放大图片"
          title="放大（+）"
          onClick={() => setZoom((value) => Math.min(12, value * 1.25))}
        >
          <ToolbarIcon name="plus" />
        </button>
        <button className="btn-icon" aria-label="适窗" title="适应窗口" onClick={reset}><ToolbarIcon name="compress" /></button>
        <button
          className="btn-icon" aria-label="原始尺寸"
          title="原始像素尺寸"
          onClick={() => {
            setOriginal(true);
            if (original) setZoom(1 / fitScale);
            setPan({ x: 0, y: 0 });
          }}
        >
          <ToolbarIcon name="actualSize" />
        </button>
        <button
          className="btn-icon"
          aria-label="旋转预览"
          title="旋转预览，不修改原图"
          onClick={() => {
            editPreview("rotate-right");
          }}
        >
          <ToolbarIcon name="rotate" />
        </button>
        <button
          className="btn-icon" aria-label="水平翻转"
          title="水平翻转，仅影响预览"
          aria-pressed={recipe.flipHorizontal}
          onClick={() => editPreview("flip-horizontal")}
        >
          <ToolbarIcon name="flipHorizontal" />
        </button>
        <button
          className="btn-icon" aria-label="垂直翻转"
          title="垂直翻转，仅影响预览"
          aria-pressed={recipe.flipVertical}
          onClick={() => editPreview("flip-vertical")}
        >
          <ToolbarIcon name="flipVertical" />
        </button>
        <button
          className="btn-icon" aria-label="复位预览"
          title="复位旋转、翻转、缩放和平移"
          onClick={() => {
            editPreview("reset");
            reset();
          }}
        >
          <ToolbarIcon name="refresh" />
        </button>
        <label className="image-background-control"><ToolbarIcon name="palette" /><select
          title="选择图片查看背景"
          aria-label="图片查看背景"
          value={background}
          onChange={(event) => {
            setBackground(event.target.value);
            localStorage.setItem("nr:imageBackground", event.target.value);
          }}
        >
          <option value="theme">主题背景</option>
          <option value="checker">透明棋盘格</option>
          <option value="dark">深色背景</option>
          <option value="light">浅色背景</option>
        </select></label>
        <button
          className="btn-icon"
          aria-label="复制图片"
          title="复制当前预览图片"
          disabled={
            !visibleResource ||
            !navigator.clipboard?.write ||
            typeof ClipboardItem === "undefined"
          }
          onClick={copy}
        >
          <ToolbarIcon name="copy" />
        </button>
        <button
          className="btn-icon" aria-label="插入当前文档"
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
          <ToolbarIcon name="plus" />
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
      <div className="image-viewer-body">
        <div
          ref={viewport}
          className="image-viewer-viewport"
          data-background={background}
          onDoubleClick={() => {
            if (original) reset();
            else {
              setOriginal(true);
              setZoom(1 / fitScale);
              setPan({ x: 0, y: 0 });
            }
          }}
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
              movePan((value) => ({
                x: value.x + after.x - pair.x,
                y: value.y + after.y - pair.y,
              }));
            } else
              movePan((value) => ({
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
          {visibleResource ? (
            <img
              ref={img}
              src={visibleResource}
              alt={image.name}
              draggable={false}
              onLoad={() => {
                if (img.current)
                  setDimensions({
                    width: img.current.naturalWidth,
                    height: img.current.naturalHeight,
                  });
                if (!decodedDimensions.width && img.current)
                  setDecodedDimensions({
                    width: img.current.naturalWidth,
                    height: img.current.naturalHeight,
                  });
              }}
              onError={() => setError("图片无法解码或文件已不可访问")}
              style={{
                width: dimensions.width
                  ? dimensions.width * fitScale
                  : undefined,
                height: dimensions.height
                  ? dimensions.height * fitScale
                  : undefined,
                maxWidth: dimensions.width ? "none" : undefined,
                maxHeight: dimensions.height ? "none" : undefined,
                transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom}) ${imageRecipeCss(recipe)}`,
              }}
            />
          ) : (
            !error && (
              <p className="image-viewer-loading" role="status">
                正在加载图片…
              </p>
            )
          )}
        </div>
        {propertiesOpen && (
          <ImagePropertiesPanel
            image={image}
            pinned={propertiesPinned}
            onPin={() => setPropertiesPinned((value) => !value)}
            onClose={closeProperties}
            dimensions={dimensions}
            decodedDimensions={decodedDimensions}
            zoom={zoom * fitScale}
            rotation={rotation}
          />
        )}
      </div>
      {stripOpen && images.length > 1 && (
        <div className="image-filmstrip-dock" data-pinned={stripPinned}>
        <div className="image-filmstrip-handle"><button type="button" className="btn-icon" aria-label={stripPinned ? "取消固定缩略图" : "固定缩略图"} title={stripPinned ? "取消固定缩略图" : "固定缩略图"} aria-pressed={stripPinned} onClick={() => {
          setStripPinned(!stripPinned); localStorage.setItem("nr:imageFilmstripPinned", String(!stripPinned));
        }}><ToolbarIcon name="pin" /></button></div>
        <ImageFilmstrip
          images={images}
          index={index}
          active={active}
          onSelect={(next) => {
            setOriginal(false);
            setIndex(next);
          }}
        />
        </div>
      )}
      {error && <footer><span role="status">{error}</span></footer>}
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
