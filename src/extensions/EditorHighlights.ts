import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Selection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// ── 高亮当前行扩展 ──

interface ActiveLinePluginState {
  bookmarkJumpPosition: number | null;
  decorations: DecorationSet;
}

export interface ActiveLinePluginMeta {
  bookmarkJumpPosition: number | null;
}

export const activeLinePluginKey = new PluginKey<ActiveLinePluginState>(
  "activeLine",
);

function createActiveLineDecorations(
  document: ProseMirrorNode,
  selection: Selection,
  bookmarkJumpPosition: number | null,
): DecorationSet {
  const decorations: Decoration[] = [];
  if (selection.$from.depth > 0) {
    const start = selection.$from.before(1);
    const end = selection.$from.after(1);
    if (start < end) {
      decorations.push(
        Decoration.node(start, end, { class: "ProseMirror-activeline" }),
      );
    }
  }
  if (bookmarkJumpPosition !== null) {
    const targetNode = document.nodeAt(bookmarkJumpPosition);
    if (targetNode) {
      decorations.push(
        Decoration.node(
          bookmarkJumpPosition,
          bookmarkJumpPosition + targetNode.nodeSize,
          { class: "bookmark-jump-target" },
        ),
      );
    }
  }
  return DecorationSet.create(document, decorations);
}

export function createActiveLinePlugin() {
  return new Plugin<ActiveLinePluginState>({
    key: activeLinePluginKey,
    state: {
      init(_, state): ActiveLinePluginState {
        return {
          bookmarkJumpPosition: null,
          decorations: createActiveLineDecorations(
            state.doc,
            state.selection,
            null,
          ),
        };
      },
      apply(tr, current): ActiveLinePluginState {
        const meta = tr.getMeta(activeLinePluginKey) as
          ActiveLinePluginMeta | undefined;
        let bookmarkJumpPosition = current.bookmarkJumpPosition;
        if (meta) {
          bookmarkJumpPosition = meta.bookmarkJumpPosition;
        } else if (bookmarkJumpPosition !== null && tr.docChanged) {
          const mapped = tr.mapping.mapResult(bookmarkJumpPosition, -1);
          bookmarkJumpPosition = mapped.deleted ? null : mapped.pos;
        }
        return {
          bookmarkJumpPosition,
          decorations: createActiveLineDecorations(
            tr.doc,
            tr.selection,
            bookmarkJumpPosition,
          ),
        };
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

export const ActiveLinePlugin = Extension.create({
  name: "activeLinePlugin",
  addProseMirrorPlugins() {
    return [createActiveLinePlugin()];
  },
});

// ── 工具栏交互期间保留文本选区的可见反馈 ──

interface ToolbarSelectionPluginState {
  range: { from: number; to: number } | null;
  decorations: DecorationSet;
}

interface ToolbarSelectionPluginMeta {
  range: { from: number; to: number } | null;
}

export const toolbarSelectionPluginKey =
  new PluginKey<ToolbarSelectionPluginState>("toolbarSelection");

function toolbarSelectionDecorations(
  document: ProseMirrorNode,
  range: { from: number; to: number } | null,
): DecorationSet {
  if (!range) return DecorationSet.empty;
  const from = Math.max(0, Math.min(range.from, document.content.size));
  const to = Math.max(from, Math.min(range.to, document.content.size));
  if (from === to) return DecorationSet.empty;
  return DecorationSet.create(document, [
    Decoration.inline(from, to, { class: "toolbar-preserved-selection" }),
  ]);
}

export function createToolbarSelectionPlugin() {
  return new Plugin<ToolbarSelectionPluginState>({
    key: toolbarSelectionPluginKey,
    state: {
      init(): ToolbarSelectionPluginState {
        return { range: null, decorations: DecorationSet.empty };
      },
      apply(tr, current): ToolbarSelectionPluginState {
        const meta = tr.getMeta(toolbarSelectionPluginKey) as
          ToolbarSelectionPluginMeta | undefined;
        let range = meta ? meta.range : current.range;
        if (!meta && range && tr.docChanged) {
          const from = tr.mapping.map(range.from, 1);
          const to = tr.mapping.map(range.to, -1);
          range = from < to ? { from, to } : null;
        }
        return {
          range,
          decorations: toolbarSelectionDecorations(tr.doc, range),
        };
      },
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

export const ToolbarSelection = Extension.create({
  name: "toolbarSelection",
  addProseMirrorPlugins() {
    return [createToolbarSelectionPlugin()];
  },
});

export function setToolbarSelectionHighlight(
  editor: Editor,
  range: { from: number; to: number } | null,
) {
  editor.view.dispatch(
    editor.state.tr.setMeta(toolbarSelectionPluginKey, {
      range,
    } satisfies ToolbarSelectionPluginMeta),
  );
}
