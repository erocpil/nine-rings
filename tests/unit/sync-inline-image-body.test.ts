import { storeImage, resolveImageRefs } from "../../src/lib/storage/db-images";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { FontSize } from "../../src/extensions/FontSize";
import { InlineHighlight } from "../../src/extensions/MarkdownExtras";
import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import TableRow from "@tiptap/extension-table-row";
import fixture from "../../schema/sync/fixtures/candidate-inline-image-v1.json";
import {
  ContentSizedTable,
  AlignedTableCell,
  AlignedTableHeader,
} from "../../src/extensions/ContentSizedTable";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { MarkdownImage } from "../../src/extensions/ResizableImage";
import { DocumentLink } from "../../src/extensions/DocumentLink";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
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
  TextStyle,
  Color,
  FontSize,
  InlineHighlight,
  DocumentStarterKit.configure({ blockquote: false }),
  CollapsibleBlockquote,
  MarkdownTaskState,
  MarkdownImage,
  DocumentLink.configure({ openOnClick: false }),
  ContentSizedTable,
  TableRow,
  AlignedTableCell,
  AlignedTableHeader,
]);
const payload = (content: unknown) =>
  JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content }] });

it.each(fixture.notes)(
  "certifies $id with exact placement, marks and real resize/undo",
  async (note) => {
    const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
    doc.check();
    expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
      candidateBodyProjection(note.content),
    );
    let pos = -1;
    doc.descendants((node, at) => {
      if (pos < 0 && node.type.name === "markdownImage") pos = at;
    });
    expect(pos).toBeGreaterThanOrEqual(0);
    let state = EditorState.create({ schema, doc, plugins: [history()] });
    const image = doc.nodeAt(pos)!;
    state = state.apply(
      state.tr.setNodeMarkup(pos, undefined, {
        ...image.attrs,
        width: "120px",
        alt: "edited alt",
      }),
    );
    const edited = proseMirrorToDelta(state.doc.toJSON());
    for (const runtime of ["web", "tauri"] as const) {
      for (const content of [note.content, edited])
        expect(reviewCandidatePayload(payload(content), runtime)).toMatchObject(
          {
            eligible: true,
            requiredFeatures: expect.arrayContaining(["inline-image-v1"]),
          },
        );
    }
    expect(await candidateEntities(payload(edited), "web")).not.toEqual(
      await candidateEntities(payload(note.content), "web"),
    );
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(
      reviewCandidatePayload(payload(note.content), "flutter").eligible,
    ).toBe(false);
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(0);
    expect(
      reviewCandidatePayload(
        payload({
          ...note.content,
          metadata: {
            referenceAnchors: [
              {
                id: "image-region",
                from: 0,
                to: doc.content.size,
                kind: "block",
                preview: "图片",
              },
            ],
          },
        }),
        "web",
      ).eligible,
    ).toBe(true);
  },
);

it("certifies real Markdown inline and table image imports without relocating the images", () => {
  for (const source of [
    'Before ![alt](https://example.com/a.png "title") after.',
    "| Image | Text |\n| --- | --- |\n| [![alt](https://example.com/a.png)](https://example.com/article) | after |",
  ]) {
    const content = mdToDelta(source);
    expect(reviewCandidatePayload(payload(content), "web").eligible).toBe(true);
    const doc = schema.nodeFromJSON(deltaToProseMirror(content));
    doc.check();
    expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
      candidateBodyProjection(content),
    );
  }
});

it("rejects unknown/lossy fields, unresolved sources, block formatting and unsafe links on inline images", () => {
  const source = "https://example.com/a.png";
  const image = { src: source, alt: "alt", title: null };
  const bodies = [
    ...[
      { extra: true },
      { src: "nr-image://local" },
      { src: "blob:local" },
      { alt: null },
      { title: "" },
      { width: "50%" },
      { width: 0 },
    ].map((change) => ({ insert: { inlineImage: { ...image, ...change } } })),
    ...[
      { header: 2 },
      { indent: 1 },
      { bold: false },
      { link: "javascript:alert(1)" },
      { link: "nr-doc://private" },
      { linkTitle: "missing link" },
      { link: source, linkExplicit: false },
      { code: true, bold: false },
    ].map((attributes) => ({ insert: { inlineImage: image }, attributes })),
    { insert: { inlineImage: image, extra: true } },
  ];
  for (const op of bodies)
    expect(
      reviewCandidatePayload(payload({ ops: [op, { insert: "\n" }] }), "web")
        .eligible,
    ).toBe(false);
});

it("preserves inline images, table paragraphs and hashes through IDB edit/export/fresh restore", async () => {
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

it("binds a whole inline/table image entity choice and its exact link target", async () => {
  const localSource = payload(fixture.notes[1].content);
  const remoteBody: DeltaOps = structuredClone(fixture.notes[1].content);
  const table = (
    remoteBody.ops[0].insert as {
      table: { rows: { cells: { content: DeltaOps }[] }[] };
    }
  ).table;
  table.rows[0].cells[0].content.ops[1].attributes!.link =
    "https://example.com/changed";
  const remoteSource = payload(remoteBody);
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

it("resolves real local resources in inline images and every table paragraph before review", async () => {
  class Reader {
    result = "";
    onload?: () => void;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal("FileReader", Reader);
  try {
    const original = fixture.notes[0].content.ops[1].insert as {
      inlineImage: { src: string };
    };
    const source = original.inlineImage.src;
    const bytes = Uint8Array.from(atob(source.split(",")[1]), (char) =>
      char.charCodeAt(0),
    );
    const ref = await storeImage(new Blob([bytes], { type: "image/png" }));
    const local = JSON.parse(JSON.stringify(fixture).split(source).join(ref));
    expect(reviewCandidatePayload(JSON.stringify(local), "web").eligible).toBe(
      false,
    );
    const resolved = await resolveImageRefs(local);
    expect(resolved).toEqual(fixture);
    expect(
      reviewCandidatePayload(JSON.stringify(resolved), "web").eligible,
    ).toBe(true);
  } finally {
    vi.unstubAllGlobals();
  }
});
