import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { SourceEditorHandle } from "../source-editor-handle";
import { mdToDelta } from "../md-parser";
import { deltaToProseMirror } from "../delta-converter";
import type { DocumentEditAdapter } from "../document-edit-sessions";

export function renderedEditAdapter(
  editor: Editor,
  readonly: () => boolean,
): DocumentEditAdapter {
  return {
    editable: () =>
      !editor.isDestroyed &&
      editor.isEditable &&
      !editor.view.composing &&
      !readonly(),
    insert: (range, content) => {
      let nodes;
      if (content.type === "markdown")
        nodes = deltaToProseMirror(mdToDelta(content.value)).content ?? [];
      else if (editor.state.doc.resolve(range.from).parent.type.spec.code)
        nodes = content.value ? [{ type: "text", text: content.value }] : [];
      else
        nodes = content.value
          .split("\n")
          .flatMap((line, index) => [
            ...(index ? [{ type: "hardBreak" }] : []),
            ...(line ? [{ type: "text", text: line }] : []),
          ]);
      if (!nodes.length) {
        if (range.from === range.to) return true;
        return editor
          .chain()
          .command(({ tr }) => {
            closeHistory(tr);
            return true;
          })
          .deleteRange(range)
          .run();
      }
      return editor
        .chain()
        .command(({ tr }) => {
          closeHistory(tr);
          return true;
        })
        .insertContentAt(range, nodes)
        .run();
    },
  };
}
export function sourceEditAdapter(
  handle: SourceEditorHandle,
  readonly: () => boolean,
): DocumentEditAdapter {
  return {
    editable: () =>
      !readonly() &&
      !handle.view.state.readOnly &&
      !handle.view.compositionStarted,
    insert: (range, content) => {
      handle.insertIsolated(range.from, range.to, content.value);
      return true;
    },
  };
}
