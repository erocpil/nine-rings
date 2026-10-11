import { expect, test } from "@playwright/test";
import { withDocumentSummary } from "../src/lib/storage/document-summary";

test.skip(process.env.NR_DOCUMENT_SUMMARY_BENCHMARK !== "1", "显式生产包摘要诊断，不设置机器相关的耗时门槛");

test("大量大正文文档的索引摘要与旧全文扫描对照", async ({ page }, testInfo) => {
  const records = Array.from({ length: 250 }, (_, i) => withDocumentSummary({ id: `summary-bench-${i}`, date: "2026-10-11", title: `Document ${i}`, storagePath: "ideas/summary-benchmark", content: JSON.stringify({ ops: [{ insert: "正文 English ".repeat(10000) }] }), search_text: "", tags: "[]", concepts: "[]", linkedDocIds: "[]", readonly: 1, pinned: 0, sort_order: 0, created_at: "2026-10-11", updated_at: "2026-10-11" }));
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  const result = await page.evaluate(async records => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("nine_rings"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      await new Promise<void>((resolve, reject) => { const tx = db.transaction("notes", "readwrite"); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); for (const record of records) tx.objectStore("notes").put(record); });
      const samples: { mode: string; milliseconds: number; payloadBytes: number; rows: number }[] = [];
      for (let repeat = 0; repeat < 5; repeat++) for (const mode of repeat % 2 ? ["summary", "full"] : ["full", "summary"]) {
        const start = performance.now();
        const tx = db.transaction("notes");
        const store = tx.objectStore("notes");
        const rows = mode === "full" ? await new Promise<unknown[]>((resolve, reject) => { const request = store.getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }) : await new Promise<unknown[]>((resolve, reject) => { const values: unknown[] = []; const request = store.index("document_summary").openKeyCursor(); request.onerror = () => reject(request.error); request.onsuccess = () => { const cursor = request.result; if (!cursor) { resolve(values); return; } values.push(JSON.parse((cursor.key as string[])[1])); cursor.continue(); }; });
        const milliseconds = performance.now() - start;
        samples.push({ mode, milliseconds, payloadBytes: new TextEncoder().encode(JSON.stringify(rows)).byteLength, rows: rows.length });
      }
      return samples;
    } finally { db.close(); }
  }, records);
  const full = result.filter(row => row.mode === "full"), summaries = result.filter(row => row.mode === "summary");
  expect(full[0].rows).toBe(summaries[0].rows);
  expect(summaries[0].payloadBytes).toBeLessThan(full[0].payloadBytes / 100);
  console.log("DOCUMENT_SUMMARY_BENCHMARK", JSON.stringify(result));
  await testInfo.attach("metadata-benchmark", { body: JSON.stringify(result), contentType: "application/json" });
});
