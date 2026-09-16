import { useLayoutEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import { handoffReadingAnchor } from "../lib/readonly-rendering";
import {
  renderedPositionMap,
  sourceOffsetToWeight,
  textareaPosition,
  weightToSourceOffset,
} from "../lib/markdown-view-position";

function viewportTop(root: HTMLElement) {
  const top = root.getBoundingClientRect().top;
  const sticky = root.querySelector<HTMLElement>(
    ":scope > .note-editor-sticky",
  );
  return sticky && getComputedStyle(sticky).position === "sticky"
    ? Math.max(top, sticky.getBoundingClientRect().bottom)
    : top;
}
function blockElement(host: HTMLElement, index: number): HTMLElement | null {
  if (host.querySelector(".vr-body"))
    return host.querySelector(
      `[data-reading-row][data-block-number="${index + 1}"]`,
    );
  return (
    (host.querySelector(".editor-content .ProseMirror")?.children[index] as
      HTMLElement | undefined) ?? null
  );
}

/** A per-document transient handoff, separate from persistent last-open scroll state. */
export function useMarkdownViewPosition(
  noteId: string,
  showingSource: boolean,
) {
  const host = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{
    weight: number;
    source?: string;
    doc: JSONContent;
  } | null>(null);
  const lastSource = useRef<{
    source: string;
    scrollTop: number;
    weight: number;
  } | null>(null);

  const toSource = (source: string, doc: JSONContent) => {
    const container = host.current;
    const root = container?.querySelector<HTMLElement>(".note-editor-scroll");
    let weight = 0;
    if (container && root) {
      const top = viewportTop(root);
      const entries = renderedPositionMap(doc);
      const virtual = container.querySelector(".vr-body");
      const elements = virtual
        ? [...virtual.querySelectorAll<HTMLElement>("[data-reading-row]")]
        : [...(container.querySelector(".editor-content .ProseMirror")?.children ?? [])];
      for (const [index, element] of elements.entries()) {
        const entry = entries[virtual ? Number(element.getAttribute("data-block-number")) - 1 : index];
        if (!entry) continue;
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom <= top + 1) continue;
        weight =
          entry.from +
          Math.max(0, Math.min(1, (top - rect.top) / rect.height)) *
            (entry.to - entry.from);
        break;
      }
    }
    pending.current = { weight, source, doc };
  };
  const toRendered = (source: string, doc: JSONContent) => {
    const input = area.current;
    const previous = lastSource.current;
    const weight = input
      ? previous?.source === source &&
        Math.abs(previous.scrollTop - input.scrollTop) < 1
        ? previous.weight
        : sourceOffsetToWeight(source, textareaPosition(input))
      : 0;
    const blocks = renderedPositionMap(doc);
    const target =
      blocks.find((block) => block.to > weight) ?? blocks[blocks.length - 1];
    // Both complete and windowed renderers consume this before their normal
    // persisted-position restore. Windowed rows must mount before refinement.
    if (target)
      handoffReadingAnchor(noteId, { position: target.position, offset: 0 });
    pending.current = { weight, doc };
  };

  useLayoutEffect(() => {
    const anchor = pending.current;
    const container = host.current;
    if (!anchor || !container) return;
    const started = performance.now();
    const blocks = renderedPositionMap(anchor.doc);
    const target =
      blocks.find((block) => block.to > anchor.weight) ??
      blocks[blocks.length - 1];
    const sourceOffset =
      anchor.source === undefined
        ? 0
        : weightToSourceOffset(anchor.source, anchor.weight);
    let measuredWidth = -1,
      sourceTop = 0;
    let frame = 0,
      stopped = false,
      settled = 0;
    let lastTop = -1;
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
    // Never fight user scrolling or move focus to make a viewport visible.
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      container.addEventListener(event, stop, { passive: true });
    const restore = () => {
      if (stopped) return;
      let top: number | undefined;
      if (showingSource && area.current && anchor.source !== undefined) {
        const input = area.current;
        if (measuredWidth !== input.clientWidth) {
          measuredWidth = input.clientWidth;
          sourceTop = textareaPosition(input, sourceOffset);
        }
        input.scrollTop = sourceTop;
        top = input.scrollTop;
        lastSource.current = {
          source: anchor.source,
          scrollTop: top,
          weight: anchor.weight,
        };
      } else if (!showingSource) {
        const root = container.querySelector<HTMLElement>(
          ".note-editor-scroll",
        );
        const element = target && blockElement(container, target.index);
        if (root && element && target) {
          const rect = element.getBoundingClientRect();
          if (rect.height > 0) {
            const fraction = Math.max(
              0,
              Math.min(
                1,
                (anchor.weight - target.from) /
                  Math.max(1, target.to - target.from),
              ),
            );
            root.scrollTop +=
              rect.top - viewportTop(root) + rect.height * fraction;
            top = root.scrollTop;
          }
        }
      }
      settled =
        top !== undefined && Math.abs(top - lastTop) < 1 ? settled + 1 : 0;
      lastTop = top ?? -1;
      if (
        (settled >= 3 && performance.now() - started > 150) ||
        performance.now() - started > 1500
      ) {
        stop();
        return;
      }
      frame = requestAnimationFrame(restore);
    };
    if (showingSource) restore();
    else frame = requestAnimationFrame(restore);
    return () => {
      stop();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        container.removeEventListener(event, stop);
    };
  }, [showingSource, noteId]);
  return { host, area, toSource, toRendered };
}
