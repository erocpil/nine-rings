import { EditorView } from "@codemirror/view";

/** Navigation/scroll adapter. The editing surface remains a real CodeMirror view. */
export class SourceEditorHandle extends EventTarget {
  constructor(public view: EditorView) {
    super();
  }
  get selectionStart() {
    return this.view.state.selection.main.from;
  }
  get value() {
    return this.view.state.doc.toString();
  }
  get scrollTop() {
    return this.view.scrollDOM.scrollTop;
  }
  set scrollTop(value: number) {
    this.view.scrollDOM.scrollTop = value;
  }
  focus() {
    this.view.focus();
  }
  setSelectionRange(anchor: number, head: number) {
    this.view.dispatch({ selection: { anchor, head } });
  }
  scrollToOffset(offset: number, center = false) {
    this.view.contentDOM.dispatchEvent(new Event("nr:editor-navigation"));
    this.view.dispatch({
      effects: EditorView.scrollIntoView(
        Math.max(0, Math.min(this.view.state.doc.length, offset)),
        { y: center ? "center" : "start", yMargin: 0 },
      ),
    });
  }
  position(): number {
    const rect = this.view.scrollDOM.getBoundingClientRect();
    return (
      this.view.posAtCoords(
        {
          x: this.view.contentDOM.getBoundingClientRect().left + 12,
          y: rect.top + 2,
        },
        false,
      ) ?? this.view.viewport.from
    );
  }
}
