import { Annotation, EditorSelection, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";

interface FoldCursor { from: number; to: number; selection: EditorSelection }
const key = (range: { from: number; to: number }) => `${range.from}:${range.to}`;
const automatic = Annotation.define<boolean>();
const remember = StateEffect.define<Map<string, FoldCursor>>();
const memory = StateField.define<Map<string, FoldCursor>>({
  create: () => new Map(),
  update(value, transaction) {
    if (transaction.docChanged) return new Map();
    const update = transaction.effects.find(effect => effect.is(remember));
    if (update) return update.value;
    if (transaction.selection && !transaction.annotation(automatic) && !transaction.newSelection.eq(transaction.startState.selection)) return new Map();
    return value;
  },
});

/** Folding projects the cursor to a visible boundary without forgetting its original position.
 * Any subsequent explicit navigation/edit wins over automatic restoration. State belongs to
 * the document's EditorState, so retained file sessions keep their own folding memory.
 */
export const sourceFoldCursor: Extension = [memory, EditorView.updateListener.of(update => {
  if (!update.state.readOnly || !update.selectionSet || !update.transactions.some(transaction => transaction.annotation(automatic))) return;
  const view = update.view, selection = view.dom.ownerDocument.getSelection();
  if (!selection?.anchorNode || !view.contentDOM.contains(selection.anchorNode)) return;
  // A readonly editor can lose native focus when its gutter is clicked. CM then
  // leaves DOM endpoints in removed text; synchronise without taking focus.
  const main = update.state.selection.main;
  const anchor = view.domAtPos(main.anchor), head = view.domAtPos(main.head);
  selection.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
}), EditorState.transactionFilter.of(transaction => {
  if (transaction.docChanged) return transaction;
  const effects = transaction.effects.filter(effect => effect.is(foldEffect) || effect.is(unfoldEffect));
  if (!effects.length) return transaction;
  const previous = transaction.startState;
  // A caller that explicitly chooses another cursor in the same operation owns it.
  if (transaction.selection && !transaction.newSelection.eq(previous.selection)) return transaction;
  const next = new Map(previous.field(memory));
  const ranges = new Map<string, { from: number; to: number }>();
  foldedRanges(previous).between(0, previous.doc.length, (from, to) => { ranges.set(key({ from, to }), { from, to }); });
  const added: FoldCursor[] = [];
  for (const effect of effects) {
    const range = effect.value;
    if (effect.is(foldEffect)) {
      if (!ranges.has(key(range)) && previous.selection.main.head > range.from && previous.selection.main.head < range.to) {
        const saved = { ...range, selection: previous.selection };
        next.set(key(range), saved); added.push(saved);
      }
      ranges.set(key(range), range);
    } else ranges.delete(key(range));
  }
  const revealed: FoldCursor[] = [];
  for (const effect of effects) if (effect.is(unfoldEffect) && !ranges.has(key(effect.value))) {
    const saved = next.get(key(effect.value));
    next.delete(key(effect.value));
    if (saved) {
      const covering = [...ranges.values()].filter(range => saved.selection.main.head > range.from && saved.selection.main.head < range.to);
      if (!covering.length) revealed.push(saved);
      else for (const range of covering) {
        const parent = next.get(key(range));
        next.set(key(range), { ...(parent ?? range), selection: saved.selection });
      }
    }
  }
  // Unfolding several nested regions restores the deepest original cursor, not
  // an intermediate position at the inner region's collapsed boundary.
  revealed.sort((a, b) => (a.to - a.from) - (b.to - b.from));
  let selection = revealed[0]?.selection;
  if (!selection && added.length) selection = EditorSelection.single(Math.min(...added.map(range => range.from)));
  return [transaction, {
    ...(selection ? { selection } : {}),
    effects: remember.of(next), annotations: automatic.of(true),
  }];
})];
