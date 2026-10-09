import { FootnoteNumbering } from "../extensions/FootnoteNumbering";
import {
  cloneElement,
  isValidElement,
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import { getSchema } from "@tiptap/core";
import { DocumentStarterKit } from "../extensions/DocumentStarterKit";
import { CodeBlockLineNumbers } from "../extensions/CodeBlockLineNumbers";
import { CollapsibleBlockquote } from "../extensions/CollapsibleBlockquote";
import { ResizableImage, MarkdownImage } from "../extensions/ResizableImage";
import {
  ContentSizedTable,
  AlignedTableCell,
  AlignedTableHeader,
} from "../extensions/ContentSizedTable";
import TableRow from "@tiptap/extension-table-row";
import { DocumentLink as Link } from "../extensions/DocumentLink";
import { BlockIndent } from "../extensions/BlockIndent";
import { MarkdownTaskState } from "../extensions/MarkdownTaskState";
import {
  MathInline,
  MathBlock,
  InlineHighlight,
  FootnoteReference,
  HTMLDetails,
  FootnoteDefinition,
  Footnotes,
  HTMLStyle, HTMLAnchor, RawHTML, RawHTMLInline,
} from "../extensions/MarkdownExtras";
import { mdToDelta } from "../lib/md-parser";
import { deltaToProseMirror } from "../lib/delta-converter";
import { flowParts } from "../lib/flow-block";
import { FLOW_BLOCK_FOCUS_EVENT } from "../lib/flow-block-focus";
import { renderReadonlyBlock } from "./ReadonlyVirtualNote";
import type { ReadingBlockState } from "../lib/reading-block-session";
import {
  DOMParser,
  DOMSerializer,
  type Node as PMNode,
} from "@tiptap/pm/model";
import { clipboardSliceToPlainText } from "../lib/clipboard-plain-text";
import {
  footnoteLinkTarget,
  scrollToFootnote,
} from "../lib/footnote-navigation";

const nesting = createContext(0);
let schema: ReturnType<typeof getSchema> | undefined;
export function parseFlowDocument(source: string) {
  schema ??= getSchema([
    DocumentStarterKit.configure({ codeBlock: false, blockquote: false }),
    CodeBlockLineNumbers,
    CollapsibleBlockquote,
    ResizableImage, MarkdownImage,
    ContentSizedTable,
    TableRow,
    AlignedTableCell,
    AlignedTableHeader,
    Link,
    BlockIndent,
    MarkdownTaskState, FootnoteNumbering,
    MathInline,
    MathBlock,
    InlineHighlight,
    FootnoteReference,
    HTMLDetails,
    FootnoteDefinition,
    Footnotes,
    HTMLStyle, HTMLAnchor, RawHTML, RawHTMLInline,
  ]);
  const doc = schema.nodeFromJSON(deltaToProseMirror(mdToDelta(source)));
  doc.check();
  return doc;
}

/** A single read-only projection used by the document, source preview and block workspace. */
export function FlowBlockContent({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const activeBlock = useRef<HTMLElement | null>(null);
  const depth = useContext(nesting);
  const [states, setStates] = useState(new Map<number, ReadingBlockState>());
  const result = useMemo(() => {
    try {
      const doc = parseFlowDocument(source);
      const positions = new Map<PMNode, number>();
      doc.forEach((node, position) => positions.set(node, position));
      return { parts: flowParts(doc), positions };
    } catch {
      return null;
    }
  }, [source]);
  useEffect(() => {
    const root = host.current;
    if (!root || !result) return;
    const owner = root.ownerDocument;
    const clearLine = () => {
      if (activeBlock.current) root.dispatchEvent(new CustomEvent(FLOW_BLOCK_FOCUS_EVENT, { bubbles: true, detail: false }));
      activeBlock.current?.classList.remove("flow-active-block");
      activeBlock.current = null;
    };
    const clearOutside = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".flow-block-content") !== root || target.closest("button, input, textarea, select")) clearLine();
    };
    const copy = (event: ClipboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("input, textarea, select")
      )
        return;
      const selection = owner.getSelection();
      if (
        !event.clipboardData ||
        !selection?.rangeCount ||
        selection.isCollapsed ||
        !selection.anchorNode ||
        !selection.focusNode ||
        !root.contains(selection.anchorNode) ||
        !root.contains(selection.focusNode)
      )
        return;
      // Only the innermost flow owns a selection in a nested projection.
      const anchor =
        selection.anchorNode instanceof Element
          ? selection.anchorNode
          : selection.anchorNode.parentElement;
      if (anchor?.closest(".flow-block-content") !== root) return;
      const fragment = owner.createElement("div");
      fragment.append(selection.getRangeAt(0).cloneContents());
      fragment
        .querySelectorAll(
          ".flow-step-number, button, input, select, textarea, .vr-code-toolbar, .vr-code-line-number, .blockquote-toolbar",
        )
        .forEach((element) => element.remove());
      const slice = DOMParser.fromSchema(schema!).parseSlice(fragment);
      const html = owner.createElement("div");
      html.append(
        DOMSerializer.fromSchema(schema!).serializeFragment(slice.content, {
          document: owner,
        }),
      );
      event.clipboardData.setData(
        "text/plain",
        clipboardSliceToPlainText(slice),
      );
      event.clipboardData.setData("text/html", html.innerHTML);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    // Browser copy can target the focused outer editor or body, so bind to
    // document capture and scope by the actual native selection, not focus.
    owner.addEventListener("copy", copy, true);
    owner.addEventListener("pointerdown", clearOutside, true);
    owner.addEventListener("focusin", clearOutside, true);
    return () => {
      clearLine();
      owner.removeEventListener("copy", copy, true);
      owner.removeEventListener("pointerdown", clearOutside, true);
      owner.removeEventListener("focusin", clearOutside, true);
    };
  }, [result]);
  if (depth >= 3 || !result)
    return (
      <div className="flow-block-error" role="status">
        {depth >= 3
          ? "嵌套流程超过三层，请在源码中查看。"
          : "流程内容暂时无法呈现，请切换源码检查。"}
        <pre>{source}</pre>
      </div>
    );
  if (!source.trim())
    return (
      <div className="flow-block-empty">
        在源码或块模式中使用 ### 标题编写流程阶段。
      </div>
    );
  const render = (node: PMNode) => {
    const element = renderReadonlyBlock(
      node,
      result.positions.get(node) ?? 0,
      states,
      (position, value) =>
        setStates((previous) =>
          new Map(previous).set(position, {
            ...previous.get(position),
            ...value,
          }),
        ),
      undefined,
      true,
    );
    return isValidElement(element)
      ? cloneElement(element, { key: result.positions.get(node) })
      : element;
  };
  let step = 0;
  return (
    <nesting.Provider value={depth + 1}>
      <div
        tabIndex={0}
        aria-label="流程内容"
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        ref={host}
        className="flow-block-content editor-content"
        onClickCapture={(event) => {
          const element = event.target instanceof Element ? event.target : null;
          if (element?.closest(".flow-block-content") === event.currentTarget && !element.closest("button, input, textarea, select")) {
            const block = event.currentTarget.closest<HTMLElement>(".flow-block-wrap") ?? event.currentTarget;
            activeBlock.current?.classList.remove("flow-active-block");
            block.classList.add("flow-active-block");
            activeBlock.current = block;
            event.currentTarget.dispatchEvent(new CustomEvent(FLOW_BLOCK_FOCUS_EVENT, { bubbles: true, detail: true }));
          }
          // Inner read-only block positions belong to this projection, not the outer document.
          if (
            event.target instanceof Element &&
            event.target.closest(".block-workspace-open")
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
          const target = footnoteLinkTarget(event.target);
          if (target) {
            event.preventDefault();
            event.stopPropagation();
            scrollToFootnote(event.currentTarget, target);
          }
        }}
      >
        {result.parts.map((part, index) =>
          part.kind === "text" ? (
            <div key={index} className="ProseMirror flow-prose">
              {part.nodes.map(render)}
            </div>
          ) : (
            <div
              key={index}
              className="flow-stages"
              role="list"
              aria-label="流程阶段"
            >
              {part.stages.map((stage) => (
                <section
                  key={result.positions.get(stage.heading)}
                  className="flow-step"
                  role="listitem"
                >
                  <span
                    className="flow-step-number"
                    aria-label={`阶段 ${++step}`}
                  >
                    {step}
                  </span>
                  <div className="ProseMirror flow-prose">
                    {render(stage.heading)}
                    {stage.body.map(render)}
                  </div>
                </section>
              ))}
            </div>
          ),
        )}
      </div>
    </nesting.Provider>
  );
}
