import Blockquote from "@tiptap/extension-blockquote";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useRef } from "react";

function CollapsibleBlockquoteView({ node, editor, updateAttributes }: NodeViewProps) {
  const collapsed = node.attrs.collapsed === true;
  const suppressClickRef = useRef(false);
  const toggle = () => updateAttributes({ collapsed: !collapsed });

  return (
    <NodeViewWrapper
      className="blockquote-node-view"
    >
      <div className="blockquote-toolbar" data-pdf-exclude contentEditable={false}>
        <span>引用</span>
        <button
          type="button"
          disabled={!editor.isEditable}
          onMouseDown={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            if (event.pointerType !== "touch") return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onPointerUp={(event) => {
            if (event.pointerType !== "touch") return;
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = true;
            toggle();
            window.setTimeout(() => { suppressClickRef.current = false; }, 500);
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            toggle();
          }}
          aria-label={collapsed ? "展开引用块" : "折叠引用块"}
          aria-expanded={!collapsed}
          title={collapsed ? "展开引用块" : "折叠引用块"}
        >{collapsed ? "▶" : "▼"}</button>
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
