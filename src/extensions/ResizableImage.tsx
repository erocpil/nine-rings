/**
 * ResizableImage — TipTap 图片扩展，支持拖拽右下角调整大小
 * 双击恢复原始尺寸
 */

import React, { useCallback, useRef, useState } from "react";
import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";

// ── React NodeView 组件 ──

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragStart = useRef<{ x: number; w: number } | null>(null);

  const currentWidth = dragWidth ?? (node.attrs.width ? parseInt(node.attrs.width as string, 10) : null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    dragStart.current = { x: e.clientX, w: img.offsetWidth };
    setDragWidth(img.offsetWidth);

    const onMove = (ev: MouseEvent) => {
      if (!dragStart.current) return;
      const delta = ev.clientX - dragStart.current.x;
      const newW = Math.max(60, dragStart.current.w + delta);
      setDragWidth(newW);
    };
    const onUp = () => {
      if (dragStart.current && imgRef.current) {
        const finalW = imgRef.current.offsetWidth;
        updateAttributes({ width: `${finalW}px` });
      }
      dragStart.current = null;
      setDragWidth(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [updateAttributes]);

  // 双击恢复原始大小
  const onDoubleClick = useCallback(() => {
    updateAttributes({ width: null });
  }, [updateAttributes]);

  return (
    <NodeViewWrapper className="resizable-image-wrapper" data-selected={selected ? "true" : undefined}>
      <img
        ref={imgRef}
        src={node.attrs.src as string}
        alt={(node.attrs.alt as string) ?? ""}
        title={(node.attrs.title as string) ?? ""}
        style={currentWidth ? { width: currentWidth, maxWidth: "100%" } : { maxWidth: "100%" }}
        onDoubleClick={onDoubleClick}
        draggable={false}
      />
      <span
        className="resize-handle"
        onMouseDown={onMouseDown}
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

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
