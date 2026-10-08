import {
  cloneElement,
  isValidElement,
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";
import { getSchema } from "@tiptap/core";
import { DocumentStarterKit } from "../extensions/DocumentStarterKit";
import { CodeBlockLineNumbers } from "../extensions/CodeBlockLineNumbers";
import { CollapsibleBlockquote } from "../extensions/CollapsibleBlockquote";
import { ResizableImage } from "../extensions/ResizableImage";
import {
  ContentSizedTable,
  AlignedTableCell,
  AlignedTableHeader,
} from "../extensions/ContentSizedTable";
import TableRow from "@tiptap/extension-table-row";
import Link from "@tiptap/extension-link";
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
} from "../extensions/MarkdownExtras";
import { mdToDelta } from "../lib/md-parser";
import { deltaToProseMirror } from "../lib/delta-converter";
import { flowParts } from "../lib/flow-block";
import { renderReadonlyBlock } from "./ReadonlyVirtualNote";
import type { ReadingBlockState } from "../lib/reading-block-session";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  footnoteLinkTarget,
  scrollToFootnote,
} from "../lib/footnote-navigation";

const nesting = createContext(0);
let schema: ReturnType<typeof getSchema> | undefined;
function parse(source: string) {
  schema ??= getSchema([
    DocumentStarterKit.configure({ codeBlock: false, blockquote: false }),
    CodeBlockLineNumbers,
    CollapsibleBlockquote,
    ResizableImage,
    ContentSizedTable,
    TableRow,
    AlignedTableCell,
    AlignedTableHeader,
    Link,
    BlockIndent,
    MarkdownTaskState,
    MathInline,
    MathBlock,
    InlineHighlight,
    FootnoteReference,
    HTMLDetails,
    FootnoteDefinition,
    Footnotes,
  ]);
  const doc = schema.nodeFromJSON(deltaToProseMirror(mdToDelta(source)));
  doc.check();
  return doc;
}

/** A single read-only projection used by the document, source preview and block workspace. */
export function FlowBlockContent({ source }: { source: string }) {
  const depth = useContext(nesting);
  const [states, setStates] = useState(new Map<number, ReadingBlockState>());
  const result = useMemo(() => {
    try {
      const doc = parse(source);
      const positions = new Map<PMNode, number>();
      doc.forEach((node, position) => positions.set(node, position));
      return { parts: flowParts(doc), positions };
    } catch {
      return null;
    }
  }, [source]);
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
        在源码或块模式中使用 ## 标题编写流程阶段。
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
        className="flow-block-content editor-content"
        onClickCapture={(event) => {
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
