import { pressDocumentBoundary, pressLineBoundary } from "./helpers/keyboard";
import { expect, test } from "@playwright/test";
import type { Editor } from "@tiptap/core";

test("最近三份文档保留实例和撤销历史，首页往返不卸载，第四份淘汰最久未访问项", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ workspace_layout: "exhibition", interface_style: "calm" })));
  await page.goto("/");
  // Wait for startup before choosing the initial view: an empty database may
  // finish initialization before or after the demo document is installed.
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/stores/useNotesStore.ts";
    const { useNotesStore } = await import(/* @vite-ignore */ path);
    return useNotesStore.getState().startupReady;
  })).toBe(true);
  const home = page.getByRole("button", { name: "返回工作区首页", exact: true });
  await expect(page.locator(".note-title")).toBeVisible();
  await expect(home).toBeVisible();
  await home.click();
  await expect(page.locator(".exhibition-welcome")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    const notes = [];
    for (const title of ["memory A", "memory B", "memory C", "memory D"]) {
      notes.push(await api.notes.create({ title, date: "2026-09-27", storagePath: "", docType: "note", content: { ops: [{ insert: title + "\n" }] } }));
    }
    return notes.map(note => note.id);
  });
  // Exercise the same store selection boundary as document navigation.
  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    const path = "/src/stores/useNotesStore.ts";
    const { useNotesStore } = await import(/* @vite-ignore */ path);
    return useNotesStore.getState().startupReady;
  })).toBe(true);
  const open = async (index: number) => {
    await page.evaluate(async id => {
      const path = "/src/lib/api.ts", store = "/src/stores/useNotesStore.ts";
      const { api } = await import(/* @vite-ignore */ path);
      const { useNotesStore } = await import(/* @vite-ignore */ store);
      useNotesStore.getState().selectNote(await api.notes.get(id));
    }, ids[index]);
    await expect.poll(() => page.locator(".note-title").evaluate(el => el instanceof HTMLInputElement ? el.value : el.textContent)).toBe(`memory ${"ABCD"[index]}`);
  };
  const editor = page.locator(".note-editor .ProseMirror");
  await open(0);
  const a = await editor.evaluateHandle(el => (el as HTMLElement & { editor: Editor }).editor);
  await editor.click();
  await pressLineBoundary(page, "end");
  await page.keyboard.type(" retained edit");
  await page.getByRole("button", { name: "返回工作区首页", exact: true }).click();
  await expect(page.locator(".exhibition-welcome")).toBeVisible();
  expect(await a.evaluate(instance => instance.isDestroyed)).toBe(false);
  await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
  expect(await editor.evaluate((el, instance) => (el as HTMLElement & { editor: Editor }).editor === instance, a)).toBe(true);
  await open(1);
  const b = await editor.evaluateHandle(el => (el as HTMLElement & { editor: Editor }).editor);
  await open(2);
  await open(0);
  expect(await editor.evaluate((el, instance) => (el as HTMLElement & { editor: Editor }).editor === instance, a)).toBe(true);
  await editor.evaluate(el => (el as HTMLElement & { editor: Editor }).editor.commands.undo());
  await expect(editor).not.toContainText("retained edit");
  await open(3);
  await expect.poll(() => b.evaluate(instance => instance.isDestroyed)).toBe(true);
  expect(await a.evaluate(instance => instance.isDestroyed)).toBe(false);

  await open(2);
  await page.getByTitle("切换到 Markdown 源码", { exact: true }).click();
  const source = page.locator(".cm-content");
  await expect(source).toBeVisible();
  const sourceNode = await source.elementHandle();
  await source.click();
  await pressDocumentBoundary(page, "end");
  await page.keyboard.type("source retained");
  await open(3);
  await open(2);
  expect(await source.evaluate((node, original) => node === original, sourceNode)).toBe(true);
  await expect(source).toContainText("source retained");
  await source.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(source).not.toContainText("source retained");

  // A separate writer can change a parked document without mounting its editor.
  await page.evaluate(async id => {
    const path = "/src/lib/api.ts";
    const { api } = await import(/* @vite-ignore */ path);
    await api.notes.update(id, { content: { ops: [{ insert: "externally replaced\n" }] } });
  }, ids[0]);
  await open(0);
  await expect(editor).toContainText("externally replaced");
  await expect.poll(() => a.evaluate(instance => instance.isDestroyed)).toBe(true);
});
