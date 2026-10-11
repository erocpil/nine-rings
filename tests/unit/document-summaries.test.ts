import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { idbAdapter } from "../../src/lib/storage/idb";
import { withDB } from "../../src/lib/storage/db";
import { noteFromDB, type StoredNote } from "../../src/lib/storage/core";

describe("document metadata projection", () => {
  it("reads index keys without reading or parsing bodies, tracks update/delete/restore and excludes backup cache", async () => {
    const note = await idbAdapter.createNote({
      title: "summary",
      storagePath: "ideas/summaries",
      content: {
        ops: [{ insert: "x".repeat(100000) }],
        metadata: { sourceFormat: "text" },
      },
    });
    const originalGetAll = IDBObjectStore.prototype.getAll;
    const originalCursor = IDBObjectStore.prototype.openCursor;
    IDBObjectStore.prototype.getAll = () => {
      throw new Error("Full records must not be read");
    };
    IDBObjectStore.prototype.openCursor = () => {
      throw new Error("Bodies must not be scanned");
    };
    try {
      const summary = (await idbAdapter.getDocumentSummaries()).find(
        (n) => n.id === note.id,
      )!;
      expect(summary).not.toHaveProperty("content");
      expect(summary.contentBytes).toBeGreaterThan(100000);
      expect(summary.sourceFormat).toBe("text");
      await idbAdapter.updateNote(note.id, {
        title: "renamed",
        storagePath: "projects/moved",
      });
      expect(
        (await idbAdapter.getDocumentSummaries()).find((n) => n.id === note.id),
      ).toMatchObject({ title: "renamed", storagePath: "projects/moved" });
      await idbAdapter.deleteNote(note.id);
      expect(
        (await idbAdapter.getDocumentSummaries()).some((n) => n.id === note.id),
      ).toBe(false);
      await idbAdapter.restoreNote(note.id);
      expect(
        (await idbAdapter.getDocumentSummaries()).some((n) => n.id === note.id),
      ).toBe(true);
    } finally {
      IDBObjectStore.prototype.getAll = originalGetAll;
      IDBObjectStore.prototype.openCursor = originalCursor;
    }
    await withDB(async (db) => {
      const request = db
        .transaction("notes", "readonly")
        .objectStore("notes")
        .get(note.id);
      const stored = await new Promise<StoredNote>((resolve) => {
        request.onsuccess = () => resolve(request.result);
      });
      expect(noteFromDB(stored)).not.toHaveProperty("document_summary");
    });
  });
  it("repairs older writers that omit or retain an outdated projection", async () => {
    const note = await idbAdapter.createNote({
      title: "old writer",
      storagePath: "ideas/legacy",
      content: { ops: [{ insert: "old" }] },
    });
    await withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const request = store.get(note.id);
      request.onsuccess = () =>
        store.put({
          ...request.result,
          title: "external rename",
          updated_at: "2099-01-01",
          content: { ops: [{ insert: "external edit" }] },
        });
    });
    expect(
      (await idbAdapter.getDocumentSummaries()).find(
        (row) => row.id === note.id,
      ),
    ).toMatchObject({ title: "external rename", updated_at: "2099-01-01" });
    await withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const request = store.get(note.id);
      request.onsuccess = () => {
        const row = request.result;
        delete row.document_summary;
        store.put(row);
      };
    });
    expect(
      (await idbAdapter.getDocumentSummaries()).find(
        (row) => row.id === note.id,
      )?.title,
    ).toBe("external rename");
    const backup = JSON.parse(await idbAdapter.exportData());
    expect(
      backup.notes.find((row: { id: string }) => row.id === note.id),
    ).not.toHaveProperty("document_summary");
    await idbAdapter.importData(JSON.stringify(backup), "replace");
    expect(
      (await idbAdapter.getDocumentSummaries()).find(
        (row) => row.id === note.id,
      )?.title,
    ).toBe("external rename");
  });
  it("repairs malformed derived keys without changing the authoritative body", async () => {
    const note = await idbAdapter.createNote({
      title: "corrupt cache",
      storagePath: "ideas/cache",
      content: { ops: [{ insert: "authoritative" }] },
    });
    await withDB(async (db) => {
      const store = db.transaction("notes", "readwrite").objectStore("notes");
      const request = store.get(note.id);
      request.onsuccess = () =>
        store.put({ ...request.result, document_summary: "not-json" });
    });
    expect(
      (await idbAdapter.getDocumentSummaries()).find(
        (row) => row.id === note.id,
      )?.title,
    ).toBe("corrupt cache");
    expect((await idbAdapter.getNote(note.id))!.content.ops).toEqual([
      { insert: "authoritative" },
    ]);
  });
});
