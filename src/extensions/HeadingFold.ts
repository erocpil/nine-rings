import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import {
  collapsedHeadingContentRanges,
  collapsedHeadingKeysForAll,
  extractHeadingSections,
  headingSectionAtPosition,
  topLevelBlocksInHeadingFoldRanges,
  type HeadingSection,
} from "../lib/heading-fold";

export interface HeadingFoldState {
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
let foldScopeCounter = 0;

function sameKeys(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

function hiddenChildRanges(
  doc: import("@tiptap/pm/model").Node,
  collapsedKeys: ReadonlySet<string>,
): Array<{ from: number; to: number }> {
  const ranges = collapsedHeadingContentRanges(doc, collapsedKeys);
  const blocks = topLevelBlocksInHeadingFoldRanges(doc, ranges);
  const children: Array<{ from: number; to: number }> = [];
  for (const block of blocks) {
    const child = block.index + 1;
    const previous = children[children.length - 1];
    if (previous && child === previous.to + 1) previous.to = child;
    else children.push({ from: child, to: child });
  }
  return children;
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
          return { collapsedKeys };
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
          return { collapsedKeys: collapsed };
        },
      },
      view(editorView) {
        const ownerDocument = editorView.dom.ownerDocument;
        const scope = `nr-heading-fold-${++foldScopeCounter}`;
        const style = ownerDocument.createElement("style");
        style.setAttribute("data-heading-fold-style", scope);
        style.setAttribute("data-pdf-exclude", "true");
        ownerDocument.head.append(style);
        editorView.dom.setAttribute("data-heading-fold-scope", scope);
        const supportsFilteredNthChild = ownerDocument.defaultView?.CSS?.supports(
          "selector(:nth-child(1 of *))",
        ) ?? false;
        const actualEditorChild = ":not(.ProseMirror-gapcursor, .ProseMirror-widget, .ProseMirror-separator)";
        const nthChild = (expression: string) => supportsFilteredNthChild
          ? `:nth-child(${expression} of ${actualEditorChild})`
          : `:nth-child(${expression})`;

        let previous = "";
        let previousVisibility = "";
        const updateVisibility = (view: import("@tiptap/pm/view").EditorView) => {
          const collapsedKeys = headingFoldPluginKey.getState(view.state)?.collapsedKeys ?? new Set<string>();
          const ranges = hiddenChildRanges(view.state.doc, collapsedKeys);
          const selector = `[data-heading-fold-scope="${scope}"]`;
          const css = ranges.length === 0
            ? ""
            : `${ranges.map(({ from, to }) => (
              `${selector} > ${nthChild(`n + ${from}`)}${nthChild(`-n + ${to}`)}`
            )).join(",\n")} { display: none !important; }`;
          if (css === previousVisibility) return;
          previousVisibility = css;
          style.textContent = css;
        };
        updateVisibility(editorView);
        return {
          update(view) {
            updateVisibility(view);
            const keys = [...(headingFoldPluginKey.getState(view.state)?.collapsedKeys ?? [])].sort();
            const serialized = keys.join("\n");
            if (serialized === previous) return;
            previous = serialized;
            options.onChange?.(keys);
          },
          destroy() {
            if (editorView.dom.getAttribute("data-heading-fold-scope") === scope) {
              editorView.dom.removeAttribute("data-heading-fold-scope");
            }
            style.remove();
          },
        };
      },
    })];
  },
});

export function isHeadingFolded(editor: Editor, position: number): boolean {
  const section = headingSectionAtPosition(extractHeadingSections(editor.state.doc), position);
  if (section?.pos !== position) return false;
  return Boolean(section && headingFoldPluginKey.getState(editor.state)?.collapsedKeys.has(section.key));
}

export function getCollapsedHeadingKeys(editor: Editor): ReadonlySet<string> {
  return headingFoldPluginKey.getState(editor.state)?.collapsedKeys ?? new Set<string>();
}

export function getCollapsedHeadingPositions(editor: Editor): ReadonlySet<number> {
  const collapsedKeys = getCollapsedHeadingKeys(editor);
  // 未折叠是最常见状态。避免 gutter 初始化和窗口变化时为了得到一个
  // 空集合反复遍历整篇大文档。
  if (collapsedKeys.size === 0) return new Set();
  return new Set(extractHeadingSections(editor.state.doc)
    .filter((section) => collapsedKeys.has(section.key))
    .map((section) => section.pos));
}

export function toggleHeadingFold(editor: Editor, position: number): boolean {
  return toggleHeadingFoldInView(editor.view, position);
}

export function toggleHeadingSectionFold(
  editor: Editor,
  section: HeadingSection,
  scrollIntoView = true,
): boolean {
  return toggleHeadingSectionFoldInView(editor.view, section, scrollIntoView);
}

/** 供编辑器插件直接切换折叠，避免为键盘命令构造 Tiptap Editor 包装。 */
export function toggleHeadingFoldInView(view: import("@tiptap/pm/view").EditorView, position: number): boolean {
  const { state } = view;
  const section = headingSectionAtPosition(extractHeadingSections(state.doc), position);
  if (!section || section.pos !== position) return false;
  return toggleHeadingSectionFoldInView(view, section);
}

function toggleHeadingSectionFoldInView(
  view: import("@tiptap/pm/view").EditorView,
  section: HeadingSection,
  scrollIntoView = true,
): boolean {
  const { state } = view;
  if (section.end <= section.headingEnd) return false;
  const folded = Boolean(headingFoldPluginKey.getState(state)?.collapsedKeys.has(section.key));
  let transaction = state.tr;
  if (!folded && state.selection.head >= section.headingEnd && state.selection.head < section.end) {
    transaction = transaction.setSelection(TextSelection.near(transaction.doc.resolve(section.headingEnd - 1), -1));
  }
  transaction = transaction.setMeta(headingFoldPluginKey, { type: "toggle", key: section.key } satisfies HeadingFoldMeta);
  view.dispatch(scrollIntoView ? transaction.scrollIntoView() : transaction);
  return true;
}

export function setAllHeadingFolds(editor: Editor, folded: boolean) {
  const keys = folded ? collapsedHeadingKeysForAll(extractHeadingSections(editor.state.doc)) : [];
  editor.view.dispatch(editor.state.tr.setMeta(headingFoldPluginKey, { type: "set", keys } satisfies HeadingFoldMeta));
}

export function expandHeadingFoldsAt(editor: Editor, position: number) {
  editor.view.dispatch(editor.state.tr.setMeta(headingFoldPluginKey, { type: "expand-at", position } satisfies HeadingFoldMeta));
}
