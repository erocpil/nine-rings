import { useLayoutEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/core";
import { handoffReadingAnchor } from "../lib/readonly-rendering";
import { patchReadingState } from "../lib/reading-state";
import {
  renderedTextblockMap,
  renderedTextblockSelector,
  sourcePositionMap,
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
function blockElement(
  host: HTMLElement,
  index: number,
  textblock: number | null,
): HTMLElement | null {
  const root = host.querySelector(".vr-body")
    ? host.querySelector<HTMLElement>(
        `[data-reading-row][data-block-number="${index + 1}"]`,
      )
    : ((host.querySelector(".editor-content .ProseMirror")?.children[index] as
        HTMLElement | undefined) ?? null);
  if (!root || textblock === null || root.matches(renderedTextblockSelector))
    return root;
  return (
    root.querySelectorAll<HTMLElement>(renderedTextblockSelector)[textblock] ??
    root
  );
}

/** A per-document transient handoff, separate from persistent last-open scroll state. */
export function useMarkdownViewPosition(
  noteId: string,
  showingSource: boolean,
  sensitive = false,
) {
  const host = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // One mapping per mounted document, never a global cache of private text.
  const sourceMapRef = useRef<{
    source: string;
    map: ReturnType<typeof sourcePositionMap>;
  }>();
  const mapFor = (source: string) => {
    if (sourceMapRef.current?.source !== source)
      sourceMapRef.current = { source, map: sourcePositionMap(source) };
    return sourceMapRef.current.map;
  };
  const pending = useRef<{
    weight: number;
    source?: string;
    doc: JSONContent;
    sourceMap?: ReturnType<typeof sourcePositionMap>;
    sourceTop?: number;
  } | null>(null);
  const lastSource = useRef<{
    source: string;
    scrollTop: number;
    weight: number;
  } | null>(null);

  const toSource = (source: string, doc: JSONContent, sourceTop?: number) => {
    const container = host.current;
    const root = container?.querySelector<HTMLElement>(".note-editor-scroll");
    let weight = 0;
    if (container && root) {
      const top = viewportTop(root);
      const entries = renderedTextblockMap(doc);
      const virtual = container.querySelector(".vr-body");
      const elements = virtual
        ? [...virtual.querySelectorAll<HTMLElement>("[data-reading-row]")]
        : [
            ...(container.querySelector(".editor-content .ProseMirror")
              ?.children ?? []),
          ];
      const groups = new Map<number, typeof entries>();
      for (const entry of entries) {
        const group = groups.get(entry.index) ?? [];
        group.push(entry);
        groups.set(entry.index, group);
      }
      outer: for (const [index, rootElement] of elements.entries()) {
        const rootRect = rootElement.getBoundingClientRect();
        if (rootRect.height <= 0 || rootRect.bottom <= top + 1) continue;
        const children = rootElement.matches(renderedTextblockSelector)
          ? [rootElement]
          : [...rootElement.querySelectorAll(renderedTextblockSelector)];
        for (const entry of groups.get(
          virtual
            ? Number(rootElement.getAttribute("data-block-number")) - 1
            : index,
        ) ?? []) {
          const element =
            entry.textblock === null ? rootElement : children[entry.textblock];
          if (!element) continue;
          const rect = element.getBoundingClientRect();
          if (rect.height <= 0 || rect.bottom <= top + 1) continue;
          weight =
            entry.from +
            Math.max(0, Math.min(1, (top - rect.top) / rect.height)) *
              (entry.to - entry.from);
          break outer;
        }
      }
    }
    pending.current = {
      weight,
      source,
      doc,
      sourceMap: mapFor(source),
      sourceTop,
    };
  };
  const toRendered = (source: string, doc: JSONContent) => {
    const input = area.current;
    const previous = lastSource.current;
    const weight = input
      ? previous?.source === source &&
        Math.abs(previous.scrollTop - input.scrollTop) < 1
        ? previous.weight
        : sourceOffsetToWeight(source, textareaPosition(input), mapFor(source))
      : 0;
    const blocks = renderedTextblockMap(doc);
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
    const blocks = renderedTextblockMap(anchor.doc);
    const target =
      blocks.find((block) => block.to > anchor.weight) ??
      blocks[blocks.length - 1];
    const sourceOffset =
      anchor.source === undefined
        ? 0
        : weightToSourceOffset(anchor.source, anchor.weight, anchor.sourceMap);
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
          sourceTop = anchor.sourceTop ?? textareaPosition(input, sourceOffset);
        }
        input.scrollTop = sourceTop;
        top = input.scrollTop;
        lastSource.current =
          anchor.sourceTop !== undefined
            ? null
            : {
                source: anchor.source,
                scrollTop: top,
                weight: anchor.weight,
              };
      } else if (!showingSource) {
        const root = container.querySelector<HTMLElement>(
          ".note-editor-scroll",
        );
        const element =
          target && blockElement(container, target.index, target.textblock);
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
  useLayoutEffect(() => {
    if (sensitive) return;
    if (!showingSource) return;
    const input = area.current;
    if (!input) return;
    let top = input.scrollTop;
    let timer = 0;
    const flush = () => {
      window.clearTimeout(timer);
      timer = 0;
      patchReadingState(noteId, { view: "source", source: { scrollTop: top } });
    };
    const scroll = () => {
      top = input.scrollTop;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 220);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    flush();
    input.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", flush);
    window.addEventListener("nine-rings:main-window-hide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      input.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("nine-rings:main-window-hide", flush);
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
  }, [noteId, showingSource, sensitive]);
  return { host, area, toSource, toRendered };
}
