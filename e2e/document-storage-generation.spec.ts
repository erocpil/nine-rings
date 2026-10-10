import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";
import { createBlankDocument, waitForSavedText } from "./helpers/document";

test("另一窗口恢复后，延迟的旧正文写入被拒绝，保留恢复正文与本页草稿", async ({ page, context }) => {
  await createBlankDocument(page);
  await page.locator(".ProseMirror").evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.setContent("<p>original</p>", true));
  await waitForSavedText(page, "original");
  const id = await page.evaluate(() => localStorage.getItem("nr:lastNote"));
  const other = await context.newPage();
  const pageErrors: string[] = [];
  other.on("pageerror", error => pageErrors.push(error.stack ?? error.message));
  await other.goto("/");
  await expect(other.locator(".note-title")).toHaveValue("折叠回归");
  await other.evaluate(async () => {
    const { getAdapter } = await import("/src/lib/storage/index.ts");
    const { AutoSaveQueue } = await import("/src/lib/auto-save-queue.ts");
    const mark = AutoSaveQueue.prototype.mark;
    AutoSaveQueue.prototype.mark = function (...args) {
      mark.apply(this, args);
      Object.assign(window, { restoredQueue: this });
    };
    const adapter = await getAdapter();
    const original = adapter.updateNote;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    adapter.updateNote = async (...args) => {
      Object.assign(window, { restoredWriteWaiting: true });
      await gate;
      adapter.updateNote = original;
      return original(...args);
    };
    Object.assign(window, { restoredRelease: release });
  });
  await other.locator(".ProseMirror").evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.setContent("<p>unsaved local draft</p>", true));
  await other.evaluate(() => {
    const host = window as any;
    host.restoredSave = host.restoredQueue.flushAll().then(() => null, (error: Error) => String(error));
  });
  await expect.poll(() => other.evaluate(() => Boolean((window as any).restoredWriteWaiting))).toBe(true);
  await page.evaluate(async id => {
    const { api } = await import("/src/lib/api.ts");
    await api.export.import(JSON.stringify({ notes: [{ id, title: "remote restored", content: { ops: [{ insert: "restored body\n" }] } }] }), "merge");
  }, id);
  const outcome = await other.evaluate(async id => {
    const { api } = await import("/src/lib/api.ts");
    const host = window as any;
    host.restoredRelease();
    const error = await host.restoredSave;
    const note = await api.notes.get(id!);
    return { error, body: note?.content.ops.map(op => op.insert).join(""), pending: host.restoredQueue.pending(id).content.ops.map((op: { insert: unknown }) => op.insert).join("") };
  }, id);
  expect(outcome).toMatchObject({ body: "restored body\n", pending: "unsaved local draft\n" });
  expect(outcome.error).toContain("另一窗口已恢复文档");
  const errorDialog = other.getByRole("dialog", { name: "错误详情" });
  if (await errorDialog.isVisible()) await errorDialog.getByRole("button", { name: "关闭错误详情", exact: true }).click();
  await expect(other.getByRole("button", { name: "保留本页并覆盖", exact: true })).toBeDisabled();
  await expect(other.getByRole("button", { name: "导出本页待保存修改", exact: true })).toBeVisible();
  await other.getByRole("button", { name: "载入其他标签页版本", exact: true }).click();
  await expect.poll(async () => ({ title: await other.locator(".note-title").count() ? await other.locator(".note-title").inputValue() : null, errors: pageErrors })).toEqual({ title: "remote restored", errors: [] });
  await expect(other.locator(".ProseMirror")).toHaveText("restored body");
  await other.locator(".ProseMirror").evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.insertContent("new "));
  await waitForSavedText(other, "new ");
});
