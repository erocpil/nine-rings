import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { CodeBlockLineNumbers } from "../../src/extensions/CodeBlockLineNumbers";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { BlockIndent } from "../../src/extensions/BlockIndent";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
  legacyFlatListDelta,
} from "../../src/lib/delta-converter";
import { isCertifiedStructuredBody } from "../../src/lib/sync/structured-body-policy";
const schema = getSchema([
  DocumentStarterKit.configure({ codeBlock: false, blockquote: false }),
  CodeBlockLineNumbers,
  CollapsibleBlockquote,
  BlockIndent,
  MarkdownTaskState,
]);
it("certifies legacy continuation code/quote lines against the current list embed", () => {
  const body = {
    ops: [
      { insert: "First" },
      {
        insert: "\n",
        attributes: { list: "ordered", listStart: 3, "list-block-start": true },
      },
      { insert: "Code" },
      {
        insert: "\n",
        attributes: {
          list: "ordered",
          listStart: 3,
          "list-continuation": true,
          "code-block": true,
          language: "text",
        },
      },
      { insert: "Quote" },
      {
        insert: "\n",
        attributes: {
          list: "ordered",
          listStart: 3,
          "list-continuation": true,
          blockquote: true,
        },
      },
      { insert: "Second" },
      { insert: "\n", attributes: { list: "ordered", listStart: 4 } },
    ],
  };
  const source = JSON.stringify(body);
  expect(isCertifiedStructuredBody(body)).toBe(true);
  const doc = schema.nodeFromJSON(deltaToProseMirror(body));
  doc.check();
  expect(doc.childCount).toBe(1);
  expect(doc.firstChild?.attrs.start).toBe(3);
  expect(doc.firstChild?.firstChild?.childCount).toBe(3);
  const saved = proseMirrorToDelta(doc.toJSON());
  expect(typeof saved.ops[0].insert).toBe("object");
  expect(schema.nodeFromJSON(deltaToProseMirror(saved)).eq(doc)).toBe(true);
  expect(JSON.stringify(body)).toBe(source);
});
it("never accepts stale continuation numbering, unknown fields or changed nesting", () => {
  for (const attributes of [
    {
      list: "ordered",
      listStart: 99,
      "list-continuation": true,
      "code-block": true,
    },
    {
      list: "ordered",
      listStart: 3,
      "list-continuation": true,
      "code-block": true,
      unknown: true,
    },
  ])
    expect(
      isCertifiedStructuredBody({
        ops: [
          { insert: "First" },
          { insert: "\n", attributes: { list: "ordered", listStart: 3 } },
          { insert: "Code" },
          { insert: "\n", attributes },
        ],
      }),
    ).toBe(false);
  expect(() =>
    legacyFlatListDelta({ type: "paragraph", content: [] }),
  ).toThrow();
});
