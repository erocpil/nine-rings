import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { extractHeadingSections } from "../lib/heading-fold";

interface HeadingFoldState {
  collapsedKeys: Set<string>;
}

type HeadingFoldMeta =
  | { type: "toggle"; key: string }
  | { type: "set"; keys: string[] }
  | { type: "expand-at"; position: number };

interface HeadingFoldOptions {
  initialCollapsedKeys: string[];
  onChange?: (keys: string[]) => void;
}

export const headingFoldPluginKey = new PluginKey<HeadingFoldState>("nineRingsHeadingFold");

function sameKeys(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

export const HeadingFold = Extension.create<HeadingFoldOptions>({
  name: "headingFold",
  addOptions() {
    return { initialCollapsedKeys: [] };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [new Plugin<HeadingFoldState>({
      key: headingFoldPluginKey,
      state: {
        init: (_, state) => {
          const valid = new Set(extractHeadingSections(state.doc).map((section) => section.key));
          return { collapsedKeys: new Set(options.initialCollapsedKeys.filter((key) => valid.has(key))) };
        },
        apply(transaction, previous, _oldState, nextState) {
          const meta = transaction.getMeta(headingFoldPluginKey) as HeadingFoldMeta | undefined;
          let collapsed = new Set(previous.collapsedKeys);
          if (meta?.type === "toggle") {
            if (collapsed.has(meta.key)) collapsed.delete(meta.key);
            else collapsed.add(meta.key);
          } else if (meta?.type === "set") {
            collapsed = new Set(meta.keys);
          } else if (meta?.type === "expand-at") {
            const containing = extractHeadingSections(nextState.doc)
              .filter((section) => meta.position > section.pos && meta.position < section.end);
            for (const section of containing) collapsed.delete(section.key);
          }
          if (transaction.docChanged) {
            const valid = new Set(extractHeadingSections(nextState.doc).map((section) => section.key));
            collapsed = new Set([...collapsed].filter((key) => valid.has(key)));
          }
          return sameKeys(collapsed, previous.collapsedKeys) ? previous : { collapsedKeys: collapsed };
        },
      },
      props: {
        decorations(state) {
          const foldState = headingFoldPluginKey.getState(state);
          if (!foldState?.collapsedKeys.size) return null;
          const collapsedSections = extractHeadingSections(state.doc)
            .filter((section) => foldState.collapsedKeys.has(section.key));
          if (!collapsedSections.length) return null;
          const decorations: Decoration[] = [];
          state.doc.forEach((node, pos) => {
            if (collapsedSections.some((section) => pos >= section.headingEnd && pos < section.end)) {
              decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "heading-fold-hidden" }));
            }
          });
          return DecorationSet.create(state.doc, decorations);
        },
      },
      view() {
        let previous = "";
        return {
          update(view) {
            const keys = [...(headingFoldPluginKey.getState(view.state)?.collapsedKeys ?? [])].sort();
            const serialized = keys.join("\n");
            if (serialized === previous) return;
            previous = serialized;
            options.onChange?.(keys);
          },
        };
      },
    })];
  },
});

export function isHeadingFolded(editor: Editor, position: number): boolean {
  const section = extractHeadingSections(editor.state.doc).find((item) => item.pos === position);
  return Boolean(section && headingFoldPluginKey.getState(editor.state)?.collapsedKeys.has(section.key));
}

export function toggleHeadingFold(editor: Editor, position: number): boolean {
  const section = extractHeadingSections(editor.state.doc).find((item) => item.pos === position);
  if (!section || section.end <= section.headingEnd) return false;
  const folded = isHeadingFolded(editor, position);
  let transaction = editor.state.tr;
  if (!folded && editor.state.selection.head >= section.headingEnd && editor.state.selection.head < section.end) {
    transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(section.headingEnd - 1), -1));
  }
  editor.view.dispatch(transaction.setMeta(headingFoldPluginKey, { type: "toggle", key: section.key } satisfies HeadingFoldMeta).scrollIntoView());
  return true;
}

export function setAllHeadingFolds(editor: Editor, folded: boolean) {
  const keys = folded
    ? extractHeadingSections(editor.state.doc).filter((section) => section.end > section.headingEnd).map((section) => section.key)
    : [];
  editor.view.dispatch(editor.state.tr.setMeta(headingFoldPluginKey, { type: "set", keys } satisfies HeadingFoldMeta));
}

export function expandHeadingFoldsAt(editor: Editor, position: number) {
  editor.view.dispatch(editor.state.tr.setMeta(headingFoldPluginKey, { type: "expand-at", position } satisfies HeadingFoldMeta));
}
