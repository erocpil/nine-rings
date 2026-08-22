import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { useRef, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";

/**
 * CodeBlock 的 NodeView 组件（参照 TipTap 官方 CodeBlockLanguage 示例）。
 *
 * DOM 结构：
 *   <NodeViewWrapper>     ← 作为主编辑器块级 gutter 的测量节点
 *     <div.code-block-inner>  ← display:flex（隔离 flex 布局）
 *       <div.code-block-gutter>  ← 内部行号
 *       <pre><NodeViewContent as="code" /></pre>
 *     </div>
 *   </NodeViewWrapper>
 */
function CodeBlockView({ node }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const lineCount = node.textContent.split("\n").length;

  const handleCopy = async () => {
    const codeEl = wrapperRef.current?.querySelector("code");
    if (!codeEl) return;
    await copyToClipboard(codeEl.textContent || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <NodeViewWrapper
      className="code-block-wrap"
      data-indent={node.attrs.indent > 0 ? node.attrs.indent : undefined}
    >
      <div ref={wrapperRef}>
        <button
          className="code-block-copy"
          data-pdf-exclude
          contentEditable={false}
          onClick={handleCopy}
          type="button"
          title="复制代码"
        >
          {copied ? "已复制" : "⎘"}
        </button>
        <div className="code-block-inner">
          <div
            className="code-block-gutter"
            contentEditable={false}
            suppressContentEditableWarning
          >
            {Array.from({ length: lineCount }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
          <pre>
            <NodeViewContent as="code" />
          </pre>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export { CodeBlockView };

import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

export const CodeBlockLineNumbers = Node.create({
  name: "codeBlock",

  group: "block",
  content: "text*",
  defining: true,
  marks: "",
  code: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-language") || null,
        renderHTML: (attributes) => attributes.language
          ? { "data-language": attributes.language }
          : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "pre" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["pre", HTMLAttributes, ["code", 0]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': ({ editor }: { editor: any }) => {
        if (editor.isActive('codeBlock')) {
          editor.chain().focus().setNode('paragraph').run();
        } else {
          editor.chain().focus().setNode('codeBlock').run();
        }
        return true;
      },
    };
  },
});
