import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";
import { CODE_LANGUAGE_OPTIONS, highlightCode, normalizeCodeLanguage } from "../lib/code-highlight";

const codeHighlightPluginKey = new PluginKey<DecorationSet>("codeSyntaxHighlight");
const codeLineNumbersPluginKey = new PluginKey<boolean>("codeLineNumbersEnabled");

interface TextSpan {
  node: Text;
  start: number;
  end: number;
}

function textPointAt(
  textSpans: readonly TextSpan[],
  absoluteOffset: number,
  preferNextNode: boolean,
): { node: Text; offset: number } | null {
  let low = 0;
  let high = textSpans.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = textSpans[middle];
    if (absoluteOffset < span.start) high = middle - 1;
    else if (absoluteOffset > span.end || (preferNextNode && absoluteOffset === span.end)) low = middle + 1;
    else return { node: span.node, offset: Math.max(0, absoluteOffset - span.start) };
  }
  const last = textSpans[textSpans.length - 1];
  return last ? { node: last.node, offset: last.node.data.length } : null;
}

/** 返回每个逻辑代码行实际占用的视觉行数（软换行可能大于 1）。 */
function measureCodeLineVisualRows(codeElement: HTMLElement, code: string): number[] {
  const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT);
  const textSpans: TextSpan[] = [];
  let textOffset = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current instanceof Text) {
      textSpans.push({ node: current, start: textOffset, end: textOffset + current.data.length });
      textOffset += current.data.length;
    }
  }
  if (textSpans.length === 0) return code.split("\n").map(() => 1);

  let lineStart = 0;
  return code.split("\n").map((line) => {
    const lineEnd = lineStart + line.length;
    const start = textPointAt(textSpans, lineStart, true);
    const end = textPointAt(textSpans, lineEnd, false);
    lineStart = lineEnd + 1;
    if (!line.length || !start || !end) return 1;

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const rowTops: number[] = [];
    for (const rect of range.getClientRects()) {
      if (rect.height <= 0) continue;
      if (!rowTops.some((top) => Math.abs(top - rect.top) < 2)) rowTops.push(rect.top);
    }
    return Math.max(1, rowTops.length);
  });
}

function equalRows(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

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

interface ChangedRange {
  from: number;
  to: number;
}

function changedRanges(transaction: Transaction): ChangedRange[] {
  const ranges: ChangedRange[] = [];
  transaction.mapping.maps.forEach((stepMap, index) => {
    const remaining = transaction.mapping.slice(index + 1);
    stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
      const from = remaining.map(newFrom, -1);
      const to = remaining.map(newTo, 1);
      ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
    });
  });
  return ranges;
}

function changedCodeBlocks(document: ProseMirrorNode, ranges: ChangedRange[]) {
  const blocks = new Map<number, ProseMirrorNode>();
  const addAncestors = (position: number) => {
    const clamped = Math.max(0, Math.min(document.content.size, position));
    const $position = document.resolve(clamped);
    for (let depth = $position.depth; depth > 0; depth -= 1) {
      const node = $position.node(depth);
      if (node.type.name === "codeBlock") {
        blocks.set($position.before(depth), node);
        break;
      }
    }
  };

  for (const range of ranges) {
    const from = Math.max(0, Math.min(document.content.size, range.from));
    const to = Math.max(from, Math.min(document.content.size, range.to));
    addAncestors(from);
    addAncestors(to);
    document.nodesBetween(Math.max(0, from - 1), Math.min(document.content.size, to + 1), (node, position) => {
      if (node.type.name === "codeBlock") blocks.set(position, node);
    });
  }
  return blocks;
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
  const code = node.textContent;
  const codeTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const wrapEnabled = node.attrs.wrap !== false;
  const lineCount = code.split("\n").length;
  const [lineNumbersEnabled, setLineNumbersEnabled] = useState(
    () => codeLineNumbersPluginKey.getState(editor.state) ?? false,
  );
  const [visualRows, setVisualRows] = useState<number[]>(() => Array(lineCount).fill(1));

  useEffect(() => {
    const syncLineNumbers = () => {
      const enabled = codeLineNumbersPluginKey.getState(editor.state) ?? false;
      setLineNumbersEnabled((current) => current === enabled ? current : enabled);
    };
    editor.on("transaction", syncLineNumbers);
    return () => {
      editor.off("transaction", syncLineNumbers);
    };
  }, [editor]);

  useEffect(() => {
    if (!lineNumbersEnabled) {
      setVisualRows((current) => current.length === lineCount && current.every((rows) => rows === 1)
        ? current
        : Array(lineCount).fill(1));
      return;
    }
    const codeElement = wrapperRef.current?.querySelector<HTMLElement>("code");
    if (!codeElement) return;
    let frame = 0;
    let cancelled = false;
    const measure = () => {
      frame = 0;
      if (cancelled) return;
      const measured = measureCodeLineVisualRows(codeElement, code);
      setVisualRows((current) => equalRows(current, measured) ? current : measured);
    };
    const scheduleMeasure = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };

    // 首屏先显示正文，下一绘制帧再读取软换行几何。旧实现对每个代码块
    // 使用 layout effect 同步逐行测量，即使行号处于关闭状态也会阻塞 WebKit。
    scheduleMeasure();
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(codeElement);
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(codeElement, { childList: true, characterData: true, subtree: true });
    void document.fonts?.ready.then(scheduleMeasure);

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
    };
  }, [code, lineCount, lineNumbersEnabled]);

  useEffect(() => {
    const syncEditable = () => setEditable(editor.isEditable);
    syncEditable();
    // 文档更新不会改变只读状态。观察根节点属性可避免每个代码块都在
    // 每次输入时收到一次 editor update 回调。
    const observer = new MutationObserver(syncEditable);
    observer.observe(editor.view.dom, { attributes: true, attributeFilter: ["contenteditable"] });
    return () => {
      observer.disconnect();
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
      data-code-wrap={wrapEnabled ? "true" : "false"}
    >
      <div ref={wrapperRef}>
        <div
          className="code-block-toolbar"
          data-pdf-exclude
          contentEditable={false}
        >
          <input
            className="code-block-title"
            value={codeTitle}
            placeholder="代码简介（可选）"
            disabled={!editable}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => updateAttributes({ title: event.target.value })}
            aria-label="代码简介"
          />
          <div className="code-block-actions">
            <select
              className="code-block-language"
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
              className={`code-block-wrap-toggle ${wrapEnabled ? "active" : ""}`}
              disabled={!editable}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ wrap: !wrapEnabled })}
              type="button"
              aria-label={wrapEnabled ? "关闭代码自动换行" : "开启代码自动换行"}
              aria-pressed={wrapEnabled}
              title={wrapEnabled ? "自动换行：开" : "自动换行：关"}
            >换行</button>
            <button
              className="code-block-copy"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleCopy}
              type="button"
              title="复制代码"
              aria-label="复制代码"
            >
              {copied ? "已复制" : "⎘"}
            </button>
          </div>
        </div>
        <div className="code-block-inner">
          <div
            className="code-block-gutter"
            contentEditable={false}
            suppressContentEditableWarning
          >
            {lineNumbersEnabled && Array.from({ length: lineCount }, (_, index) => (
              <span
                key={index}
                // iOS WebKit 在 contenteditable NodeView 中有时会忽略逻辑
                // block-size，导致软换行后仍按单行高度排列并丢失末尾行号。
                // 代码块固定为横向书写，使用物理 height 更可靠。
                style={{ height: `${(visualRows[index] ?? 1) * 1.5}em` }}
              >{index + 1}</span>
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

interface CodeBlockLineNumberOptions {
  lineNumbersEnabled: boolean;
}

export const CodeBlockLineNumbers = Node.create<CodeBlockLineNumberOptions>({
  name: "codeBlock",

  addOptions() {
    return { lineNumbersEnabled: false };
  },

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
      title: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-code-title") || "",
        renderHTML: (attributes) => attributes.title
          ? { "data-code-title": attributes.title }
          : {},
      },
      wrap: {
        default: true,
        parseHTML: (element) => element.getAttribute("data-code-wrap") !== "false",
        renderHTML: (attributes) => attributes.wrap === false
          ? { "data-code-wrap": "false" }
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
    return [new Plugin<boolean>({
      key: codeLineNumbersPluginKey,
      state: {
        init: () => this.options.lineNumbersEnabled,
        apply(transaction, previous) {
          const requested = transaction.getMeta(codeLineNumbersPluginKey);
          return typeof requested === "boolean" ? requested : previous;
        },
      },
    }), new Plugin<DecorationSet>({
      key: codeHighlightPluginKey,
      state: {
        init: (_, state) => createCodeHighlightDecorationSet(state.doc),
        apply: (transaction, previous, _oldState, newState) => {
          if (!transaction.docChanged) return previous;
          let decorations = previous.map(transaction.mapping, transaction.doc);
          const ranges = changedRanges(transaction);
          const blocks = changedCodeBlocks(newState.doc, ranges);

          // 普通段落中的输入无需扫描全文，也无需重建任何高亮。
          if (blocks.size === 0) {
            const stale = ranges.flatMap(({ from, to }) => decorations.find(
              Math.max(0, from - 1),
              Math.min(newState.doc.content.size, Math.max(from + 1, to + 1)),
              (spec) => spec.codeSyntaxHighlight === true,
            ));
            return stale.length > 0 ? decorations.remove(stale) : decorations;
          }

          const additions: Decoration[] = [];
          for (const [position, node] of blocks) {
            const existing = decorations.find(
              position,
              position + node.nodeSize,
              (spec) => spec.codeSyntaxHighlight === true,
            );
            if (existing.length > 0) decorations = decorations.remove(existing);
            additions.push(...codeHighlightDecorations(node, position));
          }

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

export function setCodeBlockLineNumbersEnabled(editor: Editor, enabled: boolean): void {
  const current = codeLineNumbersPluginKey.getState(editor.state) ?? false;
  if (current === enabled) return;
  editor.view.dispatch(editor.state.tr.setMeta(codeLineNumbersPluginKey, enabled));
}
