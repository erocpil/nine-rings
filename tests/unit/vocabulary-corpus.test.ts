import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { importCorpus, listCorpora, readCorpusEntry, exportCorpus, corpusSummaries } from "../../src/lib/vocabulary/corpus-store";
import { readVocabularyPackage, validateVocabularyPackage, boundedText } from "../../src/lib/vocabulary/package";
import { vocabularyResourceKey } from "../../src/lib/vocabulary/contracts";
import type { VocabularyPackage } from "../../src/lib/vocabulary/contracts";

const pack = (revision = 1): VocabularyPackage => ({
  format: "nine-rings-vocabulary", version: 1, id: "awl", name: "AWL", revision,
  entries: [{ id: "word-a", word: "sample", group: "unit1", source: "# sample\n\n## Cambridge\n\n### noun\n\nExample.",
    addedAt: "2026-01-01T00:00:00Z" }],
});
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("nine-rings-vocabulary");
    req.onsuccess = () => resolve(); req.onerror = () => reject(req.error);
  });
});
it("imports compressed shards, exposes summaries without bodies, and roundtrips original Markdown", async () => {
  const input = pack();
  await importCorpus(input);
  expect(await exportCorpus("awl")).toEqual(input);
  const index = await corpusSummaries("references/vocabulary");
  expect(index).toHaveLength(1);
  expect(index[0]).not.toHaveProperty("source");
  expect(index[0].storagePath).toBe("references/vocabulary/词库-awl/unit1");
  expect(await readCorpusEntry(index[0].id)).toEqual(input.entries[0]);
  const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("nine_rings"); r.onsuccess = () => resolve(r.result); });
  expect(db.objectStoreNames.contains("notes")).toBe(false); db.close();
});
it("keeps identity across renaming/moving and rejects conflicting or stale revisions atomically", async () => {
  await importCorpus(pack());
  const next = pack(2); next.entries[0].word = "renamed"; next.entries[0].group = "other"; next.entries[0].source += "\nupdated";
  await importCorpus(next);
  const key = vocabularyResourceKey({ kind: "corpus", corpusId: "awl", entryId: "word-a" });
  expect((await readCorpusEntry(key)).word).toBe("renamed");
  await expect(importCorpus(pack())).rejects.toThrow("版本过旧");
  await expect(importCorpus({ ...next, name: "conflict" })).rejects.toThrow("版本");
  expect(await exportCorpus("awl")).toEqual(next);
  await importCorpus(next);
  expect(await listCorpora()).toHaveLength(1);
});
it("rejects duplicate identities, unknown versions, invalid groups and oversized sources", () => {
  const input = pack();
  for (const bad of [
    { ...input, version: 2 }, { ...input, entries: [...input.entries, ...input.entries] },
    { ...input, entries: [{ ...input.entries[0], group: "../secret" }] },
    { ...input, entries: [{ ...input.entries[0], source: "x".repeat(250001) }] },
    { ...input, entries: [{ ...input.entries[0], extension: true }] },
  ]) expect(() => validateVocabularyPackage(bad)).toThrow();
});
it("reads gzip packages and bounds decompression before JSON allocation", async () => {
  const blob = new Blob([JSON.stringify(pack())]);
  const compressed = await new Response(blob.stream().pipeThrough(new CompressionStream("gzip"))).blob();
  expect(await readVocabularyPackage(compressed)).toEqual(pack());
  await expect(boundedText(new Blob(["abcdef"]).stream(), 3)).rejects.toThrow("大小限制");
});
it("normalizes field order and changes only the edited entry's stable shard", async () => {
  const input = pack();
  input.entries.push({ ...input.entries[0], id: "word-b", word: "beta" });
  await importCorpus(input);
  const before = (await listCorpora())[0];
  await importCorpus({ entries: input.entries, name: input.name, revision: 1, id: input.id, version: 1, format: input.format });
  const next = structuredClone(input); next.revision = 2; next.entries[0].source += " changed";
  await importCorpus(next);
  const after = (await listCorpora())[0];
  expect(Object.keys(after.shards).filter(key => after.shards[key] !== before.shards[key])).toHaveLength(1);
});
it("detects damaged compressed storage without changing the manifest", async () => {
  const input = pack(); input.entries[0].id = "unique-corruption-case";
  await importCorpus(input);
  const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("nine-rings-vocabulary"); r.onsuccess = () => resolve(r.result); });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("shards", "readwrite");
    const req = tx.objectStore("shards").openCursor();
    req.onsuccess = () => { if (req.result) req.result.update({ ...req.result.value, bytes: new TextEncoder().encode("[]").buffer, gzip: false }); };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  db.close();
  await expect(readCorpusEntry("vocab:awl:unique-corruption-case")).rejects.toThrow("校验失败");
  expect((await listCorpora())[0].revision).toBe(1);
});
