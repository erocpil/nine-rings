import Blockquote from "@tiptap/extension-blockquote";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRef } from "react";

export const blockquoteFoldTransactionMeta = "nine-rings:blockquote-fold";

function CollapsibleBlockquoteView({ node, editor, getPos }: NodeViewProps) {
  const collapsed = node.attrs.collapsed === true;
  const suppressClickUntilRef = useRef(0);
  const lastTouchActionAtRef = useRef(0);
  const touchRef = useRef<{ identifier: number; x: number; y: number; moved: boolean } | null>(null);
  const toggle = () => {
    if (editor.isDestroyed) return;
    const position = getPos();
    if (typeof position !== "number") return;
    const current = editor.state.doc.nodeAt(position);
    if (!current || current.type.name !== "blockquote") return;
    // 直接基于当前节点提交事务，避免 React NodeView 闭包中的 collapsed
    // 在后台恢复或连续触摸时过期；折叠属于阅读操作，只读文档也允许切换。
    editor.view.dispatch(
      editor.state.tr
        .setNodeMarkup(position, undefined, {
          ...current.attrs,
          collapsed: current.attrs.collapsed !== true,
        })
        .setMeta(blockquoteFoldTransactionMeta, true),
    );
  };

  return (
    <NodeViewWrapper
      className="blockquote-node-view"
    >
      <div className="blockquote-toolbar" data-pdf-exclude contentEditable={false}>
        <span>引用</span>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onTouchStart={(event) => {
            const touch = event.changedTouches[0];
            if (!touch) return;
            touchRef.current = {
              identifier: touch.identifier,
              x: touch.clientX,
              y: touch.clientY,
              moved: false,
            };
          }}
          onTouchMove={(event) => {
            const gesture = touchRef.current;
            if (!gesture) return;
            const touch = Array.from(event.touches)
              .find((item) => item.identifier === gesture.identifier);
            if (!touch || Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 12) {
              gesture.moved = true;
            }
          }}
          onTouchCancel={() => { touchRef.current = null; }}
          onTouchEnd={(event) => {
            const gesture = touchRef.current;
            touchRef.current = null;
            if (!gesture || gesture.moved) return;
            const touch = Array.from(event.changedTouches)
              .find((item) => item.identifier === gesture.identifier);
            if (!touch || Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 12) return;
            const now = Date.now();
            if (now - lastTouchActionAtRef.current < 32) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            lastTouchActionAtRef.current = now;
            suppressClickUntilRef.current = now + 500;
            toggle();
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch") return;
            event.preventDefault();
            event.stopPropagation();
            const now = Date.now();
            if (now - lastTouchActionAtRef.current < 32) return;
            lastTouchActionAtRef.current = now;
            suppressClickUntilRef.current = now + 500;
            toggle();
          }}
          onClick={() => {
            if (Date.now() < suppressClickUntilRef.current) return;
            toggle();
          }}
          aria-label={collapsed ? "展开引用块" : "折叠引用块"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开引用块" : "折叠引用块"}
        ><span className="blockquote-fold-icon" aria-hidden="true">{collapsed ? "▶" : "▼"}</span></button>
      </div>
      <NodeViewContent className="blockquote-content" />
    </NodeViewWrapper>
  );
}

export const CollapsibleBlockquote = Blockquote.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
        renderHTML: (attributes) => attributes.collapsed
          ? { "data-collapsed": "true" }
          : {},
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CollapsibleBlockquoteView, {
      as: "blockquote",
      className: "blockquote-wrap",
      attrs: ({ node }) => ({
        ...(node.attrs.indent > 0 ? { "data-indent": String(node.attrs.indent) } : {}),
        "data-collapsed": node.attrs.collapsed === true ? "true" : "false",
      }),
    });
  },
});
