import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import TableRow from "@tiptap/extension-table-row";
import fixture from "../../schema/sync/fixtures/candidate-footnotes-v1.json";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
import {
  FootnoteReference,
  FootnoteDefinition,
  Footnotes,
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
  DocumentStarterKit.configure({ blockquote: false }),
  CollapsibleBlockquote,
  MarkdownTaskState,
  BlockIndent,
  FootnoteReference,
  FootnoteDefinition,
  Footnotes,
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
  "certifies $id through real schema, text edit/undo and whole-document numbering",
  async (note) => {
    const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
    doc.check();
    expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
      candidateBodyProjection(note.content),
    );
    let pos = -1;
    doc.descendants((node, at) => {
      if (
        pos < 0 &&
        node.isText &&
        !node.marks.some((mark) => mark.type.name === "footnoteReference")
      )
        pos = at;
    });
    let state = EditorState.create({
      schema,
      doc,
      plugins: [history(), footnoteNumberingPlugin()],
    });
    state = state.applyTransaction(state.tr.insertText("编辑", pos)).state;
    const edited = proseMirrorToDelta(state.doc.toJSON());
    for (const runtime of ["web", "tauri"] as const) {
      expect(reviewCandidatePayload(payload(edited), runtime).eligible).toBe(
        true,
      );
      expect(
        reviewCandidatePayload(payload(note.content), runtime).eligible,
      ).toBe(true);
    }
    expect(await candidateEntities(payload(edited), "web")).not.toEqual(
      await candidateEntities(payload(note.content), "web"),
    );
    expect(
      undo(state, (tr) => {
        state = state.applyTransaction(tr).state;
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(
      reviewCandidatePayload(payload(note.content), "flutter").eligible,
    ).toBe(false);
    expect(
      review({
        ...note.content,
        metadata: {
          referenceAnchors: [
            {
              id: "footnote-region",
              from: 0,
              to: doc.content.size,
              kind: "block",
              preview: "脚注区域",
            },
          ],
        },
      }).eligible,
    ).toBe(true);
    const features = review(note.content).requiredFeatures;
    expect(features).toContain(
      note.id === "footnote-rule" ? "horizontal-rule-v1" : "footnotes-v1",
    );
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(0);
  },
);

it.each([fixture.notes[0], fixture.notes[6]])(
  "recomputes $id numbering and backlinks on delete, then restores them through undo",
  (note) => {
    const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
    let state = EditorState.create({
      schema,
      doc,
      plugins: [history(), footnoteNumberingPlugin()],
    });
    let from = -1;
    doc.descendants((node, at) => {
      if (
        from < 0 &&
        node.marks.some((mark) => mark.type.name === "footnoteReference")
      )
        from = at;
    });
    state = state.applyTransaction(state.tr.delete(from, from + 1)).state;
    const changed = proseMirrorToDelta(state.doc.toJSON());
    expect(review(changed).eligible).toBe(true);
    const references: number[] = [];
    state.doc.descendants((node) => {
      if (node.type.name === "footnoteDefinition")
        references.push(node.attrs.references);
    });
    if (note.id === "footnote-repeated") expect(references).toEqual([1, 1, 0]);
    else expect(references).toEqual(Array(12).fill(1));
    expect(
      undo(state, (tr) => {
        state = state.applyTransaction(tr).state;
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
  },
);

it("certifies persisted Markdown semantics but refuses legacy encodings that would be silently rewritten", () => {
  const raw = mdToDelta("正文[^中文]。\n\n[^中文]: 第一段。\n\n    第二段。");
  expect(review(raw).eligible).toBe(false); // The missing separator is added by the editor, not by certification.
  const saved = proseMirrorToDelta(deltaToProseMirror(raw));
  expect(review(saved).eligible).toBe(true);
  const content = structuredClone(fixture.notes[0].content) as DeltaOps;
  const definitions = content.ops.find(
    (op) => typeof op.insert === "object" && "footnotes" in op.insert,
  )!;
  content.ops.splice(content.ops.indexOf(definitions) - 2, 2); // Drop the persisted separator.
  expect(review(content).eligible).toBe(false);
});

it("rejects duplicate IDs, malformed counts, stale numbering and unknown fields without normalization", () => {
  const original = fixture.notes[0].content;
  type Definition = {
    id: string;
    number: number | null;
    references: number;
    content: unknown[];
    [key: string]: unknown;
  };
  const mutate = (change: (items: Definition[]) => void) => {
    const content: DeltaOps = structuredClone(original);
    const op = content.ops.find(
      (op) => typeof op.insert === "object" && "footnotes" in op.insert,
    )!;
    change((op.insert as { footnotes: Definition[] }).footnotes);
    expect(review(content).eligible).toBe(false);
  };
  for (const change of [
    (defs: Definition[]) => {
      defs.push(defs[0]);
    },
    (defs: Definition[]) => {
      defs[0].number = 2;
    },
    (defs: Definition[]) => {
      defs[0].references = 999;
    },
    (defs: Definition[]) => {
      defs[0].references = -1;
    },
    (defs: Definition[]) => {
      defs[0].references = 10001;
    },
    (defs: Definition[]) => {
      defs[0].id = "";
    },
    (defs: Definition[]) => {
      defs[0].id = "\ud800";
    },
    (defs: Definition[]) => {
      defs[0].extra = true;
    },
    (defs: Definition[]) => {
      defs[0].content = [];
    },
  ])
    mutate(change);
  for (const attributes of [
    { footnoteRef: "中文", footnoteNumber: 2, footnoteOccurrence: 1 },
    { footnoteRef: "中文", footnoteNumber: 1 },
    { footnoteRef: "中文", footnoteNumber: 1, footnoteOccurrence: 2 },
    { footnoteRef: "中文", footnoteNumber: "1", footnoteOccurrence: 1 },
    { footnoteRef: "中文", footnoteNumber: 1, footnoteOccurrence: 0 },
    {
      footnoteRef: "中文",
      footnoteNumber: 1,
      footnoteOccurrence: 1,
      extra: true,
    },
  ])
    expect(
      review({ ops: [{ insert: "1", attributes }, { insert: "\n" }] }).eligible,
    ).toBe(false);
});

it("preserves footnote entity hashes through IDB edits, export and fresh restore", async () => {
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

it("binds an entire footnote body choice without mixing definition text from the other side", async () => {
  const localSource = payload(fixture.notes[0].content);
  const changed: DeltaOps = structuredClone(fixture.notes[0].content);
  const insert = changed.ops.find(
    (op) => typeof op.insert === "object" && "footnotes" in op.insert,
  )!.insert as { footnotes: { content: DeltaOps["ops"] }[] };
  insert.footnotes[0].content[0].insert = "remote definition";
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

it("rejects locally numbered table references that disagree with whole-document order", () => {
  const content: DeltaOps = structuredClone(fixture.notes[1].content);
  const table = content.ops.find(
    (op) => typeof op.insert === "object" && "table" in op.insert,
  )!.insert as { table: { rows: { cells: { content: DeltaOps }[] }[] } };
  const ref = table.table.rows[1].cells[0].content.ops.find(
    (op) => op.attributes?.footnoteRef === "third",
  )!;
  expect(ref.attributes!.footnoteNumber).toBe(3);
  ref.insert = "1";
  ref.attributes!.footnoteNumber = 1;
  expect(review(content).eligible).toBe(false);
});
