/**
 * ResizableImage — TipTap 图片扩展，支持拖拽右下角调整大小
 * 双击恢复原始尺寸
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { getImageUrl } from "../lib/storage/db-images";

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

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStart = useRef<{ pointerId: number; x: number; w: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const imageTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const rawSrc = node.attrs.src as string;

  // 解析 nr-image:// 引用为 Object URL
  useEffect(() => {
    if (!rawSrc || !rawSrc.startsWith("nr-image://")) {
      setResolvedSrc(rawSrc);
      return;
    }
    let cancelled = false;
    getImageUrl(rawSrc).then((url) => {
      if (cancelled) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      objectUrlRef.current = url;
      setResolvedSrc(url || rawSrc);
    });
    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [rawSrc]);

  const displaySrc = resolvedSrc ?? rawSrc;

  const currentWidth = dragWidth ?? (node.attrs.width ? parseInt(node.attrs.width as string, 10) : null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLSpanElement>) => {
    if (dragStart.current || (e.pointerType === "mouse" && e.button !== 0)) return;
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
      dragCleanupRef.current = null;
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (ev.cancelable) ev.preventDefault();
      if (dragStart.current && imgRef.current) {
        const finalW = imgRef.current.offsetWidth;
        updateAttributes({ width: `${finalW}px` });
      }
      cleanup();
    };
    dragCleanupRef.current = cleanup;
    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  }, [updateAttributes]);

  // 双击恢复原始大小
  const onDoubleClick = useCallback(() => {
    updateAttributes({ width: null });
  }, [updateAttributes]);

  const onImagePointerUp = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
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
    updateAttributes({ width: null });
  }, [updateAttributes]);

  return (
    <NodeViewWrapper className="resizable-image-wrapper" data-selected={selected ? "true" : undefined}>
      <img
        ref={imgRef}
        src={displaySrc ?? ""}
        alt={(node.attrs.alt as string) ?? ""}
        title={(node.attrs.title as string) ?? ""}
        style={currentWidth ? { width: currentWidth, maxWidth: "100%" } : { maxWidth: "100%" }}
        onDoubleClick={onDoubleClick}
        onPointerUp={onImagePointerUp}
        draggable={false}
      />
      <span
        className="resize-handle"
        onPointerDown={onResizePointerDown}
        title="拖拽调整大小 · 双击恢复原始尺寸"
      />
    </NodeViewWrapper>
  );
}

// ── TipTap Node 定义 ──

export const ResizableImage = Node.create({
  name: "resizableImage",
  group: "block",
  inline: false,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { width, ...attrs } = HTMLAttributes;
    const style = width ? `width: ${width};` : "";
    return ["img", { ...attrs, style }];
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
