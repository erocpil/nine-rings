import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
import { candidateBodyProjection } from "../../src/lib/sync/body-projection";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
const schema = getSchema([DocumentStarterKit]);
it.each(["Next", "Next\nrest"])(
  "certifies an implicit leading hard break with stable remaining text: %j",
  (tail) => {
    const body = {
      ops: [
        { insert: "Heading" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "Before", attributes: { bold: true } },
        { insert: "\n" + tail },
        { insert: "\n" },
      ],
    };
    const source = JSON.stringify(body);
    expect(isCertifiedStructuredBody(body)).toBe(true);
    const doc = schema.nodeFromJSON(deltaToProseMirror(body));
    doc.check();
    expect(doc.child(1).child(1).type.name).toBe("hardBreak");
    expect(doc.child(1).child(2).textContent).toBe(tail);
    const saved = proseMirrorToDelta(doc.toJSON());
    expect(schema.nodeFromJSON(deltaToProseMirror(saved)).eq(doc)).toBe(true);
    expect(candidateBodyProjection(saved)).not.toEqual(
      candidateBodyProjection(body),
    );
    let state = EditorState.create({ schema, doc, plugins: [history()] });
    state = state.apply(state.tr.insertText("Edit", 1));
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(JSON.stringify(body)).toBe(source);
  },
);
it("does not reinterpret multiline code as a hard break", () => {
  const body = {
    ops: [
      { insert: "\nCode\nnext" },
      { insert: "\n", attributes: { "code-block": true } },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  expect(doc.firstChild?.type.name).toBe("codeBlock");
  expect(doc.firstChild?.textContent).toBe("\nCode\nnext");
});
it("rejects unstable successive leading breaks and invalid multiline marks", () => {
  for (const op of [
    { insert: "\n\nNext" },
    { insert: "\nNext", attributes: { bold: false } },
  ])
    expect(
      isCertifiedStructuredBody({
        ops: [
          { insert: "Heading" },
          { insert: "\n", attributes: { header: 2 } },
          op,
          { insert: "\n" },
        ],
      }),
    ).toBe(false);
});

it("preserves the list split implied by legacy leading breaks", () => {
  const body = {
    ops: [
      { insert: "First" },
      { insert: "\n", attributes: { list: "ordered", listStart: 1 } },
      { insert: "Second before" },
      { insert: "\nafter" },
      { insert: "\n", attributes: { list: "ordered", listStart: 2 } },
      { insert: "Third" },
      { insert: "\n", attributes: { list: "ordered", listStart: 3 } },
    ],
  };
  const source = JSON.stringify(body);
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  doc.check();
  expect(doc.childCount).toBe(2);
  expect(doc.child(0).childCount).toBe(1);
  expect(doc.child(1).childCount).toBe(2);
  expect(doc.child(1).attrs.start).toBe(2);
  const saved = proseMirrorToDelta(doc.toJSON());
  expect(schema.nodeFromJSON(deltaToProseMirror(saved)).eq(doc)).toBe(true);
  expect(JSON.stringify(body)).toBe(source);
});

it("reports only a fixed diagnostic category for failed certification", async () => {
  const { inspectStructuredBody } =
    await import("../../src/lib/sync/structured-body-policy");
  expect(inspectStructuredBody({ ops: [] })).toBe("invalid-shape");
  expect(
    inspectStructuredBody({
      ops: [
        { insert: "Heading" },
        { insert: "\n", attributes: { header: 2 } },
        { insert: "\n\nPrivate text must not appear in diagnostics" },
        { insert: "\n" },
      ],
    }),
  ).toBe("changed-tree");
});
