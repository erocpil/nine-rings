import { mapScrollPosition, type ScrollAnchor } from "../lib/scroll-position-map";
import { DocumentOutlineContext } from "./TableOfContentsBlock";
import { extractDocumentOutline } from "../lib/document-outline";
import { headingLinkTarget } from "../lib/heading-links";
import { flowBlockAttributes } from "../lib/flow-presentation";
import { BlockIndent } from "../extensions/BlockIndent";
import { MarkdownTaskState } from "../extensions/MarkdownTaskState";
import { MathInline, MathBlock, InlineHighlight, FootnoteReference, HTMLDetails, FootnoteDefinition, Footnotes } from "../extensions/MarkdownExtras";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
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
import { renderReadonlyBlock, decorateFlowBlock } from "./ReadonlyVirtualNote";
import type { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import type { ReadingBlockState } from "../lib/reading-block-session";
import { footnoteLinkTarget, scrollToFootnote } from "../lib/footnote-navigation";
import { useDocumentHoverPreview } from "./FootnoteHoverPreview";

let schema: ReturnType<typeof getSchema> | undefined;
function previewDocument(revision: SourceNavigationDocument) {
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
    MathInline, MathBlock, InlineHighlight, FootnoteReference, HTMLDetails, FootnoteDefinition, Footnotes,
  ]);
  const doc = schema.nodeFromJSON(revision.document);
  doc.check();
  return { doc, revision };
}

/** A derived, read-only projection. Never mounts a second writable editor. */
export function MarkdownSplitPreview({
  revision,
  areaRef,
  children,
  fontSize,
  enabled,
  flowLevel = 0,
}: {
  revision: SourceNavigationDocument;
  areaRef: RefObject<SourceEditorHandle>;
  children: ReactNode;
  fontSize: number;
  enabled: boolean;
  flowLevel?: number;
}) {
  const [snapshot, setSnapshot] = useState<ReturnType<
    typeof previewDocument
  > | null>(null);
  const flowAttributes = useMemo(() => snapshot ? flowBlockAttributes(snapshot.doc, flowLevel) : new Map<number, Record<string, string>>(), [snapshot, flowLevel]);
  const [error, setError] = useState("");
  const [sync, setSync] = useState(
    () => localStorage.getItem("nr:markdownPreviewSync") !== "false",
  );
  const [states, setStates] = useState(new Map<number, ReadingBlockState>());
  const preview = useRef<HTMLDivElement>(null),
    source = useRef<HTMLDivElement>(null);
  const active = useRef<"source" | "preview" | null>(null);
  const documentHover = useDocumentHoverPreview(() => snapshot?.doc ?? null);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      try {
        setSnapshot(previewDocument(revision));
        setError("");
      } catch {
        setError("预览暂时无法更新，保留上一次结果；源码仍可编辑和保存。");
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [revision, enabled]);
  const blocks = useMemo(() => {
    const entries: { node: PMNode; pos: number; offset: number }[] = [];
    snapshot?.doc.forEach((node, pos) =>
      entries.push({ node, pos, offset: snapshot.revision.offsetAt(pos + 1) }),
    );
    return entries;
  }, [snapshot]);
  useEffect(() => {
    const area = areaRef.current,
      panel = preview.current,
      host = source.current;
    if (!enabled || !sync || !area || !panel || !host || !snapshot) return;
    let anchors: ScrollAnchor[] = [];
    let dirty = true;
    let sourceHeight = -1, previewHeight = -1;
    const elements = [...panel.querySelectorAll<HTMLElement>("[data-source-offset]")];
    const measure = () => {
      if (!dirty && sourceHeight === area.view.contentHeight && previewHeight === panel.scrollHeight) return;
      sourceHeight = area.view.contentHeight;
      previewHeight = panel.scrollHeight;
      dirty = false;
      const sourceRoot = area.view.scrollDOM;
      const sourceMax = Math.max(0, sourceRoot.scrollHeight - sourceRoot.clientHeight);
      const previewMax = Math.max(0, panel.scrollHeight - panel.clientHeight);
      const sourceStart = area.view.documentTop + area.scrollTop - sourceRoot.getBoundingClientRect().top;
      const previewTop = panel.getBoundingClientRect().top + panel.clientTop;
      anchors = [{ source: 0, preview: 0 }];
      for (const element of elements) {
        const offset = Math.max(0, Math.min(area.view.state.doc.length, Number(element.dataset.sourceOffset)));
        const sourceY = sourceStart + area.view.lineBlockAt(offset).top;
        const previewY = element.getBoundingClientRect().top - previewTop + panel.scrollTop;
        const previous = anchors[anchors.length - 1];
        if (sourceY > previous.source && previewY > previous.preview && sourceY < sourceMax && previewY < previewMax)
          anchors.push({ source: sourceY, preview: previewY });
      }
      anchors.push({ source: sourceMax, preview: previewMax });
    };
    const observer = new ResizeObserver(() => { dirty = true; });
    observer.observe(panel);
    observer.observe(area.view.scrollDOM);
    const body = panel.querySelector(".ProseMirror");
    if (body) observer.observe(body);
    const fromSource = () => {
      if (active.current !== "source") return;
      measure();
      panel.scrollTop = mapScrollPosition(area.scrollTop, anchors, "source");
    };
    const fromPreview = () => {
      if (active.current !== "preview") return;
      measure();
      // Assign the scroll position now instead of queueing a CM measurement.
      area.scrollTop = mapScrollPosition(panel.scrollTop, anchors, "preview");
    };
    area.addEventListener("scroll", fromSource);
    panel.addEventListener("scroll", fromPreview);
    return () => {
      observer.disconnect();
      area.removeEventListener("scroll", fromSource);
      panel.removeEventListener("scroll", fromPreview);
    };
  }, [sync, areaRef, snapshot, enabled]);
  const tocContext = useMemo(() => ({ items: snapshot ? extractDocumentOutline(snapshot.doc) : [], navigate: (item: { pos: number }) => {
    const block = blocks.find(block => block.pos === item.pos);
    const element = block && [...(preview.current?.querySelectorAll<HTMLElement>("[data-source-offset]") ?? [])].find(element => Number(element.dataset.sourceOffset) === block.offset);
    active.current = "preview";
    element?.scrollIntoView({ block: "start" });
  } }), [snapshot, blocks]);
  return (
    <DocumentOutlineContext.Provider value={tocContext}><div className="markdown-split-preview">
      <div
        className="markdown-split-source"
        ref={source}
        onFocusCapture={() => {
          active.current = "source";
        }}
        onWheelCapture={() => {
          active.current = "source";
        }}
        onPointerDownCapture={() => {
          active.current = "source";
        }}
        onKeyDownCapture={() => {
          active.current = "source";
        }}
      >
        {children}
      </div>
      {enabled && (
        <section
          className="markdown-preview-pane"
          aria-label="Markdown 实时预览"
        >
          <div className="markdown-preview-header">
            预览{" "}
            <label>
              <input
                type="checkbox"
                checked={sync}
                onChange={(e) => {
                  setSync(e.target.checked);
                  localStorage.setItem(
                    "nr:markdownPreviewSync",
                    String(e.target.checked),
                  );
                }}
              />
              同步滚动
            </label>
          </div>
          {error && <div role="status">{error}</div>}
          <div
            ref={preview}
            className="markdown-preview-scroll editor-content vr-note"
            onPointerOver={documentHover.onPointerOver}
            onPointerOut={documentHover.onPointerOut}
            onFocusCapture={documentHover.onFocusCapture}
            onBlurCapture={documentHover.onBlurCapture}
            onScrollCapture={documentHover.onScrollCapture}
            onClickCapture={(event) => {
              const heading = snapshot && headingLinkTarget(event.target, extractDocumentOutline(snapshot.doc));
              if (heading) {
                event.preventDefault();
                event.stopPropagation();
                const block = blocks.find(block => block.pos === heading.pos);
                const target = block && [...event.currentTarget.querySelectorAll<HTMLElement>("[data-source-offset]")].find(element => Number(element.dataset.sourceOffset) === block.offset);
                active.current = "preview";
                target?.scrollIntoView({ block: "start" });
                return;
              }
              const id = footnoteLinkTarget(event.target);
              if (!id) return;
              event.preventDefault();
              event.stopPropagation();
              scrollToFootnote(event.currentTarget, id);
            }}
            onWheelCapture={() => {
              active.current = "preview";
            }}
            onPointerDownCapture={() => {
              active.current = "preview";
            }}
            onKeyDownCapture={() => {
              active.current = "preview";
            }}
            tabIndex={0}
            style={{ fontSize }}
          >
            <div className="ProseMirror" contentEditable={false}>
              {blocks.map(({ node, pos, offset }, index) => (
                <div
                  key={pos}
                  data-source-offset={offset}
                  className="markdown-preview-block"
                  data-next-heading={blocks[index + 1]?.node.type.name === "heading" || undefined}
                >
                  {decorateFlowBlock(renderReadonlyBlock(
                    node,
                    pos,
                    states,
                    (at, value) =>
                      setStates((previous) =>
                        new Map(previous).set(at, {
                          ...previous.get(at),
                          ...value,
                        }),
                      ),
                    undefined,
                    true,
                  ), flowAttributes.get(pos))}
                </div>
              ))}
            </div>
            {documentHover.preview}
          </div>
        </section>
      )}
    </div></DocumentOutlineContext.Provider>
  );
}
