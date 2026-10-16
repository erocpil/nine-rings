import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { BlockIndent } from "../../src/extensions/BlockIndent";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
const schema = getSchema([
  DocumentStarterKit.configure({ blockquote: false }),
  CollapsibleBlockquote,
  BlockIndent,
]);
it("certifies flat explicitly indented paragraphs serialized as one quote embed", () => {
  const body = {
    ops: [
      { insert: "First", attributes: { bold: true } },
      {
        insert: "\n",
        attributes: { blockquote: true, "indent-explicit": true },
      },
      { insert: "Second" },
      {
        insert: "\n",
        attributes: { blockquote: true, "indent-explicit": true },
      },
    ],
  };
  const source = JSON.stringify(body);
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  doc.check();
  expect(doc.childCount).toBe(1);
  expect(doc.firstChild?.childCount).toBe(2);
  const saved = proseMirrorToDelta(doc.toJSON());
  expect(typeof saved.ops[0].insert).toBe("object");
  expect(schema.nodeFromJSON(deltaToProseMirror(saved)).eq(doc)).toBe(true);
  expect(JSON.stringify(body)).toBe(source);
});
it("certifies a simple paragraph-only quote embed serialized as flat lines", () => {
  const body = {
    ops: [
      {
        insert: {
          blockquote: {
            version: 1,
            content: [{ insert: "Quote" }, { insert: "\n" }],
          },
        },
      },
      { insert: "\n" },
    ],
  };
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  doc.check();
  expect(
    schema
      .nodeFromJSON(deltaToProseMirror(proseMirrorToDelta(doc.toJSON())))
      .eq(doc),
  ).toBe(true);
});
it("never merges two separately stored adjacent quotes", () => {
  const quote = {
    insert: {
      blockquote: {
        version: 1,
        content: [{ insert: "Quote" }, { insert: "\n" }],
      },
    },
  };
  const body = { ops: [quote, { insert: "\n" }, quote, { insert: "\n" }] };
  expect(deltaToProseMirror(body).content).toHaveLength(2);
  expect(isCertifiedStructuredBody(body)).toBe(false);
});
it("does not hide conflicting per-line indentation or marked leading-newline loss", () => {
  for (const body of [
    {
      ops: [
        { insert: "First" },
        {
          insert: "\n",
          attributes: { blockquote: true, "indent-explicit": true },
        },
        { insert: "Second" },
        { insert: "\n", attributes: { blockquote: true } },
      ],
    },
    {
      ops: [
        { insert: "\nText", attributes: { bold: true } },
        {
          insert: "\n",
          attributes: { blockquote: true, "indent-explicit": true },
        },
      ],
    },
  ])
    expect(isCertifiedStructuredBody(body)).toBe(false);
});
