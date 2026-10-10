import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  foldable,
} from "@codemirror/language";
import { sourceHeadingFoldEffects } from "../../src/lib/source-heading-fold";

const doc =
  "# One\nintro\n## Two\nbody\n### Three\nnested\n## Four\nbody\n# Five\ntail\n```\n# not a heading\n```";
function ranges(state: EditorState) {
  const result: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    result.push(from);
  });
  return result.sort((a, b) => a - b);
}
describe("source heading level folding", () => {
  it("folds H2 and deeper, opens ancestors, and preserves readonly source", () => {
    let state = EditorState.create({
      doc,
      extensions: [markdown(), codeFolding(), EditorState.readOnly.of(true)],
    });
    state = state.update({
      effects: sourceHeadingFoldEffects(state, 1, true)!,
    }).state;
    state = state.update({
      effects: sourceHeadingFoldEffects(state, 2, true)!,
    }).state;
    expect(ranges(state)).toEqual([
      doc.indexOf("## Two") + 6,
      doc.indexOf("### Three") + 9,
      doc.indexOf("## Four") + 7,
    ]);
    expect(state.doc.toString()).toBe(doc);
  });
  it("expands through H2 while retaining deeper heading and code folds", () => {
    let state = EditorState.create({
      doc,
      extensions: [markdown(), codeFolding()],
    });
    const line = state.doc.lineAt(doc.indexOf("```"));
    const code = foldable(state, line.from, line.to)!;
    state = state.update({ effects: foldEffect.of(code) }).state;
    state = state.update({
      effects: sourceHeadingFoldEffects(state, 1, true)!,
    }).state;
    state = state.update({
      effects: sourceHeadingFoldEffects(state, 2, false)!,
    }).state;
    expect(ranges(state)).toEqual([doc.indexOf("### Three") + 9, code.from]);
  });
  it("limits expansion even when only the outer heading was originally folded", () => {
    let state = EditorState.create({
      doc,
      extensions: [markdown(), codeFolding()],
    });
    const line = state.doc.line(1);
    const outer = foldable(state, line.from, line.to)!;
    state = state.update({ effects: foldEffect.of(outer) }).state;
    state = state.update({
      effects: sourceHeadingFoldEffects(state, 2, false)!,
    }).state;
    expect(ranges(state)).toEqual([doc.indexOf("### Three") + 9]);
  });
  it("recognizes Setext headings and ignores heading-like fenced text", () => {
    const state = EditorState.create({
      doc: "Title\n=====\nbody\n```\n## fake\n```\n",
      extensions: [markdown(), codeFolding()],
    });
    const next = state.update({
      effects: sourceHeadingFoldEffects(state, 1, true)!,
    }).state;
    expect(ranges(next)).toEqual([11]);
  });
});
