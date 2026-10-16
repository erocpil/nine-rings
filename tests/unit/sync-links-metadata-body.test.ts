import {
  DocumentBookmarks,
  documentBookmarkPluginKey,
} from "../../src/extensions/DocumentBookmarks";
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
import fixture from "../../schema/sync/fixtures/candidate-links-metadata-v1.json";
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

const metadataNote = fixture.notes.find(
  (note) => note.id === "remaining-metadata",
)!;
const retained = (body: DeltaOps, ops: DeltaOps): DeltaOps => ({
  ...ops,
  ...(body.metadata ? { metadata: body.metadata } : {}),
});
it.each(fixture.notes)(
  "certifies $id in the actual schema and across editable history",
  async (note) => {
    const content = note.content as DeltaOps;
    const doc = schema.nodeFromJSON(deltaToProseMirror(content));
    doc.check();
    expect(
      candidateBodyProjection(
        retained(content, proseMirrorToDelta(doc.toJSON())),
      ),
    ).toEqual(candidateBodyProjection(content));
    for (const runtime of ["web", "tauri"] as const)
      expect(reviewCandidatePayload(payload(content), runtime).eligible).toBe(
        true,
      );
    expect(reviewCandidatePayload(payload(content), "flutter").eligible).toBe(
      false,
    );
    let state = EditorState.create({
      schema,
      doc,
      plugins: [history(), footnoteNumberingPlugin()],
    });
    let pos = -1;
    doc.descendants((node, at) => {
      if (pos < 0 && node.isText) pos = at;
    });
    state = state.applyTransaction(state.tr.insertText("编辑", pos)).state;
    const edited = retained(content, proseMirrorToDelta(state.doc.toJSON()));
    expect(review(edited).eligible).toBe(true);
    expect(await candidateEntities(payload(edited), "web")).not.toEqual(
      await candidateEntities(payload(content), "web"),
    );
    expect(
      undo(state, (tr) => {
        state = state.applyTransaction(tr).state;
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(CURRENT_SYNC_CAPABILITIES.read).toBe(0);
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(0);
  },
);

it("preserves bookmark plugin normalization, edit mapping and undo", () => {
  const content = metadataNote.content as DeltaOps;
  const doc = schema.nodeFromJSON(deltaToProseMirror(content));
  const bookmarks = structuredClone(content.metadata!.bookmarks!);
  bookmarks.push({
    id: "bookmark-2",
    position: doc.firstChild!.nodeSize + 1,
    preview: "第二块",
    createdAt: "2026-10-16T01:00:00.000Z",
  });
  const plugins = DocumentBookmarks.config.addProseMirrorPlugins!.call({
    options: { initialBookmarks: bookmarks },
  } as never);
  let state = EditorState.create({
    schema,
    doc,
    plugins: [history(), ...plugins],
  });
  expect(documentBookmarkPluginKey.getState(state)!.bookmarks).toEqual(
    bookmarks,
  );
  state = state.apply(state.tr.insertText("新增", 1));
  const mapped = documentBookmarkPluginKey.getState(state)!.bookmarks;
  expect(mapped[1].position).toBe(bookmarks[1].position + 2);
  expect(
    review({
      ...content,
      ...proseMirrorToDelta(state.doc.toJSON()),
      metadata: { ...content.metadata, bookmarks: mapped },
    }).eligible,
  ).toBe(true);
  expect(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(documentBookmarkPluginKey.getState(state)!.bookmarks).toEqual(
    bookmarks,
  );
});

it("requires explicit link, alert and metadata capabilities", () => {
  expect(review(fixture.notes[0].content).requiredFeatures).toContain(
    "document-links-v1",
  );
  expect(review(fixture.notes[1].content).requiredFeatures).toContain(
    "github-alert-v1",
  );
  expect(review(metadataNote.content).requiredFeatures).toEqual(
    expect.arrayContaining(["document-metadata-v1", "document-bookmarks-v1"]),
  );
});

it("rejects malformed or executable links, orphan link fields and alert attributes", () => {
  for (const link of [
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///local",
    "nr-note://missing",
    "https://user:password@example.com",
    "/" + String.fromCharCode(92) + "user:password@example.com",
    "https://example.com\n",
  ])
    expect(
      review({
        ops: [{ insert: "link", attributes: { link } }, { insert: "\n" }],
      }).eligible,
    ).toBe(false);
  for (const attributes of [
    { linkTitle: "orphan" },
    { linkExplicit: true },
    { link: "#a", linkExplicit: false },
  ])
    expect(
      review({ ops: [{ insert: "link", attributes }, { insert: "\n" }] })
        .eligible,
    ).toBe(false);
  const base = { version: 1, content: [{ insert: "note" }, { insert: "\n" }] };
  for (const alert of ["DANGER", ["NOTE"], null, 1])
    expect(
      review({
        ops: [
          {
            insert: { blockquote: { ...base, alert } },
            attributes: { blockquote: true },
          },
          { insert: "\n" },
        ],
      }).eligible,
    ).toBe(false);
});

it("rejects unknown metadata, wrong field types and bookmarks the editor would rewrite", () => {
  const original = metadataNote.content as DeltaOps;
  const check = (metadata: unknown) =>
    expect(review({ ...original, metadata }).eligible).toBe(false);
  const m = original.metadata!;
  const b = m.bookmarks![0];
  for (const metadata of [
    { ...m, future: true },
    { ...m, author: null },
    { ...m, sourceFormat: ["markdown"] },
    { ...m, flowHeadingLevel: 7 },
    { ...m, keywords: [1] },
    { ...m, markdownSource: "\ud800" },
    { ...m, markdownSource: "![本机](nr-image://unresolved)" },
    {
      ...m,
      externalSource: {
        ...m.externalSource,
        syncedAt: "2026-02-31T00:00:00.000Z",
      },
    },
    { ...m, externalSource: { ...m.externalSource, provider: ["github"] } },
    {
      ...m,
      externalSource: { ...m.externalSource, url: "javascript:alert(1)" },
    },
    { ...m, externalSource: { ...m.externalSource, syncedAt: "not a date" } },
    { ...m, externalSource: { ...m.externalSource, future: 1 } },
    { ...m, bookmarks: [b, b] },
    ...[
      { position: 0 },
      { position: 2 },
      { position: 99999 },
      { key: "A" },
      { label: " spaced " },
      { preview: "" },
      { createdAt: "bad" },
      { extra: true },
    ].map((change) => ({ ...m, bookmarks: [{ ...b, ...change }] })),
  ])
    check(metadata);
  const source = fixture.notes.find((note) => note.id === "remaining-origins")!
    .content as DeltaOps;
  for (const change of [
    { page: 0 },
    { anchorStart: 9, anchorEnd: 1 },
    { future: 1 },
  ])
    expect(
      review({
        ...source,
        metadata: { pdfExcerpt: { ...source.metadata!.pdfExcerpt, ...change } },
      }).eligible,
    ).toBe(false);
  expect(
    review({
      ...source,
      metadata: {
        epubExcerpt: {
          ...source.metadata!.epubExcerpt,
          anchor: { ...source.metadata!.epubExcerpt!.anchor, start: 9, end: 1 },
        },
      },
    }).eligible,
  ).toBe(false);
});

it("includes every metadata field and link target in the entity digest", async () => {
  const content = metadataNote.content as DeltaOps;
  const base = await candidateEntities(payload(content), "web");
  for (const key of [
    "author",
    "markdownSource",
    "originalFileName",
    "summary",
    "license",
  ] as const) {
    const changed = structuredClone(content);
    changed.metadata![key] += "修改";
    expect(await candidateEntities(payload(changed), "web")).not.toEqual(base);
  }
  const changed = structuredClone(content);
  changed.metadata!.bookmarks![0].label = "改名";
  expect(await candidateEntities(payload(changed), "web")).not.toEqual(base);
});

it("preserves links and metadata entity hashes through IDB edits, export and fresh restore", async () => {
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
        content: retained(
          note.content as DeltaOps,
          proseMirrorToDelta(
            schema.nodeFromJSON(deltaToProseMirror(note.content)).toJSON(),
          ),
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

it("binds metadata together with the selected whole document", async () => {
  const localSource = payload(metadataNote.content);
  const changed = structuredClone(metadataNote.content) as DeltaOps;
  changed.metadata!.author = "远端作者";
  const remoteSource = payload(changed);
  const local = await candidateEntities(localSource, "web"),
    remote = await candidateEntities(remoteSource, "web");
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

it("certifies linked inline code and composed code marks using the actual schema", () => {
  const doc = schema.nodeFromJSON({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "code",
            marks: [
              {
                type: "link",
                attrs: {
                  href: "https://example.com",
                  title: "代码",
                  explicit: true,
                },
              },
              { type: "bold" },
              { type: "code" },
            ],
          },
        ],
      },
    ],
  });
  doc.check();
  const delta = proseMirrorToDelta(doc.toJSON());
  expect(review(delta).eligible).toBe(true);
  expect(review(delta).requiredFeatures).toEqual(
    expect.arrayContaining(["document-links-v1", "composed-inline-v1"]),
  );
  expect(schema.nodeFromJSON(deltaToProseMirror(delta)).eq(doc)).toBe(true);
});

it("certifies portable Mermaid image directives while keeping their source bytes unchanged", () => {
  for (const src of [
    "https://example.com/image.png",
    "data:image/png;base64,iVBORw0KGgo=",
  ]) {
    const source = `flowchart TD\n A@{ img: "${src}", label: "图片" }`;
    const delta = proseMirrorToDelta({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "mermaid" },
          content: [{ type: "text", text: source }],
        },
      ],
    });
    expect(review(delta).eligible).toBe(true);
    expect(deltaToProseMirror(delta).content[0].content![0].text).toBe(source);
  }
});

it("rejects nonportable Unicode in linked atom titles and image metadata", () => {
  for (const op of [
    {
      insert: { image: "https://example.com/image.png" },
      attributes: { imageAlt: "\ud800" },
    },
    {
      insert: {
        inlineImage: {
          src: "https://example.com/image.png",
          alt: "\ud800",
          title: null,
        },
      },
    },
    {
      insert: {
        inlineImage: {
          src: "https://example.com/\ud800",
          alt: "",
          title: null,
        },
      },
    },
    {
      insert: { mathInline: "x" },
      attributes: { link: "https://example.com", linkTitle: "\ud800" },
    },
  ])
    expect(review({ ops: [op, { insert: "\n" }] }).eligible).toBe(false);
});
