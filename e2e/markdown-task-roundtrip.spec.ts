import { expect, test, type Page } from "@playwright/test";

async function seed(page: Page, readonly = false) {
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.evaluate(async readonly => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { api } = await load("/src/lib/api.ts");
    const { buildTextImportInput } = await load("/src/lib/markdown-import.ts");
    const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
    const input = buildTextImportInput({ fileName: "任务列表.md", source: "- [ ] 待处理 **重点**\n  - [x] 已完成\n- 普通列表\n\n转义 \\[文字\\] 与 `\\[代码\\]`\n" }, { mode: "document", storagePath: "references/任务测试", date: useNotesStore.getState().currentDate });
    const note = await api.notes.create(input);
    if (readonly) await api.notes.update(note.id, { readonly: true });
    useNotesStore.getState().selectNote(await api.notes.get(note.id));
    localStorage.setItem("nr:experimentalReadonlyRendering", String(readonly));
  }, readonly);
  await expect(page.locator(".editor-content")).toContainText("待处理");
  await page.reload();
  await expect(page.locator(".editor-content")).toContainText("待处理");
}

for (const width of [390, 1280]) {
  test(`任务列表渲染、源码编辑与反复切换不累积转义 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await seed(page);
    const editor = page.locator(".ProseMirror");
    const unchecked = editor.locator('li[data-task-checked="false"]');
    const checked = editor.locator('li[data-task-checked="true"]');
    await expect(unchecked).toHaveCount(1);
    await expect(checked).toHaveCount(1);
    expect(await unchecked.evaluate(el => getComputedStyle(el, "::before").content)).toContain("☐");
    expect(await checked.evaluate(el => getComputedStyle(el, "::before").content)).toContain("☑");
    await unchecked.locator(":scope > p").click();
    await page.keyboard.press("End");
    await page.keyboard.insertText("！");
    const source = page.getByRole("textbox", { name: "Markdown 源码", exact: true });
    for (let i = 0; i < 5; i++) {
      await page.getByRole("button", { name: "源码", exact: true }).click();
      await expect(editor).toHaveCount(0);
      const value = await source.inputValue();
      expect(value).toContain("- [ ] 待处理");
      expect(value).toContain("  - [x] 已完成");
      expect(value).not.toContain("\\\\[");
      expect(value).not.toContain("- \\[ ");
      await source.fill(value.replace(/已完成[！]*/, "已完成" + "！".repeat(i + 1)));
      await page.getByRole("button", { name: "渲染", exact: true }).click();
      await expect(unchecked).toHaveCount(1);
      await expect(checked).toHaveCount(1);
      await expect(editor).toContainText("转义 [文字]");
      await expect(editor.locator("code")).toHaveText("\\[代码\\]");
      // Force serialization from the rich editor, not the retained source spelling.
      await unchecked.locator(":scope > p").click();
      await page.keyboard.press("End");
      await page.keyboard.insertText("！");
    }
    await expect(page.locator(".save-status-saved")).toBeVisible();
    await page.reload();
    await expect(unchecked).toHaveCount(1);
    await expect(checked).toHaveCount(1);
  });
}

test("只读局部渲染保留任务标记及源码", async ({ page }) => {
  await seed(page, true);
  const content = page.locator(".editor-content");
  await expect(content.locator('li[data-task-checked="false"]')).toHaveCount(1);
  await expect(content.locator('li[data-task-checked="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Markdown 源码", exact: true })).toHaveValue(/- \[ \] 待处理/);
  await page.getByRole("button", { name: "渲染", exact: true }).click();
  await expect(content.locator('li[data-task-checked="true"]')).toHaveCount(1);
});
