import { Extension } from "@tiptap/core";
import { codeIndentChanges } from "../lib/code-indent";
import { exitCurrentStructuredBlock } from "./StructuredBlockExit";

export const CodeBlockIndent = Extension.create({
  name: "codeBlockIndent",
  priority: 1100,
  addKeyboardShortcuts() {
    const indent = (outdent: boolean) => {
      const { state, view } = this.editor;
      const { $from, $to } = state.selection;
      if ($from.parent.type.name !== "codeBlock") return false;
      if (!this.editor.isEditable) return false;
      if (!$from.sameParent($to)) return false;
      const start = $from.start();
      const changes = codeIndentChanges($from.parent.textContent, $from.parentOffset, $to.parentOffset, outdent);
      const transaction = state.tr;
      for (const change of changes.reverse()) transaction.insertText(change.insert, start + change.from, start + change.to);
      if (changes.length) view.dispatch(transaction.scrollIntoView());
      // Even an unindented first line must not send focus to another control.
      return true;
    };
    return {
      Tab: () => indent(false),
      "Shift-Tab": () => indent(true),
      "Mod-Enter": () => {
        if (!this.editor.isActive("codeBlock")) return false;
        if (!this.editor.isEditable) return true;
        this.editor.commands.setTextSelection(this.editor.state.selection.from);
        return exitCurrentStructuredBlock(this.editor);
      },
    };
  },
});
