import { expect, it } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import { sourceFoldCursor } from "../../src/lib/source-fold-cursor";
const doc = "void outer() {\n  if (ready) {\n    work();\n  }\n}\n// outside\n";
const outer = { from: doc.indexOf("{") + 1, to: doc.lastIndexOf("}") };
const inner = { from: doc.indexOf("{", outer.from) + 1, to: doc.indexOf("}") };
const cursor = doc.indexOf("work") + 3;
const state = (readonly = false) => EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [codeFolding(), sourceFoldCursor, EditorState.readOnly.of(readonly)] });
it.each([false, true])("restores the exact original cursor after unfolding, readonly=%s", readonly => {
  let current = state(readonly);
  current = current.update({ effects: foldEffect.of(outer) }).state;
  expect(current.selection.main.head).toBe(outer.from);
  expect(foldedRanges(current).size).toBe(1);
  current = current.update({ effects: unfoldEffect.of(outer) }).state;
  expect(current.selection.main.head).toBe(cursor);
  expect(foldedRanges(current).size).toBe(0);
});
it("a subsequent explicit cursor movement wins over remembered positions", () => {
  let current = state().update({ effects: foldEffect.of(outer) }).state;
  const moved = doc.indexOf("outside");
  current = current.update({ selection: { anchor: moved }, userEvent: "select.pointer" }).state;
  current = current.update({ effects: unfoldEffect.of(outer) }).state;
  expect(current.selection.main.head).toBe(moved);
});
it("editing cancels old cursor restoration rather than jumping to a stale offset", () => {
  let current = state().update({ effects: foldEffect.of(outer) }).state;
  current = current.update({ changes: { from: 0, insert: "// edit\n" } }).state;
  const now = current.selection.main.head;
  current = current.update({ effects: unfoldEffect.of({ from: outer.from + 8, to: outer.to + 8 }) }).state;
  expect(current.selection.main.head).toBe(now);
});
it("unrelated non-selection transactions and scrolling do not cancel restoration", () => {
  let current = state().update({ effects: foldEffect.of(outer) }).state;
  current = current.update({}).state;
  current = current.update({ effects: unfoldEffect.of(outer) }).state;
  expect(current.selection.main.head).toBe(cursor);
});
it("nested folds restore intermediate visible boundaries, then the original cursor", () => {
  let current = state().update({ effects: foldEffect.of(inner) }).state;
  current = current.update({ effects: foldEffect.of(outer) }).state;
  current = current.update({ effects: unfoldEffect.of(outer) }).state;
  expect(current.selection.main.head).toBe(inner.from);
  expect(foldedRanges(current).size).toBe(1);
  current = current.update({ effects: unfoldEffect.of(inner) }).state;
  expect(current.selection.main.head).toBe(cursor);
});
it("unfolding all prefers the deepest original cursor", () => {
  let current = state().update({ effects: foldEffect.of(inner) }).state;
  current = current.update({ effects: foldEffect.of(outer) }).state;
  current = current.update({ effects: [unfoldEffect.of(inner), unfoldEffect.of(outer)] }).state;
  expect(current.selection.main.head).toBe(cursor);
});
it("unfolding a hidden child defers its original cursor to the still-collapsed parent", () => {
  let current = state().update({ effects: foldEffect.of(inner) }).state;
  current = current.update({ effects: foldEffect.of(outer) }).state;
  current = current.update({ effects: unfoldEffect.of(inner) }).state;
  expect(current.selection.main.head).toBe(outer.from);
  expect(foldedRanges(current).size).toBe(1);
  current = current.update({ effects: unfoldEffect.of(outer) }).state;
  expect(current.selection.main.head).toBe(cursor);
});
it("explicit selection supplied with unfolding takes priority", () => {
  let current = state().update({ effects: foldEffect.of(outer) }).state;
  const moved = doc.indexOf("outside");
  current = current.update({ effects: unfoldEffect.of(outer), selection: { anchor: moved } }).state;
  expect(current.selection.main.head).toBe(moved);
});
it("changing folding depth carries a hidden cursor into a newly folded child", () => {
  let current = state().update({ effects: foldEffect.of(outer) }).state;
  current = current.update({ effects: [unfoldEffect.of(outer), foldEffect.of(inner)] }).state;
  expect(foldedRanges(current).size).toBe(1);
  current = current.update({ effects: unfoldEffect.of(inner) }).state;
  expect(current.selection.main.head).toBe(cursor);
});
