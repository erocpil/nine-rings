import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { syntaxTree, matchBrackets, unfoldEffect, foldedRanges } from "@codemirror/language";
import { isolateHistory } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

const markEffect = StateEffect.define<{ name: string; position: number }>();
interface Edit { offset: number; removed: string; inserted: string }
const navigation = StateField.define<{ marks: Map<string, number>; edit: Edit | null }>({
  create: () => ({ marks: new Map(), edit: null }),
  update(value, transaction) {
    const marks = new Map([...value.marks].map(([name, position]) => [name, transaction.changes.mapPos(position)]));
    for (const effect of transaction.effects) if (effect.is(markEffect)) marks.set(effect.value.name, effect.value.position);
    let edit = value.edit;
    if (transaction.docChanged && (transaction.isUserEvent("input.type") || transaction.isUserEvent("delete"))) {
      const edits: Edit[] = [];
      transaction.changes.iterChanges((from, to, _a, _b, inserted) => {
        edits.push({ offset: from - transaction.startState.selection.main.head, removed: transaction.startState.sliceDoc(from, to), inserted: inserted.toString() });
      });
      edit = edits.length === 1 && !/[\r\n]/.test(edits[0].removed + edits[0].inserted) ? edits[0] : null;
    }
    return { marks, edit };
  },
});
export const sourceNavigationExtension: Extension = navigation;

export function setSourceMark(view: EditorView, name: string): boolean {
  if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(name)) return false;
  view.dispatch({ effects: markEffect.of({ name, position: view.state.selection.main.head }) });
  return true;
}
export function sourceMarks(view: EditorView) { return [...(view.state.field(navigation, false)?.marks ?? [])]; }
export function jumpSourceMark(view: EditorView, name: string): boolean {
  const position = view.state.field(navigation, false)?.marks.get(name);
  if (position === undefined) return false;
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  foldedRanges(view.state).between(position, position, (from, to) => { if (from < position && position < to) effects.push(unfoldEffect.of({ from, to })); });
  view.contentDOM?.dispatchEvent(new Event("nr:editor-navigation"));
  view.dispatch({ selection: { anchor: position }, effects, scrollIntoView: true, userEvent: "select.jump" });
  return true;
}
export function repeatSourceEdit(view: EditorView): boolean {
  const edit = view.state.field(navigation, false)?.edit;
  if (!edit || view.composing || view.state.readOnly || !view.state.selection.main.empty) return false;
  const from = view.state.selection.main.head + edit.offset, to = from + edit.removed.length;
  if (from < 0 || to > view.state.doc.length || view.state.sliceDoc(from, to) !== edit.removed) return false;
  view.dispatch({ changes: { from, to, insert: edit.inserted }, selection: { anchor: from + edit.inserted.length }, userEvent: "input.repeat", annotations: isolateHistory.of("full"), scrollIntoView: true });
  return true;
}
export function selectSourceObject(view: EditorView, kind: "brackets" | "quote" | "function"): boolean {
  if (view.composing) return false;
  const point = view.state.selection.main.head;
  for (let node = syntaxTree(view.state).resolveInner(point, -1); node; node = node.parent!) {
    const first = view.state.sliceDoc(node.from, node.from + 1), last = view.state.sliceDoc(node.to - 1, node.to);
    let from = node.from, to = node.to;
    if (kind === "function") { if (!/FunctionDefinition|FunctionDeclaration|MethodDeclaration|MethodDefinition/.test(node.name)) continue; }
    else if (kind === "quote") {
      if (!/String|Char/.test(node.name) || !["\"", "'", "`"].includes(first) || first !== last) continue;
      from++; to--;
    } else {
      if (!"([{".includes(first)) continue;
      const match = matchBrackets(view.state, node.from, 1);
      if (!match?.matched || !match.end || match.end.to !== node.to) continue;
      from++; to--;
    }
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true, userEvent: "select" });
    return true;
  }
  return false;
}
