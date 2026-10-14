import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import fixture from "../../schema/sync/fixtures/storage-roundtrip.json";
import { importData, exportData } from "../../src/lib/storage/db-export-import";
import { idbAdapter } from "../../src/lib/storage/idb";
import { canonicalDigest } from "../../src/lib/sync/canonical-codec";

it("measures actual Web persistence: body and note/template extensions survive, bundle extensions do not", async () => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  });
  try {
    await importData(JSON.stringify(fixture), "replace");
    await idbAdapter.updateNote(fixture.notes[0].id, { title: "改名后仍保留" });
    const restored = JSON.parse(await exportData());
    expect(restored.notes[0].title).toBe("改名后仍保留");
    expect(await canonicalDigest(restored.notes[0].content)).toBe(
      await canonicalDigest(fixture.notes[0].content),
    );
    expect(restored.notes[0].futureRecord).toEqual(
      fixture.notes[0].futureRecord,
    );
    expect(restored.templates[0].futureTemplate).toEqual(
      fixture.templates[0].futureTemplate,
    );
    expect(restored.notes[0]).toMatchObject({
      storagePath: "references/sync",
      docType: "reference",
      concepts: ["编码"],
      linkedDocIds: ["other-001"],
    });
    expect(restored).not.toHaveProperty("futureBundle");
  } finally {
    vi.unstubAllGlobals();
  }
});
