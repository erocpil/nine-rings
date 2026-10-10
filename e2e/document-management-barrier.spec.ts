import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument } from "./helpers/document";

test("版本检查点包含最新正文，保存失败时不创建历史，显式重试后才创建", async ({ page }) => {
  await createBlankDocument(page);
  const outcome = await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { getAdapter } = await import("/src/lib/storage/index.ts");
    const id = localStorage.getItem("nr:lastNote")!;
    const editor = (document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }).editor;
    const adapter = await getAdapter();
    const before = (await api.versions.list(id)).length;
    const original = adapter.updateNote;
    adapter.updateNote = async () => { adapter.updateNote = original; throw new Error("simulated save failure"); };
    editor.commands.setContent("<p>checkpoint latest body</p>", true);
    let failed = false;
    try { await api.versions.checkpoint(id); } catch { failed = true; }
    const afterFailure = (await api.versions.list(id)).length;
    await api.versions.checkpoint(id);
    const versions = await api.versions.list(id);
    return { failed, before, afterFailure, bodies: versions.map(version => version.content.ops.map(op => op.insert).join("")) };
  });
  expect(outcome.failed).toBe(true);
  expect(outcome.afterFailure).toBe(outcome.before);
  expect(outcome.bodies).toContain("checkpoint latest body\n");
});

test("批量管理先保存待编辑正文，暂停编辑并使旧目标失效，目标数组在调用时冻结", async ({ page }) => {
  await createBlankDocument(page);
  await page.evaluate(async () => {
    const { AutoSaveQueue } = await import("/src/lib/auto-save-queue.ts");
    const mark = AutoSaveQueue.prototype.mark;
    AutoSaveQueue.prototype.mark = function (...args) {
      mark.apply(this, args);
      Object.assign(window, { managementQueue: this });
    };
  });
  await page.locator(".ProseMirror:visible").evaluate(el => {
    (el as HTMLElement & { editor: Editor }).editor.commands.setContent("<p>latest unsaved body</p>", true);
  });
  await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const { getAdapter } = await import("/src/lib/storage/index.ts");
    const adapter = await getAdapter();
    const original = adapter.batchSetReadonly;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    adapter.batchSetReadonly = async (ids, readonly) => {
      Object.assign(window, { managementTargets: ids, managementStarted: true });
      await gate;
      adapter.batchSetReadonly = original;
      return original(ids, readonly);
    };
    const host = window as any;
    const id = localStorage.getItem("nr:lastNote")!;
    const token = host.managementQueue.captureRevision(id);
    const ids = [id];
    const operation = api.recycle.batch.setReadonly(ids, true);
    ids.push("must-not-be-added");
    Object.assign(window, { managementOperation: operation, managementRelease: release, managementToken: token });
  });
  await expect.poll(() => page.evaluate(() => Boolean((window as any).managementStarted))).toBe(true);
  expect(await page.locator(".ProseMirror:visible").evaluate(el => Boolean(el.closest("[inert][aria-busy]")))).toBe(true);
  await page.evaluate(async () => {
    const host = window as any;
    host.managementRelease();
    await host.managementOperation;
  });
  expect(await page.evaluate(async () => {
    const { api } = await import("/src/lib/api.ts");
    const host = window as any;
    const id = localStorage.getItem("nr:lastNote")!;
    const note = await api.notes.get(id);
    let stale = false;
    try { await host.managementQueue.whenSaved(id, host.managementToken); }
    catch { stale = true; }
    return { targets: host.managementTargets, readonly: note?.readonly, body: note?.content.ops.map(op => op.insert).join(""), stale };
  })).toMatchObject({ readonly: true, body: "latest unsaved body\n", stale: true });
  expect(await page.evaluate(() => (window as any).managementTargets)).toEqual([await page.evaluate(() => localStorage.getItem("nr:lastNote"))]);
  await expect.poll(() => page.locator(".ProseMirror:visible").evaluate(el => Boolean(el.closest("[inert][aria-busy]")))).toBe(false);
});
