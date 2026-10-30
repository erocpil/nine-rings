import { revealSourceTarget } from "./source-navigation-target";
import { selectParentSyntax, cursorMatchingBracket } from "@codemirror/commands";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { findSourceWordMatches, sourceWordAt } from "./source-word-occurrences";

const selections = new WeakMap<EditorView, { doc: EditorState["doc"]; current: EditorSelection; stack: EditorSelection[] }>();

export function expandSourceSelection(view: EditorView): boolean {
  if (view.composing) return false;
  const state = view.state;
  const saved = selections.get(view);
  const stack = saved?.doc === state.doc && saved.current.eq(state.selection) ? saved.stack : [];
  const before = state.selection;
  const word = before.main.empty ? sourceWordAt(state.doc.toString(), before.main.head) : null;
  if (word) view.dispatch({ selection: EditorSelection.single(word.from, word.to), userEvent: "select" });
  else selectParentSyntax(view);
  if (view.state.selection.eq(before)) return false;
  selections.set(view, { doc: state.doc, current: view.state.selection, stack: [...stack, before] });
  return true;
}

export function shrinkSourceSelection(view: EditorView): boolean {
  if (view.composing) return false;
  const saved = selections.get(view);
  if (!saved || saved.doc !== view.state.doc || !saved.current.eq(view.state.selection) || !saved.stack.length) return false;
  const stack = [...saved.stack];
  const selection = stack.pop()!;
  view.dispatch({ selection, scrollIntoView: true, userEvent: "select" });
  selections.set(view, { ...saved, current: selection, stack });
  return true;
}

export function jumpSourceBracket(view: EditorView): boolean {
  if (view.composing) return false;
  view.contentDOM?.dispatchEvent(new Event("nr:editor-navigation"));
  if (!cursorMatchingBracket(view)) return false;
  const effects = revealSourceTarget(view.state, view.state.selection.main.head);
  if (effects.length) view.dispatch({ effects, scrollIntoView: true });
  return true;
}

export function jumpSourceWord(view: EditorView, direction: -1 | 1): boolean {
  if (view.composing) return false;
  const source = view.state.doc.toString();
  const selection = view.state.selection.main;
  const word = sourceWordAt(source, selection.head);
  if (!word) return false;
  const matches = findSourceWordMatches(source, source.slice(word.from, word.to));
  if (matches.length < 2) return false;
  const target = direction > 0
    ? matches.find(match => match.from > word.from) ?? matches[0]
    : [...matches].reverse().find(match => match.from < word.from) ?? matches[matches.length - 1];
  view.contentDOM?.dispatchEvent(new Event("nr:editor-navigation"));
  view.dispatch({ selection: { anchor: target.from }, effects: revealSourceTarget(view.state, target.from), scrollIntoView: true, userEvent: "select.jump" });
  return true;
}

/** Navigate across nonblank lines at the same or shallower indentation. */
export function jumpSourceStructure(view: EditorView, direction: -1 | 1, outer = false): boolean {
  if (view.composing) return false;
  const state = view.state, line = state.doc.lineAt(state.selection.main.head);
  const columns = (text: string) => {
    let width = 0;
    for (const c of /^[\t ]*/.exec(text)![0]) width += c === "\t" ? state.tabSize - width % state.tabSize : 1;
    return width;
  };
  const current = columns(line.text);
  for (let n = line.number + direction; n >= 1 && n <= state.doc.lines; n += direction) {
    const next = state.doc.line(n);
    if (!next.text.trim() || (outer ? columns(next.text) >= current : columns(next.text) > current)) continue;
    view.contentDOM?.dispatchEvent(new Event("nr:editor-navigation"));
    view.dispatch({ selection: { anchor: next.from + /^[\t ]*/.exec(next.text)![0].length }, effects: revealSourceTarget(state, next.from), scrollIntoView: true, userEvent: "select.jump" });
    return true;
  }
  return false;
}
