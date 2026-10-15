import { history, undo } from "@tiptap/pm/history";
import { assembleEntityCandidate } from "../../src/lib/sync/entity-assembly";
import { entityKey } from "../../src/lib/sync/entity-plan";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { FontSize } from "../../src/extensions/FontSize";
import { InlineHighlight } from "../../src/extensions/MarkdownExtras";
import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { CodeBlockLineNumbers } from "../../src/extensions/CodeBlockLineNumbers";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { BlockIndent } from "../../src/extensions/BlockIndent";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
import fixture from "../../schema/sync/fixtures/candidate-structured-text-v1.json";
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
  { "code-block": true, language: "mermaid" },
  { "code-block": true, language: "flow" },
  { "code-block": true, language: "toc" },
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
