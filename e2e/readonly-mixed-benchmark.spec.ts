import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { mdToDelta } from "../src/lib/md-parser";
import { withDocumentSummary } from "../src/lib/storage/document-summary";

test.skip(process.env.NR_READONLY_BENCHMARK !== "1" || !process.env.LARGE_DOCUMENT_FIXTURE, "显式提供本机真实混合文档，不提交原文");

test("真实混合文档生产包完整/局部请求各三次及末尾定位", async ({ page, context, browserName }, testInfo) => {
  const source = await readFile(process.env.LARGE_DOCUMENT_FIXTURE!, "utf8");
  const content = mdToDelta(source);
  const firstHeading = source.match(/^#{1,6}\s+(.+)$/m)?.[1];
  if (!firstHeading) throw new Error("诊断文档需要一个可辨认的首标题");
  const id = "readonly-mixed-benchmark";
  const record = withDocumentSummary({ id, title: "真实混合文档诊断", date: "2026-10-11", storagePath: "ideas/diagnostics", content, tags: "[]", readonly: 1, pinned: 0, sort_order: 0, created_at: "2026-10-11", updated_at: "2026-10-11" });
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async record => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open("nine_rings"); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction("notes", "readwrite"); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.objectStore("notes").put(record); });
    db.close();
  }, record);
  await page.close();
  const samples = [];
  for (let repetition = 0; repetition < 3; repetition++) for (const requestedVirtual of repetition % 2 ? [true, false] : [false, true]) {
    const sample = await context.newPage();
    await sample.addInitScript(({ id, requestedVirtual, firstHeading }) => {
      localStorage.setItem("nr:lastNote", id);
      localStorage.setItem("nr:workspaceTarget", JSON.stringify({ kind: "note", noteId: id }));
      localStorage.setItem("nr:experimentalReadonlyRendering", String(requestedVirtual));
      localStorage.setItem("nr:sidebarHidden", "true");
      localStorage.setItem(`scrollPos:${id}`, "0");
      localStorage.removeItem(`selectionPos:${id}`);
      localStorage.removeItem(`nr:readonlyAnchor:${id}`);
      localStorage.removeItem(`nr:readingState:${id}`);
      const observer = new MutationObserver(() => {
        const root = document.querySelector(".ProseMirror");
        if (!root || root.querySelector("h1,h2,h3,h4,h5,h6")?.textContent !== firstHeading) return;
        observer.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const root = document.querySelector(".ProseMirror")!;
          const virtual = Boolean(document.querySelector("[data-virtual-reader]"));
          Object.assign(window, { mixedProbe: { readyMs: performance.now(), effectiveVirtual: virtual, mountedBlocks: virtual ? document.querySelectorAll("[data-reading-row]").length : root.children.length, bodyElements: (virtual ? document.querySelector(".vr-body")! : root).querySelectorAll("*").length } });
        }));
      });
      observer.observe(document, { childList: true, subtree: true });
    }, { id, requestedVirtual, firstHeading });
    await sample.goto("/");
    await expect.poll(() => sample.evaluate(() => (window as unknown as { mixedProbe?: unknown }).mixedProbe), { timeout: 60000 }).toBeTruthy();
    const probe = await sample.evaluate(() => (window as unknown as { mixedProbe: object }).mixedProbe);
    const root = sample.locator(".note-editor-scroll");
    await root.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => root.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop)), { timeout: 10000 }).toBeLessThan(3);
    const scrolling = await root.evaluate(async element => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.4;
      const frames = [];
      let previous = performance.now();
      for (let i = 0; i < 90; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - previous); previous = now;
        element.scrollTop += 70;
      }
      return { over50ms: frames.filter(value => value > 50).length, p95: [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] };
    });
    samples.push({ browserName, repetition, requestedVirtual, ...probe, scrolling });
    await sample.close();
  }
  console.log("READONLY_MIXED_AB", JSON.stringify(samples));
  await testInfo.attach("mixed-ab", { body: JSON.stringify(samples), contentType: "application/json" });
});
