import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node } from "@tiptap/pm/model";
import { whitespaceTokens, type WhitespaceMode } from "../lib/whitespace-markers";

const key = new PluginKey<{ mode: WhitespaceMode; decorations: DecorationSet }>("workspaceWhitespace");
function decorations(doc: Node, mode: WhitespaceMode) {
  if (mode === "off") return DecorationSet.empty;
  const result: Decoration[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const value = child.isText ? child.text! : child.type.name === "hardBreak" ? "\n" : "\ufffc";
      for (let index = 0; index < value.length; index++) positions.push(position + 1 + offset + index);
      text += value;
    });
    for (const token of whitespaceTokens(text, mode)) {
      const from = positions[token.offset];
      if (token.kind === "newline") {
        result.push(Decoration.widget(from, () => {
          const marker = document.createElement("span");
          marker.className = "workspace-ws-newline";
          marker.textContent = "↵";
          marker.setAttribute("aria-hidden", "true");
          marker.contentEditable = "false";
          return marker;
        }, { side: -1, key: `newline:${from}`, ignoreSelection: true }));
      } else {
        result.push(Decoration.inline(from, from + 1, { class: `workspace-ws-${token.kind}` }));
      }
    }
    return false;
  });
  return DecorationSet.create(doc, result);
}

export const WorkspaceWhitespace = Extension.create({
  name: "workspaceWhitespace",
  addProseMirrorPlugins: () => [new Plugin({
    key,
    state: {
      init: () => ({ mode: "off" as WhitespaceMode, decorations: DecorationSet.empty }),
      apply: (transaction, previous) => {
        const mode = (transaction.getMeta(key) as WhitespaceMode | undefined) ?? previous.mode;
        return transaction.docChanged || mode !== previous.mode
          ? { mode, decorations: decorations(transaction.doc, mode) } : previous;
      },
    },
    props: { decorations: state => key.getState(state)?.decorations },
  })],
});

export function setWorkspaceWhitespace(editor: Editor, mode: WhitespaceMode) {
  if (key.getState(editor.state)?.mode === mode) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, mode));
}
