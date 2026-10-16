import TableRow from "@tiptap/extension-table-row";
import {
  ContentSizedTable,
  AlignedTableCell,
  AlignedTableHeader,
} from "../../src/extensions/ContentSizedTable";
import tableFixture from "../../schema/sync/fixtures/candidate-table-v1.json";
import { history, undo } from "@tiptap/pm/history";
import { assembleEntityCandidate } from "../../src/lib/sync/entity-assembly";
import { entityKey } from "../../src/lib/sync/entity-plan";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { FontSize } from "../../src/extensions/FontSize";
import { InlineHighlight } from "../../src/extensions/MarkdownExtras";
import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema, type JSONContent } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { CodeBlockLineNumbers } from "../../src/extensions/CodeBlockLineNumbers";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { BlockIndent } from "../../src/extensions/BlockIndent";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
import textFixture from "../../schema/sync/fixtures/candidate-structured-text-v1.json";
import blockFixture from "../../schema/sync/fixtures/candidate-structured-block-v1.json";
const fixture = {
  ...textFixture,
  notes: [...textFixture.notes, ...blockFixture.notes, ...tableFixture.notes],
};
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import {
  candidateBodyProjection,
  candidateEntities,
} from "../../src/lib/sync/entity-projection";
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import { CURRENT_SYNC_CAPABILITIES } from "../../src/lib/sync/protocol-capabilities";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import { idbAdapter } from "../../src/lib/storage/idb";
const schema = getSchema([
  ContentSizedTable,
  TableRow,
  AlignedTableCell,
  AlignedTableHeader,
  DocumentStarterKit.configure({ codeBlock: false, blockquote: false }),
  CodeBlockLineNumbers,
  CollapsibleBlockquote,
  BlockIndent,
  MarkdownTaskState,
  TextStyle,
  Color,
  FontSize,
  InlineHighlight,
]);

it.each(fixture.notes)(
  "certifies $id through the real editor schema and text edit/undo",
  (note) => {
    const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
    doc.check();
    expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
      candidateBodyProjection(note.content),
    );
    let pos = 0;
    doc.descendants((node, at) => {
      if (!pos && node.isText) pos = at;
    });
    const state = EditorState.create({ schema, doc, plugins: [history()] });
    const edit = state.tr.insertText("新增", pos);
    const edited = state.apply(edit);
    let restored = edited;
    expect(
      undo(edited, (transaction) => {
        restored = edited.apply(transaction);
      }),
    ).toBe(true);
    expect(restored.doc.eq(doc)).toBe(true);
    for (const body of [
      note.content,
      proseMirrorToDelta(edited.doc.toJSON()),
      proseMirrorToDelta(restored.doc.toJSON()),
    ]) {
      const source = JSON.stringify({
        ...fixture,
        notes: [{ ...note, content: body }],
      });
      for (const runtime of ["web", "tauri"] as const)
        expect(reviewCandidatePayload(source, runtime)).toMatchObject({
          eligible: true,
          requiredFeatures: expect.arrayContaining(["structured-text-v1"]),
        });
      expect(reviewCandidatePayload(source, "flutter").eligible).toBe(false);
    }
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(0);
  },
);

it("preserves structured entity hashes through IDB editing, export and fresh restore", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  try {
    await importData(JSON.stringify(fixture), "replace");
    for (const note of fixture.notes)
      await idbAdapter.updateNote(note.id, {
        content: proseMirrorToDelta(
          schema.nodeFromJSON(deltaToProseMirror(note.content)).toJSON(),
        ),
      });
    const saved = await exportData();
    await importData(JSON.stringify({ ...fixture, notes: [] }), "replace");
    await importData(saved, "replace");
    const after = JSON.parse(await exportData());
    const normalized = after.notes.map((note: Record<string, unknown>) => ({
      ...note,
      updated_at: fixture.notes.find((n) => n.id === note.id)!.updated_at,
    }));
    expect(
      await candidateEntities(
        JSON.stringify({ ...fixture, notes: normalized }),
        "web",
      ),
    ).toEqual(await candidateEntities(JSON.stringify(fixture), "web"));
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([
  { list: "ordered", listStart: 0 },
  { list: "bullet", indent: 9 },
  { list: "bullet", listStart: 2 },
  { list: "bullet", taskChecked: "false" },
  { list: "bullet", unknown: true },
  { "code-block": true, "code-wrap": true },
  { "code-block": true, language: "mermaid", "code-collapsed": false },
  { "code-block": true, language: "flow", "code-title": 1 },
  { "code-block": true, language: "toc", onclick: "unsafe" },
  { blockquote: true, "indent-explicit": true },
  { blockquote: true, bold: true },
  { header: 2, list: "bullet" },
  { list: "bullet", "list-continuation": true },
])("refuses lossy, malformed or deferred block attributes %j", (attributes) => {
  const content = { ops: [{ insert: "body" }, { insert: "\n", attributes }] };
  expect(
    reviewCandidatePayload(
      JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content }] }),
      "web",
    ).eligible,
  ).toBe(false);
});

it("refuses embeds, inline metadata on code text and incorrect ordered numbering", () => {
  for (const content of [
    {
      ops: [
        { insert: { image: "private" } },
        { insert: "\n", attributes: { blockquote: true } },
      ],
    },
    {
      ops: [
        { insert: "code", attributes: { bold: true } },
        { insert: "\n", attributes: { "code-block": true } },
      ],
    },
    {
      ops: [
        { insert: "one" },
        {
          insert: "\n",
          attributes: {
            list: "ordered",
            listStart: 1,
            "list-block-start": true,
          },
        },
        { insert: "two" },
        { insert: "\n", attributes: { list: "ordered", listStart: 99 } },
      ],
    },
  ])
    expect(
      reviewCandidatePayload(
        JSON.stringify({
          ...fixture,
          notes: [{ ...fixture.notes[0], content }],
        }),
        "web",
      ).eligible,
    ).toBe(false);
});

it("retains inline appearance inside lists and quotes without weakening the appearance gate", () => {
  for (const attrs of [
    { list: "bullet", "list-block-start": true },
    { blockquote: true },
  ]) {
    const content = {
      ops: [
        {
          insert: "彩色文字",
          attributes: {
            bold: true,
            color: "#22a577",
            size: "large",
            highlight: true,
            background: "#d6a348",
          },
        },
        { insert: "\n", attributes: attrs },
      ],
    };
    const source = JSON.stringify({
      ...fixture,
      notes: [{ ...fixture.notes[0], content }],
    });
    expect(reviewCandidatePayload(source, "web")).toMatchObject({
      eligible: true,
      requiredFeatures: expect.arrayContaining([
        "structured-text-v1",
        "inline-appearance-v1",
      ]),
    });
    const doc = schema.nodeFromJSON(deltaToProseMirror(content));
    doc.check();
    expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
      candidateBodyProjection(content),
    );
    content.ops[0].attributes!.color = "red";
    expect(
      reviewCandidatePayload(
        JSON.stringify({
          ...fixture,
          notes: [{ ...fixture.notes[0], content }],
        }),
        "web",
      ).eligible,
    ).toBe(false);
  }
});

it("binds structured document choices into a still non-writable candidate", async () => {
  const remoteSource = JSON.stringify(fixture);
  const local = structuredClone(fixture);
  local.notes[0].content.ops[0].insert = "本机修改";
  const localSource = JSON.stringify(local);
  const localEntities = await candidateEntities(localSource, "web");
  const remoteEntities = await candidateEntities(remoteSource, "web");
  const selected = localEntities.find(
    (entity) => entity.id === local.notes[0].id,
  )!;
  const result = await assembleEntityCandidate({
    spaceId: "a".repeat(64),
    localSource,
    remoteSource,
    runtime: "web",
    baselines: [],
    choices: [
      {
        key: entityKey(selected),
        localHash: selected.sha256,
        remoteHash: remoteEntities.find((entity) => entity.id === selected.id)!
          .sha256,
        action: "local",
      },
    ],
  });
  expect(result.writable).toBe(false);
  expect(result.review.requiredFeatures).toContain("structured-text-v1");
  expect(await candidateEntities(result.source, "web")).toEqual(localEntities);
});

it("keeps complex list manual indentation through storage and the actual schema", () => {
  const source: JSONContent = {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 5, indent: 2, indentExplicit: true },
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "item" }] },
              {
                type: "codeBlock",
                attrs: { language: "text" },
                content: [{ type: "text", text: "code" }],
              },
            ],
          },
        ],
      },
    ],
  };
  const original = schema.nodeFromJSON(source);
  const body = proseMirrorToDelta(original.toJSON());
  const restored = schema.nodeFromJSON(deltaToProseMirror(body));
  restored.check();
  expect(restored.eq(original)).toBe(true);
});

const embeddedItemBody = [
  { insert: "item" },
  { insert: "\n" },
  { insert: "code" },
  { insert: "\n", attributes: { "code-block": true } },
];
const embeddedList = {
  version: 1,
  ordered: true,
  start: 3,
  spread: false,
  items: [{ checked: null, content: embeddedItemBody }],
};
const embeddedPayload = (insert: unknown, attributes?: unknown) =>
  JSON.stringify({
    ...textFixture,
    notes: [
      {
        ...textFixture.notes[0],
        content: {
          ops: [
            { insert, ...(attributes ? { attributes } : {}) },
            { insert: "\n" },
          ],
        },
      },
    ],
  });

it.each([
  { ...embeddedList, version: 2 },
  { ...embeddedList, extra: "lost" },
  { ...embeddedList, ordered: "true" },
  { ...embeddedList, start: 0 },
  { ...embeddedList, spread: 1 },
  { ...embeddedList, items: [] },
  {
    ...embeddedList,
    items: [{ checked: null, content: embeddedItemBody, extra: 1 }],
  },
  { ...embeddedList, items: [{ checked: "false", content: embeddedItemBody }] },
  {
    ...embeddedList,
    items: [
      {
        checked: null,
        content: [{ insert: { image: "secret" } }, { insert: "\n" }],
      },
    ],
  },
  {
    ...embeddedList,
    items: [
      {
        checked: null,
        content: [
          { insert: "code" },
          {
            insert: "\n",
            attributes: {
              "code-block": true,
              language: "flow",
              "code-wrap": true,
            },
          },
        ],
      },
    ],
  },
])("rejects unsupported fields and bodies at any list depth: %j", (list) => {
  expect(
    reviewCandidatePayload(embeddedPayload({ list }), "web").eligible,
  ).toBe(false);
});

it("requires nested inline and embed capabilities and preserves semantic hashes across text fragmentation", async () => {
  const text = { insert: "marked", attributes: { color: "#22a577" } };
  const list = {
    ...embeddedList,
    items: [{ checked: true, content: [text, ...embeddedItemBody.slice(1)] }],
  };
  const source = embeddedPayload({ list });
  expect(reviewCandidatePayload(source, "web")).toMatchObject({
    eligible: true,
    requiredFeatures: expect.arrayContaining([
      "structured-block-v1",
      "inline-appearance-v1",
    ]),
  });
  const split = {
    ...list,
    items: [
      {
        checked: true,
        content: [
          { ...text, insert: "mar" },
          { ...text, insert: "ked" },
          ...embeddedItemBody.slice(1),
        ],
      },
    ],
  };
  expect(
    await candidateEntities(embeddedPayload({ list: split }), "web"),
  ).toEqual(await candidateEntities(source, "web"));
  list.items[0].checked = false;
  expect(await candidateEntities(embeddedPayload({ list }), "web")).not.toEqual(
    await candidateEntities(source, "web"),
  );
  expect(reviewCandidatePayload(source, "flutter").eligible).toBe(false);
});

it("rejects oversized nesting, quote versions/alerts and missing embed boundaries", () => {
  let insert: unknown = {
    blockquote: { version: 1, content: embeddedItemBody },
  };
  for (let depth = 0; depth < 18; depth++)
    insert = {
      blockquote: {
        version: 1,
        content: [
          { insert, attributes: { blockquote: true } },
          { insert: "\n" },
        ],
      },
    };
  expect(
    reviewCandidatePayload(embeddedPayload(insert, { blockquote: true }), "web")
      .eligible,
  ).toBe(false);
  for (const blockquote of [
    { version: 2, content: embeddedItemBody },
    { version: 1, content: embeddedItemBody, alert: "NOTE" },
    { version: 1, content: [] },
    { version: 1, content: embeddedItemBody, extra: 1 },
  ])
    expect(
      reviewCandidatePayload(
        embeddedPayload({ blockquote }, { blockquote: true }),
        "web",
      ).eligible,
    ).toBe(false);
  const source = JSON.parse(embeddedPayload({ list: embeddedList }));
  source.notes[0].content.ops.pop();
  expect(reviewCandidatePayload(JSON.stringify(source), "web").eligible).toBe(
    false,
  );
});

type TestCellBody = {
  extra?: boolean;
  ops: {
    insert: string | { image: string };
    attributes?: Record<string, unknown>;
  }[];
};
type TestTable = {
  version: number;
  extra?: boolean;
  columns: { width?: number; extra?: boolean }[];
  rows: {
    extra?: boolean;
    cells: {
      header?: boolean;
      rowspan?: number;
      colspan?: number;
      background?: string;
      content: TestCellBody;
      paragraphs: TestCellBody[];
    }[];
  }[];
};
it("certifies table features and rejects malformed or lossy cell structures", () => {
  const content = tableFixture.notes[1].content;
  const review = (body: unknown) =>
    reviewCandidatePayload(
      JSON.stringify({
        ...tableFixture,
        notes: [{ ...tableFixture.notes[1], content: body }],
      }),
      "web",
    );
  expect(review(content)).toMatchObject({
    eligible: true,
    requiredFeatures: expect.arrayContaining([
      "table-block-v1",
      "inline-appearance-v1",
    ]),
  });
  const mutations: ((table: TestTable) => void)[] = [
    (table) => {
      table.version = 2;
    },
    (table) => {
      table.extra = true;
    },
    (table) => {
      table.columns[0].width = 10;
    },
    (table) => {
      table.columns[0].extra = true;
    },
    (table) => {
      table.rows[0].extra = true;
    },
    (table) => {
      table.rows[0].cells[0].header = false;
    },
    (table) => {
      table.rows[0].cells[0].rowspan = 3;
    },
    (table) => {
      table.rows[0].cells[0].colspan = 3;
    },
    (table) => {
      table.rows[0].cells[0].background = "rgb(1, 2, 3)";
    },
    (table) => {
      table.rows[0].cells[0].content.extra = true;
    },
    (table) => {
      table.rows[0].cells[0].paragraphs[0].ops[0].attributes!.link =
        "https://example.com";
    },
    (table) => {
      table.rows[0].cells[0].paragraphs[0].ops[0].insert = {
        image: "image.png",
      };
    },
    (table) => {
      table.rows[0].cells[0].paragraphs[0].ops[0].insert = "different source";
    },
    (table) => {
      table.rows[0].cells[0].content.ops.push({
        insert: "\n",
        attributes: { header: 2 },
      });
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(content);
    mutate((copy.ops[0].insert as unknown as { table: TestTable }).table);
    expect(review(copy).eligible).toBe(false);
  }
});
it("normalizes cell text fragments without losing paragraph boundaries or styles", () => {
  const before = structuredClone(tableFixture.notes[1].content);
  const after = structuredClone(before);
  const table = (after.ops[0].insert as unknown as { table: TestTable }).table;
  for (const body of [
    table.rows[0].cells[0].content,
    table.rows[0].cells[0].paragraphs[0],
  ]) {
    const first = body.ops[0];
    body.ops.splice(
      0,
      1,
      { ...first, insert: (first.insert as string).slice(0, 1) },
      { ...first, insert: (first.insert as string).slice(1) },
    );
  }
  expect(candidateBodyProjection(before)).toEqual(
    candidateBodyProjection(after),
  );
  table.rows[0].cells[0].background = "#112233";
  expect(candidateBodyProjection(before)).not.toEqual(
    candidateBodyProjection(after),
  );
});
