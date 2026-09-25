import { Extension, type Editor } from "@tiptap/core";
import { canSplit } from "@tiptap/pm/transform";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, TextSelection } from "@tiptap/pm/state";

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

function handleListEnter(editor: Editor): boolean {
  if (!editor.isEditable || editor.view.composing) return false;
  const { state, view } = editor;
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to) || $from.parent.type.name !== "paragraph" || $from.depth < 3) return false;
  const item = $from.node(-1);
  if (item.type.name !== "listItem") return false;
  let emptyItem = true;
  item.forEach(child => { if (child.type.name !== "paragraph" || child.content.size) emptyItem = false; });
  if (state.selection.empty && emptyItem && item.childCount > 1) {
    // Backspace can join empty paragraphs into one item. Collapse that empty
    // structure before lifting, otherwise successive Enter keeps splitting it.
    return editor.chain().command(({ tr }) => {
      const start = $from.before($from.depth - 1) + 1;
      tr.replaceWith(start, start + item.content.size, state.schema.nodes.paragraph.create());
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
      return true;
    }).command(({ commands }) => commands.splitListItem("listItem") || commands.liftListItem("listItem")).run();
  }
  // An empty continuation after code/quote belongs to a non-empty item.
  // Split off a new item instead of lifting all of its existing content.
  if (state.selection.empty && !$from.parent.content.size && item.childCount > 1
    && $from.index(-1) === item.childCount - 1 && canSplit(state.doc, $from.pos, 2)) {
    view.dispatch(state.tr.split($from.pos, 2).scrollIntoView());
    return true;
  }
  if (editor.commands.splitListItem("listItem")) return true;
  // Only a genuinely empty item may leave the list. Never lift a populated
  // item just because its final paragraph happens to be empty.
  return state.selection.empty && item.childCount === 1 && !$from.parent.content.size
    ? editor.commands.liftListItem("listItem") : false;
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
      Enter: () => handleListEnter(this.editor) || exitCodeBlockAfterEmptyLine(this.editor) || handleBlockquoteEmptyParagraph(this.editor),
      "Mod-Enter": () => exitCurrentStructuredBlock(this.editor),
    };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: { handleDOMEvents: {
      beforeinput: (_view, event) => {
        if (event.inputType !== "insertParagraph" || event.isComposing || !event.cancelable) return false;
        if (!handleListEnter(editor)) return false;
        event.preventDefault();
        return true;
      },
    } } })];
  },
});
