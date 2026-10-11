import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { idbAdapter } from "../../src/lib/storage/idb";
import { IDB_DATABASE_VERSION, IDB_STORES } from "../../src/types/schema_gen";

it("upgrades the previous browser schema atomically without changing source content or timestamps", async () => {
  const body = {
    ops: [
      {
        insert: {
          htmlDetails: {
            summary: "summary",
            content: [{ insert: "details body" }],
          },
        },
      },
    ],
  };
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("nine_rings", IDB_DATABASE_VERSION - 1);
    request.onupgradeneeded = () => {
      for (const [name, definition] of Object.entries(IDB_STORES)) {
        const store = request.result.createObjectStore(name, {
          keyPath: definition.keyPath,
        });
        for (const index of definition.indexes)
          if (index.name !== "document_summary")
            store.createIndex(index.name, index.keyPath);
      }
      request.transaction!.objectStore("notes").put({
        id: "legacy",
        date: "2026-10-11",
        content: body,
        title: "legacy",
        tags: "[]",
        pinned: false,
        readonly: false,
        sort_order: 0,
        created_at: "created",
        updated_at: "updated",
        storagePath: "references/upgrade",
        search_text: "stale",
      });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
  expect(await idbAdapter.getDocumentSummaries()).toMatchObject([
    { id: "legacy", title: "legacy", updated_at: "updated" },
  ]);
  expect((await idbAdapter.getNote("legacy"))!.content).toEqual(body);
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open("nine_rings");
    request.onsuccess = () => resolve(request.result);
  });
  const record = await new Promise<{ search_text: string }>((resolve) => {
    const request = db.transaction("notes").objectStore("notes").get("legacy");
    request.onsuccess = () => resolve(request.result);
  });
  expect(record.search_text).toBe("summarydetails body");
  db.close();
});
