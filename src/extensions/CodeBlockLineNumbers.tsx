import { NodeViewWrapper, NodeViewContent, type NodeViewProps } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEffect, useRef, useState } from "react";
import { copyToClipboard } from "../lib/clipboard";
import { openBlockWorkspace } from "../lib/block-workspace";
import { ToolbarIcon } from "../components/ToolbarIcon";
import { BLOCK_WORKSPACE_DISPLAY_EVENT, blockWorkspacePreferences, saveBlockWorkspacePreferences } from "../lib/block-display-settings";
import { CODE_LANGUAGE_OPTIONS, highlightCode, normalizeCodeLanguage } from "../lib/code-highlight";

const codeHighlightPluginKey = new PluginKey<DecorationSet>("codeSyntaxHighlight");
export const codeLineNumbersPluginKey = new PluginKey<boolean>("codeLineNumbersEnabled");
const codeBlockDefaultWrapPluginKey = new PluginKey<boolean>("codeBlockDefaultWrap");

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

/** Measure logical-line advances in pixels, including wrapped/empty lines.
 * Glyph rectangles are not visual rows: WebKit returns extra zero-width
 * newline rectangles, and fallback fonts can change actual line-box height. */
function measureCodeLineHeights(codeElement: HTMLElement, code: string): number[] {
  const style = getComputedStyle(codeElement);
  const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
  const walker = document.createTreeWalker(codeElement, NodeFilter.SHOW_TEXT);
  const textSpans: TextSpan[] = [];
  let textOffset = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current instanceof Text && !current.parentElement?.closest(".workspace-ws-newline")) {
      textSpans.push({ node: current, start: textOffset, end: textOffset + current.data.length });
      textOffset += current.data.length;
    }
  }
  if (textSpans.length === 0) return code.split("\n").map(() => lineHeight);

  let lineStart = 0;
  const lines = code.split("\n");
  const tops: number[] = [];
  const ends: number[] = [];
  lines.forEach((line) => {
    const lineEnd = lineStart + line.length;
    const start = textPointAt(textSpans, lineStart, true);
    const end = textPointAt(textSpans, lineEnd, false);
    lineStart = lineEnd + 1;
    if (!line.length || !start || !end) { tops.push(NaN); ends.push(NaN); return; }

    const range = document.createRange();
    range.setStart(start.node, start.offset);
    // Read the first glyph separately; a range spanning highlighted elements
    // also includes wrapper rectangles that can start on earlier lines.
    range.setEnd(start.node, Math.min(start.node.length, start.offset + 1));
    const first = Array.from(range.getClientRects()).find(rect => rect.height > 0 && rect.width > 0);
    tops.push(first?.top ?? NaN);
    range.setEnd(end.node, end.offset);
    let lastTop = -Infinity;
    for (const rect of range.getClientRects()) {
      if (rect.height <= 0 || rect.width <= 0) continue;
      lastTop = Math.max(lastTop, rect.top);
    }
    ends.push(Number.isFinite(lastTop) ? lastTop + lineHeight : NaN);
  });
  // Empty-line rectangles are ambiguous at newline boundaries in WebKit.
  // Anchor each run of blanks to the next real line, then fill trailing blanks.
  for (let index = tops.length - 2; index >= 0; index--) {
    if (!Number.isFinite(tops[index]) && Number.isFinite(tops[index + 1])) tops[index] = tops[index + 1] - lineHeight;
  }
  for (let index = 0; index < tops.length; index++) {
    if (!Number.isFinite(tops[index])) tops[index] = index === 0 ? 0 : Number.isFinite(ends[index - 1]) ? ends[index - 1] : tops[index - 1] + lineHeight;
  }
  return tops.map((top, index) => Math.max(1, (tops[index + 1] ?? ends[index]) - top || lineHeight));
}

function equalHeights(left: readonly number[], right: readonly number[]): boolean {
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
function CodeBlockView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [editable, setEditable] = useState(editor.isEditable);
  const [readonlyWrapOverride, setReadonlyWrapOverride] = useState<boolean | null>(null);
  const [readonlyCollapsedOverride, setReadonlyCollapsedOverride] = useState<boolean | null>(null);
  const code = node.textContent;
  const codeTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const storedWrapEnabled = node.attrs.wrap !== false;
  const storedCollapsed = node.attrs.collapsed === true;
  const inWorkspace = Boolean(editor.view?.dom.closest(".block-workspace"));
  const wrapEnabled = editable && !inWorkspace ? storedWrapEnabled : readonlyWrapOverride ?? storedWrapEnabled;
  const collapsed = editable ? storedCollapsed : readonlyCollapsedOverride ?? storedCollapsed;
  const lineCount = code.split("\n").length;
  const [lineNumbersEnabled, setLineNumbersEnabled] = useState(
    () => codeLineNumbersPluginKey.getState(editor.state) ?? false,
  );
  const [lineNumbersOverride, setLineNumbersOverride] = useState<boolean | null>(null);
  const showLineNumbers = lineNumbersOverride ?? lineNumbersEnabled;
  useEffect(() => {
    if (!editor.view.dom.closest(".block-workspace")) return;
    const syncPreferences = () => {
      const preferences = blockWorkspacePreferences();
      if (preferences.lineNumbers !== undefined) setLineNumbersOverride(preferences.lineNumbers);
      if (preferences.wrap !== undefined) setReadonlyWrapOverride(preferences.wrap);
    };
    syncPreferences();
    window.addEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, syncPreferences);
    return () => window.removeEventListener(BLOCK_WORKSPACE_DISPLAY_EVENT, syncPreferences);
  }, [editor]);
  const [lineHeights, setLineHeights] = useState<number[]>(() => Array(lineCount).fill(0));

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
    if (!showLineNumbers) {
      setLineHeights((current) => current.length === lineCount && current.every((height) => height === 0)
        ? current
        : Array(lineCount).fill(0));
      return;
    }
    const codeElement = wrapperRef.current?.querySelector<HTMLElement>("code");
    if (!codeElement) return;
    let frame = 0;
    let cancelled = false;
    const measure = () => {
      frame = 0;
      if (cancelled) return;
      const measured = measureCodeLineHeights(codeElement, code);
      setLineHeights((current) => equalHeights(current, measured) ? current : measured);
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
  }, [code, lineCount, showLineNumbers]);

  useEffect(() => {
    const syncEditable = () => {
      const nextEditable = editor.isEditable;
      setEditable((current) => current === nextEditable ? current : nextEditable);
      if (nextEditable && !editor.view.dom.closest(".block-workspace")) {
        setReadonlyWrapOverride(null);
        setReadonlyCollapsedOverride(null);
      }
    };
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
    // Copy model text, never rendered decorations such as whitespace markers.
    try {
      await copyToClipboard(code, { reportFailure: true });
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch { setCopyError(true); }
  };

  return (
    <NodeViewWrapper
      className={`code-block-wrap ${collapsed ? "collapsed" : ""}`}
      data-indent={node.attrs.indent > 0 ? node.attrs.indent : undefined}
      data-code-wrap={wrapEnabled ? "true" : "false"}
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div ref={wrapperRef} className="code-block-frame">
        <div
          className="code-block-toolbar"
          data-pdf-exclude
          contentEditable={false}
        >
          <input
            className="code-block-title"
            value={codeTitle}
            placeholder=""
            disabled={!editable}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => updateAttributes({ title: event.target.value })}
            aria-label="代码简介"
          />
          <div className="code-block-actions">
            <button
              type="button"
              className={`code-block-wrap-toggle ${showLineNumbers ? "active" : ""}`}
              aria-label={showLineNumbers ? "隐藏代码行号" : "显示代码行号"}
              aria-pressed={showLineNumbers}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setLineNumbersOverride(!showLineNumbers);
                if (inWorkspace) saveBlockWorkspacePreferences({ lineNumbers: !showLineNumbers });
              }}
              title="代码行号（仅改变显示）"
            >行号</button>
            <button
              className="code-block-collapse-toggle"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (editable) updateAttributes({ collapsed: !collapsed });
                else setReadonlyCollapsedOverride(!collapsed);
              }}
              type="button"
              aria-label={collapsed ? "展开代码块" : "折叠代码块"}
              aria-expanded={!collapsed}
              title={collapsed ? "展开代码块" : "折叠代码块"}
            >{collapsed ? "▶" : "▼"}</button>
            {editable && (
              <select
                className="code-block-language"
                value={normalizeCodeLanguage(node.attrs.language) ?? ""}
                onMouseDown={(event) => event.stopPropagation()}
                onChange={(event) => updateAttributes({ language: event.target.value || null })}
                aria-label="代码语言"
                title="代码语言 / 语法高亮"
              >
                {CODE_LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value || "plaintext"} value={option.value}>{option.label}</option>
                ))}
              </select>
            )}
            <button
              className={`code-block-wrap-toggle ${wrapEnabled ? "active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (inWorkspace) saveBlockWorkspacePreferences({ wrap: !wrapEnabled });
                if (editable) { setReadonlyWrapOverride(null); updateAttributes({ wrap: !wrapEnabled }); }
                else setReadonlyWrapOverride(!wrapEnabled);
              }}
              type="button"
              aria-label={wrapEnabled ? "关闭代码软换行" : "开启代码软换行"}
              aria-pressed={wrapEnabled}
              title={`视觉软换行：${wrapEnabled ? "开" : "关"}（仅改变显示，不修改代码）`}
            >软换行</button>
            <button
              className="code-block-copy"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleCopy}
              type="button"
              title="复制代码"
              aria-label="复制代码"
            >
              {copyError ? "复制失败" : copied ? "已复制" : "⎘"}
            </button>
            <button type="button" className="block-workspace-open" title="放大阅读代码块" aria-label="放大阅读代码块"
              onMouseDown={event => event.preventDefault()}
              onClick={event => openBlockWorkspace(editor, getPos(), event.currentTarget)}><ToolbarIcon name="expand" /></button>
          </div>
        </div>
        <div className="code-block-inner">
          <div
            className="code-block-gutter"
            style={{ display: showLineNumbers ? "block" : "none", width: `calc(${String(lineCount).length}ch + var(--code-line-number-padding, 8px))` }}
            contentEditable={false}
            suppressContentEditableWarning
          >
            {showLineNumbers && Array.from({ length: lineCount }, (_, index) => (
              <span
                key={index}
                // iOS WebKit 在 contenteditable NodeView 中有时会忽略逻辑
                // block-size，导致软换行后仍按单行高度排列并丢失末尾行号。
                // 代码块固定为横向书写，使用物理 height 更可靠。
                style={{ height: lineHeights[index] ? `${lineHeights[index]}px` : "1.5em" }}
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
  defaultWrap: boolean;
}

export const CodeBlockLineNumbers = Node.create<CodeBlockLineNumberOptions>({
  name: "codeBlock",

  addOptions() {
    return { lineNumbersEnabled: false, defaultWrap: true };
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
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
        renderHTML: (attributes) => attributes.collapsed
          ? { "data-collapsed": "true" }
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
    }), new Plugin<boolean>({
      key: codeBlockDefaultWrapPluginKey,
      state: {
        init: () => this.options.defaultWrap,
        apply(transaction, previous) {
          const requested = transaction.getMeta(codeBlockDefaultWrapPluginKey);
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
      'Mod-Alt-c': ({ editor }) => {
        if (editor.isActive('codeBlock')) {
          editor.chain().focus().setNode('paragraph').run();
        } else {
          const defaultWrap = codeBlockDefaultWrapPluginKey.getState(editor.state) ?? true;
          editor.chain().focus().setNode('codeBlock', { wrap: defaultWrap }).run();
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

export function setCodeBlockDefaultWrap(editor: Editor, enabled: boolean): void {
  const current = codeBlockDefaultWrapPluginKey.getState(editor.state) ?? true;
  if (current === enabled) return;
  editor.view.dispatch(editor.state.tr.setMeta(codeBlockDefaultWrapPluginKey, enabled));
}
