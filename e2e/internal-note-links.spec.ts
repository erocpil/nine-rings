import { expect, test } from "@playwright/test";

test("独立文档可用 [[ 建立稳定链接并在编辑和只读视图打开", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".note-editor .ProseMirror")).toBeVisible();
  const ids = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts") as typeof import("../src/lib/markdown-import");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const date = "2026-09-29";
    const target = await api.notes.create(buildTextImportInput({ fileName: "second.md", source: "# 第二份文档\n\n目标正文。\n" }, { mode: "document", storagePath: "references/other", date }));
    const source = await api.notes.create(buildTextImportInput({ fileName: "first.md", source: "# 第一份文档\n\n引用：\n" }, { mode: "document", storagePath: "ideas", date }));
    useNotesStore.getState().selectNote(source);
    return { source: source.id, target: target.id };
  });
  const editor = page.locator(".note-editor .ProseMirror");
  await expect(page.locator(".note-title")).toHaveValue("第一份文档");
  await editor.locator("p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("[[");
  await expect(page.locator(".wiki-dropdown .wiki-item")).toContainText(["第二份文档"]);
  await page.locator(".wiki-dropdown .wiki-item", { hasText: "第二份文档" }).click();
  const link = editor.locator(`a[href="nr-note://${ids.target}"]`);
  await expect(link).toHaveText("第二份文档");
  await link.click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("nr:lastNote"))).toBe(ids.target);

  await page.evaluate(async ({ source, target }) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts") as typeof import("../src/lib/api");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts") as typeof import("../src/stores/useNotesStore");
    const note = await api.notes.get(source);
    if (!note) throw new Error("source missing");
    await api.notes.update(source, { readonly: true });
    await api.notes.update(target, { title: "已改名的目标" });
    localStorage.setItem("nr:experimentalReadonlyRendering", "true");
    useNotesStore.getState().selectNote(await api.notes.get(source));
  }, ids);
  await page.reload();
  await expect(page.locator(".vr-note")).toBeVisible();
  await page.locator(`.vr-note a[href="nr-note://${ids.target}"]`).click();
  await expect(page.locator(".note-title")).toHaveValue("已改名的目标");
});
