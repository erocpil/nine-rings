import { BlockIndent } from "../extensions/BlockIndent";
import { MarkdownTaskState } from "../extensions/MarkdownTaskState";
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
import { renderReadonlyBlock } from "./ReadonlyVirtualNote";
import type { SourceNavigationDocument } from "../lib/markdown-source-navigation";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import type { ReadingBlockState } from "../lib/reading-block-session";

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
}: {
  revision: SourceNavigationDocument;
  areaRef: RefObject<SourceEditorHandle>;
  children: ReactNode;
  fontSize: number;
  enabled: boolean;
}) {
  const [snapshot, setSnapshot] = useState<ReturnType<
    typeof previewDocument
  > | null>(null);
  const [error, setError] = useState("");
  const [sync, setSync] = useState(
    () => localStorage.getItem("nr:markdownPreviewSync") !== "false",
  );
  const [states, setStates] = useState(new Map<number, ReadingBlockState>());
  const preview = useRef<HTMLDivElement>(null),
    source = useRef<HTMLDivElement>(null);
  const active = useRef<"source" | "preview" | null>(null);
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
    let frame = 0;
    const fromSource = () => {
      if (active.current !== "source") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const offset = area.position();
        const elements = [
          ...panel.querySelectorAll<HTMLElement>("[data-source-offset]"),
        ];
        const candidates = elements.filter(
          (el) => Number(el.dataset.sourceOffset) <= offset,
        );
        const element = candidates[candidates.length - 1] ?? elements[0];
        if (element)
          panel.scrollTop +=
            element.getBoundingClientRect().top -
            panel.getBoundingClientRect().top;
      });
    };
    const fromPreview = () => {
      if (active.current !== "preview") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = panel.getBoundingClientRect().top;
        const element = [
          ...panel.querySelectorAll<HTMLElement>("[data-source-offset]"),
        ].find((el) => el.getBoundingClientRect().bottom > top + 1);
        if (element) area.scrollToOffset(Number(element.dataset.sourceOffset));
      });
    };
    area.addEventListener("scroll", fromSource);
    panel.addEventListener("scroll", fromPreview);
    return () => {
      cancelAnimationFrame(frame);
      area.removeEventListener("scroll", fromSource);
      panel.removeEventListener("scroll", fromPreview);
    };
  }, [sync, areaRef, snapshot, enabled]);
  return (
    <div className="markdown-split-preview">
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
              {blocks.map(({ node, pos, offset }) => (
                <div
                  key={pos}
                  data-source-offset={offset}
                  className="markdown-preview-block"
                >
                  {renderReadonlyBlock(
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
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
