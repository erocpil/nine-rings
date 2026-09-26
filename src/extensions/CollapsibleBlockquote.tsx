import Blockquote from "@tiptap/extension-blockquote";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useState } from "react";
import { openBlockWorkspace } from "../lib/block-workspace";
import { BlockquoteToolbar } from "../components/BlockquoteToolbar";
import { editorReadingBlocks } from "./ReadingBlockSession";

export const blockquoteFoldTransactionMeta = "nine-rings:blockquote-fold";

function CollapsibleBlockquoteView({ node, editor, getPos }: NodeViewProps) {
  const [readingCollapsed, setReadingCollapsed] = useState<boolean | null>(() => {
    const pos = getPos();
    return typeof pos === "number" ? editorReadingBlocks(editor)?.get(pos)?.collapsed ?? null : null;
  });
  const collapsed = readingCollapsed ?? node.attrs.collapsed === true;
  const toggle = () => {
    if (editor.isDestroyed) return;
    const nextCollapsed = !collapsed;
    const position = getPos();
    if (typeof position === "number") {
      editorReadingBlocks(editor)?.set(position, {
        ...editorReadingBlocks(editor)?.get(position),
        collapsed: nextCollapsed,
      });
    }
    if (!editor.isEditable && editor.view.dom.closest(".block-workspace")) {
      setReadingCollapsed(nextCollapsed);
      return;
    }
    setReadingCollapsed(nextCollapsed);
    if (typeof position !== "number") return;
    const current = editor.state.doc.nodeAt(position);
    if (!current || current.type.name !== "blockquote") return;
    // 直接基于当前节点提交事务，避免 React NodeView 闭包中的 collapsed
    // 在后台恢复或连续触摸时过期；折叠属于阅读操作，只读文档也允许切换。
    editor.view.dispatch(
      editor.state.tr
        .setNodeMarkup(position, undefined, {
          ...current.attrs,
          collapsed: nextCollapsed,
        })
        .setMeta(blockquoteFoldTransactionMeta, true),
    );
  };

  return (
    <NodeViewWrapper
      className="blockquote-node-view"
      data-workspace-collapsed={readingCollapsed === null ? undefined : String(readingCollapsed)}
    >
      <BlockquoteToolbar text={node.textContent} collapsed={collapsed} toggle={toggle}
        onOpen={event => openBlockWorkspace(editor, getPos(), event.currentTarget)} />
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
        "data-indent": String(node.attrs.indent ?? 0),
        "data-collapsed": node.attrs.collapsed === true ? "true" : "false",
      }),
    });
  },
});
