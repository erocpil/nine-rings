import { renderedTextGeometry } from "../lib/rendered-text-geometry";
import { textWeight } from "../lib/delta-content-weight";
import type { SourceEditorHandle } from "../lib/source-editor-handle";
import { useLayoutEffect, useRef, useState } from "react";
import { TextSelection, NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { handoffReadingAnchor } from "../lib/readonly-rendering";
import { READING_POSITION_FLUSH_EVENT, patchReadingState } from "../lib/reading-state";
import {
  renderedPositionToSourceOffset,
  sourceOffsetToRenderedPosition,
  renderedTextblockMap,
  renderedTextblockSelector,
  sourcePositionMap,
  sourceOffsetToWeight,
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
  const area = useRef<SourceEditorHandle | null>(null);
  const [sourceHandle, onSourceReady] = useState<SourceEditorHandle | null>(
    null,
  );
  const stopHandoff = useRef<() => void>();
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
    selection?: number;
    selectionApplied?: boolean;
  } | null>(null);
  const lastSource = useRef<{
    source: string;
    scrollTop: number;
    weight: number;
  } | null>(null);

  const toSource = (
    source: string,
    doc: JSONContent,
    sourceTop?: number,
    selection?: number,
  ) => {
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
          const offset = renderedTextGeometry(element, entry.text)?.offsetAtY(top);
          weight = offset != null ? entry.from + textWeight(entry.text.slice(0, offset)) :
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
      selection:
        selection === undefined
          ? undefined
          : renderedPositionToSourceOffset(source, doc, selection, mapFor(source)),
    };
  };
  const toRendered = (source: string, doc: JSONContent) => {
    const input = area.current;
    const previous = lastSource.current;
    const weight = input
      ? previous?.source === source &&
        Math.abs(previous.scrollTop - input.scrollTop) < 1
        ? previous.weight
        : sourceOffsetToWeight(source, input.position(), mapFor(source))
      : 0;
    const blocks = renderedTextblockMap(doc);
    const target =
      blocks.find((block) => block.to > weight) ?? blocks[blocks.length - 1];
    const selection = input
      ? sourceOffsetToRenderedPosition(
          source,
          doc,
          input.selectionStart,
          mapFor(source),
        )
      : undefined;
    // Both complete and windowed renderers consume this before their normal
    // persisted-position restore. Windowed rows must mount before refinement.
    if (target)
      handoffReadingAnchor(noteId, {
        position: target.position,
        offset: 0,
        selection,
      });
    pending.current = {
      weight,
      doc,
      selection,
    };
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

    let frame = 0,
      stopped = false,
      settled = 0;
    let lastTop = -1;
    let observed: HTMLElement | null = null;
    const observer = new ResizeObserver(() => {
      if (stopped) return;
      settled = 0;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(restore);
    });
    const deadline = window.setTimeout(() => stop(), 10000);
    const stop = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(deadline);
      observer.disconnect();
    };
    stopHandoff.current = stop;
    // Never fight user scrolling or move focus to make a viewport visible.
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      container.addEventListener(event, stop, { passive: true });
    const restore = () => {
      if (stopped) return;
      const content = container.querySelector<HTMLElement>(
        showingSource
          ? ".cm-content"
          : ".editor-content .ProseMirror, .vr-body",
      );
      if (content && content !== observed) {
        observer.disconnect();
        observer.observe(content);
        observed = content;
      }
      let top: number | undefined;
      if (showingSource && area.current && anchor.source !== undefined) {
        const input = area.current;
        if (!anchor.selectionApplied && anchor.selection !== undefined) {
          input.setSelectionRange(anchor.selection, anchor.selection);
          anchor.selectionApplied = true;
        }
        if (anchor.sourceTop !== undefined) input.scrollTop = anchor.sourceTop;
        else input.scrollToOffset(sourceOffset);
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
            let offset = 0, weight = 0;
            while (offset < target.text.length && weight < anchor.weight - target.from) {
              if (!/\s/.test(target.text[offset])) weight++;
              offset++;
            }
            while (offset < target.text.length && /\s/.test(target.text[offset])) offset++;
            const line = renderedTextGeometry(element, target.text)?.rectAt(offset);
            // Long quotes own a bounded inner scroller. Reveal the line there
            // before aligning the document; outer scrolling cannot unclip it.
            let lineTop = line?.top ?? rect.top + rect.height * fraction;
            for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
              if (!parent.matches(".blockquote-content") || parent.scrollHeight <= parent.clientHeight) continue;
              const overflow = getComputedStyle(parent).overflowY;
              if (overflow !== "auto" && overflow !== "scroll") continue;
              const before = parent.scrollTop;
              parent.scrollTop += lineTop - (parent.getBoundingClientRect().top + parent.clientTop);
              lineTop -= parent.scrollTop - before;
            }
            root.scrollTop += lineTop - viewportTop(root);
            top = root.scrollTop;
          }
        }
      }
      settled =
        top !== undefined && Math.abs(top - lastTop) < 1 ? settled + 1 : 0;
      lastTop = top ?? -1;
      if (performance.now() - started > 10000) {
        stop();
        return;
      }
      // Pause once stable, but keep observing late TOC/image/NodeView layout.
      // User input cancels both the refinement and the observer immediately.
      if (settled >= 6 && performance.now() - started > 800) {
        frame = 0;
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
    // The lazy source editor can mount after the parent layout effect.
    // Subscribe when its handle is ready, rather than relying on ref mutation.
    const input = sourceHandle;
    if (!input) return;
    let top = input.scrollTop;
    let timer = 0;
    const flush = () => {
      window.clearTimeout(timer);
      timer = 0;
      patchReadingState(noteId, { view: "source", source: { scrollTop: top } });
    };
    const captureAndFlush = () => {
      if (host.current?.isConnected && !host.current.closest("[inert]") && host.current.clientHeight > 0)
        top = input.scrollTop;
      flush();
    };
    const scroll = () => {
      if (!host.current?.isConnected || host.current.closest("[inert]")) return;
      top = input.scrollTop;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, 220);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    flush();
    input.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", captureAndFlush);
    window.addEventListener("beforeunload", captureAndFlush);
    window.addEventListener(READING_POSITION_FLUSH_EVENT, captureAndFlush);
    window.addEventListener("nine-rings:main-window-hide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      input.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", captureAndFlush);
      window.removeEventListener("beforeunload", captureAndFlush);
      window.removeEventListener(READING_POSITION_FLUSH_EVENT, captureAndFlush);
      window.removeEventListener("nine-rings:main-window-hide", flush);
      document.removeEventListener("visibilitychange", hidden);
      flush();
    };
  }, [noteId, showingSource, sensitive, sourceHandle]);
  const onRenderedReady = (editor: Editor | null) => {
    const anchor = pending.current;
    if (
      !editor ||
      !anchor ||
      anchor.selection === undefined ||
      anchor.selectionApplied
    )
      return;
    const position = Math.max(
      0,
      Math.min(editor.state.doc.content.size, anchor.selection),
    );
    const node = editor.state.doc.nodeAt(position);
    const selection =
      node?.isAtom && NodeSelection.isSelectable(node)
        ? NodeSelection.create(editor.state.doc, position)
        : TextSelection.near(editor.state.doc.resolve(position));
    editor.view.dispatch(
      editor.state.tr.setSelection(selection).setMeta("addToHistory", false),
    );
    anchor.selectionApplied = true;
  };
  return {
    host,
    area,
    sourceHandle,
    onSourceReady,
    onRenderedReady,
    toSource,
    toRendered,
    cancelHandoff: () => {
      pending.current = null;
      stopHandoff.current?.();
    },
  };
}
