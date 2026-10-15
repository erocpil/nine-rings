import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/candidate-entities-v1.json";
import {
  candidateEntities,
  candidateBodyProjection,
} from "../../src/lib/sync/entity-projection";
import { reviewCandidatePayload } from "../../src/lib/sync/candidate-write-policy";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import { idbAdapter } from "../../src/lib/storage/idb";
import {
  proseMirrorToDelta,
  deltaToProseMirror,
} from "../../src/lib/delta-converter";
import {
  collectFrontendSettings,
  restoreFrontendSettings,
} from "../../src/lib/backup-user-settings";
import { unlockDocument } from "../../src/lib/document-crypto";

it("round-trips candidate entities through actual IDB, local templates, protected paths/history and editor conversion", async () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
  vi.stubGlobal("localStorage", storage);
  try {
    expect(
      reviewCandidatePayload(JSON.stringify(fixture), "web").eligible,
    ).toBe(true);
    await importData(JSON.stringify(fixture), "replace");
    const before = await exportData();
    const scoped = (source: string) => {
      const { version, notes, templates, protected_paths, protected_versions } =
        JSON.parse(source);
      return JSON.stringify({
        version,
        notes,
        templates,
        protected_paths,
        protected_versions,
      });
    };
    // Full Web AppConfig is now a separate certified entity; compare body scope below.
    expect(reviewCandidatePayload(before, "web").eligible).toBe(true);
    expect(await candidateEntities(scoped(before), "web")).toEqual(
      await candidateEntities(JSON.stringify(fixture), "web"),
    );
    const body = fixture.notes[0].content;
    const pm = deltaToProseMirror(body);
    const edited = proseMirrorToDelta(pm);
    expect(candidateBodyProjection(edited)).toEqual(
      candidateBodyProjection(body),
    );
    await idbAdapter.updateNote(fixture.notes[0].id, { content: edited });
    const after = JSON.parse(await exportData());
    const original = await candidateEntities(JSON.stringify(fixture), "web");
    const actual = await candidateEntities(
      scoped(JSON.stringify(after)),
      "web",
    );
    // Saving is a real metadata change: compare all fields except its declared updated_at timestamp.
    const note = actual.find(
      (e) => e.kind === "note" && e.id === fixture.notes[0].id,
    )!;
    const expected = original.find(
      (e) => e.kind === "note" && e.id === note.id,
    )!;
    expect({ ...(note.value as object), updated_at: null }).toEqual({
      ...(expected.value as object),
      updated_at: null,
    });
    expect(actual.filter((e) => e.id !== note.id)).toEqual(
      original.filter((e) => e.id !== note.id),
    );
    expect(
      (
        await unlockDocument(
          after.notes.find((n: { id: string }) => n.id === "protected-001")
            .content,
          "candidate-test-password",
        )
      ).content,
    ).toEqual({ ops: [{ insert: "受保护示例\n" }] });
    const settings = {
      version: 1 as const,
      values: {
        "nr:focusMode": true,
        "nr:github-sync": {
          owner: "example",
          repo: "backup",
          path: "backup.json",
        },
      },
    };
    restoreFrontendSettings(settings, storage);
    const exported = collectFrontendSettings(storage);
    delete exported.values["nine-rings:templates"]; // Templates have their own independently tested entity store.
    expect(exported).toEqual(settings);
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each([
  { ops: [{ insert: "unterminated" }] },
  { ops: [{ insert: "CR\r\n" }] },
  { ops: [{ insert: "title\n", attributes: { header: 2 } }] },
  { ops: [{ insert: "text", attributes: { bold: false } }, { insert: "\n" }] },
  { ops: [{ insert: "line\n", attributes: { bold: true } }] },
])(
  "refuses editor-normalized forms before claiming round-trip support",
  (body) => {
    const value = structuredClone(fixture);
    value.notes[0].content = body as (typeof fixture.notes)[number]["content"];
    expect(reviewCandidatePayload(JSON.stringify(value), "web").eligible).toBe(
      false,
    );
  },
);
