import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { collapsedHeadingContentRanges, extractHeadingSections } from "../lib/heading-fold";

export interface HeadingFoldState {
  collapsedKeys: Set<string>;
  decorations: DecorationSet;
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

function buildFoldDecorations(doc: ProseMirrorNode, collapsedKeys: Set<string>): DecorationSet {
  const ranges = collapsedHeadingContentRanges(doc, collapsedKeys);
  if (ranges.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  let rangeIndex = 0;
  doc.forEach((node, pos) => {
    while (rangeIndex < ranges.length && pos >= ranges[rangeIndex].to) rangeIndex += 1;
    const range = ranges[rangeIndex];
    if (range && pos >= range.from && pos < range.to) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "heading-fold-hidden" }));
    }
  });
  return DecorationSet.create(doc, decorations);
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
          const collapsedKeys = new Set(options.initialCollapsedKeys.filter((key) => valid.has(key)));
          return { collapsedKeys, decorations: buildFoldDecorations(state.doc, collapsedKeys) };
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
          if (sameKeys(collapsed, previous.collapsedKeys) && !transaction.docChanged) return previous;
          return {
            collapsedKeys: collapsed,
            decorations: buildFoldDecorations(nextState.doc, collapsed),
          };
        },
      },
      props: {
        decorations(state) {
          return headingFoldPluginKey.getState(state)?.decorations ?? null;
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

export function getCollapsedHeadingKeys(editor: Editor): ReadonlySet<string> {
  return headingFoldPluginKey.getState(editor.state)?.collapsedKeys ?? new Set<string>();
}

export function getCollapsedHeadingPositions(editor: Editor): ReadonlySet<number> {
  const collapsedKeys = getCollapsedHeadingKeys(editor);
  return new Set(extractHeadingSections(editor.state.doc)
    .filter((section) => collapsedKeys.has(section.key))
    .map((section) => section.pos));
}

export function toggleHeadingFold(editor: Editor, position: number): boolean {
  return toggleHeadingFoldInView(editor.view, position);
}

/** 供编辑器插件直接切换折叠，避免为键盘命令构造 Tiptap Editor 包装。 */
export function toggleHeadingFoldInView(view: import("@tiptap/pm/view").EditorView, position: number): boolean {
  const { state } = view;
  const section = extractHeadingSections(state.doc).find((item) => item.pos === position);
  if (!section || section.end <= section.headingEnd) return false;
  const folded = Boolean(headingFoldPluginKey.getState(state)?.collapsedKeys.has(section.key));
  let transaction = state.tr;
  if (!folded && state.selection.head >= section.headingEnd && state.selection.head < section.end) {
    transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(section.headingEnd - 1), -1));
  }
  view.dispatch(transaction.setMeta(headingFoldPluginKey, { type: "toggle", key: section.key } satisfies HeadingFoldMeta).scrollIntoView());
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
