import { imageDimensionPixels } from "../lib/markdown-image-dimensions";
import { DocumentImageLibraryContext, DocumentResourceContext } from "../components/DocumentResourceContext";
import { documentImages } from "../lib/image-library/document-images";
import { requestImageView } from "../lib/image-library/viewer-request";
import { workspacePanels } from "../lib/plugin-system/panel-registry";
import { ToolbarIcon } from "../components/ToolbarIcon";
/**
 * ResizableImage — TipTap 图片扩展，支持拖拽右下角调整大小
 * 双击恢复原始尺寸
 */

import React, { useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { getImageUrl } from "../lib/storage/db-images";
import { useCompactImage } from "../hooks/useCompactImage";
import { isDirectMarkdownImageSource } from "../lib/local-files/browser-preview";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    resizableImage: {
      setResizableImage: (attributes: {
        src: string;
        alt?: string | null;
        title?: string | null;
        width?: string | null;
      }) => ReturnType;
    };
  }
}

// ── React NodeView 组件 ──

function ResizableImageView({ node, updateAttributes, selected, editor }: NodeViewProps) {
  const imagePanels = useSyncExternalStore(workspacePanels.subscribe, workspacePanels.getSnapshot);
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStart = useRef<{ pointerId: number; x: number; w: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const imageTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const rawSrc = node.attrs.src as string;
  const resolveResource = useContext(DocumentResourceContext);
  const allowLibrary = useContext(DocumentImageLibraryContext);
  const libraryImage = rawSrc?.startsWith("nr-image://");
  const [resolved, setResolved] = useState<{ raw: string; resolver: typeof resolveResource; uri: string }>();

  useEffect(() => {
    if (!rawSrc || (libraryImage ? !allowLibrary : !resolveResource)) return;
    let cancelled = false;
    let owned: string | null = null;
    const request = libraryImage ? getImageUrl(rawSrc) : resolveResource!(rawSrc);
    void request.then(value => {
      if (cancelled) {
        if (libraryImage && value) URL.revokeObjectURL(value);
        return;
      }
      if (libraryImage) owned = value;
      setResolved({ raw: rawSrc, resolver: resolveResource, uri: value ?? (libraryImage ? "" : rawSrc) });
    }, () => { if (!cancelled) setResolved({ raw: rawSrc, resolver: resolveResource, uri: "" }); });
    return () => {
      cancelled = true;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [rawSrc, resolveResource, allowLibrary, libraryImage]);

  const displaySrc = libraryImage && !allowLibrary ? ""
    : (libraryImage || resolveResource)
      ? resolved?.raw === rawSrc && resolved.resolver === resolveResource ? resolved.uri : ""
      : rawSrc;

  const openImage = async () => {
    const images = documentImages(editor.getJSON());
    const index = images.findIndex(image => image.src === rawSrc);
    const gallery = await Promise.all(images.map(async image => ({
      ...image,
      src: image.src.startsWith("nr-image://")
        ? allowLibrary ? image.src : ""
        : resolveResource ? await resolveResource(image.src).catch(() => "") ?? image.src : image.src,
    })));
    const current = gallery[index];
    if (current?.src) requestImageView(current, gallery.filter(image => image.src));
  };
  const compact = useCompactImage(imgRef, displaySrc, imagePanels.length > 0);

  const currentWidth = dragWidth ?? (node.attrs.width ? parseInt(node.attrs.width as string, 10) : null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (editor.isDestroyed || !editor.isEditable || dragStart.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const pointerId = e.pointerId;
    dragStart.current = { pointerId, x: e.clientX, w: img.offsetWidth };
    setDragWidth(img.offsetWidth);
    document.body.style.userSelect = "none";
    document.body.style.webkitUserSelect = "none";
    try {
      e.currentTarget.setPointerCapture(pointerId);
    } catch {
      // Synthetic events and older WebViews may not expose an active pointer to capture.
    }

    const onMove = (ev: PointerEvent) => {
      if (!dragStart.current || ev.pointerId !== pointerId) return;
      if (editor.isDestroyed || !editor.isEditable) { cleanup(); return; }
      if (ev.cancelable) ev.preventDefault();
      const delta = ev.clientX - dragStart.current.x;
      const newW = Math.max(60, dragStart.current.w + delta);
      setDragWidth(newW);
    };
    const cleanup = () => {
      dragStart.current = null;
      setDragWidth(null);
      document.body.style.userSelect = "";
      document.body.style.webkitUserSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      readonlyObserver.disconnect();
      dragCleanupRef.current = null;
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) ev.preventDefault();
      if (ev.type === "pointerup" && !editor.isDestroyed && editor.isEditable && dragStart.current && imgRef.current) {
        const finalW = imgRef.current.offsetWidth;
        updateAttributes({ width: `${finalW}px`, height: null });
      }
      cleanup();
    };
    // setEditable(..., false) changes the DOM without a document update.
    // Observe only while dragging, so readonly immediately cancels a preview
    // without subscribing every image to every editor transaction.
    const readonlyObserver = new MutationObserver(() => {
      if (editor.isDestroyed || !editor.isEditable) cleanup();
    });
    readonlyObserver.observe(editor.view.dom, { attributes: true, attributeFilter: ["contenteditable"] });
    dragCleanupRef.current = cleanup;
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, [editor, updateAttributes]);

  // 双击恢复原始大小
  const onDoubleClick = useCallback(() => {
    if (editor.isDestroyed || !editor.isEditable) return;
    updateAttributes({ width: null, height: null });
  }, [editor, updateAttributes]);

  const onImagePointerUp = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    if (editor.isDestroyed || !editor.isEditable) { imageTapRef.current = null; return; }
    if (event.pointerType === "mouse") return;
    const now = Date.now();
    const previous = imageTapRef.current;
    imageTapRef.current = { at: now, x: event.clientX, y: event.clientY };
    if (!previous
      || now - previous.at > 360
      || Math.hypot(event.clientX - previous.x, event.clientY - previous.y) > 20) return;
    event.preventDefault();
    event.stopPropagation();
    imageTapRef.current = null;
    updateAttributes({ width: null, height: null });
  }, [editor, updateAttributes]);

  return (
    <NodeViewWrapper as={node.isInline ? "span" : "div"} className={`resizable-image-wrapper${node.isInline ? " markdown-inline-image" : ""}`} data-selected={selected ? "true" : undefined} data-image-compact={compact || undefined}>
      {displaySrc ? <img
        ref={imgRef}
        src={displaySrc}
        alt={(node.attrs.alt as string) ?? ""}
        title={(node.attrs.title as string) ?? ""}
        style={{ width: currentWidth ?? undefined, height: dragWidth === null ? imageDimensionPixels(node.attrs.height) : undefined, maxWidth: "100%" }}
        onDoubleClick={onDoubleClick}
        onPointerUp={onImagePointerUp}
        draggable={false}
      /> : <span>{node.attrs.alt || "图片"}</span>}
      {displaySrc && imagePanels.length > 0 && <button type="button" contentEditable={false} className="btn-icon document-image-view-button" aria-label="查看图片" title="查看图片" onClick={event => {event.preventDefault();event.stopPropagation();void openImage();}}><ToolbarIcon name="image" /></button>}
      {displaySrc && <span
        className="resize-handle"
        onPointerDown={onResizePointerDown}
        title="拖拽调整大小 · 双击恢复原始尺寸"
      />}
    </NodeViewWrapper>
  );
}

// ── TipTap Node 定义 ──

export const ResizableImage = Node.create<{ authorizeSourceInNodeView: boolean }>({
  name: "resizableImage",
  group: "block",
  inline: false,
  draggable: true,

  addOptions() {
    return { authorizeSourceInNodeView: false };
  },

  addAttributes() {
    return {
      src: { default: null, parseHTML: element => element.getAttribute("data-document-image-src") ?? element.getAttribute("src") },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null, parseHTML: element => imageDimensionPixels(element.getAttribute("height")) ?? null },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }, { tag: "img[data-document-image-src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { width, height, src, ...attrs } = HTMLAttributes;
    const style = imageStyle(width, height);
    // ProseMirror can materialize this DOM before React attaches the NodeView.
    const source = this.options.authorizeSourceInNodeView && src && !isDirectMarkdownImageSource(src) ? { "data-document-image-src": src } : { src };
    return ["img", { ...attrs, ...source, height, style }];
  },

  addCommands() {
    return {
      setResizableImage: (attributes) => ({ commands }) => commands.insertContent({
        type: this.name,
        attrs: attributes,
      }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

/** Markdown images can occur inside text, links, lists and table cells. */
export const MarkdownImage = ResizableImage.extend({
  name: "markdownImage", group: "inline", inline: true,
  parseHTML() { return [{ tag: "img[data-markdown-inline]" }]; },
  renderHTML({ HTMLAttributes }) {
    const { width, height, src, ...attrs } = HTMLAttributes;
    const source = this.options.authorizeSourceInNodeView && src && !isDirectMarkdownImageSource(src) ? { "data-document-image-src": src } : { src };
    return ["img", { ...attrs, ...source, height, style: imageStyle(width, height) || undefined, "data-markdown-inline": "" }];
  },
});

function imageStyle(width: unknown, height: unknown): string {
  const pixels = imageDimensionPixels(height);
  return `${width ? `width: ${width};` : ""}${pixels ? `height: ${pixels}px;` : ""}`;
}
