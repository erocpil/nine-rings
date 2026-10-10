import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { describe, expect, it } from "vitest";
import { BlockIndent } from "../../src/extensions/BlockIndent";
import {
  orderedListNumbering,
  renumberOrderedList,
  validListStart,
} from "../../src/lib/ordered-list-numbering";
import {
  proseMirrorToDelta,
  deltaToProseMirror,
} from "../../src/lib/delta-converter";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { mdToDelta } from "../../src/lib/md-parser";

const schema = getSchema([StarterKit, BlockIndent]);
const paragraph = (text: string) =>
  schema.nodes.paragraph.create(null, schema.text(text));
const item = (text: string) =>
  schema.nodes.listItem.create(null, paragraph(text));
const list = (start: number, names: string[], indent = 0) =>
  schema.nodes.orderedList.create({ start, indent }, names.map(item));
function selected(content: ReturnType<typeof list>[], text: string) {
  const doc = schema.nodes.doc.create(null, content);
  let position = 0;
  doc.descendants((node, pos) => {
    if (node.isText && node.text === text) position = pos;
  });
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, position),
    plugins: [history()],
  });
}

describe("ordered list numbering", () => {
  it("continues the preceding sibling at the same indentation, skipping intervening prose", () => {
    const state = selected(
      [
        list(5, ["A", "B"]),
        paragraph("说明"),
        list(20, ["缩进"], 1),
        list(1, ["C", "D"]),
      ],
      "D",
    );
    expect(orderedListNumbering(state)?.continuation).toBe(7);
    const next = state.apply(renumberOrderedList(state, 7, false)!);
    expect(next.doc.lastChild?.attrs.start).toBe(7);
    expect(next.doc.lastChild?.childCount).toBe(2);
    expect(next.selection.$from.parent.textContent).toBe("D");
  });
  it("does not continue an outer or a different container's list", () => {
    const inner = list(1, ["nested"]);
    const outer = schema.nodes.orderedList.create({ start: 3 }, [
      schema.nodes.listItem.create(null, [paragraph("outer"), inner]),
    ]);
    const state = selected([list(1, ["A"]), outer], "nested");
    expect(orderedListNumbering(state)?.continuation).toBeNull();
    const quoted = schema.nodes.blockquote.create(null, list(1, ["quoted"]));
    expect(
      orderedListNumbering(selected([list(8, ["A"]), quoted], "quoted"))
        ?.continuation,
    ).toBeNull();
  });
  it("splits from the current item while preserving prefix, inline content, selection and undo/redo", () => {
    const state = selected([list(5, ["A", "B", "C"])], "B");
    const transaction = renumberOrderedList(state, 10)!;
    const next = state.apply(transaction);
    expect(next.doc.childCount).toBe(2);
    expect(next.doc.firstChild?.attrs.start).toBe(5);
    expect(next.doc.firstChild?.textContent).toBe("A");
    expect(next.doc.lastChild?.attrs.start).toBe(10);
    expect(next.doc.lastChild?.textContent).toBe("BC");
    expect(next.selection.$from.parent.textContent).toBe("B");
    // Positions after the split are shifted, not treated as deleted/replaced.
    expect(transaction.mapping.mapResult(state.selection.from).deleted).toBe(
      false,
    );
    let undone = next;
    expect(
      undo(next, (tr) => {
        undone = next.apply(tr);
      }),
    ).toBe(true);
    expect(undone.doc.toJSON()).toEqual(state.doc.toJSON());
    expect(
      redo(undone, (tr) => {
        undone = undone.apply(tr);
      }),
    ).toBe(true);
    expect(undone.doc.toJSON()).toEqual(next.doc.toJSON());
  });
  it("restarts the first item in place, and restarts a middle item even if the list already starts at 1", () => {
    const state = selected([list(5, ["A", "B"])], "A");
    expect(
      state.apply(renumberOrderedList(state, 1)!).doc.firstChild?.attrs.start,
    ).toBe(1);
    const middle = selected([list(1, ["A", "B"])], "B");
    expect(middle.apply(renumberOrderedList(middle, 1)!).doc.childCount).toBe(
      2,
    );
    expect(renumberOrderedList(selected([list(1, ["A"])], "A"), 1)).toBeNull();
  });
  it("persists the split boundary and starts through Delta and standard Markdown", () => {
    const state = selected([list(3, ["A", "B", "C"])], "B");
    const doc = state.apply(renumberOrderedList(state, 10)!).doc.toJSON();
    const saved = proseMirrorToDelta(doc);
    const restored = deltaToProseMirror(saved);
    const lists = restored.content!.filter(
      (node) => node.type === "orderedList",
    );
    expect(lists.map((node) => node.attrs?.start)).toEqual([3, 10]);
    const markdown = deltaToMarkdown(saved);
    expect(markdown).toContain("3. A");
    expect(markdown).toMatch(/10[.)] B/);
    const imported = deltaToProseMirror(mdToDelta(markdown));
    expect(
      imported
        .content!.filter((node) => node.type === "orderedList")
        .map((node) => node.attrs?.start),
    ).toEqual([3, 10]);
  });
  it("rejects invalid numbers and selections crossing lists, and bounds continuation", () => {
    for (const start of [0, -1, 1.5, NaN, Infinity, 1_000_000_000])
      expect(validListStart(start)).toBe(false);
    expect(validListStart(999_999_999)).toBe(true);
    const state = selected([list(999_999_999, ["A"]), list(1, ["B"])], "B");
    expect(orderedListNumbering(state)?.continuation).toBeNull();
    expect(renumberOrderedList(state, 0)).toBeNull();
    expect(
      renumberOrderedList(selected([list(1, ["A", "B"])], "A"), 999_999_999),
    ).toBeNull();
    const across = state.apply(
      state.tr.setSelection(
        TextSelection.create(state.doc, 3, state.selection.to),
      ),
    );
    expect(orderedListNumbering(across)).toBeNull();
    expect(
      orderedListNumbering(selected([paragraph("plain")], "plain")),
    ).toBeNull();
  });
});
