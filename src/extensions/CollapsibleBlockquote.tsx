import Blockquote from "@tiptap/extension-blockquote";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";

function CollapsibleBlockquoteView({ node, editor, updateAttributes }: NodeViewProps) {
  const collapsed = node.attrs.collapsed === true;

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
          onClick={() => updateAttributes({ collapsed: !collapsed })}
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
