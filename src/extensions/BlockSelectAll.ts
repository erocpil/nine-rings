import { Extension } from "@tiptap/core";
import { AllSelection, Plugin, TextSelection } from "@tiptap/pm/state";

/** Select a structured block first, then the document. Native selection is
 * consulted too because readonly views do not always sync their caret to PM. */
export const BlockSelectAll = Extension.create({
  name: "blockSelectAll",
  addProseMirrorPlugins() {
    return [new Plugin({
      view(view) {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.defaultPrevented || event.isComposing || !(event.ctrlKey || event.metaKey)
            || event.altKey || event.shiftKey || event.key.toLowerCase() !== "a") return;
          if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
          const native = view.dom.ownerDocument.getSelection();
          if (!native?.anchorNode || !native.focusNode || !view.dom.contains(native.anchorNode)
            || !view.dom.contains(native.focusNode)) return;
          let anchor: number;
          let head: number;
          try {
            anchor = view.posAtDOM(native.anchorNode, native.anchorOffset);
            head = view.posAtDOM(native.focusNode, native.focusOffset);
          } catch { return; }
          const from = Math.min(anchor, head), to = Math.max(anchor, head);
          const $from = view.state.doc.resolve(from);
          for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (!["codeBlock", "blockquote"].includes(node.type.name)) continue;
            if (to > $from.end(depth)) return;
            const selection = TextSelection.between(
              view.state.doc.resolve($from.start(depth)),
              view.state.doc.resolve($from.end(depth)),
            );
            const next = from <= selection.from && to >= selection.to
              ? new AllSelection(view.state.doc) : selection;
            event.preventDefault();
            event.stopPropagation();
            view.dispatch(view.state.tr.setSelection(next));
            view.focus();
            return;
          }
        };
        // Native readonly selection may leave focus on body rather than editor.
        view.dom.ownerDocument.addEventListener("keydown", onKeyDown, true);
        return { destroy: () => view.dom.ownerDocument.removeEventListener("keydown", onKeyDown, true) };
      },
    })];
  },
});
