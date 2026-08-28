import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";

type ExitOptions = {
  deleteFrom?: number;
  deleteTo?: number;
};

function nearestStructuredBlockDepth(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const name = $from.node(depth).type.name;
    if (name === "codeBlock" || name === "blockquote") return depth;
  }
  return null;
}

/** Insert one ordinary paragraph immediately after a code/quote block. */
function insertParagraphAfterDepth(editor: Editor, depth: number, options: ExitOptions = {}): boolean {
  const { state, view } = editor;
  const blockStart = state.selection.$from.before(depth);
  let transaction = state.tr;
  if (options.deleteFrom !== undefined && options.deleteTo !== undefined) {
    transaction = transaction.delete(options.deleteFrom, options.deleteTo);
  }

  const updatedBlock = transaction.doc.nodeAt(blockStart);
  const paragraphType = state.schema.nodes.paragraph;
  if (!updatedBlock || !paragraphType) return false;
  const insertPos = blockStart + updatedBlock.nodeSize;
  if (!transaction.doc.resolve(insertPos).parent.canReplaceWith(
    transaction.doc.resolve(insertPos).index(),
    transaction.doc.resolve(insertPos).index(),
    paragraphType,
  )) return false;

  transaction = transaction
    .insert(insertPos, paragraphType.create())
    .setSelection(TextSelection.near(transaction.doc.resolve(insertPos + 1), 1))
    .scrollIntoView();
  view.dispatch(closeHistory(transaction));
  return true;
}

/** Explicit escape hatch used by Ctrl/Cmd+Enter and the mobile block menu. */
export function exitCurrentStructuredBlock(editor: Editor): boolean {
  if (!editor.state.selection.empty) return false;
  const depth = nearestStructuredBlockDepth(editor);
  return depth === null ? false : insertParagraphAfterDepth(editor, depth);
}

function exitCodeBlockAfterEmptyLine(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty || selection.$from.parent.type.name !== "codeBlock") return false;
  const { $from } = selection;
  const code = $from.parent;
  if ($from.parentOffset !== code.content.size || !code.textContent.endsWith("\n\n")) return false;

  // Two trailing newlines remain available for an intentional empty code line.
  // The third Enter removes those exit sentinels and creates the following
  // paragraph in the same transaction so undo remains atomic.
  return insertParagraphAfterDepth(editor, $from.depth, {
    deleteFrom: $from.pos - 2,
    deleteTo: $from.pos,
  });
}

function handleBlockquoteEmptyParagraph(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph" || $from.parent.content.size !== 0) return false;

  let quoteDepth: number | null = null;
  for (let depth = $from.depth - 1; depth > 0; depth--) {
    if ($from.node(depth).type.name === "blockquote") {
      quoteDepth = depth;
      break;
    }
  }
  if (quoteDepth === null || $from.depth !== quoteDepth + 1) return false;

  const quote = $from.node(quoteDepth);
  const paragraphIndex = $from.index(quoteDepth);
  if (paragraphIndex === 0) return false;

  // Empty paragraphs in the middle are intentional spacing: keep them inside
  // the quote. At the end, preserve the first empty paragraph and create a
  // second one. A further Enter exits and removes both exit sentinels.
  if (paragraphIndex < quote.childCount - 1) return editor.commands.splitBlock();

  const previousParagraph = quote.child(paragraphIndex - 1);
  if (previousParagraph.content.size > 0) return editor.commands.splitBlock();

  const currentStart = $from.before($from.depth);
  // Keep one paragraph when an otherwise-empty quote is exited so the quote
  // itself remains schema-valid.
  const deletePrevious = quote.childCount > 2;

  return insertParagraphAfterDepth(editor, quoteDepth, {
    deleteFrom: deletePrevious ? currentStart - previousParagraph.nodeSize : currentStart,
    deleteTo: $from.after($from.depth),
  });
}

export const StructuredBlockExit = Extension.create({
  name: "structuredBlockExit",
  priority: 1_000,

  addKeyboardShortcuts() {
    return {
      "Shift-Enter": () => {
        const { state, view } = this.editor;
        if (state.selection.$from.parent.type.name !== "codeBlock") return false;
        const { from, to } = state.selection;
        view.dispatch(state.tr.insertText("\n", from, to).scrollIntoView());
        return true;
      },
      Enter: () => exitCodeBlockAfterEmptyLine(this.editor) || handleBlockquoteEmptyParagraph(this.editor),
      "Mod-Enter": () => exitCurrentStructuredBlock(this.editor),
    };
  },
});
