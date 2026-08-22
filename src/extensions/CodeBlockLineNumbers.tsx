import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
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
function CodeBlockView() {
  const gutterRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // 必须绑定当前 NodeView 所属编辑器；全局 querySelector 在分栏或多个
    // 编辑器实例并存时会读取到另一个编辑器的显示状态。
    const el = wrapperRef.current?.closest(".note-editor");
    if (!el) return;
    setVisible(el.classList.contains("show-code-line-numbers"));
    const observer = new MutationObserver(() => {
      setVisible(el.classList.contains("show-code-line-numbers"));
    });
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // 同步 gutter 行号（监听 code 元素内容变化）
  useEffect(() => {
    if (!visible || !gutterRef.current) return;
    const wrapper = gutterRef.current.closest(".code-block-wrap");
    const codeEl = wrapper?.querySelector("code");
    if (!codeEl) return;

    const sync = () => {
      if (!gutterRef.current) return;
      const lines = (codeEl.textContent || "").split("\n");
      gutterRef.current.innerHTML = lines
        .map((_: string, i: number) => `<span>${i + 1}</span>`)
        .join("");
    };
    sync();

    const mo = new MutationObserver(sync);
    mo.observe(codeEl, { characterData: true, subtree: true, childList: true });
    return () => mo.disconnect();
  }, [visible]);

  const handleCopy = async () => {
    const codeEl = wrapperRef.current?.querySelector("code");
    if (!codeEl) return;
    await copyToClipboard(codeEl.textContent || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <NodeViewWrapper className={`code-block-wrap ${visible ? "show-numbers" : ""}`}>
      <div ref={wrapperRef}>
        <button
          className="code-block-copy"
          contentEditable={false}
          onClick={handleCopy}
          type="button"
          title="复制代码"
        >
          {copied ? "已复制" : "⎘"}
        </button>
        <div className="code-block-inner">
          <div
            ref={gutterRef}
            className="code-block-gutter"
            contentEditable={false}
            suppressContentEditableWarning
          />
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
