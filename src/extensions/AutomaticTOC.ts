import { Extension, InputRule } from "@tiptap/core";
import { TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";

function insertTOC(state: EditorState, tr: Transaction): boolean {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parent.textContent !== "/toc") return false;
  const toc = state.schema.nodes.codeBlock.create({ language: "toc" }, state.schema.text("levels: 1,2,3"));
  const start = $from.before();
  tr.replaceWith(start, $from.after(), [toc, state.schema.nodes.paragraph.create()]);
  tr.setSelection(TextSelection.create(tr.doc, start + toc.nodeSize + 1));
  return true;
}

/** /toc + space/Enter creates a dynamic block, not a copied list of headings. */
export const AutomaticTOC = Extension.create({
  name: "automaticTOC",
  priority: 1100,
  addInputRules() {
    return [new InputRule({ find: /^\/toc[ \u00a0]$/, handler: ({ state }) => {
      if (this.editor.view.composing) return null;
      return insertTOC(state, state.tr) ? undefined : null;
    } })];
  },
  addKeyboardShortcuts() {
    return { Enter: () => {
      if (this.editor.view.composing) return false;
      const tr = this.editor.state.tr;
      if (!insertTOC(this.editor.state, tr)) return false;
      this.editor.view.dispatch(tr.scrollIntoView());
      return true;
    } };
  },
});
