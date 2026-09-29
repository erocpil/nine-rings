import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, virtual: boolean, legacyTarget = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  return page.evaluate(async ({ virtual, legacyTarget }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts") as typeof import("../src/lib/markdown-import");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const date = "2026-09-29";
    const book = "references/LaOS/docs/book";
    const imported = (fileName: string, source: string, storagePath = book) => buildTextImportInput({ fileName, source }, { mode: "document", storagePath, date });
    const memory = await api.notes.create(imported("02-memory-zh.md", "# 第 2 章：内存\n\n内存章节正文。\n"));
    if (legacyTarget) await api.notes.update(memory.id, { content: { ...memory.content, metadata: { ...memory.content.metadata, originalFileName: undefined } } });
    const design = await api.notes.create(imported("boot-arch-zh.md", "# 启动架构\n\n架构正文。\n", "references/LaOS/docs/design/boot"));
    const boot = await api.notes.create(imported("01-boot-zh.md", "# 第 1 章：启动\n\n[启动架构](../design/boot/boot-arch-zh.md)\n\n**下一章**：[内存](02-memory-zh.md)。\n"));
    if (virtual) await api.notes.update(boot.id, { readonly: true });
    localStorage.setItem("nr:experimentalReadonlyRendering", String(virtual));
    useNotesStore.getState().selectNote(await api.notes.get(boot.id));
    return { boot: boot.id, memory: memory.id, design: design.id };
  }, { virtual, legacyTarget });
}

test("导入的 Markdown 相对路径在编辑视图中打开同目录和上级目录文档", async ({ page }) => {
  const ids = await seed(page, false);
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(editor.locator('a[href="02-memory-zh.md"]')).toHaveText("内存");
  await editor.locator('a[href="02-memory-zh.md"]').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(ids.memory);
  await expect(page.locator(".note-title")).toHaveValue("第 2 章：内存");

  await page.evaluate(async id => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    useNotesStore.getState().selectNote(await api.notes.get(id));
  }, ids.boot);
  await expect(editor.locator('a[href="../design/boot/boot-arch-zh.md"]')).toHaveText("启动架构");
  await editor.locator('a[href="../design/boot/boot-arch-zh.md"]').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(ids.design);

});

test("只读局部渲染中的相对 Markdown 链接打开目标文档", async ({ page }) => {
  const virtualIds = await seed(page, true);
  await page.reload();
  await expect(page.locator(".vr-note .vr-row")).toHaveCount(3);
  await page.locator('.vr-note a[href="02-memory-zh.md"]').click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(virtualIds.memory);
});

test("旧导入文档缺少原文件名时按链接文字提供目标建议", async ({ page }) => {
  const ids = await seed(page, false, true);
  await page.locator('.note-editor .ProseMirror a[href="02-memory-zh.md"]').click();
  const suggestion = page.getByRole("dialog", { name: "文档链接建议" });
  await expect(suggestion).toContainText("02-memory-zh.md");
  await suggestion.getByRole("button", { name: /第 2 章：内存/ }).click();
  await expect(page.locator(".note-title")).toHaveValue("第 2 章：内存");
  await expect.poll(() => page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    return useNotesStore.getState().selectedNote?.id;
  })).toBe(ids.memory);
});
