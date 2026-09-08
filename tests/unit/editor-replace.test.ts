import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { createReplacementTransaction } from "../../src/lib/editor-replace";
import { findMatchesInTextSegments } from "../../src/extensions/SearchHighlights";

const schema = new Schema({ nodes: {
  doc: { content: "block+" },
  paragraph: { content: "inline*", group: "block" },
  heading: { content: "inline*", group: "block", attrs: { level: { default: 2 } } },
  text: { group: "inline" },
}, marks: { bold: {} } });

describe("literal editor replacement", () => {
  it("keeps block structure and first-character marks, undoing all replacements together", () => {
    const original = schema.node("doc", null, [
      schema.node("heading", { level: 3 }, [schema.text("foo", [schema.mark("bold")]), schema.text("bar rest")]),
      schema.node("paragraph", null, [schema.text("FOOBAR")]),
    ]);
    let state = EditorState.create({ doc: original, plugins: [history()] });
    const result = createReplacementTransaction(state, "foobar", "$&");
    expect(result.count).toBe(2);
    state = state.apply(result.transaction);
    expect(state.doc.textContent).toBe("$& rest$&");
    expect(state.doc.firstChild?.attrs.level).toBe(3);
    expect(state.doc.firstChild?.firstChild?.marks[0].type.name).toBe("bold");
    expect(state.doc.lastChild?.type.name).toBe("paragraph");
    expect(undo(state, transaction => { state = state.apply(transaction); })).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
  });
  it("supports spaces, empty replacement, literal symbols and single-match selection", () => {
    const state = EditorState.create({ doc: schema.node("doc", null, [schema.node("paragraph", null, schema.text("a  b  c.*"))]) });
    const result = createReplacementTransaction(state, "  ", "", 1);
    expect(result.count).toBe(1);
    expect(state.apply(result.transaction).doc.textContent).toBe("a  bc.*");
    expect(createReplacementTransaction(state, ".*", "X").count).toBe(1);
    expect(createReplacementTransaction(state, "", "X").count).toBe(0);
    expect(createReplacementTransaction(state, "a", "a").count).toBe(0);
  });
  it("does not cross blocks or mis-map Unicode offsets", () => {
    expect(findMatchesInTextSegments([{ from: 1, text: "İ😀 foo" }], "foo", true)).toEqual([{ from: 5, to: 8 }]);
    expect(findMatchesInTextSegments([{ from: 1, text: "foo" }, { from: 6, text: "bar" }], "foo\nbar", true)).toEqual([]);
  });
});
