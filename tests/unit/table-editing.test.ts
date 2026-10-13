import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TableRow from "@tiptap/extension-table-row";
import { TableMap } from "@tiptap/pm/tables";
import {
  ContentSizedTable,
  AlignedTableCell,
  AlignedTableHeader,
} from "../../src/extensions/ContentSizedTable";
import {
  proseMirrorToDelta,
  deltaToProseMirror,
} from "../../src/lib/delta-converter";
import { mdToDelta } from "../../src/lib/md-parser";
import { deltaToMarkdown } from "../../src/lib/markdown-serializer";
import { isTableEmbed } from "../../src/lib/table-embed";
import { normalizeEditorColor } from "../../src/lib/editor-color";
const schema = getSchema([
  StarterKit,
  ContentSizedTable,
  TableRow,
  AlignedTableCell,
  AlignedTableHeader,
]);
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
it("merged spans, paragraphs, headers and backgrounds survive storage and Markdown mode", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { colspan: 2, rowspan: 2, backgroundColor: "#d6a348" },
                content: [paragraph("甲"), paragraph("乙")],
              },
            ],
          },
          { type: "tableRow", content: [] },
        ],
      },
    ],
  };
  const delta = proseMirrorToDelta(doc);
  const restored = deltaToProseMirror(delta);
  const cell = restored.content[0].content![0].content![0];
  expect(cell.attrs).toMatchObject({
    colspan: 2,
    rowspan: 2,
    backgroundColor: "#d6a348",
  });
  expect(cell.content).toHaveLength(2);
  expect(
    TableMap.get(schema.nodeFromJSON(restored.content[0])).problems,
  ).toBeNull();
  const source = deltaToMarkdown(delta);
  expect(source).toContain('colspan="2"');
  const roundTrip = deltaToProseMirror(mdToDelta(source));
  expect(roundTrip.content[0].type).toBe("table");
  expect(roundTrip.content[0].content![0].content![0]).toEqual(cell);
});
it("vertical spans keep sparse rows in the correct physical columns", () => {
  const delta = {
    ops: [
      {
        insert: {
          table: {
            version: 1,
            columns: [{ align: null }, { align: null }],
            rows: [
              {
                cells: [
                  { rowspan: 2, content: { ops: [{ insert: "A" }] } },
                  { content: { ops: [{ insert: "B" }] } },
                ],
              },
              { cells: [{ content: { ops: [{ insert: "C" }] } }] },
            ],
          },
        },
      },
    ],
  };
  const table = deltaToProseMirror(delta).content[0];
  const map = TableMap.get(schema.nodeFromJSON(table));
  expect(map.problems).toBeNull();
  expect(map.width).toBe(2);
  expect(map.height).toBe(2);
  expect(
    deltaToProseMirror(proseMirrorToDelta({ type: "doc", content: [table] }))
      .content[0],
  ).toEqual(table);
});
it("invalid or overlapping table spans and unsafe colors are rejected", () => {
  const cell = { content: { ops: [] } };
  expect(
    isTableEmbed({
      version: 1,
      columns: [{ align: null }],
      rows: [{ cells: [{ ...cell, colspan: 101 }] }],
    }),
  ).toBe(false);
  expect(
    isTableEmbed({
      version: 1,
      columns: [{ align: null }],
      rows: [{ cells: [{ ...cell, rowspan: 2 }] }],
    }),
  ).toBe(false);
  expect(normalizeEditorColor("url(javascript:x)")).toBeNull();
  expect(normalizeEditorColor("#AbC")).toBe("#aabbcc");
});
