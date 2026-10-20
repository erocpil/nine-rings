import { EditorSelection, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

export interface SourceWordRange {
  from: number;
  to: number;
}

export interface SourceWordMatch extends SourceWordRange {
  line: number;
  text: string;
}

export interface SourceWordOccurrences {
  enabled: boolean;
  word: string;
  activeFrom: number;
  matches: SourceWordMatch[];
}

const wordCharacter = /[\p{L}\p{N}_]/u;

export function sourceWordAt(source: string, position: number): SourceWordRange | null {
  const point = Math.max(0, Math.min(source.length, position));
  let start = point;
  let end = point;
  if (start < source.length && !wordCharacter.test(source[start] ?? "") && start > 0 && wordCharacter.test(source[start - 1] ?? "")) start -= 1;
  if (start >= source.length || !wordCharacter.test(source[start] ?? "")) return null;
  while (start > 0 && wordCharacter.test(source[start - 1] ?? "")) start -= 1;
  end = start;
  while (end < source.length && wordCharacter.test(source[end] ?? "")) end += 1;
  return { from: start, to: end };
}

export function findSourceWordMatches(source: string, word: string): SourceWordMatch[] {
  if (!word) return [];
  const matches: SourceWordMatch[] = [];
  let from = 0;
  let line = 1;
  let lineScanFrom = 0;
  let lineStart = 0;
  while (from <= source.length - word.length) {
    const index = source.indexOf(word, from);
    if (index < 0) break;
    const between = source.slice(lineScanFrom, index);
    line += (between.match(/\n/g)?.length ?? 0);
    const lastNewline = between.lastIndexOf("\n");
    if (lastNewline >= 0) lineStart = lineScanFrom + lastNewline + 1;
    lineScanFrom = index;
    const before = index === 0 ? "" : source[index - 1] ?? "";
    const after = source[index + word.length] ?? "";
    if ((!before || !wordCharacter.test(before)) && (!after || !wordCharacter.test(after))) {
      const lineEndIndex = source.indexOf("\n", index + word.length);
      const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
      matches.push({
        from: index,
        to: index + word.length,
        line,
        text: source.slice(lineStart, lineEnd).trim(),
      });
    }
    from = index + Math.max(1, word.length);
  }
  return matches;
}

const setEnabled = StateEffect.define<boolean>();
const setWord = StateEffect.define<{ word: string; activeFrom: number }>();

const occurrenceField = StateField.define<SourceWordOccurrences>({
  create: () => ({ enabled: false, word: "", activeFrom: -1, matches: [] }),
  update(value, transaction) {
    let enabled = value.enabled;
    let word = value.word;
    let activeFrom = value.activeFrom;
    for (const effect of transaction.effects) {
      if (effect.is(setEnabled)) {
        enabled = effect.value;
        if (!enabled) { word = ""; activeFrom = -1; }
      } else if (effect.is(setWord)) {
        word = effect.value.word;
        activeFrom = effect.value.activeFrom;
      }
    }
    if (!enabled || !word) return { enabled, word, activeFrom, matches: [] };
    if (!transaction.docChanged && word === value.word && activeFrom === value.activeFrom && enabled === value.enabled) return value;
    const matches = findSourceWordMatches(transaction.newDoc.toString(), word);
    if (transaction.docChanged && !matches.some(match => match.from === activeFrom)) {
      const mapped = transaction.changes.mapPos(activeFrom, 1);
      activeFrom = mapped;
    }
    return { enabled, word, activeFrom, matches };
  },
  provide(field) {
    return EditorView.decorations.from(field, occurrences => {
      return Decoration.set(occurrences.matches.map(match => Decoration.mark({
        class: match.from === occurrences.activeFrom ? "cm-source-word-match cm-source-word-match-active" : "cm-source-word-match",
      }).range(match.from, match.to)), true);
    });
  },
});

export const sourceWordOccurrences = [
  occurrenceField,
  EditorView.domEventHandlers({
    click(event, view) {
      const state = view.state.field(occurrenceField);
      if (!state.enabled) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return false;
      const range = sourceWordAt(view.state.doc.toString(), position);
      const word = range ? view.state.sliceDoc(range.from, range.to) : "";
      view.dispatch({ effects: setWord.of({
        word,
        activeFrom: range?.from ?? -1,
      }) });
      if (event.ctrlKey || event.metaKey) {
        if (!range) return false;
        view.dom.dispatchEvent(new CustomEvent("nr:source-word-open", {
          bubbles: true,
          detail: { word, from: range.from },
        }));
        event.preventDefault();
        return true;
      }
      return false;
    },
  }),
  EditorView.updateListener.of(update => {
    if (!update.transactions.some(transaction => transaction.effects.some(effect => effect.is(setWord) || effect.is(setEnabled)))) return;
    update.view.dom.dispatchEvent(new CustomEvent("nr:source-word-update"));
  }),
];

export function setSourceWordEnabled(view: EditorView, enabled: boolean) {
  if (view.state.field(occurrenceField).enabled === enabled) return;
  view.dispatch({ effects: setEnabled.of(enabled) });
}

export function sourceWordState(view: EditorView): SourceWordOccurrences {
  return view.state.field(occurrenceField);
}

export function selectSourceWordAt(view: EditorView, position: number): SourceWordRange | null {
  const range = sourceWordAt(view.state.doc.toString(), position);
  view.dispatch({
    ...(range ? { selection: EditorSelection.cursor(range.from) } : {}),
    effects: setWord.of({
      word: range ? view.state.sliceDoc(range.from, range.to) : "",
      activeFrom: range?.from ?? -1,
    }),
  });
  return range;
}

export function focusSourceWordMatch(view: EditorView, match: SourceWordMatch) {
  view.dispatch({
    selection: EditorSelection.range(match.from, match.to),
    effects: setWord.of({ word: sourceWordState(view).word, activeFrom: match.from }),
    scrollIntoView: true,
  });
  view.focus();
}
