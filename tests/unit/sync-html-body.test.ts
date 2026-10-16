import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import TableRow from "@tiptap/extension-table-row";
import fixture from "../../schema/sync/fixtures/candidate-html-v1.json";
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
  HTMLDetails,
  HTMLStyle,
  HTMLAnchor,
  RawHTML,
  RawHTMLInline,
  InlineHighlight,
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
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(0);
  },
);

it("preserves nested details summary and open state through undo", () => {
  const doc = schema.nodeFromJSON(deltaToProseMirror(fixture.notes[1].content));
  let state = EditorState.create({ schema, doc, plugins: [history()] });
  state = state.apply(
    state.tr.setNodeMarkup(0, undefined, {
      ...doc.firstChild!.attrs,
      summary: '<img src=x onerror="alert(1)">',
      open: false,
    }),
  );
  expect(review(proseMirrorToDelta(state.doc.toJSON())).eligible).toBe(true);
  expect(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.eq(doc)).toBe(true);
});

it("declares restricted, inert HTML and hard break capabilities separately", () => {
  expect(review(fixture.notes[0].content).requiredFeatures).toEqual(
    expect.arrayContaining([
      "restricted-html-v1",
      "hard-break-v1",
      "inline-appearance-v1",
    ]),
  );
  expect(review(fixture.notes[3].content).requiredFeatures).toContain(
    "inert-html-v1",
  );
});

it("rejects lossy HTML attributes, invalid Unicode, styles and hard breaks", () => {
  const content = (insert: unknown, attributes?: unknown) => ({
    ops: [{ insert, ...(attributes ? { attributes } : {}) }, { insert: "\n" }],
  });
  for (const invalid of [
    content({
      htmlDetails: { summary: "ok", open: "true", content: [{ insert: "\n" }] },
    }),
    content({
      htmlDetails: {
        summary: "ok",
        open: false,
        onclick: "alert(1)",
        content: [{ insert: "\n" }],
      },
    }),
    content({
      htmlDetails: {
        summary: "\ud800",
        open: false,
        content: [{ insert: "\n" }],
      },
    }),
    content({ rawHtml: "\ud800" }),
    content({ rawHtmlInline: "<b>", htmlAnchor: "a" }),
    content({ rawHtmlInline: "<b>" }, { bold: true }),
    content({ htmlAnchor: "bad id" }),
    content({ htmlAnchor: "\ud800" }),
    content("text", { htmlStyle: "script" }),
    { ops: [{ insert: "\n", attributes: { "hard-break": true } }] },
  ])
    expect(review(invalid).eligible).toBe(false);
  const parsed = mdToDelta("H<sub>2</sub>O<br>next");
  expect(review(proseMirrorToDelta(deltaToProseMirror(parsed))).eligible).toBe(
    true,
  );
});

it("preserves HTML entity hashes through IDB edits, export and fresh restore", async () => {
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

it("binds an entire HTML body choice without mixing nested text from the other side", async () => {
  const localSource = payload(fixture.notes[0].content);
  const changed: DeltaOps = structuredClone(fixture.notes[0].content);
  changed.ops[0].insert = "remote HTML text";
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
