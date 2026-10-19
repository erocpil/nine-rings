import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  buildReadingTextMap,
  deleteReadingAnnotations,
  quoteForRange,
  type ReadingAnnotation,
} from "../lib/reading-annotations";

interface ReadingAnnotationState {
  items: ReadingAnnotation[];
  decorations: DecorationSet;
  persistMappedItems: boolean;
  enabled: boolean;
}

interface ReadingAnnotationOptions {
  noteId: string;
  initial: ReadingAnnotation[];
  enabled: boolean;
  onMapped?: (items: ReadingAnnotation[]) => void;
}

type AnnotationMeta = { type: "set"; items: ReadingAnnotation[]; enabled?: boolean } | { type: "enabled"; enabled: boolean };

export const readingAnnotationsKey = new PluginKey<ReadingAnnotationState>("nineRingsReadingAnnotations");

function decorations(doc: ProseMirrorNode, items: readonly ReadingAnnotation[], enabled: boolean): DecorationSet {
  return DecorationSet.create(doc, enabled ? items
    .filter(item => item.to > item.from && item.from >= 0 && item.to <= doc.content.size)
    .map(item => Decoration.inline(item.from, item.to, {
      class: "reading-annotation-highlight",
      "data-reading-annotation": item.id,
      "aria-label": "阅读标注",
    }, { inclusiveStart: false, inclusiveEnd: false })) : []);
}

export const ReadingAnnotations = Extension.create<ReadingAnnotationOptions>({
  name: "readingAnnotations",
  addOptions() { return { noteId: "", initial: [], enabled: false }; },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin<ReadingAnnotationState>({
      key: readingAnnotationsKey,
      state: {
        init: (_, state) => ({ items: options.initial, decorations: decorations(state.doc, options.initial, options.enabled), persistMappedItems: false, enabled: options.enabled }),
        apply(transaction, previous, _oldState, nextState) {
          const meta = transaction.getMeta(readingAnnotationsKey) as AnnotationMeta | undefined;
          if (meta?.type === "set") {
            const enabled = meta.enabled ?? previous.enabled;
            return { items: meta.items, decorations: decorations(nextState.doc, meta.items, enabled), persistMappedItems: false, enabled };
          }
          if (meta?.type === "enabled") {
            return { ...previous, enabled: meta.enabled, decorations: decorations(nextState.doc, previous.items, meta.enabled), persistMappedItems: false };
          }
          if (!transaction.docChanged || previous.items.length === 0) {
            return { ...previous, decorations: previous.decorations.map(transaction.mapping, transaction.doc), persistMappedItems: false };
          }
          const map = buildReadingTextMap(nextState.doc);
          const kept: ReadingAnnotation[] = [];
          const removed: string[] = [];
          for (const item of previous.items) {
            const from = transaction.mapping.map(item.from, 1);
            const to = transaction.mapping.map(item.to, -1);
            if (to <= from) { removed.push(item.id); continue; }
            const quote = quoteForRange(map, from, to);
            if (!quote.exact.trim()) { removed.push(item.id); continue; }
            kept.push({ ...item, from, to, ...quote, updatedAt: new Date().toISOString() });
          }
          if (removed.length) void deleteReadingAnnotations(removed).catch(() => {});
          return { items: kept, decorations: decorations(nextState.doc, kept, previous.enabled), persistMappedItems: true, enabled: previous.enabled };
        },
      },
      props: { decorations(state) { return readingAnnotationsKey.getState(state)?.decorations ?? null; } },
      view(view) {
        let previous = readingAnnotationsKey.getState(view.state)?.items;
        return {
          update(current) {
            const state = readingAnnotationsKey.getState(current.state);
            if (!state || state.items === previous) return;
            previous = state.items;
            if (state.persistMappedItems) options.onMapped?.(state.items);
          },
        };
      },
    })];
  },
});

export function setReadingAnnotations(editor: Editor, items: ReadingAnnotation[], enabled = !editor.isEditable) {
  editor.view.dispatch(editor.state.tr.setMeta(readingAnnotationsKey, { type: "set", items, enabled }));
}
