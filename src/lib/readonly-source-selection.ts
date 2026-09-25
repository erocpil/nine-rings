import { EditorView, layer, RectangleMarker } from "@codemirror/view";

/** Keep native selection/callouts in readonly source; draw only its caret. */
export const readonlySourceSelection = [
  layer({
    above: true,
    class: "cm-cursorLayer",
    markers(view) {
      const range = view.state.selection.main;
      return range.empty
        ? RectangleMarker.forRange(view, "cm-cursor cm-cursor-primary", range)
        : [];
    },
    update(update, dom) {
      if (update.selectionSet)
        dom.style.animationName = dom.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink";
      return update.docChanged || update.selectionSet || update.focusChanged;
    },
  }),
  EditorView.domEventHandlers({
    click(event, view) {
      if (!view.contentDOM.contains(event.target as Node)) return false;
      // Long-press, double-click and drag selections belong to the browser.
      if (!window.getSelection()?.isCollapsed) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos !== null) {
        view.contentDOM.focus({ preventScroll: true });
        view.dispatch({ selection: { anchor: pos } });
      }
      return false;
    },
    copy(event, view) {
      const selection = window.getSelection();
      if (!event.clipboardData || !selection || selection.isCollapsed ||
          !view.contentDOM.contains(selection.anchorNode) ||
          !view.contentDOM.contains(selection.focusNode)) return false;
      // Read the native endpoints directly: iOS can dispatch copy before its
      // selectionchange has reached CM. Model text retains exact line breaks.
      const anchor = view.posAtDOM(selection.anchorNode!, selection.anchorOffset);
      const head = view.posAtDOM(selection.focusNode!, selection.focusOffset);
      event.clipboardData.setData("text/plain", view.state.sliceDoc(Math.min(anchor, head), Math.max(anchor, head)));
      event.preventDefault();
      return true;
    },
  }),
];
