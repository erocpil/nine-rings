import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
import { candidateBodyProjection } from "../../src/lib/sync/body-projection";
const schema = getSchema([DocumentStarterKit]);

it.each([{}, { bold: true }, { italic: true }])(
  "certifies a legacy rule terminator before text without changing content %j",
  (attributes) => {
    const body = {
      ops: [
        { insert: { hr: true } },
        { insert: "Following text", attributes },
        { insert: "\n", attributes: { header: 2 } },
      ],
    };
    const before = JSON.stringify(body);
    expect(isCertifiedStructuredBody(body)).toBe(true);
    const doc = schema.nodeFromJSON(deltaToProseMirror(body));
    doc.check();
    expect(doc.childCount).toBe(2);
    expect(doc.child(1).textContent).toBe("Following text");
    expect(doc.child(1).type.name).toBe("heading");
    const canonical = proseMirrorToDelta(doc.toJSON());
    expect(canonical.ops[1]).toEqual({ insert: "\n" });
    expect(schema.nodeFromJSON(deltaToProseMirror(canonical)).eq(doc)).toBe(
      true,
    );
    expect(JSON.stringify(body)).toBe(before);
    // Source projection still distinguishes actual bytes/operations for review and acceptance.
    expect(candidateBodyProjection(body)).not.toEqual(
      candidateBodyProjection(canonical),
    );
  },
);
it("combines inferred rule and list boundaries conservatively", () => {
  const body = {
    ops: [
      { insert: { hr: true } },
      { insert: "Item" },
      { insert: "\n", attributes: { list: "bullet" } },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(true);
});
it("preserves intentional blank paragraphs after an explicit rule boundary", () => {
  const body = {
    ops: [
      { insert: { hr: true } },
      { insert: "\n" },
      { insert: "\n" },
      { insert: "Text" },
      { insert: "\n" },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  expect(doc.childCount).toBe(3);
  expect(doc.child(1).textContent).toBe("");
});
it("does not ignore line breaks, malformed embeds or absent document endings", () => {
  for (const body of [
    { ops: [{ insert: { hr: true } }, { insert: "\nText" }, { insert: "\n" }] },
    {
      ops: [
        { insert: { hr: true } },
        { insert: "\nText Next", attributes: { bold: true } },
        { insert: "\n" },
      ],
    },
    {
      ops: [
        { insert: { hr: true, extra: true } },
        { insert: "Text" },
        { insert: "\n" },
      ],
    },
    {
      ops: [
        { insert: { hr: true }, attributes: { unknown: true } },
        { insert: "Text" },
        { insert: "\n" },
      ],
    },
    { ops: [{ insert: { hr: true } }, { insert: "Text" }] },
    { ops: [{ insert: { hr: true } }] },
  ])
    expect(isCertifiedStructuredBody(body)).toBe(false);
});

it("certifies an omitted rule boundary before another block, not an inline atom", () => {
  for (const insert of [{ hr: true }, { mathBlock: "x^2" }]) {
    const body = {
      ops: [{ insert: { hr: true } }, { insert }, { insert: "\n" }],
    };
    const source = JSON.stringify(body);
    expect(isCertifiedStructuredBody(body)).toBe(true);
    expect(JSON.stringify(body)).toBe(source);
  }
  expect(
    isCertifiedStructuredBody({
      ops: [
        { insert: { hr: true } },
        { insert: { mathInline: "x" } },
        { insert: "\n" },
      ],
    }),
  ).toBe(false);
});
