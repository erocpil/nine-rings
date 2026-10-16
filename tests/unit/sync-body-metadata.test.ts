import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import fixture from "../../schema/sync/fixtures/candidate-reference-anchors-v1.json";
import {
  referenceAnchorPlugin,
  referenceAnchorPluginKey,
} from "../../src/extensions/ReferenceAnchors";
import {
  deltaToProseMirror,
  proseMirrorToDelta,
} from "../../src/lib/delta-converter";
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import {
  candidateEntities,
  candidateBodyProjection,
} from "../../src/lib/sync/entity-projection";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import type { DocumentReferenceAnchor } from "../../src/types/models";

const payload = (content: unknown) =>
  JSON.stringify({ ...fixture, notes: [{ ...fixture.notes[0], content }] });
it("certifies empty and real anchors while preserving metadata in semantic hashes", async () => {
  for (const runtime of ["web", "tauri"] as const)
    expect(
      reviewCandidatePayload(JSON.stringify(fixture), runtime),
    ).toMatchObject({
      eligible: true,
      requiredFeatures: expect.arrayContaining(["reference-anchors-v1"]),
    });
  expect(
    reviewCandidatePayload(JSON.stringify(fixture), "flutter").eligible,
  ).toBe(false);
  const body = fixture.notes[0].content;
  expect(candidateBodyProjection(body)).toHaveProperty(
    "metadata",
    body.metadata,
  );
  const before = await candidateEntities(payload(body), "web");
  const changed = structuredClone(body);
  changed.metadata.referenceAnchors[0].preview = "renamed";
  expect(await candidateEntities(payload(changed), "web")).not.toEqual(before);
  expect(
    candidateBodyProjection({ ops: [{ insert: "a\n" }], metadata: {} }),
  ).not.toEqual(candidateBodyProjection({ ops: [{ insert: "a\n" }] }));
});
it("rejects unknown metadata, duplicate identities and invalid anchor bounds without rewriting", () => {
  const anchor = fixture.notes[0].content.metadata.referenceAnchors[0];
  const bad = [
    null,
    { bookmarks: null },
    { sourceFormat: "invalid" },
    { referenceAnchors: null },
    { referenceAnchors: [anchor, anchor] },
    ...[
      { from: -1 },
      { to: 999 },
      { from: 0.5 },
      { kind: "unknown" },
      { kind: ["range"] },
      { extra: true },
      { deleted: "true" },
      { preview: "x".repeat(81) },
      { kind: "position" },
      { from: 5, to: 5 },
      { id: "" },
    ].map((change) => ({ referenceAnchors: [{ ...anchor, ...change }] })),
  ];
  for (const metadata of bad) {
    const source = payload({ ...fixture.notes[0].content, metadata });
    expect(reviewCandidatePayload(source, "web").eligible).toBe(false);
  }
});
it("maps anchors through actual edit and undo, then survives IDB export and restore", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  try {
    const original = fixture.notes[0].content;
    const schema = getSchema([StarterKit]);
    const doc = schema.nodeFromJSON(deltaToProseMirror(original));
    let state = EditorState.create({
      schema,
      doc,
      plugins: [
        history(),
        referenceAnchorPlugin(
          original.metadata.referenceAnchors as DocumentReferenceAnchor[],
        ),
      ],
    });
    expect(referenceAnchorPluginKey.getState(state)?.anchors).toEqual(
      original.metadata.referenceAnchors,
    );
    state = state.apply(state.tr.insertText("前缀", 1));
    const saved = {
      ...proseMirrorToDelta(state.doc.toJSON()),
      metadata: {
        referenceAnchors: referenceAnchorPluginKey.getState(state)!.anchors,
      },
    };
    expect(saved.metadata.referenceAnchors[0].from).toBe(4);
    expect(reviewCandidatePayload(payload(saved), "web").eligible).toBe(true);
    expect(
      undo(state, (tr) => {
        state = state.apply(tr);
      }),
    ).toBe(true);
    expect(referenceAnchorPluginKey.getState(state)?.anchors).toEqual(
      original.metadata.referenceAnchors,
    );
    await importData(payload(saved), "replace");
    const exported = await exportData();
    await importData(JSON.stringify({ ...fixture, notes: [] }), "replace");
    await importData(exported, "replace");
    const restored = JSON.parse(await exportData());
    expect(restored.notes[0].content).toEqual(saved);
    expect(await candidateEntities(exported, "web")).toEqual(
      await candidateEntities(JSON.stringify(restored), "web"),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
