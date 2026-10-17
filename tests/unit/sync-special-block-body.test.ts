import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { CodeBlockLineNumbers } from "../../src/extensions/CodeBlockLineNumbers";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { DocumentLink } from "../../src/extensions/DocumentLink";
import { FontSize } from "../../src/extensions/FontSize";
import TableRow from "@tiptap/extension-table-row";
import fixture from "../../schema/sync/fixtures/candidate-special-blocks-v1.json";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
import {
  FootnoteReference,
  FootnoteDefinition,
  Footnotes,
  HTMLDetails,
  HTMLStyle,
  HTMLAnchor,
  RawHTML,
  RawHTMLInline,
  InlineHighlight,
  MathInline,
  MathBlock,
} from "../../src/extensions/MarkdownExtras";
import { footnoteNumberingPlugin } from "../../src/extensions/FootnoteNumbering";
import { BlockIndent } from "../../src/extensions/BlockIndent";
import {
  ContentSizedTable,
  AlignedTableCell,
  AlignedTableHeader,
} from "../../src/extensions/ContentSizedTable";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { mdToDelta } from "../../src/lib/md-parser";
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import {
  candidateBodyProjection,
  candidateEntities,
} from "../../src/lib/sync/entity-projection";
import { CURRENT_SYNC_CAPABILITIES } from "../../src/lib/sync/protocol-capabilities";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import { idbAdapter } from "../../src/lib/storage/idb";
import { assembleEntityCandidate } from "../../src/lib/sync/entity-assembly";
import { entityKey } from "../../src/lib/sync/entity-plan";
import type { DeltaOps } from "../../src/types/models";

const schema = getSchema([
  DocumentStarterKit.configure({ blockquote: false, codeBlock: false }),
  CollapsibleBlockquote,
  CodeBlockLineNumbers,
  TextStyle,
  Color,
  FontSize,
  DocumentLink,
  MarkdownTaskState,
  BlockIndent,
  FootnoteReference,
  FootnoteDefinition,
  Footnotes,
  HTMLDetails,
  HTMLStyle,
  HTMLAnchor,
  RawHTML,
  RawHTMLInline,
  InlineHighlight,
  MathInline,
  MathBlock,
  ContentSizedTable,
  TableRow,
  AlignedTableCell,
  AlignedTableHeader,
]);
const payload = (content: unknown) =>
  JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content }] });
const review = (content: unknown) =>
  reviewCandidatePayload(payload(content), "web");

it.each(fixture.notes)(
  "certifies $id through the real schema, editing and undo",
  async (note) => {
    const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
    doc.check();
    expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
      candidateBodyProjection(note.content),
    );
    for (const runtime of ["web", "tauri"] as const)
      expect(
        reviewCandidatePayload(payload(note.content), runtime).eligible,
      ).toBe(true);
    expect(
      reviewCandidatePayload(payload(note.content), "flutter").eligible,
    ).toBe(false);
    expect(
      review({
        ...note.content,
        metadata: {
          referenceAnchors: [
            {
              id: "html-region",
              from: 0,
              to: doc.content.size,
              kind: "block",
              preview: "HTML",
            },
          ],
        },
      }).eligible,
    ).toBe(true);
    let state = EditorState.create({
      schema,
      doc,
      plugins: [history(), footnoteNumberingPlugin()],
    });
    let pos = -1;
    doc.descendants((node, at) => {
      if (pos < 0 && node.isText) pos = at;
    });
    if (pos >= 0)
      state = state.applyTransaction(state.tr.insertText("编辑", pos)).state;
    else
      state = state.applyTransaction(
        state.tr.setNodeMarkup(0, undefined, {
          ...doc.firstChild!.attrs,
          source: doc.firstChild!.attrs.source + "编辑",
        }),
      ).state;
    expect(review(proseMirrorToDelta(state.doc.toJSON())).eligible).toBe(true);
    expect(
      await candidateEntities(
        payload(proseMirrorToDelta(state.doc.toJSON())),
        "web",
      ),
    ).not.toEqual(await candidateEntities(payload(note.content), "web"));
    expect(
      undo(state, (tr) => {
        state = state.applyTransaction(tr).state;
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(1);
  },
);

it("certifies independent formula atoms and code source edits, including undo", () => {
  for (const note of fixture.notes) {
    const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
    doc.descendants((node, pos) => {
      if (!["codeBlock", "mathInline", "mathBlock"].includes(node.type.name))
        return;
      let state = EditorState.create({
        schema,
        doc,
        plugins: [history(), footnoteNumberingPlugin()],
      });
      const tr =
        node.type.name === "codeBlock"
          ? state.tr.insertText("\n编辑草稿", pos + 1)
          : state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              source: node.attrs.source + "+编辑",
            });
      state = state.applyTransaction(tr).state;
      expect(review(proseMirrorToDelta(state.doc.toJSON())).eligible).toBe(
        true,
      );
      expect(
        undo(state, (tr) => {
          state = state.applyTransaction(tr).state;
        }),
      ).toBe(true);
      expect(state.doc.eq(doc)).toBe(true);
    });
  }
});

it("declares rendering capabilities without treating flow internals as outer footnotes", () => {
  const features = [
    "mermaid-block-v1",
    "flow-block-v1",
    "automatic-toc-v1",
    "math-v1",
  ];
  features.forEach((feature, index) =>
    expect(review(fixture.notes[index].content).requiredFeatures).toContain(
      feature,
    ),
  );
  expect(review(fixture.notes[7].content).requiredFeatures).toEqual(
    expect.arrayContaining([
      "flow-block-v1",
      "mermaid-block-v1",
      "math-v1",
      "footnotes-v1",
    ]),
  );
});

it("refuses malformed atoms, attributes and Unicode without rewriting their source", () => {
  const body = (insert: unknown, attributes?: unknown) => ({
    ops: [{ insert, ...(attributes ? { attributes } : {}) }, { insert: "\n" }],
  });
  for (const content of [
    body({ mathInline: 123 }),
    body({ mathBlock: { source: "x" } }),
    body({ mathInline: "x", mathBlock: "y" }),
    body({ mathInline: "\ud800" }),
    body({ mathBlock: "\ud800" }),
    body({ mathBlock: "x" }, { bold: true }),
    body({ mathInline: "x" }, { "hard-break": true }),
    body({ mathInline: "x" }, { onclick: "alert(1)" }),
    {
      ops: [
        { insert: "x", attributes: { bold: true } },
        {
          insert: "\n",
          attributes: { "code-block": true, language: "mermaid" },
        },
      ],
    },
    {
      ops: [
        { insert: "x" },
        {
          insert: "\n",
          attributes: {
            "code-block": true,
            language: "flow",
            "code-collapsed": false,
          },
        },
      ],
    },
    {
      ops: [
        { insert: "x" },
        {
          insert: "\n",
          attributes: {
            "code-block": true,
            language: "toc",
            "code-meta": "\ud800",
          },
        },
      ],
    },
  ])
    expect(review(content).eligible).toBe(false);
  // Empty and invalid draft sources are data, not validation errors.
  for (const source of ["", "\\unknown{", "<script>not executable</script>"])
    for (const key of ["mathInline", "mathBlock"])
      expect(review(body({ [key]: source })).eligible).toBe(true);
});

it("retains formula marks in a real schema and hashes source/configuration changes", async () => {
  const note = fixture.notes[3];
  const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
  const atomPositions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "mathInline") atomPositions.push(pos);
  });
  expect(atomPositions).toHaveLength(2);
  expect(
    doc
      .nodeAt(atomPositions[1])!
      .marks.some((mark) => mark.type.name === "bold"),
  ).toBe(true);
  for (const index of [0, 2, 3]) {
    const original = fixture.notes[index];
    const node = deltaToProseMirror(original.content);
    const block = node.content.find((n) =>
      ["codeBlock", "mathBlock"].includes(n.type!),
    );
    if (block!.type === "codeBlock")
      block!.attrs = { ...block!.attrs, collapsed: !block!.attrs?.collapsed };
    else block!.attrs = { ...block!.attrs, source: "changed formula" };
    const edited = proseMirrorToDelta(node);
    expect(review(edited).eligible).toBe(true);
    expect(await candidateEntities(payload(edited), "web")).not.toEqual(
      await candidateEntities(payload(original.content), "web"),
    );
  }
  const raw = mdToDelta("$x$\n\n$$\ny\n$$");
  expect(review(proseMirrorToDelta(deltaToProseMirror(raw))).eligible).toBe(
    true,
  );
});

it("preserves special-block entity hashes through IDB edits, export and fresh restore", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
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
    const restored = JSON.parse(await exportData());
    const notes = restored.notes.map((note: Record<string, unknown>) => ({
      ...note,
      updated_at: fixture.notes.find((n) => n.id === note.id)!.updated_at,
    }));
    expect(
      await candidateEntities(JSON.stringify({ ...fixture, notes }), "web"),
    ).toEqual(await candidateEntities(JSON.stringify(fixture), "web"));
  } finally {
    vi.unstubAllGlobals();
  }
});

it("binds an entire special-block body choice without mixing nested text from the other side", async () => {
  const localSource = payload(fixture.notes[0].content);
  const changed: DeltaOps = structuredClone(fixture.notes[0].content);
  const source = changed.ops.find(
    (op) => typeof op.insert === "string" && op.insert.includes("flowchart LR"),
  )!;
  source.insert += "\n B --> C";
  const remoteSource = payload(changed);
  const local = await candidateEntities(localSource, "web");
  const remote = await candidateEntities(remoteSource, "web");
  expect(remote).not.toEqual(local);
  const assembled = await assembleEntityCandidate({
    spaceId: "a".repeat(64),
    localSource,
    remoteSource,
    runtime: "web",
    baselines: [],
    choices: [
      {
        key: entityKey(local[0]),
        localHash: local[0].sha256,
        remoteHash: remote[0].sha256,
        action: "remote",
      },
    ],
  });
  expect(assembled.writable).toBe(false);
  expect(await candidateEntities(assembled.source, "web")).toEqual(remote);
});

it("keeps flow source authoritative while refusing unresolved nested images", () => {
  const make = (language: string, source: string) =>
    proseMirrorToDelta({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language },
          content: [{ type: "text", text: source }],
        },
      ],
    });
  for (const src of [
    "nr-image://local",
    "file:///local.png",
    "blob:local",
    "../local.png",
  ]) {
    expect(review(make("flow", `### 图片\n\n![说明](${src})`)).eligible).toBe(
      false,
    );
    expect(
      review(make("flow", `### 内层\n\n\`\`\`flow\n![说明](${src})\n\`\`\``))
        .eligible,
    ).toBe(false);
  }
  expect(
    review(make("flow", "### 图片\n\n![说明](https://example.com/image.png)"))
      .eligible,
  ).toBe(true);
  for (const source of [
    'graph TD\n A["nr-image://local"]',
    'graph TD\n A@{ img: "../local.png" }',
    'graph TD\n A["<img src=local.png>"]',
  ])
    expect(review(make("mermaid", source)).eligible).toBe(false);
  expect(
    review(make("flow", "### 来源\n\n脚注[^x]\n\n[^x]: 内层说明")).eligible,
  ).toBe(true);
});

it("retains linked, styled formula atoms through marking and undo", () => {
  const doc = schema.nodeFromJSON(deltaToProseMirror(fixture.notes[3].content));
  let pos = -1;
  doc.descendants((node, at) => {
    if (pos < 0 && node.type.name === "mathInline") pos = at;
  });
  let state = EditorState.create({ schema, doc, plugins: [history()] });
  const tr = state.tr
    .addMark(
      pos,
      pos + 1,
      schema.marks.link.create({
        href: "https://example.com/math",
        title: "公式",
        explicit: true,
      }),
    )
    .addMark(
      pos,
      pos + 1,
      schema.marks.textStyle.create({ color: "#228855", fontSize: "18" }),
    )
    .addMark(
      pos,
      pos + 1,
      schema.marks.inlineHighlight.create({ backgroundColor: "#dde8d8" }),
    )
    .addMark(pos, pos + 1, schema.marks.htmlStyle.create({ tag: "sup" }));
  state = state.apply(tr);
  const delta = proseMirrorToDelta(state.doc.toJSON());
  expect(review(delta).eligible).toBe(true);
  const restored = schema.nodeFromJSON(deltaToProseMirror(delta));
  expect(restored.eq(state.doc)).toBe(true);
  expect(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.eq(doc)).toBe(true);
});
