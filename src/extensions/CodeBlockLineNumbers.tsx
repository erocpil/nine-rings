import { NodeViewWrapper, NodeViewContent } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";

/**
 * CodeBlock 的 NodeView 组件（参照 TipTap 官方 CodeBlockLanguage 示例）。
 *
 * DOM 结构：
 *   <NodeViewWrapper>    ← counter-increment, position:relative
 *     ::before            ← position:absolute, content:counter(prose-line)
 *     <div.code-block-inner>  ← display:flex（隔离 flex 布局）
 *       <div.code-block-gutter>  ← 内部行号
 *       <pre><NodeViewContent as="code" /></pre>
 *     </div>
 *   </NodeViewWrapper>
 */
function CodeBlockView() {
  const gutterRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => document.querySelector(".note-editor")?.classList.contains("show-code-line-numbers") ?? false
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = document.querySelector(".note-editor");
    if (!el) return;
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
    try {
      await navigator.clipboard.writeText(codeEl.textContent || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 忽略权限拒绝 */ }
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
      Enter: ({ editor }: { editor: any }) => {
        if (!editor.isActive('codeBlock')) return false;

        const { selection } = editor.state;
        const { $from } = selection;

        // 检查是否在代码块内
        const parent = $from.parent;
        if (parent.type.name !== 'codeBlock') return false;

        // 检查：下一个节点是代码块（相邻），或代码块是文档最后一个节点
        const posAfter = $from.after($from.depth);
        const resolved = editor.state.doc.resolve(posAfter);
        const nextNode = resolved.nodeAfter;
        const isAdjacentCodeBlock = nextNode && nextNode.type.name === 'codeBlock';
        const isLastBlock = !nextNode;
        if (!isAdjacentCodeBlock && !isLastBlock) return false;

        // 只处理 cursor 在代码块末尾的场景
        if ($from.parentOffset < parent.content.size) return false;

        // 关键：仅当上一行是空行时触发拆分（即已经按过一次回车）
        // 正常代码块内容不以 \n 结尾；首次回车添加 \n 后才会满足
        if (!parent.textContent.endsWith('\n')) return false;

        // 第二次回车：先去除代码块末尾的尾随空行，再插入段落分隔
        // deleteRange 后文档前移 1，插入位置用 blockEnd-1（即删除 \n 后的代码块末尾）
        const blockEnd = $from.end($from.depth);
        editor.chain().focus()
          .deleteRange({ from: blockEnd - 1, to: blockEnd })
          .insertContentAt(blockEnd - 1, { type: 'paragraph' })
          .run();
        return true;
      },
    };
  },
});
