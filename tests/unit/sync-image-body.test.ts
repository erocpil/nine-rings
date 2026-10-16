import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import fixture from "../../schema/sync/fixtures/candidate-image-v1.json";
import { DocumentStarterKit } from "../../src/extensions/DocumentStarterKit";
import { ResizableImage } from "../../src/extensions/ResizableImage";
import { BlockIndent } from "../../src/extensions/BlockIndent";
import { CollapsibleBlockquote } from "../../src/extensions/CollapsibleBlockquote";
import { MarkdownTaskState } from "../../src/extensions/MarkdownTaskState";
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
import { storeImage } from "../../src/lib/storage/db-images";
import { assembleEntityCandidate } from "../../src/lib/sync/entity-assembly";
import { entityKey } from "../../src/lib/sync/entity-plan";

const schema = getSchema([
  DocumentStarterKit.configure({ blockquote: false }),
  CollapsibleBlockquote,
  ResizableImage,
  BlockIndent,
  MarkdownTaskState,
]);
const payload = (content: unknown) =>
  JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content }] });

it.each(fixture.notes)(
  "certifies $id through image resize/undo and real editor schema",
  (note) => {
    const doc = schema.nodeFromJSON(deltaToProseMirror(note.content));
    doc.check();
    expect(candidateBodyProjection(proseMirrorToDelta(doc.toJSON()))).toEqual(
      candidateBodyProjection(note.content),
    );
    let imagePos = -1;
    doc.descendants((node, pos) => {
      if (imagePos < 0 && node.type.name === "resizableImage") imagePos = pos;
    });
    expect(imagePos).toBeGreaterThanOrEqual(0);
    let state = EditorState.create({ schema, doc, plugins: [history()] });
    const image = state.doc.nodeAt(imagePos)!;
    state = state.apply(
      state.tr.setNodeMarkup(imagePos, undefined, {
        ...image.attrs,
        width: "200px",
        alt: "edited alt",
        title: "edited title",
      }),
    );
    const changed = proseMirrorToDelta(state.doc.toJSON());
    for (const runtime of ["web", "tauri"] as const) {
      for (const content of [note.content, changed])
        expect(reviewCandidatePayload(payload(content), runtime)).toMatchObject(
          {
            eligible: true,
            requiredFeatures: expect.arrayContaining(["block-image-v1"]),
          },
        );
    }
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(state.doc.eq(doc)).toBe(true);
    expect(
      reviewCandidatePayload(payload(note.content), "flutter").eligible,
    ).toBe(false);
    expect(CURRENT_SYNC_CAPABILITIES.read).toBe(0);
    expect(CURRENT_SYNC_CAPABILITIES.write).toBe(0);
  },
);

it.each([
  "nr-image://local-id",
  "blob:https://example.com/local",
  "file:///private/photo.png",
  "../photo.png",
  "//example.com/photo.png",
  "javascript:alert(1)",
  "https://user:password@example.com/photo.png",
  "https://",
  "https://example.com/\u0000photo.png",
  "https://example.com/ bad.png",
  "data:image/svg+xml;base64,PHN2Zy8+",
  "data:image/png;base64,AA=",
  "data:image/png;base64,AB==",
  "data:image/png;base64,",
  "data:text/html;base64,AAAA",
])("refuses unresolved, unsafe or malformed image source %s", (image) => {
  expect(
    reviewCandidatePayload(
      payload({ ops: [{ insert: { image } }, { insert: "\n" }] }),
      "web",
    ).eligible,
  ).toBe(false);
});
it("rejects unknown, lossy image fields and uncertified inline images", () => {
  const image = "https://example.com/image.png";
  for (const attributes of [
    { imageWidth: "50%" },
    { imageWidth: "0px" },
    { imageWidth: 0 },
    { imageWidth: 2.5 },
    { imageWidth: "1px; color:red" },
    { imageAlt: "" },
    { imageTitle: null },
    { imageAlt: 3 },
    { color: "#aabbcc" },
    { blockquote: true },
    { unknown: true },
    { indent: 9 },
  ])
    expect(
      reviewCandidatePayload(
        payload({ ops: [{ insert: { image }, attributes }, { insert: "\n" }] }),
        "web",
      ).eligible,
    ).toBe(false);
  for (const content of [
    { ops: [{ insert: { image, extra: true } }, { insert: "\n" }] },
    { ops: [{ insert: { inlineImage: { src: image } } }, { insert: "\n" }] },
    { ops: [{ insert: { image }, attributes: { imageWidth: "100px" } }] },
  ])
    expect(reviewCandidatePayload(payload(content), "web").eligible).toBe(
      false,
    );
});

it("preserves image hashes through IDB edit/export/fresh restore and changes hashes for image fields", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
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
    const original = fixture.notes[1].content;
    const before = await candidateEntities(payload(original), "web");
    for (const field of ["imageAlt", "imageTitle", "imageWidth"]) {
      const changed = structuredClone(original) as {
        ops: { insert: unknown; attributes?: Record<string, unknown> }[];
      };
      changed.ops[0].attributes = {
        ...changed.ops[0].attributes,
        [field]: field === "imageWidth" ? "400px" : "changed",
      };
      expect(await candidateEntities(payload(changed), "web")).not.toEqual(
        before,
      );
    }
    const changed = structuredClone(original);
    (changed.ops[0].insert as { image: string }).image =
      "https://example.com/other.png";
    expect(await candidateEntities(payload(changed), "web")).not.toEqual(
      before,
    );
    const ref = await storeImage(
      new Blob([new Uint8Array([0, 0, 0])], { type: "image/png" }),
    );
    await importData(
      payload({ ops: [{ insert: { image: ref } }, { insert: "\n" }] }),
      "replace",
    );
    const exported = JSON.parse(await exportData());
    expect(exported.notes[0].content.ops[0].insert.image).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(
      reviewCandidatePayload(
        JSON.stringify({ ...fixture, notes: exported.notes }),
        "web",
      ).eligible,
    ).toBe(true);
    await importData(
      payload({
        ops: [
          { insert: { image: "nr-image://missing-resource" } },
          { insert: "\n" },
        ],
      }),
      "replace",
    );
    await expect(exportData()).rejects.toThrow("备份缺少本地图片");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("assembles a local image choice against a different fixed remote image without mixing fields", async () => {
  const source = payload(fixture.notes[0].content);
  const entities = await candidateEntities(source, "web");
  const value = structuredClone(entities[0].value) as {
    content: { ops: { insert: { image?: string } | string }[] };
  };
  (value.content.ops[0].insert as { image: string }).image =
    "https://example.com/remote.png";
  const remoteSource = payload(value.content);
  const remote = await candidateEntities(remoteSource, "web");
  const assembled = await assembleEntityCandidate({
    spaceId: "a".repeat(64),
    localSource: source,
    remoteSource,
    runtime: "web",
    baselines: [],
    choices: [
      {
        key: entityKey(entities[0]),
        localHash: entities[0].sha256,
        remoteHash: remote[0].sha256,
        action: "local",
      },
    ],
  });
  expect(assembled.writable).toBe(false);
  expect(await candidateEntities(assembled.source, "web")).toEqual(entities);
});
