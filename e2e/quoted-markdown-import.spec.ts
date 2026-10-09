import { expect, test } from "@playwright/test";

test("导入引用内列表和行内代码，刷新后保留结构及可辨识样式", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ interface_style: "wabi-sabi", editor_show_line_numbers: true })));
  await page.goto("/");
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /^备份与导入/ }).click();
  await page.getByLabel("Markdown 导入目标路径").fill("references/quoted-import");
  await page.locator('input[type="file"][accept^=".md,"]').setInputFiles({
    name: "quoted-import.md",
    mimeType: "text/markdown",
    buffer: Buffer.from('# Quote Import Regression\n\n> **范围**\n>\n> 说明：\n>\n> - `rte_mbuf` 与 `rte_mempool`\n> - **驱动**中的 ``a ` b``\n>\n> 参考 `IOVA=PA`。\n\n- 外部列表中的 `mlx5`\n\n```text\nsource\n```'),
  });
  await expect(page.getByText("已导入 1 篇文档", { exact: true })).toBeVisible();
  await page.getByLabel("关闭设置").click();
  await page.getByRole("button", { name: "Quote Import Regression", exact: true }).click();
  const editor = page.locator(".ProseMirror");
  await expect(editor.locator("blockquote ul > li")).toHaveCount(2);
  await expect(editor.locator("blockquote li code").first()).toHaveText("rte_mbuf");
  await expect(editor.locator("blockquote li code").last()).toHaveText("a ` b");
  await expect(editor.locator(":scope > ul code")).toHaveText("mlx5");
  await expect(editor.locator(".code-block-toolbar .structured-block-symbol")).toHaveText("</>");
  await expect(editor.locator(".blockquote-toolbar .structured-block-symbol")).toHaveText("❝");
  await expect.poll(() => page.locator('.editor-block-number[data-block-index="4"]').evaluate(element => {
    const marker = element.getBoundingClientRect();
    const toolbar = document.querySelector(".ProseMirror .code-block-title")!.getBoundingClientRect();
    return Math.abs(marker.top + marker.height / 2 - toolbar.top - toolbar.height / 2);
  })).toBeLessThan(2);
  const contrast = await editor.locator("blockquote code").first().evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    quote: getComputedStyle(element.closest("blockquote")!).backgroundColor,
    border: getComputedStyle(element).borderTopWidth,
  }));
  expect(contrast.background).not.toBe(contrast.quote);
  expect(parseFloat(contrast.border)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator(".note-title")).toHaveValue("Quote Import Regression");
  await expect(editor.locator("blockquote ul > li")).toHaveCount(2);
  await expect(editor.locator("blockquote li code").last()).toHaveText("a ` b");
});

for (const virtual of [false, true]) {
  test(`引用内列表在只读和源码预览中保持结构 virtual=${virtual}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("nine_rings_config", JSON.stringify({ editor_show_line_numbers: true })));
    await page.goto("/");
    await expect(page.locator(".ProseMirror")).toBeVisible();
    await page.evaluate(async virtual => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { api } = await load("/src/lib/api.ts");
      const { mdToDelta } = await load("/src/lib/md-parser.ts");
      const { useNotesStore } = await load("/src/stores/useNotesStore.ts");
      const { setReadonlyRenderingEnabled } = await load("/src/lib/readonly-rendering.ts");
      setReadonlyRenderingEnabled(virtual);
      const note = await api.notes.create({ title: "引用只读验证", storagePath: "references", content: mdToDelta("> 范围\n>\n> - `rte_mbuf`\n> - `mlx5`\n\n```text\nsource\n```") });
      await api.notes.update(note.id, { readonly: true });
      useNotesStore.getState().selectNote(await api.notes.get(note.id));
    }, virtual);
    const root = virtual ? page.locator(".vr-note") : page.locator(".note-editor .ProseMirror");
    await expect(root.locator("blockquote li")).toHaveCount(2);
    await expect(root.locator("blockquote li code").first()).toHaveText("rte_mbuf");
    if (virtual) {
      const row = root.locator('.vr-row[data-block-type="codeBlock"]');
      await expect.poll(() => row.evaluate(element => {
        const number = element.querySelector(".vr-gutter span")!.getBoundingClientRect();
        const toolbar = element.querySelector(".vr-code-toolbar .structured-block-caption")!.getBoundingClientRect();
        return Math.abs(number.top + number.height / 2 - toolbar.top - toolbar.height / 2);
      })).toBeLessThan(2);
    }
    await page.getByRole("button", { name: "源码", exact: true }).click();
    if (!await page.locator(".markdown-preview-scroll").count()) await page.getByRole("button", { name: "并排预览", exact: true }).click();
    await expect(page.locator(".markdown-preview-scroll blockquote li")).toHaveCount(2);
    await expect(page.locator(".markdown-preview-scroll .structured-block-symbol").last()).toHaveText("</>");
  });
}
