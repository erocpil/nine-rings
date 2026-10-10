import { expect, test } from "@playwright/test";
import { createBlankDocument } from "./helpers/document";
import { replaceSource } from "./helpers/source-editor";
import type { Editor } from "@tiptap/core";

test("真实双视图编辑共享保存修订，书签重映射不重复计数，视图投影不计数", async ({ page }) => {
  await createBlankDocument(page);
  await page.evaluate(async () => {
    const path = "/src/lib/auto-save-queue.ts";
    const { AutoSaveQueue } = await import(/* @vite-ignore */ path);
    const mark = AutoSaveQueue.prototype.mark;
    AutoSaveQueue.prototype.mark = function(...args) {
      mark.apply(this, args);
      Object.assign(window, { revisionTestQueue: this, revisionTestId: args[0] });
    };
  });
  const root = page.locator(".ProseMirror");
  const state = () => page.evaluate(() => {
    const host = window as any;
    return host.revisionTestQueue.revisionState(host.revisionTestId);
  });
  await root.evaluate(el => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    ed.commands.setContent("<p>first</p><p>bookmark target</p>", true);
    ed.commands.setTextSelection(9);
  });
  expect((await state()).contentRevision).toBe(1);
  await root.evaluate(async el => {
    const path = "/src/extensions/DocumentBookmarks.ts";
    const { toggleBookmark } = await import(/* @vite-ignore */ path);
    toggleBookmark((el as HTMLElement & { editor: Editor }).editor);
  });
  expect((await state()).contentRevision).toBe(2);
  await root.evaluate(el => {
    const ed = (el as HTMLElement & { editor: Editor }).editor;
    ed.commands.setTextSelection(1);
    ed.commands.insertContent("inserted "); // shifts the bookmark in the same transaction
  });
  expect((await state()).contentRevision).toBe(3);
  await root.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.undo());
  expect((await state()).contentRevision).toBe(4);
  await root.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.redo());
  expect((await state()).contentRevision).toBe(5);
  const before = await state();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect.poll(state).toEqual({ ...before, confirmedRevision: before.contentRevision });
  const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
  await replaceSource(source, "# Source\n\nbody");
  expect((await state()).contentRevision).toBe(6);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await state()).contentRevision).toBe(7);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  expect((await state()).contentRevision).toBe(8);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  expect((await state()).contentRevision).toBe(8);
  await expect.poll(async () => (await state()).confirmedRevision).toBe(8);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect((await state()).documentGeneration).toBe(before.documentGeneration);
  expect((await state()).contentRevision).toBe(8);
});


test("属性 API 与正文共享修订，真实选区和双视图切换使旧目标失效", async ({ page }) => {
  await createBlankDocument(page);
  await page.evaluate(async () => {
    const queues = await import("/src/lib/auto-save-queue.ts");
    const sessions = await import("/src/lib/document-edit-sessions.ts");
    const mark = queues.AutoSaveQueue.prototype.mark;
    queues.AutoSaveQueue.prototype.mark = function (...args) {
      mark.apply(this, args);
      Object.assign(window, { hostQueue: this, hostId: args[0] });
    };
    const select = sessions.DocumentEditSessions.prototype.select;
    sessions.DocumentEditSessions.prototype.select = function (...args) {
      select.apply(this, args);
      Object.assign(window, { hostSessions: this });
    };
  });
  await page.locator(".ProseMirror:visible").evaluate(el => {
    const editor = (el as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent("<p>host targets</p>", true);
    editor.commands.setTextSelection(3);
  });
  const state = () => page.evaluate(() => (window as any).hostQueue.revisionState((window as any).hostId));
  await page.evaluate(() => {
    const host = window as any;
    host.hostTarget = host.hostSessions.capture(host.hostId);
  });
  const before = await state();
  await page.locator(".ProseMirror:visible").evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.setTextSelection(5));
  expect((await state()).contentRevision).toBe(before.contentRevision);
  expect(await page.evaluate(() => {
    try { (window as any).hostSessions.validate((window as any).hostTarget); return false; }
    catch { return true; }
  })).toBe(true);
  await page.evaluate(async () => {
    const host = window as any;
    const { api } = await import("/src/lib/api.ts");
    await api.notes.update(host.hostId, { pinned: true, concepts: ["host-property"] });
  });
  expect((await state()).contentRevision).toBe(before.contentRevision + 1);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.getByRole("textbox", { name: "Markdown 源码", exact: true }).click();
  await page.evaluate(() => {
    const host = window as any;
    host.hostTarget = host.hostSessions.capture(host.hostId);
    if (host.hostTarget.view !== "source") throw new Error("source session missing");
  });
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  expect(await page.evaluate(() => {
    try { (window as any).hostSessions.validate((window as any).hostTarget); return false; }
    catch { return true; }
  })).toBe(true);
  expect((await state()).documentGeneration).toBe(before.documentGeneration);
});
