import { documentRenderingExtensions } from "../extensions/document-rendering";
import { mapScrollPosition, type ScrollAnchor } from "../lib/scroll-position-map";
import { DocumentOutlineContext } from "./TableOfContentsBlock";
import { useBlockDisplayPreferences } from "../hooks/useBlockDisplayPreferences";
import { extractDocumentOutline } from "../lib/document-outline";
import { headingLinkTarget } from "../lib/heading-links";
import { flowBlockAttributes } from "../lib/flow-presentation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { getSchema } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { renderReadonlyBlock, decorateFlowBlock } from "./DocumentBlockContent";
import type { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import type { ReadingBlockState } from "../lib/reading-block-session";
import { footnoteLinkTarget, scrollToFootnote } from "../lib/footnote-navigation";
import { useDocumentHoverPreview } from "./FootnoteHoverPreview";
import { prepareMarkdownQuickPreviewAsync } from "../lib/data-transform-client";
import type { MarkdownQuickPreview } from "../lib/markdown-quick-preview";

let schema: ReturnType<typeof getSchema> | undefined;
function previewDocument(revision: SourceNavigationDocument, prepared?: MarkdownQuickPreview) {
  schema ??= getSchema(documentRenderingExtensions());
  const doc = schema.nodeFromJSON(prepared?.document ?? revision.previewDocument);
  doc.check();
  return { doc, revision, offsets: prepared?.offsets };
}

/** A derived, read-only projection. Never mounts a second writable editor. */
export function MarkdownSplitPreview({
  revision,
  sourceEditor,
  children,
  fontSize,
  enabled,
  sync,
  flowLevel = 0,
  highlightActiveLine = true,
  onPreviewReady,
  previewStyle,
  quickSourceLimit,
}: {
  revision: SourceNavigationDocument;
  sourceEditor: SourceEditorHandle | null;
  children: ReactNode;
  fontSize: number;
  enabled: boolean;
  sync: boolean;
  flowLevel?: number;
  highlightActiveLine?: boolean;
  onPreviewReady?: (element: HTMLDivElement) => void;
  previewStyle?: CSSProperties;
  quickSourceLimit?: number;
}) {
  useBlockDisplayPreferences();
  const [snapshot, setSnapshot] = useState<ReturnType<
    typeof previewDocument
  > | null>(null);
  const flowAttributes = useMemo(() => snapshot ? flowBlockAttributes(snapshot.doc, flowLevel) : new Map<number, Record<string, string>>(), [snapshot, flowLevel]);
  const [error, setError] = useState("");
  const [states, setStates] = useState(new Map<number, ReadingBlockState>());
  const preview = useRef<HTMLDivElement>(null),
    source = useRef<HTMLDivElement>(null);
  const active = useRef<"source" | "preview" | null>(null);
  const documentHover = useDocumentHoverPreview(() => snapshot?.doc ?? null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.resolve().then(async () => {
        const prepared = quickSourceLimit ? await prepareMarkdownQuickPreviewAsync(revision.source, quickSourceLimit) : undefined;
        if (cancelled) return;
        setSnapshot(previewDocument(revision, prepared));
        setError(prepared && !prepared.offsets.length ? "首个 Markdown 块超出快速预览范围，请打开完整文件。" : "");
      }).catch(() => {
        if (cancelled) return;
        setError("预览暂时无法更新，保留上一次结果；源码仍可编辑和保存。");
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [revision, enabled, quickSourceLimit]);
  const blocks = useMemo(() => {
    const entries: { node: PMNode; pos: number; offset: number }[] = [];
    snapshot?.doc.forEach((node, pos, index) =>
      entries.push({ node, pos, offset: snapshot.offsets ? snapshot.offsets[index] ?? 0 : snapshot.revision.offsetAt(pos + 1) }),
    );
    return entries;
  }, [snapshot]);
  useEffect(() => {
    const area = sourceEditor,
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
    let frame = 0;
    const refresh = () => {
      dirty = true;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Images, diagrams and CodeMirror wrapping may settle after initial layout.
        // Keep whichever pane the user last operated as the scroll authority.
        if (active.current === "preview") fromPreview();
        else fromSource();
      });
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(panel);
    observer.observe(area.view.scrollDOM);
    observer.observe(area.view.contentDOM);
    const body = panel.querySelector(".ProseMirror");
    if (body) observer.observe(body);
    area.addEventListener("scroll", fromSource);
    panel.addEventListener("scroll", fromPreview);
    // Opening/reopening preview, editing its snapshot or enabling sync must align
    // immediately, even when the source has not emitted another scroll event.
    active.current = "source";
    fromSource();
    refresh();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      area.removeEventListener("scroll", fromSource);
      panel.removeEventListener("scroll", fromPreview);
    };
  }, [sync, sourceEditor, snapshot, enabled]);
  useLayoutEffect(() => { if (snapshot && preview.current) onPreviewReady?.(preview.current); }, [snapshot, onPreviewReady, states]);
  const tocContext = useMemo(() => ({ items: snapshot ? extractDocumentOutline(snapshot.doc) : [], navigate: (item: { pos: number }) => {
    const block = blocks.find(block => block.pos === item.pos);
    const element = block && [...(preview.current?.querySelectorAll<HTMLElement>("[data-source-offset]") ?? [])].find(element => Number(element.dataset.sourceOffset) === block.offset);
    active.current = "preview";
    element?.scrollIntoView({ block: "start" });
  } }), [snapshot, blocks]);
  return (
    <DocumentOutlineContext.Provider value={tocContext}><div className={`markdown-split-preview${highlightActiveLine ? "" : " no-active-line"}`}>
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
          aria-label={`${revision.language === "flow" ? "Flow" : revision.language === "mermaid" ? "Mermaid" : "Markdown"} 实时预览`}
        >
          {(error || (quickSourceLimit && !snapshot)) && <div role="status">{error || "正在解析长 Markdown…"}</div>}
          <div
            ref={preview}
            className="markdown-preview-scroll editor-content vr-note"
            onPointerOver={documentHover.onPointerOver}
            onPointerOut={documentHover.onPointerOut}
            onFocusCapture={documentHover.onFocusCapture}
            onBlurCapture={documentHover.onBlurCapture}
            onScrollCapture={documentHover.onScrollCapture}
            onClickCapture={(event) => {
              const heading = snapshot && headingLinkTarget(event.target, extractDocumentOutline(snapshot.doc), snapshot.doc);
              if (heading) {
                event.preventDefault();
                event.stopPropagation();
                const block = [...blocks].reverse().find(block => block.pos <= heading.pos);
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
            style={{ ...previewStyle, fontSize }}
          >
            <div className="ProseMirror" contentEditable={false}>
              {blocks.map(({ node, pos, offset }, index) => (
                <div
                  key={pos}
                  data-source-offset={offset}
                  className="markdown-preview-block"
                  data-next-heading={blocks[index + 1]?.node.type.name === "heading" || undefined}
                data-next-heading-level={blocks[index + 1]?.node.type.name === "heading" ? blocks[index + 1].node.attrs.level : undefined}
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
