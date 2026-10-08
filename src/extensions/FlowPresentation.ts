import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { flowBlockAttributes } from "../lib/flow-presentation";

export const flowPresentationKey = new PluginKey<{
  level: number;
  decorations: DecorationSet;
}>("flowPresentation");
export const FlowPresentation = Extension.create<{ level: number }>({
  name: "flowPresentation",
  addOptions: () => ({ level: 0 }),
  addProseMirrorPlugins() {
    const build = (
      doc: Parameters<typeof flowBlockAttributes>[0],
      level: number,
    ) =>
      DecorationSet.create(
        doc,
        [...flowBlockAttributes(doc, level)].map(([pos, attrs]) =>
          Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, attrs),
        ),
      );
    return [
      new Plugin({
        key: flowPresentationKey,
        state: {
          init: (_, state) => ({
            level: this.options.level,
            decorations: build(state.doc, this.options.level),
          }),
          apply: (tr, previous) => {
            const level = tr.getMeta(flowPresentationKey) ?? previous.level;
            return tr.docChanged || level !== previous.level
              ? { level, decorations: build(tr.doc, level) }
              : previous;
          },
        },
        props: {
          decorations: (state) =>
            flowPresentationKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
