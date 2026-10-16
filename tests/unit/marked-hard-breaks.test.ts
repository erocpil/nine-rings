import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { DocumentLink } from "../../src/extensions/DocumentLink";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { FontSize } from "../../src/extensions/FontSize";
import { InlineHighlight } from "../../src/extensions/MarkdownExtras";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { candidateBodyProjection } from "../../src/lib/sync/body-projection";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
const schema = getSchema([
  DocumentStarterKit,
  TextStyle,
  Color,
  FontSize,
  DocumentLink,
  InlineHighlight,
]);
const marks: Record<string, unknown>[] = [
  { bold: true },
  { italic: true },
  { strike: true },
  { code: true },
  { code: true, bold: true },
  { link: "https://example.com/a", linkTitle: "Example" },
  { color: "rgb(34, 165, 119)", size: "large" },
  { highlight: true, background: "#aabbcc" },
];
it.each(marks)(
  "retains leading-break marks in a real editor through save/reload and undo: %j",
  (attrs) => {
    const body = {
      ops: [
        { insert: "Heading" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "Before" },
        { insert: "\nAfter", attributes: attrs },
        { insert: "\n" },
      ],
    };
    const source = JSON.stringify(body);
    expect(isCertifiedStructuredBody(body)).toBe(true);
    const doc = schema.nodeFromJSON(deltaToProseMirror(body));
    doc.check();
    const line = doc.child(1);
    expect(line.child(1).type.name).toBe("hardBreak");
    expect(line.child(1).marks).toEqual(line.child(2).marks);
    expect(line.child(1).marks.length).toBeGreaterThan(0);
    let state = EditorState.create({ schema, doc, plugins: [history()] });
    state = state.apply(state.tr.insertText("Edit", 1));
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    const saved = proseMirrorToDelta(state.doc.toJSON());
    expect(saved.ops.find((op) => op.attributes?.["hard-break"])).toEqual({
      insert: "\n",
      attributes: { ...attrs, "hard-break": true },
    });
    expect(schema.nodeFromJSON(deltaToProseMirror(saved)).eq(doc)).toBe(true);
    expect(
      isCertifiedStructuredBody(saved as unknown as Record<string, unknown>),
    ).toBe(true);
    expect(
      candidateBodyProjection(proseMirrorToDelta(deltaToProseMirror(saved))),
    ).toEqual(candidateBodyProjection(saved));
    expect(JSON.stringify(body)).toBe(source);
  },
);
it("retains inline-code break marks within a continuous legacy ordered list", () => {
  const body = {
    ops: [
      { insert: "First" },
      { insert: "\n", attributes: { list: "ordered", listStart: 1 } },
      { insert: "Before" },
      { insert: "\nCode", attributes: { code: true } },
      { insert: "\n", attributes: { list: "ordered", listStart: 2 } },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  doc.check();
  expect(doc.childCount).toBe(1);
  expect(doc.firstChild?.childCount).toBe(2);
  expect(doc.firstChild?.attrs.start).toBe(1);
  expect(
    schema
      .nodeFromJSON(deltaToProseMirror(proseMirrorToDelta(doc.toJSON())))
      .eq(doc),
  ).toBe(true);
});
