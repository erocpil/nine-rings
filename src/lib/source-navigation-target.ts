import { foldedRanges, unfoldEffect } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
/** Reveal the target without expanding unrelated regions. */
export function revealSourceTarget(state: EditorState, position: number) {
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  foldedRanges(state).between(position, position, (from, to) => {
    if (from < position && position < to) effects.push(unfoldEffect.of({ from, to }));
  });
  return effects;
}
