import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
import { candidateBodyProjection } from "../../src/lib/sync/body-projection";
const schema = getSchema([DocumentStarterKit]);
it.each([
  "First\nSecond",
  "First\n\nThird",
  "First\n",
  "中英 Mixed\nNext line",
])("certifies verbatim unmarked text in a structured body: %j", (text) => {
  const body = {
    ops: [{ insert: text }, { insert: "\n", attributes: { header: 2 } }],
  };
  const original = JSON.stringify(body);
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  doc.check();
  expect(doc.child(0).textContent).toBe(text);
  let state = EditorState.create({ schema, doc, plugins: [history()] });
  state = state.apply(state.tr.insertText("Edit", 1));
  expect(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.eq(doc)).toBe(true);
  expect(
    candidateBodyProjection(proseMirrorToDelta(state.doc.toJSON())),
  ).toEqual(candidateBodyProjection(body));
  expect(JSON.stringify(body)).toBe(original);
});
it("still rejects lossy leading breaks, marked multiline text and CR characters", () => {
  for (const op of [
    { insert: "\n\nNext" },
    { insert: "First\nNext", attributes: { bold: true } },
    { insert: "First\r\nNext" },
  ])
    expect(
      isCertifiedStructuredBody({
        ops: [op, { insert: "\n", attributes: { header: 2 } }],
      }),
    ).toBe(false);
});
