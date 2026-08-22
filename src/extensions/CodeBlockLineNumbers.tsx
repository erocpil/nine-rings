import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";
import { CODE_LANGUAGE_OPTIONS, highlightCode, normalizeCodeLanguage } from "../lib/code-highlight";

const codeHighlightPluginKey = new PluginKey<DecorationSet>("codeSyntaxHighlight");

function codeHighlightDecorations(node: ProseMirrorNode, position: number): Decoration[] {
  const language = normalizeCodeLanguage(node.attrs.language);
  if (!language) return [];
  const decorations: Decoration[] = [Decoration.node(
    position,
    position + node.nodeSize,
    { class: "code-syntax-highlighted", "data-code-language": language },
    { codeSyntaxHighlight: true },
  )];
  for (const token of highlightCode(node.textContent, language)) {
    decorations.push(Decoration.inline(
      position + 1 + token.from,
      position + 1 + token.to,
      { class: token.classes.join(" ") },
      { codeSyntaxHighlight: true },
    ));
  }
  return decorations;
}

function createCodeHighlightDecorationSet(document: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  document.descendants((node, position) => {
    if (node.type.name === "codeBlock") decorations.push(...codeHighlightDecorations(node, position));
  });
  return DecorationSet.create(document, decorations);
}

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
function CodeBlockView({ node, editor, updateAttributes }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [editable, setEditable] = useState(editor.isEditable);
  const lineCount = node.textContent.split("\n").length;

  useEffect(() => {
    const syncEditable = () => setEditable(editor.isEditable);
    editor.on("update", syncEditable);
    syncEditable();
    return () => {
      editor.off("update", syncEditable);
    };
  }, [editor]);

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
        <select
          className="code-block-language"
          data-pdf-exclude
          contentEditable={false}
          disabled={!editable}
          value={normalizeCodeLanguage(node.attrs.language) ?? ""}
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => {
            if (!editor.isEditable) return;
            updateAttributes({ language: event.target.value || null });
          }}
          aria-label="代码语言"
          title="代码语言 / 语法高亮"
        >
          {CODE_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.value || "plaintext"} value={option.value}>{option.label}</option>
          ))}
        </select>
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

  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: codeHighlightPluginKey,
      state: {
        init: (_, state) => createCodeHighlightDecorationSet(state.doc),
        apply: (transaction, previous, oldState, newState) => {
          if (!transaction.docChanged) return previous;
          let decorations = previous.map(transaction.mapping, transaction.doc);
          const inverseMapping = transaction.mapping.invert();
          const additions: Decoration[] = [];

          transaction.doc.descendants((node, position) => {
            if (node.type.name !== "codeBlock") return;
            const existing = decorations.find(
              position,
              position + node.nodeSize,
              (spec) => spec.codeSyntaxHighlight === true,
            );
            const oldPosition = inverseMapping.map(position, 1);
            const oldNode = oldState.doc.nodeAt(oldPosition);
            const unchanged = oldNode?.type.name === "codeBlock" && oldNode.eq(node);
            const shouldHighlight = normalizeCodeLanguage(node.attrs.language) !== null;
            if (unchanged && (shouldHighlight ? existing.length > 0 : existing.length === 0)) return;
            if (existing.length > 0) decorations = decorations.remove(existing);
            additions.push(...codeHighlightDecorations(node, position));
          });

          return additions.length > 0 ? decorations.add(newState.doc, additions) : decorations;
        },
      },
      props: {
        decorations(state) {
          return codeHighlightPluginKey.getState(state) ?? null;
        },
      },
    })];
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
