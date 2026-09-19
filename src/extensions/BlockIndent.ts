import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { listFollowupBlocks } from "../lib/list-followup-blocks";

export const MAX_BLOCK_INDENT = 8;

const INDENTABLE_BLOCKS = new Set(["paragraph", "heading", "blockquote", "codeBlock"]);

function normalizeIndent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(MAX_BLOCK_INDENT, Math.floor(parsed)));
}

function selectedTopLevelRange(state: EditorState): { from: number; to: number } {
  const { selection, doc } = state;
  if (selection.empty) {
    const index = Math.min(selection.$from.index(0), Math.max(0, doc.childCount - 1));
    return { from: index, to: index };
  }

  const from = Math.min(selection.$from.index(0), Math.max(0, doc.childCount - 1));
  let to = Math.min(selection.$to.index(0), Math.max(0, doc.childCount - 1));
  const toNodeStart = selection.$to.depth > 0 ? selection.$to.before(1) : selection.to;
  if (selection.$to.depth > 0 && to > from && selection.to <= toNodeStart + 1) to -= 1;
  return { from, to: Math.max(from, to) };
}

/** Adjust selected top-level text blocks without changing their content or selection. */
export function changeBlockIndent(
  state: EditorState,
  dispatch: ((transaction: Transaction) => void) | undefined,
  direction: 1 | -1,
): boolean {
  if (state.doc.childCount === 0) return false;
  const range = selectedTopLevelRange(state);
  const nextLevels = new Map<number, number>();
  let previousLevel = range.from > 0
    ? normalizeIndent(state.doc.child(range.from - 1).attrs.indent)
    : 0;

  for (let index = range.from; index <= range.to; index += 1) {
    const node = state.doc.child(index);
    const current = normalizeIndent(node.attrs.indent);
    if (!INDENTABLE_BLOCKS.has(node.type.name)) {
      previousLevel = current;
      continue;
    }

    const desired = direction > 0
      ? Math.max(current, Math.min(current + 1, previousLevel + 1, MAX_BLOCK_INDENT))
      : Math.max(0, current - 1);
    nextLevels.set(index, desired);
    previousLevel = desired;
  }

  let changed = false;
  let position = 0;
  const transaction = state.tr;
  state.doc.forEach((node: ProseMirrorNode, _offset: number, index: number) => {
    const indent = nextLevels.get(index);
    if (indent !== undefined && indent !== normalizeIndent(node.attrs.indent)) {
      transaction.setNodeMarkup(position, undefined, { ...node.attrs, indent });
      changed = true;
    }
    position += node.nodeSize;
  });

  if (changed && dispatch) dispatch(transaction);
  return changed;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockIndent: {
      indentBlocks: () => ReturnType;
      outdentBlocks: () => ReturnType;
    };
  }
}

export const BlockIndent = Extension.create({
  name: "blockIndent",
  priority: 110,

  addProseMirrorPlugins() {
    const decorate = (doc: ProseMirrorNode) => {
      const followups = listFollowupBlocks(doc);
      const decorations: Decoration[] = [];
      doc.forEach((node, pos) => {
        if (node.type.name !== "codeBlock" && node.type.name !== "blockquote") return;
        // React node views have an outer layout wrapper separate from their
        // editable content. Apply indentation to that wrapper, including zero
        // so outdent cannot leave an old node-view attribute behind.
        decorations.push(Decoration.node(pos, pos + node.nodeSize, {
          "data-indent": String(normalizeIndent(node.attrs.indent)),
          ...(followups.has(pos) ? { "data-list-followup": "true" } : {}),
        }));
      });
      return DecorationSet.create(doc, decorations);
    };
    return [new Plugin<DecorationSet>({
      state: { init: (_, state) => decorate(state.doc), apply: (tr, previous) => tr.docChanged ? decorate(tr.doc) : previous },
      props: { decorations(state) { return this.getState(state); } },
    })];
  },

  addGlobalAttributes() {
    return [{
      types: [...INDENTABLE_BLOCKS],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => normalizeIndent(element.getAttribute("data-indent")),
          renderHTML: (attributes) => {
            const indent = normalizeIndent(attributes.indent);
            return indent > 0 ? { "data-indent": String(indent) } : {};
          },
        },
      },
    }];
  },

  addCommands() {
    return {
      indentBlocks: () => ({ state, dispatch }) => changeBlockIndent(state, dispatch, 1),
      outdentBlocks: () => ({ state, dispatch }) => changeBlockIndent(state, dispatch, -1),
    };
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (!this.editor.isEditable) return false;
        if (this.editor.isActive("table")) return false;
        if (this.editor.isActive("listItem")) return this.editor.commands.sinkListItem("listItem");
        return this.editor.commands.indentBlocks();
      },
      "Shift-Tab": () => {
        if (!this.editor.isEditable) return false;
        if (this.editor.isActive("table")) return false;
        if (this.editor.isActive("listItem")) return this.editor.commands.liftListItem("listItem");
        return this.editor.commands.outdentBlocks();
      },
    };
  },
});
