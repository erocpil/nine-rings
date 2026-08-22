import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const pluginKey = new PluginKey<DecorationSet>("standaloneStrongLabel");

/** 仅当段落中的全部可见内容都带 bold mark 时，才视为独立小节标签。 */
export function isStandaloneStrongLabel(node: ProseMirrorNode): boolean {
  if (node.type.name !== "paragraph" || node.childCount === 0) return false;
  let hasVisibleText = false;
  let fullyStrong = true;
  node.forEach((child) => {
    if (!child.isText || !child.text) {
      fullyStrong = false;
      return;
    }
    if (child.text.trim().length > 0) hasVisibleText = true;
    if (!child.marks.some((mark) => mark.type.name === "bold")) fullyStrong = false;
  });
  return hasVisibleText && fullyStrong;
}

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.forEach((node, position) => {
    if (!isStandaloneStrongLabel(node)) return;
    decorations.push(Decoration.node(position, position + node.nodeSize, {
      class: "standalone-strong-label",
    }));
  });
  return decorations.length > 0
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}

/** 为纯粗体段落添加精确语义 class，避免 CSS :only-child 忽略文本节点。 */
export const StandaloneStrongLabel = Extension.create({
  name: "standaloneStrongLabel",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: pluginKey,
      state: {
        init: (_, state) => buildDecorations(state.doc),
        apply(transaction, previous, _oldState, nextState) {
          return transaction.docChanged ? buildDecorations(nextState.doc) : previous;
        },
      },
      props: {
        decorations: (state) => pluginKey.getState(state) ?? DecorationSet.empty,
      },
    })];
  },
});
